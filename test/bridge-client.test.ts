import { describe, it, before, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { BridgeClient, throwIfErrorResponse, type BridgeClientOptions } from '../src/arcus/bridge-client.js';
import { FakeArcusServer, OK, delay, quietConsole, until, type ArcusRequest } from './helpers.js';

type Reply = { messageType: string; attributes: Record<string, unknown> };

const unauthorized: Reply = { messageType: 'Error', attributes: { code: 'UnauthorizedRequest' } };

describe('BridgeClient', () => {
  let server: FakeArcusServer | undefined;
  let client: BridgeClient | undefined;
  before(quietConsole);
  afterEach(async () => {
    // Stop the client first so it doesn't try to reconnect to the stopped server
    client?.disconnect();
    await server?.stop();
    server = client = undefined;
  });

  async function start(
    respond: (req: ArcusRequest) => Reply | undefined | null = () => undefined,
    reconnectDelays = [20, 40],
    options: BridgeClientOptions = {},
  ) {
    server = new FakeArcusServer((req) => {
      const reply = respond(req);
      return reply === undefined ? OK : reply;
    });
    const url = await server.start();
    client = new BridgeClient({ reconnectDelays, ...options });
    return { server, client, url };
  }

  describe('requests', () => {
    it('resolves Error replies, which throwIfErrorResponse turns into errors', async () => {
      const { client, url } = await start((req) => (req.messageType === 'place:ListDevices' ? unauthorized : undefined));
      await client.connect(url, 'token');

      const resp = await client.sendRequest('SERV:place:place-1', 'place:ListDevices');
      assert.throws(() => throwIfErrorResponse(resp, 'place:ListDevices'), /place:ListDevices failed: .*UnauthorizedRequest/);

      const ok = await client.sendRequest('SERV:place:place-1', 'place:GetHub');
      assert.equal(throwIfErrorResponse(ok, 'place:GetHub'), ok);
    });

    it("reports events with the sender's address as the source", async () => {
      const { server, client, url } = await start();
      const events: Array<{ source?: string }> = [];
      client.onEvent = (e) => events.push(e);
      await client.connect(url, 'token');

      server.send({ source: 'DRIV:dev:d1', destination: 'SERV:place:place-1' }, 'base:ValueChange', { 'swit:state': 'ON' });
      server.send({ destination: 'SERV:place:place-1' }, 'base:Added', {});
      await until(() => events.length === 2, 2000, 'events');
      assert.equal(events[0].source, 'DRIV:dev:d1');
      assert.equal(events[1].source, 'SERV:place:place-1', 'falls back to the destination without a source');
    });
  });

  describe('reconnect', () => {
    it('re-sends SetActivePlace after a drop and reports connected', async () => {
      const { server, client, url } = await start();
      const changes: boolean[] = [];
      client.onConnectionChange = (up) => changes.push(up);
      await client.connect(url, 'token');
      client.setActivePlace('place-1');

      server.dropConnection();
      await until(() => changes.includes(true), 2000, 'reconnect');
      assert.deepEqual(changes, [false, true]);
      const [restore] = server.requestsOf('sess:SetActivePlace');
      assert.equal(restore.connection, 2);
      assert.deepEqual(restore.attributes, { placeId: 'place-1' });
      assert.equal(client.connected, true);
      assert.equal(client.reconnecting, false);
    });

    it('closes and retries a reconnect whose SetActivePlace returns Error', async () => {
      // Connection 2 rejects the active place, 3 accepts it
      const { server, client, url } = await start((req) =>
        req.messageType === 'sess:SetActivePlace' && req.connection === 2 ? unauthorized : undefined);
      const changes: boolean[] = [];
      client.onConnectionChange = (up) => changes.push(up);
      await client.connect(url, 'token');
      client.setActivePlace('place-1');

      server.dropConnection();
      await until(() => changes.includes(true), 2000, 'reconnect');
      assert.deepEqual(changes, [false, true]);
      assert.equal(server.connections, 3);
      assert.deepEqual(server.requestsOf('sess:SetActivePlace').map((r) => r.connection), [2, 3]);
    });

    it('keeps a single reconnect chain while attempts keep failing', async () => {
      const { server, client, url } = await start();
      await client.connect(url, 'token');

      // Accept upgrades but never send SessionCreated, then drop each attempt
      server.sendSession = false;
      server.dropConnection();
      for (let i = 2; i <= 4; i++) {
        await until(() => server.connections === i, 2000, `attempt ${i}`);
        server.dropConnection();
      }
      await delay(150);
      // A chain that doubled on every failure would have made many more attempts
      assert.ok(server.connections <= 6, `made ${server.connections} connections`);
      assert.equal(client.reconnecting, true);
    });

    it('reconnects in API-key mode over /apibus with the bearer token and keeps the active place', async () => {
      const { server, client, url } = await start();
      const changes: boolean[] = [];
      client.onConnectionChange = (up) => changes.push(up);
      await client.connectApiServer(url, 'api-key');
      client.setActivePlace('place-1');

      server.dropConnection();
      await until(() => changes.includes(true), 2000, 'reconnect');
      assert.deepEqual(server.handshakes.map((h) => [h.path, h.authorization]), [
        ['/apibus', 'Bearer api-key'],
        ['/apibus', 'Bearer api-key'],
      ]);
      // The API server has no session-level active place to restore
      assert.equal(server.requestsOf('sess:SetActivePlace').length, 0);
      assert.equal(client.placeDestination, 'SERV:place:place-1');
    });

    it('does not start a reconnect loop when the initial connect fails', async () => {
      const { server, client, url } = await start();
      server.validTokens = new Set();
      await assert.rejects(client.connect(url, 'bad-token'), /401/);
      await delay(100);
      assert.equal(server.handshakes.length, 1);
      assert.equal(client.reconnecting, false);
    });
  });

  describe('dead connections', () => {
    it('fails a connect that never gets SessionCreated, without a reconnect loop', { timeout: 5000 }, async () => {
      const { server, client, url } = await start(undefined, undefined, { connectTimeoutMs: 50 });
      server.sendSession = false;
      await assert.rejects(client.connect(url, 'token'), /No SessionCreated within/);
      await delay(150);
      assert.equal(server.connections, 1);
      assert.equal(client.reconnecting, false);
    });

    it('keeps reconnecting while attempts never get SessionCreated, then reports connected', async () => {
      const { server, client, url } = await start(undefined, undefined, { connectTimeoutMs: 50 });
      const changes: boolean[] = [];
      client.onConnectionChange = (up) => changes.push(up);
      await client.connect(url, 'token');
      client.setActivePlace('place-1');

      server.sendSession = false;
      server.dropConnection();
      await until(() => server.connections >= 3, 2000, 'attempts that time out');
      server.sendSession = true;
      await until(() => changes.includes(true), 2000, 'reconnect');
      assert.deepEqual(changes, [false, true]);
    });

    it('reconnects a connection that stops answering pings', async () => {
      const { server, client, url } = await start(undefined, undefined, { heartbeatMs: 40 });
      const changes: boolean[] = [];
      client.onConnectionChange = (up) => changes.push(up);
      await client.connect(url, 'token');
      client.setActivePlace('place-1');

      server.answerPings = false;
      await until(() => changes.includes(false), 2000, 'the dead connection to be dropped');
      server.answerPings = true;
      await until(() => changes.includes(true), 2000, 'reconnect');
      assert.equal(server.connections, 2);
    });

    it('keeps a connection that answers pings', async () => {
      const { server, client, url } = await start(undefined, undefined, { heartbeatMs: 20 });
      await client.connect(url, 'token');
      await delay(200);
      assert.equal(server.connections, 1);
      assert.equal(client.connected, true);
    });
  });

  describe('rejected credentials', () => {
    it('logs in again when a reconnect is refused for an expired token', async () => {
      const { server, client, url } = await start();
      server.validTokens = new Set();
      const changes: boolean[] = [];
      client.onConnectionChange = (up) => changes.push(up);
      const token = await client.login(url, 'user', 'pass');
      await client.connect(url, token);
      client.setActivePlace('place-1');

      // The token expires, then the connection drops
      server.validTokens.clear();
      server.dropConnection();
      await until(() => changes.includes(true), 2000, 'reconnect');
      assert.equal(server.logins, 2);
      assert.equal(server.handshakes.at(-1)!.cookie, 'irisAuthToken=login-token-2');
      assert.equal(server.requestsOf('sess:SetActivePlace').at(-1)!.connection, 2);
    });

    it('keeps retrying a rejected token it cannot renew, without logging in', async () => {
      const { server, client, url } = await start(undefined, [20]);
      await client.connect(url, 'token');

      server.validTokens = new Set();
      server.dropConnection();
      await until(() => server.handshakes.length >= 4, 2000, 'retries');
      assert.equal(server.logins, 0);
      assert.equal(client.reconnecting, true);

      // Once the server accepts it again, the reconnect succeeds
      server.validTokens.add('token');
      await until(() => client!.connected, 2000, 'reconnect');
    });

    it('keeps retrying a rejected API key, without logging in', async () => {
      const { server, client, url } = await start(undefined, [20]);
      await client.connectApiServer(url, 'api-key');

      server.validTokens = new Set();
      server.dropConnection();
      await until(() => server.handshakes.length >= 4, 2000, 'retries');
      assert.equal(server.logins, 0);
      assert.ok(server.handshakes.every((h) => h.path === '/apibus'));
    });
  });

  describe('disconnect', () => {
    it('rejects pending requests', async () => {
      const { client, url } = await start(() => null);
      await client.connect(url, 'token');
      const pending = client.sendRequest('SERV:place:place-1', 'place:ListDevices');
      client.disconnect();
      await assert.rejects(pending, /Disconnected/);
      assert.equal(client.connected, false);
    });

    it('cancels a pending reconnect', async () => {
      const { server, client, url } = await start(undefined, [100]);
      await client.connect(url, 'token');

      server.dropConnection();
      await until(() => client.reconnecting, 2000, 'reconnect scheduled');
      client.disconnect();
      await delay(200);
      assert.equal(server.handshakes.length, 1);
      assert.equal(client.reconnecting, false);
    });
  });
});
