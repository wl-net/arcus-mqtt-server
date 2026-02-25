import type { ArcusDevice } from '../arcus/types.js';
import type { Config } from '../config.js';
import type { HADiscoveryConfig } from '../ha/discovery.js';
import { buildDeviceInfo, buildAvailability } from '../ha/discovery.js';
import { discoveryTopic, stateTopic, deviceId } from '../ha/topics.js';
import type { Mapper } from './index.js';

interface SensorDef {
  cap: string;
  attribute: string;
  deviceClass: string;
  unit: string;
  suffix: string;
  stateClass: string;
}

const SENSOR_DEFS: SensorDef[] = [
  {
    cap: 'temp',
    attribute: 'temp:temperature',
    deviceClass: 'temperature',
    unit: '°C',
    suffix: 'temperature',
    stateClass: 'measurement',
  },
  {
    cap: 'humid',
    attribute: 'humid:humidity',
    deviceClass: 'humidity',
    unit: '%',
    suffix: 'humidity',
    stateClass: 'measurement',
  },
  {
    cap: 'devpow',
    attribute: 'devpow:battery',
    deviceClass: 'battery',
    unit: '%',
    suffix: 'battery',
    stateClass: 'measurement',
  },
];

/** Maps Arcus temp/humid/devpow(battery) → HA sensor */
export const sensorMapper: Mapper = {
  matches(device: ArcusDevice): boolean {
    return SENSOR_DEFS.some(def => {
      if (!device.caps.has(def.cap)) return false;
      // Only create battery sensor for battery-powered devices
      if (def.cap === 'devpow') return device.attributes['devpow:source'] === 'BATTERY';
      return true;
    });
  },

  buildDiscovery(config: Config, device: ArcusDevice): HADiscoveryConfig[] {
    const id = deviceId(device.address);
    const configs: HADiscoveryConfig[] = [];

    for (const def of SENSOR_DEFS) {
      if (!device.caps.has(def.cap)) continue;
      if (def.cap === 'devpow' && device.attributes['devpow:source'] !== 'BATTERY') continue;

      const objectId = `${id}_${def.suffix}`;

      configs.push({
        topic: discoveryTopic(config, 'sensor', objectId),
        payload: {
          name: def.suffix.charAt(0).toUpperCase() + def.suffix.slice(1),
          unique_id: objectId,
          object_id: objectId,
          state_topic: stateTopic(config, device.address),
          value_template: `{{ value_json.${def.suffix} }}`,
          device_class: def.deviceClass,
          unit_of_measurement: def.unit,
          state_class: def.stateClass,
          device: buildDeviceInfo(config, device),
          availability: buildAvailability(config, device),
        },
      });
    }

    return configs;
  },

  buildState(_config: Config, device: ArcusDevice): Record<string, unknown> {
    const state: Record<string, unknown> = {};

    for (const def of SENSOR_DEFS) {
      if (!device.caps.has(def.cap)) continue;
      if (def.cap === 'devpow' && device.attributes['devpow:source'] !== 'BATTERY') continue;

      const val = device.attributes[def.attribute];
      if (val !== undefined) {
        state[def.suffix] = val;
      }
    }

    return state;
  },

  handleCommand(): null {
    return null; // Sensors have no commands
  },
};
