import type { Express, RequestHandler } from 'express';
import {
  deriveI00MeaningfulAdvanceEvidence,
  I00_HEALTH_SCHEMA,
  projectI00Health,
  type I00HealthKind,
} from '../application/health.js';
import type { SystemSupervisorReadModel } from '../supervisor/types.js';

export interface I00HealthRouteOptions {
  readonly readSupervisor: () => Readonly<SystemSupervisorReadModel>;
  readonly applicationStartOk: () => boolean;
  readonly applicationStartFailureCodes: () => readonly string[];
  readonly onSupervisorReadFailure: (error: unknown) => void;
  readonly nowMs: () => number;
}

function sendI00Health(
  kind: I00HealthKind,
  options: Readonly<I00HealthRouteOptions>,
): RequestHandler {
  return (_req, res): void => {
    if (kind === 'LIVE') {
      // Liveness is deliberately process-only. Reading the canonical
      // supervisor here made a watchdog probe execute every synchronous
      // persistence and owner-evidence read, so a slow Ledger could make the
      // healthy Node process appear dead and amplify the request backlog.
      res.status(200).json({
        schemaVersion: I00_HEALTH_SCHEMA,
        kind,
        ok: true,
        evaluatedAtMs: options.nowMs(),
        overallPosture: 'PROCESS_ALIVE',
        rootBlockerComponentId: null,
        reasonCodes: ['PROCESS_RESPONSIVE_LIVENESS_ONLY'],
        okSemantics: 'PROCESS_LIVENESS_ONLY',
        componentCount: 0,
        dependencyEdgeCount: 0,
        meaningfulAdvanceOwnerComponentId: null,
        lastMeaningfulAdvanceAtMs: null,
        meaningfulAdvanceAgeMs: null,
        executionBarrier: 'LIVE_EXECUTION_NOT_IMPLEMENTED',
      });
      return;
    }
    try {
      const supervisor = options.readSupervisor();
      const projection = projectI00Health(
        kind,
        supervisor,
        options.applicationStartOk(),
        deriveI00MeaningfulAdvanceEvidence(supervisor),
        options.applicationStartFailureCodes(),
      );
      res.status(projection.ok ? 200 : 503).json(projection);
    } catch (error) {
      options.onSupervisorReadFailure(error);
      res.status(503).json({
        schemaVersion: I00_HEALTH_SCHEMA,
        kind,
        ok: false,
        evaluatedAtMs: options.nowMs(),
        overallPosture: 'FAILED',
        rootBlockerComponentId: null,
        reasonCodes: ['SUPERVISOR_READ_UNAVAILABLE'],
        componentCount: 0,
        dependencyEdgeCount: 0,
        meaningfulAdvanceOwnerComponentId: null,
        lastMeaningfulAdvanceAtMs: null,
        meaningfulAdvanceAgeMs: null,
        executionBarrier: 'LIVE_EXECUTION_NOT_IMPLEMENTED',
      });
    }
  };
}

/**
 * Mounts the three unauthenticated deployment/watchdog probes. This adapter
 * owns only Express transport; projectI00Health remains the canonical health
 * owner and the response never carries the authenticated supervisor model.
 */
export function registerI00HealthRoutes(
  app: Express,
  options: Readonly<I00HealthRouteOptions>,
): void {
  app.get('/health/live', sendI00Health('LIVE', options));
  app.get('/health/ready', sendI00Health('READY', options));
  app.get('/health/trade-ready', sendI00Health('TRADE_READY', options));
}
