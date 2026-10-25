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
  /**
   * Make the sensor only once the driver reports the value. Drivers that meter power set
   * pow:instantaneous and pow:cumulative when the device is added, so a missing one means the
   * device doesn't measure it (Iris Smart Plugs have pow but never pow:cumulative). Other
   * values can be missing just because the device hasn't reported yet, so those sensors
   * follow the capability, or a restart could delete them with their settings in HA.
   */
  needsValue?: boolean;
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
    needsValue: true,
  },
  {
    cap: PowerUse.NAMESPACE,
    attribute: PowerUse.ATTR_CUMULATIVE,
    deviceClass: 'energy',
    unit: 'Wh',
    suffix: 'energy',
    stateClass: 'total_increasing',
    needsValue: true,
  },
];

/** Whether the device has this sensor's capability */
function hasCapability(device: ArcusDevice, def: SensorDef): boolean {
  if (!device.caps.has(def.cap)) return false;
  // Only create battery sensor for battery-powered devices
  if (def.cap === DevicePower.NAMESPACE) return device.attributes[DevicePower.ATTR_SOURCE] === DevicePower.SOURCE_BATTERY;
  return true;
}

/** Whether the device gets this sensor (see SensorDef.needsValue) */
function hasSensor(device: ArcusDevice, def: SensorDef): boolean {
  if (!hasCapability(device, def)) return false;
  return !def.needsValue || device.attributes[def.attribute] !== undefined;
}

/** Maps Arcus temp/humid/devpow(battery)/pow → HA sensor */
export const sensorMapper: Mapper = {
  // On the capability alone, so retiredTopics also runs for devices with none of the attributes
  matches(device: ArcusDevice): boolean {
    return SENSOR_DEFS.some(def => hasCapability(device, def));
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
      // null (unknown in HA) until the device reports: a missing key makes HA log a template warning
      if (hasSensor(device, def)) state[def.suffix] = device.attributes[def.attribute] ?? null;
    }

    return state;
  },

  retiredTopics(config: Config, device: ArcusDevice): string[] {
    // Before 0.2.4 the capability alone made power and energy sensors, so these may still be in HA
    const id = deviceId(device.address);
    return SENSOR_DEFS
      .filter(def => hasCapability(device, def) && !hasSensor(device, def))
      .map(def => discoveryTopic(config, 'sensor', `${id}_${def.suffix}`));
  },

  handleCommand(): null {
    return null; // Sensors have no commands
  },
};
