import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  ArrowRightLeft,
  BookOpen,
  ChevronDown,
  Eye,
  Radio,
  Search,
  Star,
  X,
} from 'lucide-react';
import { TokenIcon } from '../components/TokenIcon';
import { countdown, fmtBasis, fmtDateTime, fmtFunding, fmtMoney, fmtPct, fmtPrice, timeAgo } from '../format';
import { apiErrorMessage, fetchJson } from '../lib/http';
import { createSettledPoll } from '../lib/polling';
import { privateReadFreshness, projectPrivateRead } from '../lib/privateRead';
import { useStore } from '../store';
import { useProductControlRoomContext } from '../features/productControlRoom/ProductControlRoomProvider';
import { ProductSurfaceAdapter } from '../features/productControlRoom/components/SurfaceBindingPanel';
import {
  basisProposalObservationCurrent,
  basisRuntimeSnapshotCurrent,
  decodeBasisRuntimeSnapshot,
  type BasisRow,
  type BasisSnapshot,
} from '../lib/basisRuntime';
export { basisProposalObservationCurrent } from '../lib/basisRuntime';
import './VolumeScanner.css';
import './BasisScanner.css';

type Filter = 'all' | 'candidates' | 'proposals' | 'borrow' | 'rejected';


const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All Pairs' },
  { id: 'candidates', label: 'Candidates' },
  { id: 'proposals', label: 'Proposals' },
  { id: 'borrow', label: 'Borrow Blocked' },
  { id: 'rejected', label: 'Rejected' },
];

function finite(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function titleCase(value: string): string {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function durationCompact(ms: number | null | undefined): string {
  if (!finite(ms)) return '—';
  const seconds = Math.max(0, Math.floor(ms / 1_000));
  if (seconds < 60) return seconds + 's';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return minutes + 'm';
  return Math.floor(minutes / 60) + 'h ' + (minutes % 60) + 'm';
}

function bps(value: number | null | undefined): string {
  return finite(value) ? value.toFixed(value >= 10 ? 1 : 2) + ' bps' : '—';
}

function stateLabel(row: BasisRow): string {
  if (row.state === 'PROPOSED') return 'Proposal';
  if (row.state === 'FOCUS') return 'Focused';
  if (row.state === 'WATCHING') return 'Watching';
  if (row.decisionKind === 'reject' || row.state === 'REJECTED' || row.state === 'COOLDOWN') return 'Rejected';
  return 'Monitoring';
}

function stateTone(row: BasisRow, truthCurrent: boolean): string {
  if (row.state === 'PROPOSED') return truthCurrent && hasAttachedOpenProposal(row) ? 'proposal' : 'idle';
  if (row.state === 'FOCUS') return 'focus';
  if (row.state === 'WATCHING') return 'watching';
  if (row.decisionKind === 'reject' || row.state === 'REJECTED' || row.state === 'COOLDOWN') return 'rejected';
  return 'idle';
}

function directionLabel(direction: BasisRow['direction']): string {
  return direction === 'long_spot_short_perp' ? 'Buy Spot · Sell Perp' : 'Sell Spot · Buy Perp';
}

function alternateDirection(direction: BasisRow['direction']): BasisRow['direction'] {
  return direction === 'long_spot_short_perp' ? 'short_spot_long_perp' : 'long_spot_short_perp';
}

export type BasisRowEvidence = Readonly<{
  selectedDirection: string;
  alternateDirection: string;
  alternateGapPct: number | null;
  decisionTs: number | null;
  correlationId: string | null;
  historyBoundary: 'DECISION_OBSERVATION' | 'NONE';
  priorityScore: number | null;
  proposal: Readonly<{
    id: string;
    status: string;
    netEdgePct: number | null;
    confidence: number | null;
    invalidation: string | null;
    stagedSizes: readonly Readonly<{ stage: number; fraction: number; notionalUsd: number }>[];
  }> | null;
}>;

/** Projects only per-row facts emitted by the Basis runtime. */
export function resolveBasisRowEvidence(row: Pick<
  BasisRow,
  'direction' | 'alternateGapPct' | 'decisionTs' | 'correlationId' | 'priority' | 'proposal'
>): BasisRowEvidence {
  const priorityScore = row.priority && finite(row.priority.score) ? row.priority.score : null;
  const proposal = row.proposal
    ? Object.freeze({
      id: row.proposal.id,
      status: row.proposal.status,
      netEdgePct: finite(row.proposal.netEdgePct) ? row.proposal.netEdgePct : null,
      confidence: finite(row.proposal.confidence) ? row.proposal.confidence : null,
      invalidation: row.proposal.invalidation ?? null,
      stagedSizes: Object.freeze(row.proposal.stagedSizes.map((stage) => Object.freeze({
        stage: stage.stage,
        fraction: stage.fraction,
        notionalUsd: stage.notionalUsd,
      }))),
    })
    : null;
  const decisionTs = finite(row.decisionTs) ? row.decisionTs : null;
  const correlationId = row.correlationId ?? null;
  return Object.freeze({
    selectedDirection: directionLabel(row.direction),
    alternateDirection: directionLabel(alternateDirection(row.direction)),
    alternateGapPct: finite(row.alternateGapPct) ? row.alternateGapPct : null,
    decisionTs,
    correlationId,
    historyBoundary: decisionTs !== null || correlationId !== null ? 'DECISION_OBSERVATION' : 'NONE',
    priorityScore,
    proposal,
  });
}

function executionPrices(row: BasisRow): { primary: string; secondary: string } {
  if (row.direction === 'long_spot_short_perp') {
    return {
      primary: fmtPrice(row.spotAsk) + ' / ' + fmtPrice(row.perpBid),
      secondary: 'Spot Ask · Perp Bid',
    };
  }
  return {
    primary: fmtPrice(row.spotBid) + ' / ' + fmtPrice(row.perpAsk),
    secondary: 'Spot Bid · Perp Ask',
  };
}

function decisionTitle(row: BasisRow): string {
  if (row.rejectCode) return titleCase(row.rejectCode);
  if (row.decisionKind === 'ignore') return 'Below Watch Gate';
  return titleCase(row.decisionKind);
}

export type BasisRuntimeTruth = Readonly<{
  current: boolean;
  state: 'STARTING' | 'LIVE' | 'UNAVAILABLE';
  label: 'Starting' | 'Live' | 'Unavailable';
  reason: string | null;
}>;

export type BasisSupervisorTruth = Readonly<{
  current: boolean;
  state: 'STARTING' | 'LIVE' | 'UNAVAILABLE';
  label: 'Starting' | 'Live' | 'Unavailable';
  reason: string | null;
  candidateCount: number | null;
  proposalCount: number | null;
  rejectionCount: number | null;
  lastDecisionAtMs: number | null;
  sourceRevision: string | null;
}>;

export function resolveBasisSupervisorTruth(input: Readonly<{
  continuity: 'UNPROVEN' | 'BACKFILL' | 'PROVEN' | 'BLOCKED';
  loading: boolean;
  bindingError: string | null;
  component: Readonly<{
    observedLifecycle: string;
    capability: string;
    truthLabel: string;
    blockerCode: string | null;
    canonicalPresentation: Readonly<{ status: string; stateLabel: string }>;
  }> | null;
  summary: Readonly<{
    truthLabel: string;
    candidateCount: number | null;
    proposalCount: number | null;
    rejectionCount: number | null;
    lastDecisionAtMs: number | null;
    sourceRevision: string | null;
  }> | null;
}>): BasisSupervisorTruth {
  const starting = (): BasisSupervisorTruth => Object.freeze({
    current: false,
    state: 'STARTING',
    label: 'Starting',
    reason: null,
    candidateCount: null,
    proposalCount: null,
    rejectionCount: null,
    lastDecisionAtMs: null,
    sourceRevision: null,
  });
  const unavailable = (reason: string): BasisSupervisorTruth => Object.freeze({
    current: false,
    state: 'UNAVAILABLE',
    label: 'Unavailable',
    reason,
    candidateCount: null,
    proposalCount: null,
    rejectionCount: null,
    lastDecisionAtMs: null,
    sourceRevision: null,
  });

  if (input.continuity !== 'PROVEN') {
    if (input.loading && input.component === null && input.summary === null && input.bindingError === null) {
      return starting();
    }
    return unavailable(input.bindingError ?? `CANONICAL_CONTINUITY_${input.continuity}`);
  }
  if (input.component === null) return unavailable('BASIS_ENGINE_CANONICAL_TRUTH_MISSING');
  if (['START_REQUESTED', 'STARTING', 'WARMING'].includes(input.component.observedLifecycle)) {
    return starting();
  }
  if (
    input.component.observedLifecycle !== 'READY'
    || input.component.canonicalPresentation.status !== 'operational'
  ) {
    return unavailable(
      input.component.blockerCode
        ?? `BASIS_ENGINE_${input.component.observedLifecycle}: ${input.component.canonicalPresentation.stateLabel}`,
    );
  }
  if (input.component.capability !== 'LIVE_PUBLIC' || input.component.truthLabel !== 'LIVE_PUBLIC') {
    return unavailable(
      `BASIS_ENGINE_NOT_LIVE_PUBLIC: capability=${input.component.capability}; truth=${input.component.truthLabel}`,
    );
  }
  if (input.summary === null) return unavailable('BASIS_SUPERVISOR_SUMMARY_MISSING');
  if (input.summary.truthLabel !== 'LIVE_PUBLIC') {
    return unavailable(`BASIS_SUPERVISOR_SUMMARY_${input.summary.truthLabel}`);
  }
  return Object.freeze({
    current: true,
    state: 'LIVE',
    label: 'Live',
    reason: null,
    candidateCount: input.summary.candidateCount,
    proposalCount: input.summary.proposalCount,
    rejectionCount: input.summary.rejectionCount,
    lastDecisionAtMs: input.summary.lastDecisionAtMs,
    sourceRevision: input.summary.sourceRevision,
  });
}

export type BasisProposalBinding =
  | 'OPEN_RECORD_ALIGNED'
  | 'OPEN_RECORD_RECONCILING'
  | 'NO_CURRENT_OPEN_PROPOSAL'
  | 'CURRENT_TRUTH_UNAVAILABLE';

export type BasisProposalEconomics = Readonly<{
  binding: BasisProposalBinding;
  grossGapPct: number | null;
  feesPct: number | null;
  slippagePct: number | null;
  fundingDragPct: number | null;
  borrowCostPct: number | null;
  totalCostPct: number | null;
  fundingCarryPct: number | null;
  netEdgePct: number | null;
  proposalNetEdgePct: number | null;
  fundingKnown: boolean;
  borrowKnown: boolean;
  costsConsistent: boolean | null;
  netConsistent: boolean | null;
  modelInputsConsistent: boolean | null;
  stagesConsistent: boolean | null;
  integrityLabel: 'COHERENT_COMPONENTS' | 'INCOMPLETE_INPUTS' | 'CONTRACT_MISMATCH' | 'NOT_CURRENT';
}>;

type BasisRowEconomicsInspection = Readonly<{
  fundingKnown: boolean;
  borrowKnown: boolean;
  costsConsistent: boolean | null;
  netConsistent: boolean | null;
  modelInputsConsistent: boolean | null;
  complete: boolean;
}>;

function hasAttachedOpenProposal(row: Pick<BasisRow, 'proposal'>): boolean {
  return row.proposal !== null
    && (row.proposal.status === 'open' || row.proposal.status === 'updated');
}

export function proposalBinding(
  row: BasisRow | null,
  truthCurrent: boolean,
): BasisProposalBinding {
  if (!truthCurrent) return 'CURRENT_TRUTH_UNAVAILABLE';
  if (row === null) return 'NO_CURRENT_OPEN_PROPOSAL';
  const attached = hasAttachedOpenProposal(row);
  if (row.state === 'PROPOSED' && attached) return 'OPEN_RECORD_ALIGNED';
  if (row.state === 'PROPOSED' || attached) return 'OPEN_RECORD_RECONCILING';
  return 'NO_CURRENT_OPEN_PROPOSAL';
}

function inspectBasisRowEconomics(
  row: BasisRow,
  configuredFeesPct?: number,
  observationAtMs?: number,
): BasisRowEconomicsInspection {
  const fundingKnown = finite(row.fundingRate)
    && finite(row.nextFundingTs)
    && finite(row.fundingCarryPct)
    && (!finite(observationAtMs) || row.nextFundingTs > observationAtMs);
  const borrowKnown = row.borrow.ok
    && row.borrow.rejectCode === null
    && (
      row.direction === 'long_spot_short_perp'
        ? row.borrow.status === 'not_needed'
          && row.borrow.costPctOverHold === 0
          && row.costs.borrowCostPct === 0
        : row.borrow.status === 'available'
    );
  const costFieldsKnown = [
    row.costs.feesPct,
    row.costs.slippagePct,
    row.costs.fundingDragPct,
    row.costs.borrowCostPct,
    row.costs.totalPct,
    row.slippagePct,
    row.borrow.costPctOverHold,
  ].every(finite);
  const completeCosts = fundingKnown && borrowKnown && costFieldsKnown;
  const expectedTotal = row.costs.feesPct
    + row.costs.slippagePct
    + row.costs.fundingDragPct
    + row.costs.borrowCostPct;
  const costsConsistent = completeCosts
    ? Math.abs(expectedTotal - row.costs.totalPct) <= 0.000_001
    : null;
  const modelInputsConsistent = completeCosts
    ? Math.abs(row.slippagePct - row.costs.slippagePct) <= 0.000_001
      && (!finite(configuredFeesPct)
        || Math.abs(row.costs.feesPct - configuredFeesPct) <= 0.000_001)
      && Math.abs(row.costs.fundingDragPct - Math.max(-(row.fundingCarryPct as number), 0)) <= 0.000_001
      && Math.abs(row.costs.borrowCostPct - row.borrow.costPctOverHold) <= 0.000_001
    : null;
  const currentNetConsistent = finite(row.executableGapPct)
    && finite(row.netEdgePct)
    && finite(row.fundingCarryPct)
    && finite(row.costs.totalPct)
    ? Math.abs(
      row.executableGapPct
      - row.costs.totalPct
      + Math.max(row.fundingCarryPct, 0)
      - row.netEdgePct,
    ) <= 0.000_001
    : null;
  const netConsistent = !completeCosts
    ? null
    : costsConsistent === false || modelInputsConsistent === false
      ? false
      : currentNetConsistent;
  return Object.freeze({
    fundingKnown,
    borrowKnown,
    costsConsistent,
    netConsistent,
    modelInputsConsistent,
    complete: completeCosts
      && costsConsistent === true
      && modelInputsConsistent === true
      && netConsistent === true,
  });
}

export function basisRowEconomicsComplete(
  row: BasisRow,
  configuredFeesPct?: number,
  observationAtMs?: number,
): boolean {
  return inspectBasisRowEconomics(row, configuredFeesPct, observationAtMs).complete;
}

export function buildBasisProposalEconomics(
  row: BasisRow | null,
  observationCurrent: boolean,
  configuredFeesPct?: number,
  observationAtMs?: number,
  intendedNotionalUsd?: number,
  proposalRecordCurrent = observationCurrent,
): BasisProposalEconomics {
  const binding = proposalBinding(row, proposalRecordCurrent);
  const recordAuthoritative = row !== null && binding === 'OPEN_RECORD_ALIGNED';
  const authoritative = observationCurrent && recordAuthoritative;
  const inspection = row === null
    ? null
    : inspectBasisRowEconomics(row, configuredFeesPct, observationAtMs);
  const fundingKnown = authoritative && inspection?.fundingKnown === true;
  const borrowKnown = authoritative && inspection?.borrowKnown === true;
  const stagesConsistent = recordAuthoritative && finite(intendedNotionalUsd)
    ? row.proposal!.stagedSizes.length > 0
      && row.proposal!.stagedSizes.every((stage, index) => {
        const expectedNotional = Math.round(intendedNotionalUsd * stage.fraction * 100) / 100;
        return stage.stage === index + 1
          && stage.fraction > 0
          && stage.fraction <= 1
          && (index === 0 || stage.fraction > row.proposal!.stagedSizes[index - 1].fraction)
          && Math.abs(stage.notionalUsd - expectedNotional) <= 0.000_001;
      })
    : null;
  const proposalNetEdgePct = recordAuthoritative && finite(row.proposal?.netEdgePct)
    ? row.proposal.netEdgePct
    : null;

  if (!authoritative) {
    return Object.freeze({
      binding,
      grossGapPct: null,
      feesPct: null,
      slippagePct: null,
      fundingDragPct: null,
      borrowCostPct: null,
      totalCostPct: null,
      fundingCarryPct: null,
      netEdgePct: null,
      proposalNetEdgePct,
      fundingKnown,
      borrowKnown,
      costsConsistent: null,
      netConsistent: null,
      modelInputsConsistent: null,
      stagesConsistent,
      integrityLabel: observationCurrent ? 'INCOMPLETE_INPUTS' : 'NOT_CURRENT',
    });
  }

  const integrityMismatch = inspection!.costsConsistent === false
    || inspection!.modelInputsConsistent === false
    || inspection!.netConsistent === false
    || stagesConsistent === false;
  const complete = inspection!.complete && stagesConsistent === true && !integrityMismatch;
  return Object.freeze({
    binding,
    grossGapPct: finite(row.executableGapPct) ? row.executableGapPct : null,
    feesPct: row.costs.feesPct,
    slippagePct: row.costs.slippagePct,
    fundingDragPct: fundingKnown ? row.costs.fundingDragPct : null,
    borrowCostPct: borrowKnown ? row.costs.borrowCostPct : null,
    totalCostPct: complete ? row.costs.totalPct : null,
    fundingCarryPct: fundingKnown ? row.fundingCarryPct : null,
    netEdgePct: complete && finite(row.netEdgePct) ? row.netEdgePct : null,
    proposalNetEdgePct,
    fundingKnown,
    borrowKnown,
    costsConsistent: inspection!.costsConsistent,
    netConsistent: inspection!.netConsistent,
    modelInputsConsistent: inspection!.modelInputsConsistent,
    stagesConsistent,
    integrityLabel: integrityMismatch
      ? 'CONTRACT_MISMATCH'
      : complete
        ? 'COHERENT_COMPONENTS'
        : 'INCOMPLETE_INPUTS',
  });
}

export function resolveBasisRuntimeTruth(input: Readonly<{
  canonicalState: 'LOADING' | 'READY' | 'UNAVAILABLE';
  canonicalReason: string | null;
  snapshot: BasisSnapshot | null;
  requestError: string | null;
  nowMs?: number;
}>): BasisRuntimeTruth {
  if (input.requestError) {
    return Object.freeze({ current: false, state: 'UNAVAILABLE', label: 'Unavailable', reason: input.requestError });
  }
  if (input.snapshot && !input.snapshot.status.running) {
    const canonicalSuffix = input.canonicalReason ? ` · ${input.canonicalReason}` : '';
    return Object.freeze({
      current: false,
      state: 'UNAVAILABLE',
      label: 'Unavailable',
      reason: input.snapshot.status.lastError ?? `BASIS_RUNTIME_STOPPED${canonicalSuffix}`,
    });
  }
  if (input.canonicalState === 'UNAVAILABLE') {
    return Object.freeze({
      current: false,
      state: 'UNAVAILABLE',
      label: 'Unavailable',
      reason: input.canonicalReason ?? 'BASIS_ENGINE_CANONICAL_TRUTH_UNAVAILABLE',
    });
  }
  if (!input.snapshot) {
    return Object.freeze({ current: false, state: 'STARTING', label: 'Starting', reason: null });
  }
  if (input.snapshot.status.lastError) {
    return Object.freeze({
      current: false,
      state: 'UNAVAILABLE',
      label: 'Unavailable',
      reason: input.snapshot.status.lastError,
    });
  }
  if (input.snapshot.status.bookState !== 'fresh' || input.snapshot.status.markState !== 'fresh') {
    return Object.freeze({
      current: false,
      state: 'UNAVAILABLE',
      label: 'Unavailable',
      reason: `BASIS_SOURCE_NOT_CURRENT: books=${input.snapshot.status.bookState}; marks=${input.snapshot.status.markState}`,
    });
  }
  if (!basisRuntimeSnapshotCurrent(input.snapshot, input.nowMs)) {
    return Object.freeze({
      current: false,
      state: 'UNAVAILABLE',
      label: 'Unavailable',
      reason: 'BASIS_SOURCE_TIMESTAMPS_NOT_CURRENT',
    });
  }
  if (input.canonicalState === 'LOADING') {
    return Object.freeze({ current: false, state: 'STARTING', label: 'Starting', reason: null });
  }
  return Object.freeze({ current: true, state: 'LIVE', label: 'Live', reason: null });
}

export type BasisAccountTruth = Readonly<{
  spotCurrent: boolean;
  marginCurrent: boolean;
  spotAvailableUsdt: string | null;
  marginLiabilityBtc: string | null;
  liabilityCount: number | null;
  sourceLabel: string;
  spotReason: string | null;
  marginReason: string | null;
}>;

export function resolveBasisAccountTruth(input: Readonly<{
  source: 'PENDING' | 'STATE' | 'FALLBACK';
  requestError: string | null;
  freshnessState: 'CURRENT' | 'STALE' | 'UNKNOWN' | 'NOT_CONFIGURED';
  freshnessReason: string;
  spotState: 'AVAILABLE' | 'PARTIAL' | 'UNAVAILABLE' | 'NOT_CONFIGURED';
  spotFreshnessState: 'CURRENT' | 'STALE' | 'UNKNOWN' | 'NOT_CONFIGURED';
  spotFreshnessReason: string;
  spotCoverageState: 'COMPLETE_CURRENT' | 'PARTIAL_SYMBOL_SCOPED' | 'UNAVAILABLE' | 'NOT_CONFIGURED';
  spotBalancesAvailable: boolean;
  spotAvailableUsdt: string | null;
  marginState: 'AVAILABLE' | 'PARTIAL' | 'UNAVAILABLE' | 'NOT_CONFIGURED';
  marginFreshnessState: 'CURRENT' | 'STALE' | 'UNKNOWN' | 'NOT_CONFIGURED';
  marginFreshnessReason: string;
  marginCoverageState: 'COMPLETE_CURRENT' | 'PARTIAL_SYMBOL_SCOPED' | 'UNAVAILABLE' | 'NOT_CONFIGURED';
  marginAssetsAvailable: boolean;
  liabilityReconciliationState: 'RECONCILED' | 'PARTIAL' | 'UNAVAILABLE' | 'NOT_CONFIGURED';
  liabilityFreshnessState: 'CURRENT' | 'STALE' | 'UNKNOWN' | 'NOT_CONFIGURED';
  liabilityFreshnessReason: string;
  marginLiabilityBtc: string | null;
  liabilityCount: number | null;
}>): BasisAccountTruth {
  const sourceLabel = input.source === 'STATE'
    ? 'State Account Read'
    : input.source === 'FALLBACK'
      ? 'Fallback Account Read'
      : 'Account Source Pending';
  const accountReason = input.requestError
    ?? (input.source === 'PENDING' ? 'Account source pending' : null)
    ?? (input.freshnessState === 'CURRENT' ? null : input.freshnessReason);
  const spotReason = accountReason
    ?? (input.spotState === 'AVAILABLE' ? null : `Spot account ${titleCase(input.spotState)}`)
    ?? (input.spotFreshnessState === 'CURRENT' ? null : input.spotFreshnessReason)
    ?? (input.spotCoverageState === 'COMPLETE_CURRENT' ? null : `Spot coverage ${titleCase(input.spotCoverageState)}`)
    ?? (input.spotBalancesAvailable ? null : 'Spot balance rows unavailable')
    ?? (input.spotAvailableUsdt !== null ? null : 'USDT free balance unavailable');
  const marginReason = accountReason
    ?? (input.marginState === 'AVAILABLE' ? null : `Margin account ${titleCase(input.marginState)}`)
    ?? (input.marginFreshnessState === 'CURRENT' ? null : input.marginFreshnessReason)
    ?? (input.marginCoverageState === 'COMPLETE_CURRENT' ? null : `Margin coverage ${titleCase(input.marginCoverageState)}`)
    ?? (input.liabilityReconciliationState === 'RECONCILED'
      ? null
      : `Liability reconciliation ${titleCase(input.liabilityReconciliationState)}`)
    ?? (input.liabilityFreshnessState === 'CURRENT' ? null : input.liabilityFreshnessReason)
    ?? (input.marginAssetsAvailable ? null : 'Margin asset rows unavailable')
    ?? (input.marginLiabilityBtc !== null && input.liabilityCount !== null ? null : 'Margin liability facts unavailable');
  const spotCurrent = spotReason === null;
  const marginCurrent = marginReason === null;
  return Object.freeze({
    spotCurrent,
    marginCurrent,
    spotAvailableUsdt: spotCurrent ? input.spotAvailableUsdt : null,
    marginLiabilityBtc: marginCurrent ? input.marginLiabilityBtc : null,
    liabilityCount: marginCurrent ? input.liabilityCount : null,
    sourceLabel,
    spotReason,
    marginReason,
  });
}

export function Strategies() {
  const { binding } = useProductControlRoomContext();
  const {
    state,
    stateStatus,
    privateRead,
    privateReadError,
    privateReadSource,
    openDetail,
    openLedger,
    setPage,
    toggleWatch,
  } = useStore();
  const [snapshot, setSnapshot] = useState<BasisSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const poll = createSettledPoll<BasisSnapshot>({
      intervalMs: 2_000,
      request: async (signal) => {
        const decoded = decodeBasisRuntimeSnapshot(
          await fetchJson('/api/engine/basis', { cache: 'no-store', signal }),
        );
        if (decoded === null) throw new TypeError('Basis runtime read failed its published contract.');
        return decoded;
      },
      onSuccess: (next) => {
        setSnapshot(next);
        setError(null);
      },
      onError: (reason) => setError(apiErrorMessage(reason, 'Basis runtime unavailable')),
    });
    poll.start();
    return poll.stop;
  }, []);

  const basisComponent = binding.snapshot?.components.find(
    (component) => component.componentId === 'basis-engine',
  ) ?? null;
  const basisSupervisorSummary = binding.snapshot?.dashboard.summaries.strategies.basis ?? null;
  const supervisorTruth = resolveBasisSupervisorTruth({
    continuity: binding.continuity,
    loading: binding.loading,
    bindingError: binding.error,
    component: basisComponent,
    summary: basisSupervisorSummary,
  });
  const basisTruth = resolveBasisRuntimeTruth({
    canonicalState: supervisorTruth.state === 'LIVE'
      ? 'READY'
      : supervisorTruth.state === 'STARTING'
        ? 'LOADING'
        : 'UNAVAILABLE',
    canonicalReason: supervisorTruth.reason,
    snapshot,
    requestError: error,
    nowMs,
  });
  const accountNow = nowMs;
  const privatePresentation = projectPrivateRead(privateRead, accountNow);
  const spotFreshness = privateReadFreshness({
    ...privateRead,
    state: privateRead.spot.state,
    observedAt: privateRead.spot.observedAt,
  }, accountNow);
  const marginFreshness = privateReadFreshness({
    ...privateRead,
    state: privateRead.margin.state,
    observedAt: privateRead.margin.observedAt,
  }, accountNow);
  const liabilityFact = privateRead.reconciliation.liabilities;
  const liabilityFreshness = privateReadFreshness({
    ...privateRead,
    state: liabilityFact.state === 'RECONCILED'
      ? 'AVAILABLE'
      : liabilityFact.state === 'NOT_CONFIGURED'
        ? 'NOT_CONFIGURED'
        : 'UNAVAILABLE',
    observedAt: liabilityFact.observedAt,
  }, accountNow);
  const accountTruth = resolveBasisAccountTruth({
    source: privateReadSource,
    requestError: privateReadError,
    freshnessState: privatePresentation.freshness.state,
    freshnessReason: privatePresentation.freshness.reason,
    spotState: privateRead.spot.state,
    spotFreshnessState: spotFreshness.state,
    spotFreshnessReason: spotFreshness.reason,
    spotCoverageState: privateRead.spot.coverage.state,
    spotBalancesAvailable: privateRead.spot.balances !== null,
    spotAvailableUsdt: privatePresentation.spotAvailableUsdt,
    marginState: privateRead.margin.state,
    marginFreshnessState: marginFreshness.state,
    marginFreshnessReason: marginFreshness.reason,
    marginCoverageState: privateRead.margin.coverage.state,
    marginAssetsAvailable: privateRead.margin.assets !== null,
    liabilityReconciliationState: privateRead.reconciliation.liabilities.state,
    liabilityFreshnessState: liabilityFreshness.state,
    liabilityFreshnessReason: liabilityFreshness.reason,
    marginLiabilityBtc: privatePresentation.marginLiabilityBtc,
    liabilityCount: privatePresentation.counts.liabilities,
  });
  // A failed canonical envelope must not blank this page's own live feed. The
  // engine snapshot is re-resolved against the identical contract and freshness
  // rules with the canonical gate held READY, so rows stay visible only while
  // this page's own evidence is valid and current. This decouples row
  // VISIBILITY from envelope continuity and nothing else: every canonical
  // claim, count of canonical facts, and control gate still reads basisTruth.
  const canonicalBindingProven = binding.continuity === 'PROVEN';
  const basisEngineFeedTruth = resolveBasisRuntimeTruth({
    canonicalState: 'READY',
    canonicalReason: null,
    snapshot,
    requestError: error,
    nowMs,
  });
  const basisEngineRowsVisible = !basisTruth.current
    && !canonicalBindingProven
    && basisEngineFeedTruth.current;
  const basisEngineFeedNote = `Canonical binding not proven · ${binding.continuity} · Basis engine feed live`;
  const rows = basisTruth.current ? snapshot?.rows ?? [] : [];
  const visibleRows = basisEngineRowsVisible ? snapshot?.rows ?? [] : rows;
  const query = search.trim().toUpperCase();
  const counts = useMemo(() => ({
    all: visibleRows.length,
    candidates: visibleRows.filter((row) => row.state === 'WATCHING' || row.state === 'FOCUS' || row.state === 'PROPOSED').length,
    proposals: visibleRows.filter((row) => row.state === 'PROPOSED').length,
    borrow: visibleRows.filter((row) => row.rejectCode?.startsWith('borrow_')).length,
    rejected: visibleRows.filter((row) => row.decisionKind === 'reject').length,
  }), [visibleRows]);

  const filteredRows = useMemo(() => visibleRows.filter((row) => {
    if (
      query &&
      !row.symbol.includes(query) &&
      !row.base.includes(query) &&
      !row.reason.toUpperCase().includes(query) &&
      !(row.rejectCode ?? '').toUpperCase().includes(query)
    ) return false;
    if (filter === 'candidates') return row.state === 'WATCHING' || row.state === 'FOCUS' || row.state === 'PROPOSED';
    if (filter === 'proposals') return row.state === 'PROPOSED';
    if (filter === 'borrow') return row.rejectCode?.startsWith('borrow_');
    if (filter === 'rejected') return row.decisionKind === 'reject';
    return true;
  }), [filter, query, visibleRows]);

  const watchlist = state?.config.watchlist ?? [];
  const watchWritable = stateStatus === 'CURRENT' && basisTruth.current;
  const proposalRows = visibleRows.filter(
    (row) => row.state === 'PROPOSED' || hasAttachedOpenProposal(row),
  );
  const proposalDeskRow = proposalRows[0] ?? null;
  const proposalDeskRuntimeCurrent = basisEngineFeedTruth.current && snapshot !== null;
  const proposalDeskObservationCurrent = Boolean(
    proposalDeskRuntimeCurrent
    && proposalDeskRow
    && snapshot
    && basisProposalObservationCurrent(proposalDeskRow, snapshot.thresholds.minDataQuality),
  );
  const proposalDeskEconomics = buildBasisProposalEconomics(
    proposalDeskRow,
    proposalDeskObservationCurrent,
    snapshot?.thresholds.feesPct,
    snapshot?.updatedAt,
    snapshot?.thresholds.intendedNotionalUsd,
    proposalDeskRuntimeCurrent,
  );
  const proposalDeskRecordCurrent = proposalDeskRuntimeCurrent
    && proposalDeskEconomics.binding === 'OPEN_RECORD_ALIGNED';
  const basisUnassertedDetail = basisTruth.reason ?? 'Canonical Basis runtime loading';

  return (
    <div className="container page volx-page basx-page">
      <section className="volx-frame" aria-label="basis workspace">
        <header className="volx-toolbar">
          <div className="volx-title basx-title">
            <img className="basx-page-mark" src="/basis-percent.png" alt="" aria-hidden="true" />
            <h1>Basis</h1>
            <span
              className={'volx-live ' + (basisTruth.state === 'LIVE' ? 'active' : basisTruth.state === 'UNAVAILABLE' ? 'degraded' : 'starting')}
              role="status"
              title={basisTruth.reason ?? undefined}
            >
              <i aria-hidden="true" />
              {basisTruth.label}
            </span>
            <span className="volx-updated">
              {basisTruth.current && snapshot
                ? 'Updated ' + timeAgo(snapshot.updatedAt)
                : basisEngineRowsVisible && snapshot
                  ? basisEngineFeedNote + ' · updated ' + timeAgo(snapshot.updatedAt)
                  : basisUnassertedDetail}
            </span>
          </div>
          <label className="volx-search">
            <Search size={14} aria-hidden="true" />
            <input
              aria-label="Search Basis"
              placeholder="Search"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setExpanded(null);
              }}
              spellCheck={false}
            />
            {search ? (
              <button type="button" aria-label="Clear Search" onClick={() => setSearch('')}>
                <X size={14} />
              </button>
            ) : null}
          </label>
        </header>

        <div className="volx-summary" aria-label="Basis Summary">
          <div className="volx-summary-cell">
            <span>Eligible Pairs</span>
            <strong>{basisTruth.current ? snapshot?.status.universeSize ?? 'UNKNOWN' : 'UNKNOWN'}</strong>
            <small>{basisTruth.current && snapshot
              ? `${snapshot.status.watching} watching · ${snapshot.status.focused} focused · ${snapshot.status.openProposals} proposals`
              : basisUnassertedDetail}</small>
          </div>
          <div className="volx-summary-cell">
            <span>Live Markets</span>
            <strong>{basisTruth.current ? 'CURRENT' : 'UNKNOWN'}</strong>
            <small>{basisTruth.current && snapshot
              ? `${snapshot.status.bookSource} · ${snapshot.status.markSource}`
              : basisUnassertedDetail}</small>
          </div>
          <div className="volx-summary-cell">
            <span>Available USDT</span>
            <strong>{accountTruth.spotAvailableUsdt ?? 'UNKNOWN'}</strong>
            <small>{accountTruth.spotCurrent
              ? `${accountTruth.sourceLabel} · ${privatePresentation.freshness.label} · spot free balance`
              : accountTruth.spotReason}</small>
          </div>
          <div className="volx-summary-cell">
            <span>Margin Liability BTC</span>
            <strong>{accountTruth.marginLiabilityBtc ?? 'UNKNOWN'}</strong>
            <small>{accountTruth.marginCurrent
              ? `${accountTruth.liabilityCount} liability assets · ${accountTruth.sourceLabel}`
              : accountTruth.marginReason}</small>
          </div>
        </div>

        <section className="volx-detail basx-detail" aria-label="Canonical Basis Supervisor Cut">
          <div className="volx-reason">
            <span>Canonical Basis Cut</span>
            <p>{supervisorTruth.label}</p>
            <small>{supervisorTruth.current
              ? `Supervisor revision ${binding.snapshot?.dashboard.revision ?? 'UNKNOWN'} · LIVE_PUBLIC`
              : supervisorTruth.reason ?? 'Waiting for canonical supervisor truth'}</small>
          </div>
          <dl className="volx-facts basx-facts">
            <div><dt>Candidates</dt><dd>{supervisorTruth.current ? supervisorTruth.candidateCount ?? 'UNKNOWN' : 'UNKNOWN'}</dd></div>
            <div><dt>Proposals</dt><dd>{supervisorTruth.current ? supervisorTruth.proposalCount ?? 'UNKNOWN' : 'UNKNOWN'}</dd></div>
            <div><dt>Rejections</dt><dd>{supervisorTruth.current ? supervisorTruth.rejectionCount ?? 'UNKNOWN' : 'UNKNOWN'}</dd></div>
            <div><dt>Last Decision</dt><dd>{supervisorTruth.current && supervisorTruth.lastDecisionAtMs
              ? timeAgo(supervisorTruth.lastDecisionAtMs)
              : 'UNKNOWN'}</dd></div>
            <div><dt>Source Revision</dt><dd>{supervisorTruth.current
              ? supervisorTruth.sourceRevision ?? 'UNKNOWN'
              : 'UNKNOWN'}</dd></div>
          </dl>
        </section>

        <section
          className="volx-detail basx-detail"
          aria-label="Truthful Basis Proposal Desk"
          data-truth={proposalDeskRuntimeCurrent ? 'current' : snapshot ? 'retained' : 'unavailable'}
        >
          <div className="volx-reason">
            <span>Proposal Desk · Monitor Only</span>
            <p>{proposalDeskObservationCurrent && proposalDeskRow
              ? `CURRENT OBSERVATION · ${proposalDeskRow.symbol}`
              : proposalDeskRecordCurrent && proposalDeskRow
                ? `CURRENT PROPOSAL RECORD · ${proposalDeskRow.symbol} · OBSERVATION ECONOMICS WITHHELD`
                : proposalDeskRuntimeCurrent
                  ? 'NO CURRENT OPEN PROPOSAL'
                  : 'CURRENT PROPOSAL SET UNKNOWN'}</p>
            <small>{proposalDeskRuntimeCurrent
              ? `${proposalRows.length} owner-published proposal ${proposalRows.length === 1 ? 'record' : 'records'} · first record shown in engine order`
              : basisEngineFeedTruth.reason ?? 'Current Basis runtime truth unavailable'}</small>
          </div>
          <dl className="volx-facts basx-facts">
            <div><dt>Binding</dt><dd>{titleCase(proposalDeskEconomics.binding)}</dd></div>
            <div><dt>Proposal ID</dt><dd title={proposalDeskRecordCurrent
              ? proposalDeskRow?.proposal?.id
              : undefined}>{proposalDeskRecordCurrent
                ? proposalDeskRow?.proposal?.id ?? 'UNKNOWN'
                : 'UNKNOWN'}</dd></div>
            <div><dt>Status</dt><dd>{proposalDeskRecordCurrent
              ? titleCase(proposalDeskRow?.proposal?.status ?? 'UNKNOWN')
              : 'UNKNOWN'}</dd></div>
            <div><dt>Integrity</dt><dd>{titleCase(proposalDeskEconomics.integrityLabel)}</dd></div>
            <div><dt>Gross Gap</dt><dd>{finite(proposalDeskEconomics.grossGapPct)
              ? fmtBasis(proposalDeskEconomics.grossGapPct, 3)
              : 'UNKNOWN'}</dd></div>
            <div><dt>Four-Leg Fees</dt><dd>{finite(proposalDeskEconomics.feesPct)
              ? fmtBasis(proposalDeskEconomics.feesPct, 3)
              : 'UNKNOWN'}</dd></div>
            <div><dt>Slippage</dt><dd>{finite(proposalDeskEconomics.slippagePct)
              ? fmtBasis(proposalDeskEconomics.slippagePct, 3)
              : 'UNKNOWN'}</dd></div>
            <div><dt>Funding Drag</dt><dd>{finite(proposalDeskEconomics.fundingDragPct)
              ? fmtBasis(proposalDeskEconomics.fundingDragPct, 3)
              : 'UNKNOWN'}</dd></div>
            <div><dt>Borrow Cost</dt><dd>{finite(proposalDeskEconomics.borrowCostPct)
              ? fmtBasis(proposalDeskEconomics.borrowCostPct, 3)
              : 'UNKNOWN'}</dd></div>
            <div><dt>Total Cost</dt><dd>{finite(proposalDeskEconomics.totalCostPct)
              ? fmtBasis(proposalDeskEconomics.totalCostPct, 3)
              : 'UNKNOWN'}</dd></div>
            <div><dt>Current Net</dt><dd>{finite(proposalDeskEconomics.netEdgePct)
              ? fmtBasis(proposalDeskEconomics.netEdgePct, 3)
              : 'UNKNOWN'}</dd></div>
            <div><dt>Proposal Net</dt><dd>{proposalDeskRecordCurrent
              && finite(proposalDeskEconomics.proposalNetEdgePct)
              ? fmtBasis(proposalDeskEconomics.proposalNetEdgePct, 3)
              : 'UNKNOWN'}</dd></div>
            <div><dt>Funding Carry</dt><dd>{finite(proposalDeskEconomics.fundingCarryPct)
              ? fmtBasis(proposalDeskEconomics.fundingCarryPct, 3)
              : 'UNKNOWN'}</dd></div>
            <div><dt>Confidence</dt><dd>{proposalDeskRecordCurrent
              && finite(proposalDeskRow?.proposal?.confidence)
              ? fmtPct(proposalDeskRow.proposal.confidence * 100, 0, false)
              : 'UNKNOWN'}</dd></div>
            <div><dt>Staged Sizes</dt><dd>{proposalDeskRecordCurrent
              && proposalDeskEconomics.stagesConsistent
              && proposalDeskRow?.proposal?.stagedSizes.length
              ? proposalDeskRow.proposal.stagedSizes.map((stage) => (
                `Stage ${stage.stage}: ${fmtMoney(stage.notionalUsd)} at ${fmtPct(stage.fraction * 100, 0, false)}`
              )).join(' · ')
              : 'UNKNOWN'}</dd></div>
            <div><dt>Invalidation</dt><dd>{proposalDeskRecordCurrent
              ? proposalDeskRow?.proposal?.invalidation ?? 'UNKNOWN'
              : 'UNKNOWN'}</dd></div>
            <div><dt>Engine Reason</dt><dd>{proposalDeskRuntimeCurrent
              ? proposalDeskRow?.reason ?? 'NONE RECORDED'
              : 'UNKNOWN'}</dd></div>
            <div><dt>Books</dt><dd>{proposalDeskRuntimeCurrent && snapshot
              ? snapshot.status.bookSource
              : 'UNKNOWN'}</dd></div>
            <div><dt>Mark / Funding</dt><dd>{proposalDeskRuntimeCurrent && snapshot
              ? snapshot.status.markSource
              : 'UNKNOWN'}</dd></div>
            <div><dt>Borrow</dt><dd>{proposalDeskRuntimeCurrent && snapshot
              ? snapshot.status.borrowSource
              : 'UNKNOWN'}</dd></div>
          </dl>
        </section>

        <ProductSurfaceAdapter surfaceId="basis" />

        <div className="volx-filters">
          <div className="volx-segments" role="tablist" aria-label="Basis Views">
            {FILTERS.map((item) => (
              <button
                type="button"
                role="tab"
                aria-selected={filter === item.id}
                className={filter === item.id ? 'selected' : ''}
                key={item.id}
                onClick={() => {
                  setFilter(item.id);
                  setExpanded(null);
                }}
              >
                {item.label}
                <span>{basisTruth.current || basisEngineRowsVisible ? counts[item.id] : 'UNKNOWN'}</span>
              </button>
            ))}
          </div>
          <span className="volx-view-note">
            {basisTruth.current && snapshot
              ? 'Crossed books ' + snapshot.status.bookState + ' · marks ' + snapshot.status.markState
              : basisEngineRowsVisible && snapshot
                ? basisEngineFeedNote + ' · crossed books ' + snapshot.status.bookState + ' · marks ' + snapshot.status.markState
                : basisUnassertedDetail}
          </span>
        </div>

        <div className="volx-table basx-table" role="table" aria-label="Basis Scanner Decisions">
          <div className="basx-head" role="row">
            <span role="columnheader">State</span>
            <span role="columnheader">Asset</span>
            <span role="columnheader">Executable Gap</span>
            <span role="columnheader">Execution Prices</span>
            <span role="columnheader">Funding</span>
            <span role="columnheader">Costs / Net</span>
            <span role="columnheader">Market Quality</span>
            <span role="columnheader">Decision</span>
            <span aria-hidden="true" />
          </div>

          {basisTruth.state === 'UNAVAILABLE' && !basisEngineRowsVisible ? (
            <div className="volx-empty">
              <Activity size={18} />
              <strong>Basis Runtime Unavailable</strong>
              <span>{basisTruth.reason}</span>
            </div>
          ) : basisTruth.state === 'STARTING' || !snapshot ? (
            <div className="volx-empty">
              <Radio size={18} />
              <strong>Connecting To Basis Runtime</strong>
              <span>Waiting for public Binance spot, USD-M book, mark, and funding sources.</span>
            </div>
          ) : filteredRows.length ? filteredRows.map((row) => {
            const rowCurrent = basisEngineFeedTruth.current
              && basisProposalObservationCurrent(row, snapshot.thresholds.minDataQuality);
            const rowEconomicsCurrent = rowCurrent
              && basisRowEconomicsComplete(
                row,
                snapshot.thresholds.feesPct,
                snapshot.updatedAt,
              );
            const rowProposalEconomics = buildBasisProposalEconomics(
              row,
              rowCurrent,
              snapshot.thresholds.feesPct,
              snapshot.updatedAt,
              snapshot.thresholds.intendedNotionalUsd,
              basisEngineFeedTruth.current,
            );
            const rowWatchWritable = watchWritable && rowCurrent;
            const isExpanded = expanded === row.symbol;
            const watching = watchlist.includes(row.symbol);
            const prices = executionPrices(row);
            const evidence = resolveBasisRowEvidence(row);
            const watchReasonId = `basis-watch-reason-${row.symbol}`;
            return (
              <div className="basx-item" role="rowgroup" key={row.symbol}>
                <button
                  type="button"
                  className="basx-row"
                  aria-expanded={isExpanded}
                  onClick={() => setExpanded(isExpanded ? null : row.symbol)}
                >
                  <span className={'volx-state ' + stateTone(row, rowCurrent)} role="cell">
                    <i aria-hidden="true" />
                    {stateLabel(row)}
                  </span>
                  <span className="volx-asset" role="cell">
                    <TokenIcon symbol={row.symbol} size={28} />
                    <span><strong>{row.base}</strong><small>{rowCurrent ? `${fmtMoney(row.quoteVolume24h)} 24h` : '24h volume UNKNOWN'}</small></span>
                  </span>
                  <span className="basx-gap" role="cell">
                    <strong>{rowCurrent ? fmtBasis(row.executableGapPct) : 'UNKNOWN'}</strong>
                    <small>{directionLabel(row.direction)}</small>
                  </span>
                  <span className="basx-prices" role="cell">
                    <strong>{rowCurrent ? prices.primary : 'UNKNOWN / UNKNOWN'}</strong>
                    <small>{prices.secondary}</small>
                  </span>
                  <span className="basx-funding" role="cell">
                    <strong>{rowCurrent ? fmtFunding(row.fundingRate) : 'UNKNOWN'}</strong>
                    <small>{rowCurrent && row.nextFundingTs && finite(row.fundingCarryPct)
                      ? countdown(row.nextFundingTs) + ' · Carry ' + fmtBasis(row.fundingCarryPct)
                      : 'Funding unavailable'}</small>
                  </span>
                  <span className="basx-edge" role="cell">
                    <strong>{rowEconomicsCurrent ? fmtBasis(row.netEdgePct) : 'UNKNOWN'}</strong>
                    <small>Gross {rowCurrent ? fmtBasis(row.executableGapPct) : 'UNKNOWN'} · Cost {rowEconomicsCurrent
                      ? fmtBasis(row.costs.totalPct)
                      : 'UNKNOWN'}</small>
                  </span>
                  <span className="volx-quality basx-quality" role="cell">
                    <strong>{Math.round(row.dataQuality.score * 100) + '% Trust'}</strong>
                    <small>{rowCurrent
                      ? `${bps(row.spotSpreadBps)} / ${bps(row.perpSpreadBps)}`
                      : 'Row evidence not current'}</small>
                  </span>
                  <span className="volx-decision" role="cell">
                    <strong>{decisionTitle(row)}</strong>
                    <small>{row.reason}</small>
                  </span>
                  <ChevronDown className={isExpanded ? 'expanded' : ''} size={15} aria-hidden="true" />
                </button>

                {isExpanded ? (
                  <div className="volx-detail basx-detail">
                    <div className="volx-reason">
                      <span>Scanner Decision</span>
                      <p>{row.reason}</p>
                      <small><Radio size={13} />{snapshot.status.bookSource} · {snapshot.status.markSource}</small>
                    </div>
                    <dl className="volx-facts basx-facts">
                      <div><dt>Spot Bid / Ask</dt><dd>{rowCurrent
                        ? `${fmtPrice(row.spotBid)} / ${fmtPrice(row.spotAsk)}`
                        : 'UNKNOWN / UNKNOWN'}</dd></div>
                      <div><dt>Perp Bid / Ask</dt><dd>{rowCurrent
                        ? `${fmtPrice(row.perpBid)} / ${fmtPrice(row.perpAsk)}`
                        : 'UNKNOWN / UNKNOWN'}</dd></div>
                      <div><dt>Alternate Gap</dt><dd>{rowCurrent ? fmtBasis(row.alternateGapPct) : 'UNKNOWN'}</dd></div>
                      <div><dt>Gap Age</dt><dd>{rowCurrent ? durationCompact(row.gapAgeMs) : 'UNKNOWN'}</dd></div>
                      <div><dt>Gap Slope</dt><dd>{rowCurrent && finite(row.gapSlopePctPerMin)
                        ? fmtBasis(row.gapSlopePctPerMin) + '/min'
                        : 'UNKNOWN'}</dd></div>
                      <div><dt>Persistence</dt><dd>{row.persistTicks}/{snapshot.thresholds.persistTicks} ticks</dd></div>
                      <div><dt>Four-Leg Fees</dt><dd>{rowEconomicsCurrent ? fmtBasis(row.costs.feesPct) : 'UNKNOWN'}</dd></div>
                      <div><dt>Slippage At {fmtMoney(snapshot.thresholds.intendedNotionalUsd)}</dt><dd>{rowEconomicsCurrent
                        ? fmtBasis(row.slippagePct)
                        : 'UNKNOWN'}</dd></div>
                      <div><dt>Funding Carry</dt><dd>{rowCurrent ? fmtBasis(row.fundingCarryPct) : 'UNKNOWN'}</dd></div>
                      <div><dt>Expected Hold</dt><dd>{durationCompact(row.expectedHoldMs)}</dd></div>
                      <div><dt>Depth Score</dt><dd>{rowCurrent && finite(row.depthScore)
                        ? `${row.depthScore.toFixed(2)} · ${row.ladderBacked ? 'Ladder' : 'Top Book'}`
                        : 'UNKNOWN'}</dd></div>
                      <div><dt>Data Quality</dt><dd>{Math.round(row.dataQuality.score * 100)}%</dd></div>
                      <div><dt>Spot Evidence Age</dt><dd>{finite(row.dataQuality.spotStalenessMs)
                        ? durationCompact(row.dataQuality.spotStalenessMs)
                        : 'UNKNOWN'}</dd></div>
                      <div><dt>Perp Evidence Age</dt><dd>{finite(row.dataQuality.perpStalenessMs)
                        ? durationCompact(row.dataQuality.perpStalenessMs)
                        : 'UNKNOWN'}</dd></div>
                      <div><dt>Leg Skew</dt><dd>{finite(row.dataQuality.legSkewMs)
                        ? durationCompact(row.dataQuality.legSkewMs)
                        : 'UNKNOWN'}</dd></div>
                      <div><dt>Suspect Evidence</dt><dd>{row.dataQuality.suspectReasons.length
                        ? row.dataQuality.suspectReasons.join(' · ')
                        : 'NONE RECORDED'}</dd></div>
                      <div><dt>Borrow Preflight</dt><dd>{titleCase(row.borrow.status)}</dd></div>
                      <div><dt>Borrow Reason</dt><dd title={row.borrow.human}>{row.borrow.human}</dd></div>
                      <div><dt>Reject Code</dt><dd>{row.rejectCode ? titleCase(row.rejectCode) : 'None'}</dd></div>
                      <div><dt>Correlation</dt><dd title={row.correlationId ?? undefined}>{row.correlationId ?? 'None'}</dd></div>
                    </dl>
                    <section aria-label={`${row.symbol} Direction Evidence`}>
                      <div className="volx-reason">
                        <span>Direction Evidence</span>
                        <p>{evidence.selectedDirection}</p>
                        <small>Current scanner cut · alternate direction is not a recommendation</small>
                      </div>
                      <dl className="volx-facts basx-facts">
                        <div><dt>Selected</dt><dd>{evidence.selectedDirection}</dd></div>
                        <div><dt>Alternate</dt><dd>{!rowCurrent || evidence.alternateGapPct === null
                          ? `${evidence.alternateDirection} · UNKNOWN`
                          : `${evidence.alternateDirection} · ${fmtBasis(evidence.alternateGapPct)}`}</dd></div>
                        <div><dt>Funding Flip Risk</dt><dd>{rowCurrent && finite(row.fundingFlipRisk)
                          ? fmtPct(row.fundingFlipRisk * 100, 1, false)
                          : 'UNKNOWN'}</dd></div>
                        <div><dt>Book Pressure</dt><dd>{rowCurrent && finite(row.bookPressure)
                          ? row.bookPressure.toFixed(2)
                          : 'UNKNOWN'}</dd></div>
                      </dl>
                    </section>
                    <section aria-label={`${row.symbol} Decision Observation`}>
                      <div className="volx-reason">
                        <span>Decision Observation</span>
                        <p>{evidence.historyBoundary === 'DECISION_OBSERVATION'
                          ? 'One emitted decision observation'
                          : 'NONE RECORDED'}</p>
                        <small>Not a historical series</small>
                      </div>
                      <dl className="volx-facts basx-facts">
                        <div><dt>Observed</dt><dd title={evidence.decisionTs === null
                          ? undefined
                          : fmtDateTime(evidence.decisionTs)}>{evidence.decisionTs === null
                            ? 'UNKNOWN'
                            : timeAgo(evidence.decisionTs)}</dd></div>
                        <div><dt>Trace</dt><dd title={evidence.correlationId ?? undefined}>{evidence.correlationId ?? 'UNKNOWN'}</dd></div>
                      </dl>
                    </section>
                    <section aria-label={`${row.symbol} Ranking And Proposal Evidence`}>
                      <div className="volx-reason">
                        <span>Ranking / Proposal Evidence</span>
                        <p>{evidence.proposal ? 'Read-only runtime proposal record' : 'NO PROPOSAL RECORD'}</p>
                        <small>Only owner-emitted fields are shown</small>
                      </div>
                      <dl className="volx-facts basx-facts">
                        <div><dt>Priority</dt><dd>{!rowCurrent || evidence.priorityScore === null
                          ? 'UNKNOWN'
                          : fmtPct(evidence.priorityScore * 100, 1, false)}</dd></div>
                        <div><dt>Status</dt><dd>{evidence.proposal ? titleCase(evidence.proposal.status) : 'NONE RECORDED'}</dd></div>
                        <div><dt>Proposal ID</dt><dd title={evidence.proposal?.id}>{evidence.proposal?.id ?? 'NONE RECORDED'}</dd></div>
                        <div><dt>Proposal Net</dt><dd>{!rowEconomicsCurrent
                          || evidence.proposal?.netEdgePct === null
                          || evidence.proposal === null
                          ? 'UNKNOWN'
                          : fmtBasis(evidence.proposal.netEdgePct)}</dd></div>
                        <div><dt>Confidence</dt><dd>{!rowCurrent
                          || evidence.proposal?.confidence === null
                          || evidence.proposal === null
                          ? 'UNKNOWN'
                          : fmtPct(evidence.proposal.confidence * 100, 1, false)}</dd></div>
                        <div><dt>Invalidation</dt><dd>{evidence.proposal?.invalidation ?? 'UNKNOWN'}</dd></div>
                        <div><dt>Staged Sizes</dt><dd>{rowCurrent
                          && rowProposalEconomics.stagesConsistent
                          && evidence.proposal?.stagedSizes.length
                          ? evidence.proposal.stagedSizes.map((stage) => (
                            `Stage ${stage.stage}: ${fmtMoney(stage.notionalUsd)} at ${fmtPct(stage.fraction * 100, 0, false)}`
                          )).join(' · ')
                          : evidence.proposal ? 'UNKNOWN' : 'NONE RECORDED'}</dd></div>
                      </dl>
                    </section>
                    <div className="volx-actions">
                      <button type="button" onClick={() => openDetail(row.symbol)}><Eye size={14} />Open Market</button>
                      <button
                        type="button"
                        className={rowWatchWritable && watching ? 'active' : ''}
                        aria-pressed={watching}
                        aria-describedby={!rowWatchWritable ? watchReasonId : undefined}
                        disabled={!rowWatchWritable}
                        title={rowWatchWritable
                          ? undefined
                          : 'Watch changes require current compatibility, canonical Basis runtime truth, and passing row freshness, skew, and suspect-evidence gates.'}
                        onClick={() => {
                          if (rowWatchWritable) void toggleWatch(row.symbol);
                        }}
                      >
                        <Star size={14} fill={watching ? 'currentColor' : 'none'} />
                        {rowWatchWritable
                          ? watching ? 'Watching' : 'Watch'
                          : watching ? 'Watching · Change Unavailable' : 'Watch Unavailable'}
                      </button>
                      <button type="button" onClick={() => openLedger(row.symbol)}><BookOpen size={14} />Open Logs</button>
                      <button type="button" onClick={() => setPage('opportunities')}><ArrowRightLeft size={14} />Open Queue</button>
                      {!rowWatchWritable ? (
                        <p id={watchReasonId}>
                          Watch changes require current compatibility, canonical Basis runtime truth, and passing row freshness, skew, and suspect-evidence gates.
                        </p>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </div>
            );
          }) : (
            <div className="volx-empty">
              <Activity size={18} />
              <strong>No Basis Rows Match</strong>
              <span>Change the filter or search term. No rows are simulated.</span>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
