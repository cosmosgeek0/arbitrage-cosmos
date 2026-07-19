#!/usr/bin/env node
// Loads a systemd credential JSON file into the current Node process and then
// imports the accepted application entrypoint. Secret values are never logged.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { fail } from '../lib.mjs';

// F-016: the composition root deliberately loads no private credential in the
// validate-only release (index.ts returns null unconditionally), so a HARD
// credential requirement here blocked boot on credentials the app never
// reads. Keyless is a legal posture: proceed and say so. When credential
// fields ARE supplied, the original strict validation applies unchanged and
// still fails closed on malformed values.
const CREDENTIAL_KEYS = ['BINANCE_API_KEY', 'BINANCE_API_SECRET'];
const directory = process.env.CREDENTIALS_DIRECTORY;
let secret = null;
if (directory) {
  try { secret = JSON.parse(readFileSync(resolve(directory, 'app-secrets'), 'utf8')); } catch {
    secret = null;
  }
}
const supplied = secret !== null && CREDENTIAL_KEYS.some((key) => secret[key] !== undefined);
if (supplied) {
  for (const key of CREDENTIAL_KEYS) {
    const value = secret[key];
    if (typeof value !== 'string' || value.length < 8 || value.length > 4096 || /[\r\n\0]/.test(value)) {
      fail(`required credential field ${key} is unavailable or malformed`);
    }
    process.env[key] = value;
  }
} else {
  process.stderr.write('app-entrypoint: keyless posture - no Binance credential supplied; the validate-only composition root reads no private credential (F-016)\n');
}
secret = null;
await import(pathToFileURL(resolve(process.cwd(), 'server/dist/index.js')).href);
