import { buildAiOpsControlSpecificationProjection } from './controlProjection';
import type {
  AiOpsChatMessageProjection,
  AiOpsCockpitLevel,
  AiOpsComponentProjection,
  AiOpsFact,
  AiOpsFixtureManifest,
  AiOpsGovernanceRow,
  AiOpsIncidentCommandProjection,
  AiOpsIncidentProjection,
  AiOpsOverviewBand,
  AiOpsProbeProjection,
  AiOpsProviderQualificationProjection,
  AiOpsCapabilityGraduationProjection,
  AiOpsContextManifestProjection,
  AiOpsSnapshot,
  AiOpsTrendSeries,
  ProjectedSource,
} from './types';

export const DEFAULT_AI_OPS_FIXTURE_MANIFEST: AiOpsFixtureManifest = {
  schema: 'AiOpsShadowFixtureManifestV1',
  version: 1,
  fixtureId: 'aiops-a4-shadow-provider-degraded-v1',
  baseSha: '03857dcdaff8d8b12627d27ddcc97505da1f2f86',
  extensionBaseSha: 'b5f4c478223796cf7f9d73ba8c424a179aaa8551',
  generatedAt: '2026-07-14T12:00:00.000Z',
  selectedCaseId: 'FIXTURE-CASE-A4-0001',
  scenario: 'PROVIDER_DEGRADED_WITH_UNFINISHED_OWNERS',
  obviousFakeProvider: 'fixture-provider.invalid',
  obviousFakeModel: 'fixture-model-never-call',
  requestedControlIntents: { 'AI_OPS.A02': 'SHADOW' },
};

const SEALED_A4_EXTENSION_BASE_SHA = 'b5f4c478223796cf7f9d73ba8c424a179aaa8551';

function source(
  owner: string,
  sourceId: string,
  generatedAt: string,
  wiring: ProjectedSource['wiring'] = 'FIXTURE_ONLY',
): ProjectedSource {
  return {
    owner,
    sourceId,
    revision: 'fixture-r1',
    observedAt: generatedAt,
    wiring,
  };
}

function fact(
  id: string,
  label: string,
  value: AiOpsFact['value'],
  posture: AiOpsFact['posture'],
  detail: string,
  owner: string,
  generatedAt: string,
  unit?: string,
): AiOpsFact {
  return {
    id,
    label,
    value,
    posture,
    detail,
    unit,
    source: source(owner, `fixture:${id}`, generatedAt),
  };
}

function buildSafetySummary(generatedAt: string): readonly AiOpsFact[] {
  return [
    fact(
      'safety-product',
      'Product',
      'DEGRADED',
      'DEGRADED',
      'Synthetic provider route is unavailable; deterministic product operation is projected as independent.',
      'System Integration supervisor',
      generatedAt,
    ),
    fact(
      'safety-money',
      'Money',
      'NO_AI_AUTHORITY',
      'SYNTHETIC_ONLY',
      'The A4 artifact exposes no order, transfer, borrow, repay, withdrawal, leverage, margin, or capital mutation capability; this is not live system readback.',
      'Foundation control/risk/execution/reconciliation',
      generatedAt,
    ),
    fact(
      'safety-ai',
      'AI plane',
      'NOT_WIRED',
      'NOT_WIRED',
      'A4 is a fixture projection; no provider, case router, tool gateway, effect handler, or AI kill command is mounted.',
      'Product Assurance diagnostic boundary',
      generatedAt,
    ),
    fact(
      'safety-telemetry',
      'Telemetry',
      'STALE',
      'STALE',
      'One fixture source is 94 seconds old; canonical aggregate rate-budget binding remains unfinished.',
      'System Integration supervisor',
      generatedAt,
      'age',
    ),
    fact(
      'safety-sentinel',
      'Sentinel',
      'UNKNOWN',
      'UNKNOWN',
      'No accepted external sentinel projection is mounted into this shadow artifact.',
      'External sentinel owner',
      generatedAt,
    ),
    fact(
      'safety-leases',
      'Active leases',
      null,
      'UNKNOWN',
      'Unknown is retained as null. The UI never fabricates a zero lease count.',
      'Existing command/remediation owner',
      generatedAt,
    ),
  ];
}

function buildComponents(generatedAt: string): readonly AiOpsComponentProjection[] {
  const rows: readonly Omit<AiOpsComponentProjection, 'source'>[] = [
    {
      componentId: 'system-supervisor',
      label: 'System Integration supervisor',
      expected: true,
      discovered: null,
      instrumented: null,
      reporting: null,
      posture: 'UNKNOWN',
      dependencyIds: [],
      reason: 'Known existing owner by architecture, but no accepted current readback is mounted into A4.',
    },
    {
      componentId: 'product-assurance-read-owner',
      label: 'Product Assurance canonical read owner',
      expected: true,
      discovered: false,
      instrumented: null,
      reporting: null,
      posture: 'NOT_CONFIGURED',
      dependencyIds: ['system-supervisor'],
      reason: 'PRODUCT_ASSURANCE_CANONICAL_READ_OWNER_NOT_CONFIGURED.',
    },
    {
      componentId: 'incident-owner',
      label: 'AI incident classifier / owner',
      expected: true,
      discovered: false,
      instrumented: null,
      reporting: null,
      posture: 'MISSING',
      dependencyIds: ['product-assurance-read-owner'],
      reason: 'INCIDENT_OWNER_NOT_CONFIGURED; this case is synthetic and non-durable.',
    },
    {
      componentId: 'case-router',
      label: 'Owner chat case router',
      expected: true,
      discovered: false,
      instrumented: null,
      reporting: null,
      posture: 'NOT_CONFIGURED',
      dependencyIds: ['incident-owner'],
      reason: 'No accepted AI chat/session interface exists.',
    },
    {
      componentId: 'provider-gateway',
      label: 'Diagnostic provider gateway',
      expected: true,
      discovered: false,
      instrumented: null,
      reporting: null,
      posture: 'BLOCKED',
      dependencyIds: ['product-assurance-read-owner'],
      reason: 'Workload identity, provider qualification, retention, budget, and egress proof are unfinished.',
    },
    {
      componentId: 'permission-owner',
      label: 'Server permission / budget projection',
      expected: true,
      discovered: false,
      instrumented: null,
      reporting: null,
      posture: 'NOT_WIRED',
      dependencyIds: ['product-assurance-read-owner'],
      reason: 'The browser has no accepted effect or readback route for the 120 AI_OPS entries.',
    },
    {
      componentId: 'diagnostic-kill-owner',
      label: 'Diagnostic-plane kill owner',
      expected: true,
      discovered: false,
      instrumented: null,
      reporting: null,
      posture: 'NOT_WIRED',
      dependencyIds: ['permission-owner'],
      reason: 'PENDING_BACKEND:SET_DIAGNOSTIC_PLANE_KILL.',
    },
    {
      componentId: 'synthetic-probe-owner',
      label: 'Synthetic UI probe owner',
      expected: true,
      discovered: false,
      instrumented: null,
      reporting: null,
      posture: 'MISSING',
      dependencyIds: ['system-supervisor'],
      reason: 'Only fixture evidence exists; no live probe runner or ingestion interface is accepted.',
    },
    {
      componentId: 'refresh-dock',
      label: 'RefreshDock / Connection Watchman',
      expected: true,
      discovered: null,
      instrumented: null,
      reporting: null,
      posture: 'NOT_WIRED',
      dependencyIds: ['system-supervisor'],
      reason: 'Known existing refresh/reset owner; A4 presents an unmounted contract and does not call it.',
    },
    {
      componentId: 'external-sentinel',
      label: 'External sentinel readback',
      expected: true,
      discovered: null,
      instrumented: null,
      reporting: null,
      posture: 'UNKNOWN',
      dependencyIds: [],
      reason: 'No accepted read projection supplied to A4; denominator remains visible.',
    },
    {
      componentId: 'diagnostic-context-projection',
      label: 'Diagnostic context projection',
      expected: true,
      discovered: true,
      instrumented: true,
      reporting: false,
      posture: 'SILENT',
      dependencyIds: ['product-assurance-read-owner'],
      reason: 'Expected projection is discovered but supplies no accepted current observation.',
    },
    {
      componentId: 'aggregate-rate-budget',
      label: 'Aggregate diagnostic rate-budget snapshot',
      expected: true,
      discovered: true,
      instrumented: true,
      reporting: true,
      posture: 'STALE',
      dependencyIds: ['system-supervisor'],
      reason: 'Fixture readback is 94 seconds old; canonical Intelligence Runtime binding remains pending.',
    },
    {
      componentId: 'fixture-role-mapping',
      label: 'Provider role mapping fixture',
      expected: true,
      discovered: true,
      instrumented: true,
      reporting: true,
      posture: 'SYNTHETIC_ONLY',
      dependencyIds: ['provider-gateway'],
      reason: 'Four obvious fake identities demonstrate presentation only; no provider is qualified or called.',
    },
    {
      componentId: 'audit-export-projection',
      label: 'AI audit export projection',
      expected: true,
      discovered: true,
      instrumented: true,
      reporting: true,
      posture: 'DEGRADED',
      dependencyIds: ['system-supervisor'],
      reason: 'Bounded fixture events render, but the complete Logs-owned audit binding is unavailable.',
    },
  ];

  return rows.map((row) => ({
    ...row,
    source: source('A4 shadow fixture inventory', `fixture:component:${row.componentId}`, generatedAt),
  }));
}

function buildOverviewBands(generatedAt: string, extensionBaseSha: string): readonly AiOpsOverviewBand[] {
  return [
    {
      bandId: 'runtime-identity',
      label: 'Runtime, identities, versions',
      detail: 'Mode, role isolation, provider qualification, and immutable release identities.',
      facts: [
        fact('overview-mode', 'AI mode req / eff / readback', 'SHADOW / UNKNOWN / UNKNOWN', 'NOT_WIRED', 'Requested mode is not effective authority.', 'Canonical Control Plane', generatedAt),
        fact('overview-provider', 'Provider health', 'NOT_CONFIGURED', 'NOT_CONFIGURED', 'fixture-provider.invalid is never called.', 'Diagnostic provider owner', generatedAt),
        fact('overview-roles', 'Role mapping', '4 FIXTURE IDENTITIES', 'SYNTHETIC_ONLY', 'Diagnostician, repair, verifier, and research roles remain isolated.', 'Provider workload-identity owner', generatedAt),
        fact('overview-versions', 'Versions', 'fixture-r1', 'SYNTHETIC_ONLY', 'Provider/model/prompt/tool/policy/control-registry fixture revisions.', 'Release and policy owners', generatedAt),
        fact('overview-ai-off', 'AI-off survival requirement', 'REQUIRES ACCEPTED PROOF', 'SYNTHETIC_ONLY', 'The directive requires deterministic product behavior to continue without AI; A4 has no live survival readback.', 'System Integration supervisor', generatedAt),
      ],
    },
    {
      bandId: 'budgets-queues',
      label: 'Budgets, queues, telemetry loss',
      detail: 'Cost/token/rate ceilings stay unknown until the accepted aggregate owner binds them.',
      facts: [
        fact('overview-spend', 'Hour / day / incident spend', null, 'UNKNOWN', 'No accepted provider billing or budget readback.', 'Diagnostic budget owner', generatedAt, 'USD'),
        fact('overview-tokens', 'Token allowance remaining', null, 'UNKNOWN', 'No accepted per-role/provider budget projection.', 'Diagnostic budget owner', generatedAt, 'tokens'),
        fact('overview-queue', 'Queue / backpressure', 34, 'DEGRADED', 'Synthetic queue series is rising.', 'Canonical workflow owner', generatedAt, 'items'),
        fact('overview-dlq', 'DLQ / WAL', null, 'UNKNOWN', 'No accepted durable workflow readback is supplied.', 'Canonical workflow and persistence owners', generatedAt),
        fact('overview-loss', 'Dropped / coalesced events', '0 / 8', 'DEGRADED', 'Fixture projects no drops and eight coalesced events; neither is a live readback.', 'Canonical workflow owner', generatedAt),
      ],
    },
    {
      bandId: 'cases-work',
      label: 'Cases, work, effects',
      detail: 'All work counts are fixture projections and every effect count stays zero.',
      facts: [
        fact('overview-cases', 'Cases by severity / state', '1 SEV2 / INVESTIGATING', 'SYNTHETIC_ONLY', 'One non-durable fixture case.', 'Incident owner', generatedAt),
        fact('overview-diagnoses', 'Diagnoses / proposals', '1 / 1', 'SYNTHETIC_ONLY', 'Fixture hypothesis and evidence-request proposal only.', 'Diagnostic case owner', generatedAt),
        fact('overview-patches', 'Sandbox patches / approvals', '0 / 0', 'SYNTHETIC_ONLY', 'The A4 fixture created no repair worktree or approval request; no owner readback is mounted.', 'Repair and approval owners', generatedAt),
        fact('overview-effects', 'Repairs / canaries / rollbacks', '0 / 0 / 0', 'SYNTHETIC_ONLY', 'The A4 fixture has no registered effect, release, or rollback path; no owner readback is mounted.', 'Command and release owners', generatedAt),
        fact('overview-leases', 'Leases / fencing epochs / campaigns', null, 'UNKNOWN', 'Unknown owner state is not fabricated as zero.', 'Existing command/remediation owner', generatedAt),
      ],
    },
    {
      bandId: 'worktree-recovery',
      label: 'Worktree, recovery, learning',
      detail: 'Source identity is exact; candidate, deployed, rollback, and promotion truth remain owner-supplied.',
      facts: [
        fact('overview-worktree', 'Worker / extension base', `aiops-shadow-a4 / ${extensionBaseSha.slice(0, 12)}`, 'SHADOW_SPECULATIVE', 'Exclusive paths: web/src/aiOps, fixtures/aiOps/ui, test/aiOps/ui.', 'Git / shadow worker', generatedAt),
        fact('overview-shas', 'Candidate / deployed SHA', null, 'UNKNOWN', 'A4 cannot claim a candidate or deployed revision.', 'Release owner', generatedAt),
        fact('overview-lkg', 'Last-known-good / rollback', null, 'UNKNOWN', 'No accepted canary, rollback artifact, or readback supplied.', 'Release owner', generatedAt),
        fact('overview-learning', 'Learning / quarantine', '1 FIXTURE / 1 QUARANTINED', 'SYNTHETIC_ONLY', 'No promotion, demotion, or retirement authority is mounted.', 'Evaluation and promotion owner', generatedAt),
        fact('overview-independent', 'Independent readback / sentinel', 'UNKNOWN / UNKNOWN', 'UNKNOWN', 'Both accepted owner projections remain unfinished.', 'Independent verifier and sentinel owners', generatedAt),
      ],
    },
  ];
}

const TREND_AT = [
  '2026-07-14T11:35:00.000Z',
  '2026-07-14T11:40:00.000Z',
  '2026-07-14T11:45:00.000Z',
  '2026-07-14T11:50:00.000Z',
  '2026-07-14T11:55:00.000Z',
  '2026-07-14T12:00:00.000Z',
] as const;

function trend(
  seriesId: string,
  label: string,
  unit: string,
  posture: AiOpsTrendSeries['posture'],
  values: readonly (number | null)[],
  owner: string,
  generatedAt: string,
): AiOpsTrendSeries {
  const metricFamily: AiOpsTrendSeries['metricFamily'] = seriesId.includes('age')
    ? 'AGE'
    : seriesId.includes('processing')
      ? 'LATENCY'
      : seriesId.includes('queue')
        ? 'QUEUE'
        : seriesId.includes('dropped') || seriesId.includes('coalesced')
          ? 'EVENT_LOSS'
          : seriesId.includes('reconciliation') || seriesId.includes('ambiguity')
            ? 'RECONCILIATION'
            : seriesId.includes('recovery')
              ? 'RECOVERY'
              : seriesId.includes('cost') || seriesId.includes('funding') || seriesId.includes('borrow') || seriesId.includes('slippage')
                ? 'EXECUTION_COST'
                : seriesId.includes('incident')
                  ? 'INCIDENT'
                  : seriesId.includes('cpu') || seriesId.includes('memory') || seriesId.includes('disk') || seriesId.includes('wal')
                    ? 'HOST_CAPACITY'
                    : 'RATE_BUDGET';
  const percentile: AiOpsTrendSeries['percentile'] = seriesId.includes('p50')
    ? 'P50'
    : seriesId.includes('p95')
      ? 'P95'
      : seriesId.includes('p99')
        ? 'P99'
        : 'NONE';
  return {
    seriesId,
    label,
    unit,
    metricFamily,
    percentile,
    window: 'PT30M',
    resolution: 'PT5M',
    sampleLimit: TREND_AT.length,
    shortWindow: 'PT5M',
    longWindow: 'PT1H',
    alertClass: 'UNKNOWN',
    shortWindowBurn: null,
    longWindowBurn: null,
    drilldownLimit: 1,
    drilldownRefs: [`fixture:trend-drilldown:${seriesId}`],
    posture,
    samples: TREND_AT.map((at, index) => ({ at, value: values[index] ?? null })),
    source: source(owner, `fixture:trend:${seriesId}`, generatedAt),
  };
}

function buildTrends(generatedAt: string): readonly AiOpsTrendSeries[] {
  return [
    trend('source-age-p95', 'Source age p95', 's', 'STALE', [12, 16, 24, 41, 68, 94], 'System Integration supervisor', generatedAt),
    trend('process-age-p95', 'Process age p95', 's', 'UNKNOWN', [null, null, null, null, null, null], 'System Integration supervisor', generatedAt),
    trend('processing-p50', 'Processing p50', 'ms', 'SYNTHETIC_ONLY', [120, 130, 145, 180, 220, 280], 'Canonical telemetry owner', generatedAt),
    trend('processing-p95', 'Processing p95', 'ms', 'SYNTHETIC_ONLY', [310, 340, 390, 580, 760, 980], 'Canonical telemetry owner', generatedAt),
    trend('processing-p99', 'Processing p99', 'ms', 'DEGRADED', [420, 460, 510, 830, 1100, 1460], 'Canonical telemetry owner', generatedAt),
    trend('queue-depth', 'Queue / backpressure', 'items', 'DEGRADED', [3, 4, 7, 13, 21, 34], 'Canonical workflow owner', generatedAt),
    trend('dropped-events', 'Dropped events', 'count', 'UNKNOWN', [null, null, null, null, null, null], 'Canonical workflow owner', generatedAt),
    trend('coalesced-events', 'Coalesced events', 'count', 'DEGRADED', [1, 1, 2, 3, 5, 8], 'Canonical workflow owner', generatedAt),
    trend('reconciliation-gap', 'Reconciliation gap', 's', 'UNKNOWN', [null, null, null, null, null, null], 'Foundation reconciliation owner', generatedAt),
    trend('ambiguity-duration', 'Ambiguity duration', 's', 'DEGRADED', [0, 0, 8, 21, 47, 94], 'System Integration supervisor', generatedAt),
    trend('recovery-success', 'Automatic recovery success', '%', 'SYNTHETIC_ONLY', [100, 100, 80, 80, 60, 60], 'Existing remediation owner', generatedAt),
    trend('provider-cost', 'Provider cost', 'USD', 'NOT_CONFIGURED', [null, null, null, null, null, null], 'Diagnostic budget owner', generatedAt),
    trend('execution-cost', 'Execution cost', 'USD', 'UNKNOWN', [null, null, null, null, null, null], 'Capital economics owner', generatedAt),
    trend('funding-cost', 'Funding cost', 'USD', 'UNKNOWN', [null, null, null, null, null, null], 'Capital economics owner', generatedAt),
    trend('borrow-cost', 'Borrow cost', 'USD', 'UNKNOWN', [null, null, null, null, null, null], 'Capital economics owner', generatedAt),
    trend('slippage-cost', 'Slippage', 'bps', 'UNKNOWN', [null, null, null, null, null, null], 'Capital economics owner', generatedAt),
    trend('incident-count', 'Open incidents', 'count', 'SYNTHETIC_ONLY', [0, 0, 1, 1, 1, 1], 'Incident owner', generatedAt),
    trend('cpu-pressure', 'CPU use', '%', 'SYNTHETIC_ONLY', [42, 44, 46, 52, 57, 61], 'Host telemetry owner', generatedAt),
    trend('memory-pressure', 'Memory use', '%', 'UNKNOWN', [null, null, null, null, null, null], 'Host telemetry owner', generatedAt),
    trend('disk-pressure', 'Disk use', '%', 'UNKNOWN', [null, null, null, null, null, null], 'Host telemetry owner', generatedAt),
    trend('wal-pressure', 'WAL use', '%', 'UNKNOWN', [null, null, null, null, null, null], 'Canonical persistence owner', generatedAt),
    trend('rate-budget', 'Rate-budget use', '%', 'UNKNOWN', [null, null, null, null, null, null], 'Intelligence Runtime aggregate rate-budget owner', generatedAt),
  ];
}

function buildCommands(): readonly AiOpsIncidentCommandProjection[] {
  const rows: readonly [AiOpsIncidentCommandProjection['commandId'], string, string][] = [
    ['GATHER_MORE_EVIDENCE', 'Gather evidence', 'Request a bounded canonical evidence bundle.'],
    ['RUN_READ_ONLY_REPLAY', 'Read-only replay', 'Request a network-free replay through the registered owner.'],
    ['OPEN_ISOLATED_REPAIR', 'Prepare isolated repair', 'Request an admitted disposable worktree; never Main or production.'],
    ['REQUEST_INDEPENDENT_REVIEW', 'Independent review', 'Request a separate identity over frozen evidence.'],
    ['REQUEST_ONE_REGISTERED_CLASS_A_RUNBOOK', 'One Class-A runbook', 'Request one registered deterministic remediation.'],
    ['REJECT_PROPOSAL', 'Reject proposal', 'Record an owner rejection through the canonical workflow.'],
    ['ESCALATE_TO_OWNER', 'Escalate', 'Request authenticated owner attention.'],
    ['ARCHIVE_AFTER_VERIFICATION', 'Archive after verification', 'Request archival only after verified outcome readback.'],
  ];
  return rows.map(([commandId, label, expectedEffect]) => ({
    commandId,
    label,
    status: 'NOT_WIRED',
    reason: 'Fixture projection only; no incident command handler, identity, lease, receipt, or readback is mounted.',
    expectedEffect,
    authorityCreated: false,
  }));
}

function buildIncident(generatedAt: string): AiOpsIncidentProjection {
  const incidentSource = 'Synthetic incident fixture; canonical incident owner is not configured';
  return {
    caseId: 'FIXTURE-CASE-A4-0001',
    severity: 'SEV2',
    state: 'INVESTIGATING',
    posture: 'SYNTHETIC_ONLY',
    title: 'Diagnostic provider projection is stale while canonical owners remain unfinished',
    summary:
      'A synthetic supervisor snapshot shows rising source age and queue depth. The fixture cannot determine whether a live provider outage exists because provider, incident, and aggregate budget owners are not mounted.',
    affectedComponentIds: ['provider-gateway', 'incident-owner', 'permission-owner'],
    expectedState: 'Qualified provider route with bounded identity, retention, budget, trace, and independent readback.',
    observedState: 'Fixture provider is intentionally invalid; canonical state is NOT_CONFIGURED or UNKNOWN.',
    freshness: fact('incident-freshness', 'Evidence freshness', 94, 'STALE', 'Oldest required source age.', incidentSource, generatedAt, 's'),
    coherence: fact('incident-coherence', 'Evidence coherence', null, 'UNKNOWN', 'Provider and budget owners supply no accepted comparison.', incidentSource, generatedAt),
    completeness: fact('incident-completeness', 'Evidence completeness', 0.62, 'DEGRADED', 'Four of seven expected owner projections are absent.', incidentSource, generatedAt, 'ratio'),
    suppression: {
      fingerprint: 'fixture:provider-age-and-queue:r1',
      resourceGeneration: 'provider-gateway:fixture-generation-1',
      rawEventCount: 8,
      deduplicatedCount: 7,
      disposition: 'UNKNOWN',
      dependencyRootIncidentId: 'FIXTURE-INCIDENT-A4-0001',
      inhibitedBy: 'provider-gateway',
      inhibitedSymptomIds: ['FIXTURE-SYMPTOM-QUEUE-01', 'FIXTURE-SYMPTOM-AGE-01'],
      childEvidencePreserved: true,
      silenceWindow: {
        windowId: null,
        kind: null,
        signedBy: null,
        expiresAt: null,
        receiptId: null,
        status: 'UNKNOWN',
      },
      stormParentId: null,
      boundedChildCount: null,
      resourceCooldownUntil: null,
      globalCooldownUntil: null,
      backoffAttempt: null,
      jitterMs: null,
      criticalReserve: 'UNKNOWN',
      actionable: null,
      actionReceipts: [
        { action: 'PAGE', receiptId: null, status: 'NOT_APPLICABLE' },
        { action: 'TICKET', receiptId: null, status: 'NOT_APPLICABLE' },
        { action: 'DIGEST', receiptId: null, status: 'NOT_APPLICABLE' },
        { action: 'SUPPRESSION', receiptId: null, status: 'MISSING' },
        { action: 'INHIBITION', receiptId: null, status: 'MISSING' },
        { action: 'DISCARD', receiptId: null, status: 'NOT_APPLICABLE' },
      ],
      rawEventEscapeRef: 'fixture:raw-events:provider-age-and-queue:r1',
      actionabilityMetrics: {
        duplicateRate: null,
        pagesPerIncident: null,
        inhibitedSymptoms: 2,
        falsePageRate: null,
        acknowledgementLatencyMs: null,
        unresolvedAgeMs: null,
        ownerFeedback: null,
      },
      reason: 'Actionability is unknown because no accepted suppression/inhibition/actionability owner exists.',
      source: source('Deterministic incident funnel owner', 'fixture:incident-funnel:a4-0001', generatedAt, 'PENDING_BACKEND'),
    },
    hypotheses: [
      {
        hypothesisId: 'FIXTURE-HYP-01',
        statement: 'A qualified provider route may be unavailable or rate-limited.',
        confidence: 0.46,
        posture: 'SYNTHETIC_ONLY',
        evidenceIds: ['EVID-FIXTURE-AGE-01', 'EVID-FIXTURE-QUEUE-01'],
        unknowns: ['provider readback', 'aggregate rate-budget state', 'credential expiry state'],
      },
      {
        hypothesisId: 'FIXTURE-HYP-02',
        statement: 'The observed delay may be projection staleness rather than a provider failure.',
        confidence: 0.39,
        posture: 'SYNTHETIC_ONLY',
        evidenceIds: ['EVID-FIXTURE-AGE-01'],
        unknowns: ['canonical owner observation time', 'workflow queue readback'],
      },
    ],
    failureAtlasMatches: ['FIXTURE_MATCH_ONLY:TELEMETRY_STALE', 'FIXTURE_MATCH_ONLY:DEPENDENCY_NOT_CONFIGURED'],
    timeline: [
      {
        eventId: 'FIXTURE-EVT-01',
        at: '2026-07-14T11:45:00.000Z',
        kind: 'MATERIAL_EVENT_FIXTURE',
        summary: 'Source age crossed the synthetic warning threshold.',
        posture: 'SYNTHETIC_ONLY',
        evidenceIds: ['EVID-FIXTURE-AGE-01'],
        correlationId: 'fixture-correlation-a4-0001',
      },
      {
        eventId: 'FIXTURE-EVT-02',
        at: '2026-07-14T11:50:00.000Z',
        kind: 'DEDUPE_FIXTURE',
        summary: 'Seven related fixture alerts condensed under one fingerprint.',
        posture: 'SYNTHETIC_ONLY',
        evidenceIds: ['EVID-FIXTURE-DEDUPE-01'],
        correlationId: 'fixture-correlation-a4-0001',
      },
      {
        eventId: 'FIXTURE-EVT-03',
        at: generatedAt,
        kind: 'POLICY_PROJECTION',
        summary: 'All incident commands remain NOT_WIRED; no effect was attempted.',
        posture: 'NOT_WIRED',
        evidenceIds: ['EVID-FIXTURE-POLICY-01'],
        correlationId: 'fixture-correlation-a4-0001',
      },
    ],
    toolReceipts: [
      fact('tool-readback', 'Tool invocations', 0, 'SYNTHETIC_ONLY', 'No tool or network call occurs in the A4 fixture.', incidentSource, generatedAt, 'count'),
      fact('cost-readback', 'Provider cost', 0, 'NOT_CONFIGURED', 'Zero is fixture cost, not evidence of a live billing readback.', incidentSource, generatedAt, 'USD'),
    ],
    proposal: fact('proposal-state', 'Proposed action', 'GATHER_MORE_EVIDENCE', 'NOT_WIRED', 'Draft recommendation only; incident gate remains authoritative.', incidentSource, generatedAt),
    policyDecision: fact('policy-state', 'Policy result', 'BLOCKED_NOT_WIRED', 'BLOCKED', 'No canonical command handler, approval, lease, receipt, or readback.', incidentSource, generatedAt),
    validation: [
      fact('validation-schema', 'Schema validation', 'PASS_FIXTURE', 'SYNTHETIC_ONLY', 'Fixture schema validation only.', incidentSource, generatedAt),
      fact('validation-freshness', 'Freshness validation', 'FAIL_FIXTURE', 'STALE', 'Synthetic evidence exceeds its displayed ceiling.', incidentSource, generatedAt),
      fact('validation-independence', 'Independent review', null, 'UNKNOWN', 'No verifier interface is mounted.', incidentSource, generatedAt),
    ],
    diagnosticValidation: {
      validationId: 'FIXTURE-VALIDATION-A4-0001',
      claim: 'The qualified diagnostic provider route is unavailable or rate-limited.',
      sourceHash: 'sha256:fixture-derived-claim-source-a4-do-not-trust',
      parserRevision: 'fixture-otel-envelope-parser-r1',
      sanitizerRevision: 'fixture-redaction-r1',
      extractionMethod: 'DETERMINISTIC_FIXTURE_FIELDS',
      confidence: null,
      freshness: 'STALE_94S',
      temporalRelation: 'SOURCE_AGE_PRECEDES_QUEUE_OBSERVATION_FIXTURE_ONLY',
      disposition: 'INCONCLUSIVE',
      checks: [
        {
          checkId: 'FIXTURE-CHECK-EVIDENCE-01',
          category: 'EVIDENCE_POINTER',
          expected: 'Every cited evidence identity resolves to the bounded fixture bundle.',
          observed: 'Two fixture evidence identities resolve; no canonical provider readback exists.',
          disposition: 'VALIDATED',
          reason: 'Only fixture pointer integrity is validated; this does not validate the operational claim.',
          evidenceIds: ['EVID-FIXTURE-AGE-01', 'EVID-FIXTURE-QUEUE-01'],
        },
        {
          checkId: 'FIXTURE-CHECK-RESOURCE-01',
          category: 'RESOURCE_IDENTITY',
          expected: 'Accepted provider workload identity and route generation.',
          observed: null,
          disposition: 'INCONCLUSIVE',
          reason: 'Provider workload identity projection is not configured.',
          evidenceIds: [],
        },
        {
          checkId: 'FIXTURE-CHECK-TIME-01',
          category: 'TIME_WINDOW',
          expected: 'All required evidence is no older than 30 seconds.',
          observed: 'Oldest fixture source age is 94 seconds.',
          disposition: 'INVALIDATED',
          reason: 'The fixture freshness precondition fails.',
          evidenceIds: ['EVID-FIXTURE-AGE-01'],
        },
        {
          checkId: 'FIXTURE-CHECK-DEPLOYED-01',
          category: 'DEPLOYED_REVISION',
          expected: 'Exact deployed revision is independently read back.',
          observed: null,
          disposition: 'INCONCLUSIVE',
          reason: 'No deployed revision owner is mounted.',
          evidenceIds: [],
        },
        {
          checkId: 'FIXTURE-CHECK-CONFIG-01',
          category: 'CONFIG_REVISION',
          expected: 'Exact provider, budget, policy, and control revisions are current.',
          observed: null,
          disposition: 'INCONCLUSIVE',
          reason: 'Canonical configuration revisions are unavailable.',
          evidenceIds: [],
        },
        {
          checkId: 'FIXTURE-CHECK-INVARIANT-01',
          category: 'CLAIMED_INVARIANT',
          expected: 'A qualified provider route exists and reports current health.',
          observed: 'The only provider identity is an obvious invalid fixture.',
          disposition: 'INCONCLUSIVE',
          reason: 'Missing owner truth cannot be replaced by the fixture provider.',
          evidenceIds: ['EVID-FIXTURE-POLICY-01'],
        },
      ],
      validatedEvidenceIds: ['EVID-FIXTURE-AGE-01', 'EVID-FIXTURE-QUEUE-01'],
      invalidatedHypothesisIds: [],
      missingEvidence: ['provider route readback', 'aggregate rate-budget readback', 'deployed revision', 'configuration revision'],
      conflictingEvidence: ['Stale source age may reflect projection delay rather than provider failure.'],
      falsificationTests: ['Read the qualified provider route independently.', 'Compare queue age before and after a bounded read-only probe.'],
      nextSteps: ['Request a bounded canonical evidence bundle.', 'Stop if any required owner pointer remains unresolved.'],
      stopCondition: 'No operational effect until every required check is VALIDATED by the canonical verifier.',
      effectAuthorized: false,
      expiresAt: '2026-07-14T12:00:30.000Z',
      source: source('Independent diagnostic validation owner', 'fixture:diagnostic-validation:a4-0001', generatedAt, 'PENDING_BACKEND'),
    },
    forensicBundle: {
      bundleId: 'FIXTURE-FORENSIC-BUNDLE-A4-0001',
      correlationId: 'fixture-correlation-a4-0001',
      rawEventEscapeRef: 'fixture:raw-events:provider-age-and-queue:r1',
      rawStreamSentToModel: false,
      retention: 'BOUNDED_FIXTURE_ONLY',
      access: 'READ_ONLY_FIXTURE',
      artifacts: [
        {
          artifactId: 'FIXTURE-ARTIFACT-EVIDENCE-01',
          kind: 'EVIDENCE',
          label: 'Bounded age and queue evidence',
          hash: 'sha256:fixture-evidence-a4-do-not-trust',
          revision: 'fixture-evidence-r1',
          observedAt: generatedAt,
          posture: 'SYNTHETIC_ONLY',
          bounded: true,
          source: source('Evidence bundle owner', 'fixture:forensic:evidence', generatedAt),
        },
        {
          artifactId: 'FIXTURE-ARTIFACT-TRACE-01',
          kind: 'TRACE',
          label: 'Bounded correlation trace',
          hash: 'sha256:fixture-trace-a4-do-not-trust',
          revision: 'fixture-trace-r1',
          observedAt: generatedAt,
          posture: 'SYNTHETIC_ONLY',
          bounded: true,
          source: source('System Integration trace index', 'fixture:forensic:trace', generatedAt),
        },
        {
          artifactId: 'FIXTURE-ARTIFACT-LOG-01',
          kind: 'LOG',
          label: 'Logs-owned audit link',
          hash: null,
          revision: null,
          observedAt: null,
          posture: 'NOT_WIRED',
          bounded: true,
          source: source('Logs owner', 'fixture:forensic:logs-link', generatedAt, 'PENDING_BACKEND'),
        },
        {
          artifactId: 'FIXTURE-ARTIFACT-DECISION-01',
          kind: 'DECISION',
          label: 'Blocked policy projection',
          hash: 'sha256:fixture-policy-decision-a4-do-not-trust',
          revision: 'fixture-policy-r1',
          observedAt: generatedAt,
          posture: 'BLOCKED',
          bounded: true,
          source: source('Policy decision owner', 'fixture:forensic:decision', generatedAt, 'PENDING_BACKEND'),
        },
        {
          artifactId: 'FIXTURE-ARTIFACT-DIFF-01',
          kind: 'DIFF',
          label: 'Isolated patch diff',
          hash: null,
          revision: null,
          observedAt: null,
          posture: 'MISSING',
          bounded: true,
          source: source('Repair pipeline owner', 'fixture:forensic:diff', generatedAt, 'PENDING_BACKEND'),
        },
        {
          artifactId: 'FIXTURE-ARTIFACT-TEST-01',
          kind: 'TEST',
          label: 'Fixture schema and network-deny proof',
          hash: 'sha256:fixture-test-proof-a4-do-not-trust',
          revision: 'fixture-test-r1',
          observedAt: generatedAt,
          posture: 'SYNTHETIC_ONLY',
          bounded: true,
          source: source('A4 focused test owner', 'fixture:forensic:test', generatedAt),
        },
        {
          artifactId: 'FIXTURE-ARTIFACT-RECEIPT-01',
          kind: 'RECEIPT',
          label: 'Canonical command receipt',
          hash: null,
          revision: null,
          observedAt: null,
          posture: 'MISSING',
          bounded: true,
          source: source('Existing command receipt owner', 'fixture:forensic:receipt', generatedAt, 'PENDING_BACKEND'),
        },
      ],
      unresolved: ['canonical provider readback', 'independent validation', 'command receipt', 'postmortem owner'],
      postmortem: {
        required: true,
        status: 'NOT_CONFIGURED',
        owner: null,
        deadline: null,
        regressionTestId: null,
      },
    },
    commands: buildCommands(),
  };
}

function buildChat(generatedAt: string): readonly AiOpsChatMessageProjection[] {
  return [
    {
      messageId: 'fixture-chat-01',
      role: 'SYSTEM',
      at: '2026-07-14T11:58:00.000Z',
      body: 'SYNTHETIC_ONLY transcript. No provider, personal ChatGPT session, persistence, or privileged natural-language path is connected.',
      posture: 'SYNTHETIC_ONLY',
      evidenceIds: [],
      capabilityRequest: null,
    },
    {
      messageId: 'fixture-chat-02',
      role: 'OWNER_FIXTURE',
      at: '2026-07-14T11:59:00.000Z',
      body: 'What is broken right now?',
      posture: 'SYNTHETIC_ONLY',
      evidenceIds: [],
      capabilityRequest: null,
    },
    {
      messageId: 'fixture-chat-03',
      role: 'AI_FIXTURE',
      at: generatedAt,
      body:
        'The fixture shows stale source age and rising queue depth, but a live provider outage is unproven. The incident, provider, and aggregate rate-budget owners are missing or not configured. No action has been taken.',
      posture: 'SYNTHETIC_ONLY',
      evidenceIds: ['EVID-FIXTURE-AGE-01@2026-07-14T12:00:00.000Z', 'EVID-FIXTURE-QUEUE-01@2026-07-14T12:00:00.000Z'],
      capabilityRequest: {
        capabilityId: 'GATHER_MORE_EVIDENCE',
        expectedEffect: 'Ask the deterministic owner for a bounded canonical evidence bundle.',
        policyResult: 'NOT_WIRED',
        cost: 'UNKNOWN',
        currentState: 'DRAFT_ONLY',
        authorityCreated: false,
      },
    },
  ];
}

function buildGovernance(generatedAt: string): readonly AiOpsGovernanceRow[] {
  const rows: readonly Omit<AiOpsGovernanceRow, 'source'>[] = [
    {
      itemId: 'fixture-classification-r1',
      family: 'CLASSIFICATION',
      label: 'Provider-degradation mechanical classifier',
      revision: 'fixture-classifier-r1',
      posture: 'SYNTHETIC_ONLY',
      qualification: 'REFERENCE_ONLY',
      evidence: 'Fixture match; no accepted production classifier manifest.',
    },
    {
      itemId: 'fixture-runbook-r1',
      family: 'RUNBOOK',
      label: 'Gather provider route evidence',
      revision: 'fixture-runbook-r1',
      posture: 'NOT_WIRED',
      qualification: 'OWNER_BINDING_REQUIRED',
      evidence: 'No registered command, lease, fence, or postcondition readback.',
    },
    {
      itemId: 'fixture-policy-r1',
      family: 'POLICY',
      label: 'Diagnostic authority envelope',
      revision: 'fixture-policy-r1',
      posture: 'BLOCKED',
      qualification: 'PENDING_BACKEND',
      evidence: 'UI projects supplied bounds; Product Assurance remains the evaluator.',
    },
    {
      itemId: 'fixture-provider-r1',
      family: 'PROVIDER',
      label: 'fixture-provider.invalid / fixture-model-never-call',
      revision: 'fixture-provider-r1',
      posture: 'NOT_CONFIGURED',
      qualification: 'UNQUALIFIED_OBVIOUS_FAKE',
      evidence: 'No authentication, billing, retention, egress, schema, budget, or eval proof.',
    },
    {
      itemId: 'fixture-capability-r1',
      family: 'CAPABILITY',
      label: 'Read-only diagnostic evidence request',
      revision: 'fixture-capability-r1',
      posture: 'NOT_WIRED',
      qualification: 'NO_GRADUATION_EVIDENCE',
      evidence: 'No numerical graduation record or accepted effect owner.',
    },
  ];

  return rows.map((row) => ({
    ...row,
    source: source('Product Assurance owner contracts', `fixture:governance:${row.itemId}`, generatedAt, 'PENDING_BACKEND'),
  }));
}

function buildProviderQualifications(
  generatedAt: string,
  provider: string,
  model: string,
): readonly AiOpsProviderQualificationProjection[] {
  const rows: readonly Omit<AiOpsProviderQualificationProjection, 'source'>[] = [
    {
      routeId: 'FIXTURE-ROUTE-RUNTIME-DIAGNOSTICIAN',
      role: 'RUNTIME_DIAGNOSTICIAN',
      provider,
      model: `${model}-diagnose`,
      activationState: 'DIAGNOSTIC_PLANE_UNAVAILABLE',
      runtimeState: 'DIAGNOSTIC_PLANE_UNAVAILABLE',
      authType: null,
      retention: null,
      storeBehavior: null,
      backgroundCompatibility: null,
      region: null,
      schemaParity: 'UNKNOWN',
      toolDenialParity: 'UNKNOWN',
      privacyParity: 'UNKNOWN',
      evaluationRevision: null,
      budgetId: null,
      emergencyReserve: null,
      credentialPosture: 'NOT_CONFIGURED',
      qualification: 'BLOCKED',
      fallbackRouteId: null,
      fallbackQualified: null,
      blockedReasons: ['API activation absent', 'retention unknown', 'schema and tool-denial parity unproven', 'budget owner unavailable'],
      posture: 'NOT_CONFIGURED',
    },
    {
      routeId: 'FIXTURE-ROUTE-ENGINEERING-REPAIR',
      role: 'ENGINEERING_REPAIR_WORKER',
      provider,
      model: `${model}-repair`,
      activationState: 'SUBSCRIPTION_CODEX_WORKER',
      runtimeState: 'OWNER_GATED',
      authType: 'FIXTURE_CHATGPT_MANAGED_AUTH',
      retention: null,
      storeBehavior: null,
      backgroundCompatibility: true,
      region: null,
      schemaParity: 'UNPROVEN',
      toolDenialParity: 'UNPROVEN',
      privacyParity: 'UNPROVEN',
      evaluationRevision: null,
      budgetId: null,
      emergencyReserve: null,
      credentialPosture: 'NOT_CONFIGURED',
      qualification: 'BLOCKED',
      fallbackRouteId: null,
      fallbackQualified: false,
      blockedReasons: [
        'Subscription-backed execution is fixture-only; trusted runner and workload identity readback are not configured',
        'Subscription exhaustion must not fall back to API billing or another account',
      ],
      posture: 'BLOCKED',
    },
    {
      routeId: 'FIXTURE-ROUTE-INDEPENDENT-VERIFIER',
      role: 'INDEPENDENT_VERIFICATION_WORKER',
      provider,
      model: `${model}-verify`,
      activationState: 'SUBSCRIPTION_CLAUDE_CODE_WORKER',
      runtimeState: 'OWNER_GATED',
      authType: 'FIXTURE_SUBSCRIPTION_OAUTH',
      retention: null,
      storeBehavior: null,
      backgroundCompatibility: true,
      region: null,
      schemaParity: 'UNKNOWN',
      toolDenialParity: 'UNKNOWN',
      privacyParity: 'UNKNOWN',
      evaluationRevision: null,
      budgetId: null,
      emergencyReserve: null,
      credentialPosture: 'NOT_CONFIGURED',
      qualification: 'UNQUALIFIED',
      fallbackRouteId: null,
      fallbackQualified: null,
      blockedReasons: [
        'Subscription-backed verifier is fixture-only; independent identity and evidence ancestry readback are absent',
        'Subscription exhaustion must not fall back to API billing or another account',
      ],
      posture: 'BLOCKED',
    },
    {
      routeId: 'FIXTURE-ROUTE-RESEARCH-ADVISOR',
      role: 'RESEARCH_CONTEXT_ADVISOR',
      provider,
      model: `${model}-research`,
      activationState: 'NOT_CONFIGURED',
      runtimeState: 'DISABLED',
      authType: null,
      retention: null,
      storeBehavior: null,
      backgroundCompatibility: null,
      region: null,
      schemaParity: 'UNKNOWN',
      toolDenialParity: 'UNKNOWN',
      privacyParity: 'UNKNOWN',
      evaluationRevision: null,
      budgetId: null,
      emergencyReserve: null,
      credentialPosture: 'NOT_CONFIGURED',
      qualification: 'UNQUALIFIED',
      fallbackRouteId: null,
      fallbackQualified: null,
      blockedReasons: ['Approved retrieval and provider route are not configured'],
      posture: 'NOT_CONFIGURED',
    },
  ];

  return rows.map((row) => ({
    ...row,
    source: source('Diagnostic provider qualification owner', `fixture:provider-route:${row.routeId}`, generatedAt, 'PENDING_BACKEND'),
  }));
}

function buildCapabilityGraduations(generatedAt: string): readonly AiOpsCapabilityGraduationProjection[] {
  return [
    {
      capabilityId: 'FIXTURE-CAPABILITY-BOUNDED-EVIDENCE-REQUEST',
      exactScope: 'One bounded read-only canonical evidence request for one admitted fixture case.',
      routeId: 'FIXTURE-ROUTE-RUNTIME-DIAGNOSTICIAN',
      modelRevision: 'fixture-model-never-call-diagnose-r1',
      promptRevision: 'fixture-prompt-r1',
      patchCategory: 'NO_PATCH_READ_ONLY',
      currentMode: 'OFF',
      proposedMode: 'SHADOW',
      disposition: 'NO_PROMOTION',
      metrics: [
        { metricId: 'LABELED_CASES', unit: 'cases', required: 100, observed: 12, result: 'FAIL' },
        { metricId: 'REPLAY_PASS_RATE', unit: 'ratio', required: 0.99, observed: 0.75, result: 'FAIL' },
        { metricId: 'FALSE_POSITIVE_RATE', unit: 'ratio ceiling', required: 0.01, observed: null, result: 'MISSING' },
        { metricId: 'FALSE_REPAIR_RATE', unit: 'ratio ceiling', required: 0.01, observed: null, result: 'MISSING' },
        { metricId: 'ABSTENTION_CALIBRATION', unit: 'ratio floor', required: 0.95, observed: null, result: 'MISSING' },
        { metricId: 'RECURRENCE_RATE', unit: 'ratio ceiling', required: 0.02, observed: null, result: 'MISSING' },
        { metricId: 'ROLLBACK_RATE', unit: 'ratio ceiling', required: 0, observed: null, result: 'MISSING' },
        { metricId: 'COST', unit: 'fixture USD ceiling', required: 0.1, observed: null, result: 'MISSING' },
        { metricId: 'LATENCY', unit: 'ms p95 ceiling', required: 5000, observed: null, result: 'MISSING' },
        { metricId: 'EVIDENCE_COMPLETENESS', unit: 'ratio floor', required: 1, observed: 0.62, result: 'FAIL' },
        { metricId: 'MAX_UNRESOLVED_SEVERITY', unit: 'severity ceiling', required: 'NONE', observed: 'SEV2', result: 'FAIL' },
      ],
      independentReviewer: null,
      evidenceIds: ['FIXTURE-GRADUATION-CORPUS-01'],
      demotionTriggers: ['provider/model/prompt revision drift', 'failed denial test', 'retention drift', 'budget breach', 'recurrence above fixture ceiling'],
      posture: 'BLOCKED',
      source: source('Capability graduation owner', 'fixture:capability-graduation:bounded-evidence', generatedAt, 'PENDING_BACKEND'),
    },
  ];
}

function buildContextManifest(
  manifest: AiOpsFixtureManifest,
): AiOpsContextManifestProjection {
  return {
    manifestId: 'FIXTURE-CONTEXT-MANIFEST-A4X-0001',
    generation: 1,
    signatureStatus: 'UNSIGNED_FIXTURE',
    staticContextHash: 'sha256:fixture-static-context-a4x-do-not-trust',
    dynamicContextHash: 'sha256:fixture-dynamic-context-a4x-do-not-trust',
    acceptedSha: null,
    baseSha: manifest.extensionBaseSha,
    deployedSha: null,
    authorityPointers: [
      { path: 'MISSION.md', blobHash: null, status: 'UNRESOLVED' },
      { path: 'ARCHITECTURE.md', blobHash: null, status: 'UNRESOLVED' },
      { path: 'DESIGN.md', blobHash: null, status: 'UNRESOLVED' },
    ],
    inventoryRevision: 'fixture-inventory-r1',
    dependencyRevision: 'fixture-dependency-r1',
    classificationRevision: 'fixture-classification-r1',
    runbookRevision: 'fixture-runbook-r1',
    policyRevision: 'fixture-policy-r1',
    toolRevision: 'fixture-tools-r1',
    controlRegistryRevision: 'UNMOUNTED',
    evaluationRevision: 'fixture-eval-r1',
    promptRevision: 'fixture-prompt-r1',
    providerQualificationRevision: 'UNMOUNTED',
    evidenceBundleHash: 'sha256:fixture-evidence-a4-do-not-trust',
    evidenceAgeLimitMs: 30000,
    validatedEvidenceIds: ['EVID-FIXTURE-AGE-01', 'EVID-FIXTURE-QUEUE-01'],
    safetyPosture: 'NO_AI_AUTHORITY / PROVIDER_NOT_CONFIGURED',
    leaseId: null,
    fencingEpoch: null,
    outstandingAmbiguity: 'Qualified provider route truth is unavailable.',
    provider: manifest.obviousFakeProvider,
    model: manifest.obviousFakeModel,
    budgets: ['tokens:UNKNOWN', 'cost:UNKNOWN', 'tools:0', 'network:0'],
    deadline: '2026-07-14T12:05:00.000Z',
    allowedTools: [],
    writeScope: [],
    hardDenials: ['NO_MONEY_ACTION', 'NO_SECRETS', 'NO_MAIN_OR_LIVE_WRITE', 'NO_SELF_APPROVAL', 'NO_MERGE_OR_DEPLOY'],
    priorAttemptIds: [],
    effectReceiptIds: [],
    unresolvedQuestions: ['Which canonical provider route, if any, is configured?', 'What is the current aggregate rate-budget state?'],
    exactTask: 'Explain the stale provider projection from bounded fixture evidence and stop without an effect.',
    acceptanceTests: ['Every citation resolves to the bounded fixture bundle.', 'Missing owner truth remains INCONCLUSIVE.'],
    stopCondition: 'Stop when any required authority pointer, provider readback, or independent verifier is unresolved.',
    nextOwner: 'Accepted authenticated case router and independent verifier',
    generationStatus: 'FAIL_CLOSED_UNRESOLVED_POINTERS',
    source: source('Generated context manifest owner', 'fixture:context-manifest:a4x-0001', manifest.generatedAt, 'PENDING_BACKEND'),
  };
}

function buildProbes(generatedAt: string): readonly AiOpsProbeProjection[] {
  const rows: readonly Omit<AiOpsProbeProjection, 'source'>[] = [
    ['page-auth', 'Page load and authentication', 'PAGE_AUTH', 'UNKNOWN', null, 'Authenticated existing product shell', []],
    ['route-widget', 'Expected routes and widgets', 'ROUTE_WIDGET', 'SYNTHETIC_ONLY', 'Fixture contract present', 'Integrator-owned canonical mount', ['fixture-dom-contract']],
    ['api-dom', 'API / DOM consistency', 'API_DOM_COHERENCE', 'NOT_WIRED', null, 'Canonical snapshot hash equals rendered hash', []],
    ['missing-stale', 'Missing and stale components', 'STALE_OR_MISSING', 'STALE', 'Three missing; one stale', 'No expected component disappears from denominator', ['fixture-inventory']],
    ['impossible-green', 'Impossible green detector', 'IMPOSSIBLE_GREEN', 'SYNTHETIC_ONLY', 'No false green in fixture', 'UNKNOWN/MISSING/STALE cannot render healthy', ['fixture-render-contract']],
    ['broken-control', 'Broken controls', 'CONTROL', 'NOT_WIRED', 'All backend actions disabled', 'Effect and readback handlers required', ['fixture-control-contract']],
    ['theme-diff', 'Light / dark baseline', 'THEME_DIFF', 'UNKNOWN', null, 'Canonical mounted browser comparison', []],
    ['console-network', 'Console / network errors', 'CONSOLE_NETWORK', 'SYNTHETIC_ONLY', 'No runtime network code in A4', 'Mounted browser probe owner', ['fixture-network-deny']],
    ['owner-journey', 'Critical owner journey', 'OWNER_JOURNEY', 'UNKNOWN', null, 'Owner can inspect then request through canonical policy', []],
  ].map(([probeId, label, probeClass, posture, observed, expected, artifactIds]) => ({
    probeId: probeId as string,
    label: label as string,
    class: probeClass as AiOpsProbeProjection['class'],
    posture: posture as AiOpsProbeProjection['posture'],
    observed: observed as string | null,
    expected: expected as string,
    artifactIds: artifactIds as readonly string[],
  }));

  return rows.map((row) => ({
    ...row,
    source: source('Synthetic UI probe owner', `fixture:probe:${row.probeId}`, generatedAt, 'PENDING_BACKEND'),
  }));
}

function buildCockpit(generatedAt: string): readonly AiOpsCockpitLevel[] {
  return [
    {
      levelId: 'L1_IMMEDIATE_SAFETY_VIEW',
      label: 'Immediate safety',
      purpose: 'What is unsafe, degraded, unknown, or awaiting the owner now.',
      posture: 'DEGRADED',
      facts: buildSafetySummary(generatedAt),
    },
    {
      levelId: 'L2_INVENTORY_DEPENDENCY_GRAPH',
      label: 'Inventory & dependencies',
      purpose: 'What must exist, what reports, and which owner binding is absent.',
      posture: 'MISSING',
      facts: [
        fact('l2-expected', 'Expected components', 14, 'SYNTHETIC_ONLY', 'Fixed fixture denominator.', 'Managed inventory owner', generatedAt),
        fact('l2-reporting', 'Reporting components', 5, 'SYNTHETIC_ONLY', 'Fixture projection, not a live discovery count.', 'Managed inventory owner', generatedAt),
        fact('l2-missing', 'Unavailable owner bindings', 7, 'MISSING', 'Canonical interfaces are explicitly retained in the denominator.', 'Managed inventory owner', generatedAt),
      ],
    },
    {
      levelId: 'L3_AUTOMATION_RESILIENCE',
      label: 'Automation & resilience',
      purpose: 'Cases, runbooks, leases, budgets, queues, canaries, rollback, and historical posture.',
      posture: 'DEGRADED',
      facts: [
        fact('l3-cases', 'Open fixture cases', 1, 'SYNTHETIC_ONLY', 'Non-durable fixture case.', 'Incident owner', generatedAt),
        fact('l3-queue', 'Queue depth', 34, 'DEGRADED', 'Synthetic rising queue series.', 'Canonical workflow owner', generatedAt, 'items'),
        fact('l3-rollback', 'Rollback readiness', null, 'UNKNOWN', 'No candidate, canary, or independent readback supplied.', 'Release owner', generatedAt),
        fact('l3-budget', 'Provider budget', null, 'UNKNOWN', 'Aggregate diagnostic rate-budget owner is unfinished.', 'Diagnostic budget owner', generatedAt),
      ],
    },
    {
      levelId: 'L4_MONEY_DECISION_LIFECYCLE',
      label: 'Money lifecycle — read only',
      purpose: 'Canonical mandate, proposal, order, fill, position, liability, and reconciliation truth without AI authority.',
      posture: 'UNKNOWN',
      facts: [
        fact('l4-mandate', 'Mandate', null, 'UNKNOWN', 'No active-subject projection supplied.', 'Capital Foundation', generatedAt),
        fact('l4-orders', 'Order authority', 'EXCLUDED BY LAW', 'SYNTHETIC_ONLY', 'The A4 surface has no order capability; canonical execution truth remains with Foundation.', 'Foundation execution owner', generatedAt),
        fact('l4-reconciliation', 'Reconciliation', null, 'UNKNOWN', 'Unknown is not rendered as a zero gap.', 'Foundation reconciliation owner', generatedAt),
      ],
    },
    {
      levelId: 'L5_INCIDENT_FORENSIC_DRILLDOWN',
      label: 'Incident & forensic drill-down',
      purpose: 'Bounded evidence, correlations, decisions, tools, diffs, tests, receipts, and unresolved unknowns.',
      posture: 'SYNTHETIC_ONLY',
      facts: [
        fact('l5-case', 'Selected case', 'FIXTURE-CASE-A4-0001', 'SYNTHETIC_ONLY', 'Fixture-only case identity.', 'Incident owner', generatedAt),
        fact('l5-correlation', 'Correlation', 'fixture-correlation-a4-0001', 'SYNTHETIC_ONLY', 'Bounded fixture trace.', 'System Integration trace index', generatedAt),
        fact('l5-effects', 'A4 effects executed', 0, 'SYNTHETIC_ONLY', 'A4 has no effect path; this zero is artifact-local, not canonical command-owner readback.', 'Existing command/remediation owner', generatedAt, 'count'),
      ],
    },
  ];
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
  }
  return value;
}

export function buildAiOpsShadowFixture(manifest: AiOpsFixtureManifest): AiOpsSnapshot {
  if (manifest.schema !== 'AiOpsShadowFixtureManifestV1' || manifest.version !== 1) {
    throw new Error('AI_OPS_FIXTURE_MANIFEST_UNSUPPORTED');
  }
  if (!manifest.obviousFakeProvider.endsWith('.invalid') || !manifest.obviousFakeModel.startsWith('fixture-')) {
    throw new Error('AI_OPS_FIXTURE_IDENTITY_MUST_BE_OBVIOUSLY_FAKE');
  }
  if (manifest.extensionBaseSha !== SEALED_A4_EXTENSION_BASE_SHA) {
    throw new Error('AI_OPS_FIXTURE_EXTENSION_BASE_SHA_MISMATCH');
  }
  if (!manifest.requestedControlIntents || typeof manifest.requestedControlIntents !== 'object') {
    throw new Error('AI_OPS_FIXTURE_REQUESTED_CONTROL_INTENTS_REQUIRED');
  }
  for (const controlId of Object.keys(manifest.requestedControlIntents)) {
    if (!/^AI_OPS\.[A-L](?:0[1-9]|10)$/.test(controlId)) {
      throw new Error(`AI_OPS_FIXTURE_REQUESTED_CONTROL_ID_INVALID:${controlId}`);
    }
  }

  const incident = buildIncident(manifest.generatedAt);
  if (incident.caseId !== manifest.selectedCaseId) throw new Error('AI_OPS_FIXTURE_SELECTED_CASE_MISMATCH');

  const snapshot: AiOpsSnapshot = {
    schema: 'AiOpsShadowFixtureV1',
    version: 1,
    fixtureId: manifest.fixtureId,
    posture: 'SHADOW_SPECULATIVE',
    baseSha: manifest.baseSha,
    extensionBaseSha: manifest.extensionBaseSha,
    generatedAt: manifest.generatedAt,
    environment: 'SYNTHETIC_FIXTURE',
    mountState: 'DIRECTOR_MOUNT_REQUIRED',
    canonicalOwnerState: 'UNFINISHED_I00_INTERFACES',
    safetySummary: buildSafetySummary(manifest.generatedAt),
    overviewBands: buildOverviewBands(manifest.generatedAt, manifest.extensionBaseSha),
    components: buildComponents(manifest.generatedAt),
    cockpit: buildCockpit(manifest.generatedAt),
    trends: buildTrends(manifest.generatedAt),
    incidents: [incident],
    selectedCaseId: manifest.selectedCaseId,
    chat: buildChat(manifest.generatedAt),
    controls: buildAiOpsControlSpecificationProjection({
      generatedAt: manifest.generatedAt,
      provider: manifest.obviousFakeProvider,
      model: manifest.obviousFakeModel,
      requestedControlIntents: manifest.requestedControlIntents,
    }),
    emergencyKill: {
      controlId: 'diagnostic-plane.kill',
      commandId: 'SET_DIAGNOSTIC_PLANE_KILL',
      desired: 'ENGAGED',
      requested: 'ENGAGED',
      requestStatus: 'LOCAL_FIXTURE_ONLY',
      effective: 'UNKNOWN',
      readback: 'UNKNOWN',
      readbackAgreement: null,
      status: 'NOT_WIRED',
      reason: 'PENDING_BACKEND:SET_DIAGNOSTIC_PLANE_KILL. This does not reuse the financial kill switch.',
      blockingReason: 'Effect and independent readback handlers are absent.',
      effectHandler: null,
      readbackHandler: null,
      registryRevision: 'UNMOUNTED',
      policyRevision: 'UNMOUNTED',
      lastKnownGoodRevision: null,
      requestedBy: 'FIXTURE_OWNER_ONLY',
      requestedAt: manifest.generatedAt,
      receiptId: null,
      independentlyObservedAt: null,
      quietPeriodEndsAt: null,
      selfReenableAllowed: false,
      evidenceRetentionContinues: true,
      financialKillAlias: false,
      postconditions: [
        fact('kill-runs-cancelled', 'Active AI runs cancelled', null, 'UNKNOWN', 'No accepted run owner readback.', 'Diagnostic-plane kill owner', manifest.generatedAt),
        fact('kill-egress-closed', 'Provider egress closed', null, 'UNKNOWN', 'No accepted egress proxy readback.', 'Credential and egress proxy owner', manifest.generatedAt),
        fact('kill-tools-revoked', 'Tool grants revoked', null, 'UNKNOWN', 'No accepted tool gateway readback.', 'Tool gateway owner', manifest.generatedAt),
        fact('kill-core-unchanged', 'Deterministic core unchanged', null, 'UNKNOWN', 'AI-off equivalence requires independent product readback.', 'System Integration supervisor', manifest.generatedAt),
        fact('kill-evidence-retained', 'Evidence retention', 'REQUIRED', 'SYNTHETIC_ONLY', 'The kill contract cannot disable audit, monitoring, or evidence retention.', 'Canonical Ledger and telemetry owners', manifest.generatedAt),
        fact('kill-quiet-period', 'Quiet period complete', null, 'UNKNOWN', 'No failure clears before authoritative readback and quiet period.', 'Independent verifier', manifest.generatedAt),
      ],
      authorityCreated: false,
      source: source('I09 + L14/IP-CONTROL diagnostic kill owner', 'fixture:diagnostic-plane.kill', manifest.generatedAt, 'PENDING_BACKEND'),
    },
    probes: buildProbes(manifest.generatedAt),
    governance: buildGovernance(manifest.generatedAt),
    providerQualifications: buildProviderQualifications(manifest.generatedAt, manifest.obviousFakeProvider, manifest.obviousFakeModel),
    capabilityGraduations: buildCapabilityGraduations(manifest.generatedAt),
    contextManifest: buildContextManifest(manifest),
    lineage: {
      contextHash: 'sha256:fixture-context-a4-do-not-trust',
      caseId: manifest.selectedCaseId,
      incidentId: 'FIXTURE-INCIDENT-A4-0001',
      workflowId: 'FIXTURE-WORKFLOW-A4-0001',
      runId: 'FIXTURE-RUN-A4-0001',
      sessionId: 'FIXTURE-SESSION-A4-0001',
      providerTraceId: null,
      parentRunId: null,
      parentSessionId: null,
      replacementReason: 'INITIAL_SESSION',
      role: 'RUNTIME_DIAGNOSTICIAN',
      phase: 'DIAGNOSE',
      generation: 1,
      startedAt: '2026-07-14T11:58:00.000Z',
      deadline: '2026-07-14T12:05:00.000Z',
      stopCondition: 'Stop when any required canonical pointer or provider readback is unresolved.',
      contextManifestId: 'FIXTURE-CONTEXT-MANIFEST-A4X-0001',
      checkpointIds: ['FIXTURE-CHECKPOINT-A4-0001'],
      retrievalIds: [],
      childLineageIds: [],
      hiddenCrossSessionMemoryAllowed: false,
      promptByteLimit: 32768,
      retrievedFileLimit: 12,
      childAgentLimit: 0,
      toolDepthLimit: 0,
      iterationLimit: 4,
      outputByteLimit: 16384,
      evidenceHash: 'sha256:fixture-evidence-a4-do-not-trust',
      policyRevision: 'fixture-policy-r1',
      promptRevision: 'fixture-prompt-r1',
      toolRevision: 'fixture-tools-r1',
      posture: 'SYNTHETIC_ONLY',
    },
    refreshDock: {
      owner: 'RefreshDock',
      endpoint: 'POST /api/refresh',
      target: 'runtime',
      targetPosture: 'CONTROL_PREVIEW_REQUIRED',
      requested: null,
      effective: null,
      readback: null,
      status: 'PROJECTION_ONLY',
      reason: 'A4 displays the existing owner contract only. It does not call refresh, reset, reconnect, or restart.',
      authorityCreated: false,
      source: source('RefreshDock / Connection Watchman', 'fixture:refresh-dock-projection', manifest.generatedAt, 'DIRECTOR_MOUNT_REQUIRED'),
    },
    unfinishedDependencies: [
      'PRODUCT_ASSURANCE_CANONICAL_READ_OWNER_NOT_CONFIGURED',
      'PENDING_BACKEND:SET_DIAGNOSTIC_PLANE_KILL',
      'PENDING_BACKEND:MOUNT_DIAGNOSTIC_PROVIDER_WORKLOAD_IDENTITY_PROJECTION',
      'PENDING_BACKEND:PROJECT_DIAGNOSTIC_WORKER_ASSURANCE_FIELDS',
      'INCIDENT_OWNER_NOT_CONFIGURED',
      'ACTION_EVIDENCE_OWNER_BINDING_PENDING',
      'ASSURANCE_CASE_OWNER_BINDING_PENDING',
      'A_AGENT_DIAGNOSTIC_GOVERNANCE_OWNER_BINDING_PENDING',
      'I08_S5_COVERAGE_CONTRACT_PENDING',
      'INTELLIGENCE_RUNTIME_AGGREGATE_RATE_BUDGET_PENDING',
      'AI_CHAT_SESSION_ACTIONABILITY_OWNER_NOT_ACCEPTED',
      'SYNTHETIC_UI_PROBE_OWNER_NOT_ACCEPTED',
      'L12_ACTIVE_SUBJECT_PRIVATE_TRUTH_ABSENT',
      'L13_ACCEPTED_PROJECTOR_INVOCATION_ABSENT',
      'L14_PRODUCTION_PERSISTENCE_AND_DISPATCH_ABSENT',
      'BROWSER_CONTINUITY_AND_SIX_RUN_COCKPIT_PROOF_PENDING',
    ],
    assumptions: [
      'All data is deterministic fixture data and must remain visibly SHADOW_SPECULATIVE or SYNTHETIC_ONLY.',
      'The future integrator supplies closed canonical snapshots; A4 never derives owner truth.',
      'The 120 rows are the directive specification catalog; the accepted integrator must replace every authority field from the existing canonical registry.',
      'Requested state never implies effective state; independent server readback is required.',
      'Unknown values remain null or UNKNOWN and are never fabricated as zero or healthy.',
      'The AI plane has no money, secret, Main, merge, deploy, self-approval, or authority-expansion path.',
    ],
  };

  return deepFreeze(snapshot) as AiOpsSnapshot;
}

export const DEFAULT_AI_OPS_SHADOW_FIXTURE = buildAiOpsShadowFixture(DEFAULT_AI_OPS_FIXTURE_MANIFEST);
