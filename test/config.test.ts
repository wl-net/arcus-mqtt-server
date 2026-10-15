import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadAppOptions } from '../src/config.js';

describe('loadAppOptions', () => {
  let dir: string;
  let path: string;

  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'arcus-options-'));
    path = join(dir, 'options.json');
  });

  after(() => rmSync(dir, { recursive: true, force: true }));

  it('copies the app options into the environment', () => {
    writeFileSync(path, JSON.stringify({ ARCUS_BRIDGE_URL: 'wss://bridge.example', ARCUS_API_KEY: 'key' }));
    const env: NodeJS.ProcessEnv = {};
    assert.equal(loadAppOptions(path, env), true);
    assert.deepEqual(env, { ARCUS_BRIDGE_URL: 'wss://bridge.example', ARCUS_API_KEY: 'key' });
  });

  it('keeps variables that are already set', () => {
    writeFileSync(path, JSON.stringify({ MQTT_USERNAME: 'from-options' }));
    const env: NodeJS.ProcessEnv = { MQTT_USERNAME: 'from-env' };
    loadAppOptions(path, env);
    assert.equal(env.MQTT_USERNAME, 'from-env');
  });

  it('leaves empty and null options unset', () => {
    writeFileSync(path, JSON.stringify({ ARCUS_PLACE_ID: '', ARCUS_AUTH_TOKEN: null, MQTT_PASSWORD: 'pw' }));
    const env: NodeJS.ProcessEnv = {};
    loadAppOptions(path, env);
    assert.deepEqual(env, { MQTT_PASSWORD: 'pw' });
  });

  it('does nothing when there is no options file', () => {
    const env: NodeJS.ProcessEnv = {};
    assert.equal(loadAppOptions(join(dir, 'missing.json'), env), false);
    assert.deepEqual(env, {});
  });
});
