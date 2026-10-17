import type { ArcusDevice, ArcusAttributes } from '../arcus/types.js';
import { DeviceAdvanced, DoorLock } from '../arcus/capabilities.js';
import type { Config } from '../config.js';
import type { HADiscoveryConfig } from '../ha/discovery.js';
import { buildDeviceInfo, buildAvailability } from '../ha/discovery.js';
import { discoveryTopic, stateTopic, commandTopic, deviceId } from '../ha/topics.js';
import type { Mapper } from './index.js';

/**
 * The devadv:errors key Arcus lock drivers set on a jam, or when a lock or unlock doesn't finish in
 * time. The lockstate is left as it was (often stuck at LOCKING); the driver clears the error when
 * the lock next reports LOCKED or UNLOCKED.
 */
const ERROR_JAM = 'WARN_JAM';
const STATE_JAMMED = 'JAMMED';

function isJammed(device: ArcusDevice): boolean {
  const errors = device.attributes[DeviceAdvanced.ATTR_ERRORS];
  return typeof errors === 'object' && !Array.isArray(errors) && ERROR_JAM in errors;
}

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
          state_locked: DoorLock.LOCKSTATE_LOCKED,
          state_unlocked: DoorLock.LOCKSTATE_UNLOCKED,
          state_locking: DoorLock.LOCKSTATE_LOCKING,
          state_unlocking: DoorLock.LOCKSTATE_UNLOCKING,
          state_jammed: STATE_JAMMED,
          device: buildDeviceInfo(config, device),
          ...buildAvailability(config, device),
        },
      },
    ];
  },

  buildState(_config: Config, device: ArcusDevice): Record<string, unknown> {
    return {
      lock: isJammed(device)
        ? STATE_JAMMED
        : device.attributes[DoorLock.ATTR_LOCKSTATE] ?? DoorLock.LOCKSTATE_LOCKED,
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
