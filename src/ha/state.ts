import type { Mqtt } from '../mqtt.js';
import type { ArcusDevice } from '../arcus/types.js';
import type { Config } from '../config.js';
import { DeviceConnection, Hub, HubConnection } from '../arcus/capabilities.js';
import { matchingMappers } from '../mappers/index.js';
import { stateTopic, availabilityTopic, bridgeAvailabilityTopic, hubConnectionTopic } from './topics.js';

/** Publish the combined JSON state for a device across all matching mappers */
export function publishState(
  mqtt: Mqtt,
  config: Config,
  device: ArcusDevice,
): void {
  const matched = matchingMappers(device);
  if (matched.length === 0) return;

  // Merge state from all matching mappers into one JSON object
  let state: Record<string, unknown> = {};
  for (const mapper of matched) {
    state = { ...state, ...mapper.buildState(config, device) };
  }

  const topic = stateTopic(config, device.address);
  const payload = JSON.stringify(state);

  mqtt.publish(topic, payload, true);
}

/** A device is online unless Arcus reports its connection as OFFLINE */
export function isDeviceOnline(device: ArcusDevice): boolean {
  return device.attributes[DeviceConnection.ATTR_STATE] !== DeviceConnection.STATE_OFFLINE;
}

/** Publish availability for a device, following devconn:state */
export function publishAvailability(
  mqtt: Mqtt,
  config: Config,
  device: ArcusDevice,
): void {
  const topic = availabilityTopic(config, device.address);
  const online = isDeviceOnline(device);

  mqtt.publish(topic, online ? 'online' : 'offline', true);
}

/** Publish the bridge-wide availability (whether the Arcus connection is up) */
export function publishBridgeAvailability(mqtt: Mqtt, config: Config, online: boolean): void {
  mqtt.publish(bridgeAvailabilityTopic(config), online ? 'online' : 'offline', true);
}

/** Publish whether the hub is connected, which gates the availability of its Zigbee/Z-Wave devices */
export function publishHubConnection(mqtt: Mqtt, config: Config, hub: ArcusDevice): void {
  const online = hub.attributes[HubConnection.ATTR_STATE] === HubConnection.STATE_ONLINE;
  mqtt.publish(hubConnectionTopic(config, hub.address), online ? 'online' : 'offline', true);
}

/** Clear a removed device's retained state and availability so nothing stale lingers on the broker */
export function clearDeviceTopics(mqtt: Mqtt, config: Config, device: ArcusDevice): void {
  const topics = [stateTopic(config, device.address), availabilityTopic(config, device.address)];
  if (device.caps.has(Hub.NAMESPACE)) topics.push(hubConnectionTopic(config, device.address));

  for (const topic of topics) {
    mqtt.publish(topic, '', true);
  }
}
