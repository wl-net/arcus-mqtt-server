import type { ArcusDevice, ArcusAttributes, ArcusMethodCall } from '../arcus/types.js';
import { DeviceAdvanced, DoorLock } from '../arcus/capabilities.js';
import type { Config } from '../config.js';
import { Features, hasFeature } from '../config.js';
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

/** Access switch entities: access_<person ID> */
const ACCESS_ENTITY = /^access_([0-9a-fA-F-]+)$/;

/**
 * Buzz in (doorlock:BuzzIn) unlocks a locked door and has the driver lock it again shortly
 * after (45 seconds on Schlage deadbolts); it does nothing if the door is already unlocked.
 * Only offered with the buzz_in feature on.
 */
function supportsBuzzIn(config: Config, device: ArcusDevice): boolean {
  return hasFeature(config, Features.BUZZ_IN) && device.attributes[DoorLock.ATTR_SUPPORTSBUZZIN] === true;
}

/**
 * The people whose PIN is on the lock. doorlock:slots maps slot number → person ID; the driver
 * adds a person as soon as it's asked to, and removes them once the lock reports the PIN gone.
 */
export function peopleOnLock(device: ArcusDevice): string[] {
  const slots = device.attributes[DoorLock.ATTR_SLOTS];
  if (typeof slots !== 'object' || Array.isArray(slots)) return [];
  return [...new Set(Object.values(slots))].sort();
}

/** Command entity for a person's access switch on a lock */
export function accessEntity(personId: string): string {
  return `access_${personId}`;
}

function isJammed(device: ArcusDevice): boolean {
  const errors = device.attributes[DeviceAdvanced.ATTR_ERRORS];
  return typeof errors === 'object' && !Array.isArray(errors) && ERROR_JAM in errors;
}

/**
 * Maps Arcus doorlock → HA lock. With the buzz_in feature, also a buzz-in button where supported;
 * with lock_access, the state and commands for the per-person access switches (discovery:
 * ha/lock-access.ts).
 */
export const lockMapper: Mapper = {
  matches(device: ArcusDevice): boolean {
    return device.caps.has(DoorLock.NAMESPACE);
  },

  buildDiscovery(config: Config, device: ArcusDevice): HADiscoveryConfig[] {
    const id = deviceId(device.address);
    const objectId = `${id}_lock`;

    const configs: HADiscoveryConfig[] = [
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

    if (supportsBuzzIn(config, device)) {
      const buttonId = `${id}_buzz_in`;
      configs.push({
        topic: discoveryTopic(config, 'button', buttonId),
        payload: {
          name: 'Buzz in',
          unique_id: buttonId,
          object_id: buttonId,
          command_topic: commandTopic(config, device.address, 'buzz_in'),
          payload_press: 'PRESS',
          device: buildDeviceInfo(config, device),
          ...buildAvailability(config, device),
        },
      });
    }

    return configs;
  },

  buildState(config: Config, device: ArcusDevice): Record<string, unknown> {
    const state: Record<string, unknown> = {
      lock: isJammed(device)
        ? STATE_JAMMED
        : device.attributes[DoorLock.ATTR_LOCKSTATE] ?? DoorLock.LOCKSTATE_LOCKED,
    };
    if (hasFeature(config, Features.LOCK_ACCESS)) state.access = peopleOnLock(device);
    return state;
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

  handleMethodCommand(
    config: Config,
    device: ArcusDevice,
    entity: string,
    payload: string,
  ): ArcusMethodCall | null {
    if (entity === 'buzz_in') {
      if (payload !== 'PRESS' || !supportsBuzzIn(config, device)) return null;
      return { method: DoorLock.CMD_BUZZIN, args: {} };
    }

    const access = ACCESS_ENTITY.exec(entity);
    if (!access || !hasFeature(config, Features.LOCK_ACCESS)) return null;
    const personId = access[1];
    // The driver programs the person's Arcus PIN into a free slot, or clears their slot
    if (payload === 'ON') return { method: DoorLock.CMD_AUTHORIZEPERSON, args: { personId } };
    // Only a person who's on the lock can be removed; the driver errors otherwise
    if (payload === 'OFF' && peopleOnLock(device).includes(personId)) {
      return { method: DoorLock.CMD_DEAUTHORIZEPERSON, args: { personId } };
    }
    return null;
  },
};
