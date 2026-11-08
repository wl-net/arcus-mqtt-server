import type { ArcusDevice, ArcusAttributes, ArcusMethodCall } from '../arcus/types.js';
import { DeviceSettings } from '../arcus/capabilities.js';
import type { Config } from '../config.js';
import { Features, hasFeature } from '../config.js';
import type { HADiscoveryConfig } from '../ha/discovery.js';
import { buildDeviceInfo, buildAvailability } from '../ha/discovery.js';
import { discoveryTopic, stateTopic, commandTopic, deviceId } from '../ha/topics.js';
import type { Mapper } from './index.js';

/** A choice of an enum setting: the value SetParam takes, and the label HA shows */
interface Option {
  value: string;
  label: string;
}

interface SettingBase {
  /** What devsettings:SetParam takes */
  paramId: string;
  /** The paramId made safe for topics, IDs and templates */
  key: string;
  name: string;
  /** The driver's last known value, or null if it has none */
  value: number | null;
}

interface RangeSetting extends SettingBase {
  kind: 'number';
  min: number;
  max: number;
  unit?: string;
}

interface EnumSetting extends SettingBase {
  kind: 'select';
  /** In value order */
  options: Option[];
}

type Setting = RangeSetting | EnumSetting;

/** Drivers write descriptions like "Parameter 2: LED indicator control" */
const PARAM_NUMBER = /^Parameter \d+:\s*/i;

/** A unit at the end of a description, e.g. "Auto-off delay (seconds)" */
const TRAILING_UNIT = /\s*\(([^()]+)\)$/;

/** Units drivers name in descriptions, as Home Assistant writes them */
const UNITS: Record<string, string> = {
  '%': '%',
  percent: '%',
  seconds: 's',
  minutes: 'min',
  hours: 'h',
  'degrees f': '°F',
  'degrees c': '°C',
};

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** The key for a paramId: letters, digits and underscores only, since it goes in a Jinja template */
function settingKey(paramId: string): string {
  return paramId.replace(/[^A-Za-z0-9_]/g, '_');
}

/** Command entity, and state key, of a setting */
function entityOf(setting: Setting): string {
  return `setting_${setting.key}`;
}

/** Name for HA, and the unit when the description ends with one (only numbers have units) */
function nameAndUnit(description: unknown, paramId: string, withUnit: boolean): { name: string; unit?: string } {
  let name = typeof description === 'string' ? description.replace(PARAM_NUMBER, '').trim() : '';
  let unit: string | undefined;
  const match = withUnit ? TRAILING_UNIT.exec(name) : null;
  if (match && UNITS[match[1].trim().toLowerCase()]) {
    unit = UNITS[match[1].trim().toLowerCase()];
    name = name.slice(0, match.index).trim();
  }
  return { name: name || paramId, unit };
}

/** An enum's choices in value order (they arrive as a map in text order: 0, 2, 30, 5), each label once */
function enumOptions(values: unknown): Option[] {
  if (typeof values !== 'object' || values === null || Array.isArray(values)) return [];
  const byValue = (a: string, b: string) => {
    const diff = Number(a) - Number(b);
    return Number.isNaN(diff) ? a.localeCompare(b) : diff;
  };
  const labels = new Set<string>();
  const options: Option[] = [];
  for (const [value, label] of Object.entries(values).sort(([a], [b]) => byValue(a, b))) {
    if (typeof label !== 'string' || !label.trim() || labels.has(label)) continue;
    labels.add(label);
    options.push({ value, label });
  }
  return options;
}

/** The device's settings HA can show, from devsettings:params; malformed ones are skipped */
function readSettings(device: ArcusDevice): Setting[] {
  const params = device.attributes[DeviceSettings.ATTR_PARAMS];
  if (!Array.isArray(params)) return [];
  const settings: Setting[] = [];
  const keys = new Set<string>();
  for (const param of params) {
    if (typeof param === 'string') continue;
    const { paramId } = param;
    const key = settingKey(paramId);
    if (!key || keys.has(key)) continue;
    const value = isNumber(param.value) ? param.value : null;

    if (param.type === 'range' && isNumber(param.min) && isNumber(param.max) && param.min <= param.max) {
      const { name, unit } = nameAndUnit(param.description, paramId, true);
      settings.push({ kind: 'number', paramId, key, name, value, min: param.min, max: param.max, unit });
    } else if (param.type === 'enum') {
      const options = enumOptions(param.values);
      if (options.length === 0) continue;
      settings.push({ kind: 'select', paramId, key, name: nameAndUnit(param.description, paramId, false).name, value, options });
    } else {
      continue;
    }
    keys.add(key);
  }
  return settings;
}

function objectIdOf(device: ArcusDevice, setting: Setting): string {
  return `${deviceId(device.address)}_${entityOf(setting)}`;
}

function topicOf(config: Config, device: ArcusDevice, setting: Setting): string {
  return discoveryTopic(config, setting.kind, objectIdOf(device, setting));
}

/** The label of an enum setting's value, or null if it has none or isn't one of the choices */
function currentLabel(setting: EnumSetting): string | null {
  if (setting.value === null) return null;
  return setting.options.find(o => Number(o.value) === setting.value)?.label ?? null;
}

/** What SetParam takes for a command from HA: a whole number as a string, or null if it isn't valid */
function commandValue(setting: Setting, payload: string): string | null {
  if (setting.kind === 'select') {
    return setting.options.find(o => o.label === payload)?.value ?? null;
  }
  const number = Number(payload);
  if (!payload.trim() || !Number.isFinite(number)) return null;
  return String(Math.min(setting.max, Math.max(setting.min, Math.round(number))));
}

/**
 * Maps device settings (devsettings:params, such as a dimmer's LED mode or a keypad's
 * volume) → an HA config entity each, with the device_settings feature on: a number for a
 * range, a select for an enum. Changing one calls devsettings:SetParam; the driver reports
 * the new value right away, and again once the device confirms it.
 */
export const deviceSettingsMapper: Mapper = {
  matches(device: ArcusDevice): boolean {
    return device.caps.has(DeviceSettings.NAMESPACE);
  },

  buildDiscovery(config: Config, device: ArcusDevice): HADiscoveryConfig[] {
    if (!hasFeature(config, Features.DEVICE_SETTINGS)) return [];
    return readSettings(device).map((setting) => {
      const objectId = objectIdOf(device, setting);
      const entity = entityOf(setting);
      const common = {
        name: setting.name,
        unique_id: objectId,
        object_id: objectId,
        state_topic: stateTopic(config, device.address),
        value_template: `{{ value_json.${entity} }}`,
        command_topic: commandTopic(config, device.address, entity),
        entity_category: 'config',
        device: buildDeviceInfo(config, device),
        ...buildAvailability(config, device),
      };
      const payload = setting.kind === 'select'
        ? { ...common, options: setting.options.map(o => o.label) }
        : {
          ...common,
          min: setting.min,
          max: setting.max,
          step: 1,
          ...(setting.unit ? { unit_of_measurement: setting.unit } : {}),
        };
      return { topic: topicOf(config, device, setting), payload };
    });
  },

  buildState(config: Config, device: ArcusDevice): Record<string, unknown> {
    if (!hasFeature(config, Features.DEVICE_SETTINGS)) return {};
    const state: Record<string, unknown> = {};
    for (const setting of readSettings(device)) {
      state[entityOf(setting)] = setting.kind === 'select' ? currentLabel(setting) : setting.value;
    }
    return state;
  },

  handleCommand(): ArcusAttributes | null {
    return null;
  },

  handleMethodCommand(
    config: Config,
    device: ArcusDevice,
    entity: string,
    payload: string,
  ): ArcusMethodCall | null {
    if (!hasFeature(config, Features.DEVICE_SETTINGS)) return null;
    const setting = readSettings(device).find(s => entityOf(s) === entity);
    if (!setting) return null;
    const value = commandValue(setting, payload);
    if (value === null) return null;
    return { method: DeviceSettings.CMD_SETPARAM, args: { paramId: setting.paramId, value } };
  },

  /**
   * With the feature off, the settings' entities are removed, since a device can have
   * twenty of them to delete by hand. (Settings a driver stops offering while the bridge
   * is down still stay behind, as removed devices do.)
   */
  retiredTopics(config: Config, device: ArcusDevice): string[] {
    if (hasFeature(config, Features.DEVICE_SETTINGS)) return [];
    return readSettings(device).map(setting => topicOf(config, device, setting));
  },
};
