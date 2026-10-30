import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocketServer, type WebSocket } from 'ws';
import { topicMatches, type Mqtt } from '../src/mqtt.js';
import type { ArcusDevice, ArcusAttributes } from '../src/arcus/types.js';
import { loadConfig, type Config } from '../src/config.js';

/** Silence the app's console logging for the rest of the test file */
export function quietConsole(): void {
  for (const level of ['log', 'warn', 'error', 'debug'] as const) {
    console[level] = () => {};
  }
}

export function testConfig(overrides: Partial<Config> = {}): Config {
  return { ...loadConfig(), arcusMock: false, pollIntervalMs: 3_600_000, ...overrides };
}

export function makeDevice(
  address: string,
  caps: string[],
  attributes: ArcusAttributes = {},
  name = 'Test Device',
): ArcusDevice {
  return { address, name, type: 'Test', caps: new Set(caps), attributes: { ...attributes } };
}

/** A stand-in for the MQTT connection that records what the app publishes */
export class FakeMqtt implements Mqtt {
  /** Every publish, in order */
  readonly published: Array<{ topic: string; payload: string; retain: boolean }> = [];
  /** Latest retained payload per topic, as a real broker would keep it (empty payload clears) */
  readonly retained = new Map<string, string>();
  private subscriptions: Array<{ filter: string; handler: (topic: string, payload: string) => void }> = [];
  private reconnectHandlers: Array<() => void> = [];

  publish(topic: string, payload: string, retain: boolean): void {
    this.published.push({ topic, payload, retain });
    if (retain) {
      if (payload === '') this.retained.delete(topic);
      else this.retained.set(topic, payload);
    }
  }

  subscribe(filter: string, handler: (topic: string, payload: string) => void): void {
    this.subscriptions.push({ filter, handler });
  }

  onReconnect(handler: () => void): void {
    this.reconnectHandlers.push(handler);
  }

  /** Deliver a message to the app's matching subscriptions, as HA sending a command would */
  deliver(topic: string, payload: string): void {
    for (const sub of this.subscriptions) {
      if (topicMatches(sub.filter, topic)) sub.handler(topic, payload);
    }
  }

  /** Simulate the connection to the broker dropping and coming back */
  reconnect(): void {
    for (const handler of this.reconnectHandlers) handler();
  }

  /** Parsed JSON of a retained topic */
  json(topic: string): Record<string, unknown> {
    const raw = this.retained.get(topic);
    if (raw === undefined) throw new Error(`No retained message on ${topic}`);
    return JSON.parse(raw) as Record<string, unknown>;
  }

  /** Publishes since the given index, optionally filtered by topic prefix */
  since(index: number, prefix = ''): Array<{ topic: string; payload: string }> {
    return this.published.slice(index).filter(p => p.topic.startsWith(prefix));
  }
}

/** Poll until a condition holds, or fail after a timeout */
export async function until(condition: () => boolean, timeoutMs = 3000, label = 'condition'): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}`);
    await new Promise(r => setTimeout(r, 10));
  }
}

export interface ArcusRequest {
  messageType: string;
  destination: string;
  attributes: Record<string, unknown>;
  connection: number;
}

/** Return null to send no reply at all */
type Responder = (req: ArcusRequest) => { messageType: string; attributes: Record<string, unknown> } | null;

export interface Handshake {
  path: string;
  cookie?: string;
  authorization?: string;
}

/**
 * A fake Arcus bridge / API server. POST /login hands out irisAuthToken cookies,
 * the WebSocket upgrade optionally checks the cookie or bearer token, sends
 * SessionCreated on connect, and answers each request with the responder's reply.
 */
export class FakeArcusServer {
  readonly requests: ArcusRequest[] = [];
  /** Every WebSocket upgrade attempt, accepted or not */
  readonly handshakes: Handshake[] = [];
  /** Accepted WebSocket connections */
  connections = 0;
  logins = 0;
  /** Tokens (cookie or bearer) the server accepts, with a 401 for others; null accepts any */
  validTokens: Set<string> | null = null;
  /** When false, the server accepts upgrades but never sends SessionCreated */
  sendSession = true;
  /** When false, pings go unanswered, as on a connection that died without closing */
  answerPings = true;
  private sockets: WebSocket[] = [];
  private http!: Server;
  private wss!: WebSocketServer;

  constructor(private respond: Responder) {}

  async start(): Promise<string> {
    this.http = createServer((req, res) => {
      if (req.method === 'POST' && req.url === '/login') {
        req.resume();
        const token = `login-token-${++this.logins}`;
        this.validTokens?.add(token);
        res.writeHead(200, { 'Set-Cookie': `irisAuthToken=${token}; Path=/; HttpOnly` });
        res.end();
        return;
      }
      res.writeHead(404);
      res.end();
    });
    this.wss = new WebSocketServer({
      server: this.http,
      verifyClient: (info: { req: IncomingMessage }, cb: (ok: boolean, code?: number) => void) => {
        const { cookie, authorization } = info.req.headers;
        this.handshakes.push({ path: info.req.url ?? '', cookie, authorization });
        const token = cookie?.match(/irisAuthToken=([^;]+)/)?.[1] ?? authorization?.replace(/^Bearer /, '');
        cb(!this.validTokens || (!!token && this.validTokens.has(token)), 401);
      },
      autoPong: false,
    });
    this.wss.on('connection', (ws) => {
      const connection = ++this.connections;
      this.sockets.push(ws);
      ws.on('ping', (data) => {
        if (this.answerPings) ws.pong(data);
      });
      if (this.sendSession) {
        ws.send(JSON.stringify({
          headers: {},
          payload: { messageType: 'SessionCreated', attributes: { personId: 'person-1', places: [{ placeId: 'place-1' }] } },
        }));
      }
      ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString());
        const req: ArcusRequest = {
          messageType: msg.payload.messageType,
          destination: msg.headers.destination,
          attributes: msg.payload.attributes,
          connection,
        };
        this.requests.push(req);
        const reply = this.respond(req);
        if (reply === null) return;
        ws.send(JSON.stringify({ headers: { correlationId: msg.headers.correlationId }, payload: reply }));
      });
    });
    await new Promise<void>(resolve => this.http.listen(0, '127.0.0.1', () => resolve()));
    const { port } = this.http.address() as AddressInfo;
    return `http://127.0.0.1:${port}`;
  }

  /** Send an unsolicited event (e.g. base:ValueChange) on the latest connection */
  sendEvent(source: string, messageType: string, attributes: Record<string, unknown>): void {
    this.send({ source }, messageType, attributes);
  }

  /** Send an unsolicited message with the given headers on the latest connection */
  send(headers: Record<string, unknown>, messageType: string, attributes: Record<string, unknown>): void {
    this.sockets[this.sockets.length - 1].send(JSON.stringify({ headers, payload: { messageType, attributes } }));
  }

  /** Drop the latest connection abruptly */
  dropConnection(): void {
    this.sockets[this.sockets.length - 1].terminate();
  }

  requestsOf(messageType: string): ArcusRequest[] {
    return this.requests.filter(r => r.messageType === messageType);
  }

  async stop(): Promise<void> {
    for (const ws of this.sockets) ws.terminate();
    await new Promise<void>(resolve => this.wss.close(() => resolve()));
    this.http.closeAllConnections();
    await new Promise<void>(resolve => this.http.close(() => resolve()));
  }
}

export const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

export const OK = { messageType: 'EmptyMessage', attributes: {} };
