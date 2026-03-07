import type { ArcusDevice, ArcusAttributes } from '../arcus/types.js';
import { Switch, Dimmer } from '../arcus/capabilities.js';
import type { Config } from '../config.js';
import type { HADiscoveryConfig } from '../ha/discovery.js';
import { buildDeviceInfo, buildAvailability } from '../ha/discovery.js';
import { discoveryTopic, stateTopic, commandTopic, deviceId } from '../ha/topics.js';
import type { Mapper } from './index.js';

/** Maps Arcus swit (without dim) → HA switch */
export const switchMapper: Mapper = {
  matches(device: ArcusDevice): boolean {
    return device.caps.has(Switch.NAMESPACE) && !device.caps.has(Dimmer.NAMESPACE);
  },

  buildDiscovery(config: Config, device: ArcusDevice): HADiscoveryConfig[] {
    const id = deviceId(device.address);
    const objectId = `${id}_switch`;

    return [
      {
        topic: discoveryTopic(config, 'switch', objectId),
        payload: {
          name: device.name,
          unique_id: objectId,
          object_id: objectId,
          state_topic: stateTopic(config, device.address),
          command_topic: commandTopic(config, device.address, 'switch'),
          value_template: '{{ value_json.switch }}',
          payload_on: 'ON',
          payload_off: 'OFF',
          state_on: 'ON',
          state_off: 'OFF',
          device: buildDeviceInfo(config, device),
          availability: buildAvailability(config, device),
        },
      },
    ];
  },

  buildState(_config: Config, device: ArcusDevice): Record<string, unknown> {
    return {
      switch: device.attributes[Switch.ATTR_STATE] ?? 'OFF',
    };
  },

  handleCommand(
    _config: Config,
    device: ArcusDevice,
    entity: string,
    payload: string,
  ): ArcusAttributes | null {
    if (entity !== 'switch') return null;
    const value = payload.toUpperCase();
    if (value !== 'ON' && value !== 'OFF') return null;
    return { [Switch.ATTR_STATE]: value };
  },
};
