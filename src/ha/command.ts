import type { Mqtt } from '../mqtt.js';
import type { ArcusClient } from '../arcus/client.js';
import type { ArcusDevice } from '../arcus/types.js';
import type { Config } from '../config.js';
import { matchingMappers } from '../mappers/index.js';
import { deviceId } from './topics.js';

/**
 * Set up command handling: subscribe to command topics and route to mappers.
 * Devices map is keyed by device address.
 */
export function setupCommandHandler(
  mqtt: Mqtt,
  config: Config,
  client: ArcusClient,
  devices: Map<string, ArcusDevice>,
): void {
  // Command topics: arcus/<device_id>/<entity>/set
  mqtt.subscribe(`${config.deviceIdPrefix}/+/+/set`, (topic, payload) => {
    const [, devId, entity] = topic.split('/');

    // Find the device by its short ID
    const device = findDeviceById(devices, devId);
    if (!device) {
      console.warn(`[Command] Unknown device: ${devId}`);
      return;
    }

    // Try each matching mapper until one handles the command
    const matched = matchingMappers(device);
    for (const mapper of matched) {
      const attrs = mapper.handleCommand(config, device, entity, payload);
      if (attrs) {
        console.log(`[Command] ${device.address} ${entity} ← ${payload}`);
        client.sendCommand(device.address, attrs).catch(err => {
          console.error(`[Command] Failed to send command to ${device.address}:`, err);
        });
        return;
      }
      const call = mapper.handleMethodCommand?.(config, device, entity, payload);
      if (call) {
        console.log(`[Command] ${device.address} ${entity} ← ${payload}`);
        client.callMethod(device.address, call).catch(err => {
          console.error(`[Command] ${call.method} failed on ${device.address}:`, err);
        });
        return;
      }
    }

    console.warn(`[Command] No mapper handled: ${devId}/${entity}`);
  });
}

function findDeviceById(
  devices: Map<string, ArcusDevice>,
  id: string,
): ArcusDevice | undefined {
  for (const device of devices.values()) {
    if (deviceId(device.address) === id) return device;
  }
  return undefined;
}
