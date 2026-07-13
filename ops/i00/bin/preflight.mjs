#!/usr/bin/env node
import { lstatSync } from 'node:fs';
import { resolve } from 'node:path';
import { fail, hasPlaceholder, isUtc, listRegularFiles, parseArgs, readJson, requireKeys } from '../lib.mjs';

const args = parseArgs(process.argv.slice(2));
for (const key of ['release', 'host', 'supervisor', 'mode', 'now', 'max-host-age-sec', 'max-supervisor-age-sec', 'required-supervisor-window-sec']) {
  if (!args[key]) fail(`--${key} is required`);
}
if (!['deploy', 'rollback'].includes(args.mode)) fail('--mode must be deploy or rollback');

const release = readJson(resolve(args.release, 'release.json'), 'release.json');
const host = readJson(args.host, 'host preflight');
const supervisor = readJson(args.supervisor, 'supervisor readback');
requireKeys(host, ['source', 'account', 'targetHost', 'environment', 'freeBytes', 'backupReserveBytes', 'sqliteVersion', 'evidenceSha256', 'observedAtUtc'], 'host preflight');
requireKeys(supervisor, ['source', 'observedAtUtc', 'validUntilUtc', 'deploymentFrozen', 'exposureState', 'ambiguityState', 'recoveryState', 'currentSchemaVersion', 'rollbackFloor'], 'supervisor readback');
const nowMs = Date.parse(args.now);
const hostObservedMs = Date.parse(host.observedAtUtc);
const supervisorObservedMs = Date.parse(supervisor.observedAtUtc);
const validUntilMs = Date.parse(supervisor.validUntilUtc);
const maxHostAgeMs = Number(args['max-host-age-sec']) * 1000;
const maxSupervisorAgeMs = Number(args['max-supervisor-age-sec']) * 1000;
const requiredWindowMs = Number(args['required-supervisor-window-sec']) * 1000;
if (![args.now, host.observedAtUtc, supervisor.observedAtUtc, supervisor.validUntilUtc].every(isUtc)
    || ![nowMs, hostObservedMs, supervisorObservedMs, validUntilMs, maxHostAgeMs, maxSupervisorAgeMs, requiredWindowMs].every(Number.isFinite)
    || maxHostAgeMs <= 0 || maxSupervisorAgeMs <= 0 || requiredWindowMs <= 0) fail('preflight times/windows are invalid');
if (hostObservedMs > nowMs || nowMs - hostObservedMs > maxHostAgeMs) fail('host preflight is stale or future-dated');
if (host.source !== 'TARGET_HOST_OWNER_READBACK' || hasPlaceholder(host.account) || hasPlaceholder(host.targetHost)
    || !/^[0-9a-f]{64}$/.test(host.evidenceSha256)) fail('host preflight is not exact owner readback evidence');
if (supervisor.source !== 'CANONICAL_SUPERVISOR_READBACK') fail('supervisor source is not canonical readback');
if (supervisorObservedMs > nowMs || nowMs - supervisorObservedMs > maxSupervisorAgeMs
    || validUntilMs <= supervisorObservedMs || validUntilMs - nowMs < requiredWindowMs) {
  fail('supervisor readback is stale or its lease is too short for the operation');
}

for (const field of ['freeBytes', 'backupReserveBytes']) {
  if (!Number.isSafeInteger(host[field]) || host[field] < 0) fail(`host preflight ${field} must be a non-negative safe integer`);
}
const releaseBytes = listRegularFiles(resolve(args.release)).reduce((total, file) => total + lstatSync(resolve(args.release, file)).size, 0);
const requiredBytes = releaseBytes * 2 + host.backupReserveBytes;
if (host.freeBytes < requiredBytes) fail(`insufficient disk: free=${host.freeBytes} required=${requiredBytes}`);
if (supervisor.deploymentFrozen !== false) fail('canonical supervisor reports deployment frozen');
if (supervisor.exposureState !== 'NONE') fail(`deployment freezes on exposureState=${supervisor.exposureState}`);
if (supervisor.ambiguityState !== 'NONE') fail(`deployment freezes on ambiguityState=${supervisor.ambiguityState}`);
if (supervisor.recoveryState !== 'NONE') fail(`deployment freezes on recoveryState=${supervisor.recoveryState}`);
if (!Number.isInteger(supervisor.currentSchemaVersion) || !Number.isInteger(supervisor.rollbackFloor)) {
  fail('canonical schema readback must contain integer currentSchemaVersion and rollbackFloor');
}
if (release.schemaVersion < supervisor.rollbackFloor) {
  fail(`candidate schema ${release.schemaVersion} is below rollback floor ${supervisor.rollbackFloor}`);
}
if (args.mode === 'rollback' && release.schemaVersion > supervisor.currentSchemaVersion) {
  fail('rollback candidate cannot be newer than the current schema');
}

process.stdout.write(`${JSON.stringify({
  status: 'PREFLIGHT_PASS_NO_MUTATION',
  mode: args.mode,
  releaseId: release.releaseId,
  requiredBytes,
  targetHost: host.targetHost,
  account: host.account,
  releaseBytes,
  environment: host.environment,
  supervisorValidUntilUtc: supervisor.validUntilUtc,
  blocker: null,
})}\n`);
