# Arcus MQTT Server

A Node.js/TypeScript bridge that connects Arcus smart home devices to Home Assistant via an embedded MQTT broker with automatic [HA MQTT Discovery](https://www.home-assistant.io/integrations/mqtt/#mqtt-discovery).

## How It Works

```
Arcus Platform ──► Arcus MQTT Server ──► Embedded MQTT Broker ──► Home Assistant
  (or mock data)     (sync + mappers)       (Aedes, port 1883)      (auto-discovery)
```

1. Connects to the Arcus platform via WebSocket (or uses mock devices for testing)
2. Publishes HA MQTT Discovery configs so devices appear automatically
3. Publishes device state as retained JSON messages
4. Subscribes to command topics and forwards commands back to Arcus
5. Polls periodically and handles real-time WebSocket events for instant updates
6. Auto-reconnects with exponential backoff on connection loss

## Supported Device Types

| Device | HA Component | Capabilities |
|--------|-------------|--------------|
| Switch | `switch` | On/off control |
| Dimmer | `light` | On/off, brightness (JSON schema) |
| Thermostat | `climate` | Mode, setpoints, current temp/humidity |
| Contact sensor | `binary_sensor` | Door/window open/closed |
| Motion sensor | `binary_sensor` | Motion detected/clear |
| Leak sensor | `binary_sensor` | Water leak detected/safe |
| Door lock | `lock` | Lock/unlock |
| Camera | `camera` | Discovery only |
| Temperature | `sensor` | Temperature reading |
| Humidity | `sensor` | Humidity reading |
| Battery | `sensor` | Battery percentage |
| Button/fob | `device_automation` | Button press triggers |
| Alarm | `alarm_control_panel` | Arm home/away, disarm |
| Scenes | `button` + `device_automation` | Fire scenes, scene triggers |

## Quick Start

```bash
npm install
npm run build
```

### Mock Mode (no hardware needed)

```bash
ARCUS_MOCK=1 npm start
```

Starts the broker with 13 mock devices (switches, lights, thermostat, sensors, lock, camera, etc.). Point Home Assistant's MQTT integration at `localhost:1883` and devices appear automatically.

### API-Server Mode

Connects to a local Arcus API server using an API key. Place ID is auto-detected from the session.

```bash
ARCUS_BRIDGE_URL=https://your-bridge-url \
ARCUS_API_KEY=your-api-key \
npm start
```

### Client-Bridge Mode

Connects directly to the Arcus platform using user credentials. Requires a place ID.

```bash
ARCUS_BRIDGE_URL=https://your-bridge-url \
ARCUS_PLACE_ID=your-place-id \
ARCUS_USERNAME=your-username \
ARCUS_PASSWORD=your-password \
npm start
```

You can also use a pre-obtained auth token instead of username/password:

```bash
ARCUS_BRIDGE_URL=https://your-bridge-url \
ARCUS_PLACE_ID=your-place-id \
ARCUS_AUTH_TOKEN=your-token \
npm start
```

## Configuration

All configuration is via environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `MQTT_PORT` | `1883` | MQTT broker listen port |
| `MQTT_USERNAME` | — | Optional broker authentication |
| `MQTT_PASSWORD` | — | Optional broker authentication |
| `MQTT_TLS_CERT` | — | Path to TLS certificate |
| `MQTT_TLS_KEY` | — | Path to TLS private key |
| `ARCUS_MOCK` | `0` | Set to `1` for mock mode |
| `POLL_INTERVAL_MS` | `30000` | Device polling interval (ms) |
| `HA_DISCOVERY_PREFIX` | `homeassistant` | HA MQTT Discovery topic prefix |
| `DEVICE_ID_PREFIX` | `arcus` | Prefix for device IDs in topics |
| `ARCUS_BRIDGE_URL` | — | Arcus platform WebSocket URL |
| `ARCUS_API_KEY` | — | API key (api-server mode) |
| `ARCUS_USERNAME` | — | Platform username (client-bridge mode) |
| `ARCUS_PASSWORD` | — | Platform password (client-bridge mode) |
| `ARCUS_AUTH_TOKEN` | — | Auth token, alternative to username/password |
| `ARCUS_PLACE_ID` | — | Place ID (required for client-bridge, optional for api-server) |

## Home Assistant Setup

1. Start the Arcus MQTT server
2. In Home Assistant, go to **Settings → Devices & Services → Add Integration → MQTT**
3. Set the broker to the host running this server, port `1883`
4. Devices appear automatically via MQTT Discovery

## Architecture

### Project Structure

```
src/
├── index.ts              # Entry point
├── config.ts             # Environment variable config
├── broker.ts             # Aedes MQTT broker setup
├── sync.ts               # Sync loop (polling + events)
├── arcus/
│   ├── types.ts          # ArcusDevice, ArcusClient interface
│   ├── capabilities.ts   # Arcus capability constants
│   ├── client.ts         # MockArcusClient
│   ├── platform-client.ts # PlatformArcusClient (real API)
│   ├── bridge-client.ts  # WebSocket bridge (api-server + client-bridge modes)
│   └── mock-data.ts      # 13 mock devices
├── ha/
│   ├── topics.ts         # MQTT topic utilities
│   ├── discovery.ts      # HA Discovery config publishing
│   ├── state.ts          # State publishing
│   ├── command.ts        # Command handling (HA → Arcus)
│   ├── alarm.ts          # Alarm control panel
│   └── scenes.ts         # Scene discovery & control
└── mappers/
    ├── index.ts          # Mapper interface & registry
    ├── switch.ts         # swit → switch
    ├── light.ts          # dim → light (JSON schema)
    ├── climate.ts        # therm → climate
    ├── binary-sensor.ts  # cont/mot/leakh2o → binary_sensor
    ├── lock.ts           # doorlock → lock
    ├── camera.ts         # camera → camera
    ├── sensor.ts         # temp/humid/battery → sensor
    └── device-trigger.ts # but → device_automation
```

### Mapper Pattern

Each device type is handled by a mapper that implements four methods:

- **`matches(device)`** — does this mapper apply to this device? (capability-based)
- **`buildDiscovery(config, device)`** — generate HA MQTT Discovery config(s)
- **`buildState(config, device)`** — extract state from device attributes
- **`handleCommand(config, device, entity, payload)`** — translate HA command → Arcus attributes

A single device can match multiple mappers. For example, a thermostat matches both the climate mapper and the sensor mapper (for temperature/humidity readings). State from all matching mappers is merged into one JSON topic per device.

### MQTT Topics

```
# Discovery (retained, published once per entity)
homeassistant/{component}/arcus/{object_id}/config

# State (retained JSON, one per device, merged from all mappers)
arcus/{device_id}/state

# Commands (HA → Arcus, per entity)
arcus/{device_id}/{entity}/set

# Availability (retained)
arcus/{device_id}/availability

# Alarm
arcus/alarm/state
arcus/alarm/set

# Scenes
arcus/scene/{scene_id}/fired
arcus/scene/{scene_id}/fire
```

All state and discovery messages are published with `retain: true` so Home Assistant picks them up immediately on connect or restart.

## Development

```bash
npm run dev       # Watch mode — recompiles on changes
npm run build     # One-time compile
npm start         # Run compiled output
```
