# Arcus MQTT Server

A Node.js/TypeScript bridge that connects Arcus smart home devices to Home Assistant over MQTT, through a broker such as Home Assistant's Mosquitto app, with automatic [HA MQTT Discovery](https://www.home-assistant.io/integrations/mqtt/#mqtt-discovery).

## How It Works

```
Arcus Platform ──► Arcus MQTT Server ──► MQTT broker ◄── Home Assistant
  (or mock data)     (sync + mappers)      (Mosquitto)     (auto-discovery)
```

1. Connects to the Arcus platform via WebSocket (or uses mock devices for testing)
2. Publishes HA MQTT Discovery configs so devices appear automatically, and removes them when devices, scenes or capabilities go away
3. Publishes device state as retained JSON messages
4. Subscribes to command topics and forwards commands back to Arcus
5. Applies real-time WebSocket events immediately, with a full resync every 5 minutes (by default) as a safety net
6. Tracks availability: entities go unavailable when the Arcus connection drops, the device goes offline, or the hub it pairs through goes offline
7. Reconnects to Arcus (with exponential backoff) and to the broker when either connection drops, then resyncs

## Supported Device Types

| Device | HA Component | Capabilities |
|--------|-------------|--------------|
| Switch | `switch` | On/off control |
| Dimmer / bulb | `light` | On/off, brightness; color (hue/saturation) and color temperature for bulbs that support them |
| Thermostat | `climate`, `switch` | Mode, setpoints, current temperature and humidity, heating/cooling/idle, fan (off/on or speeds), ECO preset; emergency heat switch where the driver supports it |
| Contact sensor | `binary_sensor` | Door/window open/closed |
| Motion sensor | `binary_sensor` | Motion detected/clear |
| Leak sensor | `binary_sensor` | Water leak detected/safe |
| Smoke detector | `binary_sensor` | Smoke detected/safe |
| CO detector | `binary_sensor` | Carbon monoxide detected/safe |
| Glass break sensor | `binary_sensor` | Glass break detected/safe |
| Tilt sensor | `binary_sensor` | Garage door open (flat)/closed (upright) |
| Power meter | `sensor` | Power (W) and cumulative energy (Wh) |
| Hub | `binary_sensor`, `sensor` | Hub connectivity, mains power (off = running on battery), battery level |
| Door lock | `lock`; `button`, `switch` with [optional features](#optional-features) | Lock/unlock, locking/unlocking, jammed; optionally buzz in, and adding or removing each person's PIN |
| Garage door opener | `cover` (garage) | Open/close, opening/closing |
| Water valve | `valve` (water) | Open/close, opening/closing |
| Irrigation controller | `valve` (water) + `number` per zone | Water or stop each zone; watering time per zone, used when a zone is opened |
| Shade | `cover` (shade) | Open/close and set position |
| Vent | `cover` (damper), `binary_sensor`, `sensor` | Open/close and set position; obstruction; duct air pressure |
| Siren | `siren` with the `sirens` [optional feature](#optional-features) | Sound and silence |
| Temperature | `sensor` | Temperature reading |
| Humidity | `sensor` | Humidity reading |
| Battery | `sensor` | Battery percentage |
| Button / remote | `device_automation` | A trigger per button, including each button on multi-button remotes and scene controllers |
| Key fob | `device_automation`, `binary_sensor` | A trigger per button; presence (home/away) |
| Alarm | `alarm_control_panel` | Arm home/away, disarm |
| Alarm bypass | `binary_sensor` | On while armed with sensors bypassed; lists them by name |
| Scenes | `button` + `device_automation` | Fire scenes, scene triggers |

## Install as a Home Assistant App

On Home Assistant OS and Supervised installs, the server runs as a Home Assistant app (formerly add-on) from a prebuilt image, alongside the Mosquitto broker app.

1. Install the **Mosquitto broker** app and start it. Home Assistant then offers to set up the MQTT integration: accept it
2. Go to **Settings → Apps → Install app**, open the **⋮** menu, choose **Repositories** and add `https://github.com/wl-net/arcus-mqtt-server`
3. Install **Arcus MQTT** from the store
4. On the app's **Configuration** tab, set `ARCUS_BRIDGE_URL` and the settings for your mode (see [Configuration](#configuration)). Turn on **Show unused optional configuration options** to see the optional fields
5. On the **Info** tab, turn on **Start on boot** and **Watchdog**, then start the app

The app gets Mosquitto's address and login from Home Assistant, so there are no MQTT settings. Devices appear automatically.

> **Security:** the Mosquitto app requires a login for every connection, and publishes port 1883 on your network. If nothing outside Home Assistant uses MQTT, turn the port off in the Mosquitto app's **Network** settings. The alarm panel doesn't require a code to disarm, so any MQTT login can disarm it.

### Upgrading from 0.1.0

0.1.0 ran its own broker, which only supported MQTT 3.1.1; Home Assistant requires MQTT 5. Before updating to 0.2.0 or later:

1. Install the **Mosquitto broker** app and start it
2. Go to **Settings → Devices & services → MQTT → ⋮ → Reconfigure**. Set the broker to `core-mosquitto`, port `1883`, with a login: a Home Assistant user, or one added to the Mosquitto app's `logins`. Arcus devices are unavailable from here until step 3
3. Update the Arcus MQTT app

Devices, entities, names, areas and automations carry over. Don't delete and re-add the MQTT integration instead of reconfiguring it: that removes its devices along with their names and areas.

## Install with Docker

If Home Assistant is a Container install, with no **Apps** menu, use Docker instead. `docker-compose.yml` runs the server next to it, with its own Mosquitto broker.

1. `git clone https://github.com/wl-net/arcus-mqtt-server && cd arcus-mqtt-server`
2. Copy `.env.example` to `.env`, and set `ARCUS_BRIDGE_URL` and the settings for your mode (see [Configuration](#configuration))
3. Run `docker compose up -d --build`. `docker compose logs -f arcus-mqtt` should show `Connected to mqtt://mosquitto:1883`, then `Bridge is running`
4. In Home Assistant, add the **MQTT** integration with broker `localhost`, port `1883` and no login. If MQTT is already set up, use **⋮ → Reconfigure** on it instead

This assumes Home Assistant uses host networking, as in Home Assistant's Docker instructions. Otherwise, put it on this project's Docker network and use `mosquitto` as the broker.

To update, run `git pull` and `docker compose up -d --build` again. To try a branch, check it out first.

> **Security:** Mosquitto takes connections without a login, but its port is published on 127.0.0.1, so only this machine and this project's containers can reach it. That needs Docker 28.3.3 or later: older versions can let other machines on your network reach ports published on 127.0.0.1. Anything on this machine can control your devices through MQTT, including disarming the alarm.

**Upgrading from 0.1.0:** 0.1.0 ran its own broker on port 1883. Stop it, follow the steps above, and in step 4 reconfigure MQTT. Devices and their settings carry over.

### More than one hub

Each Arcus hub has its own place, and a server handles one place. For two, such as two buildings with a hub each, run a second server against the same broker, with its own `DEVICE_ID_PREFIX`:

1. Copy `.env` to `.env.second`. In it, set the second place's `ARCUS_PLACE_ID` and a `DEVICE_ID_PREFIX` such as `barn`. The same Arcus login works for both places. In api-server mode, set an API key for the second place instead: each key belongs to one place
2. Uncomment `arcus-mqtt-second` in `docker-compose.yml`, then run `docker compose up -d --build`

Leave the first server's prefix as it is: changing it makes Home Assistant see new devices. Each place gets its own alarm panel, scenes and hub. Both places' alarm and scene devices are named *Arcus Security* and *Arcus Scenes*, so rename the second place's in Home Assistant.

The Home Assistant app handles one place, since an app can only be installed once.

## Running Locally

Needs Node.js 24, the version in the Docker image.

```bash
npm install
npm run build
```

The server needs an MQTT broker that supports MQTT 5, such as Mosquitto (`brew install mosquitto`, then run `mosquitto`). Point `MQTT_URL` at it, and Home Assistant's MQTT integration at the same broker.

### Mock Mode (no hardware needed)

```bash
MQTT_URL=mqtt://localhost:1883 ARCUS_MOCK=1 npm start
```

Publishes mock devices (switches, lights, thermostat, sensors, lock, hub, etc.), which appear in Home Assistant automatically.

### API-Server Mode

Connects to a local Arcus API server using an API key. Place ID is auto-detected from the session.

```bash
MQTT_URL=mqtt://localhost:1883 \
ARCUS_BRIDGE_URL=https://your-bridge-url \
ARCUS_API_KEY=your-api-key \
npm start
```

### Client-Bridge Mode

Connects directly to the Arcus platform using user credentials. Requires a place ID.

```bash
MQTT_URL=mqtt://localhost:1883 \
ARCUS_BRIDGE_URL=https://your-bridge-url \
ARCUS_PLACE_ID=your-place-id \
ARCUS_USERNAME=your-username \
ARCUS_PASSWORD=your-password \
npm start
```

You can also use a pre-obtained auth token instead of username/password:

```bash
MQTT_URL=mqtt://localhost:1883 \
ARCUS_BRIDGE_URL=https://your-bridge-url \
ARCUS_PLACE_ID=your-place-id \
ARCUS_AUTH_TOKEN=your-token \
npm start
```

## Configuration

All configuration is via environment variables. The Home Assistant app offers the `ARCUS_*` settings and `FEATURES` on its **Configuration** tab instead, which the server reads from `/data/options.json` (variables already set in the environment take precedence). The app gets its MQTT settings from Home Assistant and uses the defaults for the rest.

| Variable | Default | Description |
|----------|---------|-------------|
| `MQTT_URL` | — | Broker to connect to, e.g. `mqtt://localhost:1883` (`mqtts://` for TLS). Not used in the app, which gets the broker from Home Assistant |
| `MQTT_USERNAME` | — | Broker login, with `MQTT_URL` |
| `MQTT_PASSWORD` | — | Broker password, with `MQTT_URL` |
| `ARCUS_MOCK` | `0` | Set to `1` for mock mode |
| `ARCUS_MOCK_PLACE` | — | In mock mode, a name such as `second` that gives the mock devices their own addresses, for running a second mock server on the same broker |
| `POLL_INTERVAL_MS` | `300000` | Full resync interval (ms). Live events carry most updates; this is a safety net |
| `HA_DISCOVERY_PREFIX` | `homeassistant` | HA MQTT Discovery topic prefix |
| `DEVICE_ID_PREFIX` | `arcus` | Prefix for topics, unique IDs and device IDs. Give each place its own when several servers share a broker (see [More than one hub](#more-than-one-hub)) |
| `ARCUS_BRIDGE_URL` | — | Arcus platform WebSocket URL |
| `ARCUS_API_KEY` | — | API key (api-server mode) |
| `ARCUS_USERNAME` | — | Platform username (client-bridge mode) |
| `ARCUS_PASSWORD` | — | Platform password (client-bridge mode) |
| `ARCUS_AUTH_TOKEN` | — | Auth token, alternative to username/password |
| `ARCUS_PLACE_ID` | — | Place ID (required for client-bridge, optional for api-server) |
| `FEATURES` | — | [Optional features](#optional-features) to turn on, comma-separated, e.g. `buzz_in,lock_access,sirens` |

## Optional features

Some features are off unless you list them in `FEATURES`, comma-separated, such as `FEATURES=buzz_in,sirens`. In the app, enter the same list in the **FEATURES** option and restart the app.

Turning a feature off stops its commands, but its entities stay in Home Assistant, doing nothing, until you delete them there (see **Removed devices** under [Notes](#notes)).

### `buzz_in`: Buzz in

Locks that support it get a **Buzz in** button. It unlocks a locked door, and the lock locks itself again shortly after (45 seconds on Schlage deadbolts). It does nothing if the door is already unlocked.

HomeKit asks you to unlock your iPhone before it unlocks a lock, but HomeKit Bridge turns buttons into switches, which have no such check. Leave this button out of HomeKit Bridge unless you want that.

### `lock_access`: Lock access

Each lock gets a switch per person, such as **Dog Walker access**, that's on while that person's PIN is on the lock. Turn it on to add their PIN to the lock, off to remove it. With a schedule in Home Assistant, this gives you timed access, which Arcus doesn't have.

How Arcus handles PINs:

- PINs belong to people, not locks. Each person at a place has one 4-digit PIN, which you set in the Arcus app. For someone who shouldn't have the app, such as a dog walker, add a person without a login and give them a PIN
- Everyone with a PIN at the place gets a switch on every lock. Someone whose PIN is already on a lock keeps that lock's switch even without a PIN, so you can remove it. New people show up within 5 minutes
- Arcus keypads accept any person's PIN at the place, so a PIN you add for a door also disarms the alarm at a keypad
- Arcus doesn't record which person's PIN opened the lock

The switch turns on as soon as Arcus starts adding the PIN, and turns off only once the lock reports the PIN removed. If the lock or hub is offline, the PIN stays on and so does the switch.

The switches are configuration entities, so dashboards and HomeKit Bridge leave them out unless you add them.

For timed access, create a **Schedule** helper for the person (**Settings → Devices & services → Helpers**), then turn their switch on and off with it. Use your switch's entity ID, from its settings, in place of the one below:

```yaml
automation:
  - alias: Dog walker's front door PIN
    triggers:
      - trigger: state
        entity_id: schedule.dog_walker
        to: ["on", "off"]
    actions:
      - action: "switch.turn_{{ trigger.to_state.state }}"
        target:
          entity_id: switch.front_door_dog_walker_access
  - alias: Dog walker's PIN is still on the front door
    triggers:
      - trigger: state
        entity_id: schedule.dog_walker
        to: "off"
        for: "00:05:00"
    conditions:
      - condition: state
        entity_id: switch.front_door_dog_walker_access
        state: "on"
    actions:
      - action: notify.notify
        data:
          message: The dog walker's PIN is still on the front door
```

### `sirens`: Sirens

Each siren gets a siren entity, to sound or silence it from Home Assistant. Any MQTT login can sound it.

A siren you turn on stays on until something turns it off: Arcus doesn't turn sirens off by themselves. Have the automation that sounds one turn it off too:

```yaml
actions:
  - action: siren.turn_on
    target:
      entity_id: siren.hallway_siren
  - delay: "00:02:00"
  - action: siren.turn_off
    target:
      entity_id: siren.hallway_siren
```

Turning a siren off from Home Assistant silences it, even while the Arcus alarm is going off.

## Notes

- **Alarm bypass notifications.** Arming with a door or window open arms around it (Arcus "arm bypassed"). The **Bypassed sensors** binary sensor on the *Arcus Security* device turns on when that happens, and its `bypassed_sensors` attribute lists the sensors. Trigger a notification automation on it turning on.
- **Thermostat fan.** Arcus fans have two states: run only while heating or cooling, or run all the time. They appear as **off** and **on** (or off/low/medium/high for multi-speed fans), because HomeKit's fan toggle needs an "off" mode. "Off" still runs the fan during heating and cooling.
- **Buttons.** Each button press fires a device trigger: in an automation, choose the remote as the device, then the button. Arcus only reports presses, so holds and double presses can't be told apart from single presses.
- **Key fob presence.** A fob shows as away once the hub hasn't heard from it for a while (10 minutes for Iris fobs), and home again as soon as it's heard.
- **Emergency heat.** Thermostats whose Arcus driver supports emergency heat get an **Emergency heat** switch. On, the thermostat runs only its backup heat, as a heat pump needs when it's too cold outside for the compressor; off, it goes back to its previous mode. The switch appears whether or not the thermostat controls a heat pump, so disable it in Home Assistant if you don't need it.
- **HomeKit.** HomeKit Bridge sets up an accessory's controls when it creates it. After updating this server, reload HomeKit Bridge (**Settings → Devices & Services → HomeKit Bridge → ⋮ → Reload**) so changes such as new fan modes reach HomeKit. If an accessory still misbehaves, use the `homekit.reset_accessory` action on it.
- **Removed devices.** Devices, scenes and entities removed in Arcus are removed from Home Assistant on the next sync. This only works for devices the server has seen since it last started: anything removed while it was down stays in Home Assistant as unavailable, and must be deleted there by hand.

## Architecture

### Project Structure

```
src/
├── index.ts              # Entry point
├── config.ts             # Environment variable config, Home Assistant app options
├── mqtt.ts               # MQTT client, finding the broker
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
│   ├── scenes.ts         # Scene discovery & control
│   └── lock-access.ts    # Per-person PIN switches on locks (lock_access)
└── mappers/
    ├── index.ts          # Mapper interface & registry
    ├── switch.ts         # swit → switch
    ├── light.ts          # dim/color/colortemp → light
    ├── climate.ts        # therm → climate, emergency heat switch
    ├── binary-sensor.ts  # cont/mot/leakh2o/smoke/co/glass/tilt/pres → binary_sensor
    ├── lock.ts           # doorlock → lock; buzz in, PIN access state and commands
    ├── cover.ts          # motdoor → cover (garage)
    ├── sensor.ts         # temp/humid/battery/pow → sensor
    ├── device-trigger.ts # but, one per button → device_automation
    ├── hub.ts            # hub connectivity/power/battery → binary_sensor, sensor
    ├── valve.ts          # valv → valve
    ├── shade.ts          # shade → cover
    ├── vent.ts           # vent → cover (damper), obstruction, pressure
    ├── siren.ts          # alert on sirens → siren (sirens)
    └── irrigation.ts     # irrcont/irr → valve + watering time per zone
```

### Mapper Pattern

Each device type is handled by a mapper that implements four methods:

- **`matches(device)`** — does this mapper apply to this device? (capability-based)
- **`buildDiscovery(config, device)`** — generate HA MQTT Discovery config(s)
- **`buildState(config, device)`** — extract state from device attributes
- **`handleCommand(config, device, entity, payload)`** — translate HA command → Arcus attributes

Mappers whose commands are Arcus method calls rather than attribute changes, such as starting irrigation, also implement **`handleMethodCommand`**. Mappers that act on live events rather than state, such as button presses, implement **`onEvent`**.

The state must have every key a discovery template reads, `null` while the device hasn't reported a value: Home Assistant logs a warning for each state message missing one. `test/templates.test.ts` checks this for every mock device, both as-is and before it has reported anything.

Removing or renaming an entity needs **`retiredTopics`** too, listing the topics older versions published. The server only removes topics it has published since it started, so without that, the old entity stays in Home Assistant after an update.

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

# Button presses (not retained): PRESSED, or the button's name on multi-button devices
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

`arcus` in the topics above is the default `DEVICE_ID_PREFIX`.

State, availability and discovery messages are retained so Home Assistant picks them up immediately on connect or restart. The server republishes everything when it starts and after reconnecting to the broker. If the server drops off without disconnecting, the broker publishes its will message, `offline` on `arcus/bridge/availability`, so its entities go unavailable.

## Development

```bash
npm run dev       # Watch mode — recompiles on changes
npm run build     # One-time compile
npm start         # Run compiled output
npm test          # Compile and run the test suite
npm run test:ha   # Run against a real Home Assistant, in Docker
```

Tests use Node's built-in test runner and live in `test/`. They compile to `build-test/` with `tsconfig.test.json`, so they never end up in `dist/` or the Docker image. `test/helpers.ts` provides a fake MQTT connection and a fake Arcus WebSocket server. `test/mqtt.test.ts` runs the MQTT client against an in-process aedes broker, which only speaks MQTT 3.1.1, and against a real MQTT 5 broker when `TEST_MQTT_URL` is set. CI runs Mosquitto for that.

`npm run test:ha` needs Docker. It starts Mosquitto and Home Assistant, sets Home Assistant up through its own APIs, runs the last release in mock mode, then upgrades it to your tree alongside a second place. It fails on anything Home Assistant logs, on entities it rejected or kept from before the upgrade, on entities that never get a state, and on retained topics a fresh install wouldn't have. Container logs are saved to `build-test/ha-logs/`, and `HA_KEEP=1` leaves everything running to look around (log in as `test` / `test-password`). CI runs it on every push with the Home Assistant version pinned in `test/home-assistant.test.ts`, and weekly with the latest stable release.

### Testing a Local Build

With the [Docker install](#install-with-docker), check out your branch and run `docker compose up -d --build`.

With the app, run local changes against its Mosquitto app without releasing them:

1. Copy `.env.example` to `.env` and fill it in. Set `MQTT_URL` to `mqtt://homeassistant.local:1883`, with a login from the Mosquitto app's `logins` setting or a Home Assistant user. The Mosquitto app must publish port 1883: if you turned it off (see the security note under [Install as a Home Assistant App](#install-as-a-home-assistant-app)), turn it back on while testing
2. Stop the Arcus MQTT app in Home Assistant, so commands don't reach Arcus twice
3. Run `docker compose up --build --no-deps arcus-mqtt`, which leaves out the compose file's own Mosquitto
4. When you're done, press Ctrl-C and start the app again

Entities keep their IDs, so Home Assistant shows the local build's devices in place of the app's.

### Releasing

The Home Assistant app pulls `ghcr.io/wl-net/arcus-mqtt-server:<version>`, where `<version>` is `version` in `arcus_mqtt/config.yaml`.

1. Check that CI passed on `main`, including the Home Assistant job, and try the changes on a real install
2. Set the new version in `arcus_mqtt/config.yaml` and in `package.json` (`npm version <version> --no-git-tag-version`)
3. Add an entry to `arcus_mqtt/CHANGELOG.md`, which Home Assistant shows in its update dialog, and commit
4. Tag the commit and push the tag: `git tag -a v<version> -m <version> && git push origin v<version>`
5. Push `main` once the release workflow has finished

The release workflow runs the tests, checks that the tag matches `version`, and pushes the amd64 and arm64 image tagged `<version>` and `latest`. Home Assistant offers the update once the new `version` reaches `main`, and the update fails until the image exists, which is why `main` goes last.

The package on GitHub must stay public so Home Assistant can pull the image.
