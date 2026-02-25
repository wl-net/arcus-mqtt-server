import type { ArcusDevice, ArcusAttributes } from '../arcus/types.js';
import { DoorLock } from '../arcus/capabilities.js';
import type { Config } from '../config.js';
import type { HADiscoveryConfig } from '../ha/discovery.js';
import { buildDeviceInfo, buildAvailability } from '../ha/discovery.js';
import { discoveryTopic, stateTopic, commandTopic, deviceId } from '../ha/topics.js';
import type { Mapper } from './index.js';

/** Maps Arcus doorlock → HA lock */
export const lockMapper: Mapper = {
  matches(device: ArcusDevice): boolean {
    return device.caps.has(DoorLock.NAMESPACE);
  },

  buildDiscovery(config: Config, device: ArcusDevice): HADiscoveryConfig[] {
    const id = deviceId(device.address);
    const objectId = `${id}_lock`;

    return [
      {
        topic: discoveryTopic(config, 'lock', objectId),
        payload: {
          name: null,
          unique_id: objectId,
          object_id: objectId,
          state_topic: stateTopic(config, device.address),
          command_topic: commandTopic(config, device.address, 'lock'),
          value_template: '{{ value_json.lock }}',
          payload_lock: 'LOCK',
          payload_unlock: 'UNLOCK',
          state_locked: 'LOCKED',
          state_unlocked: 'UNLOCKED',
          device: buildDeviceInfo(config, device),
          availability: buildAvailability(config, device),
        },
      },
    ];
  },

  buildState(_config: Config, device: ArcusDevice): Record<string, unknown> {
    return {
      lock: device.attributes[DoorLock.ATTR_LOCKSTATE] ?? DoorLock.LOCKSTATE_LOCKED,
    };
  },

  handleCommand(
    _config: Config,
    device: ArcusDevice,
    entity: string,
    payload: string,
  ): ArcusAttributes | null {
    if (entity !== 'lock') return null;
    const cmd = payload.toUpperCase();
    if (cmd === 'LOCK') return { [DoorLock.ATTR_LOCKSTATE]: DoorLock.LOCKSTATE_LOCKED };
    if (cmd === 'UNLOCK') return { [DoorLock.ATTR_LOCKSTATE]: DoorLock.LOCKSTATE_UNLOCKED };
    return null;
  },
};
