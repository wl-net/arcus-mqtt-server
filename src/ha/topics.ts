import type { Config } from '../config.js';

/**
 * Extract a short stable ID from an Arcus address like "DRIV:dev:switch-001" → "switch-001".
 * A hub's address puts its hub ID in the middle ("SERV:LWW-1234:hub" → "LWW-1234"), since
 * the last part is "hub" for every hub.
 */
export function deviceId(address: string): string {
  const parts = address.split(':');
  if (parts[0] === 'SERV' && parts[2] === 'hub') return parts[1];
  return parts[parts.length - 1];
}

/** Discovery topic: homeassistant/<component>/arcus/<object_id>/config */
export function discoveryTopic(
  config: Config,
  component: string,
  objectId: string,
): string {
  return `${config.haDiscoveryPrefix}/${component}/${config.deviceIdPrefix}/${objectId}/config`;
}

/** State topic: arcus/<device_id>/state */
export function stateTopic(config: Config, address: string): string {
  return `${config.deviceIdPrefix}/${deviceId(address)}/state`;
}

/** Command topic: arcus/<device_id>/<entity>/set */
export function commandTopic(
  config: Config,
  address: string,
  entity: string,
): string {
  return `${config.deviceIdPrefix}/${deviceId(address)}/${entity}/set`;
}

/** Bridge-wide availability topic: arcus/bridge/availability */
export function bridgeAvailabilityTopic(config: Config): string {
  return `${config.deviceIdPrefix}/bridge/availability`;
}

/** Hub connection topic: arcus/<hub_id>/connection — online while the hub is connected to the platform */
export function hubConnectionTopic(config: Config, hubAddress: string): string {
  return `${config.deviceIdPrefix}/${deviceId(hubAddress)}/connection`;
}

/** Availability topic: arcus/<device_id>/availability */
export function availabilityTopic(config: Config, address: string): string {
  return `${config.deviceIdPrefix}/${deviceId(address)}/availability`;
}
