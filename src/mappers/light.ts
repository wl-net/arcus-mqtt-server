import type { ArcusDevice, ArcusAttributes } from '../arcus/types.js';
import { Switch, Dimmer, Color, ColorTemperature, Light } from '../arcus/capabilities.js';
import type { Config } from '../config.js';
import type { HADiscoveryConfig } from '../ha/discovery.js';
import { buildDeviceInfo, buildAvailability } from '../ha/discovery.js';
import { discoveryTopic, stateTopic, commandTopic, deviceId } from '../ha/topics.js';
import type { Mapper } from './index.js';

// Fallback color temperature range when the bulb doesn't report one
const DEFAULT_MIN_KELVIN = 2700;
const DEFAULT_MAX_KELVIN = 6500;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function kelvinRange(device: ArcusDevice): { min: number; max: number } {
  const min = Number(device.attributes[ColorTemperature.ATTR_MINCOLORTEMP]);
  const max = Number(device.attributes[ColorTemperature.ATTR_MAXCOLORTEMP]);
  return {
    min: Number.isFinite(min) && min > 0 ? min : DEFAULT_MIN_KELVIN,
    max: Number.isFinite(max) && max > 0 ? max : DEFAULT_MAX_KELVIN,
  };
}

/**
 * Which color values to report. HA infers a light's color mode from the last hs or
 * color temperature value it receives, so report only the one matching
 * light:colormode (or the only one the bulb supports, if it doesn't say).
 */
function activeColorMode(device: ArcusDevice): 'hs' | 'color_temp' | null {
  const hasColor = device.caps.has(Color.NAMESPACE);
  const hasTemp = device.caps.has(ColorTemperature.NAMESPACE);
  const mode = device.attributes[Light.ATTR_COLORMODE];
  if (mode === Light.COLORMODE_COLOR && hasColor) return 'hs';
  if (mode === Light.COLORMODE_COLORTEMP && hasTemp) return 'color_temp';
  if (mode === undefined && hasColor !== hasTemp) return hasColor ? 'hs' : 'color_temp';
  return null;
}

/** Attributes to switch the bulb's color mode, if it has one to switch */
function colorModeAttr(device: ArcusDevice, mode: string): ArcusAttributes {
  return device.caps.has(Light.NAMESPACE) ? { [Light.ATTR_COLORMODE]: mode } : {};
}

/** Maps Arcus dim (plus color/colortemp, if present) → HA light (default schema) */
export const lightMapper: Mapper = {
  matches(device: ArcusDevice): boolean {
    return device.caps.has(Dimmer.NAMESPACE);
  },

  buildDiscovery(config: Config, device: ArcusDevice): HADiscoveryConfig[] {
    const id = deviceId(device.address);
    const objectId = `${id}_light`;
    const state = stateTopic(config, device.address);

    const payload: Record<string, unknown> = {
      name: null,
      unique_id: objectId,
      object_id: objectId,
      state_topic: state,
      state_value_template: '{{ value_json.light_state }}',
      command_topic: commandTopic(config, device.address, 'light'),
      payload_on: 'ON',
      payload_off: 'OFF',
      // Turn on with just the brightness command (which also sets swit:state ON), not
      // brightness and then ON. Each command is a separate Set to the device, and some
      // dimmers flash on every Set.
      on_command_type: 'brightness',
      brightness_state_topic: state,
      brightness_value_template: '{{ value_json.light_brightness }}',
      brightness_command_topic: commandTopic(config, device.address, 'light_brightness'),
      brightness_scale: 100,
      device: buildDeviceInfo(config, device),
      ...buildAvailability(config, device),
    };

    // Values absent from the state render empty, which HA ignores, so the color
    // mode only changes when the bulb is actually in that mode.
    if (device.caps.has(Color.NAMESPACE)) {
      payload.hs_state_topic = state;
      payload.hs_value_template = "{{ value_json.light_hs if value_json.light_hs is defined else '' }}";
      payload.hs_command_topic = commandTopic(config, device.address, 'light_hs');
    }
    if (device.caps.has(ColorTemperature.NAMESPACE)) {
      const { min, max } = kelvinRange(device);
      payload.color_temp_kelvin = true;
      payload.min_kelvin = min;
      payload.max_kelvin = max;
      payload.color_temp_state_topic = state;
      payload.color_temp_value_template =
        "{{ value_json.light_color_temp if value_json.light_color_temp is defined else '' }}";
      payload.color_temp_command_topic = commandTopic(config, device.address, 'light_color_temp');
    }

    return [{ topic: discoveryTopic(config, 'light', objectId), payload }];
  },

  buildState(_config: Config, device: ArcusDevice): Record<string, unknown> {
    const attrs = device.attributes;
    const state: Record<string, unknown> = {
      light_state: attrs[Switch.ATTR_STATE] === 'ON' ? 'ON' : 'OFF',
      light_brightness: attrs[Dimmer.ATTR_BRIGHTNESS] ?? 0,
    };

    const mode = activeColorMode(device);
    if (mode === 'hs' && attrs[Color.ATTR_HUE] !== undefined && attrs[Color.ATTR_SATURATION] !== undefined) {
      state.light_hs = `${attrs[Color.ATTR_HUE]},${attrs[Color.ATTR_SATURATION]}`;
    }
    if (mode === 'color_temp' && attrs[ColorTemperature.ATTR_COLORTEMP] !== undefined) {
      state.light_color_temp = attrs[ColorTemperature.ATTR_COLORTEMP];
    }
    return state;
  },

  handleCommand(
    _config: Config,
    device: ArcusDevice,
    entity: string,
    payload: string,
  ): ArcusAttributes | null {
    switch (entity) {
      case 'light':
        return { [Switch.ATTR_STATE]: payload === 'ON' ? 'ON' : 'OFF' };

      case 'light_brightness': {
        const brightness = Number(payload);
        if (!Number.isFinite(brightness)) return null;
        const level = Math.round(clamp(brightness, 0, 100));
        const attrs: ArcusAttributes = { [Dimmer.ATTR_BRIGHTNESS]: level };
        if (level > 0) attrs[Switch.ATTR_STATE] = 'ON';
        return attrs;
      }

      case 'light_hs': {
        // HA sends "hue,saturation": hue 0-360, saturation 0-100
        const [hue, saturation] = payload.split(',').map(Number);
        if (!Number.isFinite(hue) || !Number.isFinite(saturation)) return null;
        return {
          [Color.ATTR_HUE]: Math.round(clamp(hue, 0, 360)),
          [Color.ATTR_SATURATION]: Math.round(clamp(saturation, 0, 100)),
          ...colorModeAttr(device, Light.COLORMODE_COLOR),
        };
      }

      case 'light_color_temp': {
        const kelvin = Number(payload);
        if (!Number.isFinite(kelvin)) return null;
        const { min, max } = kelvinRange(device);
        return {
          [ColorTemperature.ATTR_COLORTEMP]: Math.round(clamp(kelvin, min, max)),
          ...colorModeAttr(device, Light.COLORMODE_COLORTEMP),
        };
      }

      default:
        return null;
    }
  },
};
