/**
 * One entry of devsettings:params: a setting the device's driver offers, such as a Z-Wave
 * configuration parameter. Only paramId and type are checked when it arrives; the device
 * settings mapper checks the rest (description, value, min, max, values) before using it.
 */
export interface DeviceSetting {
  /** What devsettings:SetParam takes, e.g. "ledMode" */
  paramId: string;
  /** "range" (a number between min and max) or "enum" (one of values) */
  type: string;
  [field: string]: unknown;
}

/**
 * A single Arcus attribute value; lists are kept only when they hold strings (e.g. therm:supportedmodes)
 * or device settings (devsettings:params), and maps only when their values are strings (e.g. devadv:errors)
 */
export type ArcusAttributeValue = string | number | boolean | string[] | DeviceSetting[] | Record<string, string>;

/** A key-value map of Arcus capability attributes, e.g. { "swit:state": "ON" } */
export type ArcusAttributes = Record<string, ArcusAttributeValue>;

function isDeviceSetting(value: unknown): value is DeviceSetting {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const { paramId, type } = value as Record<string, unknown>;
  return typeof paramId === 'string' && typeof type === 'string';
}

/** Narrow a raw platform value to a supported attribute value */
export function isAttributeValue(value: unknown): value is ArcusAttributeValue {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return true;
  if (Array.isArray(value)) return value.every(v => typeof v === 'string') || value.every(isDeviceSetting);
  return typeof value === 'object' && value !== null && Object.values(value).every(v => typeof v === 'string');
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
  /**
   * Capabilities the device has several of, by instance name (base:instances), e.g.
   * { button1: ['but'], button2: ['but'] } on a remote. Their attributes carry the
   * instance name: but:state:button1
   */
  instances?: Record<string, ArcusCapability[]>;
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

/** A person at the place, for adding their PIN to locks */
export interface PersonInfo {
  /** Person ID, as doorlock:slots and doorlock:AuthorizePerson use it */
  id: string;
  name: string;
  /** Has a PIN at this place; only then can it be added to a lock */
  hasPin: boolean;
}

export interface SceneInfo {
  address: string;    // e.g. "SERV:scene:{placeId}.1"
  id: string;         // e.g. "{placeId}.1"
  name: string;
  enabled: boolean;
}
