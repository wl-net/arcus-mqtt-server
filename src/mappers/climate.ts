import type { ArcusDevice, ArcusAttributes } from '../arcus/types.js';
import { Thermostat, Temperature } from '../arcus/capabilities.js';
import type { Config } from '../config.js';
import type { HADiscoveryConfig } from '../ha/discovery.js';
import { buildDeviceInfo, buildAvailability } from '../ha/discovery.js';
import { discoveryTopic, stateTopic, commandTopic, deviceId } from '../ha/topics.js';
import type { Mapper } from './index.js';

const ARCUS_TO_HA_MODE: Record<string, string> = {
  OFF: 'off',
  HEAT: 'heat',
  COOL: 'cool',
  AUTO: 'heat_cool',
};

const HA_TO_ARCUS_MODE: Record<string, string> = {
  off: 'OFF',
  heat: 'HEAT',
  cool: 'COOL',
  heat_cool: 'AUTO',
};

const ARCUS_TO_HA_ACTION: Record<string, string> = {
  HEATING: 'heating',
  COOLING: 'cooling',
  IDLE: 'idle',
  OFF: 'off',
};

/** Maps Arcus therm → HA climate */
export const climateMapper: Mapper = {
  matches(device: ArcusDevice): boolean {
    return device.caps.has(Thermostat.NAMESPACE);
  },

  buildDiscovery(config: Config, device: ArcusDevice): HADiscoveryConfig[] {
    const id = deviceId(device.address);
    const objectId = `${id}_climate`;

    return [
      {
        topic: discoveryTopic(config, 'climate', objectId),
        payload: {
          name: null,
          unique_id: objectId,
          object_id: objectId,
          state_topic: stateTopic(config, device.address),
          temperature_unit: 'C',
          // Mode
          mode_state_topic: stateTopic(config, device.address),
          mode_state_template: '{{ value_json.climate_mode }}',
          mode_command_topic: commandTopic(config, device.address, 'climate_mode'),
          modes: ['off', 'heat', 'cool', 'heat_cool'],
          // Current temperature
          current_temperature_topic: stateTopic(config, device.address),
          current_temperature_template: '{{ value_json.climate_current_temp }}',
          // Heat setpoint
          temperature_low_state_topic: stateTopic(config, device.address),
          temperature_low_state_template: '{{ value_json.climate_heat_setpoint }}',
          temperature_low_command_topic: commandTopic(config, device.address, 'climate_heat_setpoint'),
          // Cool setpoint
          temperature_high_state_topic: stateTopic(config, device.address),
          temperature_high_state_template: '{{ value_json.climate_cool_setpoint }}',
          temperature_high_command_topic: commandTopic(config, device.address, 'climate_cool_setpoint'),
          // Action
          action_topic: stateTopic(config, device.address),
          action_template: '{{ value_json.climate_action }}',
          temp_step: 0.5,
          device: buildDeviceInfo(config, device),
          availability: buildAvailability(config, device),
        },
      },
    ];
  },

  buildState(_config: Config, device: ArcusDevice): Record<string, unknown> {
    const mode = String(device.attributes[Thermostat.ATTR_HVACMODE] ?? 'OFF');
    const active = String(device.attributes[Thermostat.ATTR_ACTIVE] ?? 'IDLE');

    return {
      climate_mode: ARCUS_TO_HA_MODE[mode] ?? 'off',
      climate_current_temp: device.attributes[Temperature.ATTR_TEMPERATURE] ?? 0,
      climate_heat_setpoint: device.attributes[Thermostat.ATTR_HEATSETPOINT] ?? 18,
      climate_cool_setpoint: device.attributes[Thermostat.ATTR_COOLSETPOINT] ?? 26,
      climate_action: ARCUS_TO_HA_ACTION[active] ?? 'idle',
    };
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
      case 'climate_heat_setpoint':
        return { [Thermostat.ATTR_HEATSETPOINT]: parseFloat(payload) };
      case 'climate_cool_setpoint':
        return { [Thermostat.ATTR_COOLSETPOINT]: parseFloat(payload) };
      default:
        return null;
    }
  },
};
