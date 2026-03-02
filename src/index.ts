import { loadConfig } from './config.js';
import { startBroker } from './broker.js';
import { MockArcusClient } from './arcus/client.js';
import { PlatformArcusClient } from './arcus/platform-client.js';
import { startSync } from './sync.js';

async function main() {
  const config = loadConfig();

  console.log('[Main] Starting Arcus MQTT Bridge');
  console.log(`[Main] Mock mode: ${config.arcusMock}`);
  console.log(`[Main] Poll interval: ${config.pollIntervalMs}ms`);

  // Start the embedded MQTT broker
  const { broker, close } = await startBroker(config);

  // Create the Arcus client
  let client;
  if (config.arcusMock) {
    client = new MockArcusClient();
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

  // Start sync loop
  const sync = await startSync(broker, config, client);

  console.log('[Main] Bridge is running');

  // Graceful shutdown
  const shutdown = async () => {
    console.log('\n[Main] Shutting down...');
    sync.stop();
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
