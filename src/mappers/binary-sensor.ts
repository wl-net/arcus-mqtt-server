import type { ArcusDevice } from '../arcus/types.js';
import { Contact, Motion, LeakH2O, Smoke, CarbonMonoxide, Glass, Tilt, Presence } from '../arcus/capabilities.js';
import type { Config } from '../config.js';
import type { HADiscoveryConfig } from '../ha/discovery.js';
import { buildDeviceInfo, buildAvailability } from '../ha/discovery.js';
import { discoveryTopic, stateTopic, deviceId } from '../ha/topics.js';
import type { Mapper } from './index.js';

interface BinarySensorDef {
  cap: string;
  attribute: string;
  onValue: string;
  deviceClass: string;
  suffix: string;
}

const BINARY_SENSOR_DEFS: BinarySensorDef[] = [
  {
    cap: Contact.NAMESPACE,
    attribute: Contact.ATTR_CONTACT,
    onValue: Contact.CONTACT_OPENED,
    deviceClass: 'door', // default; overridden for windows
    suffix: 'contact',
  },
  {
    cap: Motion.NAMESPACE,
    attribute: Motion.ATTR_MOTION,
    onValue: Motion.MOTION_DETECTED,
    deviceClass: 'motion',
    suffix: 'motion',
  },
  {
    cap: LeakH2O.NAMESPACE,
    attribute: LeakH2O.ATTR_STATE,
    onValue: LeakH2O.STATE_LEAK,
    deviceClass: 'moisture',
    suffix: 'leak',
  },
  {
    cap: Smoke.NAMESPACE,
    attribute: Smoke.ATTR_SMOKE,
    onValue: Smoke.SMOKE_DETECTED,
    deviceClass: 'smoke',
    suffix: 'smoke',
  },
  {
    cap: CarbonMonoxide.NAMESPACE,
    attribute: CarbonMonoxide.ATTR_CO,
    onValue: CarbonMonoxide.CO_DETECTED,
    deviceClass: 'carbon_monoxide',
    suffix: 'co',
  },
  {
    cap: Glass.NAMESPACE,
    attribute: Glass.ATTR_BREAK,
    onValue: Glass.BREAK_DETECTED,
    deviceClass: 'safety',
    suffix: 'glass',
  },
  {
    // Tilt sensors mount on garage door panels: upright when closed, flat when open
    cap: Tilt.NAMESPACE,
    attribute: Tilt.ATTR_TILTSTATE,
    onValue: Tilt.TILTSTATE_FLAT,
    deviceClass: 'garage_door',
    suffix: 'tilt',
  },
  {
    // Key fobs: present while the hub hears them, absent once they've been gone a while
    cap: Presence.NAMESPACE,
    attribute: Presence.ATTR_PRESENCE,
    onValue: Presence.PRESENCE_PRESENT,
    deviceClass: 'presence',
    suffix: 'presence',
  },
];

function resolveContactDeviceClass(device: ArcusDevice): string {
  const hint = device.attributes[Contact.ATTR_USEHINT];
  if (hint === Contact.USEHINT_WINDOW) return 'window';
  return 'door';
}

/** Maps Arcus cont/mot/leakh2o/smoke/co/glass/tilt/pres → HA binary_sensor */
export const binarySensorMapper: Mapper = {
  matches(device: ArcusDevice): boolean {
    return BINARY_SENSOR_DEFS.some(def => device.caps.has(def.cap));
  },

  buildDiscovery(config: Config, device: ArcusDevice): HADiscoveryConfig[] {
    const id = deviceId(device.address);
    const configs: HADiscoveryConfig[] = [];

    for (const def of BINARY_SENSOR_DEFS) {
      if (!device.caps.has(def.cap)) continue;

      const objectId = `${id}_${def.suffix}`;
      const deviceClass =
        def.cap === Contact.NAMESPACE ? resolveContactDeviceClass(device) : def.deviceClass;

      configs.push({
        topic: discoveryTopic(config, 'binary_sensor', objectId),
        payload: {
          name: def.suffix.charAt(0).toUpperCase() + def.suffix.slice(1),
          unique_id: objectId,
          object_id: objectId,
          state_topic: stateTopic(config, device.address),
          value_template: `{{ value_json.${def.suffix} }}`,
          payload_on: 'ON',
          payload_off: 'OFF',
          device_class: deviceClass,
          device: buildDeviceInfo(config, device),
          ...buildAvailability(config, device),
        },
      });
    }

    return configs;
  },

  buildState(_config: Config, device: ArcusDevice): Record<string, unknown> {
    const state: Record<string, unknown> = {};

    for (const def of BINARY_SENSOR_DEFS) {
      if (!device.caps.has(def.cap)) continue;
      const raw = device.attributes[def.attribute];
      state[def.suffix] = raw === def.onValue ? 'ON' : 'OFF';
    }

    return state;
  },

  handleCommand(): null {
    return null; // Binary sensors have no commands
  },
};
