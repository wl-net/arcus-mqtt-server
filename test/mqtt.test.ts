import { describe, it, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer as createHttpServer, type Server as HttpServer } from 'node:http';
import { createServer, type Server } from 'node:net';
import type { AddressInfo } from 'node:net';
import { Aedes, type AuthenticateError, type Client } from 'aedes';
import { connectAsync, type MqttClient } from 'mqtt';
import {
  connectMqtt,
  resolveMqttConnection,
  supervisorMqtt,
  topicMatches,
  type MqttContext,
} from '../src/mqtt.js';
import { quietConsole, testConfig, until } from './helpers.js';

describe('topicMatches', () => {
  it('matches + against exactly one level', () => {
    assert.equal(topicMatches('arcus/+/+/set', 'arcus/door-1/lock/set'), true);
    assert.equal(topicMatches('arcus/+/+/set', 'arcus/door-1/set'), false);
    assert.equal(topicMatches('arcus/+/+/set', 'arcus/a/b/c/set'), false);
  });

  it('matches # against the rest of the topic', () => {
    assert.equal(topicMatches('arcus/#', 'arcus/scene/scene_1/fire'), true);
    assert.equal(topicMatches('arcus/#', 'homeassistant/status'), false);
  });

  it('matches plain filters exactly', () => {
    assert.equal(topicMatches('arcus/alarm/set', 'arcus/alarm/set'), true);
    assert.equal(topicMatches('arcus/alarm/set', 'arcus/alarm/set/x'), false);
  });
});

/** A fake Supervisor answering /services/mqtt with each reply in turn (the last repeats) */
async function fakeSupervisor(replies: Array<{ status: number; body?: unknown }>) {
  const auth: Array<string | undefined> = [];
  let calls = 0;
  const server: HttpServer = createHttpServer((req, res) => {
    auth.push(req.headers.authorization);
    const reply = replies[Math.min(calls++, replies.length - 1)];
    res.writeHead(req.url === '/services/mqtt' ? reply.status : 404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(reply.body ?? { result: 'error', message: 'Service not enabled' }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    auth,
    calls: () => calls,
    stop: () => new Promise<void>(resolve => server.close(() => resolve())),
  };
}

const MOSQUITTO = {
  status: 200,
  body: {
    result: 'ok',
    data: { app: 'core_mosquitto', host: 'core-mosquitto', port: 1883, ssl: false, protocol: '3.1.1', username: 'addons', password: 'pw' },
  },
};

describe('finding the broker', () => {
  before(quietConsole);

  it('reads the Mosquitto app from the Supervisor', async () => {
    const supervisor = await fakeSupervisor([MOSQUITTO]);
    try {
      const conn = await supervisorMqtt('token-1', supervisor.url);
      assert.deepEqual(conn, { url: 'mqtt://core-mosquitto:1883', username: 'addons', password: 'pw' });
      assert.deepEqual(supervisor.auth, ['Bearer token-1']);
    } finally {
      await supervisor.stop();
    }
  });

  it('uses mqtts when the broker requires TLS', async () => {
    const supervisor = await fakeSupervisor([{ status: 200, body: { result: 'ok', data: { host: 'broker', port: 8883, ssl: true } } }]);
    try {
      assert.equal((await supervisorMqtt('t', supervisor.url))?.url, 'mqtts://broker:8883');
    } finally {
      await supervisor.stop();
    }
  });

  it('prefers MQTT_URL over the Supervisor', async () => {
    const config = testConfig({ mqttUrl: 'mqtt://localhost:1883', mqttUsername: 'u', mqttPassword: 'p', supervisorToken: 't' });
    assert.deepEqual(await resolveMqttConnection(config), { url: 'mqtt://localhost:1883', username: 'u', password: 'p' });
  });

  it('requires MQTT_URL outside Home Assistant', async () => {
    const config = testConfig({ mqttUrl: undefined, supervisorToken: undefined });
    await assert.rejects(resolveMqttConnection(config), /MQTT_URL is required/);
  });

  it('waits for a broker app to be installed', async () => {
    const supervisor = await fakeSupervisor([{ status: 400 }, MOSQUITTO]);
    try {
      const config = testConfig({ mqttUrl: undefined, supervisorToken: 't' });
      const conn = await resolveMqttConnection(config, { retryMs: 10, supervisorUrl: supervisor.url });
      assert.equal(conn.url, 'mqtt://core-mosquitto:1883');
      assert.equal(supervisor.calls(), 2);
    } finally {
      await supervisor.stop();
    }
  });
});

/** An in-process aedes broker. It only speaks MQTT 3.1.1, so the bridge connects with protocol 4 here */
async function startBroker(password?: string) {
  const aedes = await Aedes.createBroker();
  if (password !== undefined) {
    aedes.authenticate = (_client, _username, pw, callback) => {
      if (pw?.toString() === password) return callback(null, true);
      const err = new Error('Bad username or password') as AuthenticateError;
      err.returnCode = 4;
      callback(err, false);
    };
  }
  const clients: Client[] = [];
  aedes.on('client', (client) => clients.push(client));
  const server: Server = createServer(aedes.handle);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
  const { port } = server.address() as AddressInfo;
  return {
    url: `mqtt://127.0.0.1:${port}`,
    clients,
    async stop() {
      await new Promise<void>(resolve => aedes.close(() => resolve()));
      await new Promise<void>(resolve => server.close(() => resolve()));
    },
  };
}

/** Another client on the broker, recording every message on the given filter */
async function observe(url: string, filter: string, protocolVersion: 4 | 5 = 4) {
  const client: MqttClient = await connectAsync(url, { protocolVersion });
  const messages: Array<{ topic: string; payload: string; retain: boolean }> = [];
  client.on('message', (topic, payload, packet) => messages.push({ topic, payload: payload.toString(), retain: packet.retain }));
  await client.subscribeAsync(filter, { qos: 1 });
  return { client, messages };
}

const WILL = { topic: 'arcus/bridge/availability', payload: 'offline' };

describe('connectMqtt', () => {
  let broker: Awaited<ReturnType<typeof startBroker>>;
  const cleanup: Array<() => Promise<unknown>> = [];

  before(quietConsole);
  afterEach(async () => {
    for (const fn of cleanup.splice(0).reverse()) await fn();
  });

  async function bridge(url: string, password?: string): Promise<MqttContext> {
    const ctx = await connectMqtt({ url, username: 'arcus', password }, WILL, { protocolVersion: 4, reconnectPeriod: 50 });
    cleanup.push(() => ctx.close());
    return ctx;
  }

  async function withBroker(password?: string) {
    broker = await startBroker(password);
    cleanup.push(() => broker.stop());
    return broker;
  }

  it('publishes retained messages that other clients receive', async () => {
    const { url } = await withBroker();
    const { mqtt } = await bridge(url);
    mqtt.publish('arcus/door-1/state', '{"contact":"ON"}', true);

    await new Promise(r => setTimeout(r, 50));
    const ha = await observe(url, 'arcus/+/state');
    cleanup.push(() => ha.client.endAsync());
    await until(() => ha.messages.length > 0, 2000, 'retained state');
    assert.deepEqual(ha.messages[0], { topic: 'arcus/door-1/state', payload: '{"contact":"ON"}', retain: true });
  });

  it('delivers live commands but not retained ones', async () => {
    const { url } = await withBroker();
    const ha = await connectAsync(url, { protocolVersion: 4 });
    cleanup.push(() => ha.endAsync());
    // A command left retained on the broker must not replay when the bridge subscribes
    await ha.publishAsync('arcus/lock-1/lock/set', 'UNLOCK', { qos: 1, retain: true });

    const { mqtt } = await bridge(url);
    const received: string[] = [];
    mqtt.subscribe('arcus/+/+/set', (topic, payload) => received.push(`${topic} ${payload}`));
    await new Promise(r => setTimeout(r, 100));
    await ha.publishAsync('arcus/lock-1/lock/set', 'LOCK', { qos: 1 });

    await until(() => received.length > 0, 2000, 'command');
    await new Promise(r => setTimeout(r, 50));
    assert.deepEqual(received, ['arcus/lock-1/lock/set LOCK']);
  });

  it('rejects a login the broker refuses', async () => {
    const { url } = await withBroker('secret');
    await assert.rejects(
      connectMqtt({ url, username: 'arcus', password: 'wrong' }, WILL, { protocolVersion: 4 }),
      /refused the connection/,
    );
    await bridge(url, 'secret');
  });

  it('is marked offline by its will, and reconnects, when the connection drops', async () => {
    const { url, clients } = await withBroker();
    const { mqtt } = await bridge(url);
    let reconnects = 0;
    mqtt.onReconnect(() => reconnects++);
    const ha = await observe(url, WILL.topic);
    cleanup.push(() => ha.client.endAsync());

    const bridgeClient = clients.find(c => c.id.startsWith('arcus-mqtt-'));
    assert.ok(bridgeClient);
    bridgeClient.conn.destroy();

    await until(() => ha.messages.some(m => m.payload === 'offline'), 2000, 'will message');
    await until(() => reconnects === 1, 2000, 'reconnect');
  });

  it('publishes offline when it closes', async () => {
    const { url } = await withBroker();
    const ctx = await connectMqtt({ url }, WILL, { protocolVersion: 4 });
    ctx.mqtt.publish(WILL.topic, 'online', true);
    const ha = await observe(url, WILL.topic);
    cleanup.push(() => ha.client.endAsync());
    await until(() => ha.messages.some(m => m.payload === 'online'), 2000, 'online');

    await ctx.close();
    await until(() => ha.messages.at(-1)?.payload === 'offline', 2000, 'offline on close');
  });
});

// Runs against a real MQTT 5 broker (Mosquitto in CI) when TEST_MQTT_URL is set
describe('connectMqtt over MQTT 5', { skip: !process.env.TEST_MQTT_URL }, () => {
  const url = process.env.TEST_MQTT_URL ?? '';
  let ctx: MqttContext;
  let ha: Awaited<ReturnType<typeof observe>>;

  before(async () => {
    quietConsole();
    ctx = await connectMqtt({ url }, { topic: 'arcus-test/bridge/availability', payload: 'offline' });
    ha = await observe(url, 'arcus-test/+/state', 5);
  });
  after(async () => {
    await ha.client.endAsync();
    await ctx.close();
  });

  it('publishes and receives commands', async () => {
    ctx.mqtt.publish('arcus-test/door-1/state', '{"contact":"ON"}', false);
    await until(() => ha.messages.length > 0, 2000, 'state');

    const received: string[] = [];
    ctx.mqtt.subscribe('arcus-test/+/+/set', (_topic, payload) => received.push(payload));
    await new Promise(r => setTimeout(r, 100));
    await ha.client.publishAsync('arcus-test/lock-1/lock/set', 'LOCK', { qos: 1 });
    await until(() => received.length > 0, 2000, 'command');
    assert.deepEqual(received, ['LOCK']);
  });
});
