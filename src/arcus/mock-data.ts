import type { ArcusDevice } from './types.js';
import {
  Base, Device, DevicePower, Switch, Dimmer, Thermostat, Temperature,
  RelativeHumidity, Contact, Motion, DoorLock, LeakH2O, Camera, Button,
} from './capabilities.js';

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
      caps: new Set([Base.NAMESPACE, Device.NAMESPACE, DevicePower.NAMESPACE, Switch.NAMESPACE]),
      attributes: {
        [Switch.ATTR_STATE]: Switch.STATE_OFF,
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
        [Thermostat.ATTR_ACTIVE]: 'HEATING',
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
        [DoorLock.ATTR_SLOTS]: '{}',
        [DevicePower.ATTR_SOURCE]: DevicePower.SOURCE_BATTERY,
        [DevicePower.ATTR_BATTERY]: 78,
        [Device.ATTR_DEVTYPEHINT]: 'Lock',
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

    // --- Camera ---
    {
      address: 'DRIV:dev:camera-001',
      name: 'Front Porch Camera',
      type: 'Sercomm Indoor Camera',
      caps: new Set([Base.NAMESPACE, Device.NAMESPACE, DevicePower.NAMESPACE, Camera.NAMESPACE]),
      attributes: {
        [DevicePower.ATTR_SOURCE]: DevicePower.SOURCE_LINE,
        [Device.ATTR_DEVTYPEHINT]: 'Camera',
      },
    },

    // --- Button (key fob) ---
    {
      address: 'DRIV:dev:button-001',
      name: 'Iris Key Fob',
      type: 'Iris Smart Fob',
      caps: new Set([Base.NAMESPACE, Device.NAMESPACE, DevicePower.NAMESPACE, Button.NAMESPACE]),
      attributes: {
        [DevicePower.ATTR_SOURCE]: DevicePower.SOURCE_BATTERY,
        [DevicePower.ATTR_BATTERY]: 80,
        [Device.ATTR_DEVTYPEHINT]: 'Button',
      },
    },
  ];
}
