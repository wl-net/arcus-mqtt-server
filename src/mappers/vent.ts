import type { ArcusDevice, ArcusAttributes } from '../arcus/types.js';
import { Vent } from '../arcus/capabilities.js';
import type { Config } from '../config.js';
import type { HADiscoveryConfig } from '../ha/discovery.js';
import { buildDeviceInfo, buildAvailability } from '../ha/discovery.js';
import { discoveryTopic, stateTopic, commandTopic, deviceId } from '../ha/topics.js';
import type { Mapper } from './index.js';

/**
 * Maps Arcus vent (smart vents such as Keen) → HA cover (device_class: damper) with
 * position, plus diagnostic obstruction and duct pressure sensors.
 * vent:level is 0 (closed) to 100 (open); vent:airpressure is in kPa and optional.
 */
export const ventMapper: Mapper = {
  matches(device: ArcusDevice): boolean {
    return device.caps.has(Vent.NAMESPACE);
  },

  buildDiscovery(config: Config, device: ArcusDevice): HADiscoveryConfig[] {
    const id = deviceId(device.address);
    const common = {
      device: buildDeviceInfo(config, device),
      ...buildAvailability(config, device),
    };
    const configs: HADiscoveryConfig[] = [
      {
        topic: discoveryTopic(config, 'cover', `${id}_vent`),
        payload: {
          name: null,
          unique_id: `${id}_vent`,
          object_id: `${id}_vent`,
          device_class: 'damper',
          command_topic: commandTopic(config, device.address, 'vent'),
          payload_open: 'OPEN',
          payload_close: 'CLOSE',
          // Vents can't be stopped mid-travel through attribute sets
          payload_stop: null,
          position_topic: stateTopic(config, device.address),
          position_template: '{{ value_json.vent_position }}',
          set_position_topic: commandTopic(config, device.address, 'vent_position'),
          ...common,
        },
      },
      {
        // Something is stopping the vent from opening or closing
        topic: discoveryTopic(config, 'binary_sensor', `${id}_vent_obstruction`),
        payload: {
          name: 'Obstruction',
          unique_id: `${id}_vent_obstruction`,
          object_id: `${id}_vent_obstruction`,
          state_topic: stateTopic(config, device.address),
          value_template: '{{ value_json.vent_obstruction }}',
          payload_on: 'ON',
          payload_off: 'OFF',
          device_class: 'problem',
          entity_category: 'diagnostic',
          ...common,
        },
      },
    ];

    if (device.attributes[Vent.ATTR_AIRPRESSURE] !== undefined) {
      configs.push({
        topic: discoveryTopic(config, 'sensor', `${id}_vent_pressure`),
        payload: {
          name: 'Duct pressure',
          unique_id: `${id}_vent_pressure`,
          object_id: `${id}_vent_pressure`,
          state_topic: stateTopic(config, device.address),
          value_template: '{{ value_json.vent_pressure }}',
          device_class: 'pressure',
          unit_of_measurement: 'kPa',
          state_class: 'measurement',
          entity_category: 'diagnostic',
          ...common,
        },
      });
    }

    return configs;
  },

  buildState(_config: Config, device: ArcusDevice): Record<string, unknown> {
    const attrs = device.attributes;
    const state: Record<string, unknown> = {
      vent_obstruction: attrs[Vent.ATTR_VENTSTATE] === Vent.VENTSTATE_OBSTRUCTION ? 'ON' : 'OFF',
    };
    if (typeof attrs[Vent.ATTR_LEVEL] === 'number') state.vent_position = attrs[Vent.ATTR_LEVEL];
    if (typeof attrs[Vent.ATTR_AIRPRESSURE] === 'number') state.vent_pressure = attrs[Vent.ATTR_AIRPRESSURE];
    return state;
  },

  handleCommand(
    _config: Config,
    _device: ArcusDevice,
    entity: string,
    payload: string,
  ): ArcusAttributes | null {
    if (entity === 'vent') {
      const cmd = payload.toUpperCase();
      if (cmd === 'OPEN') return { [Vent.ATTR_LEVEL]: 100 };
      if (cmd === 'CLOSE') return { [Vent.ATTR_LEVEL]: 0 };
      return null;
    }
    if (entity === 'vent_position') {
      const position = Number(payload);
      if (!Number.isFinite(position)) return null;
      return { [Vent.ATTR_LEVEL]: Math.round(Math.min(100, Math.max(0, position))) };
    }
    return null;
  },
};
