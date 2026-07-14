import { useEffect, useSyncExternalStore } from 'react';
import { apiErrorMessage, fetchJson } from './http';

export type SystemSafeMode = 'READ_ONLY' | 'ADVISORY' | 'VALIDATE_ONLY';
export type SystemTruthLabel = 'LIVE_PUBLIC' | 'DRY_RUN' | 'SYNTHETIC_ONLY' | 'RECORDED_REPLAY' | 'UNAVAILABLE' | 'UNKNOWN';
export type SystemReadiness = 'STOPPED' | 'WARMING' | 'READY' | 'DEGRADED' | 'BLOCKED' | 'FAILED';
export type SystemOverallPosture = 'STOPPED' | 'WARMING' | 'READY' | 'DEGRADED' | 'BLOCKED' | 'FAILED';

export type SystemComponentId =
  | 'public-spot-source'
  | 'public-usdm-source'
  | 'market-universe'
  | 'intelligence-runtime'
  | 'market-intelligence'
  | 'basis-engine'
  | 'volume-engine'
  | 'capital-supervision'
  | 'multileg-risk'
  | 'execution-coordinator-validate-only'
  | 'reconciliation'
  | 'ledger-persistence'
  | 'engine-supervisor';

export interface SystemControlState {
  revision: number;
  generation: number;
  safeMode: SystemSafeMode;
  killSwitchEngaged: boolean;
  intakePaused: boolean;
  updatedAtMs: number;
  correlationId: string;
}

export interface SystemComponentSnapshot {
  componentId: SystemComponentId;
  owner: string;
  ownerPath: string;
  releaseStatuses: string[];
  truthLabel: SystemTruthLabel;
  desiredState: 'STOPPED' | 'RUNNING' | 'PAUSED';
  phase: string;
  domainObservedState: string | null;
  readiness: SystemReadiness;
  completeness: string;
  sourceTimestamp: { sourceTimeMs: number | null; receivedAtMs: number; maxAgeMs: number } | null;
  freshness: { state: string; ageMs: number | null; evaluatedAt: number } | null;
  lastReceiveAtMs: number | null;
  lastProcessAtMs: number | null;
  lastSuccessAtMs: number | null;
  dependencies: SystemComponentId[];
  queue: { depth: number; capacity: number; dropped: number; coalesced: number; observedAtMs: number } | null;
  blockerCodes: string[];
  generation: number;
  restartCount: number;
  supportedControls: string[];
  capitalExposed: boolean;
  operatorAttentionRequired: boolean;
  lastFailure: { code: string; message: string; recommendedOperatorAction: string } | null;
}

export interface SystemDependencyEdge {
  from: SystemComponentId;
  to: SystemComponentId;
  required: boolean;
  state: 'AVAILABLE' | 'DEGRADED' | 'BLOCKED' | 'UNKNOWN';
  rootBlockerComponentId: SystemComponentId | null;
  reasonCodes: string[];
}

export interface SystemTraceDecision {
  eventId: string;
  correlationId: string;
  componentId: SystemComponentId;
  kind: string;
  occurredAtMs: number;
  truthLabel: SystemTruthLabel;
  ownerId: string | null;
  canonicalProjectionId: string | null;
  revisionDigest: string | null;
  failureCode: string | null;
  referenceIds: string[];
}

export interface SystemSupervisorSummaries {
  sourceCoverage: {
    truthLabel: SystemTruthLabel;
    universeSymbols: number | null;
    spotCoveredSymbols: number | null;
    usdMCoveredSymbols: number | null;
    quietSymbolsRetained: number | null;
    materialGapCount: number | null;
    rateLimitedSourceCount: number | null;
    lastMaterialGapAtMs: number | null;
  };
  strategies: Record<'basis' | 'volume', {
    truthLabel: SystemTruthLabel;
    heartbeatAtMs: number | null;
    candidateCount: number | null;
    proposalCount: number | null;
    rejectionCount: number | null;
    acceptedCount: number | null;
    lastDecisionAtMs: number | null;
    sourceRevision: string | null;
  }>;
  intelligence: {
    truthLabel: SystemTruthLabel;
    evidenceCount: number | null;
    attentionCount: number | null;
    focusRequestedCount: number | null;
    focusActiveCount: number | null;
    thesisCount: number | null;
    insufficientEvidenceCount: number | null;
    lastUpdateAtMs: number | null;
  };
  capital: {
    truthLabel: SystemTruthLabel;
    accountTruthState: string;
    allocatableAmount: string | null;
    reservedAmount: string | null;
    activeExposureAmount: string | null;
    eligibleCount: number | null;
    reservationCount: number | null;
    stagedMandateCount: number | null;
    activeExposureCount: number | null;
    checkpointRevision: string | null;
    blockerCodes: string[];
  };
  risk: {
    truthLabel: SystemTruthLabel;
    latestVerdict: 'APPROVE' | 'REJECT' | 'CAP' | 'UNAVAILABLE';
    latestVerdictAtMs: number | null;
    latestVerdictId: string | null;
    rejectionCount: number | null;
    reasonCodes: string[];
  };
  execution: {
    truthLabel: SystemTruthLabel;
    mode: 'VALIDATE_ONLY' | 'UNAVAILABLE';
    barrier: 'LIVE_EXECUTION_NOT_IMPLEMENTED';
    planId: string | null;
    planLifecycle: string | null;
    coordinatorState: string;
    legCount: number | null;
    recoveryState: string | null;
    lastTransitionAtMs: number | null;
  };
  reconciliation: {
    truthLabel: SystemTruthLabel;
    status: string;
    blocksNewExposure: boolean;
    recommendation: string | null;
    checkpointId: string | null;
    evaluatedAtMs: number | null;
    reasonCodes: string[];
  };
  ledger: {
    truthLabel: SystemTruthLabel;
    writable: boolean | null;
    schemaCompatibilityState: 'AVAILABLE' | 'UNAVAILABLE' | 'MALFORMED' | 'MISMATCH';
    schemaCompatibilityReason: string | null;
    currentSchemaVersion: number | null;
    rollbackFloor: number | null;
    lastEventId: string | null;
    lastPersistedAtMs: number | null;
    checkpointRevision: string | null;
    recentTraceCount: number | null;
    lastCleanShutdownAtMs: number | null;
  };
}

export interface SystemSupervisorSnapshot {
  schemaVersion: 1;
  revision: number;
  evaluatedAtMs: number;
  phase: string;
  overallPosture: SystemOverallPosture;
  truthLabel: SystemTruthLabel;
  runtimeGeneration: number;
  controlGeneration: number;
  control: SystemControlState;
  components: SystemComponentSnapshot[];
  edges: SystemDependencyEdge[];
  firstRootBlockerComponentId: SystemComponentId | null;
  rootBlockerComponentIds: SystemComponentId[];
  operatorAttentionComponentIds: SystemComponentId[];
  attentionQueue: Array<{
    componentId: SystemComponentId;
    rootComponentId: SystemComponentId;
    severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
    reasonCodes: string[];
    capitalExposed: boolean;
    recommendedOperatorAction: string | null;
  }>;
  summaries: SystemSupervisorSummaries;
  recentCorrelatedDecisions: SystemTraceDecision[];
}

export type SystemControlMutation =
  | { command: 'SET_SAFE_MODE'; safeMode: SystemSafeMode }
  | { command: 'SET_KILL_SWITCH'; engaged: boolean }
  | { command: 'SET_INTAKE_PAUSED'; paused: boolean }
  | { command: 'RESTART_COMPONENT'; componentId: SystemComponentId };

export interface SystemControlReceipt {
  applied: boolean;
  code: string;
  before: SystemControlState;
  after: SystemControlState;
  ledgerEventId: number | null;
}

export interface SystemIntegrationClientState {
  snapshot: SystemSupervisorSnapshot | null;
  loading: boolean;
  error: string | null;
}

let state: SystemIntegrationClientState = Object.freeze({ snapshot: null, loading: false, error: null });
let subscribers = 0;
let timer: number | null = null;
let inFlight: Promise<SystemSupervisorSnapshot | null> | null = null;
const listeners = new Set<() => void>();

function publish(next: SystemIntegrationClientState): void {
  state = Object.freeze(next);
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function snapshot(): SystemIntegrationClientState {
  return state;
}

export function refreshSystemIntegration(): Promise<SystemSupervisorSnapshot | null> {
  if (inFlight) return inFlight;
  publish({ ...state, loading: true });
  const current = fetchJson<SystemSupervisorSnapshot>('/api/system-integration/supervisor', { cache: 'no-store' })
    .then((next) => {
      publish({ snapshot: next, loading: false, error: null });
      return next;
    })
    .catch((error: unknown) => {
      publish({ ...state, loading: false, error: apiErrorMessage(error, 'System supervisor unavailable') });
      return null;
    })
    .finally(() => {
      if (inFlight === current) inFlight = null;
    });
  inFlight = current;
  return current;
}

function acquirePolling(): () => void {
  subscribers += 1;
  if (subscribers === 1) {
    void refreshSystemIntegration();
    timer = window.setInterval(() => { void refreshSystemIntegration(); }, 5_000);
  }
  return () => {
    subscribers = Math.max(0, subscribers - 1);
    if (subscribers === 0 && timer !== null) {
      window.clearInterval(timer);
      timer = null;
    }
  };
}

export function useSystemIntegration(): SystemIntegrationClientState & {
  refresh: () => Promise<SystemSupervisorSnapshot | null>;
} {
  useEffect(acquirePolling, []);
  const current = useSyncExternalStore(subscribe, snapshot, snapshot);
  return { ...current, refresh: refreshSystemIntegration };
}

function idempotencyKey(command: string): string {
  const uuid = window.crypto.randomUUID();
  return `ui:${command.toLowerCase()}:${uuid}`.slice(0, 128);
}

export async function mutateSystemControl(
  expectedRevision: number,
  reason: string,
  mutation: SystemControlMutation,
): Promise<SystemControlReceipt> {
  const receipt = await fetchJson<SystemControlReceipt & { ok: true }>('/api/system-integration/controls', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey(mutation.command),
    },
    body: JSON.stringify({ expectedRevision, reason, ...mutation }),
  });
  await refreshSystemIntegration();
  return receipt;
}
