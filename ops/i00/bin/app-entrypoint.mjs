#!/usr/bin/env node
// Loads a systemd credential JSON file into the current Node process and then
// imports the accepted application entrypoint. Secret values are never logged.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { fail } from '../lib.mjs';

const directory = process.env.CREDENTIALS_DIRECTORY;
if (!directory) fail('CREDENTIALS_DIRECTORY is not set');
let secret;
try { secret = JSON.parse(readFileSync(resolve(directory, 'app-secrets'), 'utf8')); } catch {
  fail('app-secrets credential is unavailable or malformed');
}
for (const key of ['BINANCE_API_KEY', 'BINANCE_API_SECRET']) {
  const value = secret[key];
  if (typeof value !== 'string' || value.length < 8 || value.length > 4096 || /[\r\n\0]/.test(value)) {
    fail(`required credential field ${key} is unavailable or malformed`);
  }
  process.env[key] = value;
}
secret = null;
await import(pathToFileURL(resolve(process.cwd(), 'server/dist/index.js')).href);
