import type { ArcusDevice, ArcusAttributes } from '../arcus/types.js';
import type { Config } from '../config.js';
import type { HADiscoveryConfig } from '../ha/discovery.js';

export interface Mapper {
  /** Does this mapper apply to the given device? */
  matches(device: ArcusDevice): boolean;

  /** Build HA MQTT Discovery config messages */
  buildDiscovery(config: Config, device: ArcusDevice): HADiscoveryConfig[];

  /** Build state key-value pairs to merge into the device's JSON state topic */
  buildState(config: Config, device: ArcusDevice): Record<string, unknown>;

  /** Handle a command from HA. Returns Arcus attributes to set, or null if not handled. */
  handleCommand(
    config: Config,
    device: ArcusDevice,
    entity: string,
    payload: string,
  ): ArcusAttributes | null;
}

import { switchMapper } from './switch.js';
import { lightMapper } from './light.js';
import { climateMapper } from './climate.js';
import { binarySensorMapper } from './binary-sensor.js';
import { lockMapper } from './lock.js';
import { cameraMapper } from './camera.js';
import { sensorMapper } from './sensor.js';
import { deviceTriggerMapper } from './device-trigger.js';

/** All registered mappers, in priority order */
export const mappers: Mapper[] = [
  switchMapper,
  lightMapper,
  climateMapper,
  binarySensorMapper,
  lockMapper,
  cameraMapper,
  sensorMapper,
  deviceTriggerMapper,
];

/** Get all mappers that match a device */
export function matchingMappers(device: ArcusDevice): Mapper[] {
  return mappers.filter(m => m.matches(device));
}
