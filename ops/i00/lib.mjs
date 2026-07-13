import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

export function fail(message, code = 1) {
  process.stderr.write(`I00_OPS_BLOCKED: ${message}\n`);
  process.exit(code);
}

export function readJson(path, label = path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    fail(`${label} is not valid JSON: ${error.message}`);
  }
}

export function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

export function isFullSha(value) {
  return typeof value === 'string' && /^[0-9a-f]{40}$/.test(value);
}

export function isUtc(value) {
  return typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value)
    && Number.isFinite(Date.parse(value));
}

export function parseArgs(argv, flags = new Set()) {
  const out = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith('--')) fail(`unexpected argument ${key}`);
    if (flags.has(key) || flags.has(key.slice(2))) {
      out[key.slice(2)] = true;
      continue;
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) fail(`${key} requires a value`);
    out[key.slice(2)] = value;
    index += 1;
  }
  return out;
}

export function listRegularFiles(root, relative = '') {
  const absolute = resolve(root, relative);
  const stat = lstatSync(absolute);
  if (stat.isSymbolicLink()) fail(`symlink is forbidden in release material: ${relative || '.'}`);
  if (stat.isFile()) return [relative];
  if (!stat.isDirectory()) fail(`unsupported release entry: ${relative || '.'}`);
  return readdirSync(absolute).sort().flatMap((name) => (
    listRegularFiles(root, relative ? `${relative}/${name}` : name)
  ));
}

export function treeDigest(root) {
  const hash = createHash('sha256');
  for (const file of listRegularFiles(root)) {
    hash.update(file);
    hash.update('\0');
    hash.update(sha256File(resolve(root, file)));
    hash.update('\n');
  }
  return hash.digest('hex');
}

export function requireKeys(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object`);
  for (const key of keys) {
    if (!(key in value)) fail(`${label}.${key} is required`);
  }
}

export function hasPlaceholder(value) {
  return /REPLACE_ME|CHANGEME|example\.com|000000000000/.test(String(value));
}
