import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import {
  DEFAULT_API_PROXY_TARGET,
  DEFAULT_VITE_PORT,
  buildViteConfig,
  resolveApiProxyTarget,
  resolveVitePort,
} from '../../vite.config.ts';

const ROOT = resolve(import.meta.dirname, '../../..');

test('the Vite development server defaults to the launch contract and never auto-shifts ports', () => {
  const config = buildViteConfig({});

  assert.equal(DEFAULT_VITE_PORT, 5173);
  assert.equal(config.server?.port, 5173);
  assert.equal(config.server?.strictPort, true);
  assert.equal(config.server?.proxy?.['/api']?.target, DEFAULT_API_PROXY_TARGET);
  assert.equal(config.server?.proxy?.['/ws']?.target, DEFAULT_API_PROXY_TARGET);
  assert.equal(config.server?.proxy?.['/ws']?.ws, true);
});

test('frontend port and API proxy use separate validated environment variables', () => {
  const config = buildViteConfig({
    VITE_PORT: '6173',
    VITE_API_PROXY_TARGET: 'http://127.0.0.1:9080',
  });

  assert.equal(config.server?.port, 6173);
  assert.equal(config.server?.proxy?.['/api']?.target, 'http://127.0.0.1:9080');
  assert.equal(config.server?.proxy?.['/ws']?.target, 'http://127.0.0.1:9080');
});

test('invalid frontend ports fail closed instead of falling through to Vite auto-port behavior', () => {
  for (const value of ['', '0', '-1', '5173.5', '65536', 'not-a-port']) {
    assert.throws(() => resolveVitePort(value), /VITE_PORT/);
  }
});

test('invalid or credential-bearing API proxy targets fail closed', () => {
  for (const value of ['', '/api', 'ftp://127.0.0.1:8080', 'http://user:secret@127.0.0.1:8080', 'http://127.0.0.1:8080/path']) {
    assert.throws(() => resolveApiProxyTarget(value), /VITE_API_PROXY_TARGET/);
  }
});

test('the checked-in launcher declares the same explicit frontend contract', () => {
  const launch = JSON.parse(readFileSync(resolve(ROOT, '.claude/launch.json'), 'utf8'));
  const web = launch.configurations.find((entry) => entry.name === 'web');

  assert.equal(web.port, 5173);
  assert.equal(web.autoPort, false);
  assert.deepEqual(web.env, {
    VITE_PORT: '5173',
    VITE_API_PROXY_TARGET: DEFAULT_API_PROXY_TARGET,
  });
});
