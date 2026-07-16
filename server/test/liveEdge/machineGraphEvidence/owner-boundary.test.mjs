import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  CANONICAL_SYSTEM_COMPONENT_IDS,
  MACHINE_GRAPH_ALARMS,
  MACHINE_GRAPH_CONTROL_ACTIONS,
  MACHINE_GRAPH_METRICS,
  MACHINE_GRAPH_METRIC_INSTRUMENTS,
  MACHINE_GRAPH_METRIC_UNITS,
  MACHINE_GRAPH_ROLES,
} from '../../../dist/liveEdge/adapters/machineGraphEvidence/index.js';
import {
  DESIRED_RUNTIME_STATES,
  RUNTIME_PHASES,
} from '../../../dist/foundation/contracts/index.js';
import { RATE_STATES } from '../../../dist/foundation/observability/types.js';
import { DURABLE_CONTROL_ACTION_TYPES } from '../../../dist/liveEdge/controls/types.js';
import { SYSTEM_COMPONENT_IDS } from '../../../dist/systemIntegration/contracts/constants.js';
import * as machineGraphEvidence from '../../../dist/liveEdge/adapters/machineGraphEvidence/index.js';

const EXPECTED_ROLES = Object.freeze([
  'SECRETS_BOUNDARY',
  'CLOCK_SYNCHRONIZATION',
  'SPOT_PUBLIC_STREAM',
  'USD_M_PUBLIC_STREAM',
  'SPOT_PRIVATE_STREAM',
  'USD_M_PRIVATE_STREAM',
  'MARGIN_PRIVATE_STREAM',
  'INSTRUMENT_FILTER_REGISTRY',
  'ACCOUNT_TRUTH',
  'EVIDENCE_ATTENTION_RUNTIME',
  'QUANT_BRIDGE',
  'BASIS_ENGINE',
  'VOLUME_ENGINE',
  'PROPOSAL_REJECTION_AUTHORITY',
  'CAPITAL_GATE',
  'RISK_GATE',
  'EXECUTION_HAND',
  'BASIS_COORDINATOR',
  'VOLUME_LIFECYCLE',
  'EXPOSURE_POSITION_SUPERVISOR',
  'RECONCILIATION',
  'OUTCOME_QUANT_FEEDBACK',
  'LEDGER_READ_MODEL',
  'DATABASE',
  'EC2_PROCESS',
  'CLOUDFLARE_TUNNEL_ACCESS',
  'WATCHDOG_ALARMS',
]);

const EXPECTED_METRICS = Object.freeze([
  'DEPLOYED_REVISION',
  'SCHEMA_VERSION',
  'CONFIG_VERSION',
  'SERVER_TIME_OFFSET_MS',
  'SERVER_TIME_DRIFT_MS',
  'PUBLIC_EVENT_AGE_MS',
  'PRIVATE_EVENT_AGE_MS',
  'STREAM_RECONNECT_COUNT',
  'MALFORMED_EVENT_COUNT',
  'REST_RECONCILIATION_AGE_MS',
  'RATE_LIMIT_UTILIZATION_PPM',
  'RATE_LIMIT_COOLDOWN_MS',
  'DECISION_AGE_MS',
  'ASSESSMENT_AGE_MS',
  'TICKET_ACK_LATENCY_MS',
  'ORDER_ACK_LATENCY_MS',
  'AMBIGUOUS_MUTATION_COUNT',
  'PARTIAL_FILL_COUNT',
  'UNHEDGED_NOTIONAL',
  'UNHEDGED_DURATION_MS',
  'RECONCILIATION_MISMATCH_COUNT',
  'ORPHAN_COUNT',
  'MARGIN_LIABILITY',
  'MARGIN_INTEREST',
  'RECOVERY_QUEUE_DEPTH',
  'RECOVERY_QUEUE_AGE_MS',
  'DATABASE_COMMIT_FAILURE_COUNT',
  'LEDGER_FAILURE_COUNT',
  'PROCESS_RESTART_COUNT',
  'EVENT_LOOP_LAG_MS',
  'CPU_UTILIZATION_PPM',
  'MEMORY_USAGE_BYTES',
  'DISK_FREE_BYTES',
  'BACKUP_HEALTH',
  'RESTORE_HEALTH',
  'ROLLBACK_HEALTH',
]);

const EXPECTED_ALARMS = Object.freeze([
  'PROCESS_ABSENT',
  'STALE_PRIVATE_TRUTH',
  'UNHEDGED_EXPOSURE_DURATION_EXCEEDED',
  'RECONCILIATION_MISMATCH',
  'RECOVERY_REQUIRED',
  'DISK_OR_DATABASE_FAILURE',
  'CLOCK_SKEW',
  'REPEATED_AMBIGUOUS_EXCHANGE_MUTATIONS',
  'SECRET_FETCH_FAILURE',
  'QUANT_PROTOCOL_INCOMPATIBILITY',
  'CLOUDFLARE_TUNNEL_OR_ACCESS_FAILURE',
  'BACKUP_STALE',
  'TRADE_UNSAFE',
]);

const EXPECTED_DESIRED_RUNTIME_STATES = Object.freeze(['STOPPED', 'RUNNING', 'PAUSED']);
const EXPECTED_RUNTIME_PHASES = Object.freeze([
  'STOPPED',
  'VALIDATING',
  'STARTING',
  'RUNNING',
  'DEGRADED',
  'PAUSING',
  'PAUSED',
  'STOPPING',
  'BLOCKED',
  'FAILED',
]);
const EXPECTED_RATE_STATES = Object.freeze([
  'KNOWN',
  'STALE',
  'COUNTER_RESET',
  'INVALID_WINDOW',
  'CLOCK_SKEWED',
  'UNKNOWN',
]);

const EXPECTED_METRIC_INSTRUMENTS = Object.freeze({
  DEPLOYED_REVISION: 'REVISION',
  SCHEMA_VERSION: 'VERSION',
  CONFIG_VERSION: 'VERSION',
  SERVER_TIME_OFFSET_MS: 'GAUGE',
  SERVER_TIME_DRIFT_MS: 'GAUGE',
  PUBLIC_EVENT_AGE_MS: 'GAUGE',
  PRIVATE_EVENT_AGE_MS: 'GAUGE',
  STREAM_RECONNECT_COUNT: 'COUNTER',
  MALFORMED_EVENT_COUNT: 'COUNTER',
  REST_RECONCILIATION_AGE_MS: 'GAUGE',
  RATE_LIMIT_UTILIZATION_PPM: 'GAUGE',
  RATE_LIMIT_COOLDOWN_MS: 'GAUGE',
  DECISION_AGE_MS: 'GAUGE',
  ASSESSMENT_AGE_MS: 'GAUGE',
  TICKET_ACK_LATENCY_MS: 'GAUGE',
  ORDER_ACK_LATENCY_MS: 'GAUGE',
  AMBIGUOUS_MUTATION_COUNT: 'COUNTER',
  PARTIAL_FILL_COUNT: 'COUNTER',
  UNHEDGED_NOTIONAL: 'GAUGE',
  UNHEDGED_DURATION_MS: 'GAUGE',
  RECONCILIATION_MISMATCH_COUNT: 'COUNTER',
  ORPHAN_COUNT: 'COUNTER',
  MARGIN_LIABILITY: 'GAUGE',
  MARGIN_INTEREST: 'GAUGE',
  RECOVERY_QUEUE_DEPTH: 'GAUGE',
  RECOVERY_QUEUE_AGE_MS: 'GAUGE',
  DATABASE_COMMIT_FAILURE_COUNT: 'COUNTER',
  LEDGER_FAILURE_COUNT: 'COUNTER',
  PROCESS_RESTART_COUNT: 'COUNTER',
  EVENT_LOOP_LAG_MS: 'GAUGE',
  CPU_UTILIZATION_PPM: 'GAUGE',
  MEMORY_USAGE_BYTES: 'GAUGE',
  DISK_FREE_BYTES: 'GAUGE',
  BACKUP_HEALTH: 'STATUS',
  RESTORE_HEALTH: 'STATUS',
  ROLLBACK_HEALTH: 'STATUS',
});

const EXPECTED_METRIC_UNITS = Object.freeze({
  DEPLOYED_REVISION: 'REVISION',
  SCHEMA_VERSION: 'VERSION',
  CONFIG_VERSION: 'VERSION',
  SERVER_TIME_OFFSET_MS: 'MILLISECONDS',
  SERVER_TIME_DRIFT_MS: 'MILLISECONDS',
  PUBLIC_EVENT_AGE_MS: 'MILLISECONDS',
  PRIVATE_EVENT_AGE_MS: 'MILLISECONDS',
  STREAM_RECONNECT_COUNT: 'COUNT',
  MALFORMED_EVENT_COUNT: 'COUNT',
  REST_RECONCILIATION_AGE_MS: 'MILLISECONDS',
  RATE_LIMIT_UTILIZATION_PPM: 'PARTS_PER_MILLION',
  RATE_LIMIT_COOLDOWN_MS: 'MILLISECONDS',
  DECISION_AGE_MS: 'MILLISECONDS',
  ASSESSMENT_AGE_MS: 'MILLISECONDS',
  TICKET_ACK_LATENCY_MS: 'MILLISECONDS',
  ORDER_ACK_LATENCY_MS: 'MILLISECONDS',
  AMBIGUOUS_MUTATION_COUNT: 'COUNT',
  PARTIAL_FILL_COUNT: 'COUNT',
  UNHEDGED_NOTIONAL: 'EXACT_DECIMAL',
  UNHEDGED_DURATION_MS: 'MILLISECONDS',
  RECONCILIATION_MISMATCH_COUNT: 'COUNT',
  ORPHAN_COUNT: 'COUNT',
  MARGIN_LIABILITY: 'EXACT_DECIMAL',
  MARGIN_INTEREST: 'EXACT_DECIMAL',
  RECOVERY_QUEUE_DEPTH: 'COUNT',
  RECOVERY_QUEUE_AGE_MS: 'MILLISECONDS',
  DATABASE_COMMIT_FAILURE_COUNT: 'COUNT',
  LEDGER_FAILURE_COUNT: 'COUNT',
  PROCESS_RESTART_COUNT: 'COUNT',
  EVENT_LOOP_LAG_MS: 'MILLISECONDS',
  CPU_UTILIZATION_PPM: 'PARTS_PER_MILLION',
  MEMORY_USAGE_BYTES: 'BYTES',
  DISK_FREE_BYTES: 'BYTES',
  BACKUP_HEALTH: 'STATUS',
  RESTORE_HEALTH: 'STATUS',
  ROLLBACK_HEALTH: 'STATUS',
});

test('matches independent ordered §22 role, §23 metric, and alarm oracles', () => {
  assert.deepEqual(MACHINE_GRAPH_ROLES, EXPECTED_ROLES);
  assert.deepEqual(MACHINE_GRAPH_METRICS, EXPECTED_METRICS);
  assert.deepEqual(MACHINE_GRAPH_ALARMS, EXPECTED_ALARMS);
});

test('matches the actual canonical System Integration and L14 owner catalogs', () => {
  // I00 added one advisory-only q-inference component after the immutable L13
  // donor cut. Preserve the donor catalog bytes and prove that this is the
  // sole integration-owned extension; QUANT_BRIDGE remains OWNER_GATED until
  // an accepted production Q inference owner is configured.
  assert.deepEqual(
    CANONICAL_SYSTEM_COMPONENT_IDS,
    SYSTEM_COMPONENT_IDS.filter((componentId) => componentId !== 'q-inference'),
  );
  assert.deepEqual(
    SYSTEM_COMPONENT_IDS.filter((componentId) => !CANONICAL_SYSTEM_COMPONENT_IDS.includes(componentId)),
    ['q-inference'],
  );
  assert.deepEqual(MACHINE_GRAPH_CONTROL_ACTIONS, DURABLE_CONTROL_ACTION_TYPES);
});

test('tracks the canonical Foundation runtime and rate-state catalogs', () => {
  assert.deepEqual(DESIRED_RUNTIME_STATES, EXPECTED_DESIRED_RUNTIME_STATES);
  assert.deepEqual(RUNTIME_PHASES, EXPECTED_RUNTIME_PHASES);
  assert.deepEqual(RATE_STATES, EXPECTED_RATE_STATES);
});

test('classifies every §23 metric with the exact independent instrument oracle', () => {
  assert.deepEqual(MACHINE_GRAPH_METRIC_INSTRUMENTS, EXPECTED_METRIC_INSTRUMENTS);
  assert.deepEqual(Object.keys(MACHINE_GRAPH_METRIC_INSTRUMENTS), EXPECTED_METRICS);
});

test('assigns every §23 metric the exact independent unit oracle in canonical order', () => {
  assert.deepEqual(MACHINE_GRAPH_METRIC_UNITS, EXPECTED_METRIC_UNITS);
  assert.deepEqual(Object.keys(MACHINE_GRAPH_METRIC_UNITS), EXPECTED_METRICS);
});

test('pure adapter source does not import canonical runtime owners or acquire side effects', () => {
  const sourceFiles = ['types.ts', 'projection.ts', 'index.ts'].map((file) => new URL(
    `../../../src/liveEdge/adapters/machineGraphEvidence/${file}`,
    import.meta.url,
  ));
  const source = sourceFiles.map((file) => readFileSync(file, 'utf8')).join('\n');
  for (const forbidden of [
    /from\s+['"][^'"]*capitalFoundation/i,
    /from\s+['"][^'"]*systemIntegration\/(?:supervisor|application|persistence|controls)/i,
    /from\s+['"][^'"]*foundation\/(?:control|risk|execution|reconciliation|readModel)/i,
    /(?:node:fs|node:http|node:https|node:net|node:tls)/,
    /\b(?:setTimeout|setInterval|fetch)\s*\(/,
    /\bMath\.random\s*\(/,
    /\bprocess\.env\b/,
  ]) {
    assert.doesNotMatch(source, forbidden);
  }
  assert.equal(Object.hasOwn(machineGraphEvidence, 'deriveMachineGraphEvidenceRevision'), false);
});
