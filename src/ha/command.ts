import type { Broker } from '../broker.js';
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
  broker: Broker,
  config: Config,
  client: ArcusClient,
  devices: Map<string, ArcusDevice>,
): void {
  const prefix = config.deviceIdPrefix;

  // Intercept all published messages to catch command topics
  broker.on('publish', (packet, _client) => {
    // Command topics: arcus/<device_id>/<entity>/set
    const parts = packet.topic.split('/');
    if (parts.length !== 4) return;
    if (parts[0] !== prefix) return;
    if (parts[3] !== 'set') return;

    const devId = parts[1];
    const entity = parts[2];
    const payload = packet.payload.toString();

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
