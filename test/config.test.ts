import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyLogLevel, loadAppOptions, parseFeatures, parseLogLevel } from '../src/config.js';
import { quietConsole } from './helpers.js';

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

describe('parseFeatures', () => {
  before(quietConsole);

  it('turns on the features it names, separated by commas or spaces', () => {
    assert.deepEqual([...parseFeatures('buzz_in, LOCK_ACCESS')].sort(), ['buzz_in', 'lock_access']);
    assert.deepEqual([...parseFeatures('lock_access buzz_in')].sort(), ['buzz_in', 'lock_access']);
  });

  it('turns nothing on when unset or empty, and skips unknown names', () => {
    assert.equal(parseFeatures(undefined).size, 0);
    assert.equal(parseFeatures('').size, 0);
    assert.deepEqual([...parseFeatures('teleport,buzz_in')], ['buzz_in']);
  });
});

describe('log level', () => {
  before(quietConsole);

  it('parses LOG_LEVEL, defaulting to info', () => {
    assert.equal(parseLogLevel('DEBUG'), 'debug');
    assert.equal(parseLogLevel(' warn '), 'warn');
    assert.equal(parseLogLevel(undefined), 'info');
    assert.equal(parseLogLevel(''), 'info');
    assert.equal(parseLogLevel('verbose'), 'info');
  });

  it('silences only the console methods below the level', () => {
    const printed = (level: Parameters<typeof applyLogLevel>[0]) => {
      const lines: string[] = [];
      const target = Object.fromEntries((['debug', 'log', 'info', 'warn', 'error'] as const)
        .map(method => [method, () => { lines.push(method); }])) as unknown as Console;
      applyLogLevel(level, target);
      for (const method of ['debug', 'log', 'info', 'warn', 'error'] as const) target[method]('x');
      return lines;
    };
    assert.deepEqual(printed('debug'), ['debug', 'log', 'info', 'warn', 'error']);
    assert.deepEqual(printed('info'), ['log', 'info', 'warn', 'error']);
    assert.deepEqual(printed('warn'), ['warn', 'error']);
    assert.deepEqual(printed('error'), ['error']);
  });
});
