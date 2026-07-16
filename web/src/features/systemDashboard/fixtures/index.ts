// systemDashboard/fixtures — nine synthetic supervisor states.
// Each fixture is a builder taking the build instant so ages render honestly.
// These exercise every honest-labels law: UNKNOWN stays UNKNOWN, synthetic is
// always labeled, silent/stale never look green, exposure outranks all.

import type { SystemSupervisorSnapshot } from '../../../lib/systemIntegration';
import {
  HOUR,
  MINUTE,
  SECOND,
  makeAllComponents,
  makeCorrelatedChain,
  makeSnapshot,
  makeTrace,
} from './builders';

export interface DashboardFixture {
  id: string;
  label: string;
  description: string;
  build: (now: number) => SystemSupervisorSnapshot;
}

const healthy: DashboardFixture = {
  id: 'healthy',
  label: 'Healthy',
  description: 'Every component ready and fresh on live public evidence; capital and execution remain dry-run behind the barrier.',
  build: (now) => makeSnapshot({
    now,
    posture: 'READY',
    truthLabel: 'LIVE_PUBLIC',
    components: makeAllComponents(now, {
      'public-spot-source': { truthLabel: 'LIVE_PUBLIC', queue: { depth: 12, capacity: 4096, dropped: 0, coalesced: 118, observedAtMs: now - 2 * SECOND } },
      'public-usdm-source': { truthLabel: 'LIVE_PUBLIC', queue: { depth: 4, capacity: 4096, dropped: 0, coalesced: 63, observedAtMs: now - 2 * SECOND } },
      'market-universe': { truthLabel: 'LIVE_PUBLIC' },
      'intelligence-runtime': { truthLabel: 'LIVE_PUBLIC' },
      'market-intelligence': { truthLabel: 'LIVE_PUBLIC' },
      'basis-engine': { truthLabel: 'LIVE_PUBLIC' },
      'volume-engine': { truthLabel: 'LIVE_PUBLIC' },
      'capital-supervision': { truthLabel: 'DRY_RUN' },
      'multileg-risk': { truthLabel: 'DRY_RUN' },
      'execution-coordinator-validate-only': { truthLabel: 'DRY_RUN' },
      reconciliation: { truthLabel: 'DRY_RUN' },
      'ledger-persistence': { truthLabel: 'LIVE_PUBLIC' },
      'engine-supervisor': { truthLabel: 'LIVE_PUBLIC' },
    }),
    summaries: {
      sourceCoverage: { truthLabel: 'LIVE_PUBLIC' },
      strategies: { basis: { truthLabel: 'LIVE_PUBLIC' }, volume: { truthLabel: 'LIVE_PUBLIC' } },
      intelligence: { truthLabel: 'LIVE_PUBLIC' },
    },
    recentCorrelatedDecisions: [
      ...makeCorrelatedChain(now, 'corr-01J9Z-BTC', 'BTCUSDT'),
      makeTrace(now, { componentId: 'basis-engine', kind: 'proposal-rejected', correlationId: 'corr-01J9X-ETH', occurredAtMs: now - 4 * MINUTE, ownerId: 'ETHUSDT', failureCode: 'SPREAD_BELOW_MIN_EDGE', truthLabel: 'LIVE_PUBLIC' }),
      makeTrace(now, { componentId: 'volume-engine', kind: 'candidate-rejected', correlationId: 'corr-01J9W-SOL', occurredAtMs: now - 7 * MINUTE, ownerId: 'SOLUSDT', failureCode: 'ADV_PARTICIPATION_CAP', truthLabel: 'LIVE_PUBLIC' }),
      makeTrace(now, { componentId: 'intelligence-runtime', kind: 'assessment-abstain-unknown', correlationId: 'corr-01J9V-ARB', occurredAtMs: now - 9 * MINUTE, ownerId: 'ARBUSDT', failureCode: 'INSUFFICIENT_EVIDENCE_WINDOW', truthLabel: 'LIVE_PUBLIC', referenceIds: ['win-ARBUSDT-4h'] }),
      makeTrace(now, { componentId: 'market-intelligence', kind: 'assessment-watch', correlationId: 'corr-01J9U-LINK', occurredAtMs: now - 12 * MINUTE, ownerId: 'LINKUSDT', truthLabel: 'LIVE_PUBLIC', referenceIds: ['thesis-LINKUSDT-volume'] }),
    ],
  }),
};

const warming: DashboardFixture = {
  id: 'warming',
  label: 'Warming',
  description: 'Cold start: sources connected, universe warming, engines without counts yet — unknowns must say UNKNOWN, not zero.',
  build: (now) => makeSnapshot({
    now,
    posture: 'WARMING',
    truthLabel: 'LIVE_PUBLIC',
    phase: 'WARMING',
    components: makeAllComponents(now, {
      'public-spot-source': { truthLabel: 'LIVE_PUBLIC' },
      'public-usdm-source': { truthLabel: 'LIVE_PUBLIC' },
      'market-universe': { truthLabel: 'LIVE_PUBLIC', readiness: 'WARMING', phase: 'BACKFILLING', domainObservedState: 'BACKFILLING', completeness: 'PARTIAL', freshness: { state: 'FRESH', ageMs: 2 * SECOND, evaluatedAt: now } },
      'intelligence-runtime': { readiness: 'WARMING', phase: 'LOADING_WINDOWS', domainObservedState: null, freshness: null, lastReceiveAtMs: null, lastProcessAtMs: null, lastSuccessAtMs: null, sourceTimestamp: null },
      'market-intelligence': { readiness: 'STOPPED', desiredState: 'RUNNING', phase: 'WAITING_ON_DEPENDENCY', domainObservedState: null, freshness: null, lastReceiveAtMs: null, lastProcessAtMs: null, lastSuccessAtMs: null, sourceTimestamp: null, blockerCodes: ['DEPENDENCY_NOT_READY'] },
      'basis-engine': { readiness: 'WARMING', phase: 'PRELOADING', freshness: null, sourceTimestamp: null },
      'volume-engine': { readiness: 'WARMING', phase: 'PRELOADING', freshness: null, sourceTimestamp: null },
      'capital-supervision': { readiness: 'WARMING', phase: 'REPLAYING_CHECKPOINT', truthLabel: 'DRY_RUN' },
      'multileg-risk': { readiness: 'STOPPED', phase: 'WAITING_ON_DEPENDENCY', blockerCodes: ['DEPENDENCY_NOT_READY'] },
      'execution-coordinator-validate-only': { readiness: 'STOPPED', phase: 'WAITING_ON_DEPENDENCY', truthLabel: 'DRY_RUN', blockerCodes: ['DEPENDENCY_NOT_READY'] },
      reconciliation: { readiness: 'STOPPED', phase: 'WAITING_ON_DEPENDENCY', truthLabel: 'DRY_RUN' },
      'ledger-persistence': { truthLabel: 'LIVE_PUBLIC' },
      'engine-supervisor': { truthLabel: 'LIVE_PUBLIC' },
    }),
    summaries: {
      sourceCoverage: { truthLabel: 'LIVE_PUBLIC', universeSymbols: 128, spotCoveredSymbols: 128, usdMCoveredSymbols: null, quietSymbolsRetained: null, materialGapCount: null },
      strategies: {
        basis: { heartbeatAtMs: null, candidateCount: null, proposalCount: null, rejectionCount: null, acceptedCount: null, lastDecisionAtMs: null, sourceRevision: null },
        volume: { heartbeatAtMs: null, candidateCount: null, proposalCount: null, rejectionCount: null, acceptedCount: null, lastDecisionAtMs: null, sourceRevision: null },
      },
      intelligence: { evidenceCount: 214, attentionCount: null, focusRequestedCount: null, focusActiveCount: null, thesisCount: null, insufficientEvidenceCount: null, lastUpdateAtMs: null },
      capital: { allocatableAmount: null, reservedAmount: null, activeExposureAmount: null, eligibleCount: null, reservationCount: null, stagedMandateCount: null, activeExposureCount: null, checkpointRevision: null, accountTruthState: 'REPLAYING' },
      risk: { latestVerdict: 'UNAVAILABLE', latestVerdictAtMs: null, latestVerdictId: null, rejectionCount: null, reasonCodes: [], truthLabel: 'UNAVAILABLE' },
      execution: { planId: null, planLifecycle: null, coordinatorState: 'NOT_STARTED', legCount: null, lastTransitionAtMs: null, truthLabel: 'UNAVAILABLE' },
      reconciliation: { status: 'NOT_EVALUATED', checkpointId: null, evaluatedAtMs: null, truthLabel: 'UNAVAILABLE' },
    },
    recentCorrelatedDecisions: [],
  }),
};

const degraded: DashboardFixture = {
  id: 'degraded',
  label: 'Degraded',
  description: 'USD-M source rate-limited with material gaps; volume engine degraded and rejecting on gapped evidence.',
  build: (now) => makeSnapshot({
    now,
    posture: 'DEGRADED',
    truthLabel: 'LIVE_PUBLIC',
    components: makeAllComponents(now, {
      'public-spot-source': { truthLabel: 'LIVE_PUBLIC' },
      'public-usdm-source': {
        truthLabel: 'LIVE_PUBLIC',
        readiness: 'DEGRADED',
        phase: 'BACKOFF',
        domainObservedState: 'RATE_LIMITED',
        freshness: { state: 'FRESH', ageMs: 18 * SECOND, evaluatedAt: now },
        queue: { depth: 2210, capacity: 4096, dropped: 87, coalesced: 30, observedAtMs: now - SECOND },
        blockerCodes: ['UPSTREAM_RATE_LIMIT_418'],
        restartCount: 2,
        lastFailure: { code: 'UPSTREAM_RATE_LIMIT_418', message: 'Exchange returned 418; exponential backoff 24s remaining.', recommendedOperatorAction: 'Wait out the backoff. Restarting resets the backoff timer and worsens the ban window.' },
      },
      'market-universe': { truthLabel: 'LIVE_PUBLIC', completeness: 'PARTIAL' },
      'volume-engine': { readiness: 'DEGRADED', phase: 'RUNNING_REDUCED', domainObservedState: 'REDUCED_COVERAGE', truthLabel: 'LIVE_PUBLIC', blockerCodes: ['EVIDENCE_GAPPED'] },
      'basis-engine': { truthLabel: 'LIVE_PUBLIC' },
      'capital-supervision': { truthLabel: 'DRY_RUN' },
      'ledger-persistence': { truthLabel: 'LIVE_PUBLIC' },
      'engine-supervisor': { truthLabel: 'LIVE_PUBLIC' },
    }),
    edgeOverrides: {
      'public-usdm-source->market-universe': { state: 'DEGRADED', rootBlockerComponentId: 'public-usdm-source', reasonCodes: ['UPSTREAM_RATE_LIMIT_418'] },
    },
    firstRootBlockerComponentId: 'public-usdm-source',
    rootBlockerComponentIds: ['public-usdm-source'],
    attentionQueue: [
      { componentId: 'public-usdm-source', rootComponentId: 'public-usdm-source', severity: 'MEDIUM', reasonCodes: ['UPSTREAM_RATE_LIMIT_418', 'QUEUE_DROPS'], capitalExposed: false, recommendedOperatorAction: 'Wait out the backoff; do not restart the source.' },
    ],
    summaries: {
      sourceCoverage: { truthLabel: 'LIVE_PUBLIC', usdMCoveredSymbols: 204, materialGapCount: 17, rateLimitedSourceCount: 1, lastMaterialGapAtMs: now - 90 * SECOND },
      strategies: { basis: { truthLabel: 'LIVE_PUBLIC' }, volume: { truthLabel: 'LIVE_PUBLIC', rejectionCount: 11, proposalCount: 0, lastDecisionAtMs: now - 70 * SECOND } },
      intelligence: { truthLabel: 'LIVE_PUBLIC' },
    },
    recentCorrelatedDecisions: [
      makeTrace(now, { componentId: 'volume-engine', kind: 'candidate-rejected', correlationId: 'corr-01JA1-BNB', occurredAtMs: now - 70 * SECOND, ownerId: 'BNBUSDT', failureCode: 'EVIDENCE_GAPPED', truthLabel: 'LIVE_PUBLIC' }),
      makeTrace(now, { componentId: 'volume-engine', kind: 'candidate-rejected', correlationId: 'corr-01JA1-XRP', occurredAtMs: now - 3 * MINUTE, ownerId: 'XRPUSDT', failureCode: 'EVIDENCE_GAPPED', truthLabel: 'LIVE_PUBLIC' }),
      makeTrace(now, { componentId: 'basis-engine', kind: 'proposal-rejected', correlationId: 'corr-01JA0-ETH', occurredAtMs: now - 5 * MINUTE, ownerId: 'ETHUSDT', failureCode: 'FUNDING_WINDOW_TOO_CLOSE', truthLabel: 'LIVE_PUBLIC' }),
    ],
  }),
};

const stale: DashboardFixture = {
  id: 'stale',
  label: 'Stale',
  description: 'Universe and basis evidence exceed their freshness contracts while readiness still claims READY — the boxes must not be green.',
  build: (now) => makeSnapshot({
    now,
    posture: 'DEGRADED',
    truthLabel: 'LIVE_PUBLIC',
    components: makeAllComponents(now, {
      'public-spot-source': { truthLabel: 'LIVE_PUBLIC' },
      'public-usdm-source': { truthLabel: 'LIVE_PUBLIC' },
      'market-universe': {
        truthLabel: 'LIVE_PUBLIC',
        freshness: { state: 'STALE', ageMs: 4 * MINUTE, evaluatedAt: now },
        sourceTimestamp: { sourceTimeMs: now - 4 * MINUTE, receivedAtMs: now - 4 * MINUTE, maxAgeMs: 30 * SECOND },
        lastReceiveAtMs: now - 4 * MINUTE,
        blockerCodes: ['FRESHNESS_CONTRACT_EXCEEDED'],
      },
      'basis-engine': {
        truthLabel: 'LIVE_PUBLIC',
        // Publisher still says FRESH, but age exceeds the contract: the UI
        // must demote this to STALE on its own evidence.
        freshness: { state: 'FRESH', ageMs: 95 * SECOND, evaluatedAt: now },
        sourceTimestamp: { sourceTimeMs: now - 95 * SECOND, receivedAtMs: now - 95 * SECOND, maxAgeMs: 30 * SECOND },
        lastReceiveAtMs: now - 95 * SECOND,
      },
      'capital-supervision': { truthLabel: 'DRY_RUN' },
      'ledger-persistence': { truthLabel: 'LIVE_PUBLIC' },
      'engine-supervisor': { truthLabel: 'LIVE_PUBLIC' },
    }),
    firstRootBlockerComponentId: 'market-universe',
    rootBlockerComponentIds: ['market-universe'],
    attentionQueue: [
      { componentId: 'market-universe', rootComponentId: 'market-universe', severity: 'HIGH', reasonCodes: ['FRESHNESS_CONTRACT_EXCEEDED'], capitalExposed: false, recommendedOperatorAction: 'Restart market-universe if the age keeps growing after sources are confirmed healthy.' },
    ],
    summaries: {
      sourceCoverage: { truthLabel: 'LIVE_PUBLIC' },
      strategies: { basis: { truthLabel: 'LIVE_PUBLIC', heartbeatAtMs: now - 95 * SECOND }, volume: { truthLabel: 'LIVE_PUBLIC' } },
      intelligence: { truthLabel: 'LIVE_PUBLIC', lastUpdateAtMs: now - 3 * MINUTE },
    },
    recentCorrelatedDecisions: [
      makeTrace(now, { componentId: 'basis-engine', kind: 'proposal-rejected', correlationId: 'corr-01JA2-BTC', occurredAtMs: now - 2 * MINUTE, ownerId: 'BTCUSDT', failureCode: 'EVIDENCE_STALE', truthLabel: 'LIVE_PUBLIC' }),
    ],
  }),
};

const silent: DashboardFixture = {
  id: 'silent',
  label: 'Silent',
  description: 'Spot source went silent mid-session and intelligence publishes no freshness at all; market-intelligence is absent from the snapshot entirely.',
  build: (now) => makeSnapshot({
    now,
    posture: 'DEGRADED',
    truthLabel: 'LIVE_PUBLIC',
    components: makeAllComponents(now, {
      'public-spot-source': {
        truthLabel: 'LIVE_PUBLIC',
        // The trap the law exists for: readiness READY, but nothing has
        // arrived for six minutes and the supervisor says SILENT.
        freshness: { state: 'SILENT', ageMs: 6 * MINUTE, evaluatedAt: now },
        sourceTimestamp: { sourceTimeMs: now - 6 * MINUTE, receivedAtMs: now - 6 * MINUTE, maxAgeMs: 30 * SECOND },
        lastReceiveAtMs: now - 6 * MINUTE,
        queue: { depth: 0, capacity: 4096, dropped: 0, coalesced: 0, observedAtMs: now - SECOND },
      },
      'public-usdm-source': { truthLabel: 'LIVE_PUBLIC' },
      'market-universe': { truthLabel: 'LIVE_PUBLIC', completeness: 'PARTIAL' },
      'intelligence-runtime': { freshness: null, sourceTimestamp: null, lastReceiveAtMs: null, truthLabel: 'UNKNOWN' },
      'capital-supervision': { truthLabel: 'DRY_RUN' },
      'ledger-persistence': { truthLabel: 'LIVE_PUBLIC' },
      'engine-supervisor': { truthLabel: 'LIVE_PUBLIC' },
    }, ['market-intelligence']),
    firstRootBlockerComponentId: 'public-spot-source',
    rootBlockerComponentIds: ['public-spot-source'],
    attentionQueue: [
      { componentId: 'public-spot-source', rootComponentId: 'public-spot-source', severity: 'HIGH', reasonCodes: ['SOURCE_SILENT'], capitalExposed: false, recommendedOperatorAction: 'Restart public-spot-source; the socket accepted the subscription but delivers nothing.' },
    ],
    summaries: {
      sourceCoverage: { truthLabel: 'LIVE_PUBLIC', spotCoveredSymbols: 0, quietSymbolsRetained: 452, lastMaterialGapAtMs: now - 6 * MINUTE, materialGapCount: 452 },
      strategies: { basis: { truthLabel: 'LIVE_PUBLIC' }, volume: { truthLabel: 'LIVE_PUBLIC' } },
      intelligence: { truthLabel: 'UNKNOWN', evidenceCount: null, attentionCount: null, focusRequestedCount: null, focusActiveCount: null, thesisCount: null, insufficientEvidenceCount: null, lastUpdateAtMs: null },
    },
    recentCorrelatedDecisions: [
      makeTrace(now, { componentId: 'basis-engine', kind: 'proposal-rejected', correlationId: 'corr-01JA3-BTC', occurredAtMs: now - 4 * MINUTE, ownerId: 'BTCUSDT', failureCode: 'SPOT_LEG_EVIDENCE_MISSING', truthLabel: 'LIVE_PUBLIC' }),
    ],
  }),
};

const blocked: DashboardFixture = {
  id: 'blocked',
  label: 'Blocked',
  description: 'Capital checkpoint corrupt: capital-supervision FAILED as root cause; risk and execution cascade BLOCKED behind it.',
  build: (now) => makeSnapshot({
    now,
    posture: 'BLOCKED',
    truthLabel: 'LIVE_PUBLIC',
    components: makeAllComponents(now, {
      'public-spot-source': { truthLabel: 'LIVE_PUBLIC' },
      'public-usdm-source': { truthLabel: 'LIVE_PUBLIC' },
      'market-universe': { truthLabel: 'LIVE_PUBLIC' },
      'intelligence-runtime': { truthLabel: 'LIVE_PUBLIC' },
      'market-intelligence': { truthLabel: 'LIVE_PUBLIC' },
      'basis-engine': { truthLabel: 'LIVE_PUBLIC' },
      'volume-engine': { truthLabel: 'LIVE_PUBLIC' },
      'capital-supervision': {
        truthLabel: 'DRY_RUN',
        readiness: 'FAILED',
        phase: 'CRASH_LOOP',
        domainObservedState: 'CHECKPOINT_REJECTED',
        desiredState: 'RUNNING',
        freshness: null,
        sourceTimestamp: null,
        restartCount: 4,
        generation: 7,
        blockerCodes: ['CHECKPOINT_DIGEST_MISMATCH'],
        operatorAttentionRequired: true,
        lastFailure: { code: 'CHECKPOINT_DIGEST_MISMATCH', message: 'Capital checkpoint cap-ckpt-311 failed digest verification on replay.', recommendedOperatorAction: 'Inspect the capital checkpoint store; restart only after the digest source is confirmed.' },
      },
      'multileg-risk': { readiness: 'BLOCKED', phase: 'WAITING_ON_DEPENDENCY', blockerCodes: ['DEPENDENCY_FAILED:capital-supervision'], truthLabel: 'UNAVAILABLE', freshness: null, sourceTimestamp: null },
      'execution-coordinator-validate-only': { readiness: 'BLOCKED', phase: 'WAITING_ON_DEPENDENCY', blockerCodes: ['DEPENDENCY_FAILED:capital-supervision'], truthLabel: 'UNAVAILABLE', freshness: null, sourceTimestamp: null },
      reconciliation: { readiness: 'BLOCKED', phase: 'WAITING_ON_DEPENDENCY', blockerCodes: ['DEPENDENCY_FAILED:capital-supervision'], truthLabel: 'UNAVAILABLE', freshness: null, sourceTimestamp: null },
      'ledger-persistence': { truthLabel: 'LIVE_PUBLIC' },
      'engine-supervisor': { truthLabel: 'LIVE_PUBLIC' },
    }),
    edgeOverrides: {
      'capital-supervision->multileg-risk': { state: 'BLOCKED', rootBlockerComponentId: 'capital-supervision', reasonCodes: ['CHECKPOINT_DIGEST_MISMATCH'] },
      'multileg-risk->execution-coordinator-validate-only': { state: 'BLOCKED', rootBlockerComponentId: 'capital-supervision', reasonCodes: ['DEPENDENCY_FAILED'] },
      'execution-coordinator-validate-only->reconciliation': { state: 'BLOCKED', rootBlockerComponentId: 'capital-supervision', reasonCodes: ['DEPENDENCY_FAILED'] },
    },
    firstRootBlockerComponentId: 'capital-supervision',
    rootBlockerComponentIds: ['capital-supervision'],
    attentionQueue: [
      { componentId: 'capital-supervision', rootComponentId: 'capital-supervision', severity: 'CRITICAL', reasonCodes: ['CHECKPOINT_DIGEST_MISMATCH', 'CRASH_LOOP'], capitalExposed: false, recommendedOperatorAction: 'Inspect the capital checkpoint store; restart only after the digest source is confirmed.' },
      { componentId: 'multileg-risk', rootComponentId: 'capital-supervision', severity: 'LOW', reasonCodes: ['CASCADED_DEPENDENCY'], capitalExposed: false, recommendedOperatorAction: null },
    ],
    summaries: {
      sourceCoverage: { truthLabel: 'LIVE_PUBLIC' },
      strategies: { basis: { truthLabel: 'LIVE_PUBLIC' }, volume: { truthLabel: 'LIVE_PUBLIC' } },
      intelligence: { truthLabel: 'LIVE_PUBLIC' },
      capital: { truthLabel: 'UNAVAILABLE', accountTruthState: 'CHECKPOINT_REJECTED', allocatableAmount: null, reservedAmount: null, activeExposureAmount: null, eligibleCount: null, reservationCount: null, stagedMandateCount: null, activeExposureCount: null, checkpointRevision: 'cap-ckpt-311', blockerCodes: ['CHECKPOINT_DIGEST_MISMATCH'] },
      risk: { truthLabel: 'UNAVAILABLE', latestVerdict: 'UNAVAILABLE', latestVerdictAtMs: now - 22 * MINUTE, latestVerdictId: 'verdict-01J9F2', rejectionCount: null, reasonCodes: ['CAPITAL_TRUTH_UNAVAILABLE'] },
      execution: { truthLabel: 'UNAVAILABLE', planId: null, planLifecycle: null, coordinatorState: 'HELD', legCount: null, lastTransitionAtMs: now - 22 * MINUTE },
      reconciliation: { truthLabel: 'UNAVAILABLE', status: 'HELD', blocksNewExposure: true, recommendation: 'Blocked pending capital truth.', evaluatedAtMs: now - 22 * MINUTE, reasonCodes: ['CAPITAL_TRUTH_UNAVAILABLE'] },
    },
    recentCorrelatedDecisions: [
      makeTrace(now, { componentId: 'capital-supervision', kind: 'checkpoint-rejected', correlationId: 'corr-01JA4-CAP', occurredAtMs: now - 22 * MINUTE, failureCode: 'CHECKPOINT_DIGEST_MISMATCH', truthLabel: 'DRY_RUN', referenceIds: ['cap-ckpt-311'] }),
      makeTrace(now, { componentId: 'engine-supervisor', kind: 'component-crash-loop', correlationId: 'corr-01JA4-CAP', occurredAtMs: now - 20 * MINUTE, failureCode: 'CRASH_LOOP', truthLabel: 'LIVE_PUBLIC', referenceIds: ['capital-supervision'] }),
    ],
  }),
};

const synthetic: DashboardFixture = {
  id: 'synthetic',
  label: 'Synthetic / Dry-Run',
  description: 'Full validate-only rehearsal on replayed evidence. Everything is green-healthy — and every label must still shout SYNTHETIC.',
  build: (now) => makeSnapshot({
    now,
    posture: 'READY',
    truthLabel: 'SYNTHETIC_ONLY',
    components: makeAllComponents(now, {
      'public-spot-source': { truthLabel: 'RECORDED_REPLAY' },
      'public-usdm-source': { truthLabel: 'RECORDED_REPLAY' },
      'market-universe': { truthLabel: 'RECORDED_REPLAY' },
      'capital-supervision': { truthLabel: 'SYNTHETIC_ONLY' },
      'multileg-risk': { truthLabel: 'SYNTHETIC_ONLY' },
      'execution-coordinator-validate-only': { truthLabel: 'DRY_RUN' },
      reconciliation: { truthLabel: 'DRY_RUN' },
      'ledger-persistence': { truthLabel: 'LIVE_PUBLIC' },
    }),
    summaries: {
      capital: { truthLabel: 'SYNTHETIC_ONLY', accountTruthState: 'SYNTHETIC_BASELINE', reservedAmount: '3,000.00 USDT', reservationCount: 2, stagedMandateCount: 1 },
      risk: { truthLabel: 'SYNTHETIC_ONLY' },
      execution: { truthLabel: 'DRY_RUN', planLifecycle: 'VALIDATED', coordinatorState: 'REPLAYING' },
      reconciliation: { truthLabel: 'DRY_RUN' },
    },
    recentCorrelatedDecisions: [
      ...makeCorrelatedChain(now, 'corr-01JA5-BTC', 'BTCUSDT', 'replay'),
      makeTrace(now, { componentId: 'volume-engine', kind: 'proposal-rejected', correlationId: 'corr-01JA5-DOGE', occurredAtMs: now - 6 * MINUTE, ownerId: 'DOGEUSDT', failureCode: 'REPLAY_WINDOW_EXHAUSTED' }),
    ],
  }),
};

const capitalExposed: DashboardFixture = {
  id: 'capital-exposed',
  label: 'Capital Exposed',
  description: 'Dry-run exposure open while reconciliation diverged and the kill switch is engaged — exposure owns the top of the screen.',
  build: (now) => makeSnapshot({
    now,
    posture: 'DEGRADED',
    truthLabel: 'LIVE_PUBLIC',
    control: { safeMode: 'READ_ONLY', killSwitchEngaged: true, updatedAtMs: now - 6 * MINUTE, revision: 4211, correlationId: 'ctl-01JA6K' },
    components: makeAllComponents(now, {
      'public-spot-source': { truthLabel: 'LIVE_PUBLIC' },
      'public-usdm-source': { truthLabel: 'LIVE_PUBLIC' },
      'market-universe': { truthLabel: 'LIVE_PUBLIC' },
      'intelligence-runtime': { truthLabel: 'LIVE_PUBLIC' },
      'market-intelligence': { truthLabel: 'LIVE_PUBLIC' },
      'basis-engine': { truthLabel: 'LIVE_PUBLIC' },
      'volume-engine': { truthLabel: 'LIVE_PUBLIC' },
      'capital-supervision': { truthLabel: 'DRY_RUN', capitalExposed: true, operatorAttentionRequired: true },
      'multileg-risk': { truthLabel: 'DRY_RUN' },
      'execution-coordinator-validate-only': { truthLabel: 'DRY_RUN', capitalExposed: true, phase: 'RECOVERING', domainObservedState: 'RECOVERY_PENDING', readiness: 'DEGRADED', blockerCodes: ['RECOVERY_PENDING'] },
      reconciliation: { truthLabel: 'DRY_RUN', readiness: 'DEGRADED', domainObservedState: 'DIVERGED', blockerCodes: ['LEG_STATE_DIVERGED'], operatorAttentionRequired: true },
      'ledger-persistence': { truthLabel: 'LIVE_PUBLIC' },
      'engine-supervisor': { truthLabel: 'LIVE_PUBLIC' },
    }),
    firstRootBlockerComponentId: 'reconciliation',
    rootBlockerComponentIds: ['reconciliation'],
    attentionQueue: [
      { componentId: 'reconciliation', rootComponentId: 'reconciliation', severity: 'CRITICAL', reasonCodes: ['LEG_STATE_DIVERGED', 'EXPOSURE_OPEN'], capitalExposed: true, recommendedOperatorAction: 'Resolve the diverged simulated leg before releasing the kill switch.' },
      { componentId: 'execution-coordinator-validate-only', rootComponentId: 'reconciliation', severity: 'HIGH', reasonCodes: ['RECOVERY_PENDING'], capitalExposed: true, recommendedOperatorAction: 'Recovery re-runs automatically once reconciliation converges.' },
      { componentId: 'public-usdm-source', rootComponentId: 'public-usdm-source', severity: 'MEDIUM', reasonCodes: ['QUEUE_PRESSURE'], capitalExposed: false, recommendedOperatorAction: null },
    ],
    summaries: {
      capital: {
        truthLabel: 'DRY_RUN',
        accountTruthState: 'RESERVED_WITH_EXPOSURE',
        allocatableAmount: '21,750.00 USDT',
        reservedAmount: '2,000.00 USDT',
        activeExposureAmount: '1,250.00 USDT',
        reservationCount: 2,
        stagedMandateCount: 1,
        activeExposureCount: 2,
        blockerCodes: ['EXPOSURE_OPEN_DURING_KILL'],
      },
      risk: { truthLabel: 'DRY_RUN', latestVerdict: 'REJECT', latestVerdictAtMs: now - 4 * MINUTE, latestVerdictId: 'verdict-01JA6Q', rejectionCount: 6, reasonCodes: ['KILL_SWITCH_ENGAGED', 'RECON_DIVERGED'] },
      execution: { truthLabel: 'DRY_RUN', planId: 'plan-01JA6M', planLifecycle: 'RECOVERY_PENDING', coordinatorState: 'RECOVERING', legCount: 2, recoveryState: 'AWAITING_RECONCILIATION', lastTransitionAtMs: now - 5 * MINUTE },
      reconciliation: { truthLabel: 'DRY_RUN', status: 'DIVERGED', blocksNewExposure: true, recommendation: 'Hold new exposure until the diverged simulated leg is resolved.', evaluatedAtMs: now - 90 * SECOND, reasonCodes: ['LEG_STATE_DIVERGED'] },
      strategies: { basis: { truthLabel: 'LIVE_PUBLIC' }, volume: { truthLabel: 'LIVE_PUBLIC' } },
      intelligence: { truthLabel: 'LIVE_PUBLIC' },
      sourceCoverage: { truthLabel: 'LIVE_PUBLIC' },
    },
    recentCorrelatedDecisions: [
      makeTrace(now, { componentId: 'reconciliation', kind: 'checkpoint-diverged', correlationId: 'corr-01JA6-BTC', occurredAtMs: now - 90 * SECOND, failureCode: 'LEG_STATE_DIVERGED', truthLabel: 'DRY_RUN', referenceIds: ['plan-01JA6M', 'leg-2'] }),
      makeTrace(now, { componentId: 'execution-coordinator-validate-only', kind: 'recovery-started', correlationId: 'corr-01JA6-BTC', occurredAtMs: now - 5 * MINUTE, ownerId: 'BTCUSDT', truthLabel: 'DRY_RUN', referenceIds: ['plan-01JA6M'] }),
      makeTrace(now, { componentId: 'multileg-risk', kind: 'verdict-reject', correlationId: 'corr-01JA6-ETH', occurredAtMs: now - 4 * MINUTE, ownerId: 'ETHUSDT', failureCode: 'KILL_SWITCH_ENGAGED', truthLabel: 'DRY_RUN', referenceIds: ['verdict-01JA6Q'] }),
      makeTrace(now, { componentId: 'capital-supervision', kind: 'reservation-held', correlationId: 'corr-01JA6-BTC', occurredAtMs: now - 6 * MINUTE, truthLabel: 'DRY_RUN', referenceIds: ['mandate-61'] }),
    ],
  }),
};

const attentionRequired: DashboardFixture = {
  id: 'attention-required',
  label: 'Attention Required',
  description: 'Intake paused, a crash-looping intelligence runtime, ledger disk pressure, and a mixed-severity queue to rank.',
  build: (now) => makeSnapshot({
    now,
    posture: 'DEGRADED',
    truthLabel: 'LIVE_PUBLIC',
    control: { intakePaused: true, updatedAtMs: now - 25 * MINUTE, revision: 4195 },
    components: makeAllComponents(now, {
      'public-spot-source': { truthLabel: 'LIVE_PUBLIC' },
      'public-usdm-source': { truthLabel: 'LIVE_PUBLIC' },
      'market-universe': { truthLabel: 'LIVE_PUBLIC', freshness: { state: 'STALE', ageMs: 25 * MINUTE, evaluatedAt: now }, lastReceiveAtMs: now - 25 * MINUTE, blockerCodes: ['INTAKE_PAUSED'] },
      'intelligence-runtime': {
        truthLabel: 'LIVE_PUBLIC',
        readiness: 'FAILED',
        phase: 'CRASH_LOOP',
        domainObservedState: 'RESTARTING',
        restartCount: 6,
        generation: 9,
        freshness: null,
        sourceTimestamp: null,
        operatorAttentionRequired: true,
        blockerCodes: ['OOM_KILLED'],
        lastFailure: { code: 'OOM_KILLED', message: 'Runtime exceeded its memory budget replaying attention windows.', recommendedOperatorAction: 'Restart with the reduced window profile; raise the budget only after the leak is confirmed fixed.' },
      },
      'market-intelligence': { readiness: 'BLOCKED', phase: 'WAITING_ON_DEPENDENCY', blockerCodes: ['DEPENDENCY_FAILED:intelligence-runtime'], truthLabel: 'UNAVAILABLE', freshness: null, sourceTimestamp: null },
      'basis-engine': { truthLabel: 'LIVE_PUBLIC' },
      'volume-engine': { truthLabel: 'LIVE_PUBLIC' },
      'capital-supervision': { truthLabel: 'DRY_RUN' },
      'multileg-risk': { truthLabel: 'DRY_RUN' },
      'execution-coordinator-validate-only': { truthLabel: 'DRY_RUN' },
      reconciliation: { truthLabel: 'DRY_RUN' },
      'ledger-persistence': { truthLabel: 'LIVE_PUBLIC', readiness: 'DEGRADED', domainObservedState: 'DISK_PRESSURE', blockerCodes: ['DISK_WATERMARK_92PCT'], operatorAttentionRequired: true },
      'engine-supervisor': { truthLabel: 'LIVE_PUBLIC' },
    }),
    edgeOverrides: {
      'intelligence-runtime->market-intelligence': { state: 'BLOCKED', rootBlockerComponentId: 'intelligence-runtime', reasonCodes: ['OOM_KILLED'] },
    },
    firstRootBlockerComponentId: 'intelligence-runtime',
    rootBlockerComponentIds: ['intelligence-runtime', 'ledger-persistence'],
    attentionQueue: [
      { componentId: 'intelligence-runtime', rootComponentId: 'intelligence-runtime', severity: 'CRITICAL', reasonCodes: ['OOM_KILLED', 'CRASH_LOOP'], capitalExposed: false, recommendedOperatorAction: 'Restart with the reduced window profile; raise the budget only after the leak is confirmed fixed.' },
      { componentId: 'ledger-persistence', rootComponentId: 'ledger-persistence', severity: 'HIGH', reasonCodes: ['DISK_WATERMARK_92PCT'], capitalExposed: false, recommendedOperatorAction: 'Expand the ledger volume; the ledger stops accepting writes at 97%.' },
      { componentId: 'market-universe', rootComponentId: 'market-universe', severity: 'MEDIUM', reasonCodes: ['INTAKE_PAUSED'], capitalExposed: false, recommendedOperatorAction: 'Resume intake once the intelligence runtime is stable.' },
      { componentId: 'volume-engine', rootComponentId: 'market-universe', severity: 'LOW', reasonCodes: ['COVERAGE_SHRINKING'], capitalExposed: false, recommendedOperatorAction: null },
    ],
    summaries: {
      sourceCoverage: { truthLabel: 'LIVE_PUBLIC', quietSymbolsRetained: 452, materialGapCount: 452, lastMaterialGapAtMs: now - 25 * MINUTE },
      strategies: { basis: { truthLabel: 'LIVE_PUBLIC', proposalCount: 0 }, volume: { truthLabel: 'LIVE_PUBLIC', proposalCount: 0 } },
      intelligence: { truthLabel: 'UNAVAILABLE', lastUpdateAtMs: now - 18 * MINUTE, attentionCount: null, focusActiveCount: null, focusRequestedCount: null, thesisCount: null, insufficientEvidenceCount: null },
      ledger: { writable: true, recentTraceCount: 12 },
    },
    recentCorrelatedDecisions: [
      makeTrace(now, { componentId: 'engine-supervisor', kind: 'component-crash-loop', correlationId: 'corr-01JA7-INT', occurredAtMs: now - 12 * MINUTE, failureCode: 'CRASH_LOOP', truthLabel: 'LIVE_PUBLIC', referenceIds: ['intelligence-runtime'] }),
      makeTrace(now, { componentId: 'ledger-persistence', kind: 'disk-watermark', correlationId: 'corr-01JA7-LED', occurredAtMs: now - 31 * MINUTE, failureCode: 'DISK_WATERMARK_92PCT', truthLabel: 'LIVE_PUBLIC' }),
    ],
  }),
};

/** Supervisor itself unreachable / snapshot missing. This fixture is the
 *  null-snapshot case: the registry entry builds nothing and the surface must
 *  render its honest unavailable state instead of an empty green shell. */
const unavailable: DashboardFixture = {
  id: 'unavailable',
  label: 'Supervisor Unreachable',
  description: 'No snapshot at all — the dashboard must show UNAVAILABLE, never an empty or optimistic frame.',
  build: (now) => makeSnapshot({
    now,
    posture: 'FAILED',
    truthLabel: 'UNKNOWN',
    phase: 'UNREACHABLE',
    components: [],
    firstRootBlockerComponentId: null,
    attentionQueue: [],
    summaries: {
      sourceCoverage: { truthLabel: 'UNKNOWN', universeSymbols: null, spotCoveredSymbols: null, usdMCoveredSymbols: null, quietSymbolsRetained: null, materialGapCount: null, rateLimitedSourceCount: null, lastMaterialGapAtMs: null },
      strategies: {
        basis: { truthLabel: 'UNKNOWN', heartbeatAtMs: null, candidateCount: null, proposalCount: null, rejectionCount: null, acceptedCount: null, lastDecisionAtMs: null, sourceRevision: null },
        volume: { truthLabel: 'UNKNOWN', heartbeatAtMs: null, candidateCount: null, proposalCount: null, rejectionCount: null, acceptedCount: null, lastDecisionAtMs: null, sourceRevision: null },
      },
      intelligence: { truthLabel: 'UNKNOWN', evidenceCount: null, attentionCount: null, focusRequestedCount: null, focusActiveCount: null, thesisCount: null, insufficientEvidenceCount: null, lastUpdateAtMs: null },
      capital: { truthLabel: 'UNKNOWN', accountTruthState: 'UNKNOWN', allocatableAmount: null, reservedAmount: null, activeExposureAmount: null, eligibleCount: null, reservationCount: null, stagedMandateCount: null, activeExposureCount: null, checkpointRevision: null, blockerCodes: [] },
      risk: { truthLabel: 'UNKNOWN', latestVerdict: 'UNAVAILABLE', latestVerdictAtMs: null, latestVerdictId: null, rejectionCount: null, reasonCodes: [] },
      execution: { truthLabel: 'UNKNOWN', planId: null, planLifecycle: null, coordinatorState: 'UNKNOWN', legCount: null, recoveryState: null, lastTransitionAtMs: null },
      reconciliation: { truthLabel: 'UNKNOWN', status: 'UNKNOWN', blocksNewExposure: true, recommendation: null, checkpointId: null, evaluatedAtMs: null, reasonCodes: [] },
      ledger: { truthLabel: 'UNAVAILABLE', writable: null, schemaCompatibilityState: 'UNAVAILABLE', schemaCompatibilityReason: 'LEDGER_SCHEMA_COMPATIBILITY_READBACK_UNAVAILABLE', currentSchemaVersion: null, rollbackFloor: null, lastEventId: null, lastPersistedAtMs: null, checkpointRevision: null, recentTraceCount: null, lastCleanShutdownAtMs: null },
    },
    recentCorrelatedDecisions: [],
  }),
};

export const FIXTURES: DashboardFixture[] = [
  healthy,
  warming,
  degraded,
  stale,
  silent,
  blocked,
  synthetic,
  capitalExposed,
  attentionRequired,
  unavailable,
];

export function fixtureById(id: string): DashboardFixture {
  return FIXTURES.find((fixture) => fixture.id === id) ?? FIXTURES[0];
}
