#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { fail, hasPlaceholder, isFullSha, parseArgs } from '../lib.mjs';

const args = parseArgs(process.argv.slice(2));
if (!args.env) fail('--env is required');
const values = {};
const lines = readFileSync(resolve(args.env), 'utf8').split(/\r?\n/);
for (let index = 0; index < lines.length; index += 1) {
  const line = lines[index].trim();
  if (!line || line.startsWith('#')) continue;
  const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
  if (!match) fail(`invalid env syntax at line ${index + 1}`);
  if (match[1] in values) fail(`duplicate env key ${match[1]}`);
  if (/(?:SECRET|TOKEN|PASSWORD|PRIVATE_KEY|API_KEY|CREDENTIAL)/.test(match[1])
      || /^(?:AWS_PROFILE|AWS_SESSION_TOKEN|AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY)$/.test(match[1])) {
    fail(`secret value key ${match[1]} is forbidden in the non-secret env file`);
  }
  values[match[1]] = match[2];
}
const required = [
  'HOST', 'PORT', 'DATA_DIR', 'EVIDENCE_DIR', 'MODEL_DIR', 'BACKUP_DIR',
  'CONTROL_ROOM_OPERATOR_EMAIL', 'CF_ACCESS_TEAM_DOMAIN', 'CF_ACCESS_AUD',
  'I00_TESTED_SHA', 'I00_CONFIG_REVISION', 'I00_MODEL_REVISION',
  'I00_PUBLIC_SOURCE_STARTUP_EGRESS',
];
for (const key of required) {
  if (!values[key] || hasPlaceholder(values[key])) fail(`required config ${key} is missing or unresolved`);
}
if (values.HOST !== '127.0.0.1') fail('HOST must remain exactly 127.0.0.1');
if (!/^\d+$/.test(values.PORT) || Number(values.PORT) < 1024 || Number(values.PORT) > 65535) fail('PORT is invalid');
const paths = ['DATA_DIR', 'EVIDENCE_DIR', 'MODEL_DIR', 'BACKUP_DIR'].map((key) => values[key]);
if (paths.some((path) => !isAbsolute(path)) || new Set(paths).size !== paths.length) {
  fail('durable data/evidence/model/backup paths must be distinct absolute paths');
}
if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(values.CONTROL_ROOM_OPERATOR_EMAIL)) fail('operator email is invalid');
if (!/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(values.CF_ACCESS_TEAM_DOMAIN)) fail('Cloudflare Access team domain is invalid');
if (!/^[A-Za-z0-9_-]{8,256}$/.test(values.CF_ACCESS_AUD)) fail('Cloudflare Access audience is invalid');
if (!isFullSha(values.I00_TESTED_SHA)) fail('I00_TESTED_SHA must be a full Git SHA');
if (values.I00_PUBLIC_SOURCE_STARTUP_EGRESS !== '1') {
  fail('I00_PUBLIC_SOURCE_STARTUP_EGRESS must be exactly 1');
}
if ('I00_DETERMINISTIC_OFFLINE_PUBLIC_SOURCES' in values) {
  fail('I00_DETERMINISTIC_OFFLINE_PUBLIC_SOURCES is forbidden in activation config');
}
if (args['expected-sha'] && values.I00_TESTED_SHA !== args['expected-sha']) fail('runtime config tested SHA does not match the candidate release');

process.stdout.write(`${JSON.stringify({ status: 'CONFIG_VALID_NO_SECRETS', host: values.HOST, port: Number(values.PORT), testedSha: values.I00_TESTED_SHA })}\n`);
