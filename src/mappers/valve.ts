import type { ArcusDevice, ArcusAttributes } from '../arcus/types.js';
import { Valve } from '../arcus/capabilities.js';
import type { Config } from '../config.js';
import type { HADiscoveryConfig } from '../ha/discovery.js';
import { buildDeviceInfo, buildAvailability } from '../ha/discovery.js';
import { discoveryTopic, stateTopic, commandTopic, deviceId } from '../ha/topics.js';
import type { Mapper } from './index.js';

/** Maps Arcus valv (e.g. a water shutoff) → HA valve (device_class: water) */
export const valveMapper: Mapper = {
  matches(device: ArcusDevice): boolean {
    return device.caps.has(Valve.NAMESPACE);
  },

  buildDiscovery(config: Config, device: ArcusDevice): HADiscoveryConfig[] {
    const id = deviceId(device.address);
    const objectId = `${id}_valve`;

    return [
      {
        topic: discoveryTopic(config, 'valve', objectId),
        payload: {
          name: null,
          unique_id: objectId,
          device_class: 'water',
          state_topic: stateTopic(config, device.address),
          value_template: '{{ value_json.valve }}',
          command_topic: commandTopic(config, device.address, 'valve'),
          payload_open: 'OPEN',
          payload_close: 'CLOSE',
          // Arcus valves can't stop mid-travel
          payload_stop: null,
          state_open: Valve.VALVESTATE_OPEN,
          state_opening: Valve.VALVESTATE_OPENING,
          state_closed: Valve.VALVESTATE_CLOSED,
          state_closing: Valve.VALVESTATE_CLOSING,
          device: buildDeviceInfo(config, device),
          ...buildAvailability(config, device),
        },
      },
    ];
  },

  buildState(_config: Config, device: ArcusDevice): Record<string, unknown> {
    const state = device.attributes[Valve.ATTR_VALVESTATE];
    // OBSTRUCTION has no HA equivalent; "None" makes HA show the state as unknown
    return { valve: state === Valve.VALVESTATE_OBSTRUCTION || state === undefined ? 'None' : state };
  },

  handleCommand(
    _config: Config,
    _device: ArcusDevice,
    entity: string,
    payload: string,
  ): ArcusAttributes | null {
    if (entity !== 'valve') return null;
    const cmd = payload.toUpperCase();
    if (cmd === 'OPEN') return { [Valve.ATTR_VALVESTATE]: Valve.VALVESTATE_OPEN };
    if (cmd === 'CLOSE') return { [Valve.ATTR_VALVESTATE]: Valve.VALVESTATE_CLOSED };
    return null;
  },
};
