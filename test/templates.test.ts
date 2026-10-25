import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createMockDevices, createMockHub } from '../src/arcus/mock-data.js';
import { DevicePower } from '../src/arcus/capabilities.js';
import { Features } from '../src/config.js';
import type { ArcusDevice } from '../src/arcus/types.js';
import { matchingMappers } from '../src/mappers/index.js';
import { testConfig } from './helpers.js';

const config = testConfig({ features: new Set(Object.values(Features)) });

/** The same device before it has reported anything: its capabilities, and only the attributes that decide which entities it gets */
function unreported(device: ArcusDevice): ArcusDevice {
  const source = device.attributes[DevicePower.ATTR_SOURCE];
  return { ...device, attributes: source === undefined ? {} : { [DevicePower.ATTR_SOURCE]: source } };
}

/** Keys a template reads from value_json without guarding against them being missing */
function unguardedKeys(template: string): string[] {
  return [...template.matchAll(/value_json\.(\w+)/g)]
    .map(m => m[1])
    .filter(key => !new RegExp(`value_json\\.${key} is defined|value_json\\.${key} \\| ?default`).test(template));
}

// HA logs "'dict object' has no attribute ..." for every state message missing a key a template reads
describe('device state has every key its discovery templates read', () => {
  const devices = [...createMockDevices(), createMockHub()];
  for (const device of devices.flatMap(d => [d, unreported(d)])) {
    const label = `${device.name}${Object.keys(device.attributes).length <= 1 ? ' (nothing reported yet)' : ''}`;
    it(label, () => {
      const mappers = matchingMappers(device);
      const state = Object.assign({}, ...mappers.map(m => m.buildState(config, device))) as Record<string, unknown>;
      for (const { topic, payload } of mappers.flatMap(m => m.buildDiscovery(config, device))) {
        for (const value of Object.values(payload)) {
          if (typeof value !== 'string') continue;
          for (const key of unguardedKeys(value)) {
            assert.ok(key in state, `${topic} reads value_json.${key}, which the state lacks: ${JSON.stringify(state)}`);
          }
        }
      }
    });
  }
});
