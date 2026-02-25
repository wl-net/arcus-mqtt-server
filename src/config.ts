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
    pollIntervalMs: parseInt(process.env.POLL_INTERVAL_MS ?? '30000', 10),
    haDiscoveryPrefix: process.env.HA_DISCOVERY_PREFIX ?? 'homeassistant',
    deviceIdPrefix: process.env.DEVICE_ID_PREFIX ?? 'arcus',
    arcusBridgeUrl: process.env.ARCUS_BRIDGE_URL,
    arcusUsername: process.env.ARCUS_USERNAME,
    arcusPassword: process.env.ARCUS_PASSWORD,
    arcusAuthToken: process.env.ARCUS_AUTH_TOKEN,
    arcusPlaceId: process.env.ARCUS_PLACE_ID,
  };
}
