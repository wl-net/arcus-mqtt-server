import type { ArcusDevice, ArcusAttributes } from '../arcus/types.js';
import type { Config } from '../config.js';
import type { HADiscoveryConfig } from '../ha/discovery.js';
import { buildDeviceInfo, buildAvailability } from '../ha/discovery.js';
import { discoveryTopic, stateTopic, commandTopic, deviceId } from '../ha/topics.js';
import type { Mapper } from './index.js';

/** Maps Arcus dim → HA light (JSON schema) */
export const lightMapper: Mapper = {
  matches(device: ArcusDevice): boolean {
    return device.caps.has('dim');
  },

  buildDiscovery(config: Config, device: ArcusDevice): HADiscoveryConfig[] {
    const id = deviceId(device.address);
    const objectId = `${id}_light`;

    return [
      {
        topic: discoveryTopic(config, 'light', objectId),
        payload: {
          name: null,
          unique_id: objectId,
          object_id: objectId,
          schema: 'json',
          state_topic: stateTopic(config, device.address),
          command_topic: commandTopic(config, device.address, 'light'),
          value_template: '{{ value_json.light | to_json }}',
          brightness: true,
          brightness_scale: 100,
          device: buildDeviceInfo(config, device),
          availability: buildAvailability(config, device),
        },
      },
    ];
  },

  buildState(_config: Config, device: ArcusDevice): Record<string, unknown> {
    return {
      light: {
        state: device.attributes['swit:state'] === 'ON' ? 'ON' : 'OFF',
        brightness: device.attributes['dim:brightness'] ?? 0,
      },
    };
  },

  handleCommand(
    _config: Config,
    device: ArcusDevice,
    entity: string,
    payload: string,
  ): ArcusAttributes | null {
    if (entity !== 'light') return null;
    const cmd = JSON.parse(payload) as { state?: string; brightness?: number };
    const attrs: ArcusAttributes = {};
    if (cmd.state !== undefined) {
      attrs['swit:state'] = cmd.state === 'ON' ? 'ON' : 'OFF';
    }
    if (cmd.brightness !== undefined) {
      attrs['dim:brightness'] = cmd.brightness;
      // Turn on if setting brightness > 0
      if (cmd.brightness > 0 && cmd.state === undefined) {
        attrs['swit:state'] = 'ON';
      }
    }
    return Object.keys(attrs).length > 0 ? attrs : null;
  },
};
