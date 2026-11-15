import type { ArcusDevice, ArcusAttributes } from '../arcus/types.js';
import { MotorizedDoor } from '../arcus/capabilities.js';
import type { Config } from '../config.js';
import type { HADiscoveryConfig } from '../ha/discovery.js';
import { buildDeviceInfo, buildAvailability } from '../ha/discovery.js';
import { discoveryTopic, stateTopic, commandTopic, deviceId } from '../ha/topics.js';
import type { Mapper } from './index.js';

/** Maps Arcus motdoor (garage door opener) → HA cover (device_class: garage) */
export const coverMapper: Mapper = {
  matches(device: ArcusDevice): boolean {
    return device.caps.has(MotorizedDoor.NAMESPACE);
  },

  buildDiscovery(config: Config, device: ArcusDevice): HADiscoveryConfig[] {
    const id = deviceId(device.address);
    const objectId = `${id}_door`;

    return [
      {
        topic: discoveryTopic(config, 'cover', objectId),
        payload: {
          name: null,
          unique_id: objectId,
          device_class: 'garage',
          state_topic: stateTopic(config, device.address),
          command_topic: commandTopic(config, device.address, 'door'),
          value_template: '{{ value_json.door }}',
          state_open: MotorizedDoor.DOORSTATE_OPEN,
          state_opening: MotorizedDoor.DOORSTATE_OPENING,
          state_closed: MotorizedDoor.DOORSTATE_CLOSED,
          state_closing: MotorizedDoor.DOORSTATE_CLOSING,
          payload_open: 'OPEN',
          payload_close: 'CLOSE',
          // Motorized doors can't stop mid-travel; hide the stop button
          payload_stop: null,
          device: buildDeviceInfo(config, device),
          ...buildAvailability(config, device),
        },
      },
    ];
  },

  buildState(_config: Config, device: ArcusDevice): Record<string, unknown> {
    // OBSTRUCTION isn't a valid HA cover state; it renders as unknown until it clears.
    return {
      door: device.attributes[MotorizedDoor.ATTR_DOORSTATE] ?? MotorizedDoor.DOORSTATE_CLOSED,
    };
  },

  handleCommand(
    _config: Config,
    device: ArcusDevice,
    entity: string,
    payload: string,
  ): ArcusAttributes | null {
    if (entity !== 'door') return null;
    const cmd = payload.toUpperCase();
    if (cmd === 'OPEN') return { [MotorizedDoor.ATTR_DOORSTATE]: MotorizedDoor.DOORSTATE_OPEN };
    if (cmd === 'CLOSE') return { [MotorizedDoor.ATTR_DOORSTATE]: MotorizedDoor.DOORSTATE_CLOSED };
    return null;
  },
};
