import type { Broker } from './broker.js';
import type { ArcusClient } from './arcus/client.js';
import type { ArcusDevice, SceneInfo } from './arcus/types.js';
import type { Config } from './config.js';
import { matchingMappers } from './mappers/index.js';
import { publishState, publishAvailability } from './ha/state.js';
import { setupCommandHandler } from './ha/command.js';
import { publishAlarmDiscovery, publishAlarmState, publishAlarmAvailability, setupAlarmCommandHandler } from './ha/alarm.js';
import { publishSceneDiscovery, publishSceneFired, setupSceneCommandHandler } from './ha/scenes.js';

/** Publish HA MQTT Discovery config for a device */
function publishDiscovery(broker: Broker, config: Config, device: ArcusDevice): void {
  const matched = matchingMappers(device);

  for (const mapper of matched) {
    const configs = mapper.buildDiscovery(config, device);
    for (const disc of configs) {
      broker.publish(
        {
          cmd: 'publish',
          topic: disc.topic,
          payload: Buffer.from(JSON.stringify(disc.payload)),
          qos: 0,
          dup: false,
          retain: true,
        },
        () => {},
      );
    }
  }
}

/** Perform a full sync: fetch devices, publish discovery + state + availability */
async function fullSync(
  broker: Broker,
  config: Config,
  client: ArcusClient,
  devices: Map<string, ArcusDevice>,
  scenes: SceneInfo[],
): Promise<void> {
  const deviceList = await client.listDevices();
  console.log(`[Sync] Fetched ${deviceList.length} devices`);

  // Update the devices map in-place (don't clear — avoids dropping real-time events mid-sync)
  const freshAddresses = new Set<string>();
  for (const device of deviceList) {
    freshAddresses.add(device.address);
    devices.set(device.address, device);
  }
  // Remove devices no longer present
  for (const address of devices.keys()) {
    if (!freshAddresses.has(address)) {
      devices.delete(address);
    }
  }

  // Publish discovery, state, and availability for each device
  for (const device of deviceList) {
    publishDiscovery(broker, config, device);
    publishState(broker, config, device);
    publishAvailability(broker, config, device, true);
  }

  // Sync alarm: discovery + state + availability
  publishAlarmDiscovery(broker, config);
  try {
    const alarmState = await client.getAlarmState();
    publishAlarmState(broker, alarmState);
    publishAlarmAvailability(broker, true);
  } catch (err) {
    console.error('[Sync] Alarm state fetch error:', err);
  }

  // Sync scenes: refresh list + publish discovery
  try {
    const freshScenes = await client.listScenes();
    scenes.length = 0;
    scenes.push(...freshScenes);
    publishSceneDiscovery(broker, config, scenes);
  } catch (err) {
    console.error('[Sync] Scene list error:', err);
  }
}

/** Start the sync loop: initial sync, then poll + event handling */
export async function startSync(
  broker: Broker,
  config: Config,
  client: ArcusClient,
): Promise<{ stop(): void }> {
  const devices = new Map<string, ArcusDevice>();
  const scenes: SceneInfo[] = [];

  // Set up command handling (HA → Arcus)
  setupCommandHandler(broker, config, client, devices);

  // Set up alarm command handling and event listening
  setupAlarmCommandHandler(broker, client);
  client.onAlarmEvent((alarmState) => {
    publishAlarmState(broker, alarmState);
    console.log(`[Sync] Real-time alarm update: ${alarmState.securityMode}`);
  });

  // Set up scene command handling and event listening
  setupSceneCommandHandler(broker, config, client, scenes);
  client.onSceneEvent((sceneAddress) => {
    publishSceneFired(broker, config, scenes, sceneAddress);
  });

  // Listen for real-time device events
  client.onDeviceEvent((address, attributes) => {
    const device = devices.get(address);
    if (!device) {
      console.debug(`[Sync] Event for unknown device ${address}, skipping`);
      return;
    }

    // Update local state
    Object.assign(device.attributes, attributes);

    // Re-publish state immediately
    publishState(broker, config, device);

    // Fire any event-driven mappers (e.g. button triggers)
    for (const mapper of matchingMappers(device)) {
      mapper.onEvent?.(broker, config, device, attributes);
    }

    console.log(`[Sync] Real-time update: ${device.name} (${address})`);
  });

  // Connect to the upstream client
  await client.connect();

  // Initial full sync (includes alarm discovery + state + scenes)
  await fullSync(broker, config, client, devices, scenes);

  // Periodic poll
  const interval = setInterval(async () => {
    try {
      await fullSync(broker, config, client, devices, scenes);
    } catch (err) {
      console.error('[Sync] Poll error:', err);
    }
  }, config.pollIntervalMs);

  return {
    stop() {
      clearInterval(interval);
    },
  };
}
