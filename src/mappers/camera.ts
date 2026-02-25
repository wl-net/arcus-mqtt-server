import type { ArcusDevice } from '../arcus/types.js';
import type { Config } from '../config.js';
import type { HADiscoveryConfig } from '../ha/discovery.js';
import { buildDeviceInfo, buildAvailability } from '../ha/discovery.js';
import { discoveryTopic, deviceId } from '../ha/topics.js';
import type { Mapper } from './index.js';

/** Maps Arcus camera → HA camera (discovery only, no stream) */
export const cameraMapper: Mapper = {
  matches(device: ArcusDevice): boolean {
    return device.caps.has('camera');
  },

  buildDiscovery(config: Config, device: ArcusDevice): HADiscoveryConfig[] {
    const id = deviceId(device.address);
    const objectId = `${id}_camera`;

    return [
      {
        topic: discoveryTopic(config, 'camera', objectId),
        payload: {
          name: null,
          unique_id: objectId,
          object_id: objectId,
          device: buildDeviceInfo(config, device),
          availability: buildAvailability(config, device),
        },
      },
    ];
  },

  buildState(): Record<string, unknown> {
    return {}; // Camera has no MQTT state
  },

  handleCommand(): null {
    return null; // Camera has no commands via MQTT
  },
};
