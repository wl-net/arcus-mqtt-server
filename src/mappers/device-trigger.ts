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

/** HA names subtypes button_1 to button_6 ("First button" ...); other buttons keep their Arcus name */
function triggerSubtype(button: string): string {
  const num = /^button(\d+)$/.exec(button);
  return num ? `button_${num[1]}` : button;
}

/**
 * Maps Arcus but → HA device_automation (device trigger). A single-button device has
 * one trigger; a multi-button device has one per Button instance.
 */
export const deviceTriggerMapper: Mapper = {
  matches(device: ArcusDevice): boolean {
    return device.caps.has(Button.NAMESPACE) || buttonInstances(device).length > 0;
  },

  buildDiscovery(config: Config, device: ArcusDevice): HADiscoveryConfig[] {
    const id = deviceId(device.address);
    const trigger = (objectId: string, subtype: string, payload: string): HADiscoveryConfig => ({
      topic: discoveryTopic(config, 'device_automation', objectId),
      payload: {
        automation_type: 'trigger',
        type: 'button_short_press',
        subtype,
        topic: triggerTopic(config, device),
        payload,
        device: buildDeviceInfo(config, device),
      },
    });

    const configs: HADiscoveryConfig[] = [];
    if (device.caps.has(Button.NAMESPACE)) {
      configs.push(trigger(`${id}_button_press`, 'button_1', PRESSED));
    }
    for (const button of buttonInstances(device)) {
      configs.push(trigger(`${id}_${button}_press`, triggerSubtype(button), button));
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
