import { loadAppOptions, loadConfig, applyLogLevel, APP_OPTIONS_PATH } from './config.js';
import { connectMqtt, resolveMqttConnection } from './mqtt.js';
import { bridgeAvailabilityTopic } from './ha/topics.js';
import { MockArcusClient, type ArcusClient } from './arcus/client.js';
import { PlatformArcusClient } from './arcus/platform-client.js';
import { startSync } from './sync.js';

/** Within Docker's 10 second stop timeout */
const SHUTDOWN_TIMEOUT_MS = 5000;

/** The image's unprivileged user */
const RUN_AS = 'node';

/**
 * Stop running as root. The image starts as root because the Supervisor makes the app's
 * options file readable only by root; nothing after reading it needs root.
 */
function dropRoot(): void {
  if (process.getuid?.() !== 0 || !process.setuid || !process.setgid || !process.setgroups) return;
  try {
    // Groups first: root's supplementary groups would otherwise stay
    process.setgroups([]);
    process.setgid(RUN_AS);
    process.setuid(RUN_AS);
  } catch (err) {
    console.warn(`[Main] Could not switch to the ${RUN_AS} user, running as root:`, err);
  }
}

async function main() {
  // Running as a Home Assistant app: settings come from the app's Configuration tab
  const appOptions = loadAppOptions();
  dropRoot();
  const config = loadConfig();
  applyLogLevel(config.logLevel);

  console.log('[Main] Starting Arcus MQTT Bridge');
  if (appOptions) console.log(`[Main] Loaded app options from ${APP_OPTIONS_PATH}`);
  console.log(`[Main] Mock mode: ${config.arcusMock}`);
  console.log(`[Main] Poll interval: ${config.pollIntervalMs}ms`);

  // Create the Arcus client
  let client: ArcusClient;
  if (config.arcusMock) {
    client = new MockArcusClient(config.arcusMockPlace);
  } else {
    // Validate required env vars for platform mode
    if (!config.arcusBridgeUrl) {
      console.error('[Main] ARCUS_BRIDGE_URL is required when not in mock mode');
      process.exit(1);
    }
    if (config.arcusApiKey) {
      // API-server mode: only bridge URL + API key needed, place ID is optional
      console.log('[Main] Using api-server mode (ARCUS_API_KEY)');
    } else {
      // Client-bridge mode: need credentials + place ID
      if (!config.arcusPlaceId) {
        console.error('[Main] ARCUS_PLACE_ID is required when not using ARCUS_API_KEY');
        process.exit(1);
      }
      if (!config.arcusAuthToken && !(config.arcusUsername && config.arcusPassword)) {
        console.error('[Main] Either ARCUS_AUTH_TOKEN, ARCUS_API_KEY, or ARCUS_USERNAME + ARCUS_PASSWORD is required');
        process.exit(1);
      }
    }
    client = new PlatformArcusClient(config);
  }

  // Connect to the MQTT broker. If the bridge drops off, the broker marks it offline in HA
  const connection = await resolveMqttConnection(config);
  const { mqtt, close } = await connectMqtt(connection, { topic: bridgeAvailabilityTopic(config), payload: 'offline' });

  // Start sync loop
  const sync = await startSync(mqtt, config, client);

  console.log('[Main] Bridge is running');

  // Graceful shutdown: close the Arcus session, and mark the bridge offline in HA
  let stopping = false;
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    console.log('[Main] Shutting down...');
    // Don't wait forever on a broker that's gone
    setTimeout(() => process.exit(1), SHUTDOWN_TIMEOUT_MS).unref();
    sync.stop();
    client.disconnect();
    await close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('[Main] Fatal error:', err);
  process.exit(1);
});
