# Arcus MQTT Server

A Node.js/TypeScript bridge that connects Arcus smart home devices to Home Assistant via an embedded MQTT broker with automatic [HA MQTT Discovery](https://www.home-assistant.io/integrations/mqtt/#mqtt-discovery).

## How It Works

```
Arcus Platform ──► Arcus MQTT Server ──► Embedded MQTT Broker ──► Home Assistant
  (or mock data)     (sync + mappers)       (Aedes, port 1883)      (auto-discovery)
```

1. Connects to the Arcus platform via WebSocket (or uses mock devices for testing)
2. Publishes HA MQTT Discovery configs so devices appear automatically, and removes them when devices, scenes or capabilities go away
3. Publishes device state as retained JSON messages
4. Subscribes to command topics and forwards commands back to Arcus
5. Applies real-time WebSocket events immediately, with a full resync every 5 minutes (by default) as a safety net
6. Tracks availability: entities go unavailable when the Arcus connection drops, the device goes offline, or the hub it pairs through goes offline
7. Auto-reconnects with exponential backoff on connection loss, then resyncs

## Supported Device Types

| Device | HA Component | Capabilities |
|--------|-------------|--------------|
| Switch | `switch` | On/off control |
| Dimmer / bulb | `light` | On/off, brightness; color (hue/saturation) and color temperature for bulbs that support them |
| Thermostat | `climate` | Mode, setpoints, current temp, heating/cooling/idle, fan (off/on or speeds), ECO preset |
| Contact sensor | `binary_sensor` | Door/window open/closed |
| Motion sensor | `binary_sensor` | Motion detected/clear |
| Leak sensor | `binary_sensor` | Water leak detected/safe |
| Smoke detector | `binary_sensor` | Smoke detected/safe |
| CO detector | `binary_sensor` | Carbon monoxide detected/safe |
| Glass break sensor | `binary_sensor` | Glass break detected/safe |
| Tilt sensor | `binary_sensor` | Garage door open (flat)/closed (upright) |
| Power meter | `sensor` | Power (W) and cumulative energy (Wh) |
| Hub | `binary_sensor`, `sensor` | Hub connectivity, mains power (off = running on battery), battery level |
| Door lock | `lock` | Lock/unlock, locking/unlocking |
| Water valve | `valve` (water) | Open/close, opening/closing |
| Shade | `cover` (shade) | Open/close and set position |
| Temperature | `sensor` | Temperature reading |
| Humidity | `sensor` | Humidity reading |
| Battery | `sensor` | Battery percentage |
| Button/fob | `device_automation` | Button press triggers |
| Alarm | `alarm_control_panel` | Arm home/away, disarm |
| Alarm bypass | `binary_sensor` | On while armed with sensors bypassed; lists them by name |
| Scenes | `button` + `device_automation` | Fire scenes, scene triggers |

## Install as a Home Assistant App

On Home Assistant OS, the server can run as a Home Assistant app (formerly add-on) from a prebuilt image. The broker then stays on Home Assistant's internal network, with no port published on the host.

1. Go to **Settings → Apps → Install app**, open the **⋮** menu, choose **Repositories** and add `https://github.com/wl-net/arcus-mqtt-server`
2. Install **Arcus MQTT** from the store
3. On the app's **Configuration** tab, set `ARCUS_BRIDGE_URL` and the settings for your mode (see [Configuration](#configuration)). Turn on **Show unused optional configuration options** to see the optional fields. Set `MQTT_USERNAME` and `MQTT_PASSWORD` too, or anything on Home Assistant's internal network, including other apps, can control your devices
4. On the **Info** tab, turn on **Start on boot** and **Watchdog**, then start the app
5. Add the MQTT integration (**Settings → Devices & Services → Add Integration → MQTT**) with broker `9c7af54d-arcus-mqtt`, port `1883`, and the MQTT username and password from step 3

The broker's hostname is `<repository hash>-arcus-mqtt`, where the hash is the first 8 hex digits of the SHA-1 of the repository URL as you entered it. `9c7af54d` is the hash of `https://github.com/wl-net/arcus-mqtt-server` exactly: a trailing `/` or `.git` gives a different hostname. The app's **Info** tab shows the hostname while the app is running.

Home Assistant's MQTT integration connects to one broker, so this replaces any other broker you use, such as the Mosquitto app.

## Quick Start

```bash
npm install
npm run build
```

### Mock Mode (no hardware needed)

```bash
ARCUS_MOCK=1 npm start
```

Starts the broker with mock devices (switches, lights, thermostat, sensors, lock, hub, etc.). Point Home Assistant's MQTT integration at `localhost:1883` and devices appear automatically.

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

All configuration is via environment variables. As a Home Assistant app, set them on the app's **Configuration** tab instead: the server reads them from `/data/options.json`, and variables already set in the environment take precedence.

| Variable | Default | Description |
|----------|---------|-------------|
| `MQTT_PORT` | `1883` | MQTT broker listen port |
| `MQTT_USERNAME` | — | Broker username. **Set this:** without it the broker accepts anyone (see below) |
| `MQTT_PASSWORD` | — | Broker password |
| `MQTT_TLS_CERT` | — | Path to TLS certificate |
| `MQTT_TLS_KEY` | — | Path to TLS private key |
| `ARCUS_MOCK` | `0` | Set to `1` for mock mode |
| `POLL_INTERVAL_MS` | `300000` | Full resync interval (ms). Live events carry most updates; this is a safety net |
| `HA_DISCOVERY_PREFIX` | `homeassistant` | HA MQTT Discovery topic prefix |
| `DEVICE_ID_PREFIX` | `arcus` | Prefix for device IDs in topics |
| `ARCUS_BRIDGE_URL` | — | Arcus platform WebSocket URL |
| `ARCUS_API_KEY` | — | API key (api-server mode) |
| `ARCUS_USERNAME` | — | Platform username (client-bridge mode) |
| `ARCUS_PASSWORD` | — | Platform password (client-bridge mode) |
| `ARCUS_AUTH_TOKEN` | — | Auth token, alternative to username/password |
| `ARCUS_PLACE_ID` | — | Place ID (required for client-bridge, optional for api-server) |

> **Security:** broker authentication is only enabled when both `MQTT_USERNAME` and `MQTT_PASSWORD` are set. Without them, anyone who can reach port 1883 can read every sensor and send commands, including disarming the alarm and unlocking doors. The alarm panel doesn't require a code to disarm. Set credentials, and don't expose the port beyond the network Home Assistant runs on.

## Home Assistant Setup

1. Start the Arcus MQTT server
2. In Home Assistant, go to **Settings → Devices & Services → Add Integration → MQTT**
3. Set the broker to the host running this server, port `1883`, with the `MQTT_USERNAME` and `MQTT_PASSWORD` you configured
4. Devices appear automatically via MQTT Discovery

### Notes

- **Alarm bypass notifications.** Arming with a door or window open arms around it (Arcus "arm bypassed"). The **Bypassed sensors** binary sensor on the *Arcus Security* device turns on when that happens, and its `bypassed_sensors` attribute lists the sensors. Trigger a notification automation on it turning on.
- **Thermostat fan.** Arcus fans have two states: run only while heating or cooling, or run all the time. They appear as **off** and **on** (or off/low/medium/high for multi-speed fans), because HomeKit's fan toggle needs an "off" mode. "Off" still runs the fan during heating and cooling.
- **HomeKit.** HomeKit Bridge sets up an accessory's controls when it creates it. After updating this server, reload HomeKit Bridge (**Settings → Devices & Services → HomeKit Bridge → ⋮ → Reload**) so changes such as new fan modes reach HomeKit. If an accessory still misbehaves, use the `homekit.reset_accessory` action on it.
- **Removed devices.** Devices, scenes and entities removed in Arcus are removed from Home Assistant on the next sync. This only works for devices the server has seen since it last started: anything removed while it was down stays in Home Assistant as unavailable, and must be deleted there by hand.

## Architecture

### Project Structure

```
src/
├── index.ts              # Entry point
├── config.ts             # Environment variable config, Home Assistant app options
├── broker.ts             # Aedes MQTT broker setup
├── sync.ts               # Sync loop (polling + events)
├── arcus/
│   ├── types.ts          # ArcusDevice, ArcusClient interface
│   ├── capabilities.ts   # Arcus capability constants
│   ├── client.ts         # MockArcusClient
│   ├── platform-client.ts # PlatformArcusClient (real API)
│   ├── bridge-client.ts  # WebSocket bridge (api-server + client-bridge modes)
│   └── mock-data.ts      # Mock devices and hub
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
    ├── light.ts          # dim/color/colortemp → light
    ├── climate.ts        # therm → climate
    ├── binary-sensor.ts  # cont/mot/leakh2o/smoke/co/glass/tilt → binary_sensor
    ├── lock.ts           # doorlock → lock
    ├── sensor.ts         # temp/humid/battery/pow → sensor
    ├── device-trigger.ts # but → device_automation
    ├── hub.ts            # hub connectivity/power/battery → binary_sensor, sensor
    ├── valve.ts          # valv → valve
    └── shade.ts          # shade → cover
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
# Discovery (retained; republished only when it changes, emptied to remove an entity)
homeassistant/{component}/arcus/{object_id}/config

# State (retained JSON, one per device, merged from all mappers)
arcus/{device_id}/state

# Commands (HA → Arcus, per entity)
arcus/{device_id}/{entity}/set

# Availability (retained, online/offline)
arcus/bridge/availability            # Arcus connection is up
arcus/{device_id}/availability       # device is online (devconn:state)
arcus/{hub_id}/connection            # hub is connected (hubconn:state)

# Button presses (not retained)
arcus/{device_id}/trigger

# Alarm
arcus/alarm/state
arcus/alarm/set
arcus/alarm/availability
arcus/alarm/attributes               # bypassed sensors (JSON)

# Scenes
arcus/scene/{scene_id}/fired
arcus/scene/{scene_id}/fire
```

An entity is available only while every availability topic it lists is `online`: the bridge, the device itself, and for Zigbee and Z-Wave devices, the hub. The hub's own status entities don't depend on the hub connection topic, so they stay available and can report the hub as disconnected.

`arcus` is the default `DEVICE_ID_PREFIX`; the alarm topics currently always use `arcus`.

State, availability and discovery messages are retained so Home Assistant picks them up immediately on connect or restart. The embedded broker keeps retained messages in memory, and the server republishes everything when it starts.

## Development

```bash
npm run dev       # Watch mode — recompiles on changes
npm run build     # One-time compile
npm start         # Run compiled output
npm test          # Compile and run the test suite
```

Tests use Node's built-in test runner and live in `test/`. They compile to `build-test/` with `tsconfig.test.json`, so they never end up in `dist/` or the Docker image. `test/helpers.ts` provides a fake MQTT broker and a fake Arcus WebSocket server.

### Releasing

The Home Assistant app pulls `ghcr.io/wl-net/arcus-mqtt-server:<version>`, where `<version>` is `version` in `arcus_mqtt/config.yaml`.

1. Bump `version` in `arcus_mqtt/config.yaml` and commit
2. Tag it `v<version>` and push the tag: `git tag v0.2.0 && git push origin v0.2.0`
3. Push `main` once the release workflow has finished

The release workflow runs the tests, checks that the tag matches `version`, and pushes the amd64 and arm64 image tagged `<version>` and `latest`. Home Assistant offers the update once the new `version` reaches `main`, and the update fails until the image exists, which is why `main` goes last.

The first release creates the package on GitHub as private. Make it public (**Package settings → Change visibility**) so Home Assistant can pull it.
