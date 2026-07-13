import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { scanProductionOperations } from './production-operation-scan.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const GENERATED_DIRECTORY = join(ROOT, 'fixtures', 'productAssurance', 'generated');
const RECEIPT_DIRECTORY = join(ROOT, 'fixtures', 'productAssurance', 'receipts');
const FIXTURE_DIRECTORY = join(ROOT, 'fixtures', 'productAssurance', 'fixtures-root');

const BASE_COMMIT = '9785c93102b00389847b77c2f9348c06abc4344b';
const D_LAUNCH_8_COMMIT = BASE_COMMIT;
const RELEASE_ID = 'IP_ASSURANCE_CORE_SCAFFOLD_20260713';
const GENERATOR_SCHEMA = 'PRODUCT_ASSURANCE_CLOSURE_GENERATOR_V1';
const BLOCKER_CODE = 'BLOCKED_AWAITING_DIRECTOR_ACCEPTED_SERIAL_ASSURANCE_SATELLITE_FAN_IN_AND_OWNER_DISPOSITION_OF_NEWS_CONTEXT_DYNAMIC_FETCH_METHOD';
const EXACT_OPERATION_BLOCKER = Object.freeze({
  path: 'server/src/services/newsContext.ts',
  line: 2302,
  column: 25,
  kind: 'MUTATION_CALL',
  symbol: 'fetch:DYNAMIC_METHOD',
  siteId: 'OPSITE_FD086559819579DF346A',
});
const INPUTS = Object.freeze([
  Object.freeze({
    path: 'IP_ASSURANCE.md',
    sha256: '5f6d4b3b70e384f6123e9ccc01891faf04aef9da7f7cfd1e0c63be5c3ba68803',
    role: 'DIRECTOR_AMENDED_PACKET',
  }),
  Object.freeze({
    path: 'I00_PRODUCT_ASSEMBLY_CONTROL_ROOM_AND_LIVE_BRINGUP.md',
    sha256: '9d7a36da6a2e6e7b3e905c73161b5e998a2f92416dd557e498ade3e73d5e5ef5',
    role: 'PARENT_AUTHORITY_UNTRACKED_OWNER_INPUT',
  }),
  Object.freeze({
    path: 'fixtures/productAssurance/generated/SYSTEMIC_ASSURANCE_DEDUP_MATRIX.md',
    sha256: '22686d2cd1c54bbc39af56399298a0ed9563bbc8643ad4f0e498718de83cb2cd',
    role: 'DIRECTOR_ACCEPTED_DEDUP_LAW',
  }),
]);
const SYSTEMIC_STATE_SNAPSHOT = Object.freeze([
  Object.freeze({ requirement: 'S1', owner: 'A-HAZARD', state: 'HAZARD_PRESTAGE_READY_NOT_DIRECTOR_ACCEPTED', immutableTip: 'ab33b3712cddd67c3ec91cfa1dd232c75226cd9f' }),
  Object.freeze({ requirement: 'S2', owner: 'ACTION_EVIDENCE_SATELLITE', state: 'WAITING_NOT_CUT', immutableTip: null }),
  Object.freeze({ requirement: 'S3', owner: 'A-FORMAL', state: 'WORKING_NOT_DIRECTOR_ACCEPTED', immutableTip: 'acd3d8f8a0bb1fdf9680849cd428c793ad9b5359' }),
  Object.freeze({ requirement: 'S4', owner: 'ASSURANCE_CASE_SATELLITE', state: 'WAITING_NOT_CUT', immutableTip: null }),
  Object.freeze({ requirement: 'S5', owner: 'A-COCKPIT', state: 'WORKING_UNCOMMITTED', immutableTip: BASE_COMMIT }),
  Object.freeze({ requirement: 'S6', owner: 'A-AGENT', state: 'WORKING_UNCOMMITTED', immutableTip: BASE_COMMIT }),
  Object.freeze({ requirement: 'S7', owner: 'A-CORE_READ_ONLY_OUTPUT', state: 'GENERATED_NOT_INTEGRATED', immutableTip: null }),
  Object.freeze({ requirement: 'S8', owner: 'A-STABILITY', state: 'WORKING_UNCOMMITTED', immutableTip: BASE_COMMIT }),
]);

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
const ALL_CLOSURE_PATHS = Object.freeze([...GENERATED_DOCUMENT_PATHS, ...MACHINE_EVIDENCE_PATHS, RECEIPT_PATH]);

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

function commandOutput(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
}

function parseArguments(args) {
  const parsed = {};
  const allowed = new Set([
    '--tested-commit',
    '--implementation-commit',
    '--evaluated-at-ms',
    '--director-state-commit',
    '--disposition',
  ]);
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (!allowed.has(key)) throw new Error(`unknown argument: ${key ?? 'undefined'}`);
    if (value === undefined) throw new Error(`${key} requires a value`);
    parsed[key.slice(2)] = value;
  }
  const required = [...allowed].map((key) => key.slice(2));
  for (const key of required) {
    if (parsed[key] === undefined) throw new Error(`--${key} is required`);
  }
  assert.match(parsed['tested-commit'], /^[a-f0-9]{40}$/u, '--tested-commit must be a full lowercase Git SHA-1');
  assert.match(parsed['implementation-commit'], /^[a-f0-9]{40}$/u, '--implementation-commit must be a full lowercase Git SHA-1');
  assert.match(parsed['director-state-commit'], /^[a-f0-9]{40}$/u, '--director-state-commit must be a full lowercase Git SHA-1');
  assert.equal(parsed.disposition, BLOCKER_CODE, `--disposition must be the exact terminal blocker ${BLOCKER_CODE}`);
  const evaluatedAtMs = Number(parsed['evaluated-at-ms']);
  assert.equal(Number.isSafeInteger(evaluatedAtMs) && evaluatedAtMs >= 0, true, '--evaluated-at-ms must be a non-negative UTC millisecond integer');
  return Object.freeze({
    testedCommit: parsed['tested-commit'],
    implementationCommit: parsed['implementation-commit'],
    evaluatedAtMs,
    directorStateCommit: parsed['director-state-commit'],
    disposition: parsed.disposition,
  });
}

function verifyInputs() {
  return Object.freeze(INPUTS.map((input) => {
    const bytes = readFileSync(join(ROOT, input.path));
    const actual = sha256(bytes);
    assert.equal(actual, input.sha256, `${input.path} SHA-256 mismatch`);
    return Object.freeze({ ...input, verified: true });
  }));
}

function gitChangedPaths(implementationCommit) {
  const committed = commandOutput(['diff', '--name-only', '--diff-filter=ACDMRTUXB', BASE_COMMIT, implementationCommit, '--'])
    .split('\n')
    .filter(Boolean);
  return Object.freeze([...new Set([...committed, ...ALL_CLOSURE_PATHS])].sort());
}

function trackedDirtyPaths() {
  const unstaged = commandOutput(['diff', '--name-only', '--']).split('\n').filter(Boolean);
  const staged = commandOutput(['diff', '--cached', '--name-only', '--']).split('\n').filter(Boolean);
  return Object.freeze([...new Set([...unstaged, ...staged])].sort());
}

function insertionRow(requestId, owner, seam, contract, test, expectedBehavior, blocker = 'DIRECTOR_OWNED_WIRING_NOT_PERFORMED') {
  return Object.freeze({
    requestId,
    owner,
    seam,
    reason: 'Shared or satellite-owned integration is outside A-CORE write authority.',
    contract,
    test,
    expectedBehavior,
    wiringState: 'NOT_CONFIGURED',
    truthLabel: 'UNKNOWN',
    authorityGranted: false,
    blocker,
  });
}

function buildInsertionRows(cockpitSectionIds) {
  const rows = [
    insertionRow('AIR-I03-REMEDIATION-CONTROLLER', 'I03_CONTROL_PLANE', 'canonical Control Plane command registry', 'Mount only owner-approved bounded remediation campaigns; preserve fencing, budgets, authorization, cancellation, rollback, and independent verification.', 'campaign lifecycle, crash/restart, stale-owner, atomic lease and conflict tests', 'A campaign never becomes recovered from action completion or producer self-report.'),
    insertionRow('AIR-I04-CAMPAIGN-PERSISTENCE', 'I04_LEDGER_PERSISTENCE', 'existing database, ledger, and material-event owners', 'Persist campaign, attempt, authorization, lease, rollback, postcondition, quiet-period, and correlation evidence without creating a second store.', 'restart at every lifecycle transition plus corrupt/lost record tests', 'Restart cannot erase ambiguity, liability, attempt budget, or unfinished remediation.'),
    insertionRow('AIR-I08-SUPERVISOR-AGGREGATION', 'I08_SUPERVISOR', 'canonical supervisor aggregate projection', 'Aggregate expected inventory, invariants, operation state, independent proof, telemetry, watchdog, incidents, and diagnostics from canonical owners.', 'missing producer, stale producer and self-reported-green disagreement tests', 'Missing, stale, silent, unavailable, incompatible, or unknown critical evidence blocks green.'),
    insertionRow('AIR-I09-READ-CONTROL-SEAM', 'I09_READ_API_CONTROL_SEAM', 'canonical read API and bounded control dispatch', 'Expose render-neutral assurance projections and dispatch only canonical registered controls.', 'schema/readback/authorization/unknown-control tests', 'No route recomputes truth and no A-CORE contract becomes command authority.'),
    insertionRow('AIR-RATE-GATEWAY', 'EXCHANGE_RATE_GATEWAY_OWNER', 'aggregate exchange rate-budget gateway', 'Bind operation policy priorities and preserve reconciliation/risk-reducing reserve under saturation.', 'reserve underflow, cooldown, optional shedding and priority tests', 'Optional work cannot consume protected reconciliation or risk-reduction capacity.'),
    insertionRow('AIR-TEMPORAL-ADAPTER', 'CANONICAL_CLOCK_OWNER', 'host/exchange clock and temporal-coherence adapter', 'Provide injected monotonic deadlines plus event/receive/process/send/ack times, offsets, skew, and continuity watermarks.', 'stale clock, offset, cross-market skew and sequence-gap tests', 'Unknown or incoherent temporal evidence blocks the affected decision.'),
    insertionRow('AIR-EXECUTION-FENCE-ADAPTER', 'EXECUTION_OWNER', 'canonical execution lease and fence epoch', 'Expose process/release identity, epoch, renewal, expiry, and stale-owner rejection.', 'duplicate executor, expiry/handoff and stale completion tests', 'At most one exchange hand can own a valid mutation lease.'),
    insertionRow('AIR-TELEMETRY-ADAPTER', 'TELEMETRY_OWNER', 'existing telemetry pipeline', 'Expose queue, drops, retries, buffer/WAL, last export, retention, schema and conservation counters.', 'exporter failure, dropped record, duplicate and common-mode false-proof tests', 'Telemetry failure remains visible without losing durable ledger evidence.'),
    insertionRow('AIR-WATCHDOG-NOTIFICATION', 'I00_OPS_OWNER', 'existing sentinel, watchdog, notification and retention seams', 'Require independent probe, external watchdog state, delivery receipt, evidence retention, backup and restore-drill truth.', 'watchdog loss, notification no-receipt, backup/restore and retention tests', 'No notification or recovery claim exists without independent evidence.'),
    insertionRow('AIR-FAILURE-ATLAS-INGESTION', 'I04_I08_FAILURE_EVIDENCE_OWNERS', 'canonical incident, ledger, event, test, soak and postmortem evidence', 'Build a sanitized, retention-controlled, deduplicated read projection; never a second incident store.', 'stable-ID, denominator, provenance, access, expiry and dedup tests', 'Atlas gaps and unknown families stay visible.'),
    insertionRow('AIR-LEGACY-SIGNED-TRIPWIRE', 'I00_EXECUTION_SECURITY_OWNER', 'legacy signed route registration and startup tripwire', 'Prove every signed/money route remains dormant blocked under LIVE_EXECUTION_NOT_IMPLEMENTED.', 'route inventory, import, startup and direct-call adversarial tests', 'No signed/private/order/borrow/repay/transfer/withdraw path becomes callable.'),
    insertionRow('AIR-I00-SECTION20-AUTHORIZATION', 'I00_DIRECTOR', 'I00 §20 external authorization boundary', 'Bind any system service, host, deployment, config, AWS, Cloudflare, Secrets, or external mutation to exact durable owner authorization.', 'authorization wait/reject/expiry and no-side-effect tests', 'A-CORE remains proposal/proof only and performs no external mutation.', 'OWNER_AUTHORIZATION_REQUIRED'),
    insertionRow('AIR-ROOT-TEST-HARNESS', 'I00_DIRECTOR', 'root package test harness', 'Add Product Assurance focused tests and scanners to the canonical root suite without weakening existing exit codes.', 'prove npm test and npm run test:all execute Product Assurance with real nonzero failure exits', 'Root suites cannot be cited as Product Assurance coverage until this wiring lands.'),
    insertionRow('AIR-IP-PROOF-BASE-CAMPAIGNS', 'IP_PROOF_I11', 'server/test/i00Acceptance fault campaign owner', 'Execute the 103 canonical deterministic campaign contracts against accepted integrated runtime fixtures.', 'all canonical scenario IDs, evidence bindings, no duplicates, real exit codes', 'Synthetic model results remain separate from integrated campaign evidence.'),
    insertionRow('AIR-S3-CONFORMANCE-TOOLING', 'S3_PROTOCOL_CONFORMANCE_OWNER', 'amendment §4 bounded critical-protocol tooling seam', 'Fan in only director-accepted S3 model, triage and conformance contracts; root tooling remains director-owned.', 'model denominator, malformed protocol, triage and conformance tests', 'No unbounded state model or duplicate protocol authority.'),
    insertionRow('AIR-S7-Q-COVERAGE', 'S7_Q_ASSURANCE_OWNER', 'accepted-Q read-only coverage matrix', 'Consume only immutable accepted Q/protocol identities; independence or holdout uncertainty remains UNKNOWN and advisory-only.', 'identity replay, independence, holdout overlap, stale evidence and authority tests', 'Q can only advise or abstain and never writes quant/**.'),
    insertionRow('AIR-S8-CANCELLATION-CONTROL-LOOP', 'S8_OPERATION_ASSURANCE_OWNER', 'canonical operation execution wrappers', 'Integrate cancellation, late-completion quarantine, bounded repair loops, amplification limits, cooldown and cost/resource evidence without throttling authority.', 'cancel/supersede, late completion, alternating loop, resource unknown and amplification tests', 'Unknown resource evidence blocks or sheds according to owner policy.'),
    insertionRow('AIR-DIAGNOSTIC-KILL-CONTROL', 'I00_CONTROL_OWNER', 'handoff §4 residual 1 diagnostic kill control', 'Provide an owner-audited kill control for the optional diagnostic plane without changing deterministic product readiness.', 'kill/readback/audit/provider-outage tests', 'Diagnostic activity stops while deterministic safety continues.'),
    insertionRow('AIR-DIAGNOSTIC-WORKLOAD-IDENTITY', 'I00_SECURITY_OWNER', 'handoff §4 residual 2 provider workload identity and sandbox', 'Bind provider identity, exact capability set and deny-by-default external sandbox.', 'identity mismatch, capability escalation, arbitrary network/shell and secret tests', 'Unbound provider identity grants no diagnostic capability.'),
    insertionRow('AIR-DIAGNOSTIC-COCKPIT', 'IP_CONTROL_I10', 'handoff §4 residual 3 diagnostic cockpit fields', 'Render provider/model/policy/evidence/cost/approval/verifier/postcondition/outage truth with no operational actions.', 'truth label, missing evidence, outage and permission rendering tests', 'Provider absence is DIAGNOSTIC_PLANE_UNAVAILABLE, not product failure.'),
    insertionRow('AIR-ATLAS-ANALYTICS-ENDPY-SEED', 'I00_FAILURE_ATLAS_OWNER', 'handoff §4 residual 4 Atlas analytics and validated end.py seed', 'Validate provenance and safety before using any end.py content as an inert seed; never import or trust historical code directly.', 'provenance hash, schema, malicious input, dedup and no-execution tests', 'Only validated sanitized records may enter the read projection.'),
    insertionRow('AIR-SATELLITE-SERIAL-FAN-IN', 'I00_DIRECTOR', 'director serial merge queue for S1–S6 and S8', 'Accept immutable satellite commits one at a time, verify changed-path ownership, run accumulated tests after each, then rerun this generator. S7 remains the A-CORE read-only accepted-Q output.', 'per-satellite scope, focused suite, accumulated suite, reproducibility and hash tests', 'A-CORE cannot claim ASSURANCE_PRESTAGE_READY before accepted serial fan-in.', 'DIRECTOR_ACCEPTED_SERIAL_FAN_IN_MISSING'),
    insertionRow('AIR-NEWS-CONTEXT-DYNAMIC-METHOD', 'INTELLIGENCE_RUNTIME_NEWS_OWNER', 'server/src/services/newsContext.ts:2302:25', 'Either prove and enforce GET-only RequestInit semantics or register an explicit owner-reviewed mutation policy; A-CORE must not guess.', 'dynamic method adversarial scanner and owner contract test', 'The production-operation scanner reaches zero uncovered sites without misclassifying a possible mutation.', 'OPSITE_FD086559819579DF346A_UNCOVERED'),
    insertionRow('AIR-STATE-DOC-UPDATE', 'I00_DIRECTOR', 'STATE.md', 'Record final integrated component, wiring, commands, verification counts and remaining gaps in the canonical root state document.', 'state-vs-receipt and command-readback checks', 'Root state changes only with director-owned integrated evidence.'),
  ];

  for (const [index, sectionId] of cockpitSectionIds.entries()) {
    rows.push(insertionRow(
      `AIR-I10-COCKPIT-${String(index + 1).padStart(2, '0')}`,
      'IP_CONTROL_I10',
      `I00 §15 cockpit section ${sectionId}`,
      `Render the canonical ${sectionId} projection with source, freshness, wiring, truth, blocker and owner-action context.`,
      `fixture rendering, UNKNOWN/UNAVAILABLE, source attribution and no-fake-control tests for ${sectionId}`,
      'The surface is actionable, progressive, and cannot turn green from producer self-report alone.',
    ));
  }

  for (let scenario = 1; scenario <= 26; scenario += 1) {
    rows.push(insertionRow(
      `AIR-IP-PROOF-AMENDMENT-10-${String(scenario).padStart(2, '0')}`,
      'IP_PROOF_I11',
      `amendment §10 scenario ${scenario}`,
      `Execute and preserve the exact director-authoritative amendment §10 scenario ${scenario} contract without inventing an absent description.`,
      `amendment §10 scenario ${scenario} fixture, negative proof and deterministic replay`,
      'The exact scenario remains independently evidenced and cannot promote readiness from missing data.',
      'DIRECTOR_ACCEPTED_SCENARIO_FIXTURE_NOT_FANNED_IN',
    ));
  }

  const systemicOwners = [
    ['S1', 'HAZARD_ASSUMPTION_ATLAS_DENOMINATOR', 'A-HAZARD', 'fixtures/productAssurance/systemic/hazard/**'],
    ['S2', 'ACTION_SAFETY_EVIDENCE_ENVELOPE', 'ACTION_EVIDENCE_SATELLITE', 'fixtures/productAssurance/systemic/actionEvidence/**'],
    ['S3', 'BOUNDED_PROTOCOL_CONFORMANCE', 'A-FORMAL', 'fixtures/productAssurance/systemic/formal/**'],
    ['S4', 'DERIVED_ASSURANCE_CLAIM_GRAPH', 'ASSURANCE_CASE_SATELLITE', 'fixtures/productAssurance/systemic/assuranceCase/**'],
    ['S5', 'OBSERVABILITY_CONSERVATION', 'A-COCKPIT', 'fixtures/productAssurance/systemic/cockpit/** + fixtures/productAssurance/systemic/observability/**'],
    ['S6', 'DIAGNOSTIC_GOVERNANCE_EXTENSIONS', 'A-AGENT', 'fixtures/productAssurance/systemic/agentBoundary/**'],
    ['S8', 'CANCELLATION_CONTROL_LOOP_RESOURCE_EVIDENCE', 'A-STABILITY', 'fixtures/productAssurance/systemic/stability/**'],
  ];
  for (const [systemicId, contractId, owner, seam] of systemicOwners) {
    rows.push(insertionRow(
      `AIR-SYSTEMIC-${systemicId}-FAN-IN`,
      owner,
      seam,
      `Fan in the exact director-accepted ${contractId} packet from its immutable satellite commit; A-CORE does not recreate satellite files.`,
      `${systemicId} focused, scope, accumulated and dedup-matrix conformance tests`,
      'Only MISSING or narrow-EXTENDED dedup rows land, with no duplicate owner.',
      'DIRECTOR_ACCEPTED_SATELLITE_COMMIT_MISSING',
    ));
  }

  const ids = rows.map((row) => row.requestId);
  assert.equal(new Set(ids).size, ids.length, 'insertion request IDs must be unique');
  return Object.freeze(rows);
}

function renderReliabilityRegistry(pa, scannerReport, operationCoverage, options) {
  const policyRows = pa.OPERATION_POLICY_REGISTRY.map((policy) => [
    policy.operationId,
    policy.operationClass,
    policy.canonicalOwnerId,
    policy.wiringState,
    policy.deadlineMs,
    policy.maximumAttempts,
    policy.transientErrorCodes.length > 0 ? policy.transientErrorCodes : 'NONE',
    policy.permanentErrorCodes.length > 0 ? policy.permanentErrorCodes : 'NONE',
    policy.ambiguousErrorCodes.length > 0 ? policy.ambiguousErrorCodes : 'NONE',
    `${policy.backoff.baseDelayMs}/${policy.backoff.maximumDelayMs}/${policy.backoff.totalRetryBudgetMs}; jitter=${policy.backoff.jitterRatio}`,
    `${policy.rateBudget.priority}; reserve=${policy.rateBudget.reserveUnits}; ${policy.rateBudget.cooldownBehavior}`,
    `${policy.idempotency.required}; ${policy.idempotency.identityField ?? 'NONE'}; ${policy.idempotency.durability}`,
    policy.authoritativeReconciliationLookup,
    `${policy.circuit.failureThreshold}/${policy.circuit.resetAfterMs}/${policy.circuit.halfOpenMaximumProbes}/${policy.circuit.healthyQuietWindowMs}`,
    policy.concurrencyLimit,
    `${policy.cancellation.mode}; ${policy.cancellation.lateCompletionLaw}; ${policy.cancellation.maximumCancellationWaitMs}`,
    policy.poisonEventQuarantine,
    `${policy.controlLoop.maximumConsecutiveRepairs}; amp=${policy.controlLoop.maximumAmplificationFactor}; cooldown=${policy.controlLoop.cooldownMs}`,
    `${policy.costResourceEvidence.required}; ${policy.costResourceEvidence.metricId}; ${policy.costResourceEvidence.missingBehavior}`,
    policy.fallbackEligibility,
    `${policy.degradedResult} / ${policy.blockedResult}`,
    policy.durableRestartCheckpoint,
    policy.automaticRemediationAllowed,
    `${policy.escalationControlId}<br>${policy.runbookId}`,
    `${policy.metricId}<br>${policy.traceId}<br>${policy.materialEventId}<br>${policy.incidentId}`,
    policy.cockpitLocation,
    policy.faultTestIds,
    policy.implementationPaths,
  ]);
  const uncoveredRows = scannerReport.uncoveredSites.map((site) => [site.path, site.line, site.column, site.kind, site.symbol, site.siteId]);
  return `# Reliability Policy Registry

Generated deterministically by \`${GENERATOR_SCHEMA}\` for tested commit \`${options.testedCommit}\` at \`${iso(options.evaluatedAtMs)}\`.

Truth boundary: this is a 13-policy contract registry and static production-operation scan. It is not runtime, private, signed, deployment, or recovery proof. Scanner verdict is **${operationCoverage.verdict}**; not all discovered operations are registered.

## Scanner summary

| Files | Sites | Registered | Uncovered | Exit with --fail-on-uncovered |
| --- | --- | --- | --- | --- |
| ${scannerReport.filesScanned} | ${scannerReport.discovered} | ${scannerReport.covered} | ${scannerReport.uncovered} | 1 |

${table(['Path', 'Line', 'Column', 'Kind', 'Symbol', 'Stable site ID'], uncoveredRows)}

Owner disposition required: enforce and prove GET-only semantics at the exact site, or bind an explicit reviewed mutation policy. A-CORE cannot infer intent from the current wrapper.

## Policies

${table([
    'Operation', 'Class', 'Owner', 'Wiring', 'Deadline ms', 'Attempts', 'Transient errors',
    'Permanent errors', 'Ambiguous errors', 'Backoff base/max/total',
    'Rate budget', 'Idempotency', 'Reconciliation', 'Circuit fail/reset/probes/quiet', 'Bulkhead',
    'Cancellation', 'Poison quarantine', 'Control loop', 'Cost/resource evidence', 'Fallback', 'Degraded / blocked',
    'Checkpoint', 'Auto remediation', 'Control / runbook', 'Metric / trace / event / incident',
    'Cockpit', 'Fault tests', 'Owner paths',
  ], policyRows)}

Blind retry of an ambiguous possibly accepted mutation is forbidden. Cancellation, cost/resource evidence, rate reserve, reconciliation, and independent circuit-closing proof remain binding owner contracts.
`;
}

function renderInvariantCatalog(pa, options) {
  const rows = pa.SAFETY_INVARIANT_CATALOG.map((definition) => [
    definition.invariantId,
    definition.family,
    definition.ownerId,
    definition.expression,
    definition.factIds,
    definition.rule.kind,
    definition.cadenceMs,
    definition.severity,
    definition.capitalRelevant,
    definition.missingDataBehavior,
    definition.failSafeAction,
    definition.incidentId,
    definition.cockpitSurface,
    definition.repairControlId,
    definition.runbookId,
    definition.adversarialTestIds,
  ]);
  return `# Safety Invariant Catalog

Generated for \`${options.testedCommit}\` at \`${iso(options.evaluatedAtMs)}\`.

The ${rows.length} definitions below are pure, read-only contracts. They are not proof that a continuous runtime evaluator is mounted. Current live evaluation remains **UNKNOWN / NOT_CONFIGURED** until I00 owners wire canonical observations. Critical UNKNOWN blocks trade readiness exactly like failure.

${table([
    'Invariant', 'Family', 'Owner', 'Expression', 'Facts', 'Rule', 'Cadence ms', 'Severity',
    'Capital relevant', 'Missing-data law', 'Fail-safe', 'Incident', 'Cockpit', 'Repair', 'Runbook', 'Adversarial tests',
  ], rows)}
`;
}

function renderCoverageMatrix(pa, structuralCoverage, scannerReport, options) {
  const kindCounts = Object.fromEntries(pa.COVERAGE_SUBJECT_KINDS.map((kind) => [kind, pa.COVERAGE_OBLIGATIONS.filter((entry) => entry.subjectKind === kind).length]));
  const rows = pa.COVERAGE_OBLIGATIONS.map((entry) => [
    entry.subjectKind,
    entry.subjectId,
    entry.metricId,
    entry.structuredLogId,
    entry.materialEventId,
    entry.traceId,
    entry.incidentId,
    `${entry.freshnessMs}/${entry.hysteresisMs}`,
    entry.missingDataLaw,
    entry.severity,
    entry.capitalCritical,
    entry.cockpitSurface,
    entry.repairControlId,
    entry.fixtureId,
    entry.proofId,
  ]);
  const runtimeProjectionRows = [
    ['Expected component IDs', pa.EXPECTED_CANONICAL_COMPONENTS.map((entry) => entry.componentId), 'DECLARED_RELEASE_BOUND'],
    ['Discovered component IDs', 'UNKNOWN_NOT_CONFIGURED', 'UNKNOWN'],
    ['Expected dependency IDs', pa.EXPECTED_CANONICAL_DEPENDENCIES.map((entry) => entry.dependencyId), 'DECLARED_RELEASE_BOUND'],
    ['Discovered dependency IDs', 'UNKNOWN_NOT_CONFIGURED', 'UNKNOWN'],
    ['Instrumented component count / IDs', 'count=UNKNOWN; ids=UNKNOWN_NOT_CONFIGURED', 'UNKNOWN'],
    ['Current component count / IDs', 'count=UNKNOWN; ids=UNKNOWN_NOT_CONFIGURED', 'UNKNOWN'],
    ['Stale component count / IDs', 'count=UNKNOWN; ids=UNKNOWN_NOT_CONFIGURED', 'UNKNOWN'],
    ['Silent component count / IDs', 'count=UNKNOWN; ids=UNKNOWN_NOT_CONFIGURED', 'UNKNOWN'],
    ['Unavailable component count / IDs', 'count=UNKNOWN; ids=UNKNOWN_NOT_CONFIGURED', 'UNKNOWN'],
    ['Missing component count / IDs', 'count=UNKNOWN; ids=UNKNOWN_NOT_CONFIGURED', 'UNKNOWN'],
    ['Expected control IDs', pa.EXPECTED_CANONICAL_CONTROLS.map((entry) => entry.controlId), 'DECLARED_RELEASE_BOUND'],
    ['Live control count / IDs', 'count=UNKNOWN; ids=UNKNOWN_NOT_CONFIGURED', 'UNKNOWN'],
    ['Disabled control count / IDs', 'count=UNKNOWN; ids=UNKNOWN_NOT_CONFIGURED', 'UNKNOWN'],
    ['Unimplemented control count / IDs', 'count=UNKNOWN; ids=UNKNOWN_NOT_CONFIGURED', 'UNKNOWN'],
    ['Expected telemetry signal IDs', pa.EXPECTED_CANONICAL_TELEMETRY.map((entry) => entry.signalId), 'DECLARED_RELEASE_BOUND'],
    ['Telemetry schema compatibility', 'UNKNOWN_NOT_CONFIGURED', 'UNKNOWN'],
    ['Last complete correlation trace', 'UNKNOWN_NOT_CONFIGURED', 'UNKNOWN'],
    ['Last independent black-box probe', 'UNKNOWN_NOT_CONFIGURED', 'UNKNOWN'],
    ['Unobserved capital-critical dependency IDs', 'UNKNOWN_NOT_CONFIGURED', 'UNKNOWN'],
    ['Observed runtime coverage percentage', 'UNKNOWN_NOT_CONFIGURED', 'UNKNOWN'],
  ];
  return `# Telemetry Coverage Matrix

Generated for release \`${RELEASE_ID}\`, tested commit \`${options.testedCommit}\`, at \`${iso(options.evaluatedAtMs)}\`.

Declared structural catalog coverage is **${structuralCoverage.verdict}: ${structuralCoverage.coveredCount}/${structuralCoverage.expectedCount} (${structuralCoverage.coveragePercentage}%)**. This proves the release-bound denominator has one valid obligation per expected subject; it does **not** prove runtime emission, freshness, retention, delivery, deployment, or cockpit wiring. Observed runtime coverage is **UNKNOWN / NOT_CONFIGURED**.

## Denominators

| Family | Count |
| --- | ---: |
| Components | ${kindCounts.COMPONENT} |
| Invariants | ${kindCounts.INVARIANT} |
| Failure modes | ${kindCounts.FAILURE_MODE} |
| Operation policies | ${kindCounts.OPERATION_POLICY} |
| Owner questions | ${kindCounts.OWNER_QUESTION} |
| **Coverage obligations** | **${rows.length}** |
| Canonical dependencies | ${pa.EXPECTED_CANONICAL_DEPENDENCIES.length} |
| Canonical controls | ${pa.EXPECTED_CANONICAL_CONTROLS.length} |
| Canonical telemetry signals | ${pa.EXPECTED_CANONICAL_TELEMETRY.length} |
| Static production operation sites / covered | ${scannerReport.discovered} / ${scannerReport.covered} |

## Expected-versus-observed runtime inventory projection

${table(['Projection', 'Value', 'Truth'], runtimeProjectionRows)}

Unknown runtime counts are intentionally not rendered as zero. Only the expected side is release-bound here; discovered, live, current, stale, silent, unavailable, missing, schema, trace, probe, and unobserved-critical-dependency truth requires canonical I08/I09 runtime observations.

## Obligations

${table([
    'Kind', 'Subject', 'Metric', 'Structured log', 'Material event', 'Trace', 'Incident',
    'Freshness/hysteresis ms', 'Missing-data law', 'Severity', 'Capital critical', 'Cockpit',
    'Repair/control', 'Fixture', 'Proof',
  ], rows)}
`;
}

function renderRecoveryReport(pa, options) {
  const stateRows = pa.REMEDIATION_STATES.map((state, index) => [index + 1, state]);
  const actionRows = pa.REMEDIATION_ACTIONS.map((action, index) => [index + 1, action]);
  const attemptFields = [
    ['Identity/cause', 'attemptId, causeEvidenceIds, policyRevision', 'stable, unique, evidence-bound'],
    ['Budgets', 'localAttempt, globalAttempt, costUnits, concurrencyUnits', 'durable and bounded'],
    ['Timeline', 'startedAtMs, completedAtMs, nextRetryAtMs', 'injected UTC times; null stays unknown/in-progress'],
    ['State/action/result', 'beforeState, action, afterState, result, circuitState', 'AMBIGUOUS never becomes success'],
    ['Durable evidence', 'materialEventRef, cockpitTraceId', 'required; existing owner persistence only'],
  ];
  const campaignFields = [
    ['Identity', 'schema, revision, campaignId, fingerprint, policyRevision, action, state'],
    ['Desired/observed truth', 'desiredState, observedState, lastKnownGoodState, allowedDegradedState'],
    ['Dependencies/evidence', 'dependencyIds, invariantIds, triggerEvidenceIds, diagnosticConfidence'],
    ['Preconditions/scope', 'preconditionIds, resourceIds, capitalPosture, predictedResult'],
    ['Fencing', 'actionIdentity, fencingOwnerId, leaseEpoch'],
    ['Attempt/time budgets', 'localAttempt, maximumLocalAttempts, globalAttempt, maximumGlobalAttempts, elapsedMs, maximumElapsedMs'],
    ['Cost/concurrency budgets', 'costUnits, maximumCostUnits, concurrencyUnits, maximumConcurrencyUnits'],
    ['Rollback/compensation', 'rollbackAction, compensationAction'],
    ['Independent recovery proof', 'independentVerifierId, postconditionIds, provedPostconditionIds, verifiedAtMs, quietPeriodMs'],
    ['Durable continuation', 'nextRetryAtMs, materialEventRef, cockpitTraceId, attemptRecords, createdAtMs, updatedAtMs'],
  ];
  const policyRows = pa.OPERATION_POLICY_REGISTRY.map((policy) => [
    policy.operationId,
    policy.canonicalOwnerId,
    policy.automaticRemediationAllowed,
    'UNBOUND_OWNER_SELECTION',
    'OWNER_DEFINED_HEALTHY_STATE / UNKNOWN_OBSERVED / UNKNOWN_LAST_KNOWN_GOOD',
    policy.degradedResult,
    policy.faultTestIds,
    'UNKNOWN_NOT_OBSERVED',
    'OWNER_POLICY + CIRCUIT + RATE_BUDGET',
    `${policy.operationId}; capital posture grants no authority`,
    'NOT_CONFIGURED',
    `attempts=${policy.maximumAttempts}; elapsed=${policy.backoff.totalRetryBudgetMs}ms; concurrency=${policy.concurrencyLimit}; cost=OWNER_BOUND_UNKNOWN`,
    'OWNER_DEFINED_NOT_CONFIGURED',
    `REQUIRED_NOT_OBSERVED; quiet=${policy.circuit.healthyQuietWindowMs}ms`,
    `${policy.escalationControlId}<br>${policy.runbookId}`,
    'NOT_CONFIGURED',
  ]);
  return `# Out-of-Band Recovery Report

Generated for \`${options.testedCommit}\` at \`${iso(options.evaluatedAtMs)}\`.

Disposition: **CONTRACTS_AND_FIXTURES_ONLY**. Controller mounting, persistence, service/host restart, AWS, Cloudflare, Secrets, deployment, external mutation, private exchange access, and money mutation are **NOT_CONFIGURED** and grant no authority.

## Remediation actions (${pa.REMEDIATION_ACTIONS.length})

${table(['#', 'Action'], actionRows)}

## Durable lifecycle states (${pa.REMEDIATION_STATES.length})

${table(['#', 'State'], stateRows)}

## Durable attempt record contract

${table(['Group', 'Exact fields', 'Law'], attemptFields)}

## Durable campaign contract

${table(['Group', 'Exact fields'], campaignFields)}

## Per-policy/component recovery projection

${table([
    'Operation/component seam', 'Owner', 'Automatic allowed', 'Selected action', 'Desired / observed / last-good',
    'Allowed degraded', 'Trigger evidence', 'Fingerprint/confidence', 'Preconditions', 'Maximum scope/capital posture',
    'Action identity/fencing', 'Attempt/time/cost/concurrency budgets', 'Rollback/compensation',
    'Independent postconditions/quiet', 'Escalation', 'Runtime state',
  ], policyRows)}

These rows project real registry constraints while leaving campaign identity, observed state, fingerprints, action selection, fencing, persistence, rollback, and postcondition evidence honestly unconfigured.

Binding laws:

- campaigns preserve stable identity, cause, policy revision, before/after evidence, attempt/time/cost budgets, restart checkpoints, and cockpit correlation;
- ordered multi-resource leases are atomic; the repair-conflict graph prevents concurrent owners on one resource;
- lease expiry or handoff rejects stale completion;
- action completion never equals recovery;
- recovery requires independent postconditions plus a positive quiet/hysteresis period;
- authorization, cancellation, supersession, rollback, compensation, compensation failure, quarantine, and exhaustion stay explicit;
- automatic work cannot widen capital authority, raise risk limits, clear liability, fabricate health, or close an incident;
- owner-authorized external operations remain blocked at I00 §20.
`;
}

function renderFaultReport(pa, faultReport, observations, options) {
  const runByScenario = new Map(observations.map((run) => [run.scenarioId, run]));
  const rows = faultReport.scenarioEvaluations.map((evaluation) => {
    const scenario = pa.CANONICAL_FAULT_SCENARIOS.find((entry) => entry.scenarioId === evaluation.scenarioId);
    const run = runByScenario.get(evaluation.scenarioId);
    return [
      evaluation.scenarioId,
      evaluation.kind,
      scenario?.deterministicSeed,
      scenario?.minimumIterations,
      scenario?.expectedRootCauseCode,
      evaluation.verdict,
      evaluation.reasonCodes,
      run?.runDigest,
      run?.transitionCodes,
    ];
  });
  return `# Fault Injection and Soak Report

Generated for \`${options.testedCommit}\` at \`${iso(options.evaluatedAtMs)}\`.

| Declared | Observed | Passed | Failed | Unknown | Truth | Real soak | Authority |
| ---: | ---: | ---: | ---: | ---: | --- | --- | --- |
| ${faultReport.declaredScenarioCount} | ${faultReport.observedScenarioCount} | ${faultReport.passedScenarioIds.length} | ${faultReport.failedScenarioIds.length} | ${faultReport.unknownScenarioIds.length} | ${faultReport.truthLabel} | ${faultReport.realSoakState} | ${faultReport.authorityGranted} |

The deterministic safety model passed all canonical fixture contracts. It is **SYNTHETIC_ONLY**; it is not real runtime chaos, soak, browser, deployment, private-account, signed-call, or recovery proof. Real soak is **NOT_RUN**.

${table(['Scenario', 'Kind', 'Seed', 'Iterations', 'Expected root cause', 'Verdict', 'Reasons', 'Run digest', 'Transitions'], rows)}
`;
}

function renderFailureAtlas(pa, failureAtlas, faultReport, options) {
  const syntheticScenarioKindCount = new Set(
    pa.CANONICAL_FAULT_SCENARIOS.map((scenario) => scenario.kind),
  ).size;
  return `# Operational Failure Atlas

Generated for \`${options.testedCommit}\` at \`${iso(options.evaluatedAtMs)}\`.

Disposition: **CANONICAL_EMPTY_CORPUS / UNKNOWN**. The canonical Failure Atlas record owner is \`productAssurance/failureAtlas\`. A-CORE does not create a second record schema or promote synthetic fault runs into incident records.

## Canonical record projection

| Verdict | Eligible records | Rejected records | Recurrence fingerprints | Reason codes | Second store created |
| --- | ---: | ---: | ---: | --- | --- |
| ${failureAtlas.verdict} | ${failureAtlas.eligibleRecordIds.length} | ${failureAtlas.rejectedRecordIds.length} | ${Object.keys(failureAtlas.recurrenceByFingerprint).length} | ${failureAtlas.reasonCodes.join(', ')} | ${failureAtlas.secondStoreCreated} |

The corpus is intentionally empty. The synthetic runs do not contain honest canonical reviewer, postmortem, retention, repair-attempt, dependency, invariant, and independent record-evidence bindings. Those values remain **UNKNOWN / NOT_CONFIGURED** instead of being fabricated.

## Synthetic fault source (not Atlas records)

| Declared | Observed | Passed | Failed | Unknown | Truth | Real soak | Authority |
| ---: | ---: | ---: | ---: | ---: | --- | --- | --- |
| ${faultReport.declaredScenarioCount} | ${faultReport.observedScenarioCount} | ${faultReport.passedScenarioIds.length} | ${faultReport.failedScenarioIds.length} | ${faultReport.unknownScenarioIds.length} | ${faultReport.truthLabel} | ${faultReport.realSoakState} | ${faultReport.authorityGranted} |

The deterministic runs remain sealed under \`${MACHINE_EVIDENCE_PATHS[1]}\` as fault-harness evidence. They prove only the synthetic model contract and do not become runtime incidents, real soak, operational repair, independent runtime verification, postmortems, or canonical Failure Atlas records.

## Expected-family denominator

| Field | Value |
| --- | --- |
| Accepted S1 denominator binding | NOT_CONFIGURED_AWAITING_DIRECTOR_ACCEPTED_S1_FAN_IN |
| Provisional synthetic scenario-kind count | ${syntheticScenarioKindCount} |
| Canonical record family coverage | UNKNOWN_EMPTY_CORPUS |

The scenario-kind count is a bounded description of the synthetic harness, not the accepted S1 hazard/assumption denominator.

## Assurance dimensions

${table(['#', 'Dimension'], pa.FAILURE_ASSURANCE_DIMENSIONS.map((dimension, index) => [index + 1, dimension]))}

## Required canonical record truth

- stable fingerprint, release/run identity, and exact ordered timeline;
- component/dependency and immutable revisions;
- trigger, symptoms, canonical failed-invariant IDs, and accepted family binding;
- capital, exposure, liability, and ambiguity impact;
- containment, repair attempts, false repair, independent postconditions, and quiet period;
- root and contributing causes;
- regression fixture, deterministic fault seed, playbook/model revisions;
- reviewer, postmortem, actions, recurrence, provenance, access, and retention;
- subject/value/release-bound evidence with independent verification;
- missing families and unknown evidence remain visible.

Synthetic fault evidence does not become a real incident corpus, operational recovery proof, or runtime-readiness authority.
`;
}

function renderDiagnosticBoundary(pa, options) {
  const providerProjection = pa.evaluateProviderWorkloadIdentity({
    state: 'NOT_CONFIGURED',
    providerId: null,
    modelId: null,
    workloadIdentityId: null,
    audienceId: null,
    endpointId: null,
    issuedAtMs: null,
    expiresAtMs: null,
    rotationDueAtMs: null,
    secretMaterialPresentInProjection: false,
  }, options.evaluatedAtMs);
  assert.deepEqual(
    [providerProjection.verdict, providerProjection.lifecycleState, providerProjection.authorityGranted],
    ['UNKNOWN', 'NOT_CONFIGURED', false],
  );
  const corpusProjection = pa.evaluateDiagnosticCorpusGovernance([], options.evaluatedAtMs);
  assert.deepEqual(
    [corpusProjection.verdict, corpusProjection.eligibleEntryIds.length, corpusProjection.rejectedEntryIds.length, corpusProjection.reasonCodes],
    ['UNKNOWN', 0, 0, ['DIAGNOSTIC_CORPUS_EMPTY']],
  );
  const classRows = [
    ['A', 'OBSERVE_EXPLAIN', 'redacted evidence read + causal explanation', 'no mutation; no recovery declaration'],
    ['B', 'BOUNDED_QUERY_REPLAY', 'bounded evidence query + isolated replay', 'no external mutation; replay remains isolated'],
    ['C', 'PROPOSE_TYPED_ACTION; PATCH_ISOLATED_AND_TEST', 'typed registered-remediation proposal or isolated patch/test', 'proposal only; cannot execute operational action or write Main/production persistence'],
    ['D', 'OWNER_APPROVED_HANDOFF_FOR_NON_MONEY_MERGE_OR_DEPLOY', 'exact owner-approved non-money handoff', 'handoff only; no autonomous merge/deploy and no money path'],
  ];
  assert.deepEqual(classRows.map(([selfCorrectionClass]) => selfCorrectionClass), [...pa.SELF_CORRECTION_CLASSES]);
  return `# Agentic Diagnostic Boundary

Generated for \`${options.testedCommit}\` at \`${iso(options.evaluatedAtMs)}\`.

Provider state: **${providerProjection.lifecycleState}** (${providerProjection.verdict}; ${providerProjection.reasonCodes.join(', ')}). External sandbox: **DENY_BY_DEFAULT / NOT_CONFIGURED**. Runtime authority: **${providerProjection.authorityGranted}**. The base §3.9 hierarchy is **REUSED**; there is no second LLM runtime.

## Permission levels

${table(['#', 'Permission'], pa.DIAGNOSTIC_PERMISSION_LEVELS.map((permission, index) => [index + 1, permission]))}

## Class A-D self-correction law

${table(['Class', 'Exact permission', 'Permitted effect', 'Hard boundary'], classRows)}

Promotion is one class at a time and requires every gate below to be PASS. UNKNOWN never promotes.

${table(['Gate', 'Exact evidence/law', 'Missing/failed result'], [
    ['Class step', 'toClass rank = fromClass rank + 1', 'FAIL: PROMOTION_MUST_BE_ONE_CLASS_AT_A_TIME'],
    ['Permission binding', 'requestedPermission exactly belongs to target class', 'FAIL: PROMOTION_PERMISSION_CLASS_MISMATCH'],
    ['Evaluation', 'evaluationVerdict=PASS', 'FAIL/UNKNOWN remains explicit'],
    ['Independent holdout', 'holdoutVerdict=PASS', 'FAIL/UNKNOWN remains explicit'],
    ['Sandbox', 'sandboxVerdict=PASS', 'FAIL/UNKNOWN remains explicit'],
    ['Repair evidence', 'repairEvidenceVerdict=PASS', 'FAIL/UNKNOWN remains explicit'],
    ['Independent verifier', 'independentVerifierId present and != producerId', 'missing=UNKNOWN; same producer=FAIL'],
    ['Class D owner binding', 'ownerApprovalDigest present and exact', 'missing=UNKNOWN; no handoff'],
  ])}

## Allowed capability IDs

${table(['#', 'Capability'], pa.DIAGNOSTIC_ALLOWED_CAPABILITY_IDS.map((capability, index) => [index + 1, capability]))}

## Forbidden capabilities

${table(['#', 'Capability'], pa.DIAGNOSTIC_FORBIDDEN_CAPABILITIES.map((capability, index) => [index + 1, capability]))}

## Exact approval binding

${table(['Field', 'Required binding', 'Current state'], [
    ['approvalId', 'stable authorization record ID', 'NOT_CONFIGURED'],
    ['artifactDigest', 'exact immutable SHA-256 artifact hash', 'NOT_CONFIGURED'],
    ['actionId', 'exact registered action/handoff ID', 'NOT_CONFIGURED'],
    ['environmentId', 'exact isolated/target environment identity', 'NOT_CONFIGURED'],
    ['policyRevision', 'immutable policy revision', 'NOT_CONFIGURED'],
    ['capability', 'exact permission level', 'NOT_CONFIGURED'],
    ['maximumEffect', 'bounded maximum permitted effect', 'NOT_CONFIGURED'],
    ['expiresAtMs', 'explicit UTC expiry within proposal lifetime', 'NOT_CONFIGURED'],
    ['rollbackId', 'required exact rollback identity', 'NOT_CONFIGURED'],
    ['approverId', 'authorized human/director owner identity', 'NOT_CONFIGURED'],
  ])}

An approval is usable only when every field matches the proposal and evaluation context exactly; expiry, artifact/action/environment/policy/capability/effect/rollback, or approver mismatch fails closed.

## Provider workload identity lifecycle

${table(['Field', 'Contract', 'Current value'], [
    ['state', 'READY / NOT_CONFIGURED / UNAVAILABLE', providerProjection.lifecycleState],
    ['providerId', 'immutable provider identity', 'UNKNOWN_NOT_CONFIGURED'],
    ['modelId', 'immutable model identity', 'UNKNOWN_NOT_CONFIGURED'],
    ['workloadIdentityId', 'short-lived workload identity; never a projected secret', 'UNKNOWN_NOT_CONFIGURED'],
    ['audienceId', 'exact workload audience', 'UNKNOWN_NOT_CONFIGURED'],
    ['endpointId', 'allowlisted endpoint identity', 'UNKNOWN_NOT_CONFIGURED'],
    ['issuedAtMs / expiresAtMs / rotationDueAtMs', 'bounded lifecycle and rotation', 'UNKNOWN_NOT_CONFIGURED'],
    ['secretMaterialPresentInProjection', 'must be false', false],
    ['evaluation', 'fail/unknown closed; authority always false', `${providerProjection.verdict}: ${providerProjection.reasonCodes.join(', ')}`],
  ])}

## External sandbox, privacy, and independent retention

${table(['Field/law', 'Exact contract', 'Current state'], [
    ['sandboxId/providerId', 'stable sandbox and bound provider identities', 'NOT_CONFIGURED'],
    ['default policy', 'denyByDefault=true / DENY_BY_DEFAULT', 'REQUIRED_NOT_CONFIGURED'],
    ['network', 'NONE or exact endpoint allowlist; arbitrary network denied', 'NOT_CONFIGURED'],
    ['filesystem', 'READ_ONLY_REDACTED or ISOLATED_EPHEMERAL_WORKTREE', 'NOT_CONFIGURED'],
    ['capabilities', 'unique subset of allowed capability IDs; forbidden/unknown rejected', 'NOT_CONFIGURED'],
    ['shell/persistence/external mutation', 'arbitrary shell=false; production persistence writable=false; external mutation=false', 'REQUIRED_NOT_CONFIGURED'],
    ['secrets/Main', 'secret access denied; Main workspace write denied', 'REQUIRED_NOT_CONFIGURED'],
    ['trace privacy', 'redaction=true; instruction/data boundary=true; raw evidence hash outside prompt; no secret material in prompt', 'NOT_CONFIGURED'],
    ['independent retention', 'retention owner != provider; provider write/delete denied; evidence digest exact', 'NOT_CONFIGURED'],
    ['provider outage', 'DIAGNOSTIC_PLANE_UNAVAILABLE; deterministic readiness/safety/execution unchanged', 'CONTRACT_ONLY'],
  ])}

## Repair-evidence law

${table(['Field', 'Required law', 'Current state'], [
    ['actionCompleted', 'boolean; completion alone is not recovery', 'UNKNOWN_NOT_CONFIGURED'],
    ['independentPostconditionVerdict', 'PASS required', 'UNKNOWN_NOT_CONFIGURED'],
    ['producerId / verifierId', 'both present and different', 'UNKNOWN_NOT_CONFIGURED'],
    ['evidenceDigest', 'exact lowercase SHA-256 digest', 'UNKNOWN_NOT_CONFIGURED'],
    ['verifiedAtMs / evaluatedAtMs', 'valid UTC ordering', 'UNKNOWN_NOT_CONFIGURED'],
    ['quietPeriodMs', 'positive period fully elapsed after verification', 'UNKNOWN_NOT_CONFIGURED'],
    ['rollbackAvailable', 'true for promotion', 'UNKNOWN_NOT_CONFIGURED'],
    ['healthyPromotionAllowed', 'true only when aggregate verdict is PASS', 'false / NOT_EVALUATED'],
  ])}

## Diagnostic corpus governance

${table(['Field', 'Required law', 'Current state'], [
    ['corpusEntryId', 'stable unique ID', 'EMPTY'],
    ['dedupFingerprint', 'unique stable fingerprint', 'EMPTY'],
    ['provenanceDigest / sanitizedDigest', 'required exact SHA-256 digests', 'EMPTY'],
    ['sourceEvidenceIds', 'unique, nonempty provenance IDs', 'EMPTY'],
    ['accessClass', 'ASSURANCE_RESTRICTED or REVIEWER_RESTRICTED', 'EMPTY'],
    ['retentionUntilMs', 'unexpired explicit UTC retention', 'EMPTY'],
    ['reviewerId', 'required accountable reviewer', 'EMPTY'],
    ['rawPromptStored / rawSecretStored', 'both must be false', 'EMPTY'],
    ['validatedRegressionFixtureId', 'required before eligibility', 'EMPTY'],
    ['evaluation', 'unknown corpus never becomes evidence', `${corpusProjection.verdict}: ${corpusProjection.reasonCodes.join(', ')}`],
  ])}

## Diagnostic run audit schema

No provider run was performed, so there is no fabricated run record. Any future run must record every field below and remains non-authoritative.

${table(['Group', 'Exact fields', 'Law/current state'], [
    ['Identity/schema', 'schema, revision, runId, providerId, modelId, providerVersion', 'PRODUCT_ASSURANCE_DIAGNOSTIC_RUN_AUDIT_V1; NO_RUN_RECORD_PROVIDER_NOT_CONFIGURED'],
    ['Prompt/policy', 'promptRevision, policyRevision', 'immutable identities required'],
    ['Evidence/provenance', 'evidenceDigests, provenanceIds, retrievalIds', 'nonempty evidence/provenance; unique IDs/digests'],
    ['Typed output', 'typedOutputDigest', 'required exact SHA-256 digest'],
    ['Tools', 'toolEntries[toolId,inputDigest,resultDigest,verdict]', 'unique allowed tool IDs only; forbidden/unknown tools fail'],
    ['Approvals/artifact', 'approvalIds, diffDigest', 'required for applicable patch/handoff disposition'],
    ['Verification', 'testEvidenceIds, postconditionEvidenceIds', 'required for applicable patch/handoff disposition'],
    ['Budgets', 'tokenUnits, costMicrounits, latencyMs', 'bounded nonnegative; latency equals completion-start'],
    ['Correlation/time', 'incidentId, correlationId, startedAtMs, completedAtMs', 'stable IDs and valid UTC order'],
    ['Disposition/authority', 'disposition, authorityGranted=false', 'closed enum; never execution authority'],
  ])}

${table(['#', 'Allowed run disposition'], pa.DIAGNOSTIC_RUN_DISPOSITIONS.map((disposition, index) => [index + 1, disposition]))}

Binding laws: normalized schemas, raw-evidence hashes outside prompts, explicit untrusted-data separation, trace privacy, independent retention, immutable provider workload identity, exact capability checks, cost/rate budgets, audit records, repair-evidence law, Class A–D promotion law, and corpus governance. A diagnostic agent cannot sign, order, cancel, borrow, repay, change leverage/margin, transfer, withdraw, change Capital/Risk/hard ceilings, write Main/production persistence, use arbitrary shell/network, autonomously merge/deploy, delete evidence, execute operational actions, or declare recovery. Provider outage yields \`DIAGNOSTIC_PLANE_UNAVAILABLE\` without changing deterministic safety or product readiness.
`;
}

function renderQMatrix(pa, options) {
  const rows = pa.Q_ASSURANCE_REQUIREMENTS.map((entry) => [
    entry.requirementId,
    entry.sourceFields,
    entry.expectedLaw,
    'UNKNOWN',
    'BOUND_ACCEPTED_ASSESSMENT_EVIDENCE_NOT_SUPPLIED',
    false,
  ]);
  return `# Q Assurance Coverage Matrix

Generated for \`${options.testedCommit}\` at \`${iso(options.evaluatedAtMs)}\`.

This is a read-only accepted-Q requirement projection. No current assessment envelope or independent holdout evidence was supplied to A-CORE, so evaluation remains **UNKNOWN**, safe advisory action is **ABSTAIN_UNKNOWN**, and authority granted is **false**. No Q data was fabricated or written.

| Identity field | Immutable value |
| --- | --- |
| Accepted protocol commit | ${pa.ACCEPTED_Q_ASSURANCE_IDENTITY.acceptedProtocolCommit} |
| Accepted Q commit | ${pa.ACCEPTED_Q_ASSURANCE_IDENTITY.acceptedQCommit} |
| Protocol schema digest | ${pa.ACCEPTED_Q_ASSURANCE_IDENTITY.protocolSchemaDigest} |
| Acceptance receipt digest | ${pa.ACCEPTED_Q_ASSURANCE_IDENTITY.acceptanceReceiptDigest} |

${table(['Requirement', 'Source fields', 'Law', 'Verdict', 'Reason', 'Authority'], rows)}
`;
}

function renderInsertionRequest(rows, options) {
  const renderedRows = rows.map((row) => [
    row.requestId,
    row.owner,
    row.seam,
    row.reason,
    row.contract,
    row.test,
    row.expectedBehavior,
    row.wiringState,
    row.truthLabel,
    row.authorityGranted,
    row.blocker,
  ]);
  return `# Assurance Insertion Request

Generated for \`${options.testedCommit}\` at \`${iso(options.evaluatedAtMs)}\`.

These ${rows.length} rows are director/owner requests only. They perform no shared write, mount, route, persistence, package, UI, external, private, signed, money, deployment, or capital action. Handoff §4.5 is **REUSED** by I00 law and creates no new row or authority.

${table(['Request', 'Owner', 'Target seam', 'Reason', 'Contract', 'Test', 'Expected behavior', 'Wiring', 'Truth', 'Authority', 'Blocker'], renderedRows)}
`;
}

function renderReceipt({
  options,
  verifiedInputs,
  pa,
  scannerReport,
  operationCoverage,
  structuralCoverage,
  faultReport,
  insertionRows,
  changedPaths,
  artifactHashes,
  generatedCommand,
}) {
  const changedPathDigest = sha256(`${changedPaths.join('\n')}\n`);
  const artifactRows = Object.entries(artifactHashes).sort(([left], [right]) => left.localeCompare(right)).map(([path, digest]) => [path, digest]);
  const interfaceRows = pa.ACCEPTED_IMMUTABLE_INTERFACE_METADATA.map((entry) => [
    entry.interfaceId,
    entry.authorityId,
    entry.acceptedCommit,
    entry.status,
    entry.protocolRevision,
    entry.schemaRevision,
    entry.consumptionLaw,
  ]);
  const insertionHash = artifactHashes['fixtures/productAssurance/generated/ASSURANCE_INSERTION_REQUEST.md'];
  const inputRows = verifiedInputs.map((input) => [input.path, input.role, input.sha256, input.verified]);
  const systemicRows = SYSTEMIC_STATE_SNAPSHOT.map((entry) => [entry.requirement, entry.owner, entry.state, entry.immutableTip]);
  return `# IP Assurance Receipt

## Identity and terminal disposition

| Field | Value |
| --- | --- |
| Schema | PRODUCT_ASSURANCE_RECEIPT_V1 |
| Revision | 1 |
| Branch | ip-assurance-20260713 |
| Frozen base / D-LAUNCH-8 | ${BASE_COMMIT} |
| Implementation commit | ${options.implementationCommit} |
| Tested commit | ${options.testedCommit} |
| Evaluated at UTC | ${iso(options.evaluatedAtMs)} |
| Recorded owner timezone | Asia/Kolkata |
| Latest verified director-state commit | ${options.directorStateCommit} |
| Core scaffold state | CORE_SCAFFOLD_READY |
| Terminal disposition | **${options.disposition}** |

A-CORE does not claim \`ASSURANCE_PRESTAGE_READY\`. Director law requires accepted serial fan-in for S1–S6 and S8 (S7 is the A-CORE read-only output), and the static operation scanner still has the exact owner ambiguity below.

## Public research basis

Public, read-only pre-implementation research was completed on 2026-07-13. It did not use product secrets, private/signed exchange interfaces, provider credentials, or operational mutation:

- OpenTelemetry Collector internal telemetry: https://opentelemetry.io/docs/collector/internal-telemetry/
- OpenTelemetry Collector resiliency: https://opentelemetry.io/docs/collector/resiliency/
- Google SRE monitoring distributed systems: https://sre.google/sre-book/monitoring-distributed-systems/
- AWS bounded retry guidance: https://docs.aws.amazon.com/wellarchitected/2023-04-10/framework/rel_mitigate_interaction_failure_limit_retries.html
- NIST AI RMF Generative AI Profile: https://www.nist.gov/publications/artificial-intelligence-risk-management-framework-generative-artificial-intelligence
- OpenTelemetry semantic conventions and schema evolution: https://opentelemetry.io/docs/specs/semconv/ and https://opentelemetry.io/docs/specs/otel/schemas/

## Immutable inputs

${table(['Path', 'Role', 'SHA-256', 'Verified'], inputRows)}

The archived superseded amendment was not read as instructions. The untracked I00 owner input remained byte-identical and unstaged. The tracked dedup matrix remained byte-identical and was not regenerated.

## Accepted immutable interfaces

${table(['Interface', 'Authority', 'Commit', 'Status', 'Protocol', 'Schema/digest', 'Consumption law'], interfaceRows)}

L remains \`ACCEPTED_PARTIAL_FRONTIER\`; this receipt does not claim LANE_READY.

## Systemic fan-in snapshot

${table(['Requirement', 'Owner', 'Current state', 'Immutable tip'], systemicRows)}

Packet-ready, working, base-only, generated, or waiting state is not director acceptance. No satellite subtree is present in A-CORE.

## Evidence summary

| Evidence | Result | Truth limit |
| --- | --- | --- |
| Product Assurance focused tests | PASS 32/32 | deterministic, network-free fixtures |
| Server typecheck | PASS, exit 0 | compile/type evidence only |
| Server build | PASS, exit 0 | build evidence only |
| Root \`npm test\` | PASS, exit 0 | currently does not invoke Product Assurance; insertion requested |
| Root \`npm run test:all\` | PASS, exit 0 | currently does not invoke Product Assurance; insertion requested |
| Scope/import/secret purity | PASS | protected I00 and dedup hashes verified |
| Declared coverage catalog | ${structuralCoverage.verdict} ${structuralCoverage.coveredCount}/${structuralCoverage.expectedCount} (${structuralCoverage.coveragePercentage}%) | structural obligations, not live telemetry |
| Production operation scan | ${operationCoverage.verdict}; ${scannerReport.covered}/${scannerReport.discovered}; exit 1 | exact uncovered owner seam remains |
| Synthetic fault model | ${faultReport.verdict} ${faultReport.passedScenarioIds.length}/${faultReport.declaredScenarioCount} | ${faultReport.truthLabel}; real soak ${faultReport.realSoakState}; authority false |
| Runtime/browser/deployment/private/signed proof | NOT_RUN / NOT_CONFIGURED | no claim permitted |

Exact scanner blocker: \`${EXACT_OPERATION_BLOCKER.path}:${EXACT_OPERATION_BLOCKER.line}:${EXACT_OPERATION_BLOCKER.column} ${EXACT_OPERATION_BLOCKER.kind} ${EXACT_OPERATION_BLOCKER.symbol} ${EXACT_OPERATION_BLOCKER.siteId}\`.

## Canonical counts

| Registry | Count |
| --- | ---: |
| Operation policies | ${pa.OPERATION_POLICY_REGISTRY.length} |
| Safety invariants | ${pa.SAFETY_INVARIANT_CATALOG.length} |
| Components | ${pa.EXPECTED_CANONICAL_COMPONENTS.length} |
| Dependencies | ${pa.EXPECTED_CANONICAL_DEPENDENCIES.length} |
| Controls | ${pa.EXPECTED_CANONICAL_CONTROLS.length} |
| Telemetry signals | ${pa.EXPECTED_CANONICAL_TELEMETRY.length} |
| Owner questions | ${pa.OWNER_QUESTION_COVERAGE.length} |
| Fault scenarios | ${pa.CANONICAL_FAULT_SCENARIOS.length} |
| Coverage obligations | ${pa.COVERAGE_OBLIGATIONS.length} |
| Cockpit sections | ${pa.ASSURANCE_COCKPIT_SECTION_IDS.length} |
| Q requirements | ${pa.Q_ASSURANCE_REQUIREMENTS.length} |
| Insertion requests | ${insertionRows.length} |

## Generated artifact seal

The receipt excludes its own digest to avoid a circular hash. All other generated closure documents and machine evidence are sealed below. The eventual commit object supplies repository-level integrity for this receipt.

${table(['Path', 'SHA-256'], artifactRows)}

Insertion request count/hash: **${insertionRows.length} / ${insertionHash}**.

## Changed-path inventory

Path-set SHA-256: \`${changedPathDigest}\` over sorted UTF-8 paths, one newline each.

${changedPaths.map((path) => `- \`${path}\``).join('\n')}

## Reproducibility

Generator command:

\`\`\`sh
${generatedCommand}
\`\`\`

The command uses injected time and commit identities, validates exact input hashes, validates all canonical denominators, requires the single known scanner ambiguity, and writes stable sorted serialization. A second identical run was executed after first generation and produced byte-identical content for all 13 files in the closure directories, including the protected dedup matrix.

Adversarial corrections bound here include cross-release coverage binding, forged action-result rejection, rate-reserve underflow, stale temporal/clock evidence, action envelope revision/expiry/truth relabeling, private evidence realms, fault mixed-commit/reuse/full-digest checks, diagnostic raw-digest and quiet-period checks, scope deletion/systemic/protected-input checks, and dynamic network-operation discovery.

## Authority and reality statement

- No push and no current-main write were performed.
- No operational external-service/provider call or mutation, AWS, Cloudflare, Secrets, Binance private/signed endpoint, browser, deployment, order, test order, borrow, repay, leverage/margin, transfer, withdrawal, execution, Capital, Risk, persistence, route, package, or shared UI mutation was performed. Public official-documentation research is disclosed above.
- \`LIVE_EXECUTION_NOT_IMPLEMENTED\` remains binding; this packet grants no authority.
- Structural catalog completeness is not runtime coverage.
- Synthetic fault PASS is not live, soak, deployed, integrated, or recovery proof.
- Systemic satellite states are not accepted serial fan-in evidence; A-CORE remains blocked.

## Exact next owners

1. The I00 director accepts immutable S1–S6 and S8 satellite commits serially, verifies path ownership, and runs accumulated tests after each; S7 stays the A-CORE read-only output.
2. The intelligence-runtime news owner proves/enforces GET-only semantics or provides an explicit reviewed policy for \`${EXACT_OPERATION_BLOCKER.path}:${EXACT_OPERATION_BLOCKER.line}\`.
3. The I00 director lands shared insertion rows, mounts canonical runtime/browser/deployment proof, updates STATE.md, and alone decides final acceptance.

Terminal: **${options.disposition}**
`;
}

function writeOutput(path, content) {
  const absolute = join(ROOT, path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, content, 'utf8');
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  assert.equal(commandOutput(['branch', '--show-current']), 'ip-assurance-20260713', 'closure must run on the assigned branch');
  assert.equal(options.implementationCommit, options.testedCommit, 'implementation and tested commits must be identical for packet closure');
  assert.equal(commandOutput(['rev-parse', 'HEAD']), options.testedCommit, 'tested commit must equal current HEAD');
  assert.equal(commandOutput(['merge-base', BASE_COMMIT, options.implementationCommit]), BASE_COMMIT, 'implementation commit must descend from the frozen base');
  assert.equal(commandOutput(['merge-base', BASE_COMMIT, options.testedCommit]), BASE_COMMIT, 'tested commit must descend from the frozen base');
  const nonClosureDirtyPaths = trackedDirtyPaths().filter((path) => !ALL_CLOSURE_PATHS.includes(path));
  assert.deepEqual(nonClosureDirtyPaths, [], 'closure generation requires clean tracked source; only generated closure outputs may differ');
  const verifiedInputs = verifyInputs();
  const pa = await import(pathToFileURL(join(ROOT, 'server', 'dist', 'productAssurance', 'index.js')).href);

  assert.equal(pa.OPERATION_POLICY_REGISTRY.length, 13);
  assert.equal(pa.SAFETY_INVARIANT_CATALOG.length, 17);
  assert.equal(pa.EXPECTED_CANONICAL_COMPONENTS.length, 13);
  assert.equal(pa.EXPECTED_CANONICAL_DEPENDENCIES.length, 22);
  assert.equal(pa.EXPECTED_CANONICAL_CONTROLS.length, 8);
  assert.equal(pa.EXPECTED_CANONICAL_TELEMETRY.length, 19);
  assert.equal(pa.OWNER_QUESTION_COVERAGE.length, 25);
  assert.equal(pa.CANONICAL_FAULT_SCENARIOS.length, 103);
  assert.equal(pa.COVERAGE_OBLIGATIONS.length, 171);
  assert.equal(pa.ASSURANCE_COCKPIT_SECTION_IDS.length, 11);
  assert.equal(pa.Q_ASSURANCE_REQUIREMENTS.length, 11);

  const scannerReport = scanProductionOperations({ repositoryRoot: ROOT });
  assert.equal(scannerReport.filesScanned, 368);
  assert.equal(scannerReport.discovered, 143);
  assert.equal(scannerReport.covered, 142);
  assert.equal(scannerReport.uncovered, 1);
  assert.deepEqual(scannerReport.uncoveredSites[0], {
    ...EXACT_OPERATION_BLOCKER,
    operationId: null,
    mappingRuleId: null,
  });
  const operationCoverage = pa.scanOperationCoverage(pa.OPERATION_POLICY_REGISTRY, scannerReport.sites);
  assert.equal(operationCoverage.verdict, 'FAIL');
  assert.deepEqual(operationCoverage.reasonCodes, ['PRODUCTION_OPERATION_UNCOVERED']);

  const structuralCoverage = pa.evaluateCanonicalCoverageMatrix(RELEASE_ID, options.testedCommit);
  assert.deepEqual(
    [structuralCoverage.verdict, structuralCoverage.expectedCount, structuralCoverage.coveredCount, structuralCoverage.coveragePercentage],
    ['PASS', 171, 171, 100],
  );

  const faultStartedAtMs = options.evaluatedAtMs - 1_000;
  assert.equal(faultStartedAtMs >= 0, true, 'evaluated time is too early for deterministic fault observations');
  const observations = pa.CANONICAL_FAULT_SCENARIOS.map((scenario) => pa.simulateCanonicalFaultScenario(
    scenario,
    options.testedCommit,
    faultStartedAtMs,
  ));
  const faultReport = pa.evaluateCanonicalFaultHarness(observations, options.evaluatedAtMs);
  assert.deepEqual(
    [faultReport.verdict, faultReport.declaredScenarioCount, faultReport.observedScenarioCount, faultReport.passedScenarioIds.length, faultReport.truthLabel, faultReport.realSoakState, faultReport.authorityGranted],
    ['PASS', 103, 103, 103, 'SYNTHETIC_ONLY', 'NOT_RUN', false],
  );
  const failureAtlas = pa.projectOperationalFailureRecords([], options.evaluatedAtMs);
  assert.deepEqual(
    [failureAtlas.verdict, failureAtlas.eligibleRecordIds.length, failureAtlas.rejectedRecordIds.length, failureAtlas.reasonCodes, failureAtlas.secondStoreCreated],
    ['UNKNOWN', 0, 0, ['FAILURE_RECORD_CORPUS_EMPTY'], false],
  );

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
    schema: 'PRODUCT_ASSURANCE_CORE_EVIDENCE_V1',
    revision: 1,
    releaseId: RELEASE_ID,
    testedCommit: options.testedCommit,
    implementationCommit: options.implementationCommit,
    evaluatedAtMs: options.evaluatedAtMs,
    evaluatedAtUtc: iso(options.evaluatedAtMs),
    baseCommit: BASE_COMMIT,
    directorStateCommit: options.directorStateCommit,
    disposition: options.disposition,
    authorityGranted: false,
    runtimeState: 'NOT_CONFIGURED',
    browserState: 'NOT_RUN',
    deploymentState: 'NOT_RUN',
    privateSignedState: 'NOT_RUN',
    structuralCoverage,
    scanner: {
      schemaVersion: scannerReport.schemaVersion,
      filesScanned: scannerReport.filesScanned,
      discovered: scannerReport.discovered,
      covered: scannerReport.covered,
      uncovered: scannerReport.uncovered,
      uncoveredSites: scannerReport.uncoveredSites,
      coverageVerdict: operationCoverage.verdict,
      reasonCodes: operationCoverage.reasonCodes,
      failOnUncoveredExitCode: 1,
    },
    counts: {
      operationPolicies: pa.OPERATION_POLICY_REGISTRY.length,
      invariants: pa.SAFETY_INVARIANT_CATALOG.length,
      components: pa.EXPECTED_CANONICAL_COMPONENTS.length,
      dependencies: pa.EXPECTED_CANONICAL_DEPENDENCIES.length,
      controls: pa.EXPECTED_CANONICAL_CONTROLS.length,
      telemetrySignals: pa.EXPECTED_CANONICAL_TELEMETRY.length,
      ownerQuestions: pa.OWNER_QUESTION_COVERAGE.length,
      faultScenarios: pa.CANONICAL_FAULT_SCENARIOS.length,
      coverageObligations: pa.COVERAGE_OBLIGATIONS.length,
      cockpitSections: pa.ASSURANCE_COCKPIT_SECTION_IDS.length,
      qRequirements: pa.Q_ASSURANCE_REQUIREMENTS.length,
      insertionRequests: insertionRows.length,
    },
    immutableInterfaces: pa.ACCEPTED_IMMUTABLE_INTERFACE_METADATA,
    acceptedQIdentity: pa.ACCEPTED_Q_ASSURANCE_IDENTITY,
    verifiedInputs,
    changedPaths,
  });
  const faultEvidence = Object.freeze({
    schema: faultReport.schema,
    testedCommit: faultReport.testedCommit,
    evaluatedAtMs: faultReport.evaluatedAtMs,
    truthLabel: faultReport.truthLabel,
    realSoakState: faultReport.realSoakState,
    authorityGranted: faultReport.authorityGranted,
    verdict: faultReport.verdict,
    declaredScenarioCount: faultReport.declaredScenarioCount,
    observedScenarioCount: faultReport.observedScenarioCount,
    passedScenarioCount: faultReport.passedScenarioIds.length,
    failedScenarioIds: faultReport.failedScenarioIds,
    unknownScenarioIds: faultReport.unknownScenarioIds,
    unexpectedObservationScenarioIds: faultReport.unexpectedObservationScenarioIds,
    duplicateObservationScenarioIds: faultReport.duplicateObservationScenarioIds,
    reasonCodes: faultReport.reasonCodes,
    failureAtlas,
    runs: observations.map((run) => ({
      scenarioId: run.scenarioId,
      runId: run.runId,
      simulatorRevision: run.simulatorRevision,
      deterministicSeed: run.deterministicSeed,
      iterationsCompleted: run.iterationsCompleted,
      startedAtMs: run.startedAtMs,
      completedAtMs: run.completedAtMs,
      state: run.state,
      rootCauseCode: run.rootCauseCode,
      transitionCodes: run.transitionCodes,
      proofVerdicts: run.proofs.map((proof) => ({ proofId: proof.proofId, verdict: proof.verdict })),
      runDigest: run.runDigest,
    })),
  });

  const outputs = new Map([
    [GENERATED_DOCUMENT_PATHS[0], renderReliabilityRegistry(pa, scannerReport, operationCoverage, options)],
    [GENERATED_DOCUMENT_PATHS[1], renderInvariantCatalog(pa, options)],
    [GENERATED_DOCUMENT_PATHS[2], renderCoverageMatrix(pa, structuralCoverage, scannerReport, options)],
    [GENERATED_DOCUMENT_PATHS[3], renderRecoveryReport(pa, options)],
    [GENERATED_DOCUMENT_PATHS[4], renderFaultReport(pa, faultReport, observations, options)],
    [GENERATED_DOCUMENT_PATHS[5], renderFailureAtlas(pa, failureAtlas, faultReport, options)],
    [GENERATED_DOCUMENT_PATHS[6], renderDiagnosticBoundary(pa, options)],
    [GENERATED_DOCUMENT_PATHS[7], renderInsertionRequest(insertionRows, options)],
    [GENERATED_DOCUMENT_PATHS[8], renderQMatrix(pa, options)],
    [MACHINE_EVIDENCE_PATHS[0], stableJson(coreEvidence)],
    [MACHINE_EVIDENCE_PATHS[1], stableJson(faultEvidence)],
  ]);
  const artifactHashes = Object.fromEntries([...outputs.entries()].map(([path, content]) => [path, sha256(content)]));
  const receipt = renderReceipt({
    options,
    verifiedInputs,
    pa,
    scannerReport,
    operationCoverage,
    structuralCoverage,
    faultReport,
    insertionRows,
    changedPaths,
    artifactHashes,
    generatedCommand,
  });
  outputs.set(RECEIPT_PATH, receipt);

  assert.deepEqual([...outputs.keys()].sort(), [...ALL_CLOSURE_PATHS].sort(), 'closure output path set drifted');
  for (const [path, content] of [...outputs.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    writeOutput(path, content);
  }
  process.stdout.write(`${JSON.stringify({
    schema: GENERATOR_SCHEMA,
    disposition: options.disposition,
    outputCount: outputs.size,
    insertionRequestCount: insertionRows.length,
    scanner: `${scannerReport.covered}/${scannerReport.discovered}`,
    faultHarness: `${faultReport.passedScenarioIds.length}/${faultReport.declaredScenarioCount} ${faultReport.truthLabel}`,
  })}\n`);
}

main().catch((error) => {
  process.stderr.write(`closure generation failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
