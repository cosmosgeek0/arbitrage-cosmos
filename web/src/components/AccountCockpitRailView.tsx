import type { KeyboardEvent } from 'react';
import {
  exactOrDash,
  privateReadCoverageStateTone,
  privateReadReconciliationStateTone,
  projectPrivateReadGuard,
  worstTone,
  type PrivateReadSnapshot,
  type PrivateReadSourceId,
  type PrivateReadState,
  type PrivateReadTone,
  type ReconciliationState,
} from '../lib/privateRead';

/**
 * The account cockpit surface. It renders one shared read-only truth tape from
 * an already admitted private-read snapshot and consumes no store, transport,
 * effect, timer, or endpoint of its own: `projectPrivateReadGuard` stays the
 * shared shell projection owner, so this surface can only re-present proven
 * facts.
 */

interface CockpitFact {
  id: string;
  label: string;
  value: string;
  detail: string;
  tone: PrivateReadTone;
}

type CountStatus = 'OBSERVED' | 'EXACT_EMPTY' | 'UNKNOWN' | 'NOT_CONFIGURED';

interface CountFact {
  value: string;
  status: CountStatus;
  detail: string;
  tone: PrivateReadTone;
}

const STATE_DETAIL: Record<PrivateReadState, string> = {
  AVAILABLE: 'Every configured product read was admitted.',
  PARTIAL: 'Some configured product reads were not admitted.',
  UNAVAILABLE: 'No private account rows were admitted.',
  NOT_CONFIGURED: 'No private account read is configured.',
};

/**
 * Provenance, not health: naming the response that supplied the displayed
 * truth is never a claim that the read succeeded, so only a fallback response
 * takes a tone of its own.
 */
const SOURCE_FACT: Record<PrivateReadSourceId, { detail: string }> = {
  PENDING: { detail: 'No account result has been applied yet.' },
  STATE: { detail: 'Applied from the preferred compatibility state endpoint.' },
  FALLBACK: { detail: 'Applied from the bounded fallback account endpoint.' },
};

/**
 * A count is a fact only where the projector supplied an exact array. A `null`
 * collection stays UNKNOWN behind an em dash and is never presented as zero;
 * an exact empty array keeps the observed zero it proved.
 */
export function accountCockpitCountFact(count: number | null, state: PrivateReadState): CountFact {
  if (count === null) {
    return state === 'NOT_CONFIGURED'
      ? { value: '—', status: 'NOT_CONFIGURED', detail: 'NOT_CONFIGURED · no private read is configured.', tone: 'idle' }
      : { value: '—', status: 'UNKNOWN', detail: 'UNKNOWN · absence is not counted as zero.', tone: 'warn' };
  }
  return count === 0
    ? { value: '0', status: 'EXACT_EMPTY', detail: 'EXACT_EMPTY · the admitted collection proved an exact zero.', tone: 'ok' }
    : { value: String(count), status: 'OBSERVED', detail: 'OBSERVED · exact provider rows.', tone: 'ok' };
}

export interface AccountCockpitScrollMetrics {
  key: string;
  scrollLeft: number;
  clientWidth: number;
  scrollWidth: number;
}

/**
 * The next horizontal offset for one recognized key, or `null` where the key is
 * not one the fact canvas answers.
 *
 * The target runtime does not scroll a focused container from the arrow keys on
 * its own, so the off-screen facts would otherwise be unreachable by keyboard.
 * Every measurement is treated as untrusted: invalid or non-scrollable geometry
 * fails closed to native key behaviour, and an in-range target is returned only
 * when the canvas can actually move.
 */
export function accountCockpitScrollTarget({
  key,
  scrollLeft,
  clientWidth,
  scrollWidth,
}: AccountCockpitScrollMetrics): number | null {
  const recognized = key === 'ArrowRight'
    || key === 'PageDown'
    || key === 'ArrowLeft'
    || key === 'PageUp'
    || key === 'Home'
    || key === 'End';
  if (!recognized) return null;

  // Without complete, positive, overflowing geometry there is no custom
  // movement to own, so the browser keeps the key for its native behaviour.
  if (
    !Number.isFinite(scrollLeft)
    || !Number.isFinite(clientWidth)
    || !Number.isFinite(scrollWidth)
    || clientWidth <= 0
    || scrollWidth <= clientWidth
  ) return null;

  const maximum = scrollWidth - clientWidth;
  const current = Math.min(maximum, Math.max(0, scrollLeft));
  // One step is one visible canvas, which is also the paging distance.
  const step = clientWidth;
  const target = key === 'ArrowRight' || key === 'PageDown'
    ? current + step
    : key === 'ArrowLeft' || key === 'PageUp'
      ? current - step
      : key === 'Home'
        ? 0
        : key === 'End'
          ? maximum
          : current;
  const clamped = Math.min(maximum, Math.max(0, target));
  return clamped === current ? null : clamped;
}

/**
 * The canvas's one keyboard affordance: it scrolls, and does nothing else. No
 * control is added, no state is held, and the assignment is direct so the rail
 * introduces no motion.
 */
function scrollFactCanvas(event: KeyboardEvent<HTMLDListElement>): void {
  const canvas = event.currentTarget;
  const target = accountCockpitScrollTarget({
    key: event.key,
    scrollLeft: canvas.scrollLeft,
    clientWidth: canvas.clientWidth,
    scrollWidth: canvas.scrollWidth,
  });
  // Unrecognized and no-movement keys keep their native behaviour, including
  // ancestor page scrolling at either edge of the fact canvas.
  if (target === null) return;
  event.preventDefault();
  canvas.scrollLeft = target;
}

export function AccountCockpitRailView({
  snapshot,
  source,
  error,
}: {
  readonly snapshot: PrivateReadSnapshot;
  readonly source: PrivateReadSourceId;
  readonly error: string | null;
}) {
  const guard = projectPrivateReadGuard({ snapshot, source, error });
  const { presentation, errorFact } = guard;
  const sourceFact = SOURCE_FACT[source];
  const coverageTone = guard.coverageTone;
  const reconciliationFacts = Object.values(snapshot.reconciliation);
  const reconciliationReason = reconciliationFacts.find((fact) => fact.reason !== null)?.reason ?? null;
  const spotAvailableUsdt = presentation.spotAvailableUsdt;
  const accountGuardTone = worstTone(guard.commonTone, guard.sourceGuardTone);
  const guardObservedFact = (
    fact: CountFact,
    factCoverageTone: PrivateReadTone,
    factCoverageLabel: string,
    reconciliationState: ReconciliationState,
  ): CountFact => {
    const tone = [factCoverageTone, privateReadReconciliationStateTone(reconciliationState)]
      .reduce(worstTone, worstTone(fact.tone, accountGuardTone));
    if (fact.status !== 'OBSERVED' && fact.status !== 'EXACT_EMPTY') return { ...fact, tone };
    if (tone === 'ok') return fact;
    if (presentation.freshness.state === 'STALE') {
      return {
        ...fact,
        detail: fact.status === 'EXACT_EMPTY'
          ? 'STALE LAST-KNOWN · EXACT_EMPTY · current absence UNKNOWN; the last admitted collection proved an exact zero.'
          : `STALE LAST-KNOWN · OBSERVED · ${fact.detail.replace(/^OBSERVED · /, '')}`,
        tone,
      };
    }

    const qualifier = presentation.freshness.state !== 'CURRENT'
      ? `OBSERVED · FRESHNESS ${presentation.freshness.state}`
      : factCoverageTone !== 'ok'
        ? `OBSERVED · ${factCoverageLabel}`
        : reconciliationState !== 'RECONCILED'
          ? `OBSERVED · ${reconciliationState} RECONCILIATION`
          : snapshot.permissionPosture.state !== 'VERIFIED_READ_ONLY'
            ? `OBSERVED · PERMISSION ${snapshot.permissionPosture.state}`
            : errorFact.id !== 'NONE'
              ? `OBSERVED · ${errorFact.label}`
              : 'OBSERVED NON-GREEN';
    return { ...fact, detail: `${qualifier} · ${fact.detail}`, tone };
  };
  const spotAvailable = guardObservedFact(
    spotAvailableUsdt === null
      ? {
        value: '—',
        status: snapshot.spot.state === 'NOT_CONFIGURED' ? 'NOT_CONFIGURED' : 'UNKNOWN',
        detail: `UNKNOWN · ${snapshot.spot.state} · no exact USDT free balance was admitted.`,
        tone: snapshot.spot.state === 'NOT_CONFIGURED' ? 'idle' : 'warn',
      }
      : {
        value: exactOrDash(spotAvailableUsdt),
        status: 'OBSERVED',
        detail: `${snapshot.spot.state} · exact Spot free balance only.`,
        tone: 'ok',
      },
    privateReadCoverageStateTone(snapshot.spot.coverage.state),
    snapshot.spot.coverage.state,
    snapshot.reconciliation.balances.state,
  );
  const orders = guardObservedFact(
    accountCockpitCountFact(presentation.counts.openOrders, presentation.state),
    coverageTone,
    presentation.coverageLabel,
    snapshot.reconciliation.orders.state,
  );
  const fills = guardObservedFact(
    accountCockpitCountFact(presentation.counts.fills, presentation.state),
    coverageTone,
    presentation.coverageLabel,
    snapshot.reconciliation.fills.state,
  );
  const positions = guardObservedFact(
    accountCockpitCountFact(presentation.counts.positions, presentation.state),
    privateReadCoverageStateTone(snapshot.usdm.coverage.state),
    snapshot.usdm.coverage.state,
    snapshot.reconciliation.positions.state,
  );
  const baseLiabilities = accountCockpitCountFact(presentation.counts.liabilities, presentation.state);
  const liabilities = guardObservedFact(
    {
      ...baseLiabilities,
      detail: baseLiabilities.status === 'OBSERVED' || baseLiabilities.status === 'EXACT_EMPTY'
        ? `${baseLiabilities.status} · aggregate ${exactOrDash(presentation.marginLiabilityBtc)} BTC.`
        : baseLiabilities.detail,
    },
    privateReadCoverageStateTone(snapshot.margin.coverage.state),
    snapshot.margin.coverage.state,
    snapshot.reconciliation.liabilities.state,
  );

  // The overall tape is the worst proven account claim. Freshness, posture,
  // admission, coverage, and reconciliation can only downgrade it; no exact
  // value or silent error path can raise a partial account back to green.
  const railTone = guard.overallTone;
  const statusLabel = guard.statusLabel;

  const facts: CockpitFact[] = [
    {
      id: 'private-read',
      label: 'Private Read',
      value: presentation.state,
      detail: STATE_DETAIL[presentation.state],
      tone: accountGuardTone,
    },
    {
      id: 'freshness',
      label: 'Freshness',
      value: presentation.freshness.state,
      detail: presentation.freshness.reason,
      tone: presentation.freshness.tone,
    },
    {
      id: 'permission',
      label: 'Permission',
      value: snapshot.permissionPosture.state,
      detail: `${guard.permissionFreshness.label} · ${guard.permissionFreshness.reason} · ${presentation.postureDetail}`,
      tone: guard.permissionGuardTone,
    },
    {
      id: 'admission',
      label: 'Admission',
      value: errorFact.label,
      detail: errorFact.detail,
      tone: errorFact.tone,
    },
    {
      id: 'spot-available-usdt',
      label: 'Spot Available USDT',
      value: spotAvailable.value,
      detail: spotAvailable.detail,
      tone: spotAvailable.tone,
    },
    {
      id: 'open-orders',
      label: 'Open Orders',
      value: orders.value,
      detail: orders.detail,
      tone: orders.tone,
    },
    {
      id: 'fills',
      label: 'Fills',
      value: fills.value,
      detail: fills.detail,
      tone: fills.tone,
    },
    {
      id: 'positions',
      label: 'Positions',
      value: positions.value,
      detail: positions.detail,
      tone: positions.tone,
    },
    {
      id: 'liabilities',
      label: 'Liabilities',
      value: liabilities.value,
      detail: liabilities.detail,
      tone: liabilities.tone,
    },
    {
      id: 'coverage',
      label: 'Coverage',
      value: presentation.coverageLabel,
      detail: presentation.freshness.state === 'STALE'
        ? 'STALE LAST-KNOWN · Spot, Cross Margin, and USD-M read coverage.'
        : 'Spot, Cross Margin, and USD-M read coverage.',
      tone: guard.coverageFactTone,
    },
    {
      id: 'reconciliation',
      label: 'Reconciliation',
      value: presentation.reconciliationLabel,
      detail: presentation.freshness.state === 'STALE'
        ? `STALE LAST-KNOWN · ${reconciliationReason ?? 'Balances, orders, fills, positions, and liabilities.'}`
        : reconciliationReason ?? 'Balances, orders, fills, positions, and liabilities.',
      tone: guard.reconciliationFactTone,
    },
    {
      id: 'source',
      label: 'Source',
      value: source,
      detail: sourceFact.detail,
      tone: guard.sourceFactTone,
    },
  ];

  return (
    // A labelled complementary landmark. The accessible name keeps it a
    // landmark wherever the shell mounts it. The rail holds no control, link,
    // or form field: its only focus target is the scrollable fact canvas.
    <aside
      className="acr-rail"
      aria-label="Account cockpit"
      data-account-cockpit-rail="mounted"
      data-acr-tone={railTone}
      data-acr-state={presentation.state}
      data-acr-freshness={presentation.freshness.state}
      data-acr-posture={snapshot.permissionPosture.state}
      data-acr-source={source}
      data-acr-error={errorFact.code}
    >
      <div className="acr-head">
        <span className="acr-title">Account Cockpit</span>
        <span className="acr-identity">{presentation.identityLabel}</span>
        <span className={`acr-status s-${railTone}`}>
          <i aria-hidden="true" />
          {statusLabel}
        </span>
      </div>
      {/* The tape scrolls inside its own canvas at the narrowest container, so
          it is a named, focusable scroll region and the columns that scrolled
          out of view stay reachable by keyboard. It is still not a control: no
          role, action, or navigation is attached to it. */}
      <dl className="acr-facts" tabIndex={0} aria-label="Account facts" onKeyDown={scrollFactCanvas}>
        {facts.map((fact) => (
          <div className="acr-fact" key={fact.id} data-acr-fact={fact.id} data-acr-fact-tone={fact.tone}>
            <dt>{fact.label}</dt>
            <dd>
              <b className={`s-${fact.tone}`}>{fact.value}</b>
              <small>{fact.detail}</small>
            </dd>
          </div>
        ))}
      </dl>
      {/* Status text only. No money control is mounted, and nothing here is a
          control, link, or navigation target waiting to become one. */}
      <p className="acr-plan" data-acr-actions="PLANNED_DISABLED">
        <span>Account Actions</span>
        <em>Planned · Disabled</em>
        <small>Read-only cockpit: no order, borrow, transfer, or key control is mounted.</small>
      </p>
    </aside>
  );
}
