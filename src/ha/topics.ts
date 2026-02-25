import type { Config } from '../config.js';

/** Extract a short stable ID from an Arcus address like "DRIV:dev:switch-001" → "switch-001" */
export function deviceId(address: string): string {
  const parts = address.split(':');
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

/** Availability topic: arcus/<device_id>/availability */
export function availabilityTopic(config: Config, address: string): string {
  return `${config.deviceIdPrefix}/${deviceId(address)}/availability`;
}
