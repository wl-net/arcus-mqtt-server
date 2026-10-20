import type { ArcusDevice, PersonInfo } from './types.js';
import {
  Base, Device, DevicePower, Switch, Dimmer, Thermostat, Temperature,
  RelativeHumidity, Contact, Motion, DoorLock, LeakH2O, Button,
  MotorizedDoor, Smoke, CarbonMonoxide, Glass, Tilt, PowerUse,
  Hub, HubConnection, HubPower, DeviceAdvanced,
  Color, ColorTemperature, Light, Valve, Shade, Vent,
  IrrigationController, IrrigationZone, Presence,
} from './capabilities.js';

const MOCK_PERSON_IDS = {
  owner: '00000000-0000-4000-8000-000000000001',
  walker: '00000000-0000-4000-8000-000000000002',
  noPin: '00000000-0000-4000-8000-000000000003',
};

export function createMockPeople(): PersonInfo[] {
  return [
    { id: MOCK_PERSON_IDS.owner, name: 'Alex Example', hasPin: true },
    { id: MOCK_PERSON_IDS.walker, name: 'Dog Walker', hasPin: true },
    { id: MOCK_PERSON_IDS.noPin, name: 'Sam Nopin', hasPin: false },
  ];
}

export function createMockDevices(): ArcusDevice[] {
  return [
    // --- Switches ---
    {
      address: 'DRIV:dev:switch-001',
      name: 'Living Room Lamp',
      type: 'GE In-Wall Smart Switch',
      caps: new Set([Base.NAMESPACE, Device.NAMESPACE, DevicePower.NAMESPACE, Switch.NAMESPACE]),
      attributes: {
        [Switch.ATTR_STATE]: Switch.STATE_ON,
        [DevicePower.ATTR_SOURCE]: DevicePower.SOURCE_LINE,
        [Device.ATTR_DEVTYPEHINT]: 'Switch',
      },
    },
    {
      address: 'DRIV:dev:switch-002',
      name: 'Garage Outlet',
      type: 'GE Plug-In Smart Switch',
      caps: new Set([Base.NAMESPACE, Device.NAMESPACE, DevicePower.NAMESPACE, Switch.NAMESPACE, PowerUse.NAMESPACE]),
      attributes: {
        [Switch.ATTR_STATE]: Switch.STATE_OFF,
        [PowerUse.ATTR_INSTANTANEOUS]: 0,
        [PowerUse.ATTR_CUMULATIVE]: 12450,
        [DevicePower.ATTR_SOURCE]: DevicePower.SOURCE_LINE,
        [Device.ATTR_DEVTYPEHINT]: 'Switch',
      },
    },

    // --- Dimmer ---
    {
      address: 'DRIV:dev:dimmer-001',
      name: 'Dining Room Light',
      type: 'GE In-Wall Smart Dimmer',
      caps: new Set([Base.NAMESPACE, Device.NAMESPACE, DevicePower.NAMESPACE, Switch.NAMESPACE, Dimmer.NAMESPACE]),
      attributes: {
        [Switch.ATTR_STATE]: Switch.STATE_ON,
        [Dimmer.ATTR_BRIGHTNESS]: 75,
        [DevicePower.ATTR_SOURCE]: DevicePower.SOURCE_LINE,
        [Device.ATTR_DEVTYPEHINT]: 'Dimmer',
      },
    },

    // --- Color bulb ---
    {
      address: 'DRIV:dev:bulb-001',
      name: 'Living Room Bulb',
      type: 'Sengled Color Plus',
      caps: new Set([Base.NAMESPACE, Device.NAMESPACE, DevicePower.NAMESPACE, Switch.NAMESPACE, Dimmer.NAMESPACE, Light.NAMESPACE, Color.NAMESPACE, ColorTemperature.NAMESPACE]),
      attributes: {
        [Switch.ATTR_STATE]: Switch.STATE_ON,
        [Dimmer.ATTR_BRIGHTNESS]: 80,
        [Light.ATTR_COLORMODE]: Light.COLORMODE_COLOR,
        [Color.ATTR_HUE]: 200,
        [Color.ATTR_SATURATION]: 70,
        [ColorTemperature.ATTR_COLORTEMP]: 3000,
        [ColorTemperature.ATTR_MINCOLORTEMP]: 2000,
        [ColorTemperature.ATTR_MAXCOLORTEMP]: 6500,
        [DevicePower.ATTR_SOURCE]: DevicePower.SOURCE_LINE,
        [Device.ATTR_DEVTYPEHINT]: 'Light',
      },
    },

    // --- Thermostat ---
    {
      address: 'DRIV:dev:therm-001',
      name: 'Hallway Thermostat',
      type: 'Honeywell T6 Pro',
      caps: new Set([Base.NAMESPACE, Device.NAMESPACE, DevicePower.NAMESPACE, Thermostat.NAMESPACE, Temperature.NAMESPACE, RelativeHumidity.NAMESPACE]),
      attributes: {
        [Thermostat.ATTR_HVACMODE]: 'HEAT',
        [Thermostat.ATTR_HEATSETPOINT]: 21.0,
        [Thermostat.ATTR_COOLSETPOINT]: 25.0,
        [Thermostat.ATTR_ACTIVE]: Thermostat.ACTIVE_RUNNING,
        [Thermostat.ATTR_SUPPORTEDMODES]: ['OFF', 'HEAT', 'COOL', 'AUTO', 'ECO'],
        [Thermostat.ATTR_FANMODE]: 0,
        [Thermostat.ATTR_EMERGENCYHEAT]: Thermostat.EMERGENCYHEAT_OFF,
        [Thermostat.ATTR_MAXFANSPEED]: 1,
        [Temperature.ATTR_TEMPERATURE]: 20.5,
        [RelativeHumidity.ATTR_HUMIDITY]: 42,
        [DevicePower.ATTR_SOURCE]: DevicePower.SOURCE_LINE,
        [DevicePower.ATTR_BATTERY]: 100,
        [Device.ATTR_DEVTYPEHINT]: 'Thermostat',
      },
    },

    // --- Contact Sensors ---
    {
      address: 'DRIV:dev:contact-001',
      name: 'Front Door',
      type: 'Iris Contact Sensor',
      caps: new Set([Base.NAMESPACE, Device.NAMESPACE, DevicePower.NAMESPACE, Contact.NAMESPACE, Temperature.NAMESPACE]),
      attributes: {
        [Device.ATTR_VENDOR]: 'Iris',
        [Device.ATTR_MODEL]: '3320-L',
        [DeviceAdvanced.ATTR_PROTOCOL]: 'ZIGB',
        [Contact.ATTR_CONTACT]: Contact.CONTACT_CLOSED,
        [Contact.ATTR_USEHINT]: Contact.USEHINT_DOOR,
        [Temperature.ATTR_TEMPERATURE]: 22.1,
        [DevicePower.ATTR_SOURCE]: DevicePower.SOURCE_BATTERY,
        [DevicePower.ATTR_BATTERY]: 87,
        [Device.ATTR_DEVTYPEHINT]: 'Contact',
      },
    },
    {
      address: 'DRIV:dev:contact-002',
      name: 'Back Door',
      type: 'Iris Contact Sensor',
      caps: new Set([Base.NAMESPACE, Device.NAMESPACE, DevicePower.NAMESPACE, Contact.NAMESPACE, Temperature.NAMESPACE]),
      attributes: {
        [Contact.ATTR_CONTACT]: Contact.CONTACT_CLOSED,
        [Contact.ATTR_USEHINT]: Contact.USEHINT_DOOR,
        [Temperature.ATTR_TEMPERATURE]: 18.3,
        [DevicePower.ATTR_SOURCE]: DevicePower.SOURCE_BATTERY,
        [DevicePower.ATTR_BATTERY]: 62,
        [Device.ATTR_DEVTYPEHINT]: 'Contact',
      },
    },
    {
      address: 'DRIV:dev:contact-003',
      name: 'Kitchen Window',
      type: 'Iris Contact Sensor',
      caps: new Set([Base.NAMESPACE, Device.NAMESPACE, DevicePower.NAMESPACE, Contact.NAMESPACE, Temperature.NAMESPACE]),
      attributes: {
        [Contact.ATTR_CONTACT]: Contact.CONTACT_OPENED,
        [Contact.ATTR_USEHINT]: Contact.USEHINT_WINDOW,
        [Temperature.ATTR_TEMPERATURE]: 23.0,
        [DevicePower.ATTR_SOURCE]: DevicePower.SOURCE_BATTERY,
        [DevicePower.ATTR_BATTERY]: 45,
        [Device.ATTR_DEVTYPEHINT]: 'Contact',
      },
    },

    // --- Motion Sensors ---
    {
      address: 'DRIV:dev:motion-001',
      name: 'Hallway Motion',
      type: 'Iris Motion Sensor',
      caps: new Set([Base.NAMESPACE, Device.NAMESPACE, DevicePower.NAMESPACE, Motion.NAMESPACE, Temperature.NAMESPACE]),
      attributes: {
        [Motion.ATTR_MOTION]: Motion.MOTION_NONE,
        [Temperature.ATTR_TEMPERATURE]: 21.8,
        [DevicePower.ATTR_SOURCE]: DevicePower.SOURCE_BATTERY,
        [DevicePower.ATTR_BATTERY]: 91,
        [Device.ATTR_DEVTYPEHINT]: 'Motion',
      },
    },
    {
      address: 'DRIV:dev:motion-002',
      name: 'Basement Motion',
      type: 'Iris Motion Sensor',
      caps: new Set([Base.NAMESPACE, Device.NAMESPACE, DevicePower.NAMESPACE, Motion.NAMESPACE, Temperature.NAMESPACE]),
      attributes: {
        [Motion.ATTR_MOTION]: Motion.MOTION_DETECTED,
        [Temperature.ATTR_TEMPERATURE]: 17.2,
        [DevicePower.ATTR_SOURCE]: DevicePower.SOURCE_BATTERY,
        [DevicePower.ATTR_BATTERY]: 53,
        [Device.ATTR_DEVTYPEHINT]: 'Motion',
      },
    },

    // --- Door Lock ---
    {
      address: 'DRIV:dev:lock-001',
      name: 'Front Door Lock',
      type: 'Schlage BE469',
      caps: new Set([Base.NAMESPACE, Device.NAMESPACE, DevicePower.NAMESPACE, DoorLock.NAMESPACE]),
      attributes: {
        [DoorLock.ATTR_LOCKSTATE]: DoorLock.LOCKSTATE_LOCKED,
        [DoorLock.ATTR_SUPPORTSBUZZIN]: true,
        [DoorLock.ATTR_SLOTS]: { '1': MOCK_PERSON_IDS.owner },
        [DevicePower.ATTR_SOURCE]: DevicePower.SOURCE_BATTERY,
        [DevicePower.ATTR_BATTERY]: 78,
        [Device.ATTR_DEVTYPEHINT]: 'Lock',
      },
    },

    // --- Garage Door Opener ---
    {
      address: 'DRIV:dev:garage-001',
      name: 'Garage Door',
      type: 'Nortek GoControl Garage Door Controller',
      caps: new Set([Base.NAMESPACE, Device.NAMESPACE, DevicePower.NAMESPACE, MotorizedDoor.NAMESPACE]),
      attributes: {
        [MotorizedDoor.ATTR_DOORSTATE]: MotorizedDoor.DOORSTATE_CLOSED,
        [DevicePower.ATTR_SOURCE]: DevicePower.SOURCE_LINE,
        [Device.ATTR_DEVTYPEHINT]: 'Garage Door',
      },
    },

    // --- Leak Sensor ---
    {
      address: 'DRIV:dev:leak-001',
      name: 'Laundry Room Water Sensor',
      type: 'Iris Water Leak Sensor',
      caps: new Set([Base.NAMESPACE, Device.NAMESPACE, DevicePower.NAMESPACE, LeakH2O.NAMESPACE, Temperature.NAMESPACE]),
      attributes: {
        [LeakH2O.ATTR_STATE]: LeakH2O.STATE_SAFE,
        [Temperature.ATTR_TEMPERATURE]: 20.0,
        [DevicePower.ATTR_SOURCE]: DevicePower.SOURCE_BATTERY,
        [DevicePower.ATTR_BATTERY]: 95,
        [Device.ATTR_DEVTYPEHINT]: 'Water Leak',
      },
    },

    // --- Smoke / CO Detector ---
    {
      address: 'DRIV:dev:smokeco-001',
      name: 'Hallway Smoke Detector',
      type: 'First Alert ZCOMBO',
      caps: new Set([Base.NAMESPACE, Device.NAMESPACE, DevicePower.NAMESPACE, Smoke.NAMESPACE, CarbonMonoxide.NAMESPACE]),
      attributes: {
        [Smoke.ATTR_SMOKE]: Smoke.SMOKE_SAFE,
        [CarbonMonoxide.ATTR_CO]: CarbonMonoxide.CO_SAFE,
        [DevicePower.ATTR_SOURCE]: DevicePower.SOURCE_BATTERY,
        [DevicePower.ATTR_BATTERY]: 90,
        [Device.ATTR_DEVTYPEHINT]: 'Smoke/CO',
      },
    },

    // --- Water Shutoff Valve ---
    {
      address: 'DRIV:dev:valve-001',
      name: 'Main Water Shutoff',
      type: 'Dome Water Main Shut-Off',
      caps: new Set([Base.NAMESPACE, Device.NAMESPACE, DevicePower.NAMESPACE, Valve.NAMESPACE]),
      attributes: {
        [Valve.ATTR_VALVESTATE]: Valve.VALVESTATE_OPEN,
        [DevicePower.ATTR_SOURCE]: DevicePower.SOURCE_LINE,
        [Device.ATTR_DEVTYPEHINT]: 'Water Valve',
      },
    },

    // --- Shade ---
    {
      address: 'DRIV:dev:shade-001',
      name: 'Bedroom Shade',
      type: 'Somfy Shade',
      caps: new Set([Base.NAMESPACE, Device.NAMESPACE, DevicePower.NAMESPACE, Shade.NAMESPACE]),
      attributes: {
        [Shade.ATTR_LEVEL]: 60,
        [Shade.ATTR_SHADESTATE]: Shade.SHADESTATE_OK,
        [DevicePower.ATTR_SOURCE]: DevicePower.SOURCE_BATTERY,
        [DevicePower.ATTR_BATTERY]: 75,
        [Device.ATTR_DEVTYPEHINT]: 'Shade',
      },
    },

    // --- Smart Vent ---
    {
      address: 'DRIV:dev:vent-001',
      name: 'Bedroom Vent',
      type: 'Smart Vent',
      caps: new Set([Base.NAMESPACE, Device.NAMESPACE, DevicePower.NAMESPACE, Temperature.NAMESPACE, Vent.NAMESPACE]),
      attributes: {
        [Vent.ATTR_LEVEL]: 50,
        [Vent.ATTR_VENTSTATE]: Vent.VENTSTATE_OK,
        [Vent.ATTR_AIRPRESSURE]: 101.2,
        [Temperature.ATTR_TEMPERATURE]: 22.0,
        [DevicePower.ATTR_SOURCE]: DevicePower.SOURCE_BATTERY,
        [DevicePower.ATTR_BATTERY]: 90,
        [Device.ATTR_DEVTYPEHINT]: 'vent',
      },
    },

    // --- Irrigation Controller (two zones) ---
    {
      address: 'DRIV:dev:irrigation-001',
      name: 'Garden Timer',
      type: 'Irrigation Timer',
      caps: new Set([
        Base.NAMESPACE, Device.NAMESPACE, DevicePower.NAMESPACE,
        IrrigationController.NAMESPACE, IrrigationZone.NAMESPACE,
      ]),
      attributes: {
        [IrrigationController.ATTR_NUMZONES]: 2,
        [IrrigationController.ATTR_CONTROLLERSTATE]: IrrigationController.CONTROLLERSTATE_NOT_WATERING,
        [IrrigationController.ATTR_MINIRRIGATIONTIME]: 1,
        [IrrigationController.ATTR_MAXIRRIGATIONTIME]: 240,
        [`${IrrigationZone.ATTR_ZONENUM}:z1`]: 1,
        [`${IrrigationZone.ATTR_ZONENAME}:z1`]: 'Front Beds',
        [`${IrrigationZone.ATTR_ZONESTATE}:z1`]: IrrigationZone.ZONESTATE_NOT_WATERING,
        [`${IrrigationZone.ATTR_DEFAULTDURATION}:z1`]: 10,
        [`${IrrigationZone.ATTR_ZONENUM}:z2`]: 2,
        [`${IrrigationZone.ATTR_ZONENAME}:z2`]: 'Vegetables',
        [`${IrrigationZone.ATTR_ZONESTATE}:z2`]: IrrigationZone.ZONESTATE_NOT_WATERING,
        [`${IrrigationZone.ATTR_DEFAULTDURATION}:z2`]: 15,
        [DevicePower.ATTR_SOURCE]: DevicePower.SOURCE_BATTERY,
        [DevicePower.ATTR_BATTERY]: 80,
        [Device.ATTR_DEVTYPEHINT]: 'Irrigation',
      },
    },

    // --- Glass Break Sensor ---
    {
      address: 'DRIV:dev:glass-001',
      name: 'Living Room Glass Break',
      type: 'Iris Glass Break Sensor',
      caps: new Set([Base.NAMESPACE, Device.NAMESPACE, DevicePower.NAMESPACE, Glass.NAMESPACE]),
      attributes: {
        [Glass.ATTR_BREAK]: Glass.BREAK_SAFE,
        [DevicePower.ATTR_SOURCE]: DevicePower.SOURCE_BATTERY,
        [DevicePower.ATTR_BATTERY]: 85,
        [Device.ATTR_DEVTYPEHINT]: 'Glass Break',
      },
    },

    // --- Tilt Sensor ---
    {
      address: 'DRIV:dev:tilt-001',
      name: 'Shed Door Tilt',
      type: 'Iris Garage Door Tilt Sensor',
      caps: new Set([Base.NAMESPACE, Device.NAMESPACE, DevicePower.NAMESPACE, Tilt.NAMESPACE]),
      attributes: {
        [Tilt.ATTR_TILTSTATE]: Tilt.TILTSTATE_UPRIGHT,
        [DevicePower.ATTR_SOURCE]: DevicePower.SOURCE_BATTERY,
        [DevicePower.ATTR_BATTERY]: 70,
        [Device.ATTR_DEVTYPEHINT]: 'Tilt',
      },
    },

    // --- Button (single button) ---
    {
      address: 'DRIV:dev:button-001',
      name: 'Smart Button',
      type: 'Button',
      caps: new Set([Base.NAMESPACE, Device.NAMESPACE, DevicePower.NAMESPACE, Button.NAMESPACE]),
      attributes: {
        [Button.ATTR_STATE]: Button.STATE_RELEASED,
        [DevicePower.ATTR_SOURCE]: DevicePower.SOURCE_BATTERY,
        [DevicePower.ATTR_BATTERY]: 80,
        [Device.ATTR_DEVTYPEHINT]: 'Button',
      },
    },

    // --- Key fob (four buttons as Button instances, plus presence) ---
    {
      address: 'DRIV:dev:keyfob-001',
      name: 'Key Fob',
      type: 'Keyfob',
      caps: new Set([Base.NAMESPACE, Device.NAMESPACE, DevicePower.NAMESPACE, Presence.NAMESPACE]),
      instances: {
        home: [Button.NAMESPACE],
        away: [Button.NAMESPACE],
        a: [Button.NAMESPACE],
        b: [Button.NAMESPACE],
      },
      attributes: {
        [`${Button.ATTR_STATE}:home`]: Button.STATE_RELEASED,
        [`${Button.ATTR_STATE}:away`]: Button.STATE_RELEASED,
        [`${Button.ATTR_STATE}:a`]: Button.STATE_RELEASED,
        [`${Button.ATTR_STATE}:b`]: Button.STATE_RELEASED,
        [Presence.ATTR_PRESENCE]: Presence.PRESENCE_PRESENT,
        [DevicePower.ATTR_SOURCE]: DevicePower.SOURCE_BATTERY,
        [DevicePower.ATTR_BATTERY]: 65,
        [Device.ATTR_DEVTYPEHINT]: 'Keyfob',
      },
    },
  ];
}

export function createMockHub(): ArcusDevice {
  return {
    address: 'SERV:hub:LWW-1234',
    name: 'Arcus Hub',
    type: 'IH200',
    caps: new Set([Base.NAMESPACE, Hub.NAMESPACE, HubConnection.NAMESPACE, HubPower.NAMESPACE]),
    attributes: {
      [Hub.ATTR_VENDOR]: 'Iris',
      [Hub.ATTR_MODEL]: 'IH200',
      [Hub.ATTR_STATE]: Hub.STATE_NORMAL,
      [HubConnection.ATTR_STATE]: HubConnection.STATE_ONLINE,
      [HubPower.ATTR_SOURCE]: HubPower.SOURCE_MAINS,
      [HubPower.ATTR_BATTERY]: 100,
    },
  };
}
