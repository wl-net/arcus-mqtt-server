import type { Mqtt } from '../mqtt.js';
import type { ArcusDevice, ArcusAttributes, ArcusMethodCall } from '../arcus/types.js';
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

  /**
   * Handle a command from HA that Arcus takes as a method call rather than
   * attribute changes (e.g. starting irrigation). Optional.
   */
  handleMethodCommand?(
    config: Config,
    device: ArcusDevice,
    entity: string,
    payload: string,
  ): ArcusMethodCall | null;

  /** Handle a real-time event (e.g. publish a trigger). Optional. */
  onEvent?(
    mqtt: Mqtt,
    config: Config,
    device: ArcusDevice,
    attributes: ArcusAttributes,
  ): void;
}

import { switchMapper } from './switch.js';
import { lightMapper } from './light.js';
import { climateMapper } from './climate.js';
import { binarySensorMapper } from './binary-sensor.js';
import { lockMapper } from './lock.js';
import { coverMapper } from './cover.js';
import { sensorMapper } from './sensor.js';
import { deviceTriggerMapper } from './device-trigger.js';
import { hubMapper } from './hub.js';
import { valveMapper } from './valve.js';
import { shadeMapper } from './shade.js';
import { ventMapper } from './vent.js';
import { irrigationMapper } from './irrigation.js';

/** All registered mappers, in priority order */
export const mappers: Mapper[] = [
  switchMapper,
  lightMapper,
  climateMapper,
  binarySensorMapper,
  lockMapper,
  coverMapper,
  sensorMapper,
  deviceTriggerMapper,
  hubMapper,
  valveMapper,
  shadeMapper,
  ventMapper,
  irrigationMapper,
];

/** Get all mappers that match a device */
export function matchingMappers(device: ArcusDevice): Mapper[] {
  return mappers.filter(m => m.matches(device));
}
