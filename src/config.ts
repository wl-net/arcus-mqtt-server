import { existsSync, readFileSync } from 'fs';

/** Where the Home Assistant Supervisor writes an app's settings */
export const APP_OPTIONS_PATH = '/data/options.json';

/**
 * Copy settings from a Home Assistant app's options file into the environment.
 * Variables already set win, and empty or null values are skipped so unset
 * optional fields stay unset. Returns false when there's no options file.
 */
export function loadAppOptions(path = APP_OPTIONS_PATH, env: NodeJS.ProcessEnv = process.env): boolean {
  if (!existsSync(path)) return false;
  const options = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  for (const [key, value] of Object.entries(options)) {
    if (value === null || value === '' || env[key] !== undefined) continue;
    env[key] = String(value);
  }
  return true;
}

export interface Config {
  mqttPort: number;
  mqttUsername: string | undefined;
  mqttPassword: string | undefined;
  mqttTlsCert: string | undefined;
  mqttTlsKey: string | undefined;
  arcusMock: boolean;
  pollIntervalMs: number;
  haDiscoveryPrefix: string;
  deviceIdPrefix: string;
  arcusBridgeUrl: string | undefined;
  arcusUsername: string | undefined;
  arcusPassword: string | undefined;
  arcusAuthToken: string | undefined;
  arcusApiKey: string | undefined;
  arcusPlaceId: string | undefined;
}

export function loadConfig(): Config {
  return {
    mqttPort: parseInt(process.env.MQTT_PORT ?? '1883', 10),
    mqttUsername: process.env.MQTT_USERNAME,
    mqttPassword: process.env.MQTT_PASSWORD,
    mqttTlsCert: process.env.MQTT_TLS_CERT,
    mqttTlsKey: process.env.MQTT_TLS_KEY,
    arcusMock: process.env.ARCUS_MOCK === '1',
    pollIntervalMs: parseInt(process.env.POLL_INTERVAL_MS ?? '300000', 10),
    haDiscoveryPrefix: process.env.HA_DISCOVERY_PREFIX ?? 'homeassistant',
    deviceIdPrefix: process.env.DEVICE_ID_PREFIX ?? 'arcus',
    arcusBridgeUrl: process.env.ARCUS_BRIDGE_URL,
    arcusUsername: process.env.ARCUS_USERNAME,
    arcusPassword: process.env.ARCUS_PASSWORD,
    arcusAuthToken: process.env.ARCUS_AUTH_TOKEN,
    arcusApiKey: process.env.ARCUS_API_KEY,
    arcusPlaceId: process.env.ARCUS_PLACE_ID,
  };
}
