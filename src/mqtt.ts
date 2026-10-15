import { randomBytes } from 'crypto';
import { connect, type MqttClient } from 'mqtt';
import type { Config } from './config.js';

/** What the bridge needs from MQTT: publish, and subscribe to the topics HA sends commands on */
export interface Mqtt {
  /** Publish a message. Retained messages stay on the broker; an empty retained payload clears the topic */
  publish(topic: string, payload: string, retain: boolean): void;
  /** Call the handler for live messages on topics matching the filter (`+` and `#` wildcards) */
  subscribe(filter: string, handler: (topic: string, payload: string) => void): void;
  /** Call the handler each time the connection to the broker comes back after a drop */
  onReconnect(handler: () => void): void;
}

/** Where the broker is and how to log in */
export interface MqttConnection {
  url: string;
  username?: string;
  password?: string;
}

export interface MqttContext {
  mqtt: Mqtt;
  /** Publish the will message (so HA sees the bridge go offline), then disconnect */
  close(): Promise<void>;
}

/** The Supervisor API, reachable from inside a Home Assistant app */
export const SUPERVISOR_URL = 'http://supervisor';

/** Does a topic match a subscription filter with `+` (one level) and `#` (the rest) wildcards? */
export function topicMatches(filter: string, topic: string): boolean {
  const f = filter.split('/');
  const t = topic.split('/');
  for (let i = 0; i < f.length; i++) {
    if (f[i] === '#') return true;
    if (i >= t.length || (f[i] !== '+' && f[i] !== t[i])) return false;
  }
  return f.length === t.length;
}

/**
 * Ask the Supervisor for the broker that provides the MQTT service (the Mosquitto app).
 * Returns null when no app provides it, e.g. Mosquitto isn't installed.
 */
export async function supervisorMqtt(token: string, baseUrl = SUPERVISOR_URL): Promise<MqttConnection | null> {
  const res = await fetch(`${baseUrl}/services/mqtt`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) return null;
  const body = await res.json() as {
    data?: { host?: string; port?: number; ssl?: boolean; username?: string; password?: string };
  };
  const data = body.data;
  if (!data?.host || !data.port) return null;
  return {
    url: `${data.ssl ? 'mqtts' : 'mqtt'}://${data.host}:${data.port}`,
    username: data.username,
    password: data.password,
  };
}

/**
 * Find the broker: MQTT_URL when set, else the Supervisor's MQTT service when running
 * as a Home Assistant app. In the app, waits for a broker app to be installed.
 */
export async function resolveMqttConnection(
  config: Config,
  { retryMs = 30_000, supervisorUrl = SUPERVISOR_URL } = {},
): Promise<MqttConnection> {
  if (config.mqttUrl) {
    return { url: config.mqttUrl, username: config.mqttUsername, password: config.mqttPassword };
  }
  if (!config.supervisorToken) {
    throw new Error('MQTT_URL is required, e.g. mqtt://localhost:1883');
  }
  for (;;) {
    try {
      const conn = await supervisorMqtt(config.supervisorToken, supervisorUrl);
      if (conn) return conn;
      console.warn(`[MQTT] No MQTT broker found. Install the Mosquitto broker app; retrying in ${retryMs / 1000}s`);
    } catch (err) {
      console.warn('[MQTT] Could not ask the Supervisor for the MQTT broker:', err);
    }
    await new Promise(r => setTimeout(r, retryMs));
  }
}

/**
 * Connect to the broker, resolving once connected and reconnecting after that. The will
 * message is published by the broker if the bridge drops off without disconnecting.
 * Rejects if the broker refuses the connection (e.g. a bad login), which retrying won't fix.
 */
export function connectMqtt(
  conn: MqttConnection,
  will: { topic: string; payload: string },
  { protocolVersion = 5, reconnectPeriod = 5000 }: { protocolVersion?: 4 | 5; reconnectPeriod?: number } = {},
): Promise<MqttContext> {
  const client: MqttClient = connect(conn.url, {
    username: conn.username,
    password: conn.password,
    protocolVersion,
    clientId: `arcus-mqtt-${randomBytes(4).toString('hex')}`,
    will: { topic: will.topic, payload: Buffer.from(will.payload), qos: 1, retain: true },
    reconnectPeriod,
    // Keep retrying after a refused reconnect too, e.g. while the broker restarts
    reconnectOnConnackError: true,
  });

  const subscriptions: Array<{ filter: string; handler: (topic: string, payload: string) => void }> = [];
  const reconnectHandlers: Array<() => void> = [];
  let connected = false;

  client.on('message', (topic, payload, packet) => {
    // Retained messages are replays of old ones, never fresh commands
    if (packet.retain) return;
    const text = payload.toString();
    for (const sub of subscriptions) {
      if (topicMatches(sub.filter, topic)) sub.handler(topic, text);
    }
  });

  client.on('offline', () => {
    if (connected) console.warn('[MQTT] Disconnected from the broker, reconnecting');
  });

  const mqtt: Mqtt = {
    publish(topic, payload, retain) {
      client.publish(topic, payload, { qos: 1, retain }, (err) => {
        if (err) console.error(`[MQTT] Publish to ${topic} failed:`, err.message);
      });
    },
    subscribe(filter, handler) {
      subscriptions.push({ filter, handler });
      client.subscribe(filter, { qos: 1 }, (err) => {
        if (err) console.error(`[MQTT] Subscribe to ${filter} failed:`, err.message);
      });
    },
    onReconnect(handler) {
      reconnectHandlers.push(handler);
    },
  };

  const context: MqttContext = {
    mqtt,
    async close() {
      if (client.connected) {
        await client.publishAsync(will.topic, will.payload, { qos: 1, retain: true }).catch(() => {});
      }
      await client.endAsync();
    },
  };

  return new Promise((resolve, reject) => {
    client.on('error', (err) => {
      // A numeric code is the broker refusing the CONNECT: bad login, unsupported protocol
      const refused = typeof (err as { code?: unknown }).code === 'number';
      if (refused && !connected) {
        client.end(true);
        reject(new Error(`MQTT broker at ${conn.url} refused the connection: ${err.message}`));
        return;
      }
      console.warn(`[MQTT] ${err.message}`);
    });

    client.on('connect', () => {
      if (connected) {
        console.log('[MQTT] Reconnected to the broker');
        for (const handler of reconnectHandlers) handler();
        return;
      }
      connected = true;
      console.log(`[MQTT] Connected to ${conn.url}`);
      resolve(context);
    });
  });
}
