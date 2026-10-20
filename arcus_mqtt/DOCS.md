# Arcus MQTT

Connects Arcus devices to Home Assistant. The app publishes your devices to the Mosquitto broker app with MQTT discovery, so they appear in Home Assistant automatically.

## Before you install

Install the **Mosquitto broker** app and start it, then set up the MQTT integration when Home Assistant offers it. This app finds Mosquitto by itself; it waits, logging why, until Mosquitto is installed.

## Configuration

Set `ARCUS_BRIDGE_URL`, then either:

- **API-server mode:** `ARCUS_API_KEY`. The place is detected automatically, or set `ARCUS_PLACE_ID`.
- **Client-bridge mode:** `ARCUS_PLACE_ID`, plus `ARCUS_USERNAME` and `ARCUS_PASSWORD`, or `ARCUS_AUTH_TOKEN`.

Turn on **Show unused optional configuration options** to see the optional fields.

`FEATURES` turns on optional features, comma-separated: `buzz_in` for a Buzz in button on locks, `lock_access` for a switch per person on each lock that adds or removes their PIN. See the README's [Optional features](https://github.com/wl-net/arcus-mqtt-server#optional-features) before turning them on.

There are no MQTT settings: the app gets Mosquitto's address and login from Home Assistant.

## Security

The Mosquitto app publishes port 1883 on your network and requires a login for every connection. If nothing outside Home Assistant uses MQTT, you can turn the port off in the Mosquitto app's **Network** settings.

See the [README](https://github.com/wl-net/arcus-mqtt-server#readme) for supported devices and notes.
