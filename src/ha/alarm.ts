import type { Mqtt } from '../mqtt.js';
import type { ArcusClient } from '../arcus/client.js';
import type { AlarmState } from '../arcus/types.js';
import type { Config } from '../config.js';
import { discoveryTopic, bridgeAvailabilityTopic } from './topics.js';
import { publishDiscoveryConfig } from './discovery.js';

/** Alarm topics: arcus/alarm/state, arcus/alarm/set, ... */
function alarmTopics(config: Config) {
  const base = `${config.deviceIdPrefix}/alarm`;
  return {
    state: `${base}/state`,
    command: `${base}/set`,
    availability: `${base}/availability`,
    attributes: `${base}/attributes`,
  };
}

/** Resolves a device address to its display name */
export type DeviceNameLookup = (address: string) => string;

function mapAlarmState(alarm: AlarmState): string {
  switch (alarm.securityMode) {
    case 'ARMING':
      return 'arming';
    case 'ARMED':
      return alarm.alarmMode === 'PARTIAL' ? 'armed_home' : 'armed_away';
    case 'SOAKING':
      return 'pending';
    case 'ALERT':
    case 'CLEARING':
      return 'triggered';
    case 'DISARMED':
    default:
      return 'disarmed';
  }
}

export function publishAlarmDiscovery(mqtt: Mqtt, config: Config): void {
  const topics = alarmTopics(config);
  const topic = discoveryTopic(config, 'alarm_control_panel', 'alarm');
  const payload = {
    name: 'Security Alarm',
    unique_id: `${config.deviceIdPrefix}_alarm`,
    object_id: `${config.deviceIdPrefix}_alarm`,
    state_topic: topics.state,
    command_topic: topics.command,
    // Available only while both the bridge's Arcus connection and the alarm state fetch are good
    availability: [
      { topic: bridgeAvailabilityTopic(config), payload_available: 'online', payload_not_available: 'offline' },
      { topic: topics.availability, payload_available: 'online', payload_not_available: 'offline' },
    ],
    availability_mode: 'all',
    json_attributes_topic: topics.attributes,
    supported_features: ['arm_home', 'arm_away'],
    code_arm_required: false,
    code_disarm_required: false,
    device: {
      identifiers: [`${config.deviceIdPrefix}_alarm`],
      name: 'Arcus Security',
      model: 'Security Subsystem',
      manufacturer: 'Arcus',
    },
  };

  publishDiscoveryConfig(mqtt, topic, payload);

  // On while the alarm is armed with sensors excluded (e.g. a window left open),
  // so HA can notify about it. Attributes list the bypassed sensors by name.
  publishDiscoveryConfig(mqtt, discoveryTopic(config, 'binary_sensor', 'alarm_bypassed'), {
    name: 'Bypassed sensors',
    unique_id: `${config.deviceIdPrefix}_alarm_bypassed`,
    object_id: `${config.deviceIdPrefix}_alarm_bypassed`,
    state_topic: topics.attributes,
    value_template: '{{ value_json.bypassed }}',
    payload_on: 'ON',
    payload_off: 'OFF',
    json_attributes_topic: topics.attributes,
    json_attributes_template: '{{ {"bypassed_sensors": value_json.bypassed_sensors} | tojson }}',
    device_class: 'problem',
    availability: payload.availability,
    availability_mode: 'all',
    device: payload.device,
  });
}

export function publishAlarmState(mqtt: Mqtt, config: Config, alarm: AlarmState, nameOf: DeviceNameLookup): void {
  const topics = alarmTopics(config);
  const state = mapAlarmState(alarm);

  // Bypasses only matter while the alarm is (being) armed
  const bypassed = alarm.securityMode === 'DISARMED' ? [] : alarm.bypassedDevices.map(nameOf);
  mqtt.publish(topics.attributes, JSON.stringify({
    bypassed: bypassed.length > 0 ? 'ON' : 'OFF',
    bypassed_sensors: bypassed,
  }), true);

  mqtt.publish(topics.state, state, true);
}

export function publishAlarmAvailability(mqtt: Mqtt, config: Config, online: boolean): void {
  mqtt.publish(alarmTopics(config).availability, online ? 'online' : 'offline', true);
}

export function setupAlarmCommandHandler(mqtt: Mqtt, config: Config, client: ArcusClient, nameOf: DeviceNameLookup): void {
  const refreshState = async () => {
    try {
      const state = await client.getAlarmState();
      publishAlarmState(mqtt, config, state, nameOf);
    } catch (err) {
      console.error('[Alarm] Failed to refresh state:', err);
    }
  };

  mqtt.subscribe(alarmTopics(config).command, (_topic, command) => {
    switch (command) {
      case 'ARM_AWAY':
        console.log('[Alarm] Command: ARM_AWAY');
        client.armAlarm('ON').then(refreshState, err => {
          console.error('[Alarm] Failed to arm (away):', err);
        });
        break;
      case 'ARM_HOME':
        console.log('[Alarm] Command: ARM_HOME');
        client.armAlarm('PARTIAL').then(refreshState, err => {
          console.error('[Alarm] Failed to arm (home):', err);
        });
        break;
      case 'DISARM':
        console.log('[Alarm] Command: DISARM');
        client.disarmAlarm().then(refreshState, err => {
          console.error('[Alarm] Failed to disarm:', err);
        });
        break;
      default:
        console.warn(`[Alarm] Unknown command: ${command}`);
    }
  });
}
