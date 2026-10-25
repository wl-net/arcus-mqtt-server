/**
 * The bridge against a real Home Assistant, in Docker: `npm run test:ha`.
 *
 * Starts Mosquitto and Home Assistant, sets HA up through its onboarding and config flow
 * APIs, then runs the last release's image and upgrades it to this tree's, alongside a
 * second bridge for another place. Fails on anything HA logs (Settings → System → Logs),
 * on entities HA rejected or kept from before, and on retained topics a fresh install
 * wouldn't have. Container logs are saved to build-test/ha-logs/.
 *
 * HA_IMAGE overrides the Home Assistant image. PREVIOUS_IMAGE overrides the image to
 * upgrade from (empty to skip that step); by default it's the release before HEAD.
 * BRIDGE_IMAGE uses a prebuilt image instead of building this tree. HA_KEEP=1 leaves
 * the containers running.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connectAsync } from 'mqtt';
import WebSocket from 'ws';
import { startSync } from '../src/sync.js';
import { MockArcusClient } from '../src/arcus/client.js';
import { Features } from '../src/config.js';
import { FakeMqtt, testConfig, quietConsole } from './helpers.js';

const HA_IMAGE = process.env.HA_IMAGE || 'ghcr.io/home-assistant/home-assistant:2026.10.4';
const MOSQUITTO_IMAGE = 'eclipse-mosquitto:2';
const ALL_FEATURES = Object.values(Features);
const LOG_DIR = 'build-test/ha-logs';

/** The two places: the default one, and a second with its own prefix, as in the README's "More than one hub" */
const PLACES: Array<{ prefix: string; env: Record<string, string> }> = [
  { prefix: 'arcus', env: {} },
  { prefix: 'arcus_second', env: { DEVICE_ID_PREFIX: 'arcus_second', ARCUS_MOCK_PLACE: 'second' } },
];

const CONFIGURATION = `
homeassistant:
  name: Arcus MQTT test
  unit_system: metric
  time_zone: UTC
  country: US
  currency: USD
  latitude: 0
  longitude: 0
  elevation: 0
http:
api:
config:
onboarding:
system_log:
websocket_api:
`;

const run = `arcus-ha-${process.pid}`;
const names = { network: run, mosquitto: `${run}-mosquitto`, ha: `${run}-ha` };
const containers: string[] = [];

const exec = promisify(execFile);

async function docker(...args: string[]): Promise<string> {
  const { stdout } = await exec('docker', args, { maxBuffer: 64 * 1024 * 1024 });
  return stdout.trim();
}

/** Progress on stderr: the app's console logging is silenced, and the test reporter buffers */
function log(message: string): void {
  process.stderr.write(`[ha-test] ${message}\n`);
}

async function waitFor(condition: () => Promise<boolean>, timeoutMs: number, label: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await condition().catch(() => false))) {
    if (Date.now() > deadline) throw new Error(`Timed out after ${timeoutMs / 1000}s waiting for ${label}`);
    await new Promise(r => setTimeout(r, 500));
  }
}

/** Wait until a value stops changing for a while */
async function settle<T>(read: () => Promise<T>, quietMs: number, timeoutMs: number, label: string): Promise<T> {
  let last = JSON.stringify(await read());
  let since = Date.now();
  await waitFor(async () => {
    const now = JSON.stringify(await read());
    if (now !== last) {
      last = now;
      since = Date.now();
    }
    return Date.now() - since >= quietMs;
  }, timeoutMs, label);
  return JSON.parse(last) as T;
}

/** The release users upgrade from: the newest tag before HEAD */
async function previousImage(): Promise<string | undefined> {
  if (process.env.PREVIOUS_IMAGE !== undefined) return process.env.PREVIOUS_IMAGE || undefined;
  const { stdout } = await exec('git', ['describe', '--tags', '--abbrev=0', 'HEAD^']);
  return `ghcr.io/wl-net/arcus-mqtt-server:${stdout.trim().replace(/^v/, '')}`;
}

async function startBridge(name: string, image: string, env: Record<string, string>): Promise<void> {
  const vars = { ARCUS_MOCK: '1', MQTT_URL: `mqtt://${names.mosquitto}:1883`, FEATURES: ALL_FEATURES.join(','), ...env };
  containers.push(name);
  await docker('run', '-d', '--name', name, '--network', names.network,
    ...Object.entries(vars).flatMap(([key, value]) => ['-e', `${key}=${value}`]), image);
  await waitFor(async () => {
    const { stdout, stderr } = await exec('docker', ['logs', name]);
    if (stdout.includes('Bridge is running')) return true;
    if (await docker('inspect', '-f', '{{.State.Running}}', name) !== 'true') {
      throw new Error(`${name} exited:\n${stdout}${stderr}`);
    }
    return false;
  }, 60_000, `${name} to sync`);
}

/** What a fresh install of this tree publishes for a place: retained topic → payload */
async function freshInstall(prefix: string, env: Record<string, string>): Promise<Map<string, string>> {
  const broker = new FakeMqtt();
  const config = testConfig({ arcusMock: true, deviceIdPrefix: prefix, features: new Set(ALL_FEATURES) });
  const sync = await startSync(broker, config, new MockArcusClient(env.ARCUS_MOCK_PLACE));
  sync.stop();
  return broker.retained;
}

/** Everything the broker holds as retained */
async function retainedOnBroker(url: string): Promise<Map<string, string>> {
  const client = await connectAsync(url);
  const retained = new Map<string, string>();
  let lastMessage = Date.now();
  client.on('message', (topic, payload, packet) => {
    if (!packet.retain) return;
    retained.set(topic, payload.toString());
    lastMessage = Date.now();
  });
  await client.subscribeAsync('#');
  await waitFor(async () => Date.now() - lastMessage > 1000, 15_000, 'retained messages');
  await client.endAsync();
  return retained;
}

/** Home Assistant's WebSocket API */
class HaSocket {
  private nextId = 1;
  private readonly pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

  private constructor(private readonly ws: WebSocket) {
    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString()) as { id?: number; type: string; success?: boolean; result?: unknown; error?: unknown };
      const call = msg.id === undefined ? undefined : this.pending.get(msg.id);
      if (!call || msg.type !== 'result') return;
      this.pending.delete(msg.id!);
      if (msg.success) call.resolve(msg.result);
      else call.reject(new Error(JSON.stringify(msg.error)));
    });
  }

  static async connect(url: string, token: string): Promise<HaSocket> {
    const ws = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      ws.on('error', reject);
      ws.on('message', function onAuth(data) {
        const msg = JSON.parse(data.toString()) as { type: string };
        if (msg.type === 'auth_required') ws.send(JSON.stringify({ type: 'auth', access_token: token }));
        else if (msg.type === 'auth_ok') {
          ws.off('message', onAuth);
          resolve();
        } else reject(new Error(`WebSocket auth failed: ${data.toString()}`));
      });
    });
    return new HaSocket(ws);
  }

  call<T>(type: string, extra: Record<string, unknown> = {}): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.ws.send(JSON.stringify({ id, type, ...extra }));
    });
  }

  close(): void {
    this.ws.close();
  }
}

interface RegistryEntry { entity_id: string; platform: string; unique_id: string }
interface LogEntry { name: string; message: string[]; level: string; source: [string, number]; count: number }
interface HaState { entity_id: string; state: string }

describe('Home Assistant', { skip: !process.env.TEST_HA, timeout: 20 * 60_000 }, () => {
  let haUrl = '';
  let brokerUrl = '';
  let socket: HaSocket;
  /** After the upgrade: what HA and the broker hold, and what a fresh install would */
  let registry: RegistryEntry[] = [];
  let logEntries: LogEntry[] = [];
  let states: HaState[] = [];
  let onBroker = new Map<string, string>();
  const expected = new Map<string, string>();

  const mqttEntities = async () =>
    (await socket.call<RegistryEntry[]>('config/entity_registry/list')).filter(e => e.platform === 'mqtt');

  async function post<T>(path: string, body: unknown, token?: string): Promise<T> {
    const res = await fetch(`${haUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`POST ${path}: ${res.status} ${await res.text()}`);
    return res.json() as Promise<T>;
  }

  before(async () => {
    quietConsole();

    const bridgeImage = process.env.BRIDGE_IMAGE ?? 'arcus-mqtt-server:ha-test';
    if (!process.env.BRIDGE_IMAGE) {
      log('Building the bridge image');
      await docker('build', '-q', '-t', bridgeImage, '.');
    }
    const previous = await previousImage();

    await docker('network', 'create', names.network);
    containers.push(names.mosquitto, names.ha);
    await docker('run', '-d', '--name', names.mosquitto, '--network', names.network, '-p', '127.0.0.1::1883',
      '-v', `${process.cwd()}/mosquitto/mosquitto.conf:/mosquitto/config/mosquitto.conf:ro`, MOSQUITTO_IMAGE);
    brokerUrl = `mqtt://${(await docker('port', names.mosquitto, '1883/tcp')).split('\n')[0]}`;

    log(`Starting ${HA_IMAGE}`);
    await docker('create', '--name', names.ha, '--network', names.network, '-p', '127.0.0.1::8123', HA_IMAGE);
    const dir = mkdtempSync(join(tmpdir(), 'arcus-ha-'));
    writeFileSync(join(dir, 'configuration.yaml'), CONFIGURATION);
    await docker('cp', join(dir, 'configuration.yaml'), `${names.ha}:/config/configuration.yaml`);
    await docker('start', names.ha);
    haUrl = `http://${(await docker('port', names.ha, '8123/tcp')).split('\n')[0]}`;
    await waitFor(async () => (await fetch(`${haUrl}/api/onboarding`)).ok, 300_000, 'Home Assistant to start');

    // Onboarding creates the owner and hands back an auth code for a token
    const clientId = `${haUrl}/`;
    const { auth_code } = await post<{ auth_code: string }>('/api/onboarding/users',
      { client_id: clientId, name: 'Test', username: 'test', password: 'test-password', language: 'en' });
    const tokenRes = await fetch(`${haUrl}/auth/token`, {
      method: 'POST',
      body: new URLSearchParams({ grant_type: 'authorization_code', code: auth_code, client_id: clientId }),
    });
    const { access_token: token } = await tokenRes.json() as { access_token: string };

    // The MQTT integration, through the same config flow as Settings → Devices & services
    const flow = await post<{ flow_id: string; step_id: string }>('/api/config/config_entries/flow',
      { handler: 'mqtt', show_advanced_options: true }, token);
    const entry = await post<{ type: string }>(`/api/config/config_entries/flow/${flow.flow_id}`, {
      broker: names.mosquitto, port: 1883, protocol: '5',
      other_settings: { set_client_cert: false, set_ca_cert: 'off', transport: 'tcp' },
    }, token);
    assert.equal(entry.type, 'create_entry', `MQTT setup: ${JSON.stringify(entry)}`);
    socket = await HaSocket.connect(`${haUrl.replace('http', 'ws')}/api/websocket`, token);

    // The release users have now, which this tree must clean up after
    if (previous) {
      log(`Running ${previous}`);
      await startBridge(`${run}-previous`, previous, PLACES[0].env);
      await settle(mqttEntities, 5000, 120_000, `entities from ${previous}`);
      await docker('stop', `${run}-previous`);
    } else {
      log('No previous release to upgrade from');
    }
    await socket.call('call_service', { domain: 'system_log', service: 'clear' });

    log(`Running ${bridgeImage} for ${PLACES.length} places`);
    for (const place of PLACES) {
      for (const [topic, payload] of await freshInstall(place.prefix, place.env)) expected.set(topic, payload);
    }
    for (const [i, place] of PLACES.entries()) await startBridge(`${run}-bridge-${i}`, bridgeImage, place.env);
    registry = await settle(mqttEntities, 5000, 120_000, 'entities after the upgrade');

    logEntries = await socket.call<LogEntry[]>('system_log/list');
    states = await socket.call<HaState[]>('get_states');
    onBroker = await retainedOnBroker(brokerUrl);
  });

  after(async () => {
    socket?.close();
    mkdirSync(LOG_DIR, { recursive: true });
    for (const name of containers) {
      const logs = await exec('docker', ['logs', name], { maxBuffer: 64 * 1024 * 1024 }).catch(() => undefined);
      if (logs) writeFileSync(join(LOG_DIR, `${name.replace(`${run}-`, '')}.log`), logs.stdout + logs.stderr);
    }
    if (process.env.HA_KEEP) {
      log(`Left running: ${haUrl} (user test / test-password), broker ${brokerUrl}`);
      return;
    }
    for (const name of containers) await docker('rm', '-f', name).catch(() => undefined);
    await docker('network', 'rm', names.network).catch(() => undefined);
  });

  it('logs no warnings or errors', () => {
    const lines = logEntries.map(e => `${e.level} ${e.name} (${e.count}x): ${e.message.join(' | ')}`);
    assert.deepEqual(lines, []);
  });

  it('has an entity for every config the bridges publish, and no others', () => {
    const published = [...expected.entries()]
      .filter(([topic, payload]) => topic.startsWith('homeassistant/') && payload !== '')
      .map(([, payload]) => (JSON.parse(payload) as { unique_id?: string }).unique_id)
      .filter((id): id is string => id !== undefined);
    const inHa = new Set(registry.map(e => e.unique_id));
    assert.deepEqual(published.filter(id => !inHa.has(id)), [], 'published, but not in HA');
    assert.deepEqual(registry.filter(e => !published.includes(e.unique_id)).map(e => e.entity_id), [], 'in HA, but not published');
  });

  it('leaves exactly what a fresh install would on the broker', () => {
    const topics = (map: Map<string, string>) => [...map.keys()].filter(t => !t.startsWith('homeassistant/status'));
    assert.deepEqual(topics(onBroker).filter(t => !expected.has(t)).sort(), [], 'left over from before the upgrade');
    assert.deepEqual(topics(expected).filter(t => !onBroker.has(t)).sort(), [], 'missing from the broker');
    const stale = [...expected].filter(([topic, payload]) => topic.startsWith('homeassistant/') && onBroker.get(topic) !== payload);
    assert.deepEqual(stale.map(([topic]) => topic), [], 'discovery configs that differ from a fresh install');
  });

  it('shows every entity as available', () => {
    const byId = new Map(states.map(s => [s.entity_id, s.state]));
    const unavailable = registry.filter(e => byId.get(e.entity_id) === 'unavailable').map(e => e.entity_id);
    assert.deepEqual(unavailable, []);
  });

  // Mock devices report every value, except the unreported-* ones, so any other unknown
  // entity means HA isn't reading its state
  it('shows a state for every entity that has one', () => {
    const stateless = new Set(['button', 'scene', 'event']);
    const byId = new Map(states.map(s => [s.entity_id, s.state]));
    const unknown = registry
      .filter(e => byId.get(e.entity_id) === 'unknown' && !stateless.has(e.entity_id.split('.')[0]))
      .filter(e => !e.unique_id.includes('unreported-'))
      .map(e => e.entity_id);
    assert.deepEqual(unknown, []);
  });
});
