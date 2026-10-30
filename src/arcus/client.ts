import type { ArcusDevice, ArcusAttributes, ArcusMethodCall, AlarmState, PersonInfo, SceneInfo } from './types.js';
import { DoorLock, IrrigationController, IrrigationZone } from './capabilities.js';
import { createMockDevices, createMockHub, createMockPeople } from './mock-data.js';

export interface ArcusClient {
  /** Fetch all devices and their current state */
  listDevices(): Promise<ArcusDevice[]>;

  /** Fetch the place's hub, or null if the place has none */
  getHub(): Promise<ArcusDevice | null>;

  /** Send a command (set attributes) to a device */
  sendCommand(address: string, attributes: ArcusAttributes): Promise<void>;

  /** Call a capability method on a device, for commands that aren't attribute changes */
  callMethod(address: string, call: ArcusMethodCall): Promise<void>;

  /** Start listening for real-time device events */
  connect(): Promise<void>;

  /** Close the connection for good, e.g. on shutdown */
  disconnect(): void;

  /** Register a callback for the upstream connection dropping (false) or being restored (true) */
  onConnectionChange(handler: (connected: boolean) => void): void;

  /** Register a callback for device attribute changes */
  onDeviceEvent(handler: (address: string, attributes: ArcusAttributes) => void): void;

  /** Register a callback for a device being added to or removed from the place */
  onDeviceListChange(handler: () => void): void;

  /** Get the current alarm subsystem state */
  getAlarmState(): Promise<AlarmState>;

  /** Arm the alarm (ON = full / away, PARTIAL = perimeter / home) */
  armAlarm(mode: 'ON' | 'PARTIAL'): Promise<void>;

  /** Disarm the alarm */
  disarmAlarm(): Promise<void>;

  /** Register a callback for alarm state changes */
  onAlarmEvent(handler: (state: AlarmState) => void): void;

  /** List the people at the place */
  listPersons(): Promise<PersonInfo[]>;

  /** List all scenes */
  listScenes(): Promise<SceneInfo[]>;

  /** Register a callback for when a scene fires */
  onSceneEvent(handler: (sceneAddress: string) => void): void;

  /** Fire a scene */
  fireScene(address: string): Promise<void>;
}

export class MockArcusClient implements ArcusClient {
  private devices: ArcusDevice[];
  private hub: ArcusDevice;
  private eventHandlers: Array<(address: string, attributes: ArcusAttributes) => void> = [];
  private alarmHandlers: Array<(state: AlarmState) => void> = [];
  private mockAlarm: AlarmState = {
    securityMode: 'DISARMED',
    alarmMode: 'ON',
    bypassedDevices: [],
  };

  /** A named place gets its own device, hub and scene addresses (ARCUS_MOCK_PLACE) */
  constructor(private readonly place?: string) {
    this.devices = createMockDevices(place);
    this.hub = createMockHub(place);
  }

  async connect(): Promise<void> {
    console.log('[MockArcusClient] Connected (mock mode)');
  }

  disconnect(): void {
    // No-op in mock mode: there's no connection to close
  }

  async listDevices(): Promise<ArcusDevice[]> {
    return this.devices;
  }

  async getHub(): Promise<ArcusDevice | null> {
    return this.hub;
  }

  async sendCommand(address: string, attributes: ArcusAttributes): Promise<void> {
    const device = this.devices.find(d => d.address === address);
    if (!device) {
      console.warn(`[MockArcusClient] Device not found: ${address}`);
      return;
    }
    // Apply the attributes to the mock device
    Object.assign(device.attributes, attributes);
    console.log(`[MockArcusClient] Command → ${address}:`, attributes);

    // Notify event handlers of the change
    for (const handler of this.eventHandlers) {
      handler(address, attributes);
    }
  }

  async callMethod(address: string, call: ArcusMethodCall): Promise<void> {
    console.log(`[MockArcusClient] ${call.method} → ${address}:`, call.args);
    // Like the irrigation drivers: watering starts or stops right away
    const zone = String(call.args.zone);
    if (call.method === IrrigationController.CMD_WATERNOWV2) {
      await this.sendCommand(address, {
        [`${IrrigationZone.ATTR_ZONESTATE}:${zone}`]: IrrigationZone.ZONESTATE_WATERING,
        [`${IrrigationZone.ATTR_WATERINGDURATION}:${zone}`]: Number(call.args.duration),
        [IrrigationController.ATTR_CONTROLLERSTATE]: IrrigationController.CONTROLLERSTATE_WATERING,
      });
    } else if (call.method === IrrigationController.CMD_CANCELV2) {
      await this.sendCommand(address, {
        [`${IrrigationZone.ATTR_ZONESTATE}:${zone}`]: IrrigationZone.ZONESTATE_NOT_WATERING,
        [`${IrrigationZone.ATTR_WATERINGDURATION}:${zone}`]: 0,
        [IrrigationController.ATTR_CONTROLLERSTATE]: IrrigationController.CONTROLLERSTATE_NOT_WATERING,
      });
    } else if (call.method === DoorLock.CMD_BUZZIN) {
      // Like the lock drivers: unlock if locked, then lock again shortly after
      const device = this.devices.find(d => d.address === address);
      if (device?.attributes[DoorLock.ATTR_LOCKSTATE] !== DoorLock.LOCKSTATE_LOCKED) return;
      await this.sendCommand(address, { [DoorLock.ATTR_LOCKSTATE]: DoorLock.LOCKSTATE_UNLOCKED });
      setTimeout(() => {
        void this.sendCommand(address, { [DoorLock.ATTR_LOCKSTATE]: DoorLock.LOCKSTATE_LOCKED });
      }, 30_000).unref();
    } else if (call.method === DoorLock.CMD_AUTHORIZEPERSON || call.method === DoorLock.CMD_DEAUTHORIZEPERSON) {
      // Like the lock drivers: doorlock:slots maps slot number → person ID
      const device = this.devices.find(d => d.address === address);
      const current = device?.attributes[DoorLock.ATTR_SLOTS];
      const slots: Record<string, string> =
        typeof current === 'object' && !Array.isArray(current) ? { ...current } : {};
      const personId = String(call.args.personId);
      for (const [slot, id] of Object.entries(slots)) {
        if (id === personId) delete slots[slot];
      }
      if (call.method === DoorLock.CMD_AUTHORIZEPERSON) {
        let slot = 1;
        while (slots[String(slot)]) slot++;
        slots[String(slot)] = personId;
      }
      await this.sendCommand(address, { [DoorLock.ATTR_SLOTS]: slots });
    }
  }

  onDeviceEvent(handler: (address: string, attributes: ArcusAttributes) => void): void {
    this.eventHandlers.push(handler);
  }

  onConnectionChange(_handler: (connected: boolean) => void): void {
    // No-op in mock mode: the mock connection never drops
  }

  onDeviceListChange(_handler: () => void): void {
    // No-op in mock mode: the mock devices never change
  }

  async getAlarmState(): Promise<AlarmState> {
    return { ...this.mockAlarm, bypassedDevices: [...this.mockAlarm.bypassedDevices] };
  }

  async armAlarm(mode: 'ON' | 'PARTIAL'): Promise<void> {
    this.mockAlarm.securityMode = 'ARMED';
    this.mockAlarm.alarmMode = mode;
    // Like the platform, arm around any open contact sensors
    this.mockAlarm.bypassedDevices = this.devices
      .filter(d => d.attributes['cont:contact'] === 'OPENED')
      .map(d => d.address);
    console.log(`[MockArcusClient] Alarm armed (${mode})`);
    for (const handler of this.alarmHandlers) {
      handler({ ...this.mockAlarm, bypassedDevices: [...this.mockAlarm.bypassedDevices] });
    }
  }

  async disarmAlarm(): Promise<void> {
    this.mockAlarm.securityMode = 'DISARMED';
    this.mockAlarm.bypassedDevices = [];
    console.log('[MockArcusClient] Alarm disarmed');
    for (const handler of this.alarmHandlers) {
      handler({ ...this.mockAlarm, bypassedDevices: [...this.mockAlarm.bypassedDevices] });
    }
  }

  onAlarmEvent(handler: (state: AlarmState) => void): void {
    this.alarmHandlers.push(handler);
  }

  async listPersons(): Promise<PersonInfo[]> {
    return createMockPeople();
  }

  async listScenes(): Promise<SceneInfo[]> {
    return [
      { address: `SERV:scene:${this.place ?? 'mock'}.1`, id: `${this.place ?? 'mock'}.1`, name: 'Mock Scene', enabled: true },
    ];
  }

  onSceneEvent(_handler: (sceneAddress: string) => void): void {
    // No-op in mock mode
  }

  async fireScene(address: string): Promise<void> {
    console.log(`[MockArcusClient] Scene fired: ${address}`);
  }
}
