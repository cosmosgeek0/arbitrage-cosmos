/**
 * Basis engine — borrow preflight (ENGINE.md §11).
 * Reverse basis (short spot / long perp) requires borrowing the base asset.
 * Borrow state is injected data; with no keys it is 'unknown' and every
 * reverse-basis signal must terminate in a named reject — never a proposal.
 */
import { borrowCostPctOverHold } from './math.js';
import type { BasisConfig } from './config.js';
import type { BorrowInfo, BorrowVerdict } from './types.js';

export function preflightBorrow(
  needsBorrow: boolean,
  info: BorrowInfo | null,
  intendedNotionalUsd: number,
  refPriceUsd: number | null,
  holdMs: number,
  cfg: BasisConfig,
  nowTs?: number,
): BorrowVerdict {
  if (!needsBorrow) {
    return { status: 'not_needed', ok: true, rejectCode: null, human: 'no borrow needed', costPctOverHold: 0 };
  }

  if (!info || info.status === 'unknown') {
    return {
      status: 'unknown',
      ok: false,
      rejectCode: 'borrow_unknown',
      human: 'borrow status unknown (no margin keys/permissions) — reverse basis not executable',
      costPctOverHold: 0,
    };
  }

  const observedAt = nowTs ?? Date.now();
  const ageMs = observedAt - info.asOfTs;
  if (!Number.isFinite(info.asOfTs) || ageMs < -cfg.maxFutureSkewMs || ageMs > cfg.borrowStaleMs) {
    return {
      status: 'unknown',
      ok: false,
      rejectCode: 'borrow_unknown',
      human: `borrow state stale or invalid for ${info.asset}`,
      costPctOverHold: 0,
    };
  }

  if (info.status === 'unavailable') {
    return {
      status: 'unavailable',
      ok: false,
      rejectCode: 'borrow_unavailable',
      human: `borrow unavailable for ${info.asset}`,
      costPctOverHold: 0,
    };
  }

  // status === 'available' — every quantity needed to prove executability is mandatory.
  if (
    info.maxBorrowableBase === null ||
    !Number.isFinite(info.maxBorrowableBase) ||
    info.maxBorrowableBase < 0 ||
    refPriceUsd === null ||
    !Number.isFinite(refPriceUsd) ||
    refPriceUsd <= 0 ||
    !Number.isFinite(intendedNotionalUsd) ||
    intendedNotionalUsd <= 0
  ) {
    return {
      status: 'unknown',
      ok: false,
      rejectCode: 'borrow_unknown',
      human: `borrow capacity or reference price unknown for ${info.asset}`,
      costPctOverHold: 0,
    };
  }
  const neededBase = (intendedNotionalUsd / refPriceUsd) * cfg.borrowSafetyFactor;
  if (info.maxBorrowableBase < neededBase) {
    return {
      status: 'available',
      ok: false,
      rejectCode: 'borrow_too_small',
      human: `max borrowable ${info.maxBorrowableBase} ${info.asset} < needed ${neededBase.toFixed(8)} (incl. ${cfg.borrowSafetyFactor}× safety)`,
      costPctOverHold: 0,
    };
  }

  if (info.hourlyRatePct === null || !Number.isFinite(info.hourlyRatePct) || info.hourlyRatePct < 0) {
    return {
      status: 'unknown',
      ok: false,
      rejectCode: 'borrow_unknown',
      human: `borrow rate unknown for ${info.asset}`,
      costPctOverHold: 0,
    };
  }

  if (info.hourlyRatePct > cfg.maxBorrowHourlyRatePct) {
    return {
      status: 'available',
      ok: false,
      rejectCode: 'borrow_cost_too_high',
      human: `hourly borrow rate ${info.hourlyRatePct}% > max ${cfg.maxBorrowHourlyRatePct}%`,
      costPctOverHold: borrowCostPctOverHold(info.hourlyRatePct, holdMs),
    };
  }

  return {
    status: 'available',
    ok: true,
    rejectCode: null,
    human: `borrow available: ${info.asset} at ${info.hourlyRatePct}%/h`,
    costPctOverHold: borrowCostPctOverHold(info.hourlyRatePct, holdMs),
  };
}
