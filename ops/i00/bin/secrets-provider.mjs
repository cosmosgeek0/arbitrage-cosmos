#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fail, hasPlaceholder, parseArgs, readJson, requireKeys } from '../lib.mjs';
import { isWithinSimulationRoot } from '../simulation-safety.mjs';

const args = parseArgs(process.argv.slice(2), new Set(['simulation']));
for (const key of ['config', 'output']) if (!args[key]) fail(`--${key} is required`);
const config = readJson(args.config, 'Secrets Manager provider config');
requireKeys(config, [
  'schemaVersion', 'secretArn', 'region', 'requiredKeys', 'targetHost', 'environment',
  'resultReceiptTarget', 'reconciliationReceiptTarget',
], 'Secrets Manager provider config');
if (hasPlaceholder(config.secretArn) || !/^arn:aws:secretsmanager:[a-z0-9-]+:\d{12}:secret:[A-Za-z0-9/_+=.@-]+-[A-Za-z0-9]{6}$/.test(config.secretArn)) {
  fail('secretArn must be one exact, fully suffixed Secrets Manager ARN');
}
if (hasPlaceholder(config.region) || !/^[a-z]{2}(?:-gov)?-[a-z]+-\d$/.test(config.region)) fail('provider region is invalid');
if (!Array.isArray(config.requiredKeys) || config.requiredKeys.length === 0) fail('requiredKeys must be non-empty');
for (const variable of ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN', 'AWS_PROFILE']) {
  if (process.env[variable]) fail(`static or ambient AWS credential source ${variable} is forbidden`);
}
if (!args.simulation) {
  if (!args.authorization) fail('real provider mode requires --authorization');
  if (args.now) fail('real provider mode does not accept a caller clock');
  const account = config.secretArn.split(':')[4];
  const authorizationBase = [
    resolve(dirname(fileURLToPath(import.meta.url)), 'validate-authorization.mjs'),
    '--input', args.authorization, '--class', 'SECRET_MATERIALIZATION',
    '--command', 'secrets-provider', '--expected-host', config.targetHost,
    '--expected-environment', config.environment,
    '--expected-scope', 'cosmos-production-secret-materialization',
    '--expected-account', `aws:${account}`,
    '--expected-product', 'AWS Secrets Manager',
    '--expected-credential-type', 'AWS_INSTANCE_PROFILE_ROLE',
    '--expected-permission', 'secretsmanager:GetSecretValue',
    '--expected-result-receipt', config.resultReceiptTarget,
    '--expected-reconciliation-receipt', config.reconciliationReceiptTarget,
    '--expected-maximum-capital', 'ZERO', '--expected-maximum-notional', 'ZERO',
    '--expected-maximum-effect', 'read one exact secret version into one exact 0600 runtime credential',
  ];
  for (const endpoint of [config.secretArn, resolve(args.output)]) {
    const check = spawnSync(process.execPath, [...authorizationBase, '--expected-endpoint', endpoint], { encoding: 'utf8' });
    if (check.status !== 0) fail('external authorization rejected for exact secret materialization scope');
  }
}

let aws = process.env.AWS_CLI;
if (!aws) fail('AWS_CLI provider command is not configured');
if (args.simulation) {
  if (!args['simulation-root']) fail('simulation provider requires --simulation-root');
  let outputSafe = false;
  try { outputSafe = isWithinSimulationRoot(args['simulation-root'], args.output); } catch { outputSafe = false; }
  if (!outputSafe) fail('simulation credential output must remain below the marked fake root');
  const checked = spawnSync(process.execPath, [
    resolve(dirname(fileURLToPath(import.meta.url)), 'verify-simulation-command.mjs'),
    '--root', args['simulation-root'], '--command', aws,
  ], { encoding: 'utf8' });
  if (checked.status !== 0) fail('simulation AWS_CLI is outside the declared fake root');
  aws = checked.stdout.trim();
}
const fetched = spawnSync(aws, [
  'secretsmanager', 'get-secret-value', '--secret-id', config.secretArn,
  '--region', config.region, '--version-stage', 'AWSCURRENT', '--query', 'SecretString',
  '--output', 'text', '--no-cli-pager',
], { encoding: 'utf8', maxBuffer: 1024 * 1024 });
if (fetched.status !== 0) fail('Secrets Manager provider failed without disclosing output');
let secret;
try { secret = JSON.parse(fetched.stdout); } catch { fail('Secrets Manager response was not a JSON object'); }
if (!secret || typeof secret !== 'object' || Array.isArray(secret)) fail('Secrets Manager response was not a JSON object');
const materialized = {};
for (const key of config.requiredKeys) {
  if (!/^[A-Z][A-Z0-9_]*$/.test(key)) fail('required secret key name is invalid');
  const value = secret[key];
  if (typeof value !== 'string' || value.length < 8 || value.length > 4096 || /[\r\n\0]/.test(value)) {
    fail(`required secret field ${key} is missing or malformed`);
  }
  materialized[key] = value;
}

const output = resolve(args.output);
mkdirSync(dirname(output), { recursive: true, mode: 0o700 });
const temporary = `${output}.partial.${process.pid}`;
writeFileSync(temporary, `${JSON.stringify(materialized)}\n`, { mode: 0o600, flag: 'wx' });
chmodSync(temporary, 0o600);
renameSync(temporary, output);
process.stdout.write(`${JSON.stringify({ status: 'SECRET_MATERIALIZED_WITHOUT_DISCLOSURE', keyCount: Object.keys(materialized).length, output })}\n`);
