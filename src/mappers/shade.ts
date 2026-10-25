import type { ArcusDevice, ArcusAttributes } from '../arcus/types.js';
import { Shade } from '../arcus/capabilities.js';
import type { Config } from '../config.js';
import type { HADiscoveryConfig } from '../ha/discovery.js';
import { buildDeviceInfo, buildAvailability, positionTemplate } from '../ha/discovery.js';
import { discoveryTopic, stateTopic, commandTopic, deviceId } from '../ha/topics.js';
import type { Mapper } from './index.js';

/**
 * Maps Arcus shade → HA cover (device_class: shade) with position.
 * shade:level is 0 (closed) to 100 (open). Open/close are sent as level changes,
 * since commands go out as attribute sets; HA derives open/closed from the position.
 */
export const shadeMapper: Mapper = {
  matches(device: ArcusDevice): boolean {
    return device.caps.has(Shade.NAMESPACE);
  },

  buildDiscovery(config: Config, device: ArcusDevice): HADiscoveryConfig[] {
    const id = deviceId(device.address);
    const objectId = `${id}_shade`;

    return [
      {
        topic: discoveryTopic(config, 'cover', objectId),
        payload: {
          name: null,
          unique_id: objectId,
          object_id: objectId,
          device_class: 'shade',
          command_topic: commandTopic(config, device.address, 'shade'),
          payload_open: 'OPEN',
          payload_close: 'CLOSE',
          // Arcus shades can't be stopped mid-travel through attribute sets
          payload_stop: null,
          position_topic: stateTopic(config, device.address),
          position_template: positionTemplate('shade_position'),
          set_position_topic: commandTopic(config, device.address, 'shade_position'),
          device: buildDeviceInfo(config, device),
          ...buildAvailability(config, device),
        },
      },
    ];
  },

  buildState(_config: Config, device: ArcusDevice): Record<string, unknown> {
    const level = device.attributes[Shade.ATTR_LEVEL];
    return { shade_position: typeof level === 'number' ? level : null };
  },

  handleCommand(
    _config: Config,
    _device: ArcusDevice,
    entity: string,
    payload: string,
  ): ArcusAttributes | null {
    if (entity === 'shade') {
      const cmd = payload.toUpperCase();
      if (cmd === 'OPEN') return { [Shade.ATTR_LEVEL]: 100 };
      if (cmd === 'CLOSE') return { [Shade.ATTR_LEVEL]: 0 };
      return null;
    }
    if (entity === 'shade_position') {
      const position = Number(payload);
      if (!Number.isFinite(position)) return null;
      return { [Shade.ATTR_LEVEL]: Math.round(Math.min(100, Math.max(0, position))) };
    }
    return null;
  },
};
