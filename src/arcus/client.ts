import type { ArcusDevice, ArcusAttributes, AlarmState, SceneInfo } from './types.js';
import { createMockDevices } from './mock-data.js';

export interface ArcusClient {
  /** Fetch all devices and their current state */
  listDevices(): Promise<ArcusDevice[]>;

  /** Send a command (set attributes) to a device */
  sendCommand(address: string, attributes: ArcusAttributes): Promise<void>;

  /** Start listening for real-time device events */
  connect(): Promise<void>;

  /** Register a callback for device attribute changes */
  onDeviceEvent(handler: (address: string, attributes: ArcusAttributes) => void): void;

  /** Get the current alarm subsystem state */
  getAlarmState(): Promise<AlarmState>;

  /** Arm the alarm (ON = full / away, PARTIAL = perimeter / home) */
  armAlarm(mode: 'ON' | 'PARTIAL'): Promise<void>;

  /** Disarm the alarm */
  disarmAlarm(): Promise<void>;

  /** Register a callback for alarm state changes */
  onAlarmEvent(handler: (state: AlarmState) => void): void;

  /** List all scenes */
  listScenes(): Promise<SceneInfo[]>;

  /** Register a callback for when a scene fires */
  onSceneEvent(handler: (sceneAddress: string) => void): void;

  /** Fire a scene */
  fireScene(address: string): Promise<void>;
}

export class MockArcusClient implements ArcusClient {
  private devices: ArcusDevice[];
  private eventHandlers: Array<(address: string, attributes: ArcusAttributes) => void> = [];
  private alarmHandlers: Array<(state: AlarmState) => void> = [];
  private mockAlarm: AlarmState = {
    securityMode: 'DISARMED',
    alarmMode: 'ON',
  };

  constructor() {
    this.devices = createMockDevices();
  }

  async connect(): Promise<void> {
    console.log('[MockArcusClient] Connected (mock mode)');
  }

  async listDevices(): Promise<ArcusDevice[]> {
    return this.devices;
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

  onDeviceEvent(handler: (address: string, attributes: ArcusAttributes) => void): void {
    this.eventHandlers.push(handler);
  }

  async getAlarmState(): Promise<AlarmState> {
    return { ...this.mockAlarm };
  }

  async armAlarm(mode: 'ON' | 'PARTIAL'): Promise<void> {
    this.mockAlarm.securityMode = 'ARMED';
    this.mockAlarm.alarmMode = mode;
    console.log(`[MockArcusClient] Alarm armed (${mode})`);
    for (const handler of this.alarmHandlers) {
      handler({ ...this.mockAlarm });
    }
  }

  async disarmAlarm(): Promise<void> {
    this.mockAlarm.securityMode = 'DISARMED';
    console.log('[MockArcusClient] Alarm disarmed');
    for (const handler of this.alarmHandlers) {
      handler({ ...this.mockAlarm });
    }
  }

  onAlarmEvent(handler: (state: AlarmState) => void): void {
    this.alarmHandlers.push(handler);
  }

  async listScenes(): Promise<SceneInfo[]> {
    return [
      { address: 'SERV:scene:mock.1', id: 'mock.1', name: 'Mock Scene', enabled: true },
    ];
  }

  onSceneEvent(_handler: (sceneAddress: string) => void): void {
    // No-op in mock mode
  }

  async fireScene(address: string): Promise<void> {
    console.log(`[MockArcusClient] Scene fired: ${address}`);
  }
}
