import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import {
  canonicalize,
  createExtensionDescriptor,
  sha256,
} from '../../dock/src/index.mjs';
import {
  createProductSurfaceProjection,
  evaluateTournament,
} from '../src/index.mjs';
import {
  L_SHA,
  Q_SHA,
  baseTournament,
  qAuthority,
} from './fixtures.mjs';
import { strategyArenaSchema } from './schema-fixture.mjs';

const REPO = new URL('../../..', import.meta.url).pathname;
const SAFE_Q_SLICES = JSON.parse(readFileSync(new URL('../fixtures/q-validation-owner-slices.v1.json', import.meta.url), 'utf8'));

function pointerValue(value, pointer) {
  return pointer.split('/').slice(1).reduce((current, segment) => current[segment.replaceAll('~1', '/').replaceAll('~0', '~')], value);
}

function rawSha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function gitResolver(reference) {
  const match = /^git:([a-f0-9]{40}):([^#]+)(?:#(.+))?$/.exec(reference.ref);
  if (match === null) throw new TypeError(`invalid immutable ref ${reference.ref}`);
  const [, commit, path, pointer] = match;
  if (commit === SAFE_Q_SLICES.source.commit && path === SAFE_Q_SLICES.source.path) {
    const normalizedPointer = pointer ?? null;
    if (normalizedPointer !== null && !Object.hasOwn(SAFE_Q_SLICES.projections, normalizedPointer)) throw new TypeError(`unsafe Q14 projection requested: ${normalizedPointer}`);
    const projectionValue = normalizedPointer === null ? undefined : structuredClone(SAFE_Q_SLICES.projections[normalizedPointer]);
    return {
      gitObjectSha: SAFE_Q_SLICES.source.gitObjectSha,
      contentSha256: SAFE_Q_SLICES.source.contentSha256,
      projectionSha256: normalizedPointer === null ? null : sha256(`${canonicalize(projectionValue)}\n`),
      projectionValue,
    };
  }
  const gitObjectSha = execFileSync('git', ['rev-parse', `${commit}:${path}`], { cwd: REPO, encoding: 'utf8' }).trim();
  const kind = execFileSync('git', ['cat-file', '-t', gitObjectSha], { cwd: REPO, encoding: 'utf8' }).trim();
  const bytes = kind === 'tree'
    ? execFileSync('git', ['ls-tree', '-r', `${commit}:${path}`], { cwd: REPO })
    : execFileSync('git', ['show', `${commit}:${path}`], { cwd: REPO });
  let projectionValue;
  let projectionSha256 = null;
  if (pointer?.startsWith('/')) {
    const source = JSON.parse(execFileSync('git', ['show', `${commit}:${path}`], { cwd: REPO, encoding: 'utf8' }));
    projectionValue = pointerValue(source, pointer);
    projectionSha256 = sha256(`${canonicalize(projectionValue)}\n`);
  }
  return { gitObjectSha, contentSha256: rawSha256(bytes), projectionSha256, projectionValue };
}

const campaign = baseTournament().campaign;
const report = evaluateTournament(campaign, gitResolver);
const descriptorInput = JSON.parse(readFileSync(new URL('../contracts/v1/extension-descriptor.v1.json', import.meta.url), 'utf8'));
delete descriptorInput.descriptorHash;
descriptorInput.dataSourceRefs = [
  'frontier/strategy-arena/fixtures/tournament-campaign.v1.json',
  'frontier/strategy-arena/fixtures/q-validation-owner-slices.v1.json',
  `git:${Q_SHA}:quant/generated/q14/q14_validation_golden_v1.json#/plan/spec`,
  `git:${Q_SHA}:quant/generated/q15/registry_cards.v1.json#/experimentCard`,
  `git:${L_SHA}:server/src/liveEdge/adapters/exchangeTwin/types.ts`,
];
descriptorInput.failureModes = [
  'FAIL_CLOSED_ON_OWNER_REF_HASH_OR_Q_SEMANTIC_MISMATCH',
  'FINAL_HOLDOUT_UNSUPPORTED_WITHOUT_NEW_Q_GRANT_AND_REPLAY_BUNDLE',
  'CAMPAIGN_BOUND_Q_SELECTION_BUNDLE_MISSING',
  'ABSTAIN_UNKNOWN_ON_REQUIRED_METRIC_UNAVAILABLE',
  'REQUEST_DEGRADATION_ON_RESOURCE_LIMIT',
];
descriptorInput.replayClass = 'SYNTHETIC_WALK_FORWARD_FIXTURE_ONLY';
descriptorInput.knownLimitations = [
  'RESEARCH_ONLY',
  'NO_REGISTRY_AUTHORITY',
  'NO_PROMOTION_AUTHORITY',
  'NO_EXECUTION',
  'NO_PRODUCTION_ISOLATION_OR_RUNTIME_SAFETY_PROOF',
  'FINAL_HOLDOUT_NOT_IMPLEMENTED_REQUIRES_NEW_Q_GRANT_AND_REPLAY_BUNDLE',
  'CAMPAIGN_BOUND_WHOLE_STRATEGY_SELECTION_PRESSURE_UNAVAILABLE',
  'OWNER_REFERENCE_RESOLUTION_IS_CALLER_ATTESTED_NOT_SOURCE_BYTE_VERIFIED_AT_RUNTIME',
];

process.stdout.write(JSON.stringify({
  schema: strategyArenaSchema(),
  qAuthority: qAuthority(),
  campaign,
  report,
  productSurface: createProductSurfaceProjection(report, campaign, gitResolver),
  descriptor: createExtensionDescriptor(descriptorInput),
}));
