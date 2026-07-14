import type {
  FiveSecondOwnerView,
  ProductBindingContinuity,
  ProductComponentProjection,
} from './productIntegration';

export type CanonicalPresentationTone = 'ok' | 'warn' | 'bad' | 'idle';
export type CanonicalWatchmanStatus = 'operational' | 'degraded' | 'outage' | 'planned';

export interface CanonicalComponentPresentation {
  readonly status: CanonicalWatchmanStatus;
  readonly tone: CanonicalPresentationTone;
  readonly statusLabel: string;
  readonly stateLabel: string;
  readonly lifecycle: ProductComponentProjection['observedLifecycle'] | 'UNKNOWN';
  readonly capability: ProductComponentProjection['capability'] | 'UNKNOWN';
  readonly truthLabel: ProductComponentProjection['truthLabel'] | 'UNKNOWN';
}

export interface CanonicalKillSwitchEngagePosture {
  readonly engaged: boolean;
  readonly actionAllowed: boolean;
  readonly buttonLabel: 'Preview STOP BOT' | 'Already Engaged' | 'Engage Only Unavailable';
  readonly disabledReason: string | null;
}

export type CanonicalRefreshTarget = 'all' | 'market' | 'runtime' | 'news' | 'calendar' | 'fx';

export interface CanonicalRefreshTargetPosture {
  readonly actionAllowed: boolean;
  readonly statusLabel: 'PUBLIC_REFRESH' | 'CONTROL_PREVIEW_REQUIRED';
  readonly actionLabel: 'Run Public Refresh' | 'Control Preview Required';
  readonly reason: string;
}

const OUTAGE_LIFECYCLES = new Set<ProductComponentProjection['observedLifecycle']>([
  'FAILED',
  'BLOCKED',
  'RECOVERY_REQUIRED',
]);

const OUTAGE_TRUTH = new Set<ProductComponentProjection['truthLabel']>([
  'BLOCKED',
  'UNAVAILABLE',
  'MISSING',
  'UNKNOWN',
]);

const OUTAGE_CAPABILITY = new Set<ProductComponentProjection['capability']>([
  'UNAVAILABLE',
  'UNKNOWN',
]);

function capabilityLabel(capability: ProductComponentProjection['capability']): string {
  if (capability === 'LIVE_PUBLIC') return 'Live Public';
  if (capability === 'LIVE_PRIVATE_READ') return 'Private Read';
  if (capability === 'LIVE_SIGNED_VALIDATE') return 'Signed Validate';
  if (capability === 'LIVE_MANUAL_CAPPED') return 'Manual Capped';
  if (capability === 'DRY_RUN') return 'Validate Only';
  if (capability === 'SHADOW') return 'Shadow';
  if (capability === 'REPLAY') return 'Replay';
  if (capability === 'SYNTHETIC') return 'Synthetic';
  if (capability === 'NOT_CONFIGURED') return 'Not Configured';
  if (capability === 'UNAVAILABLE') return 'Unavailable';
  return 'Unknown';
}

/**
 * Map canonical component fields to display posture without inferring readiness
 * from counters, local polling, or a READY lifecycle alone.
 */
export function canonicalComponentPresentation(
  component: Readonly<ProductComponentProjection> | null | undefined,
  continuity: ProductBindingContinuity,
): Readonly<CanonicalComponentPresentation> {
  if (!component) {
    return Object.freeze({
      status: 'outage',
      tone: 'bad',
      statusLabel: 'Unavailable',
      stateLabel: 'UNKNOWN · CANONICAL COMPONENT MISSING',
      lifecycle: 'UNKNOWN',
      capability: 'UNKNOWN',
      truthLabel: 'UNKNOWN',
    });
  }

  const lifecycle = component.observedLifecycle;
  const capability = component.capability;
  const truthLabel = component.truthLabel;
  const nonLiveLabel = capabilityLabel(capability);
  const stateLabel = `${lifecycle.replaceAll('_', ' ')} · ${nonLiveLabel.toUpperCase()} · ${truthLabel.replaceAll('_', ' ')}`;

  if (continuity !== 'PROVEN') {
    return Object.freeze({ status: 'outage', tone: 'bad', statusLabel: 'Continuity Blocked', stateLabel, lifecycle, capability, truthLabel });
  }
  if (capability === 'NOT_CONFIGURED' || truthLabel === 'NOT_CONFIGURED') {
    return Object.freeze({ status: 'planned', tone: 'warn', statusLabel: 'Not Configured', stateLabel, lifecycle, capability, truthLabel });
  }
  if (OUTAGE_LIFECYCLES.has(lifecycle) || OUTAGE_TRUTH.has(truthLabel) || OUTAGE_CAPABILITY.has(capability)) {
    return Object.freeze({ status: 'outage', tone: 'bad', statusLabel: 'Unavailable', stateLabel, lifecycle, capability, truthLabel });
  }
  if (lifecycle === 'READY' && capability === 'LIVE_PUBLIC' && truthLabel === 'LIVE_PUBLIC') {
    return Object.freeze({ status: 'operational', tone: 'ok', statusLabel: 'Live Public', stateLabel, lifecycle, capability, truthLabel });
  }
  return Object.freeze({ status: 'degraded', tone: 'warn', statusLabel: nonLiveLabel, stateLabel, lifecycle, capability, truthLabel });
}

export function canonicalStrategyRuntimePresentation(
  basis: Readonly<ProductComponentProjection> | null | undefined,
  volume: Readonly<ProductComponentProjection> | null | undefined,
  continuity: ProductBindingContinuity,
): Readonly<{ tone: CanonicalPresentationTone; label: string; livePublicCount: number }> {
  const rows = [
    canonicalComponentPresentation(basis, continuity),
    canonicalComponentPresentation(volume, continuity),
  ];
  const livePublicCount = rows.filter((row) => row.status === 'operational').length;
  if (livePublicCount === rows.length) return Object.freeze({ tone: 'ok', label: 'Public Runtime Live', livePublicCount });
  if (rows.some((row) => row.status === 'outage')) return Object.freeze({ tone: 'bad', label: 'Canonical Runtime Unavailable', livePublicCount });
  if (rows.some((row) => row.capability === 'DRY_RUN')) return Object.freeze({ tone: 'warn', label: 'Validate-Only Ready', livePublicCount });
  return Object.freeze({ tone: 'warn', label: 'Review Required', livePublicCount });
}

export function canonicalWatchmanOverallPresentation({
  continuity,
  machineReady,
  effectiveMode,
  components,
}: {
  readonly continuity: ProductBindingContinuity;
  readonly machineReady: FiveSecondOwnerView['machineReady'];
  readonly effectiveMode: FiveSecondOwnerView['effectiveMode'];
  readonly components: readonly Readonly<ProductComponentProjection>[];
}): Readonly<{ status: CanonicalWatchmanStatus; label: string }> {
  if (continuity !== 'PROVEN') return Object.freeze({ status: 'outage', label: 'Continuity Blocked' });
  if (effectiveMode === 'BLOCKED' || machineReady === 'NO') return Object.freeze({ status: 'outage', label: 'Not Ready' });
  if (machineReady !== 'YES') return Object.freeze({ status: 'degraded', label: 'Readiness Unknown' });
  if (effectiveMode === 'VALIDATE_ONLY' || components.some((component) => component.capability === 'DRY_RUN')) {
    return Object.freeze({ status: 'degraded', label: 'Validate Only' });
  }
  if (effectiveMode === 'READ_ONLY') return Object.freeze({ status: 'degraded', label: 'Read Only' });
  if (effectiveMode === 'ADVISORY') return Object.freeze({ status: 'degraded', label: 'Advisory' });
  return Object.freeze({ status: 'degraded', label: 'Effective Mode Unknown' });
}

/** The candidate exposes engage-only kill-switch authority; release is absent. */
export function canonicalKillSwitchEngagePosture({
  currentEffectiveValue,
  payload,
}: {
  readonly currentEffectiveValue: string;
  readonly payload: Readonly<Record<string, unknown>>;
}): Readonly<CanonicalKillSwitchEngagePosture> {
  const engaged = currentEffectiveValue.trim().toUpperCase() === 'ENGAGED';
  if (engaged) {
    return Object.freeze({
      engaged: true,
      actionAllowed: false,
      buttonLabel: 'Already Engaged',
      disabledReason: 'Kill switch is already ENGAGED. Release is unavailable in this candidate.',
    });
  }
  if (payload.engaged !== true) {
    return Object.freeze({
      engaged: false,
      actionAllowed: false,
      buttonLabel: 'Engage Only Unavailable',
      disabledReason: 'The canonical payload is not an engage request. Release and toggle actions are unavailable.',
    });
  }
  return Object.freeze({
    engaged: false,
    actionAllowed: true,
    buttonLabel: 'Preview STOP BOT',
    disabledReason: null,
  });
}

/** Direct refresh is restricted to bounded public-information owners. */
export function canonicalRefreshTargetPosture(
  target: CanonicalRefreshTarget,
): Readonly<CanonicalRefreshTargetPosture> {
  if (target === 'news' || target === 'calendar' || target === 'fx') {
    return Object.freeze({
      actionAllowed: true,
      statusLabel: 'PUBLIC_REFRESH',
      actionLabel: 'Run Public Refresh',
      reason: 'Bounded public-information refresh is available through the exact source owner.',
    });
  }
  return Object.freeze({
    actionAllowed: false,
    statusLabel: 'CONTROL_PREVIEW_REQUIRED',
    actionLabel: 'Control Preview Required',
    reason: 'Managed-runtime recovery requires canonical Product control preview and a durable command receipt.',
  });
}
