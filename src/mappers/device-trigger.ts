import type { Mqtt } from '../mqtt.js';
import type { ArcusDevice, ArcusAttributes } from '../arcus/types.js';
import { Button } from '../arcus/capabilities.js';
import type { Config } from '../config.js';
import type { HADiscoveryConfig } from '../ha/discovery.js';
import { buildDeviceInfo } from '../ha/discovery.js';
import { discoveryTopic, deviceId } from '../ha/topics.js';
import type { Mapper } from './index.js';

/** Payload for a press on a single-button device; multi-button devices send the button's name */
const PRESSED = 'PRESSED';

/** The one event type: Arcus reports a hold or a double press as a press */
const EVENT_PRESS = 'press';

/** Instance attributes are but:state:<button> */
const INSTANCE_STATE_PREFIX = `${Button.ATTR_STATE}:`;

function triggerTopic(config: Config, device: ArcusDevice): string {
  return `${config.deviceIdPrefix}/${deviceId(device.address)}/trigger`;
}

/**
 * The buttons of a multi-button device, from its Button instances: button1..button4
 * on a Zooz remote, up/down on a paddle remote, home/away/a/b on a key fob
 */
function buttonInstances(device: ArcusDevice): string[] {
  return Object.entries(device.instances ?? {})
    .filter(([, caps]) => caps.includes(Button.NAMESPACE))
    .map(([name]) => name)
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
}

/** The number of a buttonN instance, or undefined for buttons named otherwise */
function buttonNumber(button: string): string | undefined {
  return /^button(\d+)$/.exec(button)?.[1];
}

/** HA names subtypes button_1 to button_6 ("First button" ...); other buttons keep their Arcus name */
function triggerSubtype(button: string): string {
  const num = buttonNumber(button);
  return num ? `button_${num}` : button;
}

/** Event entity names: Button 1 for button1, Home button for a key fob's home */
function eventName(button: string): string {
  const num = buttonNumber(button);
  return num ? `Button ${num}` : `${button.charAt(0).toUpperCase()}${button.slice(1)} button`;
}

/**
 * HA reads each message as JSON naming the event type. Every button on a device shares the
 * trigger topic, so the template renders empty for other buttons' presses, and HA ignores those.
 */
function eventTemplate(payload: string): string {
  return `{% if value == ${JSON.stringify(payload)} %}{"event_type":"${EVENT_PRESS}"}{% endif %}`;
}

/**
 * Maps Arcus but → HA device_automation (device trigger) and event entity. A single-button
 * device has one of each; a multi-button device has one of each per Button instance. Both
 * read the trigger topic: the trigger runs automations, and the event entity shows each
 * press in the logbook and history.
 */
export const deviceTriggerMapper: Mapper = {
  matches(device: ArcusDevice): boolean {
    return device.caps.has(Button.NAMESPACE) || buttonInstances(device).length > 0;
  },

  buildDiscovery(config: Config, device: ArcusDevice): HADiscoveryConfig[] {
    const id = deviceId(device.address);
    const topic = triggerTopic(config, device);
    const deviceInfo = buildDeviceInfo(config, device);

    // The event entity has no availability, unlike other device entities. HA's logbook shows an
    // event entity coming back from unavailable as another press, so with availability every
    // bridge restart, and every time a remote dropped off and came back, would log a press per
    // button. It still goes unavailable while HA itself is disconnected from the broker.
    const button = (key: string, subtype: string, name: string | null, payload: string): HADiscoveryConfig[] => [
      {
        topic: discoveryTopic(config, 'device_automation', `${id}_${key}_press`),
        payload: { automation_type: 'trigger', type: 'button_short_press', subtype, topic, payload, device: deviceInfo },
      },
      {
        topic: discoveryTopic(config, 'event', `${id}_${key}_event`),
        payload: {
          name,
          unique_id: `${id}_${key}_event`,
          device_class: 'button',
          event_types: [EVENT_PRESS],
          state_topic: topic,
          value_template: eventTemplate(payload),
          device: deviceInfo,
        },
      },
    ];

    const configs: HADiscoveryConfig[] = [];
    // A single-button device's button is the device, so its event entity takes the device's name
    if (device.caps.has(Button.NAMESPACE)) configs.push(...button('button', 'button_1', null, PRESSED));
    for (const name of buttonInstances(device)) {
      configs.push(...button(name, triggerSubtype(name), eventName(name), name));
    }
    return configs;
  },

  buildState(): Record<string, unknown> {
    return {}; // Triggers don't have state topics
  },

  handleCommand(): null {
    return null; // Triggers have no commands
  },

  onEvent(mqtt: Mqtt, config: Config, device: ArcusDevice, attributes: ArcusAttributes): void {
    const buttons = buttonInstances(device);
    for (const [key, value] of Object.entries(attributes)) {
      if (value !== Button.STATE_PRESSED) continue;

      let payload: string;
      if (key === Button.ATTR_STATE && device.caps.has(Button.NAMESPACE)) {
        payload = PRESSED;
      } else if (key.startsWith(INSTANCE_STATE_PREFIX) && buttons.includes(key.slice(INSTANCE_STATE_PREFIX.length))) {
        payload = key.slice(INSTANCE_STATE_PREFIX.length);
      } else {
        continue;
      }

      mqtt.publish(triggerTopic(config, device), payload, false);
      console.log(`[Trigger] Button press: ${device.name} (${device.address}) ${payload}`);
    }
  },
};
