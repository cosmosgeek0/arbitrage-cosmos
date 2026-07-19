// PostureStrip — DASHBOARD_TRUTH item 1: whole-machine posture in one band.
// Overall state · mode · kill switch + intake · generations · first
// actionable blocker (root cause, not the cascade).

import React from 'react';
import type { SystemSupervisorSnapshot } from '../../../lib/systemIntegration';
import {
  EXPECTED_COMPONENTS,
  UNKNOWN_TEXT,
  ageText,
  exposureVerdict,
  isComponentCurrentReady,
  readinessTone,
  words,
} from '../lib/presentation';
import { TruthTag } from './bits';

export function PostureStrip({ snapshot, nowMs }: { snapshot: SystemSupervisorSnapshot; nowMs: number }) {
  const posture = snapshot.overallPosture;
  const control = snapshot.control;
  const rootBlocker = snapshot.firstRootBlockerComponentId
    ? snapshot.components.find((c) => c.componentId === snapshot.firstRootBlockerComponentId) ?? null
    : null;
  const rootCause = rootBlocker
    ? rootBlocker.lastFailure?.code ?? rootBlocker.blockerCodes[0] ?? UNKNOWN_TEXT
    : null;
  const ready = snapshot.components.filter(isComponentCurrentReady).length;

  return (
    <div className="sdx-summary" role="status" aria-label="Whole-machine posture">
      <div className="sdx-summary-cell">
        <span>Overall State</span>
        <strong className={readinessTone(posture)}>{words(posture)}</strong>
        <small>{ready}/{EXPECTED_COMPONENTS.length} Components Current-Ready · Phase {words(snapshot.phase)}</small>
      </div>
      <div className="sdx-summary-cell">
        <span>Mode</span>
        <strong>{control.safeMode}</strong>
        <small>Set {ageText(control.updatedAtMs, nowMs)} · Revision {control.revision}</small>
      </div>
      <div className="sdx-summary-cell">
        <span>Kill Switch</span>
        <strong className={control.killSwitchEngaged ? 'bad' : 'ok'}>
          {control.killSwitchEngaged ? 'Engaged' : 'Clear'}
        </strong>
        <small>Intake {control.intakePaused ? 'Paused' : 'Open'} · Control Gen {snapshot.controlGeneration}</small>
      </div>
      <div className="sdx-summary-cell">
        <span>Startup Generation</span>
        <strong>
          {snapshot.runtimeGeneration}
          <em>runtime</em>
        </strong>
        {/* Last-restart timestamp is not published by snapshot schema v1 —
            state the gap instead of inventing a time. */}
        <small>Snapshot {ageText(snapshot.evaluatedAtMs, nowMs)} · Last Restart {UNKNOWN_TEXT}</small>
      </div>
      <div className="sdx-summary-cell">
        <span>First Actionable Blocker</span>
        {rootBlocker ? (
          <>
            <strong className="bad">{words(rootBlocker.componentId)}</strong>
            <small>{rootCause}{rootBlocker.lastFailure ? ` · ${rootBlocker.lastFailure.message}` : ''}</small>
          </>
        ) : (
          <>
            <strong className="ok">None</strong>
            <small>No material root cause in the canonical graph</small>
          </>
        )}
      </div>
    </div>
  );
}

/** Exposure banner — item 6's priority law: when active exposure is nonzero
 *  it owns the top of the screen, directly under the posture band. */
export function ExposureBanner({ snapshot }: { snapshot: SystemSupervisorSnapshot }) {
  const capital = snapshot.summaries.capital;
  const exposure = exposureVerdict(
    capital.activeExposureCount,
    capital.activeExposureAmount,
  );
  if (exposure.kind === 'NONE') return null;
  return (
    <div className="sdx-exposure" role="alert">
      <strong>{exposure.kind === 'ACTIVE'
        ? `Capital Exposed · ${exposure.amount ?? UNKNOWN_TEXT}`
        : 'EXPOSURE UNKNOWN'}</strong>
      <span>
        {exposure.kind === 'ACTIVE'
          ? `${exposure.count ?? UNKNOWN_TEXT} active exposure${exposure.count === 1 ? '' : 's'}`
          : 'Canonical exposure count or amount is unavailable'} · Account truth {capital.accountTruthState}
        {snapshot.control.killSwitchEngaged ? ' · Kill switch engaged — exposure is NOT liquidated by the kill switch' : ''}
      </span>
      <TruthTag label={capital.truthLabel} />
    </div>
  );
}
