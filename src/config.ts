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

/** Optional features, off unless named in FEATURES (comma-separated, e.g. FEATURES=buzz_in,lock_access) */
export const Features = {
  /** A Buzz in button on locks that support it */
  BUZZ_IN: 'buzz_in',
  /** A switch per person on each lock that adds or removes their Arcus PIN */
  LOCK_ACCESS: 'lock_access',
  /** A siren entity for each siren, to sound it from Home Assistant */
  SIRENS: 'sirens',
} as const;

export type Feature = (typeof Features)[keyof typeof Features];

const KNOWN_FEATURES = new Set<string>(Object.values(Features));

/** Parse FEATURES, warning about names it doesn't know */
export function parseFeatures(value: string | undefined): Set<Feature> {
  const features = new Set<Feature>();
  for (const name of (value ?? '').toLowerCase().split(/[\s,]+/).filter(Boolean)) {
    if (KNOWN_FEATURES.has(name)) features.add(name as Feature);
    else console.warn(`[Config] Unknown feature in FEATURES: ${name}`);
  }
  return features;
}

export function hasFeature(config: Config, feature: Feature): boolean {
  return config.features.has(feature);
}

/** LOG_LEVEL, least to most severe. debug adds a line for every device event */
export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;

export type LogLevel = (typeof LOG_LEVELS)[number];

/** Parse LOG_LEVEL, warning about a name it doesn't know; info when unset */
export function parseLogLevel(value: string | undefined): LogLevel {
  const name = (value ?? '').trim().toLowerCase();
  if (!name) return 'info';
  if ((LOG_LEVELS as readonly string[]).includes(name)) return name as LogLevel;
  console.warn(`[Config] Unknown LOG_LEVEL: ${value}, using info`);
  return 'info';
}

/**
 * Silence the console methods below the level. The server logs through console.debug,
 * console.log (info), console.warn and console.error.
 */
export function applyLogLevel(level: LogLevel, target: Console = console): void {
  const rank = LOG_LEVELS.indexOf(level);
  const off = () => {};
  if (rank > 0) target.debug = off;
  if (rank > 1) target.log = target.info = off;
  if (rank > 2) target.warn = off;
}

export interface Config {
  /** Broker to connect to, e.g. mqtt://localhost:1883; unset in the app, where the Supervisor provides it */
  mqttUrl: string | undefined;
  mqttUsername: string | undefined;
  mqttPassword: string | undefined;
  /** Set by the Supervisor when running as a Home Assistant app */
  supervisorToken: string | undefined;
  arcusMock: boolean;
  /** In mock mode, a name that gives this bridge's mock devices their own addresses */
  arcusMockPlace: string | undefined;
  /** Optional features that are turned on (see Features) */
  features: Set<Feature>;
  logLevel: LogLevel;
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
    arcusMockPlace: process.env.ARCUS_MOCK_PLACE || undefined,
    features: parseFeatures(process.env.FEATURES),
    // ARCUS_DEBUG traces the Arcus connection at debug level, so it turns that level on
    logLevel: parseLogLevel(process.env.LOG_LEVEL || (process.env.ARCUS_DEBUG ? 'debug' : undefined)),
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
