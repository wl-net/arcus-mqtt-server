import type { ArcusDevice, ArcusAttributes } from '../arcus/types.js';
import { Switch, Dimmer } from '../arcus/capabilities.js';
import type { Config } from '../config.js';
import type { HADiscoveryConfig } from '../ha/discovery.js';
import { buildDeviceInfo, buildAvailability } from '../ha/discovery.js';
import { discoveryTopic, stateTopic, commandTopic, deviceId } from '../ha/topics.js';
import type { Mapper } from './index.js';

/** Maps Arcus dim → HA light (JSON schema) */
export const lightMapper: Mapper = {
  matches(device: ArcusDevice): boolean {
    return device.caps.has(Dimmer.NAMESPACE);
  },

  buildDiscovery(config: Config, device: ArcusDevice): HADiscoveryConfig[] {
    const id = deviceId(device.address);
    const objectId = `${id}_light`;

    return [
      {
        topic: discoveryTopic(config, 'light', objectId),
        payload: {
          name: device.name,
          unique_id: objectId,
          object_id: objectId,
          state_topic: stateTopic(config, device.address),
          state_value_template: '{{ value_json.light_state }}',
          command_topic: commandTopic(config, device.address, 'light'),
          payload_on: 'ON',
          payload_off: 'OFF',
          brightness_state_topic: stateTopic(config, device.address),
          brightness_value_template: '{{ value_json.light_brightness }}',
          brightness_command_topic: commandTopic(config, device.address, 'light_brightness'),
          brightness_scale: 100,
          device: buildDeviceInfo(config, device),
          availability: buildAvailability(config, device),
        },
      },
    ];
  },

  buildState(_config: Config, device: ArcusDevice): Record<string, unknown> {
    return {
      light_state: device.attributes[Switch.ATTR_STATE] === 'ON' ? 'ON' : 'OFF',
      light_brightness: device.attributes[Dimmer.ATTR_BRIGHTNESS] ?? 0,
    };
  },

  handleCommand(
    _config: Config,
    device: ArcusDevice,
    entity: string,
    payload: string,
  ): ArcusAttributes | null {
    if (entity === 'light') {
      return { [Switch.ATTR_STATE]: payload === 'ON' ? 'ON' : 'OFF' };
    }
    if (entity === 'light_brightness') {
      const brightness = parseInt(payload, 10);
      const attrs: ArcusAttributes = { [Dimmer.ATTR_BRIGHTNESS]: brightness };
      if (brightness > 0) {
        attrs[Switch.ATTR_STATE] = 'ON';
      }
      return attrs;
    }
    return null;
  },
};
