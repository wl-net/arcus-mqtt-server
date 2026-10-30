import type { Config } from '../config.js';
import type { ArcusClient } from './client.js';
import type { ArcusDevice, ArcusAttributes, ArcusMethodCall, AlarmState, PersonInfo, SceneInfo } from './types.js';
import { isAttributeValue } from './types.js';
import { BridgeClient, throwIfErrorResponse } from './bridge-client.js';
import { Base, Person, Place, SecuritySubsystem } from './capabilities.js';

/** base:instances, e.g. { button1: ['but'] }, keeping only well-formed entries */
function readInstances(value: unknown): Record<string, string[]> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string[]] =>
      Array.isArray(entry[1]) && entry[1].every(cap => typeof cap === 'string')),
  );
}

/** How long a command from HA waits for a dropped Arcus connection to come back before failing */
const COMMAND_RECONNECT_WAIT_MS = 15_000;

/** Device addresses, as opposed to services, people and the place */
const DEVICE_ADDRESS_PREFIX = 'DRIV:dev:';

function transformDevice(raw: Record<string, unknown>): ArcusDevice {
  const address = raw['base:address'] as string;
  const name = (raw['dev:name'] as string) ?? address;
  const type = (raw['dev:devtypehint'] as string) ?? 'Unknown';
  const rawCaps = (raw['base:caps'] as string[]) ?? [];
  const caps = new Set<string>(rawCaps);
  const instances = readInstances(raw['base:instances']);

  // Keep primitive attributes from the device's own capabilities, and from its
  // capability instances (but:state:button1 when base:instances has button1: ['but']).
  // Filtering by base:caps (rather than a fixed namespace list) means a newly mapped
  // capability can't silently lose its state on every sync.
  const attributes: ArcusAttributes = {};
  for (const [key, value] of Object.entries(raw)) {
    const [namespace, , instance] = key.split(':');
    const ownCap = caps.has(namespace) || (instance !== undefined && instances[instance]?.includes(namespace));
    if (ownCap && isAttributeValue(value)) {
      attributes[key] = value;
    }
  }

  return { address, name, type, caps, instances, attributes };
}

export class PlatformArcusClient implements ArcusClient {
  private bridge: BridgeClient;
  private config: Config;
  private eventHandlers: Array<(address: string, attributes: ArcusAttributes) => void> = [];
  private alarmHandlers: Array<(state: AlarmState) => void> = [];
  private sceneHandlers: Array<(sceneAddress: string) => void> = [];
  private connectionHandlers: Array<(connected: boolean) => void> = [];
  private deviceListHandlers: Array<() => void> = [];

  constructor(config: Config) {
    this.config = config;
    this.bridge = new BridgeClient();

    this.bridge.onConnectionChange = (connected) => {
      for (const handler of this.connectionHandlers) {
        handler(connected);
      }
    };

    // Wire up real-time events
    this.bridge.onEvent = (event) => {
      if (!event.source) return;

      // Detect alarm/security subsystem events
      if (event.source.startsWith('SERV:subsecurity:') || event.source.startsWith('SERV:subalarm:')) {
        console.debug(`[PlatformClient] Alarm event: ${event.messageType} → ${JSON.stringify(event.attributes)}`);
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

      // A device was paired or removed
      if ((event.messageType === Base.EVENT_ADDED || event.messageType === Base.EVENT_DELETED)
        && event.source.startsWith(DEVICE_ADDRESS_PREFIX)) {
        console.log(`[PlatformClient] Device ${event.messageType === Base.EVENT_ADDED ? 'added' : 'removed'}: ${event.source}`);
        for (const handler of this.deviceListHandlers) {
          handler();
        }
        return;
      }

      if (event.messageType !== Base.EVENT_VALUECHANGE) return;

      const changed: ArcusAttributes = {};
      for (const [key, value] of Object.entries(event.attributes)) {
        if (isAttributeValue(value)) {
          changed[key] = value;
        }
      }

      if (Object.keys(changed).length === 0) return;

      console.debug(`[PlatformClient] Event: ${event.source} → ${JSON.stringify(changed)}`);
      for (const handler of this.eventHandlers) {
        handler(event.source, changed);
      }
    };
  }

  private get placeId(): string {
    const id = this.config.arcusPlaceId;
    if (!id) throw new Error('No place ID configured');
    return id;
  }

  private get subalarmDestination(): string {
    return `SERV:subalarm:${this.placeId}`;
  }

  private get subsecurityDestination(): string {
    return `SERV:subsecurity:${this.placeId}`;
  }

  private handleAlarmEvent(): void {
    // Re-fetch full alarm state to ensure we have a complete picture
    this.getAlarmState().then(alarm => {
      console.debug(`[PlatformClient] Alarm state: ${JSON.stringify(alarm)}`);
      for (const handler of this.alarmHandlers) {
        handler(alarm);
      }
    }).catch(err => {
      console.error('[PlatformClient] Failed to fetch alarm state after event:', err);
    });
  }

  /**
   * Send a command from HA. During a reconnect it waits for the session to come back first,
   * so a lock or alarm command sent during a short drop still goes through.
   */
  private async sendCommandRequest(destination: string, messageType: string, attributes: Record<string, unknown>) {
    if (!this.bridge.connected && this.bridge.reconnecting) {
      console.log(`[PlatformClient] Waiting for the Arcus connection to come back to send ${messageType}`);
      await this.bridge.waitForConnection(COMMAND_RECONNECT_WAIT_MS);
    }
    return this.bridge.sendRequest(destination, messageType, attributes);
  }

  async connect(): Promise<void> {
    const { arcusBridgeUrl, arcusApiKey, arcusAuthToken, arcusUsername, arcusPassword } = this.config;

    if (!arcusBridgeUrl) throw new Error('ARCUS_BRIDGE_URL is required');

    if (arcusApiKey) {
      // API-server mode: connect with API key, place is auto-set by server
      console.log('[PlatformClient] Connecting via api-server with API key');
      const session = await this.bridge.connectApiServer(arcusBridgeUrl, arcusApiKey);

      // Auto-detect placeId from session if not explicitly configured
      if (!this.config.arcusPlaceId) {
        if (session.places.length === 0) {
          throw new Error('No places found in session — set ARCUS_PLACE_ID manually');
        }
        this.config.arcusPlaceId = session.places[0].placeId;
        console.log(`[PlatformClient] Auto-detected place: ${this.config.arcusPlaceId}`);
      }
      this.bridge.setActivePlace(this.config.arcusPlaceId!);
      console.log('[PlatformClient] Connected via api-server');
    } else {
      // Client-bridge mode: login → connect → SetActivePlace
      if (!this.config.arcusPlaceId) throw new Error('ARCUS_PLACE_ID is required');

      if (arcusAuthToken) {
        console.log('[PlatformClient] Using provided auth token');
      } else if (arcusUsername && arcusPassword) {
        console.log(`[PlatformClient] Logging in as ${arcusUsername}`);
        await this.bridge.login(arcusBridgeUrl, arcusUsername, arcusPassword);
      } else {
        throw new Error('Either ARCUS_AUTH_TOKEN or ARCUS_USERNAME + ARCUS_PASSWORD is required');
      }

      console.log(`[PlatformClient] Connecting to ${arcusBridgeUrl}`);
      await this.bridge.connect(arcusBridgeUrl, arcusAuthToken ?? undefined);

      const placeId = this.config.arcusPlaceId;
      this.bridge.setActivePlace(placeId);
      console.log(`[PlatformClient] Setting active place: ${placeId}`);
      try {
        throwIfErrorResponse(
          await this.bridge.sendRequest('SERV:sess:', 'sess:SetActivePlace', { placeId }),
          'sess:SetActivePlace',
        );
      } catch (err) {
        // Don't leave a session open (and auto-reconnecting) with no active place
        this.bridge.disconnect();
        throw err;
      }
      console.log('[PlatformClient] Connected and active place set');
    }
  }

  disconnect(): void {
    this.bridge.disconnect();
  }

  async listDevices(): Promise<ArcusDevice[]> {
    const resp = await this.bridge.sendRequest(this.bridge.placeDestination, 'place:ListDevices', {});
    const rawDevices = resp.payload.attributes.devices as Record<string, unknown>[] | undefined;

    // Throw rather than return []: an empty list would remove every device from HA
    if (!rawDevices || !Array.isArray(rawDevices)) {
      throw new Error(`place:ListDevices returned no device list (${resp.payload.messageType})`);
    }

    const devices = rawDevices.map(transformDevice);
    console.debug(`[PlatformClient] Listed ${devices.length} devices`);
    return devices;
  }

  async getHub(): Promise<ArcusDevice | null> {
    const resp = await this.bridge.sendRequest(this.bridge.placeDestination, 'place:GetHub', {});
    const rawHub = resp.payload.attributes.hub as Record<string, unknown> | undefined;
    if (!rawHub) return null;

    const hub = transformDevice(rawHub);
    hub.name = (rawHub['hub:name'] as string) || 'Arcus Hub';
    hub.type = (rawHub['hub:model'] as string) ?? 'Hub';
    return hub;
  }

  async sendCommand(address: string, attributes: ArcusAttributes): Promise<void> {
    console.debug(`[PlatformClient] Command → ${address}:`, attributes);
    throwIfErrorResponse(await this.sendCommandRequest(address, 'base:SetAttributes', attributes), 'base:SetAttributes');
  }

  async callMethod(address: string, call: ArcusMethodCall): Promise<void> {
    console.debug(`[PlatformClient] ${call.method} → ${address}:`, call.args);
    throwIfErrorResponse(await this.sendCommandRequest(address, call.method, call.args), call.method);
  }

  onDeviceEvent(handler: (address: string, attributes: ArcusAttributes) => void): void {
    this.eventHandlers.push(handler);
  }

  onConnectionChange(handler: (connected: boolean) => void): void {
    this.connectionHandlers.push(handler);
  }

  onDeviceListChange(handler: () => void): void {
    this.deviceListHandlers.push(handler);
  }

  async getAlarmState(): Promise<AlarmState> {
    const resp = await this.bridge.sendRequest(this.subsecurityDestination, 'base:GetAttributes', {});
    const attrs = resp.payload.attributes;
    return {
      securityMode: (attrs['subsecurity:alarmState'] as string) ?? 'DISARMED',
      alarmMode: (attrs['subsecurity:alarmMode'] as string) ?? 'ON',
      bypassedDevices: (attrs[SecuritySubsystem.ATTR_BYPASSEDDEVICES] as string[] | undefined) ?? [],
    };
  }

  async armAlarm(mode: 'ON' | 'PARTIAL'): Promise<void> {
    console.debug(`[PlatformClient] Arming alarm: ${mode}`);
    const resp = await this.sendCommandRequest(this.subalarmDestination, 'subalarm:Arm', { mode });
    if (resp.payload.messageType === 'Error' && resp.payload.attributes.code === 'security.triggeredDevices') {
      // Open sensors block a plain Arm; arm without them. HA is told via the bypassed-sensors entity.
      console.log('[PlatformClient] Devices need bypassing, sending ArmBypassed');
      throwIfErrorResponse(
        await this.sendCommandRequest(this.subalarmDestination, 'subalarm:ArmBypassed', { mode }),
        'subalarm:ArmBypassed',
      );
      return;
    }
    throwIfErrorResponse(resp, 'subalarm:Arm');
  }

  async disarmAlarm(): Promise<void> {
    console.debug('[PlatformClient] Disarming alarm');
    throwIfErrorResponse(
      await this.sendCommandRequest(this.subalarmDestination, 'subalarm:Disarm', {}),
      'subalarm:Disarm',
    );
  }

  onAlarmEvent(handler: (state: AlarmState) => void): void {
    this.alarmHandlers.push(handler);
  }

  async listPersons(): Promise<PersonInfo[]> {
    const resp = await this.bridge.sendRequest(this.bridge.placeDestination, Place.CMD_LISTPERSONS, {});
    const raw = resp.payload.attributes.persons as Record<string, unknown>[] | undefined;
    // Throw rather than return []: an empty list would remove every access switch from HA
    if (!raw || !Array.isArray(raw)) {
      throw new Error(`place:ListPersons returned no person list (${resp.payload.messageType})`);
    }
    return raw.map(p => {
      const id = String(p[Base.ATTR_ID]);
      const name = [p[Person.ATTR_FIRSTNAME], p[Person.ATTR_LASTNAME]]
        .filter((part): part is string => typeof part === 'string' && part.trim() !== '')
        .map(part => part.trim())
        .join(' ');
      const placesWithPin = p[Person.ATTR_PLACESWITHPIN];
      const hasPin = Array.isArray(placesWithPin)
        ? placesWithPin.includes(this.placeId)
        : p[Person.ATTR_HASPIN] === true;
      return { id, name: name || id, hasPin };
    });
  }

  async listScenes(): Promise<SceneInfo[]> {
    const resp = await this.bridge.sendRequest('SERV:scene:', 'scene:ListScenes', {
      placeId: this.placeId,
    });
    const rawScenes = resp.payload.attributes.scenes as Record<string, unknown>[] | undefined;
    // Throw rather than return []: an empty list would remove every scene from HA
    if (!rawScenes || !Array.isArray(rawScenes)) {
      throw new Error(`scene:ListScenes returned no scene list (${resp.payload.messageType})`);
    }
    const scenes = rawScenes
      .filter(s => s['scene:enabled'] === true)
      .map(s => ({
        address: s['base:address'] as string,
        id: s['base:id'] as string,
        name: s['scene:name'] as string,
        enabled: true,
      }));
    console.debug(`[PlatformClient] Listed ${scenes.length} scenes`);
    return scenes;
  }

  onSceneEvent(handler: (sceneAddress: string) => void): void {
    this.sceneHandlers.push(handler);
  }

  async fireScene(address: string): Promise<void> {
    console.debug(`[PlatformClient] Firing scene: ${address}`);
    throwIfErrorResponse(await this.sendCommandRequest(address, 'scene:Fire', {}), 'scene:Fire');
  }
}
