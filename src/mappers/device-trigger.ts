import type { ArcusDevice } from '../arcus/types.js';
import { Button } from '../arcus/capabilities.js';
import type { Config } from '../config.js';
import type { HADiscoveryConfig } from '../ha/discovery.js';
import { buildDeviceInfo } from '../ha/discovery.js';
import { discoveryTopic, deviceId } from '../ha/topics.js';
import type { Mapper } from './index.js';

/** Maps Arcus but → HA device_automation (device trigger) */
export const deviceTriggerMapper: Mapper = {
  matches(device: ArcusDevice): boolean {
    return device.caps.has(Button.NAMESPACE);
  },

  buildDiscovery(config: Config, device: ArcusDevice): HADiscoveryConfig[] {
    const id = deviceId(device.address);
    const objectId = `${id}_button_press`;

    return [
      {
        topic: discoveryTopic(config, 'device_automation', objectId),
        payload: {
          automation_type: 'trigger',
          type: 'button_short_press',
          subtype: 'button_1',
          topic: `${config.deviceIdPrefix}/${id}/trigger`,
          payload: 'PRESSED',
          device: buildDeviceInfo(config, device),
        },
      },
    ];
  },

  buildState(): Record<string, unknown> {
    return {}; // Triggers don't have state topics
  },

  handleCommand(): null {
    return null; // Triggers have no commands
  },
};
