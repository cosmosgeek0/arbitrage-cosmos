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
  AiOpsSnapshot,
  AiOpsTrendSeries,
  ProjectedSource,
} from './types';

export const DEFAULT_AI_OPS_FIXTURE_MANIFEST: AiOpsFixtureManifest = {
  schema: 'AiOpsShadowFixtureManifestV1',
  version: 1,
  fixtureId: 'aiops-a4-shadow-provider-degraded-v1',
  baseSha: '03857dcdaff8d8b12627d27ddcc97505da1f2f86',
  generatedAt: '2026-07-14T12:00:00.000Z',
  selectedCaseId: 'FIXTURE-CASE-A4-0001',
  scenario: 'PROVIDER_DEGRADED_WITH_UNFINISHED_OWNERS',
  obviousFakeProvider: 'fixture-provider.invalid',
  obviousFakeModel: 'fixture-model-never-call',
  requestedControlIntents: { 'AI_OPS.A02': 'SHADOW' },
};

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

function buildOverviewBands(generatedAt: string, baseSha: string): readonly AiOpsOverviewBand[] {
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
        fact('overview-worktree', 'Worker / base', `aiops-shadow-a4 / ${baseSha.slice(0, 12)}`, 'SHADOW_SPECULATIVE', 'Exclusive paths: web/src/aiOps, fixtures/aiOps/ui, test/aiOps/ui.', 'Git / shadow worker', generatedAt),
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
  return {
    seriesId,
    label,
    unit,
    posture,
    samples: TREND_AT.map((at, index) => ({ at, value: values[index] ?? null })),
    source: source(owner, `fixture:trend:${seriesId}`, generatedAt),
  };
}

function buildTrends(generatedAt: string): readonly AiOpsTrendSeries[] {
  return [
    trend('source-age-p95', 'Source age p95', 's', 'STALE', [12, 16, 24, 41, 68, 94], 'System Integration supervisor', generatedAt),
    trend('processing-p99', 'Processing p99', 'ms', 'DEGRADED', [420, 460, 510, 830, 1100, 1460], 'Canonical telemetry owner', generatedAt),
    trend('queue-depth', 'Queue / backpressure', 'items', 'DEGRADED', [3, 4, 7, 13, 21, 34], 'Canonical workflow owner', generatedAt),
    trend('dropped-events', 'Dropped events', 'count', 'UNKNOWN', [null, null, null, null, null, null], 'Canonical workflow owner', generatedAt),
    trend('coalesced-events', 'Coalesced events', 'count', 'DEGRADED', [1, 1, 2, 3, 5, 8], 'Canonical workflow owner', generatedAt),
    trend('reconciliation-gap', 'Reconciliation gap', 's', 'UNKNOWN', [null, null, null, null, null, null], 'Foundation reconciliation owner', generatedAt),
    trend('ambiguity-duration', 'Ambiguity duration', 's', 'DEGRADED', [0, 0, 8, 21, 47, 94], 'System Integration supervisor', generatedAt),
    trend('recovery-success', 'Automatic recovery success', '%', 'SYNTHETIC_ONLY', [100, 100, 80, 80, 60, 60], 'Existing remediation owner', generatedAt),
    trend('provider-cost', 'Provider cost', 'USD', 'NOT_CONFIGURED', [null, null, null, null, null, null], 'Diagnostic budget owner', generatedAt),
    trend('incident-count', 'Open incidents', 'count', 'SYNTHETIC_ONLY', [0, 0, 1, 1, 1, 1], 'Incident owner', generatedAt),
    trend('host-pressure', 'CPU / memory / disk / WAL', '%', 'SYNTHETIC_ONLY', [42, 44, 46, 52, 57, 61], 'Host telemetry owner', generatedAt),
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
      deduplicatedCount: 7,
      inhibitedBy: 'provider-gateway',
      actionable: null,
      reason: 'Actionability is unknown because no accepted suppression/inhibition/actionability owner exists.',
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
    generatedAt: manifest.generatedAt,
    environment: 'SYNTHETIC_FIXTURE',
    mountState: 'DIRECTOR_MOUNT_REQUIRED',
    canonicalOwnerState: 'UNFINISHED_I00_INTERFACES',
    safetySummary: buildSafetySummary(manifest.generatedAt),
    overviewBands: buildOverviewBands(manifest.generatedAt, manifest.baseSha),
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
      requested: 'ENGAGED',
      effective: 'UNKNOWN',
      readback: 'UNKNOWN',
      status: 'NOT_WIRED',
      reason: 'PENDING_BACKEND:SET_DIAGNOSTIC_PLANE_KILL. This does not reuse the financial kill switch.',
      selfReenableAllowed: false,
      evidenceRetentionContinues: true,
      authorityCreated: false,
      source: source('I09 + L14/IP-CONTROL diagnostic kill owner', 'fixture:diagnostic-plane.kill', manifest.generatedAt, 'PENDING_BACKEND'),
    },
    probes: buildProbes(manifest.generatedAt),
    governance: buildGovernance(manifest.generatedAt),
    lineage: {
      contextHash: 'sha256:fixture-context-a4-do-not-trust',
      caseId: manifest.selectedCaseId,
      incidentId: 'FIXTURE-INCIDENT-A4-0001',
      workflowId: 'FIXTURE-WORKFLOW-A4-0001',
      runId: 'FIXTURE-RUN-A4-0001',
      sessionId: 'FIXTURE-SESSION-A4-0001',
      providerTraceId: null,
      parentRunId: null,
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
