// systemDashboard/fixtures/mutator.ts — fixture-mode control execution.
// Controls on the dashboard are typed against the real mutation API
// (SystemControlMutation → SystemControlReceipt) but in fixture mode they are
// applied here, in memory, and the receipt says so: code FIXTURE_APPLIED and
// ledgerEventId null, because nothing was ledgered.

import type {
  SystemControlMutation,
  SystemControlReceipt,
  SystemControlState,
  SystemSupervisorSnapshot,
} from '../../../lib/systemIntegration';

export interface FixtureMutationResult {
  snapshot: SystemSupervisorSnapshot;
  receipt: SystemControlReceipt;
}

export function applyFixtureMutation(
  snapshot: SystemSupervisorSnapshot,
  expectedRevision: number,
  mutation: SystemControlMutation,
  nowMs: number,
): FixtureMutationResult {
  const before: SystemControlState = { ...snapshot.control };

  if (expectedRevision !== snapshot.control.revision) {
    return {
      snapshot,
      receipt: { applied: false, code: 'FIXTURE_REVISION_CONFLICT', before, after: before, ledgerEventId: null },
    };
  }

  const after: SystemControlState = {
    ...before,
    revision: before.revision + 1,
    updatedAtMs: nowMs,
    correlationId: `ctl-fixture-${before.revision + 1}`,
  };

  let components = snapshot.components;
  switch (mutation.command) {
    case 'SET_SAFE_MODE':
      after.safeMode = mutation.safeMode;
      break;
    case 'SET_KILL_SWITCH':
      after.killSwitchEngaged = mutation.engaged;
      break;
    case 'SET_INTAKE_PAUSED':
      after.intakePaused = mutation.paused;
      break;
    case 'RESTART_COMPONENT': {
      const target = snapshot.components.find((c) => c.componentId === mutation.componentId);
      if (!target) {
        return {
          snapshot,
          receipt: { applied: false, code: 'FIXTURE_COMPONENT_NOT_PRESENT', before, after: before, ledgerEventId: null },
        };
      }
      components = snapshot.components.map((component) => (
        component.componentId === mutation.componentId
          ? {
            ...component,
            readiness: 'WARMING' as const,
            phase: 'RESTARTING',
            domainObservedState: 'RESTARTING',
            generation: component.generation + 1,
            restartCount: component.restartCount + 1,
            freshness: null,
            lastFailure: null,
            blockerCodes: [],
          }
          : component
      ));
      break;
    }
  }

  const next: SystemSupervisorSnapshot = {
    ...snapshot,
    revision: after.revision,
    evaluatedAtMs: nowMs,
    control: after,
    components,
  };

  return {
    snapshot: next,
    receipt: { applied: true, code: 'FIXTURE_APPLIED', before, after, ledgerEventId: null },
  };
}
