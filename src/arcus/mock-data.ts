import type { ArcusDevice } from './types.js';

export function createMockDevices(): ArcusDevice[] {
  return [
    // --- Switches ---
    {
      address: 'DRIV:dev:switch-001',
      name: 'Living Room Lamp',
      type: 'GE In-Wall Smart Switch',
      caps: new Set(['base', 'dev', 'devpow', 'swit']),
      attributes: {
        'swit:state': 'ON',
        'devpow:source': 'LINE',
        'dev:devtypehint': 'Switch',
      },
    },
    {
      address: 'DRIV:dev:switch-002',
      name: 'Garage Outlet',
      type: 'GE Plug-In Smart Switch',
      caps: new Set(['base', 'dev', 'devpow', 'swit']),
      attributes: {
        'swit:state': 'OFF',
        'devpow:source': 'LINE',
        'dev:devtypehint': 'Switch',
      },
    },

    // --- Dimmer ---
    {
      address: 'DRIV:dev:dimmer-001',
      name: 'Dining Room Light',
      type: 'GE In-Wall Smart Dimmer',
      caps: new Set(['base', 'dev', 'devpow', 'swit', 'dim']),
      attributes: {
        'swit:state': 'ON',
        'dim:brightness': 75,
        'devpow:source': 'LINE',
        'dev:devtypehint': 'Dimmer',
      },
    },

    // --- Thermostat ---
    {
      address: 'DRIV:dev:therm-001',
      name: 'Hallway Thermostat',
      type: 'Honeywell T6 Pro',
      caps: new Set(['base', 'dev', 'devpow', 'therm', 'temp', 'humid']),
      attributes: {
        'therm:hvacmode': 'HEAT',
        'therm:heatsetpoint': 21.0,
        'therm:coolsetpoint': 25.0,
        'therm:active': 'HEATING',
        'temp:temperature': 20.5,
        'humid:humidity': 42,
        'devpow:source': 'LINE',
        'devpow:battery': 100,
        'dev:devtypehint': 'Thermostat',
      },
    },

    // --- Contact Sensors ---
    {
      address: 'DRIV:dev:contact-001',
      name: 'Front Door',
      type: 'Iris Contact Sensor',
      caps: new Set(['base', 'dev', 'devpow', 'cont', 'temp']),
      attributes: {
        'cont:contact': 'CLOSED',
        'cont:usehint': 'DOOR',
        'temp:temperature': 22.1,
        'devpow:source': 'BATTERY',
        'devpow:battery': 87,
        'dev:devtypehint': 'Contact',
      },
    },
    {
      address: 'DRIV:dev:contact-002',
      name: 'Back Door',
      type: 'Iris Contact Sensor',
      caps: new Set(['base', 'dev', 'devpow', 'cont', 'temp']),
      attributes: {
        'cont:contact': 'CLOSED',
        'cont:usehint': 'DOOR',
        'temp:temperature': 18.3,
        'devpow:source': 'BATTERY',
        'devpow:battery': 62,
        'dev:devtypehint': 'Contact',
      },
    },
    {
      address: 'DRIV:dev:contact-003',
      name: 'Kitchen Window',
      type: 'Iris Contact Sensor',
      caps: new Set(['base', 'dev', 'devpow', 'cont', 'temp']),
      attributes: {
        'cont:contact': 'OPENED',
        'cont:usehint': 'WINDOW',
        'temp:temperature': 23.0,
        'devpow:source': 'BATTERY',
        'devpow:battery': 45,
        'dev:devtypehint': 'Contact',
      },
    },

    // --- Motion Sensors ---
    {
      address: 'DRIV:dev:motion-001',
      name: 'Hallway Motion',
      type: 'Iris Motion Sensor',
      caps: new Set(['base', 'dev', 'devpow', 'mot', 'temp']),
      attributes: {
        'mot:motion': 'NONE',
        'temp:temperature': 21.8,
        'devpow:source': 'BATTERY',
        'devpow:battery': 91,
        'dev:devtypehint': 'Motion',
      },
    },
    {
      address: 'DRIV:dev:motion-002',
      name: 'Basement Motion',
      type: 'Iris Motion Sensor',
      caps: new Set(['base', 'dev', 'devpow', 'mot', 'temp']),
      attributes: {
        'mot:motion': 'DETECTED',
        'temp:temperature': 17.2,
        'devpow:source': 'BATTERY',
        'devpow:battery': 53,
        'dev:devtypehint': 'Motion',
      },
    },

    // --- Door Lock ---
    {
      address: 'DRIV:dev:lock-001',
      name: 'Front Door Lock',
      type: 'Schlage BE469',
      caps: new Set(['base', 'dev', 'devpow', 'doorlock']),
      attributes: {
        'doorlock:lockstate': 'LOCKED',
        'doorlock:slots': '{}',
        'devpow:source': 'BATTERY',
        'devpow:battery': 78,
        'dev:devtypehint': 'Lock',
      },
    },

    // --- Leak Sensor ---
    {
      address: 'DRIV:dev:leak-001',
      name: 'Laundry Room Water Sensor',
      type: 'Iris Water Leak Sensor',
      caps: new Set(['base', 'dev', 'devpow', 'leakh2o', 'temp']),
      attributes: {
        'leakh2o:state': 'SAFE',
        'temp:temperature': 20.0,
        'devpow:source': 'BATTERY',
        'devpow:battery': 95,
        'dev:devtypehint': 'Water Leak',
      },
    },

    // --- Camera ---
    {
      address: 'DRIV:dev:camera-001',
      name: 'Front Porch Camera',
      type: 'Sercomm Indoor Camera',
      caps: new Set(['base', 'dev', 'devpow', 'camera']),
      attributes: {
        'devpow:source': 'LINE',
        'dev:devtypehint': 'Camera',
      },
    },

    // --- Button (key fob) ---
    {
      address: 'DRIV:dev:button-001',
      name: 'Iris Key Fob',
      type: 'Iris Smart Fob',
      caps: new Set(['base', 'dev', 'devpow', 'but']),
      attributes: {
        'devpow:source': 'BATTERY',
        'devpow:battery': 80,
        'dev:devtypehint': 'Button',
      },
    },
  ];
}
