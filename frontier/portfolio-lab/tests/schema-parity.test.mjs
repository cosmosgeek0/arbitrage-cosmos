import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  ALLOWED_SCENARIO_OWNER_CLAIM_HASHES,
  ALLOWED_SNAPSHOT_OWNER_CLAIM_HASHES,
  FIXED_OWNER_CONTRACT_REFS,
  FIXED_OWNER_OUTPUT_REFS,
  OWNER_EVIDENCE_HASH,
  evaluatePortfolioCampaign,
  materializeAcceptanceCampaign,
  projectPortfolioLabCockpit,
} from '../src/index.mjs';

async function json(relativeUrl) {
  return JSON.parse(await readFile(new URL(relativeUrl, import.meta.url), 'utf8'));
}

function refName(node) {
  return node.$ref?.split('/').at(-1) ?? null;
}

function prefixConstants(defs, definition) {
  return definition.prefixItems.map((row) => defs[refName(row)].const);
}

function ownerMapFromBranches(defs, branches, selectorField, ownerField) {
  const output = {};
  for (const branch of branches) {
    const ownerNode = branch.then?.properties?.[ownerField];
    const selectorNode = branch.if?.properties?.[selectorField];
    if (!ownerNode || !selectorNode) continue;
    const owner = defs[refName(ownerNode)].const;
    const values = selectorNode.enum ?? [selectorNode.const];
    values.forEach((value) => { output[value] = owner; });
  }
  return output;
}

function assertTopLevelShape(record, definition, name) {
  assert.deepEqual(
    Object.keys(record).sort(),
    Object.keys(definition.properties).sort(),
    `${name} runtime and portable top-level fields drifted`,
  );
  assert.deepEqual([...definition.required].sort(), Object.keys(definition.properties).sort(), `${name} schema fields must all be required`);
  assert.equal(definition.additionalProperties, false, `${name} must remain closed`);
}

test('portable schema pins the runtime owner evidence and exact finite claim sets', async () => {
  const schema = await json('../contracts/v1/portfolio-lab-v1.schema.json');
  const evidence = await json('../fixtures/owner-output-evidence.v1.json');
  const defs = schema.$defs;

  assert.equal(defs.OwnerEvidenceHash.const, OWNER_EVIDENCE_HASH);
  assert.equal(evidence.evidenceHash, OWNER_EVIDENCE_HASH);
  assert.deepEqual(defs.SnapshotOwnerClaimHash.enum, ALLOWED_SNAPSHOT_OWNER_CLAIM_HASHES);
  assert.deepEqual(defs.ScenarioOwnerClaimHash.enum, ALLOWED_SCENARIO_OWNER_CLAIM_HASHES);
  assert.deepEqual(evidence.allowedSnapshotOwnerClaimHashes, ALLOWED_SNAPSHOT_OWNER_CLAIM_HASHES);
  assert.deepEqual(evidence.allowedScenarioOwnerClaimHashes, ALLOWED_SCENARIO_OWNER_CLAIM_HASHES);
  assert.deepEqual(prefixConstants(defs, defs.FixedOwnerSnapshotRefs), FIXED_OWNER_OUTPUT_REFS);
  assert.deepEqual(prefixConstants(defs, defs.FixedOwnerContractRefs), FIXED_OWNER_CONTRACT_REFS);
  assert.deepEqual(evidence.records.map((row) => row.fixtureOutputRef), FIXED_OWNER_OUTPUT_REFS);
  assert.deepEqual(evidence.records.map((row) => row.canonicalOwnerContractRef), FIXED_OWNER_CONTRACT_REFS);

  const snapshot = defs.PortfolioSnapshotV1;
  assert.equal(refName(snapshot.properties.ownerEvidenceHash), 'OwnerEvidenceHash');
  assert.equal(refName(snapshot.properties.ownerClaimHash), 'SnapshotOwnerClaimHash');
  assert.equal(refName(snapshot.properties.ownerSnapshotRefs), 'FixedOwnerSnapshotRefs');
  assert.equal(refName(snapshot.properties.canonicalOwnerContractRefs), 'FixedOwnerContractRefs');
});

test('portable scenario boundary matches the unaccepted F12 runtime boundary', async () => {
  const { $defs: defs } = await json('../contracts/v1/portfolio-lab-v1.schema.json');
  const reference = defs.ScenarioReferenceV1.properties;
  const evaluation = defs.PortfolioScenarioEvaluationInputV1;

  assert.deepEqual(defs.Origin.enum, ['HYPOTHETICAL', 'SYNTHETIC']);
  assert.equal(defs.DockText1024.maxLength, 1024);
  assert.equal(refName(reference.scenarioId), 'DockText1024');
  assert.equal(reference.scenarioVersion.maxLength, 1024);
  assert.equal(reference.fixtureSchemaRef.const, 'frontier/dock/contracts/v1/dock-v1.schema.json#/$defs/ScenarioReferenceV1');
  assert.equal(reference.lineageRefs.minItems, 2);
  assert.equal(reference.lineageRefs.maxItems, 2);
  assert.equal(reference.lineageRefs.items, false);
  assert.equal(reference.lineageRefs.prefixItems[1].const, 'status:UNACCEPTED_SYNTHETIC_F12_REFERENCE_STUB');
  assert.match('fixture://portfolio-lab/unaccepted-f12-consumer-stub/corpus/case', new RegExp(reference.lineageRefs.prefixItems[0].pattern));
  assert.equal(reference.expectedCanonicalPostureRefs.prefixItems[0].$ref, '#/$defs/RiskOwnerContractRef');
  assert.ok(evaluation.required.includes('snapshotOwnerClaimHash'));
  assert.equal(refName(evaluation.properties.snapshotOwnerClaimHash), 'SnapshotOwnerClaimHash');
  assert.equal(refName(evaluation.properties.ownerEvidenceHash), 'OwnerEvidenceHash');
  assert.equal(refName(evaluation.properties.ownerClaimHash), 'ScenarioOwnerClaimHash');
});

test('portable owner attribution mappings cover every runtime fixture vocabulary value', async () => {
  const { $defs: defs } = await json('../contracts/v1/portfolio-lab-v1.schema.json');
  const byKey = Object.fromEntries([
    ['CAPITAL', defs.CapitalOwnerOutputRef.const],
    ['RISK', defs.RiskOwnerOutputRef.const],
    ['Q', defs.QOwnerOutputRef.const],
    ['L_TWIN', defs.LTwinOwnerOutputRef.const],
    ['L_RECOVERY', defs.LRecoveryOwnerOutputRef.const],
  ]);

  assert.deepEqual(ownerMapFromBranches(defs, defs.SweepInputV1.allOf, 'dimension', 'ownerRef'), {
    LIQUIDITY: byKey.L_TWIN, FUNDING: byKey.L_TWIN, FEE: byKey.L_TWIN,
    SLIPPAGE: byKey.L_TWIN, LATENCY: byKey.L_TWIN, CAPACITY: byKey.CAPITAL, BORROW: byKey.L_RECOVERY,
  });
  assert.deepEqual(ownerMapFromBranches(defs, defs.ScenarioImpactV1.allOf, 'category', 'ownerOutputRef'), {
    MARKET_MOVE: byKey.Q, LIQUIDITY: byKey.L_TWIN, FUNDING: byKey.L_TWIN, FEE: byKey.L_TWIN,
    SLIPPAGE: byKey.L_TWIN, LATENCY: byKey.L_TWIN, EXECUTION: byKey.L_TWIN,
    CAPACITY: byKey.CAPITAL, COLLATERAL: byKey.CAPITAL, BORROW: byKey.L_RECOVERY,
    LIABILITY: byKey.L_RECOVERY, RECOVERY: byKey.L_RECOVERY, OTHER: byKey.RISK,
  });
  assert.deepEqual(ownerMapFromBranches(defs, defs.StateChangeV1.allOf, 'category', 'ownerOutputRef'), {
    ACCOUNT_TRUTH_FRESHNESS: byKey.RISK, DATA_VISIBILITY: byKey.RISK,
    LIQUIDATION_DISTANCE: byKey.RISK, MARGIN_HEADROOM: byKey.RISK, RISK_POSTURE: byKey.RISK,
    BORROW_AVAILABILITY: byKey.L_RECOVERY, RECOVERY_HORIZON: byKey.L_RECOVERY,
    CONVERGENCE_STATE: byKey.L_TWIN, ONE_LEG_EXPOSURE: byKey.L_TWIN,
    OPEN_ORDER_STATE: byKey.L_TWIN, POSITION_MOBILITY: byKey.L_TWIN, VENUE_AVAILABILITY: byKey.L_TWIN,
    DECLARED_DEPENDENCE_PPM: byKey.Q, HAIRCUT_STATE: byKey.CAPITAL,
    PEG_STATE: byKey.CAPITAL, SHARED_CONTENTION: byKey.CAPITAL,
  });
  assert.equal(refName(defs.ScenarioCallerFactV1.properties.ownerOutputRef), 'RiskOwnerOutputRef');
  assert.equal(defs.ScenarioCallerFactV1.allOf[0].oneOf.length, 3);
  assert.deepEqual(defs.PortfolioScenarioEvaluationInputV1.allOf[0].then.properties.callerFacts.prefixItems
    .map((row) => row.allOf[1].properties.category.const), ['LIQUIDATION_DISTANCE', 'MARGIN_HEADROOM']);
});

test('portable schema includes exact derived-analysis completeness branches and runtime field shapes', async () => {
  const schema = await json('../contracts/v1/portfolio-lab-v1.schema.json');
  const defs = schema.$defs;
  const topLevelRefs = schema.oneOf.map(refName);
  assert.ok(topLevelRefs.includes('ScenarioRelationshipGraphV1'));
  assert.ok(topLevelRefs.includes('PortfolioConcentrationMapV1'));
  const concentrationLaws = JSON.stringify(defs.ConcentrationDimensionV1.allOf);
  for (const marker of ['UNKNOWN_MEMBERS_PREVENT_TOTAL_AND_HHI', 'FLOOR_TO_PPM', '^[1-9][0-9]{0,95}$', '"const":"0"']) {
    if (marker === 'UNKNOWN_MEMBERS_PREVENT_TOTAL_AND_HHI') continue;
    assert.ok(concentrationLaws.includes(marker), marker);
  }

  const snapshot = await json('../fixtures/portfolio-snapshot.v1.json');
  const corpus = await json('../fixtures/acceptance-corpus.v1.json');
  const { campaign } = materializeAcceptanceCampaign(snapshot, corpus, 1784161200000);
  const report = evaluatePortfolioCampaign(snapshot, campaign);
  const preview = projectPortfolioLabCockpit(report, 1784161200100);
  assertTopLevelShape(snapshot, defs.PortfolioSnapshotV1, 'PortfolioSnapshotV1');
  assertTopLevelShape(campaign.evaluationInputs[0], defs.PortfolioScenarioEvaluationInputV1, 'PortfolioScenarioEvaluationInputV1');
  assertTopLevelShape(campaign, defs.ScenarioCampaignV1, 'ScenarioCampaignV1');
  assertTopLevelShape(report.reports[0], defs.PortfolioScenarioReportV1, 'PortfolioScenarioReportV1');
  assertTopLevelShape(report, defs.PortfolioCampaignReportV1, 'PortfolioCampaignReportV1');
  assertTopLevelShape(preview, defs.PortfolioLabCockpitProjectionV1, 'PortfolioLabCockpitProjectionV1');
});
