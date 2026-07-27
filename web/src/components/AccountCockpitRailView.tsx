import type { KeyboardEvent } from 'react';
import {
  exactOrDash,
  privateReadErrorFact,
  projectPrivateRead,
  worstTone,
  type CoverageState,
  type PrivateReadSnapshot,
  type PrivateReadState,
  type PrivateReadTone,
  type ReconciliationState,
} from '../lib/privateRead';

/**
 * The account cockpit surface. It renders one shared read-only truth tape from
 * an already admitted private-read snapshot and consumes no store, transport,
 * effect, timer, or endpoint of its own: `projectPrivateRead` stays the single
 * projection owner, so this surface can only re-present proven facts.
 */

/** The transports the store owns, named exactly as it publishes them. */
export type PrivateReadSourceId = 'PENDING' | 'STATE' | 'FALLBACK';

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

const COVERAGE_TONE: Record<CoverageState, PrivateReadTone> = {
  COMPLETE_CURRENT: 'ok',
  PARTIAL_SYMBOL_SCOPED: 'warn',
  UNAVAILABLE: 'bad',
  NOT_CONFIGURED: 'idle',
};

const RECONCILIATION_TONE: Record<ReconciliationState, PrivateReadTone> = {
  RECONCILED: 'ok',
  PARTIAL: 'warn',
  UNAVAILABLE: 'bad',
  NOT_CONFIGURED: 'idle',
};

/**
 * Provenance, not health: naming the transport in use is never a claim that the
 * read succeeded, so only a degraded transport takes a tone of its own.
 */
const SOURCE_FACT: Record<PrivateReadSourceId, { detail: string; tone: PrivateReadTone }> = {
  PENDING: { detail: 'No private read has settled yet.', tone: 'idle' },
  STATE: { detail: 'Preferred compatibility state read.', tone: 'idle' },
  FALLBACK: { detail: 'Bounded fallback account read is active.', tone: 'warn' },
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
    ? { value: '0', status: 'EXACT_EMPTY', detail: 'EXACT_EMPTY · the read returned an exact empty array.', tone: 'ok' }
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
 * Every measurement is treated as untrusted: a non-finite one fails closed to no
 * movement, and the result is always clamped into the real scrollable range, so
 * the canvas can never be driven past its own content.
 */
export function accountCockpitScrollTarget({
  key,
  scrollLeft,
  clientWidth,
  scrollWidth,
}: AccountCockpitScrollMetrics): number | null {
  // Both measurements are needed to know the range; either one missing leaves
  // the canvas unmovable rather than guessing at a distance.
  const measured = Number.isFinite(clientWidth) && Number.isFinite(scrollWidth);
  const current = Number.isFinite(scrollLeft) ? scrollLeft : 0;
  // One step is one visible canvas, which is also the paging distance.
  const step = measured ? Math.max(0, clientWidth) : 0;
  const maximum = measured ? Math.max(0, scrollWidth - clientWidth) : 0;
  const target = key === 'ArrowRight' || key === 'PageDown'
    ? current + step
    : key === 'ArrowLeft' || key === 'PageUp'
      ? current - step
      : key === 'Home'
        ? 0
        : key === 'End'
          ? maximum
          : null;
  return target === null ? null : Math.min(maximum, Math.max(0, target));
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
  // An unrecognized key keeps its native behaviour, including page scrolling.
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
  const presentation = projectPrivateRead(snapshot);
  const errorFact = privateReadErrorFact(error);
  const sourceFact = SOURCE_FACT[source];
  const coverageTone = [snapshot.spot, snapshot.margin, snapshot.usdm]
    .map((product) => COVERAGE_TONE[product.coverage.state])
    .reduce(worstTone, 'ok' as PrivateReadTone);
  const reconciliationFacts = Object.values(snapshot.reconciliation);
  const reconciliationTone = reconciliationFacts
    .map((fact) => RECONCILIATION_TONE[fact.state])
    .reduce(worstTone, 'ok' as PrivateReadTone);
  const reconciliationReason = reconciliationFacts.find((fact) => fact.reason !== null)?.reason ?? null;
  const spotAvailableUsdt = presentation.spotAvailableUsdt;
  const orders = accountCockpitCountFact(presentation.counts.openOrders, presentation.state);
  const fills = accountCockpitCountFact(presentation.counts.fills, presentation.state);
  const positions = accountCockpitCountFact(presentation.counts.positions, presentation.state);
  const liabilities = accountCockpitCountFact(presentation.counts.liabilities, presentation.state);

  // A failed admission can only downgrade the rail. `guardTone` already carries
  // the freshness guard, so a denial or an unproven key lowers the overall
  // claim and nothing here can raise it back to a safe reading. An unreported
  // error contributes no downgrade, which is why the error guard is read here
  // and its neutral presentation tone is left to the admission fact.
  const railTone = [presentation.postureTone, errorFact.guardTone]
    .reduce(worstTone, presentation.guardTone);
  const statusLabel = errorFact.id === 'NONE'
    ? presentation.state
    : `${presentation.state} · ${errorFact.label}`;

  const facts: CockpitFact[] = [
    {
      id: 'private-read',
      label: 'Private Read',
      value: presentation.state,
      detail: STATE_DETAIL[presentation.state],
      tone: presentation.tone,
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
      detail: presentation.postureDetail,
      tone: presentation.postureTone,
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
      value: exactOrDash(spotAvailableUsdt),
      detail: spotAvailableUsdt === null
        ? `UNKNOWN · ${snapshot.spot.state} · no exact USDT free balance was admitted.`
        : `${snapshot.spot.state} · exact Spot free balance only.`,
      tone: spotAvailableUsdt === null
        ? snapshot.spot.state === 'NOT_CONFIGURED' ? 'idle' : 'warn'
        : 'ok',
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
      detail: liabilities.status === 'OBSERVED' || liabilities.status === 'EXACT_EMPTY'
        ? `${liabilities.status} · aggregate ${exactOrDash(presentation.marginLiabilityBtc)} BTC.`
        : liabilities.detail,
      tone: liabilities.tone,
    },
    {
      id: 'coverage',
      label: 'Coverage',
      value: presentation.coverageLabel,
      detail: 'Spot, Cross Margin, and USD-M read coverage.',
      tone: coverageTone,
    },
    {
      id: 'reconciliation',
      label: 'Reconciliation',
      value: presentation.reconciliationLabel,
      detail: reconciliationReason ?? 'Balances, orders, fills, positions, and liabilities.',
      tone: reconciliationTone,
    },
    {
      id: 'source',
      label: 'Source',
      value: source,
      detail: sourceFact.detail,
      tone: sourceFact.tone,
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
