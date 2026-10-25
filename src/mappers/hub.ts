import type { ArcusDevice } from '../arcus/types.js';
import { Hub, HubConnection, HubPower } from '../arcus/capabilities.js';
import type { Config } from '../config.js';
import type { HADiscoveryConfig } from '../ha/discovery.js';
import { buildDeviceInfo, buildAvailability } from '../ha/discovery.js';
import { discoveryTopic, stateTopic, deviceId } from '../ha/topics.js';
import type { Mapper } from './index.js';

/**
 * Maps the Arcus hub → HA binary_sensor (connectivity, mains power) + sensor (battery).
 * The hub has no devconn, so these stay available while the hub itself is offline,
 * which is what lets the connectivity sensor report it.
 */
export const hubMapper: Mapper = {
  matches(device: ArcusDevice): boolean {
    return device.caps.has(Hub.NAMESPACE);
  },

  buildDiscovery(config: Config, device: ArcusDevice): HADiscoveryConfig[] {
    const id = deviceId(device.address);
    const common = {
      state_topic: stateTopic(config, device.address),
      device: buildDeviceInfo(config, device),
      ...buildAvailability(config, device),
    };
    const configs: HADiscoveryConfig[] = [
      {
        topic: discoveryTopic(config, 'binary_sensor', `${id}_connectivity`),
        payload: {
          name: 'Connectivity',
          unique_id: `${id}_connectivity`,
          object_id: `${id}_connectivity`,
          value_template: '{{ value_json.connectivity }}',
          payload_on: 'ON',
          payload_off: 'OFF',
          device_class: 'connectivity',
          entity_category: 'diagnostic',
          ...common,
        },
      },
    ];

    if (device.caps.has(HubPower.NAMESPACE)) {
      configs.push(
        {
          // ON while on mains; OFF means the hub is running on battery (power cut)
          topic: discoveryTopic(config, 'binary_sensor', `${id}_mains_power`),
          payload: {
            name: 'Mains power',
            unique_id: `${id}_mains_power`,
            object_id: `${id}_mains_power`,
            value_template: '{{ value_json.mains_power }}',
            payload_on: 'ON',
            payload_off: 'OFF',
            device_class: 'power',
            ...common,
          },
        },
        {
          topic: discoveryTopic(config, 'sensor', `${id}_battery`),
          payload: {
            name: 'Battery',
            unique_id: `${id}_battery`,
            object_id: `${id}_battery`,
            value_template: '{{ value_json.battery }}',
            device_class: 'battery',
            unit_of_measurement: '%',
            state_class: 'measurement',
            entity_category: 'diagnostic',
            ...common,
          },
        },
      );
    }

    return configs;
  },

  buildState(_config: Config, device: ArcusDevice): Record<string, unknown> {
    const attrs = device.attributes;
    const state: Record<string, unknown> = {
      connectivity: attrs[HubConnection.ATTR_STATE] === HubConnection.STATE_ONLINE ? 'ON' : 'OFF',
    };

    if (device.caps.has(HubPower.NAMESPACE)) {
      state.mains_power = attrs[HubPower.ATTR_SOURCE] === HubPower.SOURCE_BATTERY ? 'OFF' : 'ON';
      if (attrs[HubPower.ATTR_BATTERY] !== undefined) {
        state.battery = attrs[HubPower.ATTR_BATTERY];
      }
    }

    return state;
  },

  retiredTopics(config: Config): string[] {
    // Before 0.2.5 every hub's ID was "hub", the last part of its SERV:<hub id>:hub address,
    // so a second place's hub entities clashed with the first's
    const old = 'hub';
    return [
      discoveryTopic(config, 'binary_sensor', `${old}_connectivity`),
      discoveryTopic(config, 'binary_sensor', `${old}_mains_power`),
      discoveryTopic(config, 'sensor', `${old}_battery`),
      `${config.deviceIdPrefix}/${old}/state`,
      `${config.deviceIdPrefix}/${old}/availability`,
      `${config.deviceIdPrefix}/${old}/connection`,
    ];
  },

  handleCommand(): null {
    return null; // Hub status entities have no commands
  },
};
