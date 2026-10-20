import type { Mqtt } from '../mqtt.js';
import type { ArcusDevice, PersonInfo } from '../arcus/types.js';
import { DoorLock } from '../arcus/capabilities.js';
import type { Config } from '../config.js';
import { Features, hasFeature } from '../config.js';
import { accessEntity, peopleOnLock } from '../mappers/lock.js';
import type { HADiscoveryConfig } from './discovery.js';
import { buildDeviceInfo, buildAvailability, syncOwnedDiscovery } from './discovery.js';
import { discoveryTopic, stateTopic, commandTopic, deviceId } from './topics.js';

/** Discovery owner for all access switches, which follow both the locks and the person list */
const OWNER = 'lock-access';

/**
 * A switch on a lock for one person: on while their Arcus PIN is on the lock. Turning it on or
 * off adds or removes the PIN (doorlock:AuthorizePerson / DeauthorizePerson, in the lock mapper).
 * It's a config entity, so dashboards and HomeKit Bridge leave it out unless you add it.
 */
function accessSwitch(config: Config, lock: ArcusDevice, person: PersonInfo): HADiscoveryConfig {
  const objectId = `${deviceId(lock.address)}_access_${person.id}`;
  return {
    topic: discoveryTopic(config, 'switch', objectId),
    payload: {
      name: `${person.name} access`,
      unique_id: objectId,
      object_id: objectId,
      state_topic: stateTopic(config, lock.address),
      value_template: `{{ 'ON' if '${person.id}' in (value_json.access | default([])) else 'OFF' }}`,
      command_topic: commandTopic(config, lock.address, accessEntity(person.id)),
      payload_on: 'ON',
      payload_off: 'OFF',
      entity_category: 'config',
      device: buildDeviceInfo(config, lock),
      ...buildAvailability(config, lock),
    },
  };
}

/**
 * Publish an access switch on each lock for each person with a PIN at the place, and for anyone
 * whose PIN is already on that lock so it can be removed. With the lock_access feature off, this
 * removes them.
 */
export function publishLockAccessDiscovery(
  mqtt: Mqtt,
  config: Config,
  devices: Iterable<ArcusDevice>,
  people: PersonInfo[],
): void {
  const configs: HADiscoveryConfig[] = [];
  if (hasFeature(config, Features.LOCK_ACCESS)) {
    for (const lock of devices) {
      if (!lock.caps.has(DoorLock.NAMESPACE)) continue;
      const onLock = new Set(peopleOnLock(lock));
      for (const person of people) {
        if (person.hasPin || onLock.has(person.id)) configs.push(accessSwitch(config, lock, person));
      }
    }
  }
  syncOwnedDiscovery(mqtt, OWNER, configs);
}
