import { fixtureById } from '../systemDashboard/fixtures';
import type {
  AccountPnlInput,
  AccountPnlMirror,
  StrategyDashboardEvidenceState,
  SupervisorRuntimeInput,
} from './types';

export interface StrategyDashboardFixture {
  readonly runtime: Readonly<SupervisorRuntimeInput>;
  readonly pnl: Readonly<AccountPnlInput>;
}

function pnlMirror(state: StrategyDashboardEvidenceState): AccountPnlMirror {
  const partial = state === 'PARTIAL';
  const unknown = state === 'UNKNOWN';
  const rows = [
    { day: '2026-07-28', usd: 12.0049 },
    { day: '2026-07-01', usd: 74.4 },
    { day: '2026-07-25', usd: 0 },
    { day: '2026-07-09', usd: -31.16 },
    { day: '2026-07-02', usd: 18.27 },
    { day: '2026-07-17', usd: 5.8 },
    { day: '2026-07-05', usd: -4.2 },
    { day: '2026-07-10', usd: 0.0049 },
  ] as const;
  return {
    realizedByDay: rows,
    realizedBySymbol: [
      { symbol: 'BTCUSDT', usd: 43.24 },
      { symbol: 'ETHUSDT', usd: 18.27 },
    ],
    feesByAsset: [{ asset: 'USDT', amount: 8.91 }],
    equitySnapshots: [
      { ts: 1_774_394_400_000, totalUsdt: 10_060.51 },
    ],
    integrity: {
      state: unknown ? 'UNKNOWN' : partial ? 'PARTIAL' : 'COMPLETE',
      complete: !unknown && !partial,
      reasons: unknown
        ? ['SYNTHETIC_INTEGRITY_UNKNOWN']
        : partial
          ? ['SYNTHETIC_FEE_VALUATION_PARTIAL']
          : [],
      days: rows.map((row) => ({
        day: row.day,
        complete: !unknown && !partial,
        reasons: partial ? ['SYNTHETIC_FEE_VALUATION_PARTIAL'] : [],
        feeUsd: row.day === '2026-07-25' ? 0 : 2.97,
        netUsd: row.usd - (row.day === '2026-07-25' ? 0 : 2.97),
      })),
    },
  };
}

export function buildStrategyDashboardFixture(
  nowMs: number,
  state: StrategyDashboardEvidenceState = 'CURRENT',
): StrategyDashboardFixture {
  const unavailable = state === 'UNAVAILABLE'
    || state === 'NOT_CONFIGURED'
    || state === 'MISSING';
  const snapshotFixture = state === 'STALE' ? 'stale'
    : state === 'PARTIAL' ? 'degraded'
      : state === 'UNKNOWN' || unavailable ? 'unavailable'
        : 'healthy';
  const observedAtMs = state === 'STALE' ? nowMs - 121_000 : nowMs - 4_000;
  const sourceState = state === 'STALE' ? 'CURRENT' : state;
  const snapshot = unavailable ? null : fixtureById(snapshotFixture).build(nowMs);
  const strategySnapshot = snapshot
    ? {
      ...snapshot,
      components: snapshot.components.map((component) => {
        if ((component.componentId !== 'basis-engine'
          && component.componentId !== 'volume-engine')
          || !component.freshness
          || !component.sourceTimestamp) {
          return component;
        }
        const basisTime = component.sourceTimestamp.sourceTimeMs
          ?? component.sourceTimestamp.receivedAtMs;
        return {
          ...component,
          freshness: {
            ...component.freshness,
            ageMs: component.freshness.evaluatedAt - basisTime,
          },
        };
      }),
      recentCorrelatedDecisions: [],
    }
    : null;
  return {
    runtime: {
      snapshot: strategySnapshot,
      state: sourceState,
      source: 'SYNTHETIC_ONLY',
      observedAtMs: unavailable ? null : observedAtMs,
      maxAgeMs: unavailable ? null : 60_000,
      reasonCodes: unavailable ? ['SYNTHETIC_SUPERVISOR_UNAVAILABLE'] : [],
    },
    pnl: {
      mirror: unavailable ? null : pnlMirror(state),
      state: sourceState,
      source: 'SYNTHETIC_ONLY',
      observedAtMs: unavailable ? null : observedAtMs,
      maxAgeMs: unavailable ? null : 60_000,
      reasonCodes: unavailable ? ['SYNTHETIC_PNL_UNAVAILABLE'] : [],
    },
  };
}
