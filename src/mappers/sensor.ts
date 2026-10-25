import type { ArcusDevice } from '../arcus/types.js';
import { Temperature, RelativeHumidity, DevicePower, PowerUse } from '../arcus/capabilities.js';
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
    cap: Temperature.NAMESPACE,
    attribute: Temperature.ATTR_TEMPERATURE,
    deviceClass: 'temperature',
    unit: '°C',
    suffix: 'temperature',
    stateClass: 'measurement',
  },
  {
    cap: RelativeHumidity.NAMESPACE,
    attribute: RelativeHumidity.ATTR_HUMIDITY,
    deviceClass: 'humidity',
    unit: '%',
    suffix: 'humidity',
    stateClass: 'measurement',
  },
  {
    cap: DevicePower.NAMESPACE,
    attribute: DevicePower.ATTR_BATTERY,
    deviceClass: 'battery',
    unit: '%',
    suffix: 'battery',
    stateClass: 'measurement',
  },
  {
    cap: PowerUse.NAMESPACE,
    attribute: PowerUse.ATTR_INSTANTANEOUS,
    deviceClass: 'power',
    unit: 'W',
    suffix: 'power',
    stateClass: 'measurement',
  },
  {
    cap: PowerUse.NAMESPACE,
    attribute: PowerUse.ATTR_CUMULATIVE,
    deviceClass: 'energy',
    unit: 'Wh',
    suffix: 'energy',
    stateClass: 'total_increasing',
  },
];

/**
 * Whether the device gets this sensor. Drivers can declare a capability without reporting
 * every attribute (Iris smart plugs have pow but no pow:cumulative), and HA warns on each
 * state message whose JSON lacks a sensor's key, so the attribute itself must be there.
 */
function hasSensor(device: ArcusDevice, def: SensorDef): boolean {
  if (!device.caps.has(def.cap)) return false;
  // Only create battery sensor for battery-powered devices
  if (def.cap === DevicePower.NAMESPACE && device.attributes[DevicePower.ATTR_SOURCE] !== DevicePower.SOURCE_BATTERY) return false;
  return device.attributes[def.attribute] !== undefined;
}

/** Maps Arcus temp/humid/devpow(battery)/pow → HA sensor */
export const sensorMapper: Mapper = {
  matches(device: ArcusDevice): boolean {
    return SENSOR_DEFS.some(def => hasSensor(device, def));
  },

  buildDiscovery(config: Config, device: ArcusDevice): HADiscoveryConfig[] {
    const id = deviceId(device.address);
    const configs: HADiscoveryConfig[] = [];

    for (const def of SENSOR_DEFS) {
      if (!hasSensor(device, def)) continue;

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
          ...buildAvailability(config, device),
        },
      });
    }

    return configs;
  },

  buildState(_config: Config, device: ArcusDevice): Record<string, unknown> {
    const state: Record<string, unknown> = {};

    for (const def of SENSOR_DEFS) {
      if (hasSensor(device, def)) state[def.suffix] = device.attributes[def.attribute];
    }

    return state;
  },

  handleCommand(): null {
    return null; // Sensors have no commands
  },
};
