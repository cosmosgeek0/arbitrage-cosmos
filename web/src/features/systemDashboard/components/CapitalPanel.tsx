// CapitalPanel — DASHBOARD_TRUTH item 6: allocatable truth, reservations,
// staged mandates, active exposure. Approval expiry is not in schema v1 and
// is rendered as a stated gap.

import React from 'react';
import type { SystemSupervisorSnapshot } from '../../../lib/systemIntegration';
import { amountText, countText, exposureVerdict, textOrUnknown } from '../lib/presentation';
import { Band, FactRow, NotPublished, TruthTag, Val } from './bits';

export function CapitalPanel({ snapshot }: { snapshot: SystemSupervisorSnapshot }) {
  const capital = snapshot.summaries.capital;
  const exposure = exposureVerdict(
    capital.activeExposureCount,
    capital.activeExposureAmount,
  );

  return (
    <section className="sdx-section" aria-label="Capital and exposure">
      <Band
        title="Capital & Exposure"
        meta={<>
          <span>Account truth <code>{textOrUnknown(capital.accountTruthState)}</code></span>
          <TruthTag label={capital.truthLabel} />
        </>}
      />
      <div className="sdx-stats">
        <div className="sdx-stat"><span>Allocatable</span><b className={capital.allocatableAmount === null ? 'unk' : ''}>{amountText(capital.allocatableAmount)}</b></div>
        <div className="sdx-stat"><span>Reserved</span><b className={capital.reservedAmount === null ? 'unk' : ''}>{amountText(capital.reservedAmount)}</b></div>
        <div className="sdx-stat"><span>Active Exposure</span><b className={exposure.amount === null ? 'unk' : exposure.kind === 'ACTIVE' ? 'bad' : ''}>{amountText(exposure.amount)}</b></div>
        <div className="sdx-stat"><span>Eligible</span><b className={capital.eligibleCount === null ? 'unk' : ''}>{countText(capital.eligibleCount)}</b></div>
      </div>
      <div className="sdx-rows">
        <FactRow
          label="Reservations"
          sub="Capital currently reserved against staged intents"
          end={<Val text={countText(capital.reservationCount)} />}
        />
        <FactRow
          label="Staged Mandates"
          sub="Mandates staged but not yet reserved"
          end={<Val text={countText(capital.stagedMandateCount)} />}
        />
        <FactRow
          label="Active Exposure Positions"
          sub={exposure.kind === 'ACTIVE'
            ? 'Open exposure — highest attention priority on this screen'
            : exposure.kind === 'NONE'
              ? 'No open exposure'
              : 'EXPOSURE UNKNOWN — canonical count or amount is unavailable'}
          end={<Val text={countText(exposure.count)} tone={exposure.kind === 'ACTIVE' ? 'bad' : undefined} />}
        />
        <FactRow
          label="Checkpoint Revision"
          sub="Capital owner checkpoint the truth state was read from"
          end={<Val text={textOrUnknown(capital.checkpointRevision)} />}
        />
        {capital.blockerCodes.length > 0 && (
          <FactRow
            label="Capital Blockers"
            sub="Owner-reported blocker codes, verbatim"
            end={<span className="sdx-row-end">{capital.blockerCodes.map((code) => <span key={code} className="sdx-reason">{code}</span>)}</span>}
          />
        )}
      </div>
      <NotPublished>Approval states with expiry — schema v1 publishes reservation and mandate counts only.</NotPublished>
    </section>
  );
}
