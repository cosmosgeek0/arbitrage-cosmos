import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve(import.meta.dirname, '..', '..', '..');

test('fresh static imports load .env before every durable cache captures DATA_DIR', () => {
  const cwd = mkdtempSync(path.join(os.tmpdir(), 'cosmos-dotenv-authority-'));
  const dataDir = path.join(cwd, 'dotenv-data');
  writeFileSync(path.join(cwd, '.env'), `DATA_DIR=${dataDir}\n`, { mode: 0o600 });

  const moduleUrls = [
    'server/dist/binance/icons.js',
    'server/dist/binance/liquidations.js',
    'server/dist/binance/profile.js',
    'server/dist/services/newsContext.js',
  ].map((relativePath) => pathToFileURL(path.join(ROOT, relativePath)).href);
  const authorityUrl = pathToFileURL(
    path.join(ROOT, 'server/dist/bootstrap/environment.js'),
  ).href;
  const probe = `
    for (const url of ${JSON.stringify(moduleUrls)}) await import(url);
    const { DATA_DIR_AUTHORITY } = await import(${JSON.stringify(authorityUrl)});
    process.stdout.write('AUTHORITY=' + JSON.stringify(DATA_DIR_AUTHORITY));
  `;
  const env = { ...process.env };
  for (const name of [
    'DATA_DIR',
    'ICON_CACHE',
    'LIQ_CACHE',
    'PROFILE_CACHE',
    'SKIP_DOTENV',
  ]) {
    delete env[name];
  }

  try {
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', probe], {
      cwd,
      env,
      encoding: 'utf8',
      timeout: 10_000,
    });
    assert.equal(child.status, 0, child.stderr || child.stdout);
    const marker = child.stdout.indexOf('AUTHORITY=');
    assert.notEqual(marker, -1, child.stdout);
    const authority = JSON.parse(child.stdout.slice(marker + 'AUTHORITY='.length));
    const physicalDataDir = realpathSync.native(dataDir);
    assert.deepEqual(authority, {
      dataDir: physicalDataDir,
      iconCache: path.join(physicalDataDir, 'icon_cache.json'),
      liquidationCache: path.join(physicalDataDir, 'liquidations.json'),
      profileCache: path.join(physicalDataDir, 'profile_cache.json'),
      newsArchive: path.join(physicalDataDir, 'news-archive.json'),
    });
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
