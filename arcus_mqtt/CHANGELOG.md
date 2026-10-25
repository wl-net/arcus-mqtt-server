# Changelog

## 0.2.5

- Finishes the 0.2.4 fix: the empty **Energy** sensors that earlier versions made are now removed from Home Assistant, which stops the "'dict object' has no attribute 'energy'" warnings.
- The hub's entities are named after its hub ID, so two bridges on one broker no longer clash. Their entity IDs change once, for example `binary_sensor.hub_connectivity` becomes `binary_sensor.lww_1234_connectivity`. Update any automations or dashboards that use the hub's connectivity, mains power or battery.

## 0.2.4

- Fixes Home Assistant logging a warning such as "'dict object' has no attribute 'energy'" each time some smart plugs reported power. Devices only get the power and energy sensors their driver reports, so plugs without energy metering, such as the Iris Smart Plug, lose their empty **Energy** sensor.
- Thermostats with a humidity sensor show the humidity on the thermostat too, in Home Assistant and HomeKit.
- New optional feature `sirens`: a siren entity for each siren, to sound or silence it. Read the README's Optional features section before turning it on.

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
