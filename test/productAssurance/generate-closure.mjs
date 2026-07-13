import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  REVIEWED_OPERATION_DISPOSITIONS,
  scanProductionOperations,
} from './production-operation-scan.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BASE_COMMIT = '9785c93102b00389847b77c2f9348c06abc4344b';
const D_LAUNCH_13_COMMIT = 'c57610cb5f7d56efb61e53ae27057fbe92a6a2f6';
const RELEASE_ID = 'IP_ASSURANCE_CORE_SCAFFOLD_20260713';
const GENERATOR_SCHEMA = 'PRODUCT_ASSURANCE_CLOSURE_GENERATOR_V2';
const TERMINAL_DISPOSITION = 'CORE_SCAFFOLD_READY';

const GENERATED_DOCUMENT_PATHS = Object.freeze([
  'fixtures/productAssurance/generated/RELIABILITY_POLICY_REGISTRY.md',
  'fixtures/productAssurance/generated/SAFETY_INVARIANT_CATALOG.md',
  'fixtures/productAssurance/generated/TELEMETRY_COVERAGE_MATRIX.md',
  'fixtures/productAssurance/generated/OUT_OF_BAND_RECOVERY_REPORT.md',
  'fixtures/productAssurance/generated/FAULT_INJECTION_AND_SOAK_REPORT.md',
  'fixtures/productAssurance/generated/OPERATIONAL_FAILURE_ATLAS.md',
  'fixtures/productAssurance/generated/AGENTIC_DIAGNOSTIC_BOUNDARY.md',
  'fixtures/productAssurance/generated/ASSURANCE_INSERTION_REQUEST.md',
  'fixtures/productAssurance/generated/Q_ASSURANCE_COVERAGE_MATRIX.md',
]);
const MACHINE_EVIDENCE_PATHS = Object.freeze([
  'fixtures/productAssurance/fixtures-root/core-assurance-evidence.json',
  'fixtures/productAssurance/fixtures-root/fault-harness-synthetic.json',
]);
const RECEIPT_PATH = 'fixtures/productAssurance/receipts/IP_ASSURANCE_RECEIPT.md';
const ALL_CLOSURE_PATHS = Object.freeze([
  ...GENERATED_DOCUMENT_PATHS,
  ...MACHINE_EVIDENCE_PATHS,
  RECEIPT_PATH,
]);

const INPUTS = Object.freeze([
  Object.freeze({
    source: 'WORKTREE', path: 'IP_ASSURANCE.md',
    sha256: '5f6d4b3b70e384f6123e9ccc01891faf04aef9da7f7cfd1e0c63be5c3ba68803',
    role: 'FROZEN_D_LAUNCH_8_PACKET_PROVENANCE',
  }),
  Object.freeze({
    source: 'GIT_OBJECT', path: 'IP_ASSURANCE.md', gitObject: `${D_LAUNCH_13_COMMIT}:IP_ASSURANCE.md`,
    sha256: '49dcd690275ff35cb32566af307ad572d2a527e06d7388885f98826560968e84',
    role: 'D_LAUNCH_13_GOVERNING_PACKET',
  }),
  Object.freeze({
    source: 'GIT_OBJECT', path: 'QL_DIRECTOR_STATE.md', gitObject: `${D_LAUNCH_13_COMMIT}:QL_DIRECTOR_STATE.md`,
    sha256: 'ec61e1678dcb108a92b9dda5503233c76b35fa5301c36077e04bdaead7b44307',
    role: 'D_LAUNCH_13_DIRECTOR_RULING',
  }),
  Object.freeze({
    source: 'WORKTREE', path: 'I00_PRODUCT_ASSEMBLY_CONTROL_ROOM_AND_LIVE_BRINGUP.md',
    sha256: '9d7a36da6a2e6e7b3e905c73161b5e998a2f92416dd557e498ade3e73d5e5ef5',
    role: 'PROTECTED_UNTRACKED_I00_OWNER_INPUT',
  }),
  Object.freeze({
    source: 'WORKTREE', path: 'fixtures/productAssurance/generated/SYSTEMIC_ASSURANCE_DEDUP_MATRIX.md',
    sha256: '22686d2cd1c54bbc39af56399298a0ed9563bbc8643ad4f0e498718de83cb2cd',
    role: 'DIRECTOR_ACCEPTED_DEDUP_LAW_PROTECTED_INPUT',
  }),
]);

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  }
  return value;
}

function stableJson(value) {
  return `${JSON.stringify(stableValue(value), null, 2)}\n`;
}

function cell(value) {
  if (value === null || value === undefined || value === '') return '—';
  const text = Array.isArray(value) ? value.join('<br>') : String(value);
  return text.replaceAll('|', '\\|').replaceAll('\n', '<br>');
}

function table(headers, rows) {
  return [
    `| ${headers.map(cell).join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.map(cell).join(' | ')} |`),
  ].join('\n');
}

function iso(ms) {
  return new Date(ms).toISOString();
}

function gitText(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
}

function parseArguments(args) {
  const parsed = {};
  const allowed = new Set([
    '--tested-commit', '--implementation-commit', '--evaluated-at-ms',
    '--director-state-commit', '--disposition',
  ]);
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (!allowed.has(key)) throw new Error(`unknown argument: ${key ?? 'undefined'}`);
    if (value === undefined) throw new Error(`${key} requires a value`);
    parsed[key.slice(2)] = value;
  }
  for (const key of [...allowed].map((entry) => entry.slice(2))) {
    if (parsed[key] === undefined) throw new Error(`--${key} is required`);
  }
  for (const key of ['tested-commit', 'implementation-commit', 'director-state-commit']) {
    assert.match(parsed[key], /^[a-f0-9]{40}$/u, `--${key} must be a full lowercase Git SHA-1`);
  }
  assert.equal(parsed['director-state-commit'], D_LAUNCH_13_COMMIT, 'director state commit must be D-LAUNCH-13');
  assert.equal(parsed.disposition, TERMINAL_DISPOSITION, `--disposition must be ${TERMINAL_DISPOSITION}`);
  const evaluatedAtMs = Number(parsed['evaluated-at-ms']);
  assert.equal(Number.isSafeInteger(evaluatedAtMs) && evaluatedAtMs >= 0, true, '--evaluated-at-ms must be a non-negative UTC millisecond integer');
  return Object.freeze({
    testedCommit: parsed['tested-commit'],
    implementationCommit: parsed['implementation-commit'],
    directorStateCommit: parsed['director-state-commit'],
    disposition: parsed.disposition,
    evaluatedAtMs,
  });
}

function verifyInputs() {
  return Object.freeze(INPUTS.map((input) => {
    const bytes = input.source === 'GIT_OBJECT'
      ? execFileSync('git', ['show', input.gitObject], { cwd: ROOT })
      : readFileSync(join(ROOT, input.path));
    assert.equal(sha256(bytes), input.sha256, `${input.gitObject ?? input.path} SHA-256 mismatch`);
    return Object.freeze({ ...input, verified: true });
  }));
}

function trackedDirtyPaths() {
  const unstaged = gitText(['diff', '--name-only', '--']).split('\n').filter(Boolean);
  const staged = gitText(['diff', '--cached', '--name-only', '--']).split('\n').filter(Boolean);
  return Object.freeze([...new Set([...unstaged, ...staged])].sort());
}

function gitChangedPaths(implementationCommit) {
  const committed = gitText(['diff', '--name-only', '--diff-filter=ACDMRTUXB', BASE_COMMIT, implementationCommit, '--'])
    .split('\n').filter(Boolean);
  return Object.freeze([...new Set([...committed, ...ALL_CLOSURE_PATHS])].sort());
}

function insertionRow(
  requestId,
  owner,
  seam,
  contract,
  test,
  expectedBehavior,
  blocker = 'DIRECTOR_OWNED_WIRING_NOT_PERFORMED',
) {
  return Object.freeze({
    requestId, owner, seam,
    reason: 'Shared or owner-controlled integration remains outside A-CORE write authority.',
    contract, test, expectedBehavior,
    wiringState: 'NOT_CONFIGURED', truthLabel: 'UNKNOWN', authorityGranted: false, blocker,
  });
}

function buildInsertionRows(cockpitSectionIds) {
  const base = [
    ['AIR-I03-REMEDIATION-CONTROLLER', 'I03_CONTROL_PLANE', 'canonical command registry', 'Mount bounded owner-approved remediation campaigns.', 'lifecycle, restart, lease and conflict tests', 'Action completion never equals recovery.'],
    ['AIR-I04-CAMPAIGN-PERSISTENCE', 'I04_LEDGER_PERSISTENCE', 'existing ledger and material-event owners', 'Persist campaign evidence without a second store.', 'restart and corrupt-record tests', 'Restart preserves ambiguity and unfinished work.'],
    ['AIR-I08-SUPERVISOR-AGGREGATION', 'I08_SUPERVISOR', 'canonical supervisor projection', 'Consume the accepted coverage owner contract.', 'missing/stale/silent owner projections', 'Absent input remains WAITING and cannot green.'],
    ['AIR-I09-READ-CONTROL-SEAM', 'I09_READ_API_CONTROL_SEAM', 'canonical read API', 'Expose render-neutral owner projections and canonical controls only.', 'schema and unknown-control tests', 'Routes do not recompute owner truth.'],
    ['AIR-RATE-GATEWAY', 'INTELLIGENCE_RUNTIME_RATE_BUDGET', 'aggregate rate-budget owner contract', 'Publish allocation, reserve, cooldown and aggregate concurrency truth.', 'saturation and owner-contract tests', 'A-CORE never allocates runtime rate budget.', 'AGGREGATE_RATE_BUDGET_OWNER_CONTRACT_NOT_CONFIGURED'],
    ['AIR-TEMPORAL-ADAPTER', 'CANONICAL_CLOCK_OWNER', 'clock and temporal adapter', 'Publish injected-clock and continuity evidence.', 'skew, stale clock and gap tests', 'Unknown temporal evidence blocks the affected decision.'],
    ['AIR-EXECUTION-FENCE-ADAPTER', 'EXECUTION_OWNER', 'canonical execution lease', 'Publish exact process/release identity and fence epoch.', 'duplicate executor and expiry tests', 'Only the canonical owner can hold a valid mutation lease.'],
    ['AIR-TELEMETRY-ADAPTER', 'TELEMETRY_OWNER', 'existing telemetry pipeline', 'Publish queue, drop, retention and exporter truth.', 'drop, duplicate and exporter-failure tests', 'Telemetry failure remains visible.'],
    ['AIR-WATCHDOG-NOTIFICATION', 'I00_OPS_OWNER', 'watchdog and notification seams', 'Publish independent delivery and recovery receipts.', 'watchdog, delivery and restore tests', 'No recovery claim exists without independent proof.'],
    ['AIR-FAILURE-ATLAS-INGESTION', 'I04_I08_FAILURE_EVIDENCE_OWNERS', 'canonical incident evidence', 'Supply sanitized exact-bound failure records.', 'provenance, retention and dedup tests', 'Non-empty records wait for the owner contract.'],
    ['AIR-LEGACY-SIGNED-TRIPWIRE', 'I00_EXECUTION_SECURITY_OWNER', 'legacy signed route tripwire', 'Keep signed and money paths dormant blocked.', 'route inventory and direct-call tests', 'LIVE_EXECUTION_NOT_IMPLEMENTED remains enforced.'],
    ['AIR-I00-SECTION20-AUTHORIZATION', 'I00_DIRECTOR', 'I00 external authorization boundary', 'Bind every external mutation to durable owner authorization.', 'wait, reject and expiry tests', 'A-CORE performs no external mutation.', 'OWNER_AUTHORIZATION_REQUIRED'],
    ['AIR-ROOT-TEST-HARNESS', 'I00_DIRECTOR', 'root package test harness', 'Keep Product Assurance in canonical root verification.', 'real exit-code tests', 'No false-green wrapper is allowed.'],
    ['AIR-IP-PROOF-BASE-CAMPAIGNS', 'IP_PROOF_I11', 'accepted fault campaign owner', 'Run canonical campaigns against accepted integration fixtures.', '103-scenario denominator tests', 'Synthetic model evidence stays separate.'],
    ['AIR-S3-CONFORMANCE-TOOLING', 'S3_PROTOCOL_CONFORMANCE_OWNER', 'bounded protocol conformance seam', 'Consume only a director-accepted S3 contract.', 'denominator and malformed-protocol tests', 'No duplicate protocol authority.'],
    ['AIR-S7-Q-COVERAGE', 'S7_Q_ASSURANCE_OWNER', 'accepted-Q read seam', 'Consume immutable accepted Q identities only.', 'identity, holdout and authority tests', 'Q stays advisory and abstains on uncertainty.'],
    ['AIR-S8-CANCELLATION-CONTROL-LOOP', 'S8_OPERATION_ASSURANCE_OWNER', 'operation wrapper seam', 'Consume accepted cancellation and resource evidence.', 'late completion and amplification tests', 'No throttling authority is invented.'],
    ['AIR-DIAGNOSTIC-KILL-CONTROL', 'I00_CONTROL_OWNER', 'diagnostic kill control', 'Stop the optional diagnostic plane without changing product truth.', 'kill and readback tests', 'Deterministic safety continues.'],
    ['AIR-DIAGNOSTIC-WORKLOAD-IDENTITY', 'I00_SECURITY_OWNER', 'provider workload identity', 'Publish deny-by-default provider and sandbox identity.', 'identity and capability tests', 'Unbound identity grants no capability.'],
    ['AIR-DIAGNOSTIC-COCKPIT', 'IP_CONTROL_I10', 'diagnostic cockpit fields', 'Render the governance owner projection.', 'truth and outage rendering tests', 'Provider absence is not product failure.'],
    ['AIR-ATLAS-ANALYTICS-ENDPY-SEED', 'I00_FAILURE_ATLAS_OWNER', 'validated Atlas seed seam', 'Validate provenance before using any inert seed.', 'hash, schema and no-execution tests', 'Historical code is never imported or trusted directly.'],
    ['AIR-SATELLITE-SERIAL-FAN-IN', 'I00_DIRECTOR', 'director serial fan-in', 'Accept immutable satellite commits one at a time.', 'scope, accumulated and dedup tests', 'Only the director may claim ASSURANCE_PRESTAGE_READY.', 'DIRECTOR_ACCEPTED_SERIAL_FAN_IN_MISSING'],
    ['AIR-NEWS-CONTEXT-DYNAMIC-METHOD', 'I00_DIRECTOR', 'existing newsContext GET policy seam', 'Preserve the canonical service; later make GET-only policy explicit while retaining HTTPS allowlisting, redirect revalidation, 8s per-attempt timeout, two attempts, 350ms delay, 8MiB limit, coalescing and 15s failure suppression.', 'exact site/source-digest/ruling tuple drift and hostile non-GET tests', 'The reviewed site remains PURE_READ / KEEP_CANONICAL and unrelated dynamic fetches remain uncovered.', 'I00_NEWS_CONTEXT_GET_POLICY_HARDENING_PENDING'],
    ['AIR-STATE-DOC-UPDATE', 'I00_DIRECTOR', 'STATE.md', 'Record only final integrated state and measured counts.', 'state-vs-receipt tests', 'Root state changes only with integrated evidence.'],
  ];
  const rows = base.map((entry) => insertionRow(...entry));
  for (const [index, sectionId] of cockpitSectionIds.entries()) {
    rows.push(insertionRow(
      `AIR-I10-COCKPIT-${String(index + 1).padStart(2, '0')}`,
      'IP_CONTROL_I10', `I00 cockpit section ${sectionId}`,
      `Render the canonical ${sectionId} projection with source and truth labels.`,
      `${sectionId} UNKNOWN, source-attribution and no-fake-control tests`,
      'The surface cannot turn green from missing or non-live input.',
    ));
  }
  for (let scenario = 1; scenario <= 26; scenario += 1) {
    rows.push(insertionRow(
      `AIR-IP-PROOF-AMENDMENT-10-${String(scenario).padStart(2, '0')}`,
      'IP_PROOF_I11', `amendment scenario ${scenario}`,
      `Preserve director-authoritative scenario ${scenario} without inventing missing facts.`,
      `scenario ${scenario} fixture, negative proof and deterministic replay`,
      'Missing evidence cannot promote readiness.',
      'DIRECTOR_ACCEPTED_SCENARIO_FIXTURE_NOT_FANNED_IN',
    ));
  }
  const systemic = [
    ['S1', 'A-HAZARD', 'hazard denominator', 'DIRECTOR_ACCEPTED_S1_CONTRACT_MISSING'],
    ['S2', 'ACTION_EVIDENCE_SATELLITE', 'ACTION_EVIDENCE owner adapter', 'DIRECTOR_ACCEPTED_SATELLITE_COMMIT_MISSING'],
    ['S3', 'A-FORMAL', 'bounded conformance contract', 'DIRECTOR_ACCEPTED_SATELLITE_COMMIT_MISSING'],
    ['S4', 'ASSURANCE_CASE_SATELLITE', 'ASSURANCE_CASE owner adapter', 'DIRECTOR_ACCEPTED_SATELLITE_COMMIT_MISSING'],
    ['S5', 'I08_S5_COVERAGE_OWNER', 'COVERAGE owner adapter', 'DIRECTOR_ACCEPTED_S5_AND_I08_OWNER_CONTRACT_MISSING'],
    ['S6', 'A_AGENT_DIAGNOSTIC_GOVERNANCE', 'DIAGNOSTIC_GOVERNANCE owner adapter', 'DIRECTOR_ACCEPTED_SATELLITE_COMMIT_MISSING'],
    ['S8', 'A-STABILITY', 'operation assurance contract', 'DIRECTOR_ACCEPTED_SATELLITE_COMMIT_MISSING'],
  ];
  for (const [id, owner, seam, blocker] of systemic) {
    rows.push(insertionRow(
      `AIR-SYSTEMIC-${id}-FAN-IN`, owner, seam,
      `Consume only the exact director-accepted ${id} owner contract; do not recreate its implementation.`,
      `${id} scope, tuple, accumulated and dedup tests`,
      'Only an accepted owner artifact crosses this adapter.', blocker,
    ));
  }
  assert.equal(rows.length, 68, 'insertion request denominator drifted');
  assert.equal(new Set(rows.map((row) => row.requestId)).size, rows.length, 'insertion request IDs must be unique');
  return Object.freeze(rows);
}

function renderReliabilityRegistry(pa, scanner, coverage, options) {
  const policies = pa.OPERATION_POLICY_REGISTRY.map((policy) => [
    policy.operationId, policy.operationClass, policy.canonicalOwnerId, policy.wiringState,
    policy.deadlineMs, policy.maximumAttempts,
    `${policy.backoff.baseDelayMs}/${policy.backoff.maximumDelayMs}/${policy.backoff.totalRetryBudgetMs}; jitter=${policy.backoff.jitterRatio}`,
    `${policy.rateBudget.contractState}; owner=${policy.rateBudget.ownerId}; no local priority/reserve/cooldown truth`,
    policy.circuit === null ? 'OWNER_CONTRACT_WAITING' : `${policy.circuit.failureThreshold}/${policy.circuit.resetAfterMs}/${policy.circuit.halfOpenMaximumProbes}/${policy.circuit.healthyQuietWindowMs}`,
    policy.concurrencyLimit === null ? policy.concurrencyLimitState : policy.concurrencyLimit,
    policy.controlLoop === null ? 'OWNER_CONTRACT_WAITING' : `${policy.controlLoop.maximumConsecutiveRepairs}; amp=${policy.controlLoop.maximumAmplificationFactor}; cooldown=${policy.controlLoop.cooldownMs}`,
    `${policy.cancellation.mode}; ${policy.cancellation.lateCompletionLaw}; ${policy.cancellation.maximumCancellationWaitMs}`,
    policy.degradedResult, policy.blockedResult, policy.automaticRemediationAllowed,
    policy.implementationPaths,
  ]);
  const dispositionRows = REVIEWED_OPERATION_DISPOSITIONS.map((entry) => [
    entry.dispositionId, entry.rulingCommit, entry.ownerId, entry.siteId,
    `${entry.path}:${entry.line}:${entry.column}`, `${entry.rawKind} / ${entry.rawSymbol}`,
    entry.sourceSha256, `${entry.operationClass} / ${entry.disposition}`, entry.operationId,
    Object.entries(entry.observedSemantics).map(([key, value]) => `${key}=${Array.isArray(value) ? value.join(',') : value}`),
  ]);
  return `# Reliability Policy Registry

Generated by ${GENERATOR_SCHEMA} for ${options.testedCommit} at ${iso(options.evaluatedAtMs)}.

The static production-operation scan is **${coverage.verdict}: ${scanner.covered}/${scanner.discovered} mapped, ${scanner.uncovered} uncovered, fail-on-uncovered exit 0**. This is source registration evidence, not runtime, deployment, private, signed, or recovery proof.

## Reviewed canonical read disposition

${table(['Disposition', 'Ruling', 'Owner', 'Site', 'Location', 'Raw scan', 'Source SHA-256', 'Ruling', 'Operation', 'Observed semantics'], dispositionRows)}

The existing service remains byte-identical. Aggregate concurrency, rate budget, circuit, and control-loop truth are explicitly owner-contract WAITING; the 4/6 source-family workers are not misreported as a global bound.

## Policies (${policies.length})

${table(['Operation', 'Class', 'Owner', 'Wiring', 'Deadline ms', 'Attempts', 'Backoff', 'Rate budget', 'Circuit', 'Concurrency', 'Control loop', 'Cancellation', 'Degraded', 'Blocked', 'Auto remediation', 'Owner paths'], policies)}
`;
}

function renderInvariantCatalog(pa, options) {
  const rows = pa.SAFETY_INVARIANT_CATALOG.map((entry) => [
    entry.invariantId, entry.family, entry.ownerId, entry.expression, entry.factIds,
    entry.rule.kind, entry.cadenceMs, entry.severity, entry.capitalRelevant,
    entry.missingDataBehavior, entry.failSafeAction, entry.incidentId,
    entry.cockpitSurface, entry.repairControlId, entry.runbookId, entry.adversarialTestIds,
  ]);
  return `# Safety Invariant Catalog

Generated for ${options.testedCommit} at ${iso(options.evaluatedAtMs)}.

These ${rows.length} pure read contracts require exact owner/release/tested-commit/subject/digest bindings. They do not prove a continuous runtime evaluator is mounted. Critical UNKNOWN blocks readiness.

${table(['Invariant', 'Family', 'Owner', 'Expression', 'Facts', 'Rule', 'Cadence', 'Severity', 'Capital', 'Missing law', 'Fail-safe', 'Incident', 'Cockpit', 'Repair', 'Runbook', 'Hostile tests'], rows)}
`;
}

function renderCoverageMatrix(pa, scanner, options) {
  const seam = pa.OWNER_CONTRACT_WAITING_SEAMS.COVERAGE;
  return `# Telemetry Coverage Matrix

Generated for ${options.testedCommit} at ${iso(options.evaluatedAtMs)}.

Runtime coverage authority belongs to **${seam.ownerId}**. A-CORE contains no inventory classifier, coverage matrix evaluator, channel-ID catalog, or runtime freshness authority.

| Surface | Owner | State | Verdict | Target seam | Blocker | Authority |
| --- | --- | --- | --- | --- | --- | --- |
| COVERAGE | ${seam.ownerId} | WAITING | UNKNOWN | ${seam.targetSeam} | ${seam.blocker} | false |

Absent owner input stays **WAITING / UNKNOWN**. It is not pre-converted to UNAVAILABLE; SILENT versus UNAVAILABLE classification remains the owner contract's job.

The separate static operation scan is **${scanner.covered}/${scanner.discovered} mapped, ${scanner.uncovered} uncovered**. Static source registration is not observed runtime telemetry coverage.
`;
}

function renderRecoveryReport(pa, options) {
  const rate = pa.OWNER_CONTRACT_WAITING_SEAMS.RATE_BUDGET;
  return `# Out-of-Band Recovery Report

Generated for ${options.testedCommit} at ${iso(options.evaluatedAtMs)}.

Disposition: **CONTRACTS_AND_FIXTURES_ONLY**. Controller mounting, persistence, service restart, deployment, external mutation, and money paths are NOT_CONFIGURED.

## Remediation actions

${table(['#', 'Action'], pa.REMEDIATION_ACTIONS.map((entry, index) => [index + 1, entry]))}

## Durable lifecycle states

${table(['#', 'State'], pa.REMEDIATION_STATES.map((entry, index) => [index + 1, entry]))}

## Rate-budget owner seam

| Owner | State | Verdict | Target | Blocker | Authority |
| --- | --- | --- | --- | --- | --- |
| ${rate.ownerId} | WAITING | UNKNOWN | ${rate.targetSeam} | ${rate.blocker} | false |

A-CORE no longer allocates or projects aggregate rate budget. Recovery stays bounded by durable identity, leases, attempts, authorization, cancellation, rollback, independent postconditions, and quiet periods, without granting execution or money authority.
`;
}

function renderFaultReport(pa, faultReport, observations, options) {
  const runByScenario = new Map(observations.map((run) => [run.scenarioId, run]));
  const rows = faultReport.scenarioEvaluations.map((evaluation) => {
    const scenario = pa.CANONICAL_FAULT_SCENARIOS.find((entry) => entry.scenarioId === evaluation.scenarioId);
    const run = runByScenario.get(evaluation.scenarioId);
    return [evaluation.scenarioId, evaluation.kind, scenario?.deterministicSeed, scenario?.minimumIterations,
      scenario?.expectedRootCauseCode, evaluation.verdict, evaluation.reasonCodes, run?.runDigest];
  });
  return `# Fault Injection and Soak Report

Generated for ${options.testedCommit} at ${iso(options.evaluatedAtMs)}.

| Declared | Observed | Passed | Failed | Unknown | Truth | Real soak | Authority |
| ---: | ---: | ---: | ---: | ---: | --- | --- | --- |
| ${faultReport.declaredScenarioCount} | ${faultReport.observedScenarioCount} | ${faultReport.passedScenarioIds.length} | ${faultReport.failedScenarioIds.length} | ${faultReport.unknownScenarioIds.length} | ${faultReport.truthLabel} | ${faultReport.realSoakState} | ${faultReport.authorityGranted} |

The deterministic model is SYNTHETIC_ONLY; it is not live runtime chaos, deployment, private-account, signed-call, or recovery proof.

${table(['Scenario', 'Kind', 'Seed', 'Iterations', 'Expected root cause', 'Verdict', 'Reasons', 'Run digest'], rows)}
`;
}

function renderFailureAtlas(pa, failureRecords, faultReport, options) {
  return `# Operational Failure Atlas

Generated for ${options.testedCommit} at ${iso(options.evaluatedAtMs)}.

| Record corpus | Verdict | Eligible | Rejected | Reasons | Second store |
| --- | --- | ---: | ---: | --- | --- |
| Empty canonical input | ${failureRecords.verdict} | ${failureRecords.eligibleRecordIds.length} | ${failureRecords.rejectedRecordIds.length} | ${failureRecords.reasonCodes} | ${failureRecords.secondStoreCreated} |

Non-empty records remain FAILURE_RECORD_OWNER_CONTRACT_WAITING until the accepted S1 owner contract supplies exact provenance. Synthetic ${faultReport.passedScenarioIds.length}/${faultReport.declaredScenarioCount} PASS runs remain separate and never become incident records.

## Exact assurance dimensions

${table(['#', 'Dimension'], pa.FAILURE_ASSURANCE_DIMENSIONS.map((entry, index) => [index + 1, entry]))}

Control and family-denominator evidence require exact owner/release/tested-commit/subject/digest tuple binding with hostile substitution and splice proofs.
`;
}

function renderDiagnosticBoundary(pa, options) {
  const action = pa.OWNER_CONTRACT_WAITING_SEAMS.ACTION_EVIDENCE;
  const assuranceCase = pa.OWNER_CONTRACT_WAITING_SEAMS.ASSURANCE_CASE;
  const governance = pa.OWNER_CONTRACT_WAITING_SEAMS.DIAGNOSTIC_GOVERNANCE;
  return `# Agentic Diagnostic Boundary

Generated for ${options.testedCommit} at ${iso(options.evaluatedAtMs)}.

The locally owned boundary remains deny-by-default, redacts untrusted evidence, forbids money capabilities, and grants no authority. A-CORE no longer implements diagnostic governance, action-evidence evaluation, assurance-case graph evaluation, promotion classes, corpus governance, or provider identity authority.

${table(['Surface', 'Owner', 'State', 'Verdict', 'Target', 'Blocker', 'Authority'], [
    ['ACTION_EVIDENCE', action.ownerId, 'WAITING', 'UNKNOWN', action.targetSeam, action.blocker, false],
    ['ASSURANCE_CASE', assuranceCase.ownerId, 'WAITING', 'UNKNOWN', assuranceCase.targetSeam, assuranceCase.blocker, false],
    ['DIAGNOSTIC_GOVERNANCE', governance.ownerId, 'WAITING', 'UNKNOWN', governance.targetSeam, governance.blocker, false],
  ])}

## Local deny list

${table(['#', 'Forbidden capability'], pa.DIAGNOSTIC_FORBIDDEN_CAPABILITIES.map((entry, index) => [index + 1, entry]))}

Provider outage does not change deterministic safety, execution, money authority, or product readiness.
`;
}

function renderQMatrix(pa, options) {
  const rows = pa.Q_ASSURANCE_REQUIREMENTS.map((entry) => [
    entry.requirementId, entry.sourceFields, entry.expectedLaw,
    'UNKNOWN', 'BOUND_ACCEPTED_ASSESSMENT_EVIDENCE_NOT_SUPPLIED', false,
  ]);
  return `# Q Assurance Coverage Matrix

Generated for ${options.testedCommit} at ${iso(options.evaluatedAtMs)}.

Read-only accepted-Q projection. No current assessment envelope or holdout evidence was supplied, so evaluation is UNKNOWN, the safe action is ABSTAIN_UNKNOWN, and authority is false.

| Identity | Immutable value |
| --- | --- |
| Accepted protocol commit | ${pa.ACCEPTED_Q_ASSURANCE_IDENTITY.acceptedProtocolCommit} |
| Accepted Q commit | ${pa.ACCEPTED_Q_ASSURANCE_IDENTITY.acceptedQCommit} |
| Protocol schema digest | ${pa.ACCEPTED_Q_ASSURANCE_IDENTITY.protocolSchemaDigest} |
| Acceptance receipt digest | ${pa.ACCEPTED_Q_ASSURANCE_IDENTITY.acceptanceReceiptDigest} |

${table(['Requirement', 'Source fields', 'Law', 'Verdict', 'Reason', 'Authority'], rows)}
`;
}

function renderInsertionRequest(rows, options) {
  return `# Assurance Insertion Request

Generated for ${options.testedCommit} at ${iso(options.evaluatedAtMs)}.

These ${rows.length} owner requests perform no shared write, mount, route, persistence, UI, external, private, signed, money, deployment, or capital action.

${table(['Request', 'Owner', 'Target seam', 'Reason', 'Contract', 'Test', 'Expected behavior', 'Wiring', 'Truth', 'Authority', 'Blocker'], rows.map((row) => [
    row.requestId, row.owner, row.seam, row.reason, row.contract, row.test,
    row.expectedBehavior, row.wiringState, row.truthLabel, row.authorityGranted, row.blocker,
  ]))}
`;
}

function renderReceipt({
  options, verifiedInputs, pa, scanner, operationCoverage, faultReport,
  insertionRows, changedPaths, artifactHashes, generatedCommand,
}) {
  const pathSetDigest = sha256(`${changedPaths.join('\n')}\n`);
  const inputRows = verifiedInputs.map((entry) => [
    entry.source === 'GIT_OBJECT' ? entry.gitObject : entry.path,
    entry.role, entry.sha256, entry.verified,
  ]);
  const seamRows = pa.OWNER_CONTRACT_SURFACES.map((surface) => {
    const seam = pa.OWNER_CONTRACT_WAITING_SEAMS[surface];
    return [surface, seam.ownerId, seam.targetSeam, seam.blocker, 'WAITING / UNKNOWN', false];
  });
  const hashRows = Object.entries(artifactHashes).sort(([left], [right]) => left.localeCompare(right));
  return `# IP Assurance Receipt

## Identity and disposition

| Field | Value |
| --- | --- |
| Schema | PRODUCT_ASSURANCE_RECEIPT_V2 |
| Branch | ip-assurance-20260713 |
| Frozen base | ${BASE_COMMIT} |
| Implementation commit | ${options.implementationCommit} |
| Tested commit | ${options.testedCommit} |
| D-LAUNCH-13 ruling commit | ${options.directorStateCommit} |
| Evaluated UTC | ${iso(options.evaluatedAtMs)} |
| Generator-owned scaffold state | **CORE_SCAFFOLD_READY** |
| Full prestage state | NOT_CLAIMED_PENDING_DIRECTOR_FAN_IN |
| Authority granted | false |

This receipt records only facts verified by this generator: exact input identities, branch/HEAD/base gates, exported owner-adapter seams, the digest-bound canonical news disposition, static operation coverage, synthetic fault-model results, and the closure output set. Focused and repository-wide command results are deliberately not attested here. ASSURANCE_PRESTAGE_READY is not claimed.

## Verified governing inputs

${table(['Source', 'Role', 'SHA-256', 'Verified'], inputRows)}

The protected untracked I00 file, canonical news service, local historical packet, and dedup matrix were not modified by generation.

## Owner adapter boundaries

${table(['Surface', 'Owner', 'Target seam', 'Blocker', 'State', 'Authority'], seamRows)}

The exported seam metadata is WAITING / UNKNOWN and grants no authority. Behavioral proofs for absence handling and exact owner/release/subject/digest binding belong to the separately observed focused suite; this generator does not claim that suite ran.

## Generator-owned verification

| Evidence | Generator-verified result | Limit |
| --- | --- | --- |
| Branch / HEAD / frozen-base ancestry | PASS | exact assigned branch and tested commit |
| Governing input digests | PASS ${verifiedInputs.length}/${verifiedInputs.length} | exact worktree or Git-object bytes |
| Product Assurance registry denominators | PASS | compiled registry shape imported by this generator |
| Production operation scan | ${operationCoverage.verdict} ${scanner.covered}/${scanner.discovered}, uncovered ${scanner.uncovered}, exit 0 | static source registration |
| Reviewed news disposition | PASS 1/1 | exact site, source digest, ruling and observed-semantics registration |
| Synthetic fault model | ${faultReport.verdict} ${faultReport.passedScenarioIds.length}/${faultReport.declaredScenarioCount} | ${faultReport.truthLabel}; real soak ${faultReport.realSoakState} |
| Closure output path set | PASS 12/12 | nine reports, two JSON files and this receipt |
| Runtime/browser/deployment/private/signed proof | NOT_RUN / NOT_CONFIGURED | no live claim |

Focused tests, server typecheck/build, scope/import/secret purity, the edge-protocol suite, root npm test, root npm run test:all, and two-pass byte identity are **NOT_ATTESTED_BY_THIS_GENERATOR**. Their observed results and byte manifests must be sealed separately after execution.

Reviewed news site: ${REVIEWED_OPERATION_DISPOSITIONS[0].siteId}, source SHA-256 ${REVIEWED_OPERATION_DISPOSITIONS[0].sourceSha256}, PURE_READ / KEEP_CANONICAL, owner EXISTING_NEWS_CONTEXT_SERVICE. No service bytes were changed.

## Local counts

| Registry | Count |
| --- | ---: |
| Operation policies | ${pa.OPERATION_POLICY_REGISTRY.length} |
| Safety invariants | ${pa.SAFETY_INVARIANT_CATALOG.length} |
| Owner questions | ${pa.OWNER_QUESTION_COVERAGE.length} |
| Fault scenarios | ${pa.CANONICAL_FAULT_SCENARIOS.length} |
| Cockpit sections | ${pa.ASSURANCE_COCKPIT_SECTION_IDS.length} |
| Q requirements | ${pa.Q_ASSURANCE_REQUIREMENTS.length} |
| Owner adapter surfaces | ${pa.OWNER_CONTRACT_SURFACES.length} |
| Insertion requests | ${insertionRows.length} |

## Artifact seal

The receipt excludes its own digest. The generator emits 12 closure outputs: nine reports, two JSON evidence files, and this receipt. The other 11 output hashes calculated from the bytes this invocation writes are:

${table(['Path', 'SHA-256'], hashRows)}

This receipt does not self-attest a second invocation. The separately protected dedup matrix was verified at SHA-256 22686d2cd1c54bbc39af56399298a0ed9563bbc8643ad4f0e498718de83cb2cd. Any two-pass byte-identity claim must come from an external comparison of all 12 generated outputs using identical injected inputs.

## Changed-path inventory

Path-set SHA-256: ${pathSetDigest} over sorted UTF-8 paths, one newline each.

${changedPaths.map((entry) => `- \`${entry}\``).join('\n')}

## Reproduction

~~~sh
${generatedCommand}
~~~

Primary-source research used before implementation: SLSA v1.2 artifact verification, in-toto Statement and Release predicate v1.2.0, DSSE v1.0.2, RFC 8785 deterministic JSON, and Sigstore advisory GHSA-whqx-f9j3-ch6m. Those sources informed exact tuple conjunction, substitution resistance, and deterministic serialization.

## Authority and next owner

- This generator performs no push, current-main write, external mutation, private/signed exchange call, order, borrow, repay, transfer, withdrawal, leverage/margin change, deployment, or money-path action.
- LIVE_EXECUTION_NOT_IMPLEMENTED remains binding; its test result is not attested by this generator.
- Synthetic PASS is not live, deployed, integrated, soak, or recovery proof.
- Only the I00 director may perform serial fan-in, shared wiring, root STATE.md update, and the later full-prestage determination.

Terminal: **CORE_SCAFFOLD_READY**
`;
}

function writeOutput(path, content) {
  const absolute = join(ROOT, path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, content, 'utf8');
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  assert.equal(gitText(['branch', '--show-current']), 'ip-assurance-20260713', 'closure must run on the assigned branch');
  assert.equal(options.implementationCommit, options.testedCommit, 'implementation and tested commits must match');
  assert.equal(gitText(['rev-parse', 'HEAD']), options.testedCommit, 'tested commit must equal HEAD');
  assert.equal(gitText(['merge-base', BASE_COMMIT, options.testedCommit]), BASE_COMMIT, 'tested commit must descend from frozen base');
  const dirtyOutsideClosure = trackedDirtyPaths().filter((path) => !ALL_CLOSURE_PATHS.includes(path));
  assert.deepEqual(dirtyOutsideClosure, [], 'tracked source must be clean before closure generation');

  const verifiedInputs = verifyInputs();
  const pa = await import(pathToFileURL(join(ROOT, 'server', 'dist', 'productAssurance', 'index.js')).href);
  assert.equal(pa.OPERATION_POLICY_REGISTRY.length, 14);
  assert.equal(pa.SAFETY_INVARIANT_CATALOG.length, 15);
  assert.equal(pa.OWNER_QUESTION_COVERAGE.length, 25);
  assert.equal(pa.CANONICAL_FAULT_SCENARIOS.length, 103);
  assert.equal(pa.ASSURANCE_COCKPIT_SECTION_IDS.length, 11);
  assert.equal(pa.Q_ASSURANCE_REQUIREMENTS.length, 11);
  assert.equal(pa.OWNER_CONTRACT_SURFACES.length, 5);

  const scanner = scanProductionOperations({ repositoryRoot: ROOT });
  assert.equal(scanner.discovered, 143);
  assert.equal(scanner.covered, 143);
  assert.equal(scanner.uncovered, 0);
  assert.deepEqual(scanner.uncoveredSites, []);
  const reviewedSites = scanner.sites.filter((site) => site.reviewedDispositionId === REVIEWED_OPERATION_DISPOSITIONS[0].dispositionId);
  assert.equal(reviewedSites.length, 1);
  assert.equal(reviewedSites[0].sourceSha256, REVIEWED_OPERATION_DISPOSITIONS[0].sourceSha256);
  const operationCoverage = pa.scanOperationCoverage(pa.OPERATION_POLICY_REGISTRY, scanner.sites);
  assert.equal(operationCoverage.verdict, 'PASS');
  assert.deepEqual(operationCoverage.reasonCodes, []);

  const faultStartedAtMs = options.evaluatedAtMs - 1_000;
  assert.equal(faultStartedAtMs >= 0, true, 'evaluated time is too early');
  const observations = pa.CANONICAL_FAULT_SCENARIOS.map((scenario) => pa.simulateCanonicalFaultScenario(
    scenario, options.testedCommit, faultStartedAtMs,
  ));
  const faultReport = pa.evaluateCanonicalFaultHarness(observations, options.evaluatedAtMs);
  assert.deepEqual([
    faultReport.verdict, faultReport.declaredScenarioCount, faultReport.observedScenarioCount,
    faultReport.passedScenarioIds.length, faultReport.truthLabel, faultReport.realSoakState,
  ], ['PASS', 103, 103, 103, 'SYNTHETIC_ONLY', 'NOT_RUN']);
  const failureRecords = pa.projectOperationalFailureRecords([], options.evaluatedAtMs);
  assert.deepEqual([
    failureRecords.verdict, failureRecords.eligibleRecordIds.length,
    failureRecords.reasonCodes, failureRecords.secondStoreCreated,
  ], ['UNKNOWN', 0, ['FAILURE_RECORD_CORPUS_EMPTY'], false]);

  const insertionRows = buildInsertionRows(pa.ASSURANCE_COCKPIT_SECTION_IDS);
  const changedPaths = gitChangedPaths(options.implementationCommit);
  const generatedCommand = [
    'node test/productAssurance/generate-closure.mjs',
    `--tested-commit ${options.testedCommit}`,
    `--implementation-commit ${options.implementationCommit}`,
    `--evaluated-at-ms ${options.evaluatedAtMs}`,
    `--director-state-commit ${options.directorStateCommit}`,
    `--disposition ${options.disposition}`,
  ].join(' ');

  const coreEvidence = Object.freeze({
    schema: 'PRODUCT_ASSURANCE_CORE_EVIDENCE_V2', revision: 2,
    releaseId: RELEASE_ID, baseCommit: BASE_COMMIT,
    implementationCommit: options.implementationCommit, testedCommit: options.testedCommit,
    governingRulingCommit: options.directorStateCommit,
    evaluatedAtMs: options.evaluatedAtMs, evaluatedAtUtc: iso(options.evaluatedAtMs),
    disposition: options.disposition, authorityGranted: false,
    assurancePrestageReady: false,
    verifiedInputs,
    ownerContractWaitingSeams: pa.OWNER_CONTRACT_WAITING_SEAMS,
    reviewedOperationDisposition: REVIEWED_OPERATION_DISPOSITIONS[0],
    scanner: {
      schemaVersion: scanner.schemaVersion, filesScanned: scanner.filesScanned,
      discovered: scanner.discovered, covered: scanner.covered, uncovered: scanner.uncovered,
      uncoveredSites: scanner.uncoveredSites, coverageVerdict: operationCoverage.verdict,
      reasonCodes: operationCoverage.reasonCodes, failOnUncoveredExitCode: 0,
    },
    counts: {
      operationPolicies: pa.OPERATION_POLICY_REGISTRY.length,
      invariants: pa.SAFETY_INVARIANT_CATALOG.length,
      ownerQuestions: pa.OWNER_QUESTION_COVERAGE.length,
      faultScenarios: pa.CANONICAL_FAULT_SCENARIOS.length,
      cockpitSections: pa.ASSURANCE_COCKPIT_SECTION_IDS.length,
      qRequirements: pa.Q_ASSURANCE_REQUIREMENTS.length,
      ownerContractSurfaces: pa.OWNER_CONTRACT_SURFACES.length,
      insertionRequests: insertionRows.length,
    },
    immutableInterfaces: pa.ACCEPTED_IMMUTABLE_INTERFACE_METADATA,
    acceptedQIdentity: pa.ACCEPTED_Q_ASSURANCE_IDENTITY,
    changedPaths,
  });
  const faultEvidence = Object.freeze({
    schema: faultReport.schema, testedCommit: faultReport.testedCommit,
    evaluatedAtMs: faultReport.evaluatedAtMs, truthLabel: faultReport.truthLabel,
    realSoakState: faultReport.realSoakState, authorityGranted: faultReport.authorityGranted,
    verdict: faultReport.verdict, declaredScenarioCount: faultReport.declaredScenarioCount,
    observedScenarioCount: faultReport.observedScenarioCount,
    passedScenarioCount: faultReport.passedScenarioIds.length,
    failedScenarioIds: faultReport.failedScenarioIds,
    unknownScenarioIds: faultReport.unknownScenarioIds,
    reasonCodes: faultReport.reasonCodes,
    failureRecords,
    runs: observations.map((run) => ({
      scenarioId: run.scenarioId, runId: run.runId,
      simulatorRevision: run.simulatorRevision, deterministicSeed: run.deterministicSeed,
      iterationsCompleted: run.iterationsCompleted, startedAtMs: run.startedAtMs,
      completedAtMs: run.completedAtMs, state: run.state,
      rootCauseCode: run.rootCauseCode, transitionCodes: run.transitionCodes,
      proofVerdicts: run.proofs.map((proof) => ({ proofId: proof.proofId, verdict: proof.verdict })),
      runDigest: run.runDigest,
    })),
  });

  const outputs = new Map([
    [GENERATED_DOCUMENT_PATHS[0], renderReliabilityRegistry(pa, scanner, operationCoverage, options)],
    [GENERATED_DOCUMENT_PATHS[1], renderInvariantCatalog(pa, options)],
    [GENERATED_DOCUMENT_PATHS[2], renderCoverageMatrix(pa, scanner, options)],
    [GENERATED_DOCUMENT_PATHS[3], renderRecoveryReport(pa, options)],
    [GENERATED_DOCUMENT_PATHS[4], renderFaultReport(pa, faultReport, observations, options)],
    [GENERATED_DOCUMENT_PATHS[5], renderFailureAtlas(pa, failureRecords, faultReport, options)],
    [GENERATED_DOCUMENT_PATHS[6], renderDiagnosticBoundary(pa, options)],
    [GENERATED_DOCUMENT_PATHS[7], renderInsertionRequest(insertionRows, options)],
    [GENERATED_DOCUMENT_PATHS[8], renderQMatrix(pa, options)],
    [MACHINE_EVIDENCE_PATHS[0], stableJson(coreEvidence)],
    [MACHINE_EVIDENCE_PATHS[1], stableJson(faultEvidence)],
  ]);
  const artifactHashes = Object.fromEntries(
    [...outputs.entries()].map(([path, content]) => [path, sha256(content)]),
  );
  outputs.set(RECEIPT_PATH, renderReceipt({
    options, verifiedInputs, pa, scanner, operationCoverage, faultReport,
    insertionRows, changedPaths, artifactHashes, generatedCommand,
  }));
  assert.equal(outputs.size, 12);
  assert.deepEqual([...outputs.keys()].sort(), [...ALL_CLOSURE_PATHS].sort());
  for (const [path, content] of [...outputs.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    writeOutput(path, content);
  }
  process.stdout.write(`${JSON.stringify({
    schema: GENERATOR_SCHEMA, disposition: options.disposition,
    outputCount: outputs.size, insertionRequestCount: insertionRows.length,
    scanner: `${scanner.covered}/${scanner.discovered}`,
    faultHarness: `${faultReport.passedScenarioIds.length}/${faultReport.declaredScenarioCount} ${faultReport.truthLabel}`,
  })}\n`);
}

main().catch((error) => {
  process.stderr.write(`closure generation failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
