import {
  canonicalStringify,
  deepFreeze,
  hasExactKeys,
  immutableClone,
  isPlainRecord,
  sha256Hex,
  stableUnique,
} from './canonical.mjs';
import {
  A5_FAMILY_SCENARIO_IDS,
  AMENDMENT_SHA256,
  DIRECTIVE_SHA256,
  ORACLE_IDS,
  REQUIRED_EVIDENCE_CLASSES,
  SECTION16_SCENARIOS,
  SHADOW_BASE_SHA,
} from './campaign-catalog.mjs';
import { runScenarioOracles } from './oracles.mjs';
import { buildReferenceTrace } from './reference-harness.mjs';

const HASH = /^[a-f0-9]{64}$/u;
const REPORT_KEYS = [
  'amendmentSha256', 'baseSha', 'directiveSha256', 'evidenceClassesProvided', 'evidenceTier',
  'failedScenarioCount', 'failedScenarioIds', 'familyCount', 'oracleCount', 'passedScenarioCount',
  'postPortEvidenceRequired', 'recordedNetworkAttemptCount', 'recordedProductEffectCount',
  'reportHash', 'requiredEvidenceClasses', 'scenarioCount', 'scenarios', 'schemaVersion',
  'shadowStatus', 'totalNetworkPolicy',
];
const SCENARIO_RESULT_KEYS = [
  'actualDisposition', 'evidenceClassesProvided', 'expectedDisposition', 'faultFamilies',
  'oracleResults', 'passed', 'postPortEvidenceRequired', 'scenarioId', 'scenarioNumber',
  'shadowStatus', 'title', 'traceHash',
];
const ORACLE_RESULT_KEYS = ['failedReasonCodes', 'oracleId', 'pass', 'shadowStatus'];
const FORBIDDEN_REPORT_VALUE = /(?:PRESTAGE_READY|INTEGRATED_ACCEPTED)/u;

function reportHasNoForbiddenClaim(value) {
  if (typeof value === 'string') return !FORBIDDEN_REPORT_VALUE.test(value);
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return true;
  if (Array.isArray(value)) return value.every(reportHasNoForbiddenClaim);
  if (!isPlainRecord(value)) return false;
  return Reflect.ownKeys(value).every((key) => typeof key === 'string'
    && !['acceptanceStatus', 'prestageReady'].includes(key)
    && reportHasNoForbiddenClaim(value[key]));
}

function buildScenarioResult(scenario) {
  const trace = buildReferenceTrace(scenario);
  const oracleResults = runScenarioOracles(scenario, trace);
  return {
    scenarioId: scenario.scenarioId,
    scenarioNumber: scenario.id,
    title: scenario.title,
    shadowStatus: 'SHADOW_SPECULATIVE',
    expectedDisposition: scenario.expectedDisposition,
    actualDisposition: trace.disposition,
    faultFamilies: scenario.faultFamilies,
    evidenceClassesProvided: scenario.evidenceClasses.provided,
    postPortEvidenceRequired: scenario.evidenceClasses.postPortRequired,
    traceHash: trace.traceHash,
    oracleResults,
    passed: oracleResults.every((entry) => entry.pass),
  };
}

export function runCampaign() {
  const scenarios = SECTION16_SCENARIOS.map(buildScenarioResult);
  const failedScenarioIds = scenarios.filter((scenario) => !scenario.passed).map((scenario) => scenario.scenarioId);
  const evidenceClassesProvided = stableUnique(SECTION16_SCENARIOS.flatMap((scenario) => scenario.evidenceClasses.provided));
  const postPortEvidenceRequired = stableUnique(SECTION16_SCENARIOS.flatMap((scenario) => scenario.evidenceClasses.postPortRequired));
  const draft = {
    schemaVersion: 'AIOPS_A5_CAMPAIGN_REPORT_V1',
    shadowStatus: 'SHADOW_SPECULATIVE',
    evidenceTier: 'SHADOW_CONTRACT_SIMULATION',
    baseSha: SHADOW_BASE_SHA,
    directiveSha256: DIRECTIVE_SHA256,
    amendmentSha256: AMENDMENT_SHA256,
    scenarioCount: scenarios.length,
    passedScenarioCount: scenarios.length - failedScenarioIds.length,
    failedScenarioCount: failedScenarioIds.length,
    failedScenarioIds,
    familyCount: Object.keys(A5_FAMILY_SCENARIO_IDS).length,
    oracleCount: ORACLE_IDS.length,
    totalNetworkPolicy: 'DENY_ALL_INCLUDING_LOOPBACK',
    recordedNetworkAttemptCount: 0,
    recordedProductEffectCount: 0,
    requiredEvidenceClasses: REQUIRED_EVIDENCE_CLASSES,
    evidenceClassesProvided,
    postPortEvidenceRequired,
    scenarios,
  };
  return immutableClone({ ...draft, reportHash: sha256Hex(draft) });
}

export function runReplayPair() {
  const first = runCampaign();
  const second = runCampaign();
  return deepFreeze({
    shadowStatus: 'SHADOW_SPECULATIVE',
    firstHash: first.reportHash,
    secondHash: second.reportHash,
    byteStable: JSON.stringify(first) === JSON.stringify(second),
    passed: first.reportHash === second.reportHash && JSON.stringify(first) === JSON.stringify(second),
  });
}

export function assertCampaignGreen(report) {
  const issues = [];
  if (!hasExactKeys(report, REPORT_KEYS)) return ['REPORT_KEYS_MISMATCH'];
  if (report.schemaVersion !== 'AIOPS_A5_CAMPAIGN_REPORT_V1') issues.push('REPORT_SCHEMA_MISMATCH');
  if (report.shadowStatus !== 'SHADOW_SPECULATIVE') issues.push('SHADOW_LABEL_MISSING');
  if (report.evidenceTier !== 'SHADOW_CONTRACT_SIMULATION') issues.push('EVIDENCE_TIER_MISMATCH');
  if (report.baseSha !== SHADOW_BASE_SHA
    || report.directiveSha256 !== DIRECTIVE_SHA256
    || report.amendmentSha256 !== AMENDMENT_SHA256) issues.push('AUTHORITY_HASH_MISMATCH');
  if (report.totalNetworkPolicy !== 'DENY_ALL_INCLUDING_LOOPBACK') issues.push('NETWORK_POLICY_MISMATCH');
  if (!Array.isArray(report.scenarios)) issues.push('SCENARIOS_INVALID');
  const scenarios = Array.isArray(report.scenarios) ? report.scenarios : [];
  if (report.scenarioCount !== scenarios.length || scenarios.length !== SECTION16_SCENARIOS.length) {
    issues.push('SCENARIO_COUNT_MISMATCH');
  }
  for (const [index, expected] of SECTION16_SCENARIOS.entries()) {
    const actual = scenarios[index];
    if (!hasExactKeys(actual, SCENARIO_RESULT_KEYS)) {
      issues.push('SCENARIO_RESULT_KEYS_MISMATCH');
      continue;
    }
    if (actual.scenarioNumber !== expected.id || actual.scenarioId !== expected.scenarioId
      || actual.title !== expected.title || actual.shadowStatus !== 'SHADOW_SPECULATIVE'
      || actual.expectedDisposition !== expected.expectedDisposition
      || actual.actualDisposition !== expected.expectedDisposition
      || canonicalStringify(actual.faultFamilies) !== canonicalStringify(expected.faultFamilies)
      || canonicalStringify(actual.evidenceClassesProvided) !== canonicalStringify(expected.evidenceClasses.provided)
      || canonicalStringify(actual.postPortEvidenceRequired) !== canonicalStringify(expected.evidenceClasses.postPortRequired)
      || !HASH.test(actual.traceHash ?? '')) {
      issues.push('SCENARIO_RESULT_MISMATCH');
    }
    const oracleResultsShaped = Array.isArray(actual.oracleResults)
      && actual.oracleResults.every((oracle) => hasExactKeys(oracle, ORACLE_RESULT_KEYS));
    if (!oracleResultsShaped
      || canonicalStringify(actual.oracleResults.map((oracle) => oracle.oracleId))
        !== canonicalStringify(expected.oracleIds)) {
      issues.push('SCENARIO_ORACLE_SET_MISMATCH');
    } else if (actual.oracleResults.some((oracle) => oracle.shadowStatus !== 'SHADOW_SPECULATIVE'
      || oracle.pass !== true
      || !Array.isArray(oracle.failedReasonCodes)
      || oracle.failedReasonCodes.length !== 0)) {
      issues.push('SCENARIO_ORACLE_FAILURE');
    }
    if (actual.passed !== true) issues.push('SCENARIO_FAILURE');
    try {
      if (canonicalStringify(actual) !== canonicalStringify(buildScenarioResult(expected))) {
        issues.push('SCENARIO_DERIVATION_MISMATCH');
      }
    } catch {
      issues.push('SCENARIO_DERIVATION_MISMATCH');
    }
  }
  const derivedFailedIds = scenarios.filter(({ passed }) => passed !== true).map(({ scenarioId }) => scenarioId);
  if (report.passedScenarioCount !== scenarios.length - derivedFailedIds.length
    || report.failedScenarioCount !== derivedFailedIds.length
    || canonicalStringify(report.failedScenarioIds) !== canonicalStringify(derivedFailedIds)
    || report.passedScenarioCount !== 120 || report.failedScenarioCount !== 0) {
    issues.push('FAILED_SCENARIOS_PRESENT');
  }
  if (report.familyCount !== Object.keys(A5_FAMILY_SCENARIO_IDS).length
    || report.oracleCount !== ORACLE_IDS.length) issues.push('REGISTRY_COUNT_MISMATCH');
  const expectedProvided = stableUnique(SECTION16_SCENARIOS.flatMap(({ evidenceClasses: value }) => value.provided));
  const expectedPostPort = stableUnique(SECTION16_SCENARIOS.flatMap(({ evidenceClasses: value }) => value.postPortRequired));
  if (canonicalStringify(report.requiredEvidenceClasses) !== canonicalStringify(REQUIRED_EVIDENCE_CLASSES)
    || canonicalStringify(report.evidenceClassesProvided) !== canonicalStringify(expectedProvided)
    || canonicalStringify(report.postPortEvidenceRequired) !== canonicalStringify(expectedPostPort)) {
    issues.push('EVIDENCE_CLASS_MISMATCH');
  }
  if (report.recordedNetworkAttemptCount !== 0) issues.push('NETWORK_ATTEMPT_RECORDED');
  if (report.recordedProductEffectCount !== 0) issues.push('PRODUCT_EFFECT_RECORDED');
  if (!reportHasNoForbiddenClaim(report)) issues.push('FORBIDDEN_ACCEPTANCE_CLAIM');
  const { reportHash, ...draft } = report;
  try {
    if (!HASH.test(reportHash ?? '') || reportHash !== sha256Hex(draft)) issues.push('REPORT_HASH_MISMATCH');
  } catch {
    issues.push('REPORT_HASH_MISMATCH');
  }
  return stableUnique(issues);
}
