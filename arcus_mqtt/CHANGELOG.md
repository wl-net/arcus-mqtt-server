# Changelog

## 0.2.3

- Multi-button remotes and scene controllers, such as the Zooz ZEN32, ZEN34 and ZEN37, and Iris key fobs: a trigger for each button. Before, only single-button devices sent presses.
- Key fobs: a presence sensor, home or away.
- Thermostats that support emergency heat: an **Emergency heat** switch, for heat pumps.
- Optional features, off unless listed in the new `FEATURES` option (comma-separated):
  - `buzz_in`: a **Buzz in** button on locks that support it.
  - `lock_access`: a switch per person on each lock that adds or removes their Arcus PIN, for timed access with a Home Assistant schedule. Read the README's Optional features section before turning it on.
- Runs on Node.js 24.

After updating, reload HomeKit Bridge so HomeKit picks up the new entities.

## 0.2.2

- Jammed locks now show as jammed in Home Assistant and HomeKit, instead of locking.

## 0.2.1

- Smart vents: open, close or set how far open, with obstruction and duct pressure sensors.
- Irrigation controllers: a valve per zone that waters for the zone's watering time, which you can change in Home Assistant.

## 0.2.0

The app now uses the Mosquitto broker app instead of running its own broker, so Home Assistant can use MQTT 5. Home Assistant requires a broker that supports MQTT 5.

**Before updating:**

1. Install the **Mosquitto broker** app and start it.
2. Go to **Settings → Devices & services → MQTT → ⋮ → Reconfigure**. Set the broker to `core-mosquitto`, port `1883`, with a login: a Home Assistant user, or one added to the Mosquitto app's `logins`. Arcus devices are unavailable from here until step 3.
3. Update this app.

Devices, entities, names, areas and automations carry over. The app's `MQTT_USERNAME` and `MQTT_PASSWORD` settings are no longer used and are removed.

## 0.1.0

First release.
