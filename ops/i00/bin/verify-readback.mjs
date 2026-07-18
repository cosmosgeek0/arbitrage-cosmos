#!/usr/bin/env node
import { fail, hasPlaceholder, isFullSha, isUtc, parseArgs, readJson, requireKeys } from '../lib.mjs';
import { compileJsonSchemaFile } from '../json-schema.mjs';

const args = parseArgs(process.argv.slice(2), new Set(['simulation-clock']));
if (!args.input || !args['max-age-sec'] || !args['expected-sha']) fail('--input, --max-age-sec, and --expected-sha are required');
if (!isFullSha(args['expected-sha'])) fail('--expected-sha must be a full Git SHA');
if (args['simulation-clock'] !== true && args.now) fail('--now is accepted only with --simulation-clock');
if (args['simulation-clock'] === true && !isUtc(args.now)) fail('simulation clock requires exact --now UTC seconds');
const effectiveNow = args['simulation-clock'] === true ? args.now : new Date().toISOString();
const value = readJson(args.input, 'deployment readback');
let structuralValidator;
try {
  structuralValidator = compileJsonSchemaFile(
    new URL('../schemas/deployment-readback.schema.json', import.meta.url),
    'deployment readback schema',
  );
} catch (error) {
  fail(`deployment readback schema compilation failed: ${error instanceof Error ? error.message : String(error)}`);
}
const structuralResult = structuralValidator(value);
if (!structuralResult.valid) fail(`deployment readback schema rejected input: ${structuralResult.error}`);
requireKeys(value, [
  'testedSha', 'deployedSha', 'releaseId', 'schemaRevision', 'configRevision', 'modelRevision',
  'services', 'origin', 'tunnel', 'access', 'watchdog', 'lastBackup', 'lastRestoreDrill',
  'rollbackCandidate', 'currentDeploymentBlocker', 'observedAtUtc',
], 'deployment readback');
if (!isFullSha(value.testedSha)) fail('testedSha must be a full Git SHA');
if (value.testedSha !== args['expected-sha']) fail('testedSha does not match --expected-sha');
if (value.deployedSha !== null && !isFullSha(value.deployedSha)) fail('deployedSha must be null or a full Git SHA');
if (value.deployedSha !== null && value.deployedSha !== args['expected-sha']) fail('deployedSha does not match --expected-sha');
if (!isUtc(value.observedAtUtc)) fail('observedAtUtc must be exact UTC seconds');
const ageMs = Date.parse(effectiveNow) - Date.parse(value.observedAtUtc);
const maxAgeMs = Number(args['max-age-sec']) * 1000;
if (!Number.isFinite(ageMs) || !Number.isFinite(maxAgeMs) || maxAgeMs <= 0 || ageMs < 0 || ageMs > maxAgeMs) {
  fail('deployment readback is stale or future-dated');
}
if (!Array.isArray(value.services) || value.services.length === 0) fail('services must be a non-empty array');
for (const service of value.services) {
  requireKeys(service, ['id', 'state', 'source'], 'service readback');
  if (hasPlaceholder(service.id) || !['READY', 'DEGRADED', 'BLOCKED', 'NOT_CONFIGURED', 'FAILED'].includes(service.state)
      || !['READBACK', 'NOT_CONFIGURED'].includes(service.source)) {
    fail('service readback must be sourced from READBACK or explicitly NOT_CONFIGURED');
  }
  if ((service.source === 'NOT_CONFIGURED') !== (service.state === 'NOT_CONFIGURED')) fail('service state/source are contradictory');
}
if (value.deployedSha === null && value.currentDeploymentBlocker === null) {
  fail('a not-deployed artifact must name its deployment blocker');
}
if (value.deployedSha !== null && value.releaseId !== `i00-${value.deployedSha}`) {
  fail('deployed releaseId must be keyed by deployedSha');
}
for (const field of ['origin', 'tunnel', 'access', 'watchdog']) {
  requireKeys(value[field], ['state', 'source'], field);
  if (!['READBACK', 'NOT_CONFIGURED'].includes(value[field].source)) fail(`${field}.source is not canonical readback`);
  if ((value[field].source === 'NOT_CONFIGURED') !== (value[field].state === 'NOT_CONFIGURED')) fail(`${field} state/source are contradictory`);
}

if (value.deployedSha === null) {
  if (value.services.some((service) => service.source !== 'NOT_CONFIGURED')
      || ['origin', 'tunnel', 'access', 'watchdog'].some((field) => value[field].source !== 'NOT_CONFIGURED')) {
    fail('artifact-only readback cannot claim target readback');
  }
} else {
  if (value.currentDeploymentBlocker !== null) fail('proved deployment cannot retain a deployment blocker');
  if (value.services.some((service) => service.source !== 'READBACK' || service.state !== 'READY')) fail('proved deployment requires every declared service READY from READBACK');
  const expectedStates = { origin: 'PRIVATE', tunnel: 'HEALTHY', access: 'ENFORCED', watchdog: 'HEALTHY' };
  for (const [field, state] of Object.entries(expectedStates)) {
    if (value[field].source !== 'READBACK' || value[field].state !== state) fail(`proved deployment requires ${field}=${state} from READBACK`);
  }
  for (const [field, status] of [['lastBackup', 'BACKUP_VERIFIED'], ['lastRestoreDrill', 'ISOLATED_DRILL_PASS']]) {
    requireKeys(value[field], ['status', 'recordedAtUtc', 'receiptSha256'], field);
    if (value[field].status !== status || !isUtc(value[field].recordedAtUtc) || !/^[0-9a-f]{64}$/.test(value[field].receiptSha256)) {
      fail(`proved deployment requires hashed ${field} proof`);
    }
  }
  if (!isFullSha(value.rollbackCandidate)) fail('proved deployment requires a full-SHA rollback candidate');
}

process.stdout.write(`${JSON.stringify({
  status: 'DEPLOYMENT_READBACK_VALID',
  testedSha: value.testedSha,
  deployedSha: value.deployedSha,
  releaseId: value.releaseId,
  blocker: value.currentDeploymentBlocker,
  observedAtUtc: value.observedAtUtc,
  deployed: value.deployedSha !== null,
})}\n`);
