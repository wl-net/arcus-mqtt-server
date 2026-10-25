import type { ArcusDevice, ArcusAttributes } from '../arcus/types.js';
import { Alert } from '../arcus/capabilities.js';
import type { Config } from '../config.js';
import { Features, hasFeature } from '../config.js';
import type { HADiscoveryConfig } from '../ha/discovery.js';
import { buildDeviceInfo, buildAvailability } from '../ha/discovery.js';
import { discoveryTopic, stateTopic, commandTopic, deviceId } from '../ha/topics.js';
import type { Mapper } from './index.js';

/**
 * Keypads and smoke listeners have the alert capability too, for their own sounders;
 * only devices Arcus types as sirens get a siren entity
 */
const SIREN_TYPE = 'Siren';

/**
 * Maps Arcus alert on sirens → HA siren, with the sirens feature on. Setting alert:state
 * sounds or silences the siren; the drivers don't turn it off by themselves, so a siren
 * turned on stays on until something turns it off.
 */
export const sirenMapper: Mapper = {
  matches(device: ArcusDevice): boolean {
    return device.caps.has(Alert.NAMESPACE) && device.type === SIREN_TYPE;
  },

  buildDiscovery(config: Config, device: ArcusDevice): HADiscoveryConfig[] {
    if (!hasFeature(config, Features.SIRENS)) return [];
    const id = deviceId(device.address);
    const objectId = `${id}_siren`;
    return [
      {
        topic: discoveryTopic(config, 'siren', objectId),
        payload: {
          name: null,
          unique_id: objectId,
          object_id: objectId,
          state_topic: stateTopic(config, device.address),
          // HA's MQTT siren reads state_value_template; it ignores value_template
          state_value_template: '{{ value_json.siren }}',
          command_topic: commandTopic(config, device.address, 'siren'),
          payload_on: 'ON',
          payload_off: 'OFF',
          support_duration: false,
          support_volume_set: false,
          device: buildDeviceInfo(config, device),
          ...buildAvailability(config, device),
        },
      },
    ];
  },

  buildState(config: Config, device: ArcusDevice): Record<string, unknown> {
    if (!hasFeature(config, Features.SIRENS)) return {};
    return { siren: device.attributes[Alert.ATTR_STATE] === Alert.STATE_ALERTING ? 'ON' : 'OFF' };
  },

  handleCommand(
    config: Config,
    _device: ArcusDevice,
    entity: string,
    payload: string,
  ): ArcusAttributes | null {
    if (entity !== 'siren' || !hasFeature(config, Features.SIRENS)) return null;
    if (payload === 'ON') return { [Alert.ATTR_STATE]: Alert.STATE_ALERTING };
    if (payload === 'OFF') return { [Alert.ATTR_STATE]: Alert.STATE_QUIET };
    return null;
  },
};
