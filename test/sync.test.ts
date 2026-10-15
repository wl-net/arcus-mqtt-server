import { describe, it, before, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { startSync } from '../src/sync.js';
import type { ArcusClient } from '../src/arcus/client.js';
import type { ArcusDevice, ArcusAttributes, ArcusMethodCall, AlarmState, SceneInfo } from '../src/arcus/types.js';
import { FakeMqtt, makeDevice, testConfig, until, quietConsole } from './helpers.js';

/** A scriptable ArcusClient: tests change what it returns and fire its events */
class FakeClient implements ArcusClient {
  devices: ArcusDevice[] = [];
  hub: ArcusDevice | null = null;
  scenes: SceneInfo[] = [];
  alarm: AlarmState = { securityMode: 'DISARMED', alarmMode: 'ON', bypassedDevices: [] };
  listDevicesCalls = 0;
  listDevicesDelayMs = 0;
  failListDevices = false;
  private deviceHandlers: Array<(address: string, attributes: ArcusAttributes) => void> = [];
  private connectionHandlers: Array<(connected: boolean) => void> = [];

  async connect(): Promise<void> {}
  async listDevices(): Promise<ArcusDevice[]> {
    this.listDevicesCalls++;
    if (this.listDevicesDelayMs) await new Promise(r => setTimeout(r, this.listDevicesDelayMs));
    if (this.failListDevices) throw new Error('listDevices failed');
    // Fresh copies, as the platform client returns new objects on every call
    return this.devices.map(d => ({ ...d, caps: new Set(d.caps), attributes: { ...d.attributes } }));
  }
  async getHub(): Promise<ArcusDevice | null> {
    return this.hub && { ...this.hub, caps: new Set(this.hub.caps), attributes: { ...this.hub.attributes } };
  }
  readonly commands: Array<{ address: string; attributes: ArcusAttributes }> = [];
  async sendCommand(address: string, attributes: ArcusAttributes): Promise<void> {
    this.commands.push({ address, attributes });
  }
  readonly methodCalls: Array<{ address: string; call: ArcusMethodCall }> = [];
  async callMethod(address: string, call: ArcusMethodCall): Promise<void> {
    this.methodCalls.push({ address, call });
  }
  onDeviceEvent(handler: (address: string, attributes: ArcusAttributes) => void): void {
    this.deviceHandlers.push(handler);
  }
  onConnectionChange(handler: (connected: boolean) => void): void {
    this.connectionHandlers.push(handler);
  }
  async getAlarmState(): Promise<AlarmState> {
    return { ...this.alarm };
  }
  async armAlarm(): Promise<void> {}
  async disarmAlarm(): Promise<void> {}
  onAlarmEvent(): void {}
  async listScenes(): Promise<SceneInfo[]> {
    return this.scenes;
  }
  onSceneEvent(): void {}
  async fireScene(): Promise<void> {}

  emitDevice(address: string, attributes: ArcusAttributes): void {
    for (const h of this.deviceHandlers) h(address, attributes);
  }
  emitConnection(connected: boolean): void {
    for (const h of this.connectionHandlers) h(connected);
  }
}

const contact = () => makeDevice('DRIV:dev:door-1', ['dev', 'devadv', 'devconn', 'cont'], {
  'cont:contact': 'CLOSED', 'devconn:state': 'ONLINE', 'devadv:protocol': 'ZIGB',
}, 'Front Door');
const lock = () => makeDevice('DRIV:dev:lock-1', ['dev', 'devconn', 'doorlock'], {
  'doorlock:lockstate': 'LOCKED', 'devconn:state': 'ONLINE',
}, 'Front Lock');
const hub = () => makeDevice('SERV:hub:LWW-1', ['base', 'hub', 'hubconn', 'hubpow'], {
  'hubconn:state': 'ONLINE', 'hubpow:source': 'MAINS',
}, 'Hub');

describe('sync', () => {
  let stop: (() => void) | undefined;
  before(quietConsole);
  afterEach(() => stop?.());

  async function start(setup: (client: FakeClient) => void = () => {}) {
    const broker = new FakeMqtt();
    const client = new FakeClient();
    client.devices = [contact(), lock()];
    setup(client);
    const sync = await startSync(broker, testConfig(), client);
    stop = sync.stop;
    return { broker, client };
  }

  /** A resync the way a reconnect triggers one; waits for it to finish */
  async function resync(broker: FakeMqtt, client: FakeClient) {
    const calls = client.listDevicesCalls;
    const mark = broker.published.length;
    client.emitConnection(true);
    await until(() => client.listDevicesCalls > calls && broker.since(mark, 'arcus/bridge/').length > 0, 3000, 'resync');
  }

  it('marks the bridge offline until the first sync, then online', async () => {
    const { broker } = await start();
    const bridge = broker.published.filter(p => p.topic === 'arcus/bridge/availability').map(p => p.payload);
    assert.deepEqual(bridge, ['offline', 'online']);
    assert.equal(broker.json('arcus/door-1/state').contact, 'OFF');
  });

  it('follows devconn:state for device availability, at sync and on live events', async () => {
    const { broker, client } = await start((c) => { c.devices[1].attributes['devconn:state'] = 'OFFLINE'; });
    assert.equal(broker.retained.get('arcus/lock-1/availability'), 'offline');
    assert.equal(broker.retained.get('arcus/door-1/availability'), 'online');

    client.emitDevice('DRIV:dev:door-1', { 'devconn:state': 'OFFLINE' });
    assert.equal(broker.retained.get('arcus/door-1/availability'), 'offline');
    client.emitDevice('DRIV:dev:door-1', { 'devconn:state': 'ONLINE' });
    assert.equal(broker.retained.get('arcus/door-1/availability'), 'online');
  });

  it('marks the bridge offline when the connection drops, and resyncs on reconnect', async () => {
    const { broker, client } = await start();
    client.emitConnection(false);
    assert.equal(broker.retained.get('arcus/bridge/availability'), 'offline');

    // A change made during the outage is picked up by the resync
    client.devices[0].attributes['cont:contact'] = 'OPENED';
    await resync(broker, client);
    assert.equal(broker.json('arcus/door-1/state').contact, 'ON');
    assert.equal(broker.retained.get('arcus/bridge/availability'), 'online');
  });

  it('does not re-send unchanged discovery on resync', async () => {
    const { broker, client } = await start();
    const mark = broker.published.length;
    await resync(broker, client);
    assert.deepEqual(broker.since(mark, 'homeassistant/'), []);
  });

  it('removes a deleted device from HA, and restores it when re-added', async () => {
    const { broker, client } = await start();
    const lockConfig = 'homeassistant/lock/arcus/lock-1_lock/config';
    assert.ok(broker.retained.has(lockConfig));

    client.devices = [contact()];
    await resync(broker, client);
    assert.equal(broker.retained.has(lockConfig), false);
    assert.equal(broker.retained.has('arcus/lock-1/state'), false);
    assert.equal(broker.retained.has('arcus/lock-1/availability'), false);
    assert.ok(broker.retained.has('homeassistant/binary_sensor/arcus/door-1_contact/config'));

    client.devices = [contact(), lock()];
    await resync(broker, client);
    assert.ok(broker.retained.has(lockConfig));
  });

  it('removes a deleted scene', async () => {
    const scene = (n: number) => ({ address: `SERV:scene:p.${n}`, id: `p.${n}`, name: `Scene ${n}`, enabled: true });
    const { broker, client } = await start((c) => { c.scenes = [scene(1), scene(2)]; });
    assert.ok(broker.retained.has('homeassistant/button/arcus/scene_2/config'));

    client.scenes = [scene(1)];
    await resync(broker, client);
    assert.equal(broker.retained.has('homeassistant/button/arcus/scene_2/config'), false);
    assert.ok(broker.retained.has('homeassistant/button/arcus/scene_1/config'));
  });

  it('serializes overlapping syncs into one running sync plus one rerun', async () => {
    const { broker, client } = await start();
    client.listDevicesDelayMs = 100;
    const calls = client.listDevicesCalls;
    client.emitConnection(true);
    client.emitConnection(true);
    client.emitConnection(true);
    await until(() => client.listDevicesCalls === calls + 2, 3000, 'rerun');
    await new Promise(r => setTimeout(r, 300));
    assert.equal(client.listDevicesCalls, calls + 2);
    assert.equal(broker.retained.get('arcus/bridge/availability'), 'online');
  });

  it('keeps the bridge offline when a resync fails', async () => {
    const { broker, client } = await start();
    client.emitConnection(false);
    client.failListDevices = true;
    const calls = client.listDevicesCalls;
    client.emitConnection(true);
    await until(() => client.listDevicesCalls > calls, 3000, 'resync attempt');
    await new Promise(r => setTimeout(r, 50));
    assert.equal(broker.retained.get('arcus/bridge/availability'), 'offline');
  });

  it('sends commands from HA to Arcus', async () => {
    const { broker, client } = await start();
    broker.deliver('arcus/lock-1/lock/set', 'UNLOCK');
    assert.deepEqual(client.commands, [{ address: 'DRIV:dev:lock-1', attributes: { 'doorlock:lockstate': 'UNLOCKED' } }]);
  });

  it('sends commands that Arcus takes as method calls', async () => {
    const { broker, client } = await start(c => {
      c.devices.push(makeDevice('DRIV:dev:timer-1', ['irrcont', 'irr'], {
        'irr:zoneState:z1': 'NOT_WATERING',
        'irr:defaultDuration:z1': 5,
      }));
    });
    broker.deliver('arcus/timer-1/zone_z1/set', 'OPEN');
    assert.deepEqual(client.methodCalls, [
      { address: 'DRIV:dev:timer-1', call: { method: 'irrcont:WaterNowV2', args: { zone: 'z1', duration: 5 } } },
    ]);
    assert.deepEqual(client.commands, []);
  });

  it('republishes discovery after reconnecting to the broker', async () => {
    const { broker, client } = await start();
    const mark = broker.published.length;
    const calls = client.listDevicesCalls;
    broker.reconnect();
    await until(() => client.listDevicesCalls > calls && broker.since(mark, 'arcus/bridge/').length > 0, 3000, 'resync');
    assert.ok(broker.since(mark).some(p => p.topic === 'homeassistant/lock/arcus/lock-1_lock/config'));
    assert.equal(broker.retained.get('arcus/bridge/availability'), 'online');
  });

  describe('hub', () => {
    it('links Zigbee/Z-Wave devices to the hub and gates them on its connection', async () => {
      const { broker } = await start((c) => { c.hub = hub(); });
      const door = broker.json('homeassistant/binary_sensor/arcus/door-1_contact/config');
      assert.equal((door.device as { via_device?: string }).via_device, 'arcus_LWW-1');
      assert.ok((door.availability as Array<{ topic: string }>).some(a => a.topic === 'arcus/LWW-1/connection'));

      // The lock reports no protocol, so it isn't treated as hub-paired
      const lockDisc = broker.json('homeassistant/lock/arcus/lock-1_lock/config');
      assert.equal((lockDisc.device as { via_device?: string }).via_device, undefined);
    });

    it('publishes the hub connection from hubconn:state, including live changes', async () => {
      const { broker, client } = await start((c) => { c.hub = hub(); });
      assert.equal(broker.retained.get('arcus/LWW-1/connection'), 'online');

      client.emitDevice('SERV:hub:LWW-1', { 'hubconn:state': 'OFFLINE' });
      assert.equal(broker.retained.get('arcus/LWW-1/connection'), 'offline');
      assert.equal(broker.json('arcus/LWW-1/state').connectivity, 'OFF');
    });
  });

  describe('alarm bypass', () => {
    it('reports bypassed sensors by name while armed', async () => {
      const { broker } = await start((c) => {
        c.alarm = { securityMode: 'ARMED', alarmMode: 'ON', bypassedDevices: ['DRIV:dev:door-1'] };
      });
      assert.deepEqual(broker.json('arcus/alarm/attributes'), { bypassed: 'ON', bypassed_sensors: ['Front Door'] });
      assert.ok(broker.retained.has('homeassistant/binary_sensor/arcus/alarm_bypassed/config'));
    });

    it('reports nothing bypassed while disarmed', async () => {
      const { broker } = await start((c) => {
        c.alarm = { securityMode: 'DISARMED', alarmMode: 'ON', bypassedDevices: ['DRIV:dev:door-1'] };
      });
      assert.deepEqual(broker.json('arcus/alarm/attributes'), { bypassed: 'OFF', bypassed_sensors: [] });
    });
  });
});
