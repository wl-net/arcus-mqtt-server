import type { Mqtt } from './mqtt.js';
import type { ArcusClient } from './arcus/client.js';
import type { ArcusAttributes, ArcusDevice, PersonInfo, SceneInfo } from './arcus/types.js';
import type { Config } from './config.js';
import { Features, hasFeature } from './config.js';
import { matchingMappers } from './mappers/index.js';
import { DeviceConnection, DeviceAdvanced, Hub, HubConnection } from './arcus/capabilities.js';
import { publishState, publishAvailability, publishBridgeAvailability, publishHubConnection, isDeviceOnline, clearDeviceTopics } from './ha/state.js';
import type { HADiscoveryConfig } from './ha/discovery.js';
import { syncOwnedDiscovery, removeOwnedDiscovery, resetPublishedDiscovery, clearRetiredTopics } from './ha/discovery.js';
import { setupCommandHandler } from './ha/command.js';
import { publishAlarmDiscovery, publishAlarmState, publishAlarmAvailability, setupAlarmCommandHandler } from './ha/alarm.js';
import { publishSceneDiscovery, publishSceneFired, setupSceneCommandHandler } from './ha/scenes.js';
import { publishLockAccessDiscovery } from './ha/lock-access.js';

/** Protocols whose devices pair through the hub (others, e.g. IPCD Wi-Fi devices, talk to the platform directly) */
const HUB_PROTOCOLS = new Set(['ZIGB', 'ZWAV']);

/** Publish HA MQTT Discovery config for a device (only configs that changed; stale ones are removed) */
function publishDiscovery(mqtt: Mqtt, config: Config, device: ArcusDevice): void {
  const configs: HADiscoveryConfig[] = [];
  const retired: string[] = [];
  for (const mapper of matchingMappers(device)) {
    configs.push(...mapper.buildDiscovery(config, device));
    retired.push(...mapper.retiredTopics?.(config, device) ?? []);
  }
  // Never clear a topic the device still publishes, or HA would drop the entity and its settings
  const current = new Set(configs.map(c => c.topic));
  clearRetiredTopics(mqtt, retired.filter(topic => !current.has(topic)));
  syncOwnedDiscovery(mqtt, device.address, configs);
}

/** Perform a full sync: fetch devices, publish discovery + state + availability */
async function fullSync(
  mqtt: Mqtt,
  config: Config,
  client: ArcusClient,
  devices: Map<string, ArcusDevice>,
  scenes: SceneInfo[],
  people: PersonInfo[],
  { firstSync, changes }: {
    /** No sync has finished yet */
    firstSync: boolean;
    /** Value changes received since this sync started, in order; the event handler adds to it */
    changes: Array<[string, ArcusAttributes]>;
  },
): Promise<void> {
  const deviceList = await client.listDevices();
  // Every poll fetches the list, so after the first sync only additions and removals are logged
  (firstSync ? console.log : console.debug)(`[Sync] Fetched ${deviceList.length} devices`);

  // The hub isn't in the device list; fetch it separately and track it alongside the
  // devices so its real-time value changes flow through the same event path.
  let hub: ArcusDevice | null | undefined;
  try {
    hub = await client.getHub();
  } catch (err) {
    console.error('[Sync] Hub fetch error:', err);
    // Keep the last known hub so its entities and via_device links don't flap
    hub = [...devices.values()].find(d => d.caps.has(Hub.NAMESPACE));
  }
  if (hub) {
    for (const device of deviceList) {
      const protocol = device.attributes[DeviceAdvanced.ATTR_PROTOCOL];
      if (HUB_PROTOCOLS.has(String(protocol))) device.hubAddress = hub.address;
    }
    deviceList.push(hub);
  }

  // Update the devices map in-place (don't clear — avoids dropping real-time events mid-sync)
  const freshAddresses = new Set<string>();
  for (const device of deviceList) {
    freshAddresses.add(device.address);
    if (!firstSync && !devices.has(device.address)) {
      console.log(`[Sync] Added device: ${device.name} (${device.address})`);
    }
    devices.set(device.address, device);
  }
  // The list can be older than value changes that arrived while it was fetched, which the
  // fresh devices would undo, so apply them again, in order. This also keeps the first
  // values of a device that was just added, which arrived before the bridge knew it.
  for (const [address, attributes] of changes) {
    const device = devices.get(address);
    if (device) Object.assign(device.attributes, attributes);
  }
  // Before device discovery, so hub-paired devices don't start out waiting on this topic
  if (hub) publishHubConnection(mqtt, config, hub);

  // Remove devices no longer present, from the map and from HA
  for (const [address, device] of devices) {
    if (!freshAddresses.has(address)) {
      devices.delete(address);
      removeOwnedDiscovery(mqtt, address);
      clearDeviceTopics(mqtt, config, device);
      console.log(`[Sync] Removed device: ${device.name} (${address})`);
    }
  }

  // Publish discovery, state, and availability for each device
  for (const device of deviceList) {
    publishDiscovery(mqtt, config, device);
    publishState(mqtt, config, device);
    publishAvailability(mqtt, config, device);
  }

  // Lock access switches: refresh the person list (keeping the last one on error), then publish,
  // or remove them all when the lock_access feature is off
  if (hasFeature(config, Features.LOCK_ACCESS)) {
    try {
      const freshPeople = await client.listPersons();
      people.length = 0;
      people.push(...freshPeople);
    } catch (err) {
      console.error('[Sync] Person list error:', err);
    }
  }
  publishLockAccessDiscovery(mqtt, config, devices.values(), people);

  // Sync alarm: discovery + state + availability
  publishAlarmDiscovery(mqtt, config);
  try {
    const alarmState = await client.getAlarmState();
    publishAlarmState(mqtt, config, alarmState, (address) => devices.get(address)?.name ?? address);
    publishAlarmAvailability(mqtt, config, true);
  } catch (err) {
    console.error('[Sync] Alarm state fetch error:', err);
    publishAlarmAvailability(mqtt, config, false);
  }

  // Sync scenes: refresh list + publish discovery
  try {
    const freshScenes = await client.listScenes();
    scenes.length = 0;
    scenes.push(...freshScenes);
    publishSceneDiscovery(mqtt, config, scenes);
  } catch (err) {
    console.error('[Sync] Scene list error:', err);
  }
}

/** Start the sync loop: initial sync, then poll + event handling */
export async function startSync(
  mqtt: Mqtt,
  config: Config,
  client: ArcusClient,
): Promise<{ stop(): void }> {
  const devices = new Map<string, ArcusDevice>();
  const scenes: SceneInfo[] = [];
  const people: PersonInfo[] = [];
  let connected = false;
  let synced = false;
  /** Value changes received while a sync runs, for it to apply again; null between syncs */
  let changesDuringSync: Array<[string, ArcusAttributes]> | null = null;

  // Entities stay unavailable until the first sync succeeds
  publishBridgeAvailability(mqtt, config, false);

  // Only one full sync runs at a time. A request that arrives mid-sync (e.g. a
  // reconnect during a poll) shares the running sync and makes it run once more.
  let syncing: Promise<void> | null = null;
  let rerun = false;

  /** Full sync, then mark the bridge online if the connection is still up */
  const syncAndMarkOnline = (): Promise<void> => {
    if (syncing) {
      rerun = true;
      return syncing;
    }
    syncing = (async () => {
      try {
        do {
          rerun = false;
          changesDuringSync = [];
          try {
            await fullSync(mqtt, config, client, devices, scenes, people, { firstSync: !synced, changes: changesDuringSync });
            synced = true;
            if (connected) publishBridgeAvailability(mqtt, config, true);
          } catch (err) {
            // A sync requested meanwhile (typically a reconnect) supersedes this failure
            if (!rerun) throw err;
            console.warn('[Sync] Sync failed, rerunning for a newer request:', err);
          }
        } while (rerun);
      } finally {
        syncing = null;
        changesDuringSync = null;
      }
    })();
    return syncing;
  };

  // Upstream connection drops mark every entity unavailable; a reconnect resyncs
  // to pick up anything that changed during the outage.
  client.onConnectionChange((up) => {
    connected = up;
    if (!up) {
      console.warn('[Sync] Arcus connection lost, marking bridge offline');
      publishBridgeAvailability(mqtt, config, false);
      return;
    }
    console.log('[Sync] Arcus connection restored, resyncing');
    syncAndMarkOnline().catch((err) => {
      console.error('[Sync] Resync after reconnect failed:', err);
    });
  });

  // A device paired or removed in Arcus: sync now, rather than at the next poll
  client.onDeviceListChange(() => {
    if (!connected) return;
    syncAndMarkOnline().catch((err) => {
      console.error('[Sync] Resync after a device change failed:', err);
    });
  });

  // After an MQTT reconnect, republish everything: the broker may have restarted and
  // lost its retained messages, and the will message has marked the bridge offline
  mqtt.onReconnect(() => {
    resetPublishedDiscovery(mqtt);
    if (!connected) {
      publishBridgeAvailability(mqtt, config, false);
      return;
    }
    syncAndMarkOnline().catch((err) => {
      console.error('[Sync] Resync after MQTT reconnect failed:', err);
    });
  });

  // Set up command handling (HA → Arcus)
  setupCommandHandler(mqtt, config, client, devices);

  // Set up alarm command handling and event listening
  const deviceName = (address: string) => devices.get(address)?.name ?? address;
  setupAlarmCommandHandler(mqtt, config, client, deviceName);
  // Alarm events also come for sensor changes that leave the alarm as it was, so only
  // a change of mode is logged
  let alarmMode = '';
  client.onAlarmEvent((alarmState) => {
    publishAlarmState(mqtt, config, alarmState, deviceName);
    const mode = `${alarmState.securityMode} (${alarmState.alarmMode})`;
    (mode === alarmMode ? console.debug : console.log)(`[Sync] Real-time alarm update: ${mode}`);
    alarmMode = mode;
  });

  // Set up scene command handling and event listening
  setupSceneCommandHandler(mqtt, config, client, scenes);
  client.onSceneEvent((sceneAddress) => {
    publishSceneFired(mqtt, config, scenes, sceneAddress);
  });

  // Listen for real-time device events
  client.onDeviceEvent((address, attributes) => {
    changesDuringSync?.push([address, attributes]);
    const device = devices.get(address);
    if (!device) {
      console.debug(`[Sync] Event for unknown device ${address}, skipping`);
      return;
    }

    // Update local state
    const wasOnline = isDeviceOnline(device);
    const firstValue = Object.keys(attributes).some(key => !(key in device.attributes));
    Object.assign(device.attributes, attributes);

    // A first value can add an entity (a power meter's first reading), so don't wait for the next poll
    if (firstValue) publishDiscovery(mqtt, config, device);

    // Re-publish state immediately
    publishState(mqtt, config, device);

    if (HubConnection.ATTR_STATE in attributes && device.caps.has(Hub.NAMESPACE)) {
      publishHubConnection(mqtt, config, device);
      console.log(`[Sync] Hub is now ${attributes[HubConnection.ATTR_STATE]}`);
    }

    if (DeviceConnection.ATTR_STATE in attributes) {
      publishAvailability(mqtt, config, device);
      const online = isDeviceOnline(device);
      if (online !== wasOnline) {
        console.log(`[Sync] ${device.name} (${address}) is now ${online ? 'online' : 'offline'}`);
      }
    }

    // Fire any event-driven mappers (e.g. button triggers)
    for (const mapper of matchingMappers(device)) {
      mapper.onEvent?.(mqtt, config, device, attributes);
    }

    console.debug(`[Sync] Real-time update: ${device.name} (${address})`);
  });

  // Connect to the upstream client
  await client.connect();
  connected = true;

  // Initial full sync (includes alarm discovery + state + scenes)
  await syncAndMarkOnline();

  // Periodic poll, a safety net for missed events; skipped while disconnected
  // since the reconnect handler resyncs.
  const interval = setInterval(async () => {
    if (!connected) return;
    try {
      await syncAndMarkOnline();
    } catch (err) {
      console.error('[Sync] Poll error:', err);
    }
  }, config.pollIntervalMs);

  return {
    stop() {
      clearInterval(interval);
      // Shutdown marks the bridge offline next; a sync still running mustn't mark it online after that
      connected = false;
    },
  };
}
