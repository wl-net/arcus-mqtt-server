import type { ArcusDevice, ArcusAttributes } from '../arcus/types.js';
import { Thermostat, Temperature } from '../arcus/capabilities.js';
import type { Config } from '../config.js';
import type { HADiscoveryConfig } from '../ha/discovery.js';
import { buildDeviceInfo, buildAvailability } from '../ha/discovery.js';
import { discoveryTopic, stateTopic, commandTopic, deviceId } from '../ha/topics.js';
import type { Mapper } from './index.js';

/** Arcus HVAC modes that map onto HA modes. ECO isn't an HA mode; it's exposed as the 'eco' preset. */
const ARCUS_TO_HA_MODE: Record<string, string> = {
  OFF: 'off',
  HEAT: 'heat',
  COOL: 'cool',
  AUTO: 'heat_cool',
};

const HA_TO_ARCUS_MODE: Record<string, string> = {
  off: Thermostat.HVACMODE_OFF,
  heat: Thermostat.HVACMODE_HEAT,
  cool: Thermostat.HVACMODE_COOL,
  heat_cool: Thermostat.HVACMODE_AUTO,
};

const ECO_PRESET = 'eco';

/** Modes the thermostat reports supporting, or all of them if it doesn't say */
function supportedModes(device: ArcusDevice): string[] {
  const modes = device.attributes[Thermostat.ATTR_SUPPORTEDMODES];
  if (Array.isArray(modes) && modes.length > 0) return modes;
  return [Thermostat.HVACMODE_OFF, Thermostat.HVACMODE_HEAT, Thermostat.HVACMODE_COOL, Thermostat.HVACMODE_AUTO];
}

function haModes(device: ArcusDevice): string[] {
  return supportedModes(device).map(m => ARCUS_TO_HA_MODE[m]).filter((m): m is string => !!m);
}

function supportsEco(device: ArcusDevice): boolean {
  return supportedModes(device).includes(Thermostat.HVACMODE_ECO);
}

/**
 * Emergency heat runs a heat pump's backup heater on its own. Drivers that report
 * therm:emergencyheat also accept it: ON switches the thermostat to its emergency
 * heat mode, OFF goes back to the mode it was in. HA's climate entity has no place
 * for it, so it's a switch.
 */
function supportsEmergencyHeat(device: ArcusDevice): boolean {
  return Thermostat.ATTR_EMERGENCYHEAT in device.attributes;
}

/**
 * Fan modes for HA. therm:fanmode is 0 for auto (fan runs only while heating or
 * cooling), or 1..maxfanspeed to run the fan continuously at that speed.
 *
 * Mode 0 is labelled 'off' rather than 'auto': HA's HomeKit bridge rejects the
 * fan's on/off toggle unless an 'off' mode exists, and Arcus has only these two
 * states, so 'off' here means "not forced on".
 */
function fanModes(device: ArcusDevice): Array<{ ha: string; speed: number }> {
  const max = Math.max(1, Number(device.attributes[Thermostat.ATTR_MAXFANSPEED] ?? 1));
  if (max === 1) return [{ ha: 'off', speed: 0 }, { ha: 'on', speed: 1 }];
  if (max === 2) return [{ ha: 'off', speed: 0 }, { ha: 'low', speed: 1 }, { ha: 'high', speed: 2 }];
  return [
    { ha: 'off', speed: 0 },
    { ha: 'low', speed: 1 },
    { ha: 'medium', speed: Math.round((1 + max) / 2) },
    { ha: 'high', speed: max },
  ];
}

function fanModeState(device: ArcusDevice): string {
  const speed = Number(device.attributes[Thermostat.ATTR_FANMODE] ?? 0);
  const modes = fanModes(device);
  if (speed <= 0) return 'off';
  // Pick the closest listed speed, for speeds between the ones offered to HA
  return modes.slice(1).reduce((best, m) => (Math.abs(m.speed - speed) < Math.abs(best.speed - speed) ? m : best)).ha;
}

/**
 * HA hvac_action. Arcus only reports whether the system is RUNNING, so work out
 * heating vs cooling from the mode (and, in AUTO/ECO, from the temperature).
 */
function hvacAction(device: ArcusDevice): string {
  const attrs = device.attributes;
  const mode = String(attrs[Thermostat.ATTR_HVACMODE] ?? Thermostat.HVACMODE_OFF);
  const running = attrs[Thermostat.ATTR_ACTIVE] === Thermostat.ACTIVE_RUNNING;
  const fanOn = Number(attrs[Thermostat.ATTR_FANMODE] ?? 0) > 0;

  if (mode === Thermostat.HVACMODE_OFF) return fanOn ? 'fan' : 'off';
  if (!running) return fanOn ? 'fan' : 'idle';
  if (mode === Thermostat.HVACMODE_HEAT) return 'heating';
  if (mode === Thermostat.HVACMODE_COOL) return 'cooling';

  // AUTO / ECO: whichever setpoint the current temperature is nearer to
  const temp = Number(attrs[Temperature.ATTR_TEMPERATURE]);
  const heat = Number(attrs[Thermostat.ATTR_HEATSETPOINT]);
  const cool = Number(attrs[Thermostat.ATTR_COOLSETPOINT]);
  if ([temp, heat, cool].some(Number.isNaN)) return 'idle';
  return temp <= (heat + cool) / 2 ? 'heating' : 'cooling';
}

/** Maps Arcus therm → HA climate, plus an emergency heat switch where supported */
export const climateMapper: Mapper = {
  matches(device: ArcusDevice): boolean {
    return device.caps.has(Thermostat.NAMESPACE);
  },

  buildDiscovery(config: Config, device: ArcusDevice): HADiscoveryConfig[] {
    const id = deviceId(device.address);
    const objectId = `${id}_climate`;
    const state = stateTopic(config, device.address);

    const payload: Record<string, unknown> = {
      name: null,
      unique_id: objectId,
      object_id: objectId,
      state_topic: state,
      temperature_unit: 'C',
      // Mode
      mode_state_topic: state,
      mode_state_template: '{{ value_json.climate_mode }}',
      mode_command_topic: commandTopic(config, device.address, 'climate_mode'),
      modes: haModes(device),
      // Fan
      fan_mode_state_topic: state,
      fan_mode_state_template: '{{ value_json.climate_fan_mode }}',
      fan_mode_command_topic: commandTopic(config, device.address, 'climate_fan_mode'),
      fan_modes: fanModes(device).map(m => m.ha),
      // Current temperature
      current_temperature_topic: state,
      current_temperature_template: '{{ value_json.climate_current_temp }}',
      // Heat setpoint
      temperature_low_state_topic: state,
      temperature_low_state_template: '{{ value_json.climate_heat_setpoint }}',
      temperature_low_command_topic: commandTopic(config, device.address, 'climate_heat_setpoint'),
      // Cool setpoint
      temperature_high_state_topic: state,
      temperature_high_state_template: '{{ value_json.climate_cool_setpoint }}',
      temperature_high_command_topic: commandTopic(config, device.address, 'climate_cool_setpoint'),
      // Action
      action_topic: state,
      action_template: '{{ value_json.climate_action }}',
      temp_step: 0.5,
      device: buildDeviceInfo(config, device),
      ...buildAvailability(config, device),
    };

    if (supportsEco(device)) {
      payload.preset_modes = [ECO_PRESET];
      payload.preset_mode_state_topic = state;
      payload.preset_mode_value_template = '{{ value_json.climate_preset }}';
      payload.preset_mode_command_topic = commandTopic(config, device.address, 'climate_preset');
    }

    const configs: HADiscoveryConfig[] = [{ topic: discoveryTopic(config, 'climate', objectId), payload }];

    if (supportsEmergencyHeat(device)) {
      const switchId = `${id}_emergency_heat`;
      configs.push({
        topic: discoveryTopic(config, 'switch', switchId),
        payload: {
          name: 'Emergency heat',
          unique_id: switchId,
          object_id: switchId,
          state_topic: state,
          value_template: '{{ value_json.emergency_heat }}',
          command_topic: commandTopic(config, device.address, 'emergency_heat'),
          payload_on: 'ON',
          payload_off: 'OFF',
          device: buildDeviceInfo(config, device),
          ...buildAvailability(config, device),
        },
      });
    }

    return configs;
  },

  buildState(_config: Config, device: ArcusDevice): Record<string, unknown> {
    const mode = String(device.attributes[Thermostat.ATTR_HVACMODE] ?? Thermostat.HVACMODE_OFF);
    const eco = mode === Thermostat.HVACMODE_ECO;

    // ECO runs heating and cooling around its setpoints, so show it as heat_cool
    // (or heat, if the thermostat has no AUTO) with the eco preset active.
    let haMode = ARCUS_TO_HA_MODE[mode] ?? 'off';
    if (eco) haMode = haModes(device).includes('heat_cool') ? 'heat_cool' : 'heat';

    const state: Record<string, unknown> = {
      climate_mode: haMode,
      climate_fan_mode: fanModeState(device),
      climate_current_temp: device.attributes[Temperature.ATTR_TEMPERATURE] ?? 0,
      climate_heat_setpoint: device.attributes[Thermostat.ATTR_HEATSETPOINT] ?? 18,
      climate_cool_setpoint: device.attributes[Thermostat.ATTR_COOLSETPOINT] ?? 26,
      climate_action: hvacAction(device),
    };
    if (supportsEco(device)) state.climate_preset = eco ? ECO_PRESET : 'none';
    if (supportsEmergencyHeat(device)) {
      state.emergency_heat = device.attributes[Thermostat.ATTR_EMERGENCYHEAT] === Thermostat.EMERGENCYHEAT_ON ? 'ON' : 'OFF';
    }
    return state;
  },

  handleCommand(
    _config: Config,
    device: ArcusDevice,
    entity: string,
    payload: string,
  ): ArcusAttributes | null {
    switch (entity) {
      case 'climate_mode': {
        const arcusMode = HA_TO_ARCUS_MODE[payload];
        return arcusMode ? { [Thermostat.ATTR_HVACMODE]: arcusMode } : null;
      }
      case 'climate_preset': {
        if (payload === ECO_PRESET) return { [Thermostat.ATTR_HVACMODE]: Thermostat.HVACMODE_ECO };
        if (payload !== 'none') return null;
        if (device.attributes[Thermostat.ATTR_HVACMODE] !== Thermostat.HVACMODE_ECO) return null;
        // Leaving eco: Arcus has no memory of the previous mode, so fall back to AUTO (or HEAT)
        const fallback = supportedModes(device).includes(Thermostat.HVACMODE_AUTO)
          ? Thermostat.HVACMODE_AUTO
          : Thermostat.HVACMODE_HEAT;
        return { [Thermostat.ATTR_HVACMODE]: fallback };
      }
      case 'climate_fan_mode': {
        // 'auto' was mode 0's earlier name; keep accepting it for existing automations
        if (payload === 'auto') return { [Thermostat.ATTR_FANMODE]: 0 };
        const mode = fanModes(device).find(m => m.ha === payload);
        return mode ? { [Thermostat.ATTR_FANMODE]: mode.speed } : null;
      }
      case 'climate_heat_setpoint':
        return { [Thermostat.ATTR_HEATSETPOINT]: parseFloat(payload) };
      case 'climate_cool_setpoint':
        return { [Thermostat.ATTR_COOLSETPOINT]: parseFloat(payload) };
      case 'emergency_heat':
        if (!supportsEmergencyHeat(device)) return null;
        if (payload === 'ON') return { [Thermostat.ATTR_EMERGENCYHEAT]: Thermostat.EMERGENCYHEAT_ON };
        if (payload === 'OFF') return { [Thermostat.ATTR_EMERGENCYHEAT]: Thermostat.EMERGENCYHEAT_OFF };
        return null;
      default:
        return null;
    }
  },
};
