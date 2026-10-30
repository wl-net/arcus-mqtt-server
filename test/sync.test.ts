import { describe, it, before, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { startSync } from '../src/sync.js';
import type { ArcusClient } from '../src/arcus/client.js';
import type { ArcusDevice, ArcusAttributes, ArcusMethodCall, AlarmState, PersonInfo, SceneInfo } from '../src/arcus/types.js';
import type { Config } from '../src/config.js';
import { FakeMqtt, makeDevice, testConfig, until, quietConsole } from './helpers.js';

/** A scriptable ArcusClient: tests change what it returns and fire its events */
class FakeClient implements ArcusClient {
  devices: ArcusDevice[] = [];
  hub: ArcusDevice | null = null;
  scenes: SceneInfo[] = [];
  people: PersonInfo[] = [];
  alarm: AlarmState = { securityMode: 'DISARMED', alarmMode: 'ON', bypassedDevices: [] };
  listDevicesCalls = 0;
  listDevicesDelayMs = 0;
  failListDevices = false;
  private deviceHandlers: Array<(address: string, attributes: ArcusAttributes) => void> = [];
  private connectionHandlers: Array<(connected: boolean) => void> = [];
  private deviceListHandlers: Array<() => void> = [];

  async connect(): Promise<void> {}
  disconnect(): void {}
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
  onDeviceListChange(handler: () => void): void {
    this.deviceListHandlers.push(handler);
  }
  async getAlarmState(): Promise<AlarmState> {
    return { ...this.alarm };
  }
  /** Arm modes and 'DISARM', in the order they were sent */
  readonly alarmCommands: string[] = [];
  async armAlarm(mode: 'ON' | 'PARTIAL'): Promise<void> {
    this.alarmCommands.push(mode);
  }
  async disarmAlarm(): Promise<void> {
    this.alarmCommands.push('DISARM');
  }
  onAlarmEvent(): void {}
  async listScenes(): Promise<SceneInfo[]> {
    return this.scenes;
  }
  async listPersons(): Promise<PersonInfo[]> {
    return this.people;
  }
  onSceneEvent(): void {}
  async fireScene(): Promise<void> {}

  emitDevice(address: string, attributes: ArcusAttributes): void {
    for (const h of this.deviceHandlers) h(address, attributes);
  }
  emitConnection(connected: boolean): void {
    for (const h of this.connectionHandlers) h(connected);
  }
  emitDeviceListChange(): void {
    for (const h of this.deviceListHandlers) h();
  }
}

const contact = () => makeDevice('DRIV:dev:door-1', ['dev', 'devadv', 'devconn', 'cont'], {
  'cont:contact': 'CLOSED', 'devconn:state': 'ONLINE', 'devadv:protocol': 'ZIGB',
}, 'Front Door');
const lock = () => makeDevice('DRIV:dev:lock-1', ['dev', 'devconn', 'doorlock'], {
  'doorlock:lockstate': 'LOCKED', 'devconn:state': 'ONLINE',
}, 'Front Lock');
const hub = () => makeDevice('SERV:LWW-1:hub', ['base', 'hub', 'hubconn', 'hubpow'], {
  'hubconn:state': 'ONLINE', 'hubpow:source': 'MAINS',
}, 'Hub');

describe('sync', () => {
  let stop: (() => void) | undefined;
  before(quietConsole);
  afterEach(() => stop?.());

  async function start(setup: (client: FakeClient) => void = () => {}, overrides: Partial<Config> = {}) {
    const broker = new FakeMqtt();
    const client = new FakeClient();
    client.devices = [contact(), lock()];
    setup(client);
    const sync = await startSync(broker, testConfig(overrides), client);
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

  it('syncs as soon as a device is added or removed in Arcus', async () => {
    const { broker, client } = await start();
    const lockConfig = 'homeassistant/lock/arcus/lock-1_lock/config';
    const motion = makeDevice('DRIV:dev:motion-1', ['dev', 'devconn', 'mot'], { 'mot:motion': 'NONE', 'devconn:state': 'ONLINE' });
    const motionConfig = 'homeassistant/binary_sensor/arcus/motion-1_motion/config';

    client.devices = [contact(), motion];
    client.emitDeviceListChange();
    await until(() => broker.retained.has(motionConfig) && !broker.retained.has(lockConfig), 3000, 'the sync');
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

  it('adds and removes lock PINs through access switches, with the lock_access feature', async () => {
    const { broker, client } = await start(
      c => { c.people = [{ id: '0000000a-0000-4000-8000-000000000001', name: 'Pat Example', hasPin: true }]; },
      { features: new Set(['lock_access']) },
    );
    assert.ok(broker.retained.get('homeassistant/switch/arcus/lock-1_access_0000000a-0000-4000-8000-000000000001/config'));
    assert.deepEqual(broker.json('arcus/lock-1/state').access, []);

    broker.deliver('arcus/lock-1/access_0000000a-0000-4000-8000-000000000001/set', 'ON');
    assert.deepEqual(client.methodCalls, [
      { address: 'DRIV:dev:lock-1', call: { method: 'doorlock:AuthorizePerson', args: { personId: '0000000a-0000-4000-8000-000000000001' } } },
    ]);

    // The driver records the slot, which turns the switch on
    client.emitDevice('DRIV:dev:lock-1', { 'doorlock:slots': { '1': '0000000a-0000-4000-8000-000000000001' } });
    assert.deepEqual(broker.json('arcus/lock-1/state').access, ['0000000a-0000-4000-8000-000000000001']);
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

      client.emitDevice('SERV:LWW-1:hub', { 'hubconn:state': 'OFFLINE' });
      assert.equal(broker.retained.get('arcus/LWW-1/connection'), 'offline');
      assert.equal(broker.json('arcus/LWW-1/state').connectivity, 'OFF');
    });
  });

  it('clears what older versions left on the broker once, not on every sync', async () => {
    const leftovers = [
      'homeassistant/sensor/arcus/plug-1_energy/config',
      'homeassistant/binary_sensor/arcus/hub_connectivity/config',
      'arcus/hub/state',
    ];
    const broker = new FakeMqtt();
    for (const topic of leftovers) broker.publish(topic, '{}', true);
    const client = new FakeClient();
    client.hub = hub();
    client.devices = [makeDevice('DRIV:dev:plug-1', ['dev', 'pow'], { 'pow:instantaneous': 5 }, 'Plug')];
    stop = (await startSync(broker, testConfig(), client)).stop;

    for (const topic of leftovers) assert.ok(!broker.retained.has(topic), `${topic} is still retained`);
    assert.ok(broker.retained.has('homeassistant/sensor/arcus/plug-1_power/config'));

    const mark = broker.published.length;
    await resync(broker, client);
    assert.deepEqual(broker.since(mark).filter(p => leftovers.includes(p.topic)), []);

    // A broker that comes back with older retained messages gets them cleared again
    for (const topic of leftovers) broker.publish(topic, '{}', true);
    const calls = client.listDevicesCalls;
    broker.reconnect();
    await until(() => client.listDevicesCalls > calls && leftovers.every(t => !broker.retained.has(t)), 3000, 'resync after reconnect');
  });

  it('adds an entity as soon as its first value arrives, not at the next poll', async () => {
    const { broker, client } = await start((c) => {
      c.devices = [makeDevice('DRIV:dev:plug-1', ['dev', 'pow'], { 'pow:instantaneous': 5 }, 'Plug')];
    });
    assert.ok(!broker.retained.has('homeassistant/sensor/arcus/plug-1_energy/config'));

    client.emitDevice('DRIV:dev:plug-1', { 'pow:cumulative': 1200 });
    assert.ok(broker.retained.has('homeassistant/sensor/arcus/plug-1_energy/config'));
    assert.equal(broker.json('arcus/plug-1/state').energy, 1200);
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

  describe('device ID prefix', () => {
    it('keeps the alarm on arcus/alarm/... by default', async () => {
      const { broker } = await start();
      const panel = broker.json('homeassistant/alarm_control_panel/arcus/alarm/config');
      assert.equal(panel.state_topic, 'arcus/alarm/state');
      assert.equal(panel.command_topic, 'arcus/alarm/set');
      assert.equal(panel.json_attributes_topic, 'arcus/alarm/attributes');
      assert.deepEqual((panel.availability as Array<{ topic: string }>).map(a => a.topic),
        ['arcus/bridge/availability', 'arcus/alarm/availability']);
    });

    it('keeps two places on one broker apart, including their alarms', async () => {
      // Two bridges, each with its own broker connection, as two containers would run
      const scene = (place: string) => ({ address: `SERV:scene:${place}.1`, id: `${place}.1`, name: 'Night', enabled: true });
      const house = new FakeClient();
      house.devices = [contact()];
      house.hub = hub();
      house.scenes = [scene('place-a')];
      const barn = new FakeClient();
      barn.devices = [lock()];
      barn.hub = makeDevice('SERV:LWW-2:hub', ['base', 'hub', 'hubconn'], { 'hubconn:state': 'ONLINE' }, 'Barn Hub');
      barn.scenes = [scene('place-b')];
      barn.alarm = { securityMode: 'ARMED', alarmMode: 'ON', bypassedDevices: [] };

      const houseBroker = new FakeMqtt();
      const barnBroker = new FakeMqtt();
      const syncs = [
        await startSync(houseBroker, testConfig(), house),
        await startSync(barnBroker, testConfig({ deviceIdPrefix: 'barn' }), barn),
      ];
      stop = () => syncs.forEach(s => s.stop());

      const houseTopics = new Set(houseBroker.published.map(p => p.topic));
      assert.deepEqual(barnBroker.published.map(p => p.topic).filter(t => houseTopics.has(t)), []);
      // HA ignores an entity whose unique_id another has already taken, even from another topic
      const uniqueIds = (broker: FakeMqtt) => [...broker.retained]
        .filter(([topic]) => topic.startsWith('homeassistant/'))
        .map(([, payload]) => (JSON.parse(payload) as { unique_id?: string }).unique_id)
        .filter(id => id !== undefined);
      const houseIds = new Set(uniqueIds(houseBroker));
      assert.deepEqual(uniqueIds(barnBroker).filter(id => houseIds.has(id)), []);
      assert.equal(houseBroker.retained.get('arcus/alarm/state'), 'disarmed');
      assert.equal(barnBroker.retained.get('barn/alarm/state'), 'armed_away');

      // HA disarming the barn: the broker delivers it to both connections
      for (const broker of [houseBroker, barnBroker]) broker.deliver('barn/alarm/set', 'DISARM');
      assert.deepEqual(barn.alarmCommands, ['DISARM']);
      assert.deepEqual(house.alarmCommands, []);
    });
  });
});
