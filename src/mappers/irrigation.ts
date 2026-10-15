import type { ArcusDevice, ArcusAttributes, ArcusMethodCall } from '../arcus/types.js';
import { IrrigationController, IrrigationZone } from '../arcus/capabilities.js';
import type { Config } from '../config.js';
import type { HADiscoveryConfig } from '../ha/discovery.js';
import { buildDeviceInfo, buildAvailability } from '../ha/discovery.js';
import { discoveryTopic, stateTopic, commandTopic, deviceId } from '../ha/topics.js';
import type { Mapper } from './index.js';

/** Command entities: zone_<zone> (water) and zone_<zone>_duration (watering time) */
const ZONE_ENTITY = /^zone_([A-Za-z0-9]+)(_duration)?$/;

/** Name of a per-zone attribute: each zone is an irr instance, e.g. irr:zoneState:z1 */
function zoneAttr(attr: string, zone: string): string {
  return `${attr}:${zone}`;
}

function zoneNumber(device: ArcusDevice, zone: string): number {
  const num = device.attributes[zoneAttr(IrrigationZone.ATTR_ZONENUM, zone)];
  return typeof num === 'number' ? num : Number.MAX_SAFE_INTEGER;
}

/** The controller's zone instances (e.g. "z1"), in zone number order */
function zones(device: ArcusDevice): string[] {
  const prefix = `${IrrigationZone.ATTR_ZONESTATE}:`;
  return Object.keys(device.attributes)
    .filter(key => key.startsWith(prefix))
    .map(key => key.slice(prefix.length))
    .sort((a, b) => zoneNumber(device, a) - zoneNumber(device, b) || a.localeCompare(b));
}

/** A zone's name in HA, for controllers with more than one zone */
function zoneLabel(device: ArcusDevice, zone: string): string {
  const name = device.attributes[zoneAttr(IrrigationZone.ATTR_ZONENAME, zone)];
  if (typeof name === 'string' && name.trim()) return name.trim();
  const num = device.attributes[zoneAttr(IrrigationZone.ATTR_ZONENUM, zone)];
  return `Zone ${typeof num === 'number' ? num : zone}`;
}

/** Watering times the controller accepts, in minutes */
function durationRange(device: ArcusDevice): { min: number; max: number } {
  const min = device.attributes[IrrigationController.ATTR_MINIRRIGATIONTIME];
  const max = device.attributes[IrrigationController.ATTR_MAXIRRIGATIONTIME];
  return {
    min: typeof min === 'number' && min > 0 ? min : 1,
    max: typeof max === 'number' && max > 0 ? max : 1440,
  };
}

function clampMinutes(device: ArcusDevice, minutes: number): number {
  const { min, max } = durationRange(device);
  return Math.round(Math.min(max, Math.max(min, minutes)));
}

/**
 * Maps Arcus irrigation controllers (e.g. Orbit hose timers) → an HA valve per zone,
 * plus a number per zone for its watering time (irr:defaultDuration, minutes).
 * Opening a zone waters it for that time. Arcus starts and stops watering with the
 * irrcont:WaterNowV2 and CancelV2 methods rather than attribute changes.
 */
export const irrigationMapper: Mapper = {
  matches(device: ArcusDevice): boolean {
    return device.caps.has(IrrigationController.NAMESPACE);
  },

  buildDiscovery(config: Config, device: ArcusDevice): HADiscoveryConfig[] {
    const id = deviceId(device.address);
    const all = zones(device);
    const { min, max } = durationRange(device);
    const common = {
      state_topic: stateTopic(config, device.address),
      device: buildDeviceInfo(config, device),
      ...buildAvailability(config, device),
    };

    return all.flatMap((zone): HADiscoveryConfig[] => {
      // A single-zone timer is named after the device
      const label = all.length > 1 ? zoneLabel(device, zone) : null;
      return [
        {
          topic: discoveryTopic(config, 'valve', `${id}_zone_${zone}`),
          payload: {
            name: label,
            unique_id: `${id}_zone_${zone}`,
            object_id: `${id}_zone_${zone}`,
            device_class: 'water',
            value_template: `{{ value_json.zone_${zone} }}`,
            command_topic: commandTopic(config, device.address, `zone_${zone}`),
            payload_open: 'OPEN',
            payload_close: 'CLOSE',
            payload_stop: null,
            state_open: IrrigationZone.ZONESTATE_WATERING,
            state_closed: IrrigationZone.ZONESTATE_NOT_WATERING,
            ...common,
          },
        },
        {
          topic: discoveryTopic(config, 'number', `${id}_zone_${zone}_duration`),
          payload: {
            name: label ? `${label} watering time` : 'Watering time',
            unique_id: `${id}_zone_${zone}_duration`,
            object_id: `${id}_zone_${zone}_duration`,
            value_template: `{{ value_json.zone_${zone}_duration }}`,
            command_topic: commandTopic(config, device.address, `zone_${zone}_duration`),
            min,
            max,
            step: 1,
            mode: 'box',
            device_class: 'duration',
            unit_of_measurement: 'min',
            entity_category: 'config',
            ...common,
          },
        },
      ];
    });
  },

  buildState(_config: Config, device: ArcusDevice): Record<string, unknown> {
    const state: Record<string, unknown> = {};
    for (const zone of zones(device)) {
      state[`zone_${zone}`] = device.attributes[zoneAttr(IrrigationZone.ATTR_ZONESTATE, zone)];
      const minutes = device.attributes[zoneAttr(IrrigationZone.ATTR_DEFAULTDURATION, zone)];
      if (typeof minutes === 'number') state[`zone_${zone}_duration`] = minutes;
    }
    return state;
  },

  handleCommand(
    _config: Config,
    device: ArcusDevice,
    entity: string,
    payload: string,
  ): ArcusAttributes | null {
    const match = ZONE_ENTITY.exec(entity);
    if (!match || !match[2] || !zones(device).includes(match[1])) return null;
    const minutes = Number(payload);
    if (!Number.isFinite(minutes)) return null;
    return { [zoneAttr(IrrigationZone.ATTR_DEFAULTDURATION, match[1])]: clampMinutes(device, minutes) };
  },

  handleMethodCommand(
    _config: Config,
    device: ArcusDevice,
    entity: string,
    payload: string,
  ): ArcusMethodCall | null {
    const match = ZONE_ENTITY.exec(entity);
    if (!match || match[2] || !zones(device).includes(match[1])) return null;
    const zone = match[1];
    const cmd = payload.toUpperCase();
    if (cmd === 'OPEN') {
      const minutes = device.attributes[zoneAttr(IrrigationZone.ATTR_DEFAULTDURATION, zone)];
      const duration = clampMinutes(device, typeof minutes === 'number' ? minutes : durationRange(device).min);
      return { method: IrrigationController.CMD_WATERNOWV2, args: { zone, duration } };
    }
    if (cmd === 'CLOSE') return { method: IrrigationController.CMD_CANCELV2, args: { zone } };
    return null;
  },
};
