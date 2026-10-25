import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAvailability,
  buildDeviceInfo,
  syncOwnedDiscovery,
  removeOwnedDiscovery,
} from '../src/ha/discovery.js';
import { FakeMqtt, makeDevice, testConfig } from './helpers.js';

const config = testConfig();

describe('buildDeviceInfo', () => {
  it('uses the Arcus vendor and model when present', () => {
    const device = makeDevice('DRIV:dev:d1', ['dev'], { 'dev:vendor': 'Nortek', 'dev:model': 'GD00Z' });
    const info = buildDeviceInfo(config, device);
    assert.equal(info.manufacturer, 'Nortek');
    assert.equal(info.model, 'GD00Z');
  });

  it('falls back to "Arcus" and the product type', () => {
    const info = buildDeviceInfo(config, makeDevice('DRIV:dev:d1', ['dev']));
    assert.equal(info.manufacturer, 'Arcus');
    assert.equal(info.model, 'Test');
  });

  it('links hub-paired devices to the hub with via_device', () => {
    const device = makeDevice('DRIV:dev:d1', ['dev']);
    assert.equal(buildDeviceInfo(config, device).via_device, undefined);
    device.hubAddress = 'SERV:LWW-1:hub';
    assert.equal(buildDeviceInfo(config, device).via_device, 'arcus_LWW-1');
  });
});

describe('buildAvailability', () => {
  it('requires the bridge and the device to be online', () => {
    const avail = buildAvailability(config, makeDevice('DRIV:dev:d1', ['dev']));
    assert.equal(avail.availability_mode, 'all');
    assert.deepEqual(avail.availability.map(a => a.topic), ['arcus/bridge/availability', 'arcus/d1/availability']);
  });

  it('also requires the hub for hub-paired devices', () => {
    const device = makeDevice('DRIV:dev:d1', ['dev']);
    device.hubAddress = 'SERV:LWW-1:hub';
    assert.deepEqual(
      buildAvailability(config, device).availability.map(a => a.topic),
      ['arcus/bridge/availability', 'arcus/d1/availability', 'arcus/LWW-1/connection'],
    );
  });
});

describe('owned discovery', () => {
  const disc = (topic: string, name = 'x') => ({ topic, payload: { name } });

  it('publishes a config only when it changes', () => {
    const broker = new FakeMqtt();
    syncOwnedDiscovery(broker, 'owner-a', [disc('t/a1'), disc('t/a2')]);
    assert.equal(broker.published.length, 2);

    syncOwnedDiscovery(broker, 'owner-a', [disc('t/a1'), disc('t/a2')]);
    assert.equal(broker.published.length, 2, 'unchanged configs were re-sent');

    syncOwnedDiscovery(broker, 'owner-a', [disc('t/a1', 'renamed'), disc('t/a2')]);
    assert.deepEqual(broker.since(2).map(p => p.topic), ['t/a1']);
  });

  it('removes configs an owner no longer publishes', () => {
    const broker = new FakeMqtt();
    syncOwnedDiscovery(broker, 'owner-b', [disc('t/b1'), disc('t/b2')]);
    syncOwnedDiscovery(broker, 'owner-b', [disc('t/b1')]);
    assert.deepEqual(broker.since(2), [{ topic: 't/b2', payload: '', retain: true }]);
    assert.equal(broker.retained.has('t/b2'), false);
  });

  it('republishes a removed owner when it comes back', () => {
    const broker = new FakeMqtt();
    syncOwnedDiscovery(broker, 'owner-c', [disc('t/c1')]);
    removeOwnedDiscovery(broker, 'owner-c');
    assert.equal(broker.retained.has('t/c1'), false);

    // The cache entry must have been cleared, or this would be skipped as unchanged
    syncOwnedDiscovery(broker, 'owner-c', [disc('t/c1')]);
    assert.equal(broker.retained.get('t/c1'), JSON.stringify({ name: 'x' }));
  });

  it("does not touch other owners' configs", () => {
    const broker = new FakeMqtt();
    syncOwnedDiscovery(broker, 'owner-d', [disc('t/d1')]);
    syncOwnedDiscovery(broker, 'owner-e', [disc('t/e1')]);
    removeOwnedDiscovery(broker, 'owner-d');
    assert.equal(broker.retained.has('t/e1'), true);
  });
});
