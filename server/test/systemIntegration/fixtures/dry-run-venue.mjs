import { cloneFrozenJson } from './values.mjs';

const ALLOWED_REQUEST_MODES = new Set(['VALIDATE_ONLY', 'PAPER']);

function positiveSafeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`${label} must be a positive safe integer`);
  return value;
}

function portFailure(code, retryable = false) {
  if (typeof code !== 'string' || !/^[A-Z][A-Z0-9_]{0,99}$/.test(code)) {
    throw new TypeError('dry-run port failure code is invalid');
  }
  return Object.freeze({
    code,
    message: `Deterministic dry-run outcome ${code}.`,
    retryable,
    recommendedOperatorAction: 'Inspect deterministic system-integration evidence.',
  });
}

function validVerdict(verdict) {
  return verdict !== null
    && typeof verdict === 'object'
    && typeof verdict.allowed === 'boolean'
    && Number.isSafeInteger(verdict.evaluatedAt)
    && Number.isSafeInteger(verdict.expiresAt);
}

/**
 * Sealed fake implementation of Foundation ExecutionCoordinatorPorts.
 * It exposes only dry-run/PAPER vocabulary and never owns a transport, key,
 * endpoint, signer, or live/test-order method.
 */
export class SealedDryRunVenueJournal {
  #clock;
  #maximumCalls;
  #maximumQueuedOutcomes;
  #requireRiskAuthorization;
  #calls = [];
  #identityClaims = new Map();
  #riskAuthorization = null;
  #preflightResult = Object.freeze({ ok: true });
  #validationResults = new Map();
  #submissions = new Map();
  #lookups = new Map();
  #reconciliations = [];

  constructor(clock, options = {}) {
    if (typeof clock?.nowMs !== 'function' || !Number.isSafeInteger(clock.nowMs())) {
      throw new TypeError('SealedDryRunVenueJournal requires an injected clock');
    }
    this.#clock = clock;
    this.#maximumCalls = positiveSafeInteger(options.maximumCalls ?? 512, 'maximumCalls');
    this.#maximumQueuedOutcomes = positiveSafeInteger(
      options.maximumQueuedOutcomes ?? 128,
      'maximumQueuedOutcomes',
    );
    this.#requireRiskAuthorization = options.requireRiskAuthorization ?? true;
    if (typeof this.#requireRiskAuthorization !== 'boolean') {
      throw new TypeError('requireRiskAuthorization must be a boolean');
    }
    Object.seal(this);
  }

  #record(operation, payload = null) {
    if (this.#calls.length >= this.#maximumCalls) throw new RangeError('dry-run venue call capacity exceeded');
    const entry = Object.freeze({
      sequence: this.#calls.length + 1,
      occurredAtMs: this.#clock.nowMs(),
      operation,
      dryRun: true,
      executionAuthority: 'NONE',
      payload: payload === null ? null : cloneFrozenJson(payload, { maximumBytes: 128 * 1024 }),
    });
    this.#calls.push(entry);
    return entry;
  }

  #key(request) {
    return `${request.phase}:${request.leg.key}`;
  }

  #assertDryRunRequest(request) {
    if (request === null || typeof request !== 'object') throw new TypeError('dry-run venue request is required');
    if (!ALLOWED_REQUEST_MODES.has(request.mode)) throw new Error('LIVE_EXECUTION_NOT_IMPLEMENTED');
    if (request.mode === 'VALIDATE_ONLY' && request.leg?.riskEffect === 'RISK_INCREASING') {
      // Validation is allowed; submission remains blocked separately below.
      return;
    }
  }

  claimPlanIdentity(planId, termsFingerprint) {
    if (typeof planId !== 'string' || planId.length === 0 || typeof termsFingerprint !== 'string') {
      throw new TypeError('dry-run plan identity is invalid');
    }
    this.#record('claimPlanIdentity', { planId, termsFingerprint });
    const prior = this.#identityClaims.get(planId);
    if (prior === undefined) {
      this.#identityClaims.set(planId, termsFingerprint);
      return 'CLAIMED';
    }
    return prior === termsFingerprint ? 'EXISTING_SAME' : 'CONFLICT';
  }

  authorizeRisk(planId, verdict) {
    if (typeof planId !== 'string' || planId.length === 0) throw new TypeError('risk authorization planId is required');
    if (!validVerdict(verdict)) throw new TypeError('risk authorization verdict is invalid');
    this.#riskAuthorization = Object.freeze({ planId, verdict: cloneFrozenJson(verdict) });
    return this;
  }

  setPreflightResult(result) {
    this.#preflightResult = cloneFrozenJson(result);
    return this;
  }

  setValidationResult(key, result) {
    if (typeof key !== 'string' || key.length === 0) throw new TypeError('validation key is required');
    if (!this.#validationResults.has(key) && this.#validationResults.size >= this.#maximumQueuedOutcomes) {
      throw new RangeError('dry-run validation configuration capacity exceeded');
    }
    this.#validationResults.set(key, cloneFrozenJson(result));
    return this;
  }

  queueSubmission(key, ...outcomes) {
    this.#queue(this.#submissions, key, outcomes);
    return this;
  }

  queueLookup(key, ...outcomes) {
    this.#queue(this.#lookups, key, outcomes);
    return this;
  }

  queueReconciliation(...outcomes) {
    if (outcomes.length < 1) throw new TypeError('at least one reconciliation outcome is required');
    if (this.#queuedOutcomeCount() + outcomes.length > this.#maximumQueuedOutcomes) {
      throw new RangeError('dry-run reconciliation queue capacity exceeded');
    }
    this.#reconciliations.push(...outcomes.map((outcome) => cloneFrozenJson(outcome)));
    return this;
  }

  #queue(target, key, outcomes) {
    if (typeof key !== 'string' || key.length === 0) throw new TypeError('dry-run queue key is required');
    if (outcomes.length < 1) throw new TypeError('at least one dry-run outcome is required');
    const current = target.get(key) ?? [];
    if (this.#queuedOutcomeCount() + outcomes.length > this.#maximumQueuedOutcomes) {
      throw new RangeError('dry-run outcome queue capacity exceeded');
    }
    current.push(...outcomes.map((outcome) => outcome === 'THROW' ? outcome : cloneFrozenJson(outcome)));
    target.set(key, current);
  }

  #queuedOutcomeCount() {
    let count = this.#reconciliations.length;
    for (const queue of this.#submissions.values()) count += queue.length;
    for (const queue of this.#lookups.values()) count += queue.length;
    return count;
  }

  async preflight(plan) {
    if (plan === null || typeof plan !== 'object' || !ALLOWED_REQUEST_MODES.has(plan.mode)) {
      throw new Error('LIVE_EXECUTION_NOT_IMPLEMENTED');
    }
    this.#record('preflight', { mode: plan.mode, planId: plan.planId });
    if (!this.#requireRiskAuthorization) return this.#preflightResult;
    const authorization = this.#riskAuthorization;
    if (authorization === null) return Object.freeze({ ok: false, failure: portFailure('RISK_VERDICT_MISSING') });
    if (authorization.planId !== plan.planId) {
      return Object.freeze({ ok: false, failure: portFailure('RISK_VERDICT_PLAN_MISMATCH') });
    }
    if (this.#clock.nowMs() >= authorization.verdict.expiresAt) {
      return Object.freeze({ ok: false, failure: portFailure('RISK_VERDICT_EXPIRED') });
    }
    if (!authorization.verdict.allowed) return Object.freeze({ ok: false, failure: portFailure('RISK_REJECTED') });
    return this.#preflightResult;
  }

  async validateLeg(request) {
    this.#assertDryRunRequest(request);
    this.#record('validateLeg', request);
    return this.#validationResults.get(this.#key(request)) ?? Object.freeze({ ok: true });
  }

  async submitPaper(request) {
    this.#assertDryRunRequest(request);
    if (request.mode !== 'PAPER') throw new Error('VALIDATE_ONLY_SUBMISSION_BLOCKED');
    this.#record('submitPaper', request);
    const queue = this.#submissions.get(this.#key(request));
    const next = queue?.shift();
    if (next === 'THROW') throw new Error('SYNTHETIC_DRY_RUN_RESPONSE_LOSS');
    if (next !== undefined) return next;
    return Object.freeze({
      kind: 'FILLED',
      venueOrderId: `dry-run-${request.phase.toLowerCase()}-${request.leg.key.toLowerCase()}`,
      cumulativeFilledQuantity: request.leg.quantity,
    });
  }

  async lookupByClientOrderId(request) {
    this.#assertDryRunRequest(request);
    this.#record('lookupByClientOrderId', request);
    const queue = this.#lookups.get(this.#key(request));
    const next = queue?.shift();
    if (next === 'THROW') throw new Error('SYNTHETIC_DRY_RUN_LOOKUP_LOSS');
    return next ?? Object.freeze({ kind: 'UNRESOLVED', failure: portFailure('LOOKUP_UNRESOLVED', true) });
  }

  async reconcile(state) {
    if (state === null || typeof state !== 'object') throw new TypeError('dry-run reconciliation state is required');
    this.#record('reconcile', { lifecycle: state.lifecycle, planId: state.plan?.planId ?? null });
    if (this.#reconciliations.length > 0) return this.#reconciliations.shift();
    const spot = Math.max(
      0,
      state.openingLegs.SPOT.cumulativeFilledQuantity - state.closingLegs.SPOT.cumulativeFilledQuantity,
    );
    const perp = Math.max(
      0,
      state.openingLegs.PERP.cumulativeFilledQuantity - state.closingLegs.PERP.cumulativeFilledQuantity,
    );
    if (spot === 0 && perp === 0) return Object.freeze({ kind: 'CLOSED' });
    const spotRatio = spot / state.openingLegs.SPOT.definition.quantity;
    const perpRatio = perp / state.openingLegs.PERP.definition.quantity;
    return Math.abs(spotRatio - perpRatio) < 1e-12
      ? Object.freeze({ kind: 'HEDGED_OPEN' })
      : Object.freeze({ kind: 'ONE_LEG_EXPOSED' });
  }

  get calls() {
    return Object.freeze([...this.#calls]);
  }

  callsFor(operation) {
    return Object.freeze(this.#calls.filter((entry) => entry.operation === operation));
  }

  snapshot() {
    return Object.freeze({
      callCount: this.#calls.length,
      calls: this.calls,
      executionAuthority: 'NONE',
      sealed: Object.isSealed(this),
      truthLabels: Object.freeze(['DRY_RUN', 'SYNTHETIC_ONLY']),
    });
  }
}
