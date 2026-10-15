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
  /** Broker to connect to, e.g. mqtt://localhost:1883; unset in the app, where the Supervisor provides it */
  mqttUrl: string | undefined;
  mqttUsername: string | undefined;
  mqttPassword: string | undefined;
  /** Set by the Supervisor when running as a Home Assistant app */
  supervisorToken: string | undefined;
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
    mqttUrl: process.env.MQTT_URL || undefined,
    mqttUsername: process.env.MQTT_USERNAME || undefined,
    mqttPassword: process.env.MQTT_PASSWORD || undefined,
    supervisorToken: process.env.SUPERVISOR_TOKEN || undefined,
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
