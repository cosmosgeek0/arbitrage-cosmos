import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  ALLOWED_SCENARIO_OWNER_CLAIM_HASHES,
  ALLOWED_SNAPSHOT_OWNER_CLAIM_HASHES,
  createPortfolioSnapshot,
  createScenarioEvaluationInput,
  materializeAcceptanceCampaign,
} from '../src/index.mjs';
import { baseSnapshot, scenarioInput, unknown } from './helpers.mjs';

async function json(relativeUrl) {
  return JSON.parse(await readFile(new URL(relativeUrl, import.meta.url), 'utf8'));
}

function sorted(values) {
  return [...values].sort();
}

function expandSubjects(template, prefix, count) {
  return Array.from({ length: count }, (_, index) => ({
    ...structuredClone(template),
    id: `${prefix}.${index}`,
    assetId: `ASSET_${prefix}_${index}`,
    sectorId: `SECTOR_${prefix}_${index}`,
    venueId: `VENUE_${prefix}_${index}`,
    collateralId: `COLLATERAL_${prefix}_${index}`,
    strategyId: `STRATEGY_${prefix}_${index}`,
    sourceRevision: `${prefix}-r${index}`,
  }));
}

function deriveSnapshotClaims() {
  const recipes = [
    ['base', () => baseSnapshot()],
    ['partial-unknown-proposal', () => {
      const input = baseSnapshot();
      input.truthState = 'PARTIAL';
      input.missingDependencies = ['PROPOSAL_CAPACITY_UNAVAILABLE'];
      input.proposals[0].exposure = unknown('PROPOSAL_CAPACITY_UNAVAILABLE');
      return input;
    }],
    ['stale-account-truth', () => {
      const input = baseSnapshot();
      input.truthState = 'STALE';
      input.missingDependencies = ['ACCOUNT_TRUTH_STALE'];
      return input;
    }],
    ['ambiguous-factor-endpoint', () => {
      const input = baseSnapshot();
      input.factorLinks.push({
        leftId: 'USDT', rightId: 'BTC', factorId: 'AMBIGUOUS_USDT', dependencePpm: 250000,
        sourceRef: input.ownerSnapshotRefs[2],
      });
      return input;
    }],
    ['graph-resource-bound', () => {
      const input = baseSnapshot();
      input.positions = expandSubjects(input.positions[0], 'position.bound', 512);
      input.proposals = expandSubjects(input.proposals[0], 'proposal.bound', 512);
      input.strategyClusters = [];
      input.factorLinks = [];
      return input;
    }],
  ];
  return recipes.map(([label, recipe]) => {
    const snapshot = createPortfolioSnapshot(recipe());
    return { label, snapshot, claimHash: snapshot.ownerClaimHash };
  });
}

function deriveHostileScenarioClaims(base, stale) {
  const recipes = [
    ['base', (input) => input],
    ['missing-input', (input) => {
      input.scenarioKind = 'SCENARIO_INPUT_MISSING';
      input.evaluationId = 'evaluation.missing-input';
      input.sweepInputs[3] = { ...input.sweepInputs[3], state: 'UNKNOWN', value: null };
      input.missingDependencies = ['BORROW_CAPACITY_UNAVAILABLE'];
      input.uncertainty = {
        ...input.uncertainty,
        state: 'UNKNOWN', lowerAtoms: null, upperAtoms: null,
        method: 'UNAVAILABLE_WITH_MISSING_CANONICAL_INPUT',
      };
      return input;
    }],
    ['stale-snapshot-context', (input) => {
      input.snapshotHash = stale.snapshotHash;
      input.snapshotOwnerClaimHash = stale.ownerClaimHash;
      return input;
    }],
    ['known-zero-impact', (input) => {
      input.evaluationId = 'evaluation.known-zero';
      input.impacts[0].delta.atoms = '0';
      input.impacts[0].lowerBound.atoms = '0';
      input.impacts[0].upperBound.atoms = '0';
      return input;
    }],
    ['unknown-impact', (input) => {
      input.evaluationId = 'evaluation.unknown-impact';
      input.impacts[0].delta = unknown('IMPACT_NOT_SUPPLIED');
      input.impacts[0].lowerBound = unknown('IMPACT_NOT_SUPPLIED');
      input.impacts[0].upperBound = unknown('IMPACT_NOT_SUPPLIED');
      return input;
    }],
    ['latency-campaign-row', (input) => {
      input.evaluationId = 'evaluation.latency-spike';
      input.scenarioKind = 'LATENCY_SPIKE';
      input.scenarioReference.scenarioId = 'f12.latency-spike';
      input.seed = 99;
      input.scenarioReference.seed = 99;
      return input;
    }],
    ['dangling-subject-hostile-proof', (input) => {
      input.impacts[0].subjectId = 'position.not-present';
      return input;
    }],
  ];
  return recipes.map(([label, mutate]) => {
    const evaluation = createScenarioEvaluationInput(mutate(scenarioInput(base.snapshotHash)));
    return { label, evaluationId: evaluation.evaluationId, claimHash: evaluation.ownerClaimHash };
  });
}

test('finite owner claim allowlists derive only from labeled packet-local fixture sources', async () => {
  const snapshotClaims = deriveSnapshotClaims();
  assert.equal(new Set(snapshotClaims.map((row) => row.label)).size, 5);
  assert.equal(new Set(snapshotClaims.map((row) => row.claimHash)).size, 5);
  assert.deepEqual(sorted(snapshotClaims.map((row) => row.claimHash)), ALLOWED_SNAPSHOT_OWNER_CLAIM_HASHES);

  const base = snapshotClaims.find((row) => row.label === 'base').snapshot;
  const stale = snapshotClaims.find((row) => row.label === 'stale-account-truth').snapshot;
  const hostileClaims = deriveHostileScenarioClaims(base, stale);
  assert.equal(new Set(hostileClaims.map((row) => row.label)).size, 7);
  assert.equal(new Set(hostileClaims.map((row) => row.claimHash)).size, 7);

  const snapshotFixture = await json('../fixtures/portfolio-snapshot.v1.json');
  const corpus = await json('../fixtures/acceptance-corpus.v1.json');
  const { campaign } = materializeAcceptanceCampaign(snapshotFixture, corpus, 1784161200000);
  const corpusClaims = campaign.evaluationInputs.map((row) => ({
    label: `corpus:${row.evaluationId}`,
    evaluationId: row.evaluationId,
    claimHash: row.ownerClaimHash,
  }));
  assert.equal(corpusClaims.length, 20);
  assert.equal(new Set(corpusClaims.map((row) => row.label)).size, 20);
  assert.equal(new Set(corpusClaims.map((row) => row.claimHash)).size, 20);

  const derivedScenarioClaims = [...corpusClaims, ...hostileClaims];
  assert.equal(new Set(derivedScenarioClaims.map((row) => row.claimHash)).size, 27);
  assert.deepEqual(sorted(derivedScenarioClaims.map((row) => row.claimHash)), ALLOWED_SCENARIO_OWNER_CLAIM_HASHES);
});
