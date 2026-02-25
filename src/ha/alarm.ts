import type { Broker } from '../broker.js';
import type { ArcusClient } from '../arcus/client.js';
import type { AlarmState } from '../arcus/types.js';
import type { Config } from '../config.js';
import { discoveryTopic } from './topics.js';

const ALARM_STATE_TOPIC = 'arcus/alarm/state';
const ALARM_COMMAND_TOPIC = 'arcus/alarm/set';
const ALARM_AVAILABILITY_TOPIC = 'arcus/alarm/availability';

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

export function publishAlarmDiscovery(broker: Broker, config: Config): void {
  const topic = discoveryTopic(config, 'alarm_control_panel', 'alarm');
  const payload = {
    name: 'Security Alarm',
    unique_id: `${config.deviceIdPrefix}_alarm`,
    object_id: `${config.deviceIdPrefix}_alarm`,
    state_topic: ALARM_STATE_TOPIC,
    command_topic: ALARM_COMMAND_TOPIC,
    availability_topic: ALARM_AVAILABILITY_TOPIC,
    payload_available: 'online',
    payload_not_available: 'offline',
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

  broker.publish(
    {
      cmd: 'publish',
      topic,
      payload: Buffer.from(JSON.stringify(payload)),
      qos: 0,
      dup: false,
      retain: true,
    },
    () => {},
  );
}

export function publishAlarmState(broker: Broker, alarm: AlarmState): void {
  const state = mapAlarmState(alarm);

  broker.publish(
    {
      cmd: 'publish',
      topic: ALARM_STATE_TOPIC,
      payload: Buffer.from(state),
      qos: 0,
      dup: false,
      retain: true,
    },
    () => {},
  );
}

export function publishAlarmAvailability(broker: Broker, online: boolean): void {
  broker.publish(
    {
      cmd: 'publish',
      topic: ALARM_AVAILABILITY_TOPIC,
      payload: Buffer.from(online ? 'online' : 'offline'),
      qos: 0,
      dup: false,
      retain: true,
    },
    () => {},
  );
}

export function setupAlarmCommandHandler(broker: Broker, client: ArcusClient): void {
  const refreshState = async () => {
    try {
      const state = await client.getAlarmState();
      publishAlarmState(broker, state);
    } catch (err) {
      console.error('[Alarm] Failed to refresh state:', err);
    }
  };

  broker.on('publish', (packet, _client) => {
    if (packet.topic !== ALARM_COMMAND_TOPIC) return;
    const command = packet.payload.toString();

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
