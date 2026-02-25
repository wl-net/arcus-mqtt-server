import type { Config } from '../config.js';
import type { ArcusClient } from './client.js';
import type { ArcusDevice, ArcusAttributes, AlarmState, SceneInfo } from './types.js';
import { BridgeClient } from './bridge-client.js';

/** Known Arcus capability prefixes we care about for attribute mapping */
const CAP_PREFIXES = new Set([
  'swit', 'dim', 'doorlock', 'therm', 'temp', 'humid', 'cont',
  'mot', 'pres', 'tilt', 'glass', 'smoke', 'co', 'water', 'leak',
  'devpow', 'devconn', 'devota', 'devadv', 'wifi',
  'but', 'camera', 'indicator', 'color', 'colortemp',
  'fan', 'vent', 'spaceheater', 'irr', 'valve',
  'pow', 'alert', 'shade',
]);

function isRelevantAttribute(key: string): boolean {
  const prefix = key.split(':')[0];
  return CAP_PREFIXES.has(prefix);
}

function transformDevice(raw: Record<string, unknown>): ArcusDevice {
  const address = raw['base:address'] as string;
  const name = (raw['dev:name'] as string) ?? address;
  const type = (raw['dev:devtypehint'] as string) ?? 'Unknown';
  const rawCaps = (raw['base:caps'] as string[]) ?? [];
  const caps = new Set<string>(rawCaps);

  const attributes: ArcusAttributes = {};
  for (const [key, value] of Object.entries(raw)) {
    if (isRelevantAttribute(key) && (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')) {
      attributes[key] = value;
    }
  }

  return { address, name, type, caps, attributes };
}

export class PlatformArcusClient implements ArcusClient {
  private bridge: BridgeClient;
  private config: Config;
  private eventHandlers: Array<(address: string, attributes: ArcusAttributes) => void> = [];
  private alarmHandlers: Array<(state: AlarmState) => void> = [];
  private sceneHandlers: Array<(sceneAddress: string) => void> = [];

  constructor(config: Config) {
    this.config = config;
    this.bridge = new BridgeClient();

    // Wire up real-time events
    this.bridge.onEvent = (event) => {
      if (!event.source) return;

      // Detect alarm/security subsystem events
      if (event.source.startsWith('SERV:subsecurity:') || event.source.startsWith('SERV:subalarm:')) {
        console.log(`[PlatformClient] Alarm event: ${event.messageType} → ${JSON.stringify(event.attributes)}`);
        this.handleAlarmEvent();
        return;
      }

      // Detect scene fire events
      if (event.source.startsWith('SERV:scene:') && event.attributes['scene:lastFireTime'] !== undefined) {
        console.log(`[PlatformClient] Scene fired: ${event.source}`);
        for (const handler of this.sceneHandlers) {
          handler(event.source);
        }
        return;
      }

      if (event.messageType !== 'base:ValueChange') return;

      const changed: ArcusAttributes = {};
      for (const [key, value] of Object.entries(event.attributes)) {
        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
          changed[key] = value;
        }
      }

      if (Object.keys(changed).length === 0) return;

      console.log(`[PlatformClient] Event: ${event.source} → ${JSON.stringify(changed)}`);
      for (const handler of this.eventHandlers) {
        handler(event.source, changed);
      }
    };
  }

  private get subalarmDestination(): string {
    if (!this.config.arcusPlaceId) throw new Error('No place ID configured');
    return `SERV:subalarm:${this.config.arcusPlaceId}`;
  }

  private get subsecurityDestination(): string {
    if (!this.config.arcusPlaceId) throw new Error('No place ID configured');
    return `SERV:subsecurity:${this.config.arcusPlaceId}`;
  }

  private handleAlarmEvent(): void {
    // Re-fetch full alarm state to ensure we have a complete picture
    this.getAlarmState().then(alarm => {
      console.log(`[PlatformClient] Alarm state: ${JSON.stringify(alarm)}`);
      for (const handler of this.alarmHandlers) {
        handler(alarm);
      }
    }).catch(err => {
      console.error('[PlatformClient] Failed to fetch alarm state after event:', err);
    });
  }

  async connect(): Promise<void> {
    const { arcusBridgeUrl, arcusAuthToken, arcusUsername, arcusPassword, arcusPlaceId } = this.config;

    if (!arcusBridgeUrl) throw new Error('ARCUS_BRIDGE_URL is required');
    if (!arcusPlaceId) throw new Error('ARCUS_PLACE_ID is required');

    // Login if we don't have a token
    if (arcusAuthToken) {
      console.log('[PlatformClient] Using provided auth token');
    } else if (arcusUsername && arcusPassword) {
      console.log(`[PlatformClient] Logging in as ${arcusUsername}`);
      await this.bridge.login(arcusBridgeUrl, arcusUsername, arcusPassword);
    } else {
      throw new Error('Either ARCUS_AUTH_TOKEN or ARCUS_USERNAME + ARCUS_PASSWORD is required');
    }

    // Connect WebSocket
    console.log(`[PlatformClient] Connecting to ${arcusBridgeUrl}`);
    await this.bridge.connect(arcusBridgeUrl, arcusAuthToken ?? undefined);

    // Set active place
    this.bridge.setActivePlace(arcusPlaceId);
    console.log(`[PlatformClient] Setting active place: ${arcusPlaceId}`);
    await this.bridge.sendRequest('SERV:sess:', 'sess:SetActivePlace', { placeId: arcusPlaceId });
    console.log('[PlatformClient] Connected and active place set');
  }

  async listDevices(): Promise<ArcusDevice[]> {
    const resp = await this.bridge.sendRequest(this.bridge.placeDestination, 'place:ListDevices', {});
    const rawDevices = resp.payload.attributes.devices as Record<string, unknown>[] | undefined;

    if (!rawDevices || !Array.isArray(rawDevices)) {
      console.warn('[PlatformClient] No devices returned from platform');
      return [];
    }

    const devices = rawDevices.map(transformDevice);
    console.log(`[PlatformClient] Listed ${devices.length} devices`);
    return devices;
  }

  async sendCommand(address: string, attributes: ArcusAttributes): Promise<void> {
    console.log(`[PlatformClient] Command → ${address}:`, attributes);
    await this.bridge.sendRequest(address, 'base:SetAttributes', attributes);
  }

  onDeviceEvent(handler: (address: string, attributes: ArcusAttributes) => void): void {
    this.eventHandlers.push(handler);
  }

  async getAlarmState(): Promise<AlarmState> {
    const resp = await this.bridge.sendRequest(this.subsecurityDestination, 'base:GetAttributes', {});
    const attrs = resp.payload.attributes;
    return {
      securityMode: (attrs['subsecurity:alarmState'] as string) ?? 'DISARMED',
      alarmMode: (attrs['subsecurity:alarmMode'] as string) ?? 'ON',
    };
  }

  async armAlarm(mode: 'ON' | 'PARTIAL'): Promise<void> {
    console.log(`[PlatformClient] Arming alarm: ${mode}`);
    const resp = await this.bridge.sendRequest(this.subalarmDestination, 'subalarm:Arm', { mode });
    if (resp.payload.messageType === 'Error' && resp.payload.attributes.code === 'security.triggeredDevices') {
      console.log('[PlatformClient] Devices need bypassing, sending ArmBypassed');
      await this.bridge.sendRequest(this.subalarmDestination, 'subalarm:ArmBypassed', { mode });
    }
  }

  async disarmAlarm(): Promise<void> {
    console.log('[PlatformClient] Disarming alarm');
    await this.bridge.sendRequest(this.subalarmDestination, 'subalarm:Disarm', {});
  }

  onAlarmEvent(handler: (state: AlarmState) => void): void {
    this.alarmHandlers.push(handler);
  }

  async listScenes(): Promise<SceneInfo[]> {
    if (!this.config.arcusPlaceId) throw new Error('No place ID configured');
    const resp = await this.bridge.sendRequest('SERV:scene:', 'scene:ListScenes', {
      placeId: this.config.arcusPlaceId,
    });
    const rawScenes = resp.payload.attributes.scenes as Record<string, unknown>[] | undefined;
    if (!rawScenes || !Array.isArray(rawScenes)) {
      console.warn('[PlatformClient] No scenes returned from platform');
      return [];
    }
    const scenes = rawScenes
      .filter(s => s['scene:enabled'] === true)
      .map(s => ({
        address: s['base:address'] as string,
        id: s['base:id'] as string,
        name: s['scene:name'] as string,
        enabled: true,
      }));
    console.log(`[PlatformClient] Listed ${scenes.length} scenes`);
    return scenes;
  }

  onSceneEvent(handler: (sceneAddress: string) => void): void {
    this.sceneHandlers.push(handler);
  }

  async fireScene(address: string): Promise<void> {
    console.log(`[PlatformClient] Firing scene: ${address}`);
    await this.bridge.sendRequest(address, 'scene:Fire', {});
  }
}
