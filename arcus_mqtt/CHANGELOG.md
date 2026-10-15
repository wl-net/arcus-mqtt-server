# Changelog

## 0.2.0

The app now uses the Mosquitto broker app instead of running its own broker, so Home Assistant can use MQTT 5. Home Assistant requires a broker that supports MQTT 5.

**Before updating:**

1. Install the **Mosquitto broker** app and start it.
2. Go to **Settings → Devices & services → MQTT → ⋮ → Reconfigure**. Set the broker to `core-mosquitto`, port `1883`, with a login: a Home Assistant user, or one added to the Mosquitto app's `logins`. Arcus devices are unavailable from here until step 3.
3. Update this app.

Devices, entities, names, areas and automations carry over. The app's `MQTT_USERNAME` and `MQTT_PASSWORD` settings are no longer used and are removed.

## 0.1.0

First release.
