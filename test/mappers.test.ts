import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { binarySensorMapper } from '../src/mappers/binary-sensor.js';
import { sensorMapper } from '../src/mappers/sensor.js';
import { lockMapper } from '../src/mappers/lock.js';
import { hubMapper } from '../src/mappers/hub.js';
import { climateMapper } from '../src/mappers/climate.js';
import { valveMapper } from '../src/mappers/valve.js';
import { shadeMapper } from '../src/mappers/shade.js';
import { lightMapper } from '../src/mappers/light.js';
import { ventMapper } from '../src/mappers/vent.js';
import { irrigationMapper } from '../src/mappers/irrigation.js';
import { deviceTriggerMapper } from '../src/mappers/device-trigger.js';
import { sirenMapper } from '../src/mappers/siren.js';
import { publishLockAccessDiscovery } from '../src/ha/lock-access.js';
import { Features } from '../src/config.js';
import { matchingMappers } from '../src/mappers/index.js';
import type { Mapper } from '../src/mappers/index.js';
import type { ArcusAttributes } from '../src/arcus/types.js';
import { FakeMqtt, makeDevice, testConfig } from './helpers.js';

const config = testConfig();

function discoveryById(mapper: Mapper, device: ReturnType<typeof makeDevice>): Map<string, Record<string, unknown>> {
  return new Map(mapper.buildDiscovery(config, device).map(d => [String(d.payload.object_id), d.payload]));
}

describe('binary sensor mapper', () => {
  const cases: Array<{ cap: string; attr: string; on: string; off: string; key: string; deviceClass: string }> = [
    { cap: 'leakh2o', attr: 'leakh2o:state', on: 'LEAK', off: 'SAFE', key: 'leak', deviceClass: 'moisture' },
    { cap: 'smoke', attr: 'smoke:smoke', on: 'DETECTED', off: 'SAFE', key: 'smoke', deviceClass: 'smoke' },
    { cap: 'co', attr: 'co:co', on: 'DETECTED', off: 'SAFE', key: 'co', deviceClass: 'carbon_monoxide' },
    { cap: 'glass', attr: 'glass:break', on: 'DETECTED', off: 'SAFE', key: 'glass', deviceClass: 'safety' },
    // Tilt sensors sit on garage door panels: flat means the door is open
    { cap: 'tilt', attr: 'tilt:tiltstate', on: 'FLAT', off: 'UPRIGHT', key: 'tilt', deviceClass: 'garage_door' },
    // Key fobs
    { cap: 'pres', attr: 'pres:presence', on: 'PRESENT', off: 'ABSENT', key: 'presence', deviceClass: 'presence' },
  ];

  for (const c of cases) {
    it(`maps ${c.cap} to a ${c.deviceClass} binary sensor`, () => {
      const device = makeDevice('DRIV:dev:s1', [c.cap], { [c.attr]: c.off });
      const [disc] = binarySensorMapper.buildDiscovery(config, device);
      assert.equal(disc.payload.device_class, c.deviceClass);
      assert.equal(disc.payload.value_template, `{{ value_json.${c.key} }}`);

      assert.deepEqual(binarySensorMapper.buildState(config, device), { [c.key]: 'OFF' });
      device.attributes[c.attr] = c.on;
      assert.deepEqual(binarySensorMapper.buildState(config, device), { [c.key]: 'ON' });
    });
  }

  it('gives a combo smoke/CO detector both sensors', () => {
    const device = makeDevice('DRIV:dev:s1', ['smoke', 'co'], { 'smoke:smoke': 'SAFE', 'co:co': 'DETECTED' });
    assert.equal(binarySensorMapper.buildDiscovery(config, device).length, 2);
    assert.deepEqual(binarySensorMapper.buildState(config, device), { smoke: 'OFF', co: 'ON' });
  });

  it('uses the window device class for contact sensors hinted as windows', () => {
    const device = makeDevice('DRIV:dev:c1', ['cont'], { 'cont:contact': 'OPENED', 'cont:usehint': 'WINDOW' });
    assert.equal(binarySensorMapper.buildDiscovery(config, device)[0].payload.device_class, 'window');
  });
});

describe('sensor mapper', () => {
  it('maps power use to power (W) and energy (Wh, total_increasing) sensors', () => {
    const device = makeDevice('DRIV:dev:p1', ['pow'], { 'pow:instantaneous': 42, 'pow:cumulative': 12450 });
    const disc = discoveryById(sensorMapper, device);
    assert.equal(disc.get('p1_power')?.unit_of_measurement, 'W');
    assert.equal(disc.get('p1_energy')?.unit_of_measurement, 'Wh');
    assert.equal(disc.get('p1_energy')?.state_class, 'total_increasing');
    assert.deepEqual(sensorMapper.buildState(config, device), { power: 42, energy: 12450 });
  });

  it('skips sensors whose attribute the driver never reports', () => {
    const device = makeDevice('DRIV:dev:p2', ['pow'], { 'pow:instantaneous': 42 });
    assert.deepEqual([...discoveryById(sensorMapper, device).keys()], ['p2_power']);
    assert.deepEqual(sensorMapper.buildState(config, device), { power: 42 });
    assert.equal(sensorMapper.matches(makeDevice('DRIV:dev:p3', ['pow'], {})), false);
  });

  it('only adds a battery sensor for battery-powered devices', () => {
    const mains = makeDevice('DRIV:dev:b1', ['devpow'], { 'devpow:source': 'LINE', 'devpow:battery': 100 });
    const battery = makeDevice('DRIV:dev:b2', ['devpow'], { 'devpow:source': 'BATTERY', 'devpow:battery': 80 });
    assert.equal(sensorMapper.matches(mains), false);
    assert.equal(sensorMapper.matches(battery), true);
  });
});

describe('lock mapper', () => {
  it('declares all four Arcus lock states and passes them through', () => {
    const device = makeDevice('DRIV:dev:l1', ['doorlock'], { 'doorlock:lockstate': 'LOCKED' });
    const [disc] = lockMapper.buildDiscovery(config, device);
    assert.equal(disc.payload.state_locking, 'LOCKING');
    assert.equal(disc.payload.state_unlocking, 'UNLOCKING');

    device.attributes['doorlock:lockstate'] = 'UNLOCKING';
    assert.deepEqual(lockMapper.buildState(config, device), { lock: 'UNLOCKING' });
  });

  it('reports a jam while Arcus has WARN_JAM, whatever the lockstate', () => {
    const device = makeDevice('DRIV:dev:l1', ['doorlock', 'devadv'], {
      'doorlock:lockstate': 'LOCKING',
      'devadv:errors': { WARN_JAM: 'Door lock may be jammed' },
    });
    const [disc] = lockMapper.buildDiscovery(config, device);
    assert.equal(disc.payload.state_jammed, 'JAMMED');
    assert.deepEqual(lockMapper.buildState(config, device), { lock: 'JAMMED' });

    // An autolock jam leaves the lock UNLOCKED but still jammed
    device.attributes['doorlock:lockstate'] = 'UNLOCKED';
    assert.deepEqual(lockMapper.buildState(config, device), { lock: 'JAMMED' });

    // The driver clears the error once the lock reports a final state
    Object.assign(device.attributes, { 'doorlock:lockstate': 'LOCKED', 'devadv:errors': {} });
    assert.deepEqual(lockMapper.buildState(config, device), { lock: 'LOCKED' });
  });

  describe('buzz in (buzz_in feature)', () => {
    const buzzIn = testConfig({ features: new Set([Features.BUZZ_IN]) });
    const buzzable = () =>
      makeDevice('DRIV:dev:l1', ['doorlock'], { 'doorlock:lockstate': 'LOCKED', 'doorlock:supportsBuzzIn': true });

    it('adds a buzz-in button only for locks that support it', () => {
      const plain = makeDevice('DRIV:dev:l1', ['doorlock'], { 'doorlock:lockstate': 'LOCKED' });
      assert.equal(new Map(lockMapper.buildDiscovery(buzzIn, plain).map(d => [d.payload.object_id, d])).has('l1_buzz_in'), false);
      assert.equal(lockMapper.handleMethodCommand?.(buzzIn, plain, 'buzz_in', 'PRESS'), null);

      const disc = lockMapper.buildDiscovery(buzzIn, buzzable()).find(d => d.payload.object_id === 'l1_buzz_in');
      assert.equal(disc?.payload.command_topic, 'arcus/l1/buzz_in/set');
      assert.deepEqual(lockMapper.handleMethodCommand?.(buzzIn, buzzable(), 'buzz_in', 'PRESS'), { method: 'doorlock:BuzzIn', args: {} });
      assert.equal(lockMapper.handleMethodCommand?.(buzzIn, buzzable(), 'lock', 'UNLOCK'), null);
    });

    it('offers nothing with the feature off', () => {
      assert.equal(discoveryById(lockMapper, buzzable()).has('l1_buzz_in'), false);
      assert.equal(lockMapper.handleMethodCommand?.(config, buzzable(), 'buzz_in', 'PRESS'), null);
    });
  });

  describe('access (lock_access feature)', () => {
    const access = testConfig({ features: new Set([Features.LOCK_ACCESS]) });
    const withSlots = (slots: Record<string, string>) =>
      makeDevice('DRIV:dev:l1', ['doorlock'], { 'doorlock:lockstate': 'LOCKED', 'doorlock:slots': slots });
    const cmd = (cfg: typeof config, slots: Record<string, string>, entity: string, payload: string) =>
      lockMapper.handleMethodCommand?.(cfg, withSlots(slots), entity, payload);

    it('reports who has a PIN on the lock', () => {
      assert.deepEqual(lockMapper.buildState(access, withSlots({ '2': '0000000a-0000-4000-8000-000000000002', '1': '0000000a-0000-4000-8000-000000000001' })).access, ['0000000a-0000-4000-8000-000000000001', '0000000a-0000-4000-8000-000000000002']);
      assert.deepEqual(lockMapper.buildState(access, withSlots({})).access, []);
      assert.equal('access' in lockMapper.buildState(config, withSlots({ '1': '0000000a-0000-4000-8000-000000000001' })), false);
    });

    it('adds and removes a PIN', () => {
      assert.deepEqual(cmd(access, {}, 'access_0000000a-0000-4000-8000-000000000001', 'ON'),
        { method: 'doorlock:AuthorizePerson', args: { personId: '0000000a-0000-4000-8000-000000000001' } });
      assert.deepEqual(cmd(access, { '1': '0000000a-0000-4000-8000-000000000001' }, 'access_0000000a-0000-4000-8000-000000000001', 'OFF'),
        { method: 'doorlock:DeauthorizePerson', args: { personId: '0000000a-0000-4000-8000-000000000001' } });
    });

    it("ignores removing someone who isn't on the lock, bad payloads, and everything with the feature off", () => {
      assert.equal(cmd(access, {}, 'access_0000000a-0000-4000-8000-000000000001', 'OFF'), null);
      assert.equal(cmd(access, {}, 'access_0000000a-0000-4000-8000-000000000001', 'TOGGLE'), null);
      assert.equal(cmd(access, {}, 'access_not/an/id', 'ON'), null);
      assert.equal(cmd(config, {}, 'access_0000000a-0000-4000-8000-000000000001', 'ON'), null);
    });
  });

  it('translates lock commands', () => {
    const device = makeDevice('DRIV:dev:l1', ['doorlock']);
    assert.deepEqual(lockMapper.handleCommand(config, device, 'lock', 'UNLOCK'), { 'doorlock:lockstate': 'UNLOCKED' });
    assert.equal(lockMapper.handleCommand(config, device, 'lock', 'BOGUS'), null);
  });
});

describe('hub mapper', () => {
  const hub = (attrs: ArcusAttributes) =>
    makeDevice('SERV:hub:LWW-1', ['base', 'hub', 'hubconn', 'hubpow'], attrs, 'Hub');

  it('reports connectivity, mains power and battery', () => {
    const device = hub({ 'hubconn:state': 'ONLINE', 'hubpow:source': 'MAINS', 'hubpow:Battery': 90 });
    assert.deepEqual(hubMapper.buildState(config, device), { connectivity: 'ON', mains_power: 'ON', battery: 90 });
  });

  it('shows a power cut as mains power off', () => {
    const device = hub({ 'hubconn:state': 'OFFLINE', 'hubpow:source': 'BATTERY' });
    assert.deepEqual(hubMapper.buildState(config, device), { connectivity: 'OFF', mains_power: 'OFF' });
  });

  it('does not tie hub entities to the hub connection topic', () => {
    const device = hub({ 'hubconn:state': 'ONLINE' });
    for (const disc of hubMapper.buildDiscovery(config, device)) {
      const topics = (disc.payload.availability as Array<{ topic: string }>).map(a => a.topic);
      assert.ok(!topics.some(t => t.endsWith('/connection')), `${disc.topic} depends on the hub connection`);
    }
  });
});

describe('climate mapper', () => {
  const thermostat = (attrs: ArcusAttributes) => makeDevice('DRIV:dev:t1', ['therm', 'temp'], {
    'therm:hvacmode': 'HEAT',
    'therm:heatsetpoint': 20,
    'therm:coolsetpoint': 25,
    'temp:temperature': 19,
    'therm:active': 'RUNNING',
    'therm:fanmode': 0,
    ...attrs,
  });
  const state = (attrs: ArcusAttributes) => climateMapper.buildState(config, thermostat(attrs));

  describe('hvac action (Arcus reports RUNNING/NOTRUNNING)', () => {
    const cases: Array<[string, ArcusAttributes, string]> = [
      ['heat mode, running', {}, 'heating'],
      ['cool mode, running', { 'therm:hvacmode': 'COOL' }, 'cooling'],
      ['not running', { 'therm:active': 'NOTRUNNING' }, 'idle'],
      ['not running, fan on', { 'therm:active': 'NOTRUNNING', 'therm:fanmode': 1 }, 'fan'],
      ['auto mode, nearer the heat setpoint', { 'therm:hvacmode': 'AUTO', 'temp:temperature': 19 }, 'heating'],
      ['auto mode, nearer the cool setpoint', { 'therm:hvacmode': 'AUTO', 'temp:temperature': 26 }, 'cooling'],
      ['off', { 'therm:hvacmode': 'OFF' }, 'off'],
    ];
    for (const [label, attrs, expected] of cases) {
      it(label, () => assert.equal(state(attrs).climate_action, expected));
    }
  });

  it('offers only the modes the thermostat supports', () => {
    const [disc] = climateMapper.buildDiscovery(config, thermostat({ 'therm:supportedmodes': ['OFF', 'HEAT', 'ECO'] }));
    assert.deepEqual(disc.payload.modes, ['off', 'heat']);
    assert.deepEqual(disc.payload.preset_modes, ['eco']);
  });

  it('offers all modes and no eco preset when supported modes are unknown', () => {
    const [disc] = climateMapper.buildDiscovery(config, thermostat({}));
    assert.deepEqual(disc.payload.modes, ['off', 'heat', 'cool', 'heat_cool']);
    assert.equal(disc.payload.preset_modes, undefined);
  });

  it('shows ECO as heat_cool (or heat) with the eco preset', () => {
    const withAuto = ['OFF', 'HEAT', 'COOL', 'AUTO', 'ECO'];
    assert.equal(state({ 'therm:hvacmode': 'ECO', 'therm:supportedmodes': withAuto }).climate_mode, 'heat_cool');
    assert.equal(state({ 'therm:hvacmode': 'ECO', 'therm:supportedmodes': ['OFF', 'HEAT', 'ECO'] }).climate_mode, 'heat');
    assert.equal(state({ 'therm:hvacmode': 'ECO', 'therm:supportedmodes': withAuto }).climate_preset, 'eco');
    assert.equal(state({ 'therm:supportedmodes': withAuto }).climate_preset, 'none');
  });

  it('enters and leaves eco, and ignores "none" when not in eco', () => {
    const modes = ['OFF', 'HEAT', 'COOL', 'AUTO', 'ECO'];
    const cmd = (attrs: ArcusAttributes, payload: string) =>
      climateMapper.handleCommand(config, thermostat({ 'therm:supportedmodes': modes, ...attrs }), 'climate_preset', payload);
    assert.deepEqual(cmd({}, 'eco'), { 'therm:hvacmode': 'ECO' });
    assert.deepEqual(cmd({ 'therm:hvacmode': 'ECO' }, 'none'), { 'therm:hvacmode': 'AUTO' });
    assert.equal(cmd({ 'therm:hvacmode': 'HEAT' }, 'none'), null);
  });

  describe('fan modes', () => {
    it('labels single-speed fans off/on (HomeKit needs an "off" mode)', () => {
      const [disc] = climateMapper.buildDiscovery(config, thermostat({ 'therm:maxfanspeed': 1 }));
      assert.deepEqual(disc.payload.fan_modes, ['off', 'on']);
      assert.equal(state({ 'therm:fanmode': 0 }).climate_fan_mode, 'off');
      assert.equal(state({ 'therm:fanmode': 1 }).climate_fan_mode, 'on');
    });

    it('offers speeds for multi-speed fans', () => {
      const [disc] = climateMapper.buildDiscovery(config, thermostat({ 'therm:maxfanspeed': 3 }));
      assert.deepEqual(disc.payload.fan_modes, ['off', 'low', 'medium', 'high']);
      assert.equal(state({ 'therm:maxfanspeed': 3, 'therm:fanmode': 3 }).climate_fan_mode, 'high');
    });

    it('translates fan commands, still accepting the old "auto" name', () => {
      const device = thermostat({ 'therm:maxfanspeed': 3 });
      const cmd = (payload: string) => climateMapper.handleCommand(config, device, 'climate_fan_mode', payload);
      assert.deepEqual(cmd('off'), { 'therm:fanmode': 0 });
      assert.deepEqual(cmd('high'), { 'therm:fanmode': 3 });
      assert.deepEqual(cmd('auto'), { 'therm:fanmode': 0 });
      assert.equal(cmd('turbo'), null);
    });
  });

  it('shows the thermostat humidity on the climate entity, when it has a humidity sensor', () => {
    const [plain] = climateMapper.buildDiscovery(config, thermostat({}));
    assert.equal('current_humidity_topic' in plain.payload, false);
    assert.equal('climate_current_humidity' in state({}), false);

    const humid = makeDevice('DRIV:dev:t1', ['therm', 'temp', 'humid'], { 'therm:hvacmode': 'HEAT', 'humid:humidity': 46 });
    const [disc] = climateMapper.buildDiscovery(config, humid);
    assert.equal(disc.payload.current_humidity_topic, 'arcus/t1/state');
    assert.equal(disc.payload.current_humidity_template, '{{ value_json.climate_current_humidity }}');
    assert.equal(climateMapper.buildState(config, humid).climate_current_humidity, 46);
  });

  describe('emergency heat', () => {
    it('adds a switch only for thermostats that report emergency heat', () => {
      assert.equal(discoveryById(climateMapper, thermostat({})).has('t1_emergency_heat'), false);
      assert.equal('emergency_heat' in state({}), false);

      const disc = discoveryById(climateMapper, thermostat({ 'therm:emergencyheat': 'OFF' })).get('t1_emergency_heat');
      assert.equal(disc?.command_topic, 'arcus/t1/emergency_heat/set');
      assert.equal(state({ 'therm:emergencyheat': 'OFF' }).emergency_heat, 'OFF');
      assert.equal(state({ 'therm:emergencyheat': 'ON' }).emergency_heat, 'ON');
    });

    it('turns emergency heat on and off', () => {
      const cmd = (attrs: ArcusAttributes, payload: string) =>
        climateMapper.handleCommand(config, thermostat(attrs), 'emergency_heat', payload);
      assert.deepEqual(cmd({ 'therm:emergencyheat': 'OFF' }, 'ON'), { 'therm:emergencyheat': 'ON' });
      assert.deepEqual(cmd({ 'therm:emergencyheat': 'ON' }, 'OFF'), { 'therm:emergencyheat': 'OFF' });
      assert.equal(cmd({ 'therm:emergencyheat': 'OFF' }, 'TOGGLE'), null);
      assert.equal(cmd({}, 'ON'), null);
    });
  });
});

describe('device trigger mapper', () => {
  const withButtons = (address: string, buttons: string[], caps: string[] = []) => ({
    ...makeDevice(address, caps),
    instances: Object.fromEntries(buttons.map(b => [b, ['but']])),
  });
  const triggers = (device: ReturnType<typeof makeDevice>) =>
    deviceTriggerMapper.buildDiscovery(config, device).map(d => [d.payload.subtype, d.payload.payload]);

  it('keeps one trigger for a single-button device', () => {
    const device = makeDevice('DRIV:dev:bt1', ['but'], { 'but:state': 'RELEASED' });
    assert.equal(deviceTriggerMapper.matches(device), true);
    const [disc] = deviceTriggerMapper.buildDiscovery(config, device);
    assert.equal(disc.topic, 'homeassistant/device_automation/arcus/bt1_button_press/config');
    assert.deepEqual(triggers(device), [['button_1', 'PRESSED']]);
  });

  it('gives a multi-button remote a trigger per button, in order', () => {
    const remote = withButtons('DRIV:dev:rm1', ['button10', 'button2', 'button1']);
    assert.equal(deviceTriggerMapper.matches(remote), true);
    assert.deepEqual(triggers(remote), [['button_1', 'button1'], ['button_2', 'button2'], ['button_10', 'button10']]);
    assert.equal(
      deviceTriggerMapper.buildDiscovery(config, remote)[0].topic,
      'homeassistant/device_automation/arcus/rm1_button1_press/config',
    );
  });

  it('names key fob and paddle buttons after their Arcus instances', () => {
    assert.deepEqual(triggers(withButtons('DRIV:dev:fob1', ['home', 'away', 'a', 'b'], ['pres'])),
      [['a', 'a'], ['away', 'away'], ['b', 'b'], ['home', 'home']]);
    assert.deepEqual(triggers(withButtons('DRIV:dev:pd1', ['up', 'down'])), [['down', 'down'], ['up', 'up']]);
  });

  it('ignores instances of other capabilities', () => {
    const strip = { ...makeDevice('DRIV:dev:ps1', ['swit']), instances: { outlet1: ['swit'] } };
    assert.equal(deviceTriggerMapper.matches(strip), false);
  });

  it('publishes the pressed button, not releases or other attributes', () => {
    const mqtt = new FakeMqtt();
    const remote = withButtons('DRIV:dev:rm1', ['button1', 'button2']);
    const event = (attrs: ArcusAttributes) => deviceTriggerMapper.onEvent?.(mqtt, config, remote, attrs);

    event({ 'but:state:button2': 'PRESSED', 'but:statechanged:button2': 1700000000000 });
    event({ 'but:state:button2': 'RELEASED' });
    event({ 'but:state:button9': 'PRESSED' });
    event({ 'but:state': 'PRESSED' });

    assert.deepEqual(mqtt.published, [{ topic: 'arcus/rm1/trigger', payload: 'button2', retain: false }]);
  });

  it('publishes PRESSED for a single-button device', () => {
    const mqtt = new FakeMqtt();
    const button = makeDevice('DRIV:dev:bt1', ['but']);
    deviceTriggerMapper.onEvent?.(mqtt, config, button, { 'but:state': 'PRESSED' });
    assert.deepEqual(mqtt.published, [{ topic: 'arcus/bt1/trigger', payload: 'PRESSED', retain: false }]);
  });
});

describe('valve mapper', () => {
  const valve = (state?: string) => makeDevice('DRIV:dev:v1', ['valv'], state ? { 'valv:valvestate': state } : {});

  it('maps a water valve with Arcus states', () => {
    const [disc] = valveMapper.buildDiscovery(config, valve('OPEN'));
    assert.equal(disc.topic, 'homeassistant/valve/arcus/v1_valve/config');
    assert.equal(disc.payload.device_class, 'water');
    assert.equal(disc.payload.state_closing, 'CLOSING');
    assert.deepEqual(valveMapper.buildState(config, valve('CLOSING')), { valve: 'CLOSING' });
  });

  it('reports obstruction or a missing state as unknown', () => {
    assert.deepEqual(valveMapper.buildState(config, valve('OBSTRUCTION')), { valve: 'None' });
    assert.deepEqual(valveMapper.buildState(config, valve()), { valve: 'None' });
  });

  it('opens and closes', () => {
    assert.deepEqual(valveMapper.handleCommand(config, valve(), 'valve', 'CLOSE'), { 'valv:valvestate': 'CLOSED' });
    assert.deepEqual(valveMapper.handleCommand(config, valve(), 'valve', 'OPEN'), { 'valv:valvestate': 'OPEN' });
    assert.equal(valveMapper.handleCommand(config, valve(), 'valve', 'STOP'), null);
  });
});

describe('shade mapper', () => {
  const shade = makeDevice('DRIV:dev:sh1', ['shade'], { 'shade:level': 60 });
  const cmd = (entity: string, payload: string) => shadeMapper.handleCommand(config, shade, entity, payload);

  it('maps a shade to a positionable cover', () => {
    const [disc] = shadeMapper.buildDiscovery(config, shade);
    assert.equal(disc.topic, 'homeassistant/cover/arcus/sh1_shade/config');
    assert.equal(disc.payload.device_class, 'shade');
    assert.equal(disc.payload.payload_stop, null);
    assert.deepEqual(shadeMapper.buildState(config, shade), { shade_position: 60 });
  });

  it('opens, closes and moves to a position through the level', () => {
    assert.deepEqual(cmd('shade', 'OPEN'), { 'shade:level': 100 });
    assert.deepEqual(cmd('shade', 'CLOSE'), { 'shade:level': 0 });
    assert.deepEqual(cmd('shade_position', '35'), { 'shade:level': 35 });
  });

  it('clamps positions and rejects junk', () => {
    assert.deepEqual(cmd('shade_position', '150'), { 'shade:level': 100 });
    assert.equal(cmd('shade_position', 'abc'), null);
  });
});

describe('light mapper', () => {
  const bulb = (attrs: ArcusAttributes = {}, caps = ['swit', 'dim', 'light', 'color', 'colortemp']) =>
    makeDevice('DRIV:dev:b1', caps, {
      'swit:state': 'ON', 'dim:brightness': 80, 'color:hue': 200, 'color:saturation': 70,
      'colortemp:colortemp': 3000, 'colortemp:mincolortemp': 2000, 'colortemp:maxcolortemp': 6500, ...attrs,
    });
  const cmd = (entity: string, payload: string, device = bulb()) => lightMapper.handleCommand(config, device, entity, payload);

  it('adds color and color temperature controls only for bulbs that have them', () => {
    const [color] = lightMapper.buildDiscovery(config, bulb());
    assert.ok(color.payload.hs_command_topic);
    assert.equal(color.payload.color_temp_kelvin, true);
    assert.equal(color.payload.min_kelvin, 2000);

    const [dimmer] = lightMapper.buildDiscovery(config, bulb({}, ['swit', 'dim']));
    assert.equal(dimmer.payload.hs_command_topic, undefined);
    assert.equal(dimmer.payload.color_temp_command_topic, undefined);
  });

  it('reports only the values for the current color mode', () => {
    const color = lightMapper.buildState(config, bulb({ 'light:colormode': 'COLOR' }));
    assert.equal(color.light_hs, '200,70');
    assert.equal(color.light_color_temp, undefined);

    const temp = lightMapper.buildState(config, bulb({ 'light:colormode': 'COLORTEMP' }));
    assert.equal(temp.light_color_temp, 3000);
    assert.equal(temp.light_hs, undefined);

    const normal = lightMapper.buildState(config, bulb({ 'light:colormode': 'NORMAL' }));
    assert.equal(normal.light_hs, undefined);
    assert.equal(normal.light_color_temp, undefined);
  });

  it('sets color and switches the bulb into color mode', () => {
    assert.deepEqual(cmd('light_hs', '120.4,55.6'), { 'color:hue': 120, 'color:saturation': 56, 'light:colormode': 'COLOR' });
  });

  it('sets color temperature within the bulb range', () => {
    assert.deepEqual(cmd('light_color_temp', '4000'), { 'colortemp:colortemp': 4000, 'light:colormode': 'COLORTEMP' });
    assert.deepEqual(cmd('light_color_temp', '9000'), { 'colortemp:colortemp': 6500, 'light:colormode': 'COLORTEMP' });
  });

  it('rejects malformed color and brightness values', () => {
    assert.equal(cmd('light_hs', 'red'), null);
    assert.equal(cmd('light_color_temp', 'warm'), null);
    assert.equal(cmd('light_brightness', 'bright'), null);
  });

  it('clamps brightness and turns the light on when brightening', () => {
    assert.deepEqual(cmd('light_brightness', '140'), { 'dim:brightness': 100, 'swit:state': 'ON' });
    assert.deepEqual(cmd('light_brightness', '0'), { 'dim:brightness': 0 });
  });
});

describe('vent mapper', () => {
  const vent = (attrs: ArcusAttributes = {}) =>
    makeDevice('DRIV:dev:vt1', ['vent'], { 'vent:level': 40, 'vent:ventstate': 'OK', ...attrs });
  const cmd = (entity: string, payload: string) => ventMapper.handleCommand(config, vent(), entity, payload);

  it('maps a vent to a positionable damper with an obstruction sensor', () => {
    const disc = discoveryById(ventMapper, vent());
    assert.equal(disc.get('vt1_vent')?.device_class, 'damper');
    assert.equal(disc.get('vt1_vent')?.payload_stop, null);
    assert.equal(disc.get('vt1_vent_obstruction')?.device_class, 'problem');
    assert.deepEqual(ventMapper.buildState(config, vent()), { vent_position: 40, vent_obstruction: 'OFF' });
    assert.equal(ventMapper.buildState(config, vent({ 'vent:ventstate': 'OBSTRUCTION' })).vent_obstruction, 'ON');
  });

  it('adds a duct pressure sensor only when the vent reports pressure', () => {
    assert.equal(discoveryById(ventMapper, vent()).has('vt1_vent_pressure'), false);
    const withPressure = vent({ 'vent:airpressure': 101.2 });
    assert.equal(discoveryById(ventMapper, withPressure).get('vt1_vent_pressure')?.unit_of_measurement, 'kPa');
    assert.equal(ventMapper.buildState(config, withPressure).vent_pressure, 101.2);
  });

  it('opens, closes and moves to a position through the level', () => {
    assert.deepEqual(cmd('vent', 'OPEN'), { 'vent:level': 100 });
    assert.deepEqual(cmd('vent', 'CLOSE'), { 'vent:level': 0 });
    assert.deepEqual(cmd('vent_position', '25'), { 'vent:level': 25 });
    assert.deepEqual(cmd('vent_position', '-5'), { 'vent:level': 0 });
    assert.equal(cmd('vent_position', 'abc'), null);
  });
});

describe('irrigation mapper', () => {
  const zone = (z: string, num: number, extra: ArcusAttributes = {}): ArcusAttributes => ({
    [`irr:zonenum:${z}`]: num,
    [`irr:zoneState:${z}`]: 'NOT_WATERING',
    [`irr:defaultDuration:${z}`]: 10,
    ...extra,
  });
  const controller = (attrs: ArcusAttributes) => makeDevice('DRIV:dev:ir1', ['irrcont', 'irr'], {
    'irrcont:minirrigationtime': 1,
    'irrcont:maxirrigationtime': 60,
    ...attrs,
  });
  const single = controller(zone('z1', 1));
  const multi = controller({ ...zone('z2', 2), ...zone('z1', 1, { 'irr:zonename:z1': 'Front Beds' }) });

  it('names a single-zone timer after the device', () => {
    const disc = discoveryById(irrigationMapper, single);
    assert.equal(disc.get('ir1_zone_z1')?.name, null);
    assert.equal(disc.get('ir1_zone_z1')?.state_open, 'WATERING');
    assert.equal(disc.get('ir1_zone_z1_duration')?.name, 'Watering time');
    assert.equal(disc.get('ir1_zone_z1_duration')?.max, 60);
  });

  it('gives each zone of a multi-zone controller its own valve, by name or number', () => {
    const valves = irrigationMapper.buildDiscovery(config, multi).filter(d => d.topic.startsWith('homeassistant/valve/'));
    assert.deepEqual(valves.map(d => d.payload.name), ['Front Beds', 'Zone 2']);
  });

  it('reports each zone and its watering time', () => {
    const watering = controller(zone('z1', 1, { 'irr:zoneState:z1': 'WATERING', 'irr:defaultDuration:z1': 15 }));
    assert.deepEqual(irrigationMapper.buildState(config, watering), { zone_z1: 'WATERING', zone_z1_duration: 15 });
  });

  it('waters a zone for its watering time, and stops it', () => {
    assert.deepEqual(irrigationMapper.handleMethodCommand?.(config, multi, 'zone_z2', 'OPEN'),
      { method: 'irrcont:WaterNowV2', args: { zone: 'z2', duration: 10 } });
    assert.deepEqual(irrigationMapper.handleMethodCommand?.(config, multi, 'zone_z2', 'CLOSE'),
      { method: 'irrcont:CancelV2', args: { zone: 'z2' } });
    assert.equal(irrigationMapper.handleCommand(config, multi, 'zone_z2', 'OPEN'), null);
  });

  it('sets the watering time within the controller limits', () => {
    assert.deepEqual(irrigationMapper.handleCommand(config, single, 'zone_z1_duration', '20'), { 'irr:defaultDuration:z1': 20 });
    assert.deepEqual(irrigationMapper.handleCommand(config, single, 'zone_z1_duration', '500'), { 'irr:defaultDuration:z1': 60 });
    assert.equal(irrigationMapper.handleCommand(config, single, 'zone_z1_duration', 'abc'), null);
    assert.equal(irrigationMapper.handleMethodCommand?.(config, single, 'zone_z1_duration', 'OPEN'), null);
  });

  it('ignores zones the controller does not have', () => {
    assert.equal(irrigationMapper.handleMethodCommand?.(config, single, 'zone_z9', 'OPEN'), null);
    assert.equal(irrigationMapper.handleCommand(config, single, 'zone_z9_duration', '5'), null);
  });
});

describe('mapper registry', () => {
  it('has no camera mapper', () => {
    assert.equal(matchingMappers(makeDevice('DRIV:dev:cam', ['camera'])).length, 0);
  });
});

describe('lock access switches', () => {
  const access = testConfig({ features: new Set([Features.LOCK_ACCESS]) });
  const people = [
    { id: '0000000a-0000-4000-8000-000000000001', name: 'Pat Example', hasPin: true },
    { id: '0000000a-0000-4000-8000-000000000002', name: 'Robin Guest', hasPin: false },
  ];
  const lockWith = (slots: Record<string, string>) =>
    makeDevice('DRIV:dev:l1', ['doorlock'], { 'doorlock:slots': slots }, 'Back Door');
  const switches = (mqtt: FakeMqtt) =>
    [...mqtt.retained.keys()].filter(t => t.startsWith('homeassistant/switch/') && mqtt.retained.get(t));

  it('adds a config switch per person with a PIN, on each lock', () => {
    const mqtt = new FakeMqtt();
    const contact = makeDevice('DRIV:dev:c1', ['cont']);
    publishLockAccessDiscovery(mqtt, access, [lockWith({}), contact], people);

    const topic = `homeassistant/switch/arcus/l1_access_0000000a-0000-4000-8000-000000000001/config`;
    assert.deepEqual(switches(mqtt), [topic]);
    const disc = mqtt.json(topic);
    assert.equal(disc.name, 'Pat Example access');
    assert.equal(disc.entity_category, 'config');
    assert.equal(disc.command_topic, 'arcus/l1/access_0000000a-0000-4000-8000-000000000001/set');
    assert.equal(disc.state_topic, 'arcus/l1/state');
    assert.match(String(disc.value_template), /'0000000a-0000-4000-8000-000000000001' in \(value_json.access/);
  });

  it("keeps a switch for someone without a PIN while they're still on the lock", () => {
    const mqtt = new FakeMqtt();
    publishLockAccessDiscovery(mqtt, access, [lockWith({ '3': '0000000a-0000-4000-8000-000000000002' })], people);
    assert.equal(switches(mqtt).length, 2);
  });

  it('removes the switches when the feature is turned off', () => {
    const mqtt = new FakeMqtt();
    publishLockAccessDiscovery(mqtt, access, [lockWith({})], people);
    publishLockAccessDiscovery(mqtt, config, [lockWith({})], people);
    assert.deepEqual(switches(mqtt), []);
  });
});

describe('siren mapper (sirens feature)', () => {
  const sirens = testConfig({ features: new Set([Features.SIRENS]) });
  const siren = (state = 'QUIET') => ({ ...makeDevice('DRIV:dev:sr1', ['alert'], { 'alert:state': state }), type: 'Siren' });

  it('maps sirens, not keypads or other devices that can sound an alert', () => {
    assert.equal(sirenMapper.matches(siren()), true);
    assert.equal(sirenMapper.matches({ ...makeDevice('DRIV:dev:kp1', ['alert', 'keypad']), type: 'KeyPad' }), false);
  });

  it('sounds and silences the siren', () => {
    const [disc] = sirenMapper.buildDiscovery(sirens, siren());
    assert.equal(disc.topic, 'homeassistant/siren/arcus/sr1_siren/config');
    assert.equal(disc.payload.command_topic, 'arcus/sr1/siren/set');
    assert.deepEqual(sirenMapper.buildState(sirens, siren()), { siren: 'OFF' });
    assert.deepEqual(sirenMapper.buildState(sirens, siren('ALERTING')), { siren: 'ON' });
    assert.deepEqual(sirenMapper.handleCommand(sirens, siren(), 'siren', 'ON'), { 'alert:state': 'ALERTING' });
    assert.deepEqual(sirenMapper.handleCommand(sirens, siren(), 'siren', 'OFF'), { 'alert:state': 'QUIET' });
    assert.equal(sirenMapper.handleCommand(sirens, siren(), 'siren', 'LOUDER'), null);
  });

  it('offers nothing with the feature off', () => {
    assert.deepEqual(sirenMapper.buildDiscovery(config, siren()), []);
    assert.deepEqual(sirenMapper.buildState(config, siren('ALERTING')), {});
    assert.equal(sirenMapper.handleCommand(config, siren(), 'siren', 'ON'), null);
  });
});
