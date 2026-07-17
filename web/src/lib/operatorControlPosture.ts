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

export type CanonicalWatchmanHealthStatus = 'operational' | 'degraded' | 'outage' | 'planned';
export type WatchmanRefreshActionState = 'idle' | 'spin' | 'ok' | 'err';

export interface CanonicalWatchmanLauncherPresentation {
  readonly healthStatus: CanonicalWatchmanHealthStatus;
  readonly label: string;
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

/**
 * Canonical supervisor health always owns the Watchman launcher tone. A local
 * public-refresh result is only an action acknowledgement; it cannot prove
 * that the supervised connection graph recovered.
 */
export function canonicalWatchmanLauncherPresentation({
  canonicalStatus,
  canonicalLabel,
  actionState,
}: {
  readonly canonicalStatus: CanonicalWatchmanHealthStatus;
  readonly canonicalLabel: string;
  readonly actionState: WatchmanRefreshActionState;
}): Readonly<CanonicalWatchmanLauncherPresentation> {
  const actionSuffix = actionState === 'spin'
    ? ' · Public Refresh Running'
    : actionState === 'ok'
      ? ' · Public Refresh Completed'
      : actionState === 'err'
        ? ' · Public Refresh Needs Review'
        : '';
  return Object.freeze({
    healthStatus: canonicalStatus,
    label: `Connection Watchman · ${canonicalLabel}${actionSuffix}`,
  });
}
