import type { ArcusDevice } from '../arcus/types.js';
import type { Config } from '../config.js';
import type { HADiscoveryConfig } from '../ha/discovery.js';
import { buildDeviceInfo, buildAvailability } from '../ha/discovery.js';
import { discoveryTopic, stateTopic, deviceId } from '../ha/topics.js';
import type { Mapper } from './index.js';

interface BinarySensorDef {
  cap: string;
  attribute: string;
  onValue: string;
  deviceClass: string;
  suffix: string;
}

const BINARY_SENSOR_DEFS: BinarySensorDef[] = [
  {
    cap: 'cont',
    attribute: 'cont:contact',
    onValue: 'OPENED',
    deviceClass: 'door', // default; overridden for windows
    suffix: 'contact',
  },
  {
    cap: 'mot',
    attribute: 'mot:motion',
    onValue: 'DETECTED',
    deviceClass: 'motion',
    suffix: 'motion',
  },
  {
    cap: 'leakh2o',
    attribute: 'leakh2o:state',
    onValue: 'LEAK',
    deviceClass: 'moisture',
    suffix: 'leak',
  },
];

function resolveContactDeviceClass(device: ArcusDevice): string {
  const hint = device.attributes['cont:usehint'];
  if (hint === 'WINDOW') return 'window';
  return 'door';
}

/** Maps Arcus cont/mot/leakh2o → HA binary_sensor */
export const binarySensorMapper: Mapper = {
  matches(device: ArcusDevice): boolean {
    return BINARY_SENSOR_DEFS.some(def => device.caps.has(def.cap));
  },

  buildDiscovery(config: Config, device: ArcusDevice): HADiscoveryConfig[] {
    const id = deviceId(device.address);
    const configs: HADiscoveryConfig[] = [];

    for (const def of BINARY_SENSOR_DEFS) {
      if (!device.caps.has(def.cap)) continue;

      const objectId = `${id}_${def.suffix}`;
      const deviceClass =
        def.cap === 'cont' ? resolveContactDeviceClass(device) : def.deviceClass;

      configs.push({
        topic: discoveryTopic(config, 'binary_sensor', objectId),
        payload: {
          name: def.suffix.charAt(0).toUpperCase() + def.suffix.slice(1),
          unique_id: objectId,
          object_id: objectId,
          state_topic: stateTopic(config, device.address),
          value_template: `{{ value_json.${def.suffix} }}`,
          payload_on: 'ON',
          payload_off: 'OFF',
          device_class: deviceClass,
          device: buildDeviceInfo(config, device),
          availability: buildAvailability(config, device),
        },
      });
    }

    return configs;
  },

  buildState(_config: Config, device: ArcusDevice): Record<string, unknown> {
    const state: Record<string, unknown> = {};

    for (const def of BINARY_SENSOR_DEFS) {
      if (!device.caps.has(def.cap)) continue;
      const raw = device.attributes[def.attribute];
      state[def.suffix] = raw === def.onValue ? 'ON' : 'OFF';
    }

    return state;
  },

  handleCommand(): null {
    return null; // Binary sensors have no commands
  },
};
