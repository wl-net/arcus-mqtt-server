# Arcus MQTT

Connects Arcus devices to Home Assistant. The app runs an MQTT broker on Home Assistant's internal network and publishes your devices with MQTT discovery, so they appear in Home Assistant automatically. No port is published on the host.

## Configuration

Set `ARCUS_BRIDGE_URL`, then either:

- **API-server mode:** `ARCUS_API_KEY`. The place is detected automatically, or set `ARCUS_PLACE_ID`.
- **Client-bridge mode:** `ARCUS_PLACE_ID`, plus `ARCUS_USERNAME` and `ARCUS_PASSWORD`, or `ARCUS_AUTH_TOKEN`.

Turn on **Show unused optional configuration options** to see the optional fields.

Set `MQTT_USERNAME` and `MQTT_PASSWORD` too. Without them, anything on Home Assistant's internal network, including other apps, can read every sensor and send commands, such as disarming the alarm and unlocking doors.

## Connecting Home Assistant

Add the MQTT integration (**Settings → Devices & Services → Add Integration → MQTT**) with:

- **Broker:** the hostname on this app's **Info** tab, shown while the app is running. It's `9c7af54d-arcus-mqtt` if you added the repository as `https://github.com/wl-net/arcus-mqtt-server`.
- **Port:** `1883`
- **Username and password:** your `MQTT_USERNAME` and `MQTT_PASSWORD`

Home Assistant's MQTT integration connects to one broker, so this replaces any other broker you use, such as the Mosquitto app.

See the [README](https://github.com/wl-net/arcus-mqtt-server#readme) for supported devices and notes.
