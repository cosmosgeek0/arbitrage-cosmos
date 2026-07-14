import assert from 'node:assert/strict';
import test from 'node:test';

import { sha256Hex } from '../../../fixtures/aiOps/harness/canonical.mjs';
import { assertCampaignGreen, runCampaign, runReplayPair } from '../../../fixtures/aiOps/harness/campaign.mjs';

test('all 120 section 16 scenarios pass their independent oracles', () => {
  const report = runCampaign();
  assert.equal(report.shadowStatus, 'SHADOW_SPECULATIVE');
  assert.equal(report.scenarioCount, 120);
  assert.equal(report.passedScenarioCount, 120);
  assert.equal(report.failedScenarioCount, 0);
  assert.deepEqual(report.failedScenarioIds, []);
  assert.deepEqual(assertCampaignGreen(report), []);
  assert.ok(report.scenarios.every(({ passed }) => passed));
  assert.ok(report.scenarios.every(({ oracleResults }) => oracleResults.every(({ pass }) => pass)));
});

test('campaign truth records zero network attempts and zero product effects', () => {
  const report = runCampaign();
  assert.equal(report.totalNetworkPolicy, 'DENY_ALL_INCLUDING_LOOPBACK');
  assert.equal(report.recordedNetworkAttemptCount, 0);
  assert.equal(report.recordedProductEffectCount, 0);
  assert.ok(report.scenarios.every(({ shadowStatus }) => shadowStatus === 'SHADOW_SPECULATIVE'));
  assert.ok(report.scenarios.every(({ postPortEvidenceRequired }) => postPortEvidenceRequired.includes('INTEGRATION')));
  assert.ok(report.scenarios.every(({ postPortEvidenceRequired }) => postPortEvidenceRequired.includes('INDEPENDENT_READBACK')));
});

test('campaign replay is byte-stable and hash-stable', () => {
  const replay = runReplayPair();
  assert.equal(replay.shadowStatus, 'SHADOW_SPECULATIVE');
  assert.equal(replay.byteStable, true);
  assert.equal(replay.firstHash, replay.secondHash);
  assert.equal(replay.passed, true);
});

test('nuanced outcomes do not mislabel advisory, AI-off, canary, or last-known-good behavior', () => {
  const byNumber = new Map(runCampaign().scenarios.map((scenario) => [scenario.scenarioNumber, scenario]));
  assert.equal(byNumber.get(21).actualDisposition, 'SAFE_NO_EFFECT');
  assert.equal(byNumber.get(41).actualDisposition, 'INCIDENT_OPENED');
  assert.equal(byNumber.get(48).actualDisposition, 'SAFE_ADVISORY_ONLY');
  assert.equal(byNumber.get(49).actualDisposition, 'RESEARCH_REFERENCE_ONLY');
  assert.equal(byNumber.get(78).actualDisposition, 'AI_OFF_EQUIVALENT');
  assert.equal(byNumber.get(86).actualDisposition, 'WORKER_TERMINATED');
  assert.equal(byNumber.get(109).actualDisposition, 'LAST_KNOWN_GOOD_RETAINED');
  assert.equal(byNumber.get(110).actualDisposition, 'EFFECT_BLOCKED');
  assert.equal(byNumber.get(117).actualDisposition, 'CAPABILITY_SCOPED');
  assert.equal(byNumber.get(120).actualDisposition, 'PHYSICAL_AI_REMOVAL_EQUIVALENT');
});

test('scenario evidence labels never substitute shadow simulation for post-port proof', () => {
  const report = runCampaign();
  assert.equal(report.evidenceTier, 'SHADOW_CONTRACT_SIMULATION');
  assert.ok(report.evidenceClassesProvided.includes('CONTRACT'));
  assert.ok(report.evidenceClassesProvided.includes('FAULT_INJECTION'));
  assert.ok(report.postPortEvidenceRequired.includes('INTEGRATION'));
  assert.ok(report.postPortEvidenceRequired.includes('RESTART'));
  assert.ok(report.postPortEvidenceRequired.includes('BROWSER'));
  assert.ok(report.postPortEvidenceRequired.includes('INDEPENDENT_READBACK'));
});

test('campaign validator rejects recomputed acceptance claims and inconsistent derived state', () => {
  const mutations = [
    (report) => { report.acceptanceStatus = 'INTEGRATED_ACCEPTED'; },
    (report) => {
      report.scenarios[0].passed = false;
      report.scenarios[0].oracleResults[0].pass = false;
      report.scenarios[0].oracleResults[0].failedReasonCodes = ['FALSE_GREEN'];
    },
    (report) => { report.scenarios.pop(); },
    (report) => { report.scenarios[0].actualDisposition = 'PRESTAGE_READY'; },
    (report) => { report.failedScenarioIds = ['A5-S16-001']; },
    (report) => { report.scenarios[0].shadowStatus = 'ACCEPTED'; },
    (report) => { report.scenarios[0].traceHash = '0'.repeat(64); },
  ];
  for (const mutate of mutations) {
    const report = JSON.parse(JSON.stringify(runCampaign()));
    delete report.reportHash;
    mutate(report);
    report.reportHash = sha256Hex(report);
    assert.notDeepEqual(assertCampaignGreen(report), []);
  }
});
