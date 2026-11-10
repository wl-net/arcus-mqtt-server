import { isDeepStrictEqual } from 'node:util';
import type { ArcusClient } from './arcus/client.js';
import type { ArcusDevice, DeviceSetting } from './arcus/types.js';
import { DeviceSettings } from './arcus/capabilities.js';

/**
 * Settings without their values, which can change without the rest going out of date, and
 * without empty fields, which the saved copy may drop on its way through the database
 */
function described(params: DeviceSetting[]): Array<Record<string, unknown>> {
  return params.map(param => Object.fromEntries(
    Object.entries(param).filter(([field, value]) => field !== 'value' && value !== null && value !== undefined),
  ));
}

/**
 * Makes Arcus save a device's settings again when its saved copy is out of date, the way
 * reading a setting in Oculus does. Arcus saves devsettings:params only when the driver sends
 * it: when the device connects, a setting changes, or the device reports one. So after a
 * driver update, such as the one that added labels, a device keeps its old names and
 * descriptions until then. Reading one Z-Wave setting makes the device report it, and the
 * driver then saves the whole list, which a value change brings to the bridge.
 *
 * Only sends the read when the saved copy differs from what the driver describes now, so a
 * device with a current copy gets no Z-Wave traffic. Returns whether it sent one.
 */
export async function refreshStaleSettings(client: ArcusClient, device: ArcusDevice): Promise<boolean> {
  const current = await client.getDeviceSettings(device.address);
  const saved = device.attributes[DeviceSettings.ATTR_PARAMS];
  if (Array.isArray(saved) && isDeepStrictEqual(described(saved as DeviceSetting[]), described(current))) {
    return false;
  }
  // Driver-only settings, such as a keypad's sounds, have nothing on the device to read
  const readable = current.find(param => typeof param.zwaveParamNo === 'number');
  if (!readable) return false;
  await client.callMethod(device.address, { method: DeviceSettings.CMD_GETPARAM, args: { paramId: readable.paramId } });
  return true;
}
