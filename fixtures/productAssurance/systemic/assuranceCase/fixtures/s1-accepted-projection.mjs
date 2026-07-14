import {
  ACCEPTED_S1_ASSUMPTION_IDS,
  ACCEPTED_S1_ASSUMPTION_OWNERS,
  ACCEPTED_S1_SOURCE,
  S1_ASSUMPTION_PROJECTION_VERSION,
  deepFreeze,
} from '../contracts/index.mjs';

export const FIXTURE_NOW_MS = 1_800_000_000_000;

const buildResult = (assumptionId, evaluatedAtMs, override = {}) => ({
  assumptionId,
  sourceOwnerId: ACCEPTED_S1_ASSUMPTION_OWNERS[assumptionId],
  result: 'PASS',
  reasonCode: 'VALIDATED',
  freshnessStatus: 'CURRENT',
  evaluatedAtMs,
  staleAtMs: evaluatedAtMs + 9_000,
  ...override,
});

/**
 * Packet-local adapter fixture over the accepted S1 output contract.
 * It is not a second assumption registry and has no owner or authority effect.
 */
export function buildS1AssumptionProjection({ evaluatedAtMs = FIXTURE_NOW_MS, overrides = {} } = {}) {
  return deepFreeze({
    schemaVersion: S1_ASSUMPTION_PROJECTION_VERSION,
    truthLabel: 'SYNTHETIC_ONLY',
    authorityEffect: 'NONE',
    evaluatedAtMs,
    provenance: ACCEPTED_S1_SOURCE,
    assumptionResults: ACCEPTED_S1_ASSUMPTION_IDS.map((assumptionId) => (
      buildResult(assumptionId, evaluatedAtMs, overrides[assumptionId])
    )),
  });
}

export const ACCEPTED_S1_ASSUMPTION_PROJECTION_FIXTURE = buildS1AssumptionProjection();
