/** A single Arcus attribute value; lists are kept only when they hold strings (e.g. therm:supportedmodes) */
export type ArcusAttributeValue = string | number | boolean | string[];

/** A key-value map of Arcus capability attributes, e.g. { "swit:state": "ON" } */
export type ArcusAttributes = Record<string, ArcusAttributeValue>;

/** Narrow a raw platform value to a supported attribute value */
export function isAttributeValue(value: unknown): value is ArcusAttributeValue {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return true;
  return Array.isArray(value) && value.every(v => typeof v === 'string');
}

/** A capability method call on a device, e.g. irrcont:WaterNowV2 with { zone: 'z1', duration: 10 } */
export interface ArcusMethodCall {
  method: string;
  args: Record<string, string | number>;
}

/** Capabilities are identified by their namespace prefix (e.g. "swit", "dim", "therm") */
export type ArcusCapability = string;

export interface ArcusDevice {
  /** Platform address, e.g. "DRIV:dev:abc-123" */
  address: string;
  /** Human-readable name */
  name: string;
  /** Device type / product name */
  type: string;
  /** Set of capability namespaces this device supports */
  caps: Set<ArcusCapability>;
  /** Current attribute values across all capabilities */
  attributes: ArcusAttributes;
  /** Address of the hub this device pairs through (Zigbee/Z-Wave), if any */
  hubAddress?: string;
}

export interface ArcusDeviceEvent {
  address: string;
  attributes: ArcusAttributes;
}

export interface AlarmState {
  securityMode: string;   // DISARMED, ARMING, ARMED, SOAKING, ALERT, CLEARING
  alarmMode: string;      // ON = full/away, PARTIAL = home
  bypassedDevices: string[]; // addresses of sensors excluded from the current arming
}

export interface SceneInfo {
  address: string;    // e.g. "SERV:scene:{placeId}.1"
  id: string;         // e.g. "{placeId}.1"
  name: string;
  enabled: boolean;
}
