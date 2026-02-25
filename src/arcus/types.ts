/** A key-value map of Arcus capability attributes, e.g. { "swit:state": "ON" } */
export type ArcusAttributes = Record<string, string | number | boolean>;

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
}

export interface ArcusDeviceEvent {
  address: string;
  attributes: ArcusAttributes;
}

export interface AlarmState {
  securityMode: string;   // DISARMED, ARMING, ARMED, SOAKING, ALERT, CLEARING
  alarmMode: string;      // ON = full/away, PARTIAL = home
}

export interface SceneInfo {
  address: string;    // e.g. "SERV:scene:{placeId}.1"
  id: string;         // e.g. "{placeId}.1"
  name: string;
  enabled: boolean;
}
