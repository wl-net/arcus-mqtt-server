import type { Mqtt } from '../mqtt.js';
import type { ArcusDevice } from '../arcus/types.js';
import { Device, Hub } from '../arcus/capabilities.js';
import type { Config } from '../config.js';
import { deviceId, availabilityTopic, bridgeAvailabilityTopic, hubConnectionTopic } from './topics.js';

export interface HADiscoveryConfig {
  /** HA MQTT Discovery topic */
  topic: string;
  /** JSON payload for the config message */
  payload: Record<string, unknown>;
}

export interface HADeviceInfo {
  identifiers: string[];
  name: string;
  model: string;
  manufacturer: string;
  via_device?: string;
}

function deviceIdentifier(config: Config, address: string): string {
  return `${config.deviceIdPrefix}_${deviceId(address)}`;
}

export function buildDeviceInfo(config: Config, device: ArcusDevice): HADeviceInfo {
  const attrs = device.attributes;
  const vendor = attrs[Device.ATTR_VENDOR] ?? attrs[Hub.ATTR_VENDOR];
  const model = attrs[Device.ATTR_MODEL] ?? attrs[Hub.ATTR_MODEL];

  const info: HADeviceInfo = {
    identifiers: [deviceIdentifier(config, device.address)],
    name: device.name,
    model: model ? String(model) : device.type,
    manufacturer: vendor ? String(vendor) : 'Arcus',
  };
  if (device.hubAddress) {
    info.via_device = deviceIdentifier(config, device.hubAddress);
  }
  return info;
}

/**
 * Availability fields for a discovery payload. An entity is available only while
 * the bridge's Arcus connection, the device itself, and (for hub-paired devices)
 * the hub are all online.
 */
export function buildAvailability(config: Config, device: ArcusDevice) {
  const topics = [bridgeAvailabilityTopic(config), availabilityTopic(config, device.address)];
  if (device.hubAddress) topics.push(hubConnectionTopic(config, device.hubAddress));

  return {
    availability: topics.map(topic => ({
      topic,
      payload_available: 'online',
      payload_not_available: 'offline',
    })),
    availability_mode: 'all',
  };
}

interface DiscoveryCache {
  /** Last payload published per discovery topic, so unchanged configs aren't re-sent every poll */
  published: Map<string, string>;
  /** Discovery topics last published by each owner (a device address, or e.g. 'scenes') */
  byOwner: Map<string, Set<string>>;
  /** Retired topics already cleared, so they're cleared once rather than every poll */
  retired: Set<string>;
}

/** Per connection, since the cache describes what its broker currently holds as retained */
const caches = new WeakMap<Mqtt, DiscoveryCache>();

function cacheFor(mqtt: Mqtt): DiscoveryCache {
  let cache = caches.get(mqtt);
  if (!cache) {
    cache = { published: new Map(), byOwner: new Map(), retired: new Set() };
    caches.set(mqtt, cache);
  }
  return cache;
}

/**
 * Forget which configs were published, so the next sync sends them all again. Used after
 * reconnecting, since the broker may have restarted and lost its retained messages.
 */
export function resetPublishedDiscovery(mqtt: Mqtt): void {
  cacheFor(mqtt).published.clear();
}

/** Publish a retained discovery config, skipping it if the same payload was already published */
export function publishDiscoveryConfig(mqtt: Mqtt, topic: string, payload: Record<string, unknown>): void {
  const { published } = cacheFor(mqtt);
  const json = JSON.stringify(payload);
  if (published.get(topic) === json) return;
  published.set(topic, json);

  mqtt.publish(topic, json, true);
}

/** Remove a discovery config: an empty retained payload makes HA delete the entity */
function removeDiscoveryConfig(mqtt: Mqtt, topic: string): void {
  cacheFor(mqtt).published.delete(topic);
  mqtt.publish(topic, '', true);
}

/**
 * Publish an owner's full set of discovery configs, removing any it published
 * before that are no longer in the set (e.g. a capability or scene went away).
 */
export function syncOwnedDiscovery(mqtt: Mqtt, owner: string, configs: HADiscoveryConfig[]): void {
  const { byOwner } = cacheFor(mqtt);
  const topics = new Set(configs.map(c => c.topic));
  for (const disc of configs) {
    publishDiscoveryConfig(mqtt, disc.topic, disc.payload);
  }
  for (const topic of byOwner.get(owner) ?? []) {
    if (!topics.has(topic)) removeDiscoveryConfig(mqtt, topic);
  }

  if (topics.size > 0) byOwner.set(owner, topics);
  else byOwner.delete(owner);
}

/**
 * Clear retained topics an older version left behind. The owner sets start empty on every
 * run, so syncOwnedDiscovery can only remove what this run published.
 */
export function clearRetiredTopics(mqtt: Mqtt, topics: string[]): void {
  const { published, retired } = cacheFor(mqtt);
  for (const topic of topics) {
    if (retired.has(topic)) continue;
    retired.add(topic);
    published.delete(topic);
    mqtt.publish(topic, '', true);
  }
}

/** Remove every discovery config an owner published (e.g. the device was deleted) */
export function removeOwnedDiscovery(mqtt: Mqtt, owner: string): void {
  syncOwnedDiscovery(mqtt, owner, []);
}
