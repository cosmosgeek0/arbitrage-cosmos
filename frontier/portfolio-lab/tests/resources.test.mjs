import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { canonicalBytes, omitFields, sha256 } from '../../dock/src/canonical.mjs';
import { runFixtureLoad } from '../../dock/src/resources.mjs';
import {
  createScenarioCampaign,
  evaluatePortfolioCampaign,
  materializeAcceptanceCampaign,
  provePortfolioLabResourceEnvelope,
} from '../src/index.mjs';

async function fixture(name) {
  return JSON.parse(await readFile(new URL(`../fixtures/${name}`, import.meta.url), 'utf8'));
}

async function modulePacket() {
  const snapshot = await fixture('portfolio-snapshot.v1.json');
  const corpus = await fixture('acceptance-corpus.v1.json');
  return materializeAcceptanceCampaign(snapshot, corpus, 1784161200000);
}

test('declared maximum rate is green only inside the deterministic fixture envelope', async () => {
  const resourceBudgetClaim = await fixture('resource-budget-claim.v1.json');
  const maxSafeRateClaim = await fixture('max-safe-rate-claim.v1.json');
  const { snapshot, campaign } = await modulePacket();
  const proof = provePortfolioLabResourceEnvelope(
    resourceBudgetClaim,
    maxSafeRateClaim,
    { snapshot, campaign },
  );
  const report = evaluatePortfolioCampaign(snapshot, campaign);
  const expectedWorkloadHash = sha256({
    snapshotHash: snapshot.snapshotHash,
    campaignHash: campaign.campaignHash,
    evaluationHashes: campaign.evaluationInputs.map((row) => row.evaluationHash),
  });
  assert.equal(proof.workloadReceipt.workloadHash, expectedWorkloadHash);
  assert.equal(proof.workloadReceipt.snapshotHash, snapshot.snapshotHash);
  assert.equal(proof.workloadReceipt.campaignHash, campaign.campaignHash);
  assert.equal(proof.workloadReceipt.reportHash, report.reportHash);
  assert.equal(proof.workloadReceipt.evaluationCount, 20);
  assert.equal(proof.workloadReceipt.scenarioKinds.length, 20);
  assert.deepEqual(proof.workloadReceipt.canonicalSerializedBytes, {
    snapshot: canonicalBytes(snapshot).length,
    campaign: canonicalBytes(campaign).length,
    report: canonicalBytes(report).length,
  });
  assert.equal(proof.workloadReceipt.deterministicStepDefinition, 'ONE_SCENARIO_EVALUATION_EQUALS_ONE_DETERMINISTIC_FIXTURE_STEP');
  assert.equal(proof.workloadReceipt.storageBytesPersisted, 0);
  assert.equal(proof.workloadReceipt.fixtureCompatibilityOnly, true);
  assert.equal(
    proof.workloadReceipt.receiptHash,
    sha256(omitFields(proof.workloadReceipt, ['receiptHash'])),
  );
  assert.equal(proof.atLimit.state, 'WITHIN_FIXTURE_ENVELOPE');
  assert.equal(proof.atLimit.acceptedEvents, 20);
  assert.equal(proof.atLimit.backpressureApplied, true);
  assert.equal(proof.atLimit.canonicalState, null);
  assert.equal(proof.atLimit.forgedGreen, false);
  assert.equal(proof.beyondLimit.state, 'DEGRADATION_REQUESTED');
  assert.deepEqual(proof.beyondLimit.exceeded, ['EVENT_RATE']);
  assert.equal(proof.beyondLimit.acceptedEvents, 0);
  assert.equal(proof.beyondLimit.rejectedEvents, 21);
  assert.equal(proof.beyondLimit.silentLoss, false);
  assert.equal(proof.beyondLimit.degradationRequest.authorityGranted, false);
  assert.equal(proof.fixtureCompatibilityOnly, true);
  assert.equal(proof.hostPerformanceMeasured, false);
  assert.equal(proof.productionPerformanceClaimed, false);
});

test('one byte, model call, queued event, or storage byte degrades instead of forging green', async () => {
  const resourceBudgetClaim = await fixture('resource-budget-claim.v1.json');
  const maxSafeRateClaim = await fixture('max-safe-rate-claim.v1.json');
  const base = {
    resourceBudgetClaim,
    maxSafeRateClaim,
    windowSizeMs: 1000,
    offeredEvents: 20,
    peakQueueDepth: 0,
    latencySamples: new Array(20).fill(1),
    storageBytesPerEvent: 0,
    networkBytes: 0,
    modelCalls: 0,
  };
  const hostile = [
    ['NETWORK', { networkBytes: 1 }],
    ['MODEL_USE', { modelCalls: 1 }],
    ['QUEUE', { peakQueueDepth: 1 }],
    ['STORAGE_GROWTH', { storageBytesPerEvent: 1 }],
  ];
  for (const [reason, override] of hostile) {
    const output = runFixtureLoad({ ...base, ...override });
    assert.equal(output.state, 'DEGRADATION_REQUESTED');
    assert.ok(output.exceeded.includes(reason));
    assert.equal(output.forgedGreen, false);
    assert.equal(output.canonicalState, null);
    assert.equal(output.authorityClass, 'NO_AUTHORITY');
  }
  assert.throws(() => runFixtureLoad({ ...base, latencySamples: [1] }), { code: 'LATENCY_SAMPLE_COUNT_MISMATCH' });
  assert.throws(() => runFixtureLoad({ ...base, offeredEvents: 21 }), { code: 'LATENCY_SAMPLE_COUNT_MISMATCH' });
  assert.throws(() => runFixtureLoad({ ...base, windowSizeMs: 999 }), { code: 'RATE_WINDOW_MISMATCH' });
  assert.throws(() => runFixtureLoad({
    ...base,
    maxSafeRateClaim: { ...maxSafeRateClaim, eventsPerWindow: 21 },
  }), { code: 'SAFE_RATE_EXCEEDS_RESOURCE_CLAIM' });
  assert.throws(() => runFixtureLoad({
    ...base,
    maxSafeRateClaim: { ...maxSafeRateClaim, queueCapacity: 1 },
  }), { code: 'SAFE_RATE_EXCEEDS_RESOURCE_CLAIM' });
  assert.throws(() => runFixtureLoad({
    ...base,
    resourceBudgetClaim: {
      ...resourceBudgetClaim,
      network: { ...resourceBudgetClaim.network, unit: 'kilobytes' },
    },
  }), { code: 'RESOURCE_UNIT_MISMATCH' });
});

test('resource proof rejects anything except the exact ordered 20-case workload', async () => {
  const resourceBudgetClaim = await fixture('resource-budget-claim.v1.json');
  const maxSafeRateClaim = await fixture('max-safe-rate-claim.v1.json');
  const { snapshot, campaign } = await modulePacket();

  const nineteenInput = structuredClone(campaign);
  delete nineteenInput.campaignHash;
  nineteenInput.evaluationInputs = nineteenInput.evaluationInputs.slice(0, 19);
  nineteenInput.drawCount = 19;
  const nineteen = createScenarioCampaign(nineteenInput);
  assert.throws(() => provePortfolioLabResourceEnvelope(
    resourceBudgetClaim,
    maxSafeRateClaim,
    { snapshot, campaign: nineteen },
  ), { code: 'RESOURCE_WORKLOAD_CASE_COUNT_MISMATCH' });

  const reorderedInput = structuredClone(campaign);
  delete reorderedInput.campaignHash;
  [reorderedInput.evaluationInputs[0], reorderedInput.evaluationInputs[1]] = [
    reorderedInput.evaluationInputs[1],
    reorderedInput.evaluationInputs[0],
  ];
  const reordered = createScenarioCampaign(reorderedInput);
  assert.throws(() => provePortfolioLabResourceEnvelope(
    resourceBudgetClaim,
    maxSafeRateClaim,
    { snapshot, campaign: reordered },
  ), { code: 'RESOURCE_WORKLOAD_CORPUS_MISMATCH' });
});

test('resource proof rejects caller-raised claims even when Dock would call them compatible', async () => {
  const resourceBudgetClaim = await fixture('resource-budget-claim.v1.json');
  const maxSafeRateClaim = await fixture('max-safe-rate-claim.v1.json');
  const { snapshot, campaign } = await modulePacket();

  const raisedBudget = structuredClone(resourceBudgetClaim);
  raisedBudget.eventRate.limit = 21;
  raisedBudget.eventRate.observed = 21;
  const matchingRaisedSafeRate = structuredClone(maxSafeRateClaim);
  matchingRaisedSafeRate.eventsPerWindow = 21;
  assert.throws(
    () => provePortfolioLabResourceEnvelope(raisedBudget, matchingRaisedSafeRate, { snapshot, campaign }),
    (error) => error.code === 'RESOURCE_CLAIM_MISMATCH',
  );

  const raisedSafeRate = structuredClone(maxSafeRateClaim);
  raisedSafeRate.eventsPerWindow = 21;
  assert.throws(
    () => provePortfolioLabResourceEnvelope(resourceBudgetClaim, raisedSafeRate, { snapshot, campaign }),
    (error) => error.code === 'MAX_SAFE_RATE_CLAIM_MISMATCH',
  );
});
