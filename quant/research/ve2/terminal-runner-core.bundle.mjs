// server/src/engine/volume/forwardMeasurementRunner.ts
import { createHash } from "node:crypto";

// server/src/foundation/contracts/authority.ts
var AUTHORITY_STRENGTH = Object.freeze({
  LIVE_PRIVATE: 5,
  LIVE_PUBLIC: 4,
  DERIVED_LIVE: 3,
  RECORDED_REPLAY: 2,
  SYNTHETIC_TEST: 1,
  UNAVAILABLE: 0
});

// server/src/foundation/contracts/identity.ts
function canonicalJson(value) {
  return encodeCanonical(value, /* @__PURE__ */ new Set(), "$");
}
function encodeCanonical(value, seen, path) {
  if (value === null) return "null";
  const t = typeof value;
  if (t === "boolean") return value ? "true" : "false";
  if (t === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError(`canonicalJson: non-finite number at ${path}`);
    }
    return JSON.stringify(value);
  }
  if (t === "string") return JSON.stringify(value);
  if (t === "undefined" || t === "function" || t === "symbol" || t === "bigint") {
    throw new TypeError(`canonicalJson: unserializable ${t} at ${path}`);
  }
  const obj = value;
  if (seen.has(obj)) {
    throw new TypeError(`canonicalJson: cyclic structure at ${path}`);
  }
  if (Array.isArray(obj)) {
    seen.add(obj);
    const parts2 = obj.map((item, i) => encodeCanonical(item, seen, `${path}[${i}]`));
    seen.delete(obj);
    return `[${parts2.join(",")}]`;
  }
  const proto = Object.getPrototypeOf(obj);
  if (proto !== Object.prototype && proto !== null) {
    throw new TypeError(`canonicalJson: non-plain object at ${path}`);
  }
  seen.add(obj);
  const keys = Object.keys(obj).sort();
  const parts = [];
  for (const key of keys) {
    const v = obj[key];
    if (v === void 0) {
      throw new TypeError(`canonicalJson: undefined value at ${path}.${key}`);
    }
    parts.push(`${JSON.stringify(key)}:${encodeCanonical(v, seen, `${path}.${key}`)}`);
  }
  seen.delete(obj);
  return `{${parts.join(",")}}`;
}
var FNV_OFFSET = 0xcbf29ce484222325n;
var FNV_PRIME = 0x100000001b3n;
var MASK_64 = 0xffffffffffffffffn;
function fnv1a64(input) {
  let hash = FNV_OFFSET;
  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i);
    hash = (hash ^ BigInt(code & 255)) * FNV_PRIME & MASK_64;
    hash = (hash ^ BigInt(code >>> 8)) * FNV_PRIME & MASK_64;
  }
  return hash;
}
function stableHash64Hex(input) {
  if (typeof input !== "string") throw new TypeError("stableHash64Hex: input must be a string");
  return fnv1a64(input).toString(16).padStart(16, "0");
}
function stableHash128Hex(input) {
  if (typeof input !== "string") throw new TypeError("stableHash128Hex: input must be a string");
  return stableHash64Hex(input) + stableHash64Hex(`${input}`);
}

// server/src/foundation/contracts/runtime.ts
var RUNTIME_PHASE_TRANSITIONS = Object.freeze({
  STOPPED: Object.freeze(["VALIDATING", "STARTING"]),
  VALIDATING: Object.freeze(["STOPPED", "STARTING", "BLOCKED", "FAILED"]),
  STARTING: Object.freeze(["RUNNING", "DEGRADED", "BLOCKED", "FAILED", "STOPPING"]),
  RUNNING: Object.freeze(["DEGRADED", "PAUSING", "STOPPING", "BLOCKED", "FAILED"]),
  DEGRADED: Object.freeze(["RUNNING", "PAUSING", "STOPPING", "BLOCKED", "FAILED"]),
  PAUSING: Object.freeze(["PAUSED", "STOPPING", "FAILED"]),
  PAUSED: Object.freeze(["RUNNING", "DEGRADED", "STOPPING", "FAILED"]),
  STOPPING: Object.freeze(["STOPPED", "FAILED"]),
  BLOCKED: Object.freeze(["VALIDATING", "STOPPING", "STOPPED", "FAILED"]),
  FAILED: Object.freeze(["VALIDATING", "STOPPING", "STOPPED"])
});

// server/src/foundation/contracts/opportunity.ts
var LIFECYCLE_ORDER = Object.freeze({
  OPEN: 0,
  EXPIRED: 1,
  REJECTED: 2,
  CLOSED: 3,
  UNKNOWN: 4
});

// server/src/foundation/contracts/execution.ts
var PLAN_LIFECYCLE_TRANSITIONS = Object.freeze({
  CREATED: Object.freeze(["AWAITING_APPROVAL", "PREFLIGHTING", "CANCELLED", "EXPIRED"]),
  AWAITING_APPROVAL: Object.freeze(["PREFLIGHTING", "CANCELLED", "EXPIRED"]),
  PREFLIGHTING: Object.freeze(["READY", "FAILED", "CANCELLED", "EXPIRED"]),
  READY: Object.freeze(["OPENING", "CANCELLED", "EXPIRED"]),
  OPENING: Object.freeze(["ONE_LEG_EXPOSED", "HEDGED_OPEN", "RECONCILING", "RECOVERY_REQUIRED", "FAILED", "CANCELLED"]),
  ONE_LEG_EXPOSED: Object.freeze(["HEDGED_OPEN", "CLOSE_REQUESTED", "CLOSING", "RECONCILING", "RECOVERY_REQUIRED", "FAILED"]),
  HEDGED_OPEN: Object.freeze(["CLOSE_REQUESTED", "RECONCILING", "RECOVERY_REQUIRED", "FAILED"]),
  CLOSE_REQUESTED: Object.freeze(["CLOSING", "RECONCILING", "RECOVERY_REQUIRED", "FAILED"]),
  CLOSING: Object.freeze(["RECONCILING", "CLOSED", "ONE_LEG_EXPOSED", "RECOVERY_REQUIRED", "FAILED"]),
  RECONCILING: Object.freeze(["CLOSED", "HEDGED_OPEN", "ONE_LEG_EXPOSED", "RECOVERY_REQUIRED", "FAILED"]),
  RECOVERY_REQUIRED: Object.freeze(["RECONCILING", "CLOSING", "FAILED"]),
  CLOSED: Object.freeze([]),
  FAILED: Object.freeze([]),
  CANCELLED: Object.freeze([]),
  EXPIRED: Object.freeze([])
});
var LEG_LIFECYCLE_TRANSITIONS = Object.freeze({
  PLANNED: Object.freeze(["VALIDATED", "CANCELLED", "REJECTED"]),
  VALIDATED: Object.freeze(["SUBMITTING", "CANCELLED"]),
  SUBMITTING: Object.freeze(["ACKNOWLEDGED", "PARTIALLY_FILLED", "FILLED", "REJECTED", "AMBIGUOUS"]),
  ACKNOWLEDGED: Object.freeze(["PARTIALLY_FILLED", "FILLED", "CANCEL_PENDING", "CANCELLED", "AMBIGUOUS"]),
  PARTIALLY_FILLED: Object.freeze(["FILLED", "CANCEL_PENDING", "CANCELLED", "AMBIGUOUS"]),
  CANCEL_PENDING: Object.freeze(["CANCELLED", "FILLED", "AMBIGUOUS"]),
  AMBIGUOUS: Object.freeze(["ACKNOWLEDGED", "PARTIALLY_FILLED", "FILLED", "CANCELLED", "REJECTED"]),
  FILLED: Object.freeze([]),
  CANCELLED: Object.freeze([]),
  REJECTED: Object.freeze([])
});

// server/src/foundation/contracts/reconciliation.ts
var RECONCILIATION_STATUS_SEVERITY = Object.freeze({
  EXACT: 0,
  PENDING: 1,
  PARTIAL: 2,
  STALE: 3,
  UNAVAILABLE: 4,
  AMBIGUOUS: 5,
  DIVERGED: 6
});

// server/src/capitalFoundation/contracts/decimal.ts
var MAX_EXACT_DECIMAL_DIGITS = 96;
var MAX_DIVISION_SCALE = 24;
var MAX_INTERNAL_POWER = MAX_EXACT_DECIMAL_DIGITS + MAX_DIVISION_SCALE;
var DECIMAL_PATTERN = /^([+-]?)(\d+)(?:\.(\d+))?$/;
function normalizeExactDecimal(input) {
  if (typeof input !== "string" || input.length === 0 || input.trim() !== input) {
    throw new TypeError("exact decimal must be a non-empty, unpadded string");
  }
  const match = DECIMAL_PATTERN.exec(input);
  if (match === null) {
    throw new TypeError("exact decimal must use plain base-10 notation without exponent syntax");
  }
  const digitCount = match[2].length + (match[3]?.length ?? 0);
  if (digitCount > MAX_EXACT_DECIMAL_DIGITS) {
    throw new RangeError(`exact decimal exceeds ${MAX_EXACT_DECIMAL_DIGITS} digits`);
  }
  const whole = match[2].replace(/^0+(?=\d)/, "");
  const fraction = (match[3] ?? "").replace(/0+$/, "");
  const unsigned = fraction.length > 0 ? `${whole}.${fraction}` : whole;
  if (/^0(?:\.0*)?$/.test(unsigned)) return "0";
  return `${match[1] === "-" ? "-" : ""}${unsigned}`;
}
function normalizeNonNegativeExactDecimal(input) {
  const normalized = normalizeExactDecimal(input);
  if (normalized.startsWith("-")) throw new RangeError("exact decimal must be non-negative");
  return normalized;
}

// server/src/capitalFoundation/contracts/identity.ts
var CAPITAL_ID_PREFIXES = Object.freeze({
  opportunityConsideration: "cop",
  capitalMandate: "cmdt",
  allocationDecision: "calloc",
  capitalReservation: "cres",
  stagedPlan: "cstage",
  operatorApproval: "cappr",
  positionThesis: "cthesis",
  activePosition: "cpos",
  actionIntent: "cintent",
  executionCorrelationReference: "cexec",
  reconciliationReference: "crecon",
  checkpoint: "cchk",
  event: "cevt"
});

// server/src/capitalFoundation/contracts/truth.ts
var CAPITAL_TRUTH_STATES = Object.freeze([
  "COMPLETE",
  "PARTIAL",
  "STALE",
  "UNKNOWN",
  "DIVERGENT"
]);

// server/src/capitalFoundation/contracts/lifecycle.ts
var CAPITAL_LIFECYCLE_STATES = Object.freeze([
  "OBSERVED",
  "ELIGIBLE",
  "BLOCKED",
  "ADVISORY",
  "RESERVED",
  "PLANNED",
  "AWAITING_APPROVAL",
  "AWAITING_RISK",
  "READY_FOR_EXECUTION",
  "ENTERING",
  "PARTIALLY_EXPOSED",
  "HEDGED",
  "ACTIVE",
  "REDUCING",
  "EXITING",
  "RECOVERY_REQUIRED",
  "CLOSED",
  "CANCELLED",
  "EXPIRED",
  "UNKNOWN"
]);
var TERMINAL_CAPITAL_LIFECYCLE_STATES = Object.freeze(["CLOSED", "CANCELLED", "EXPIRED"]);
var CAPITAL_LIFECYCLE_TRANSITIONS = Object.freeze({
  OBSERVED: Object.freeze(["ELIGIBLE", "BLOCKED", "ADVISORY", "CANCELLED", "EXPIRED", "UNKNOWN"]),
  ELIGIBLE: Object.freeze(["RESERVED", "BLOCKED", "ADVISORY", "CANCELLED", "EXPIRED", "UNKNOWN"]),
  BLOCKED: Object.freeze(["OBSERVED", "ELIGIBLE", "ADVISORY", "CANCELLED", "EXPIRED", "UNKNOWN"]),
  ADVISORY: Object.freeze(["OBSERVED", "ELIGIBLE", "BLOCKED", "CANCELLED", "EXPIRED", "UNKNOWN"]),
  RESERVED: Object.freeze(["PLANNED", "BLOCKED", "CANCELLED", "EXPIRED", "UNKNOWN"]),
  PLANNED: Object.freeze(["AWAITING_APPROVAL", "BLOCKED", "CANCELLED", "EXPIRED", "UNKNOWN"]),
  AWAITING_APPROVAL: Object.freeze(["AWAITING_RISK", "BLOCKED", "CANCELLED", "EXPIRED", "UNKNOWN"]),
  AWAITING_RISK: Object.freeze(["READY_FOR_EXECUTION", "BLOCKED", "CANCELLED", "EXPIRED", "UNKNOWN"]),
  READY_FOR_EXECUTION: Object.freeze(["ENTERING", "BLOCKED", "CANCELLED", "EXPIRED", "UNKNOWN"]),
  ENTERING: Object.freeze(["PARTIALLY_EXPOSED", "HEDGED", "ACTIVE", "RECOVERY_REQUIRED", "UNKNOWN"]),
  PARTIALLY_EXPOSED: Object.freeze(["HEDGED", "ACTIVE", "REDUCING", "EXITING", "RECOVERY_REQUIRED", "UNKNOWN"]),
  HEDGED: Object.freeze(["ACTIVE", "REDUCING", "EXITING", "RECOVERY_REQUIRED", "UNKNOWN"]),
  ACTIVE: Object.freeze(["REDUCING", "EXITING", "RECOVERY_REQUIRED", "UNKNOWN"]),
  REDUCING: Object.freeze(["ACTIVE", "HEDGED", "EXITING", "RECOVERY_REQUIRED", "CLOSED", "UNKNOWN"]),
  EXITING: Object.freeze(["CLOSED", "RECOVERY_REQUIRED", "UNKNOWN"]),
  RECOVERY_REQUIRED: Object.freeze(["REDUCING", "EXITING", "CLOSED", "UNKNOWN"]),
  CLOSED: Object.freeze([]),
  CANCELLED: Object.freeze([]),
  EXPIRED: Object.freeze([]),
  UNKNOWN: Object.freeze(["OBSERVED", "BLOCKED", "PARTIALLY_EXPOSED", "RECOVERY_REQUIRED", "CANCELLED", "EXPIRED"])
});
var CAPITAL_STAGES = Object.freeze(["OBSERVE", "PROBE", "CONFIRM", "ADD", "HOLD", "REDUCE", "EXIT"]);
var CAPITAL_STAGE_TRANSITIONS = Object.freeze({
  OBSERVE: Object.freeze(["PROBE", "CONFIRM", "HOLD", "EXIT"]),
  PROBE: Object.freeze(["CONFIRM", "HOLD", "REDUCE", "EXIT"]),
  CONFIRM: Object.freeze(["ADD", "HOLD", "REDUCE", "EXIT"]),
  ADD: Object.freeze(["HOLD", "REDUCE", "EXIT"]),
  HOLD: Object.freeze(["ADD", "REDUCE", "EXIT"]),
  REDUCE: Object.freeze(["HOLD", "REDUCE", "EXIT"]),
  EXIT: Object.freeze([])
});

// server/src/capitalFoundation/contracts/economics.ts
var ECONOMIC_COMPONENT_STATUSES = Object.freeze([
  "KNOWN",
  "ESTIMATED",
  "MISSING",
  "NOT_APPLICABLE"
]);
var ECONOMIC_COMPONENT_KINDS = Object.freeze([
  "MARK_TO_MARKET_LEG_PNL",
  "REALIZED_LEG_PNL",
  "BASIS_CONVERGENCE_DIVERGENCE",
  "DIRECTIONAL_CONTRIBUTION",
  "FUNDING",
  "BORROW_INTEREST_AND_FEES",
  "TRADING_COMMISSIONS",
  "ENTRY_SPREAD_COST",
  "EXIT_SPREAD_COST",
  "ESTIMATED_SLIPPAGE",
  "REALIZED_SLIPPAGE",
  "EXECUTION_SHORTFALL",
  "ONE_LEG_EXPOSURE",
  "CONVERSION_VALUATION",
  "OPERATIONAL_RECOVERY_COST",
  "RESIDUAL_UNEXPLAINED"
]);

// server/src/capitalFoundation/contracts/conservativeEconomics.ts
var CONSERVATIVE_ECONOMIC_FACT_KINDS = Object.freeze([
  "FUNDING",
  "BORROW",
  "CAPITAL_OPPORTUNITY"
]);
var CONSERVATIVE_ECONOMIC_FACT_OWNERS = Object.freeze([
  "BASIS_ENGINE",
  "FOUNDATION_BORROW_TRUTH",
  "CAPITAL_FOUNDATION"
]);
var CONSERVATIVE_ECONOMIC_ADMISSION_MODES = Object.freeze([
  "PRODUCTION",
  "RECORDED_REPLAY",
  "SYNTHETIC_TEST"
]);
var OWNER_BY_KIND = Object.freeze({
  FUNDING: "BASIS_ENGINE",
  BORROW: "FOUNDATION_BORROW_TRUTH",
  CAPITAL_OPPORTUNITY: "CAPITAL_FOUNDATION"
});
var AUTHORITIES_BY_KIND = Object.freeze({
  FUNDING: /* @__PURE__ */ new Set([
    "DERIVED_LIVE",
    "RECORDED_REPLAY",
    "SYNTHETIC_TEST"
  ]),
  BORROW: /* @__PURE__ */ new Set([
    "DERIVED_LIVE",
    "RECORDED_REPLAY",
    "SYNTHETIC_TEST"
  ]),
  CAPITAL_OPPORTUNITY: /* @__PURE__ */ new Set([
    "DERIVED_LIVE",
    "RECORDED_REPLAY",
    "SYNTHETIC_TEST"
  ])
});

// server/src/capitalFoundation/contracts/actions.ts
var POSITION_ACTION_INTENTS = Object.freeze([
  "HOLD",
  "ADD_STAGE",
  "REDUCE",
  "REQUEST_HEDGE",
  "REQUEST_EXIT",
  "REQUEST_EMERGENCY_UNWIND",
  "FREEZE_NEW_ACTIONS",
  "NO_ACTION_UNKNOWN"
]);
var ACTION_URGENCIES = Object.freeze(["ROUTINE", "ELEVATED", "URGENT", "EMERGENCY"]);
var FUTURE_GATES = Object.freeze([
  "OPERATOR_APPROVAL",
  "MULTI_LEG_RISK",
  "EXECUTION_COORDINATOR",
  "RECONCILIATION",
  "FRESH_ACCOUNT_TRUTH",
  "FRESH_MARKET_EVIDENCE"
]);

// server/src/capitalFoundation/contracts/opportunity.ts
var CAPITAL_CONSIDERATION_MODES = Object.freeze(["ADVISORY", "VALIDATE_ONLY", "MANUAL_ARMED"]);
var ELIGIBILITY_STATUSES = Object.freeze(["ELIGIBLE", "BLOCKED", "ADVISORY"]);
var ELIGIBILITY_REASON_CODES = Object.freeze([
  "PROPOSAL_OPEN",
  "PROPOSAL_EXPIRED",
  "PROPOSAL_REJECTED",
  "PROPOSAL_INVALIDATED",
  "PROPOSAL_REVISION_UNKNOWN",
  "PROPOSAL_CONFIG_MISMATCH",
  "PROPOSAL_TRUTH_INCOMPLETE",
  "EVIDENCE_MISSING",
  "EVIDENCE_STALE",
  "EVIDENCE_DIVERGENT",
  "ACCOUNT_TRUTH_BLOCKED",
  "BORROW_TRUTH_BLOCKED",
  "CONFLICTING_OPPORTUNITY",
  "VOLUME_ADVISORY_ONLY",
  "VOLUME_CALIBRATION_BLOCKED",
  "EXECUTABLE_STRUCTURE_UNKNOWN",
  "CONSERVATIVE_ECONOMICS_INCOMPLETE"
]);

// server/src/capitalFoundation/contracts/capital.ts
var CONTROL_POSTURES = Object.freeze(["OPEN", "PAUSED_NEW_EXPOSURE", "KILL_NEW_EXPOSURE", "UNKNOWN"]);
var ALLOCATION_STATUSES = Object.freeze(["GRANTED", "CAPPED", "BLOCKED"]);
var RESERVATION_STATES = Object.freeze(["ACTIVE", "RELEASED", "EXPIRED"]);

// server/src/capitalFoundation/contracts/approvals.ts
var APPROVAL_MODES = Object.freeze(["READ_ONLY", "ADVISORY", "VALIDATE_ONLY", "MANUAL_ARMED"]);
var APPROVAL_ACTION_CLASSES = Object.freeze(["OPEN", "ADD", "REDUCE", "HEDGE", "EXIT", "RECOVERY"]);

// server/src/capitalFoundation/contracts/positions.ts
var POSITION_STATES = Object.freeze([
  "ENTERING",
  "PARTIALLY_EXPOSED",
  "HEDGED",
  "ACTIVE",
  "REDUCING",
  "EXITING",
  "RECOVERY_REQUIRED",
  "CLOSED",
  "UNKNOWN"
]);

// server/src/engine/volume/strategyObservation.ts
var INPUT_BOOK_KEYS = [
  "askPrice",
  "askQuantity",
  "bidPrice",
  "bidQuantity",
  "depth",
  "freshnessBasis",
  "numericFidelity",
  "receivedAtMs",
  "scope",
  "sourceTimeMs",
  "symbol"
];
var OUTPUT_BOOK_KEYS = [...INPUT_BOOK_KEYS, "capacity"];

// server/src/engine/volume/strategyEconomics.ts
var VOLUME_ECONOMICS_SCHEMAS = Object.freeze({
  conditionalProxy: "VOLUME_CONDITIONAL_PROXY_ECONOMICS_V1",
  syntheticSourceNative: "VOLUME_SYNTHETIC_SOURCE_NATIVE_ECONOMICS_V1",
  assessment: "VOLUME_ECONOMICS_ASSESSMENT_V1"
});
var VOLUME_ECONOMICS_VALIDATION_CODES = Object.freeze([
  "ECONOMICS_INPUT_INVALID",
  "ECONOMICS_SCHEMA_UNKNOWN",
  "ECONOMICS_CONDITIONAL_PROXY_MISMATCH",
  "ECONOMICS_SYNTHETIC_FIXTURE_INVALID",
  "ECONOMICS_DIGEST_MISMATCH"
]);
var VOLUME_ECONOMICS_REJECTION_CODES = Object.freeze([
  "ECONOMICS_EVIDENCE_INVALID",
  "ECONOMICS_CONDITIONAL_PROXY_ONLY",
  "ECONOMICS_OPERATOR_CONTROLS_NEUTRALIZED",
  "ECONOMICS_UNKNOWN_GATES_ASSUMED_PASS",
  "ECONOMICS_PROXY_APPLICABILITY_UNKNOWN",
  "ECONOMICS_SOURCE_NATIVE_EDGE_UNDEFINED",
  "ECONOMICS_CONDITIONAL_PROXY_NET_NEGATIVE",
  "ECONOMICS_ACCOUNT_FEE_UNKNOWN",
  "ECONOMICS_CAPACITY_UNKNOWN",
  "ECONOMICS_SOURCE_MAPPING_PARTIAL",
  "ECONOMICS_FULL_STRATEGY_UNMEASURED",
  "ECONOMICS_OUT_OF_SAMPLE_VALIDATION_ABSENT",
  "ECONOMICS_SHORT_INVENTORY_ASSUMED",
  "ECONOMICS_HISTORICAL_BOOK_COVERAGE_MISSING",
  "ECONOMICS_HISTORICAL_RAW_TAPE_COVERAGE_MISSING",
  "ECONOMICS_RUNTIME_STATE_UNKNOWN_OFFLINE",
  "ECONOMICS_MODEL_UNCERTAINTY_UNBOUNDED",
  "ECONOMICS_NET_EDGE_NOT_POSITIVE"
]);
var ZERO = normalizeExactDecimal("0");
function exact(value) {
  const normalized = normalizeExactDecimal(value);
  if (normalized !== value) throw new TypeError("economics decimal literal must be canonical");
  return normalized;
}
function nonNegative(value) {
  const normalized = normalizeNonNegativeExactDecimal(value);
  if (normalized !== value) throw new TypeError("economics decimal literal must be canonical");
  return normalized;
}
function deepFreeze(value, seen = /* @__PURE__ */ new Set()) {
  if (typeof value !== "object" || value === null || seen.has(value)) return value;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) deepFreeze(item, seen);
  } else {
    for (const key of Object.keys(value)) {
      deepFreeze(value[key], seen);
    }
  }
  return Object.freeze(value);
}
function withEconomicsIdentity(payload) {
  const canonical = canonicalJson(payload);
  const economicsId = `vecon_${stableHash128Hex(`volume.economics.identity.v1|${canonical}`)}`;
  const economicsDigest = `vecond_${stableHash128Hex(`volume.economics.digest.v1|${canonical}`)}`;
  return deepFreeze({ ...payload, economicsId, economicsDigest });
}
var CONDITIONAL_PROXY_PAYLOAD = {
  schema: VOLUME_ECONOMICS_SCHEMAS.conditionalProxy,
  evidenceClass: "CONDITIONAL_PROXY_ONLY",
  admissibility: "REJECT_ONLY",
  applicability: "UNKNOWN",
  strategy: "VOLUME",
  valuationAsset: "USD",
  productionAdmissible: false,
  proposalEdgeInference: false,
  // Millisecond projection of the pinned result generation timestamp.
  evaluatedAtMs: 1785206040302,
  expiresAtMs: null,
  sourceNative: {
    state: "UNDEFINED",
    grossEdgePer1000ValuationNotional: null,
    netEdgePer1000ValuationNotional: null,
    fillExitPnlPath: "NOT_WIRED"
  },
  costs: {
    publicRegularFeeBpsPerSide: nonNegative("10"),
    accountActualFeeBpsPerSide: null,
    accountFeeState: "UNKNOWN",
    slippageBpsPerSide: nonNegative("5"),
    slippageState: "ASSUMED_UNVERIFIED"
  },
  capacity: {
    testedNotionalPerEvent: nonNegative("12"),
    liquidityCapacity: null,
    state: "UNKNOWN"
  },
  sourceBindings: [
    "binance-public-data:https://github.com/binance/binance-public-data/blob/master/README.md",
    "binance-public-fee-schedule:https://www.binance.com/en/fee/trading",
    "sha256:4214ffb4158add08a659f05cac0d8b5dc5573ca74b2455b382f9ee4295760056",
    "sha256:4d8f21de0dad2c89b3c9d6dc51ca3d1bfa5a37f1d4dbe8936f7e88102246b193",
    "sha256:576ea91a27195553902766f78fa3994430fa30ff2a55f6bc3aaab251dca1b826",
    "sha256:8826021ada900746dfff9fff9c46722d7d65c74f5e9a1a0453e65f0480801179"
  ],
  limitations: [
    "ACCOUNT_ACTUAL_FEE_UNKNOWN",
    "CAPACITY_UNKNOWN",
    "FULL_STRATEGY_UNMEASURED",
    "HISTORICAL_BOOK_GATE_COVERAGE_ZERO",
    "HISTORICAL_RAW_TAPE_GATE_COVERAGE_ZERO",
    "MODEL_UNCERTAINTY_NOT_IN_BOOTSTRAP_INTERVAL",
    "NO_PROPOSAL_SPECIFIC_EDGE_INFERENCE",
    "OPERATOR_CONTROLS_NEUTRALIZED_FOR_REPLAY",
    "RETROSPECTIVE_SPLIT_NOT_UNTOUCHED_HOLDOUT",
    "SHORT_INVENTORY_PREOWNED_ASSUMPTION",
    "SOURCE_MAPPING_PARTIAL",
    "SOURCE_NATIVE_EDGE_UNDEFINED",
    "UNKNOWN_GATES_ASSUMED_PASS"
  ],
  conditionalProxy: {
    resultClass: "CONDITIONAL_PROXY_ONLY",
    measurementSemantics: "PUBLISHED_ROUNDED_PROXY",
    publishedPrecisionDp: 6,
    unit: "USD_PER_1000_AGGREGATE_ENTRY_NOTIONAL",
    pointNetPnlUsdPer1000AggregateEntryNotional: exact("-2.962474"),
    bootstrap95Low: exact("-3.056512"),
    bootstrap95High: exact("-2.867808"),
    bootstrapBlockDays: 7,
    bootstrapReplicates: 2e3,
    bootstrapCoveragePerMyriad: 9500,
    bootstrapSeed: "20260728",
    uncertaintyScope: "REPLAY_SAMPLING_ONLY_NOT_MODEL_UNCERTAINTY",
    // Canonical exact-decimal form of the accepted six-place publication
    // "-2.935920"; publishedPrecisionDp above preserves its source precision.
    alternateTimerNetPnlUsdPer1000AggregateEntryNotional: exact("-2.93592"),
    events: 4754,
    alternateTimerEvents: 4862,
    aggregateEntryNotionalUsd: nonNegative("57048"),
    alternateTimerAggregateEntryNotionalUsd: nonNegative("58344"),
    positiveSymbolSubsets: 0,
    testedSymbolSubsets: 8,
    measuredSymbols: 8,
    currentEligibleSymbols: 87,
    checksumBoundArchives: 120,
    expectedArchives: 120,
    cohortSelection: "CURRENT_COHORT_SURVIVORSHIP_NOT_HISTORICAL_POINT_IN_TIME",
    periodStartInclusive: "2025-07-01T00:00:00Z",
    periodEndExclusive: "2026-07-01T00:00:00Z",
    temporalValidation: "RETROSPECTIVE_SPLIT_NOT_UNTOUCHED_HOLDOUT",
    entryToExitFillExposureSeconds: 61,
    sourceMapping: "PARTIAL",
    unknownGatePolicy: "ASSUME_PASS",
    historicalBookGateCoverage: nonNegative("0"),
    historicalAggTradeCountGateCoverage: nonNegative("0"),
    historicalRawTapeGateCoverage: nonNegative("0"),
    operatorControlsNeutralized: true,
    shortInventoryAssumption: "PREOWNED_BASE_NO_BORROW_OR_LEVERAGE",
    deployedMutableRuntime: "UNKNOWN_OFFLINE",
    single1000Capacity: "UNKNOWN",
    full87Capacity: "UNKNOWN",
    fullStrategyMeasurement: "UNKNOWN",
    symbolSpecific: false,
    individualOutcomeInference: false,
    generatedAt: "2026-07-28T02:34:00.302708+00:00",
    measuredRepositoryHead: "5d5733a6c6748e7844df966535bc0d66708d3a7d"
  },
  syntheticFixture: null
};
var VOLUME_CURRENT_CONDITIONAL_PROXY = withEconomicsIdentity(CONDITIONAL_PROXY_PAYLOAD);
var SYNTHETIC_INPUT_KEYS = Object.freeze([
  "accountFeeBpsPerSide",
  "evaluatedAtMs",
  "expiresAtMs",
  "fixtureId",
  "grossEdgePer1000ValuationNotional",
  "liquidityCapacity",
  "slippageBpsPerSide",
  "valuationAsset"
]);
var SYNTHETIC_DETAIL_KEYS = Object.freeze([
  "accountFeeBpsPerSide",
  "evaluatedAtMs",
  "expiresAtMs",
  "fixtureId",
  "grossEdgePer1000ValuationNotional",
  "liquidityCapacity",
  "netEdgePer1000ValuationNotional",
  "roundTripModeledCostPer1000ValuationNotional",
  "slippageBpsPerSide",
  "valuationAsset"
]);

// server/src/engine/volume/strategySlice.ts
var PROPOSAL_KEYS = Object.freeze([
  "configurationRevision",
  "correlationId",
  "direction",
  "expiresAtMs",
  "featureObservedAtMs",
  "proposalDigest",
  "proposalId",
  "proposalRevision",
  "symbol",
  "updatedTs"
]);
var VALIDATE_ONLY_PROPOSAL_KEYS = Object.freeze([
  ...PROPOSAL_KEYS,
  "evidenceBindingDigest",
  "proposalKind"
]);
var VALIDATE_ONLY_PROPOSAL_INPUT_KEYS = Object.freeze([
  "configurationRevision",
  "decision",
  "expiresAtMs"
]);
var VERIFIED_KILL_SWITCH_DECISION_KEYS = Object.freeze([
  "correlationId",
  "evidence",
  "humanReason",
  "kind",
  "rejectCode",
  "strategy",
  "symbol",
  "ts"
]);
var PLAN_KEYS = Object.freeze([
  "economicsDigest",
  "evaluationId",
  "executionAuthority",
  "executionTerms",
  "externalAuthority",
  "killSwitchEngaged",
  "mode",
  "observationDigest",
  "planId",
  "privateCalls",
  "providerCalls",
  "proposal",
  "publicOnly",
  "rejectionCodes",
  "riskAuthority",
  "schemaVersion",
  "sendEligible",
  "sends",
  "sideEffects",
  "signedCalls",
  "submitAuthority",
  "submitPortPresent",
  "validation"
]);
var TERMS_KEYS = Object.freeze([
  "baseQuantity",
  "capacityBasis",
  "capacitySide",
  "direction",
  "economicsDigest",
  "economicsValuationAsset",
  "entrySide",
  "levelCount",
  "liquidityCapacity",
  "observationDigest",
  "price",
  "quoteAsset",
  "quoteNotional",
  "symbol",
  "termsId"
]);
var EVALUATION_KEYS = Object.freeze([
  "controls",
  "disposition",
  "economicsApplicability",
  "economicsDigest",
  "evaluatedAtMs",
  "evaluationId",
  "observationDigest",
  "plan",
  "proposal",
  "rejectionCodes",
  "schemaVersion"
]);
var CONTROL_KEYS = Object.freeze([
  "enabled",
  "killSwitchEngaged"
]);
var RECONCILIATION_KEYS = Object.freeze([
  "evaluatedAtMs",
  "exchangeReconciliation",
  "executionAuthority",
  "expectedEvaluationId",
  "expectedPlanId",
  "flatnessProven",
  "persistedEvaluationId",
  "persistedPlanId",
  "reasonCodes",
  "reconciliationId",
  "schemaVersion",
  "scope",
  "status"
]);
var LOCAL_REJECTION_CODES = Object.freeze([
  "STRATEGY_DISABLED",
  "PROPOSAL_INVALID",
  "OBSERVATION_INVALID",
  "OBSERVATION_PROPOSAL_MISMATCH",
  "OBSERVATION_SOURCE_REJECTED",
  "OBSERVATION_CAPACITY_INVALID",
  "ECONOMICS_INVALID",
  "ECONOMICS_EXPIRED",
  "ECONOMICS_FUTURE_EVALUATION",
  "ECONOMICS_REJECTED",
  "ECONOMICS_NOT_POSITIVE",
  "ECONOMICS_VALUATION_ASSET_MISMATCH"
]);
var OBSERVATION_SOURCE_REJECTION_CODES = Object.freeze([
  "VOLUME_SOURCE_OBSERVATION_INVALID",
  "VOLUME_SOURCE_CONTINUITY_GAP",
  "VOLUME_SOURCE_CONTINUITY_UNKNOWN",
  "VOLUME_SOURCE_RECONNECTING",
  "VOLUME_SOURCE_BOOK_NUMERIC_FIDELITY_NORMALIZED",
  "VOLUME_SOURCE_BOOK_CAPACITY_TOP_OF_BOOK_ONLY"
]);
var KNOWN_REJECTION_CODES = /* @__PURE__ */ new Set([
  ...LOCAL_REJECTION_CODES,
  ...VOLUME_ECONOMICS_REJECTION_CODES,
  ...VOLUME_ECONOMICS_VALIDATION_CODES,
  ...OBSERVATION_SOURCE_REJECTION_CODES
]);

// server/src/engine/volume/forwardMeasurementDetectorSource.ts
var VOLUME_FORWARD_DETECTOR_SOURCE_SCHEMA = "cosmos.engine.volume.forward-detector-source-cut.v1";
var VOLUME_FORWARD_DETECTOR_SOURCE_ID = "local://volume-engine/detector-evaluation-cut/v1";

// server/src/engine/volume/forwardMeasurementEvidence.ts
var VOLUME_FORWARD_MEASUREMENT_SEGMENT_PROFILE = "FORWARD_MEASUREMENT_SEGMENT_V1";
var VOLUME_FORWARD_MEASUREMENT_DETECTOR_COVERAGE_CUT_SCHEMA = "volume.forward.detector-coverage-cut.v1";
var VOLUME_FORWARD_MEASUREMENT_DETECTOR_CADENCE_MS = 2e3;
var VOLUME_FORWARD_MEASUREMENT_PUBLIC_REST_ENDPOINTS = Object.freeze([
  "https://data-api.binance.vision"
]);
var VOLUME_FORWARD_MEASUREMENT_PUBLIC_REST_RESOURCES = Object.freeze([
  "/api/v3/depth",
  "/api/v3/exchangeInfo"
]);
var VOLUME_FORWARD_MEASUREMENT_PUBLIC_STREAM_ENDPOINTS = Object.freeze([
  "wss://data-stream.binance.vision"
]);
var VOLUME_FORWARD_MEASUREMENT_EVIDENCE_LIMITS = Object.freeze({
  maximumCumulativeRawPayloadBytes: 256 * 1024 * 1024,
  maximumChainIdCharacters: 128,
  maximumHeaderBytes: 4 * 1024,
  maximumJsonlBytes: 512 * 1024 * 1024,
  maximumJsonlLineBytes: 24 * 1024 * 1024,
  maximumRawPayloadBytes: 16 * 1024 * 1024,
  maximumRecordCount: 1e5,
  maximumUtcMs: 864e13
});
var VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE = Object.freeze({
  ANCHOR_MISMATCH: "EVIDENCE_ANCHOR_MISMATCH",
  DELETED: "EVIDENCE_DELETED",
  DUPLICATED: "EVIDENCE_DUPLICATED",
  INVALID: "EVIDENCE_INVALID",
  MIXED_POLICY: "EVIDENCE_MIXED_POLICY",
  MUTATED: "EVIDENCE_MUTATED",
  REORDERED: "EVIDENCE_REORDERED",
  TRUNCATED: "EVIDENCE_TRUNCATED",
  UNSEALED: "EVIDENCE_UNSEALED",
  UNSUPPORTED: "EVIDENCE_UNSUPPORTED"
});
var MAX_MONOTONIC_NS = (1n << 128n) - 1n;
var AUTHORITY_KEYS = Object.freeze([
  "cas",
  "execution",
  "privateData",
  "signedRequest",
  "submit"
]);
var HEADER_KEYS = Object.freeze([
  "authority",
  "chainId",
  "generation",
  "kind",
  "localReceivedAtMs",
  "localMonotonicNs",
  "policyDigest",
  "previousHash",
  "rawByteLength",
  "rawSha256",
  "schema",
  "schemaVersion",
  "sealedRecordCount",
  "sealedTailHash",
  "sequence",
  "sourceEndpoint",
  "sourceSymbol",
  "sourceStream",
  "sourceTransport",
  "terminal"
]);
var RECORD_KEYS = Object.freeze([
  "header",
  "rawBase64",
  "recordHash"
]);
var CURSOR_KEYS = Object.freeze([
  "chainId",
  "cumulativeRawPayloadBytes",
  "generation",
  "generationOpen",
  "lastLocalReceivedAtMs",
  "lastLocalMonotonicNs",
  "nextSequence",
  "policyDigest",
  "previousHash",
  "sealed"
]);
var VERIFY_OPTION_KEYS = Object.freeze([
  "expectedPolicyDigest",
  "expectedTerminalHash",
  "requireMeasurementBundle",
  "requireSealed"
]);
var PARSE_OPTION_KEYS = Object.freeze([
  ...VERIFY_OPTION_KEYS,
  "maximumJsonlBytes",
  "maximumLineBytes"
]);
var COMPLETE_PUBLIC_MEASUREMENT_KINDS = Object.freeze([
  "EXCHANGE_INFO",
  "DEPTH_SNAPSHOT",
  "DEPTH_DIFF",
  "TRADE",
  "AGG_TRADE",
  "BOOK_TICKER"
]);
var DETECTOR_COVERAGE_CUT_KEYS = Object.freeze([
  "schemaVersion",
  "profile",
  "captureId",
  "activationId",
  "segmentId",
  "chainKey",
  "detectorInputSourceId",
  "detectorInputSourceDigest",
  "runtimeGeneration",
  "detectorTickRevision",
  "cutOffset",
  "cutAtMs",
  "localReceivedAtMs",
  "localMonotonicNs",
  "cadenceMs",
  "configurationRevision",
  "configurationDigest",
  "strategyEnabled",
  "killSwitchEngaged",
  "evaluationUniverseDigest",
  "evaluationUniverseCount",
  "pseudoProposalExcludedCount",
  "acceptedProposals",
  "observerDropCount",
  "observerFailureCount",
  "previousCutDigest",
  "cutDigest",
  "complete"
]);
var DETECTOR_COVERAGE_PROPOSAL_KEYS = Object.freeze([
  "cutOffset",
  "proposalId",
  "proposalRevision",
  "proposalDigest",
  "symbol",
  "detectorDecisionDigest",
  "featureDigest"
]);
var TERMINAL_SEGMENT_KEYS = Object.freeze([
  "schemaVersion",
  "profile",
  "segmentId",
  "captureId",
  "activationId",
  "coverageRole",
  "chainKey",
  "symbol",
  "segmentIndex",
  "previousTerminalHash",
  "corePolicyDigest",
  "packetMeasurementPolicySha256",
  "detectorInputSourceId",
  "detectorInputSourceDigest",
  "coverage",
  "recordBounds",
  "nonTruncated",
  "closeReason",
  "generationSummary",
  "detectorCoverage",
  "acceptedProposals",
  "lifecycleSummary",
  "pseudoProposalExcludedCount",
  "quiescent"
]);
var TERMINAL_COVERAGE_KEYS = Object.freeze([
  "startMs",
  "endExclusiveMs"
]);
var TERMINAL_RECORD_BOUNDS_KEYS = Object.freeze([
  "firstHash",
  "sealedTailHash",
  "firstSequence",
  "lastSequence",
  "recordCount",
  "byteCount"
]);
var TERMINAL_GENERATION_SUMMARY_KEYS = Object.freeze([
  "count",
  "continuityGapCount",
  "unresolvedCount"
]);
var TERMINAL_DETECTOR_COVERAGE_KEYS = Object.freeze([
  "coverageChainKey",
  "firstCutOffset",
  "lastCutOffset",
  "cutCount",
  "expectedCutCount",
  "missingCutCount",
  "maxGapMs",
  "uncoveredMs",
  "firstCutDigest",
  "lastCutDigest",
  "complete"
]);
var TERMINAL_PROPOSAL_KEYS = Object.freeze([
  "proposalId",
  "proposalRevision",
  "proposalDigest",
  "symbol"
]);
var TERMINAL_LIFECYCLE_SUMMARY_KEYS = Object.freeze([
  "proposalKeys",
  "assertionCount",
  "openCount",
  "stateCounts"
]);
var TERMINAL_LIFECYCLE_STATE_COUNT_KEYS = Object.freeze([
  "OBSERVED",
  "ENTRY_RECORDED",
  "HOLDING",
  "TERMINAL_EXIT",
  "BLOCKED",
  "EXACT"
]);

// server/src/engine/volume/forwardMeasurementRunner.ts
var VOLUME_FORWARD_MEASUREMENT_RUNNER_SCHEMA = "volume.forward.scheduled-capture.v1";
var VOLUME_FORWARD_RUNTIME_DETECTOR_CUT_SCHEMA = "volume.runtime.forward-detector-cut.v1";
var VOLUME_FORWARD_MEASUREMENT_RUNNER_CHECKPOINT_SCHEMA = "volume.forward.runner-checkpoint.v1";
var VOLUME_FORWARD_MEASUREMENT_RUNNER_AUTHORITY = deepFreeze2({
  enabled: false,
  killSwitchEngaged: true,
  mode: "SHADOW_ONLY",
  recordOnly: true,
  publicOnly: true,
  executionAuthority: "NONE",
  submitAuthority: "NONE",
  casAuthority: "NONE",
  privateDataAuthority: "NONE",
  signedRequestAuthority: "NONE",
  keyAuthority: "NONE",
  providerAuthority: "NONE",
  hostAuthority: "NONE",
  submitPortPresent: false,
  queryPortPresent: false,
  sends: 0,
  sideEffects: 0,
  orders: 0,
  transfers: 0,
  withdrawals: 0,
  moneyUsd: 0
});
var MAX_UTC_MS = 41024448e5;
var WARMUP_DURATION_MS = 144e5;
var INTERVAL_DURATION_MS = 2592e6;
var MATURITY_LAG_MS = 62e3;
var DETECTOR_CUTS_PER_SEGMENT = 99998;
var IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/;
var ACTIVATION_ID = /^ve2_activation_[a-f0-9]{64}$/;
var CAPTURE_ID = /^ve2_capture_[a-f0-9]{64}$/;
var CHAIN_KEY = /^ve2_detector_coverage_[a-f0-9]{64}$/;
var SHA256 = /^sha256:[a-f0-9]{64}$/;
var HEX_SHA256 = /^[a-f0-9]{64}$/;
var ENGINE_ID = /^[A-Za-z][A-Za-z0-9_-]{2,191}$/;
var MONOTONIC_NS = /^(?:0|[1-9][0-9]{0,39})$/;
function deepFreeze2(value, seen = /* @__PURE__ */ new Set()) {
  if (value === null || typeof value !== "object" || seen.has(value)) {
    return value;
  }
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) deepFreeze2(item, seen);
  } else {
    for (const child of Object.values(value)) {
      deepFreeze2(child, seen);
    }
  }
  return Object.freeze(value);
}
function plainRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}
function canonicalJson2(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || Object.is(value, -0)) {
      throw new TypeError("forward runner canonical number invalid");
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson2(item)).join(",")}]`;
  }
  if (!plainRecord(value)) {
    throw new TypeError("forward runner canonical object invalid");
  }
  return `{${Object.keys(value).sort().map(
    (key) => `${JSON.stringify(key)}:${canonicalJson2(value[key])}`
  ).join(",")}}`;
}
function domainSha256(domain, value) {
  const hash = createHash("sha256");
  hash.update(domain, "utf8");
  hash.update(Uint8Array.of(0));
  hash.update(canonicalJson2(value), "utf8");
  return `sha256:${hash.digest("hex")}`;
}
function safeUtcMs(value) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= MAX_UTC_MS && !Object.is(value, -0);
}
function nonNegativeSafeInteger(value) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && !Object.is(value, -0);
}
function assertSynchronous(result, code) {
  if (result !== null && (typeof result === "object" || typeof result === "function") && typeof result.then === "function") {
    throw new TypeError(code);
  }
}
function validateSchedule(value) {
  if (!plainRecord(value) || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([
    "activationId",
    "captureId",
    "controls",
    "detectorCadenceMs",
    "detectorCoverageChainKey",
    "detectorCoverageCorePolicyDigest",
    "detectorCutsPerSegment",
    "detectorInputSourceDigest",
    "detectorInputSourceId",
    "intervalEndExclusiveMs",
    "intervalStartMs",
    "maturityAtMs",
    "packetMeasurementPolicySha256",
    "schemaVersion",
    "warmupStartMs"
  ]) || value.schemaVersion !== VOLUME_FORWARD_MEASUREMENT_RUNNER_SCHEMA || typeof value.activationId !== "string" || !ACTIVATION_ID.test(value.activationId) || typeof value.captureId !== "string" || !CAPTURE_ID.test(value.captureId) || typeof value.detectorCoverageChainKey !== "string" || !CHAIN_KEY.test(value.detectorCoverageChainKey) || typeof value.detectorCoverageCorePolicyDigest !== "string" || !SHA256.test(value.detectorCoverageCorePolicyDigest) || value.detectorInputSourceId !== VOLUME_FORWARD_DETECTOR_SOURCE_ID || typeof value.detectorInputSourceDigest !== "string" || !SHA256.test(value.detectorInputSourceDigest) || typeof value.packetMeasurementPolicySha256 !== "string" || !HEX_SHA256.test(value.packetMeasurementPolicySha256) || !safeUtcMs(value.warmupStartMs) || !safeUtcMs(value.intervalStartMs) || !safeUtcMs(value.intervalEndExclusiveMs) || !safeUtcMs(value.maturityAtMs) || value.warmupStartMs !== value.intervalStartMs - WARMUP_DURATION_MS || value.intervalEndExclusiveMs !== value.intervalStartMs + INTERVAL_DURATION_MS || value.maturityAtMs !== value.intervalEndExclusiveMs + MATURITY_LAG_MS || value.detectorCadenceMs !== VOLUME_FORWARD_MEASUREMENT_DETECTOR_CADENCE_MS || value.detectorCutsPerSegment !== DETECTOR_CUTS_PER_SEGMENT || !plainRecord(value.controls) || JSON.stringify(Object.keys(value.controls).sort()) !== JSON.stringify([
    "enabled",
    "killSwitchEngaged",
    "mode",
    "recordOnly"
  ]) || value.controls.enabled !== false || value.controls.killSwitchEngaged !== true || value.controls.mode !== "SHADOW_ONLY" || value.controls.recordOnly !== true) {
    throw new TypeError("forward scheduled capture is invalid");
  }
  return deepFreeze2(structuredClone(value));
}
function validateRuntimeCut(value) {
  if (!plainRecord(value) || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([
    "detectorTickRevision",
    "localMonotonicNs",
    "localReceivedAtMs",
    "observerFailureCount",
    "runtimeGeneration",
    "schemaVersion",
    "sourceCut"
  ]) || value.schemaVersion !== VOLUME_FORWARD_RUNTIME_DETECTOR_CUT_SCHEMA || !nonNegativeSafeInteger(value.runtimeGeneration) || value.runtimeGeneration < 1 || !nonNegativeSafeInteger(value.detectorTickRevision) || value.detectorTickRevision < 1 || !safeUtcMs(value.localReceivedAtMs) || typeof value.localMonotonicNs !== "string" || !MONOTONIC_NS.test(value.localMonotonicNs) || !nonNegativeSafeInteger(value.observerFailureCount) || !plainRecord(value.sourceCut)) return false;
  const source = value.sourceCut;
  return source.schemaVersion === VOLUME_FORWARD_DETECTOR_SOURCE_SCHEMA && source.sourceId === VOLUME_FORWARD_DETECTOR_SOURCE_ID && safeUtcMs(source.tickAtMs) && source.tickAtMs <= value.localReceivedAtMs && value.localReceivedAtMs - source.tickAtMs < VOLUME_FORWARD_MEASUREMENT_DETECTOR_CADENCE_MS && typeof source.configurationRevision === "string" && IDENTIFIER.test(source.configurationRevision) && typeof source.configurationDigest === "string" && SHA256.test(source.configurationDigest) && typeof source.evaluationUniverseDigest === "string" && SHA256.test(source.evaluationUniverseDigest) && nonNegativeSafeInteger(source.evaluationUniverseCount) && source.pseudoProposalExcludedCount === 0 && Array.isArray(source.qualifiedProposals) && source.qualifiedProposals.length <= source.evaluationUniverseCount && typeof source.cutDigest === "string" && SHA256.test(source.cutDigest);
}
function segmentId(schedule, segmentIndex) {
  return `ve2_segment_${domainSha256(
    "VE2_FORWARD_DETECTOR_SEGMENT_ID_V1",
    {
      activationId: schedule.activationId,
      captureId: schedule.captureId,
      chainKey: schedule.detectorCoverageChainKey,
      segmentIndex
    }
  ).slice("sha256:".length)}`;
}
function detectorCutDigest(value) {
  return domainSha256("VOLUME_FORWARD_DETECTOR_COVERAGE_CUT_V1", value);
}
function checkpointDigest(value) {
  return domainSha256(
    "VOLUME_FORWARD_MEASUREMENT_RUNNER_CHECKPOINT_V1",
    value
  );
}
function uniqueSortedIdentifiers(value, maximum) {
  if (!Array.isArray(value) || value.length > maximum || value.some(
    (item) => typeof item !== "string" || !IDENTIFIER.test(item)
  )) return null;
  const sorted = [...value].sort();
  if (new Set(sorted).size !== sorted.length || sorted.some((item, index) => item !== value[index])) return null;
  return Object.freeze(sorted);
}
function validateCheckpoint(value, schedule) {
  if (!plainRecord(value) || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([
    "acceptedCorrelationIds",
    "acceptedProposalIds",
    "activationId",
    "captureId",
    "checkpointDigest",
    "checkpointRevision",
    "consumerGate",
    "currentSegmentIndex",
    "lastDetectorTickRevision",
    "lastLocalMonotonicNs",
    "lastLocalReceivedAtMs",
    "nextCutOffset",
    "observerFailureCount",
    "previousCutDigest",
    "profitabilityClaim",
    "runtimeGeneration",
    "schemaVersion",
    "state",
    "warmupCorrelationIds",
    "warmupCutCount"
  ]) || value.schemaVersion !== VOLUME_FORWARD_MEASUREMENT_RUNNER_CHECKPOINT_SCHEMA || value.activationId !== schedule.activationId || value.captureId !== schedule.captureId || !nonNegativeSafeInteger(value.checkpointRevision) || value.checkpointRevision < 1 || !["SCHEDULED", "WARMING", "CAPTURING"].includes(
    String(value.state)
  ) || !nonNegativeSafeInteger(value.nextCutOffset) || value.nextCutOffset > (schedule.maturityAtMs - schedule.intervalStartMs) / schedule.detectorCadenceMs || !nonNegativeSafeInteger(value.warmupCutCount) || value.warmupCutCount > (schedule.intervalStartMs - schedule.warmupStartMs) / schedule.detectorCadenceMs || value.currentSegmentIndex !== null && (!nonNegativeSafeInteger(value.currentSegmentIndex) || value.currentSegmentIndex !== Math.floor(
    Math.max(0, value.nextCutOffset - 1) / schedule.detectorCutsPerSegment
  )) || value.nextCutOffset === 0 && value.currentSegmentIndex !== null || value.runtimeGeneration !== null && (!nonNegativeSafeInteger(value.runtimeGeneration) || value.runtimeGeneration < 1) || value.lastDetectorTickRevision !== null && (!nonNegativeSafeInteger(value.lastDetectorTickRevision) || value.lastDetectorTickRevision < 1) || value.lastLocalReceivedAtMs !== null && !safeUtcMs(value.lastLocalReceivedAtMs) || value.lastLocalMonotonicNs !== null && (typeof value.lastLocalMonotonicNs !== "string" || !MONOTONIC_NS.test(value.lastLocalMonotonicNs)) || !nonNegativeSafeInteger(value.observerFailureCount) || value.previousCutDigest !== null && (typeof value.previousCutDigest !== "string" || !SHA256.test(value.previousCutDigest)) || value.nextCutOffset === 0 !== (value.previousCutDigest === null) || value.lastDetectorTickRevision === null !== (value.lastLocalReceivedAtMs === null) || value.lastDetectorTickRevision === null !== (value.lastLocalMonotonicNs === null) || value.runtimeGeneration === null !== (value.lastDetectorTickRevision === null) || value.consumerGate !== "BLOCKED_VE2_INTERVAL_NOT_TERMINAL_ACCEPTED" || value.profitabilityClaim !== false || typeof value.checkpointDigest !== "string" || !SHA256.test(value.checkpointDigest)) throw new TypeError("forward runner checkpoint is invalid");
  const warmupCorrelationIds = uniqueSortedIdentifiers(
    value.warmupCorrelationIds,
    1e5
  );
  const acceptedProposalIds = uniqueSortedIdentifiers(
    value.acceptedProposalIds,
    1e5
  );
  const acceptedCorrelationIds = uniqueSortedIdentifiers(
    value.acceptedCorrelationIds,
    1e5
  );
  if (warmupCorrelationIds === null || acceptedProposalIds === null || acceptedCorrelationIds === null || acceptedProposalIds.length !== acceptedCorrelationIds.length || value.state === "SCHEDULED" && (value.warmupCutCount !== 0 || value.nextCutOffset !== 0) || value.state === "WARMING" && (value.warmupCutCount === 0 || value.nextCutOffset !== 0) || value.state === "CAPTURING" && value.nextCutOffset === 0) throw new TypeError("forward runner checkpoint is invalid");
  const semantic = {
    schemaVersion: VOLUME_FORWARD_MEASUREMENT_RUNNER_CHECKPOINT_SCHEMA,
    checkpointRevision: value.checkpointRevision,
    activationId: value.activationId,
    captureId: value.captureId,
    state: value.state,
    nextCutOffset: value.nextCutOffset,
    warmupCutCount: value.warmupCutCount,
    currentSegmentIndex: value.currentSegmentIndex,
    runtimeGeneration: value.runtimeGeneration,
    lastDetectorTickRevision: value.lastDetectorTickRevision,
    lastLocalReceivedAtMs: value.lastLocalReceivedAtMs,
    lastLocalMonotonicNs: value.lastLocalMonotonicNs,
    observerFailureCount: value.observerFailureCount,
    previousCutDigest: value.previousCutDigest,
    warmupCorrelationIds,
    acceptedProposalIds,
    acceptedCorrelationIds,
    consumerGate: "BLOCKED_VE2_INTERVAL_NOT_TERMINAL_ACCEPTED",
    profitabilityClaim: false
  };
  if (value.checkpointDigest !== checkpointDigest(semantic)) {
    throw new TypeError("forward runner checkpoint is invalid");
  }
  return deepFreeze2({
    ...semantic,
    checkpointDigest: value.checkpointDigest
  });
}
function acceptedProposal(source, cutOffset) {
  const proposal = source.proposal;
  if (!ENGINE_ID.test(proposal.proposalId) || !ENGINE_ID.test(proposal.proposalDigest) || !ENGINE_ID.test(source.detectorDecisionDigest) || !ENGINE_ID.test(source.featureDigest)) {
    throw new TypeError("forward detector proposal digest is invalid");
  }
  return Object.freeze({
    cutOffset,
    proposalId: proposal.proposalId,
    proposalRevision: proposal.proposalRevision,
    proposalDigest: proposal.proposalDigest,
    symbol: proposal.symbol,
    detectorDecisionDigest: source.detectorDecisionDigest,
    featureDigest: source.featureDigest
  });
}
var VolumeForwardMeasurementRunner = class {
  state = "SCHEDULED";
  schedule;
  sink;
  warmupCorrelationIds = /* @__PURE__ */ new Set();
  acceptedProposalIds = /* @__PURE__ */ new Set();
  acceptedCorrelationIds = /* @__PURE__ */ new Set();
  reasons = /* @__PURE__ */ new Set();
  nextCutOffset = 0;
  warmupCutCount = 0;
  currentSegmentIndex = null;
  runtimeGeneration = null;
  lastDetectorTickRevision = null;
  lastLocalReceivedAtMs = null;
  observerFailureCount = 0;
  lastMonotonicNs = null;
  previousCutDigest = null;
  checkpointRevision = 0;
  lastCheckpoint = null;
  resumeGenerationPending = false;
  constructor(input) {
    if (!plainRecord(input) || !plainRecord(input.sink) || typeof input.sink.rotateDetectorSegment !== "function" || typeof input.sink.appendDetectorCoverage !== "function" || typeof input.sink.openProposalCapture !== "function" || typeof input.sink.persistRunnerCheckpoint !== "function" || typeof input.sink.sealDetectorCapture !== "function") throw new TypeError("forward measurement runner input is invalid");
    this.schedule = validateSchedule(input.schedule);
    this.sink = input.sink;
    if (input.checkpoint !== void 0 && input.checkpoint !== null) {
      const checkpoint = validateCheckpoint(
        input.checkpoint,
        this.schedule
      );
      this.state = checkpoint.state;
      this.nextCutOffset = checkpoint.nextCutOffset;
      this.warmupCutCount = checkpoint.warmupCutCount;
      this.currentSegmentIndex = checkpoint.currentSegmentIndex;
      this.runtimeGeneration = checkpoint.runtimeGeneration;
      this.lastDetectorTickRevision = checkpoint.lastDetectorTickRevision;
      this.lastLocalReceivedAtMs = checkpoint.lastLocalReceivedAtMs;
      this.lastMonotonicNs = checkpoint.lastLocalMonotonicNs === null ? null : BigInt(checkpoint.lastLocalMonotonicNs);
      this.observerFailureCount = checkpoint.observerFailureCount;
      this.previousCutDigest = checkpoint.previousCutDigest;
      this.checkpointRevision = checkpoint.checkpointRevision;
      this.lastCheckpoint = checkpoint;
      for (const value of checkpoint.warmupCorrelationIds) {
        this.warmupCorrelationIds.add(value);
      }
      for (const value of checkpoint.acceptedProposalIds) {
        this.acceptedProposalIds.add(value);
      }
      for (const value of checkpoint.acceptedCorrelationIds) {
        this.acceptedCorrelationIds.add(value);
      }
      this.resumeGenerationPending = true;
    }
  }
  observe(value) {
    if (this.state === "FAILED" || this.state === "READY_TO_TERMINALIZE") {
      return this.snapshot();
    }
    if (!validateRuntimeCut(value)) {
      return this.fail("DETECTOR_RUNTIME_CUT_INVALID");
    }
    const cut = value;
    if (cut.observerFailureCount !== 0) {
      this.observerFailureCount += cut.observerFailureCount;
      return this.fail("DETECTOR_RUNTIME_OBSERVER_FAILED", false);
    }
    if (cut.localReceivedAtMs < this.schedule.warmupStartMs) {
      return this.snapshot();
    }
    const receivedNs = BigInt(cut.localMonotonicNs);
    const resumingGeneration = this.resumeGenerationPending;
    if (resumingGeneration) {
      if (this.runtimeGeneration === null || cut.runtimeGeneration !== this.runtimeGeneration + 1 || cut.detectorTickRevision !== 1) {
        return this.fail("DETECTOR_RUNTIME_RESUME_GENERATION_INVALID");
      }
      this.runtimeGeneration = cut.runtimeGeneration;
      this.resumeGenerationPending = false;
    } else if (this.runtimeGeneration !== null && cut.runtimeGeneration !== this.runtimeGeneration) {
      return this.fail("DETECTOR_RUNTIME_GENERATION_CHANGED");
    }
    this.runtimeGeneration ??= cut.runtimeGeneration;
    if (this.lastDetectorTickRevision !== null && !resumingGeneration && cut.detectorTickRevision !== this.lastDetectorTickRevision + 1) {
      return this.fail("DETECTOR_TICK_REVISION_GAP");
    }
    if (this.lastLocalReceivedAtMs !== null && cut.localReceivedAtMs < this.lastLocalReceivedAtMs) {
      return this.fail("DETECTOR_RECEIVE_CLOCK_REGRESSED");
    }
    if (this.lastMonotonicNs !== null && cut.detectorTickRevision !== 1 && receivedNs <= this.lastMonotonicNs) {
      return this.fail("DETECTOR_MONOTONIC_CLOCK_REGRESSED");
    }
    this.lastDetectorTickRevision = cut.detectorTickRevision;
    this.lastLocalReceivedAtMs = cut.localReceivedAtMs;
    this.lastMonotonicNs = receivedNs;
    if (cut.localReceivedAtMs < this.schedule.intervalStartMs) {
      const expectedWarmupAtMs = this.schedule.warmupStartMs + this.warmupCutCount * this.schedule.detectorCadenceMs;
      if (cut.localReceivedAtMs < expectedWarmupAtMs || cut.localReceivedAtMs >= expectedWarmupAtMs + this.schedule.detectorCadenceMs) {
        return this.fail("DETECTOR_WARMUP_COVERAGE_GAP");
      }
      this.state = "WARMING";
      for (const candidate of cut.sourceCut.qualifiedProposals) {
        this.warmupCorrelationIds.add(candidate.proposal.correlationId);
      }
      this.warmupCutCount += 1;
      if (!this.persistCheckpoint()) return this.snapshot();
      return this.snapshot();
    }
    if (cut.localReceivedAtMs >= this.schedule.maturityAtMs) {
      return this.advanceTime(cut.localReceivedAtMs);
    }
    if (this.warmupCutCount !== this.expectedWarmupCutCount()) {
      return this.fail("DETECTOR_WARMUP_COVERAGE_INCOMPLETE");
    }
    const expectedCutAtMs = this.schedule.intervalStartMs + this.nextCutOffset * this.schedule.detectorCadenceMs;
    if (cut.localReceivedAtMs < expectedCutAtMs || cut.localReceivedAtMs >= expectedCutAtMs + this.schedule.detectorCadenceMs) {
      return this.fail("DETECTOR_CUT_RECEIVE_CLOCK_OUT_OF_RANGE");
    }
    const cutOffset = this.nextCutOffset;
    const segmentIndex = Math.floor(
      cutOffset / this.schedule.detectorCutsPerSegment
    );
    const segment = segmentId(this.schedule, segmentIndex);
    if (segmentIndex !== this.currentSegmentIndex) {
      try {
        assertSynchronous(this.sink.rotateDetectorSegment(Object.freeze({
          activationId: this.schedule.activationId,
          captureId: this.schedule.captureId,
          chainKey: this.schedule.detectorCoverageChainKey,
          segmentId: segment,
          segmentIndex,
          firstCutOffset: cutOffset,
          previousCutDigest: this.previousCutDigest,
          packetMeasurementPolicySha256: this.schedule.packetMeasurementPolicySha256,
          detectorCoverageCorePolicyDigest: this.schedule.detectorCoverageCorePolicyDigest
        })), "DETECTOR_SEGMENT_ROTATION_ASYNC");
        this.currentSegmentIndex = segmentIndex;
      } catch {
        return this.fail("DETECTOR_SEGMENT_ROTATION_FAILED");
      }
    }
    const acceptedSources = [];
    if (expectedCutAtMs < this.schedule.intervalEndExclusiveMs) {
      for (const candidate of cut.sourceCut.qualifiedProposals) {
        const proposalId = candidate.proposal.proposalId;
        if (this.warmupCorrelationIds.has(candidate.proposal.correlationId) || this.acceptedCorrelationIds.has(candidate.proposal.correlationId) || this.acceptedProposalIds.has(proposalId)) continue;
        acceptedSources.push(candidate);
        this.acceptedProposalIds.add(proposalId);
        this.acceptedCorrelationIds.add(candidate.proposal.correlationId);
      }
    }
    const acceptedProposals = acceptedSources.map((candidate) => acceptedProposal(candidate, cutOffset)).sort((left, right) => {
      const leftKey = [
        left.symbol,
        left.proposalId,
        String(left.proposalRevision).padStart(16, "0"),
        left.proposalDigest,
        left.detectorDecisionDigest,
        left.featureDigest
      ].join("|");
      const rightKey = [
        right.symbol,
        right.proposalId,
        String(right.proposalRevision).padStart(16, "0"),
        right.proposalDigest,
        right.detectorDecisionDigest,
        right.featureDigest
      ].join("|");
      return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
    });
    const withoutDigest = {
      schemaVersion: VOLUME_FORWARD_MEASUREMENT_DETECTOR_COVERAGE_CUT_SCHEMA,
      profile: VOLUME_FORWARD_MEASUREMENT_SEGMENT_PROFILE,
      captureId: this.schedule.captureId,
      activationId: this.schedule.activationId,
      segmentId: segment,
      chainKey: this.schedule.detectorCoverageChainKey,
      detectorInputSourceId: this.schedule.detectorInputSourceId,
      detectorInputSourceDigest: this.schedule.detectorInputSourceDigest,
      runtimeGeneration: cut.runtimeGeneration,
      detectorTickRevision: cut.detectorTickRevision,
      cutOffset,
      cutAtMs: expectedCutAtMs,
      localReceivedAtMs: cut.localReceivedAtMs,
      localMonotonicNs: cut.localMonotonicNs,
      cadenceMs: VOLUME_FORWARD_MEASUREMENT_DETECTOR_CADENCE_MS,
      configurationRevision: cut.sourceCut.configurationRevision,
      configurationDigest: cut.sourceCut.configurationDigest,
      strategyEnabled: false,
      killSwitchEngaged: true,
      evaluationUniverseDigest: cut.sourceCut.evaluationUniverseDigest,
      evaluationUniverseCount: cut.sourceCut.evaluationUniverseCount,
      pseudoProposalExcludedCount: cut.sourceCut.pseudoProposalExcludedCount,
      acceptedProposals,
      observerDropCount: 0,
      observerFailureCount: 0,
      previousCutDigest: this.previousCutDigest,
      complete: true
    };
    const coverageCut = deepFreeze2({
      ...withoutDigest,
      cutDigest: detectorCutDigest(withoutDigest)
    });
    try {
      assertSynchronous(
        this.sink.appendDetectorCoverage(coverageCut),
        "DETECTOR_EVIDENCE_APPEND_ASYNC"
      );
    } catch {
      return this.fail("DETECTOR_EVIDENCE_APPEND_FAILED");
    }
    this.previousCutDigest = coverageCut.cutDigest;
    this.nextCutOffset += 1;
    this.state = "CAPTURING";
    for (const candidate of acceptedSources) {
      try {
        assertSynchronous(this.sink.openProposalCapture(deepFreeze2({
          activationId: this.schedule.activationId,
          captureId: this.schedule.captureId,
          detectorCutOffset: cutOffset,
          detectorCutAtMs: expectedCutAtMs,
          detectorInputSourceId: this.schedule.detectorInputSourceId,
          detectorInputSourceDigest: this.schedule.detectorInputSourceDigest,
          proposal: candidate.proposal,
          detectorDecisionDigest: candidate.detectorDecisionDigest,
          featureDigest: candidate.featureDigest,
          entryQuoteNotional: "10.00",
          maximumHoldMs: 6e4,
          admissionEndExclusiveMs: this.schedule.intervalEndExclusiveMs,
          evidenceClosesAtMs: this.schedule.maturityAtMs,
          authority: VOLUME_FORWARD_MEASUREMENT_RUNNER_AUTHORITY
        })), "DETECTOR_PROPOSAL_CAPTURE_ASYNC");
      } catch {
        return this.fail("DETECTOR_PROPOSAL_CAPTURE_OPEN_FAILED");
      }
    }
    if (!this.persistCheckpoint()) return this.snapshot();
    return this.snapshot();
  }
  advanceTime(nowMs) {
    if (this.state === "FAILED" || this.state === "READY_TO_TERMINALIZE") {
      return this.snapshot();
    }
    if (!safeUtcMs(nowMs)) return this.fail("RUNNER_CLOCK_INVALID");
    if (nowMs < this.schedule.maturityAtMs) return this.snapshot();
    if (this.nextCutOffset !== this.expectedDetectorCutCount()) {
      return this.fail("DETECTOR_COVERAGE_INCOMPLETE_AT_MATURITY");
    }
    if (this.previousCutDigest === null) {
      return this.fail("DETECTOR_TERMINAL_DIGEST_MISSING");
    }
    try {
      assertSynchronous(this.sink.sealDetectorCapture(deepFreeze2({
        activationId: this.schedule.activationId,
        captureId: this.schedule.captureId,
        detectorCoverageChainKey: this.schedule.detectorCoverageChainKey,
        detectorCoverageCorePolicyDigest: this.schedule.detectorCoverageCorePolicyDigest,
        detectorInputSourceId: this.schedule.detectorInputSourceId,
        detectorInputSourceDigest: this.schedule.detectorInputSourceDigest,
        packetMeasurementPolicySha256: this.schedule.packetMeasurementPolicySha256,
        intervalStartMs: this.schedule.intervalStartMs,
        intervalEndExclusiveMs: this.schedule.intervalEndExclusiveMs,
        maturityAtMs: this.schedule.maturityAtMs,
        detectorCadenceMs: VOLUME_FORWARD_MEASUREMENT_DETECTOR_CADENCE_MS,
        detectorCutsPerSegment: DETECTOR_CUTS_PER_SEGMENT,
        recordedDetectorCutCount: this.nextCutOffset,
        expectedDetectorCutCount: this.expectedDetectorCutCount(),
        acceptedProposalCount: this.acceptedProposalIds.size,
        terminalCutDigest: this.previousCutDigest,
        authority: VOLUME_FORWARD_MEASUREMENT_RUNNER_AUTHORITY
      })), "DETECTOR_CAPTURE_SEAL_ASYNC");
    } catch {
      return this.fail("DETECTOR_CAPTURE_SEAL_FAILED");
    }
    this.state = "READY_TO_TERMINALIZE";
    return this.snapshot();
  }
  snapshot() {
    return deepFreeze2({
      state: this.state,
      activationId: this.schedule.activationId,
      expectedDetectorCutCount: this.expectedDetectorCutCount(),
      recordedDetectorCutCount: this.nextCutOffset,
      nextCutOffset: this.nextCutOffset,
      currentSegmentIndex: this.currentSegmentIndex,
      acceptedProposalCount: this.acceptedProposalIds.size,
      warmupProposalCount: this.warmupCorrelationIds.size,
      recordedWarmupCutCount: this.warmupCutCount,
      expectedWarmupCutCount: this.expectedWarmupCutCount(),
      runtimeGeneration: this.runtimeGeneration,
      observerFailureCount: this.observerFailureCount,
      reasonCodes: Object.freeze([...this.reasons].sort()),
      consumerGate: "BLOCKED_VE2_INTERVAL_NOT_TERMINAL_ACCEPTED",
      profitabilityClaim: false,
      authority: VOLUME_FORWARD_MEASUREMENT_RUNNER_AUTHORITY,
      checkpoint: this.lastCheckpoint
    });
  }
  checkpoint() {
    return this.lastCheckpoint;
  }
  expectedDetectorCutCount() {
    return (this.schedule.maturityAtMs - this.schedule.intervalStartMs) / this.schedule.detectorCadenceMs;
  }
  expectedWarmupCutCount() {
    return (this.schedule.intervalStartMs - this.schedule.warmupStartMs) / this.schedule.detectorCadenceMs;
  }
  fail(code, incrementFailureCount = true) {
    this.reasons.add(code);
    if (incrementFailureCount) this.observerFailureCount += 1;
    this.state = "FAILED";
    return this.snapshot();
  }
  persistCheckpoint() {
    if (this.state !== "SCHEDULED" && this.state !== "WARMING" && this.state !== "CAPTURING") return false;
    const semantic = {
      schemaVersion: VOLUME_FORWARD_MEASUREMENT_RUNNER_CHECKPOINT_SCHEMA,
      checkpointRevision: this.checkpointRevision + 1,
      activationId: this.schedule.activationId,
      captureId: this.schedule.captureId,
      state: this.state,
      nextCutOffset: this.nextCutOffset,
      warmupCutCount: this.warmupCutCount,
      currentSegmentIndex: this.currentSegmentIndex,
      runtimeGeneration: this.runtimeGeneration,
      lastDetectorTickRevision: this.lastDetectorTickRevision,
      lastLocalReceivedAtMs: this.lastLocalReceivedAtMs,
      lastLocalMonotonicNs: this.lastMonotonicNs === null ? null : String(this.lastMonotonicNs),
      observerFailureCount: this.observerFailureCount,
      previousCutDigest: this.previousCutDigest,
      warmupCorrelationIds: Object.freeze([...this.warmupCorrelationIds].sort()),
      acceptedProposalIds: Object.freeze([...this.acceptedProposalIds].sort()),
      acceptedCorrelationIds: Object.freeze([...this.acceptedCorrelationIds].sort()),
      consumerGate: "BLOCKED_VE2_INTERVAL_NOT_TERMINAL_ACCEPTED",
      profitabilityClaim: false
    };
    const checkpoint = deepFreeze2({
      ...semantic,
      checkpointDigest: checkpointDigest(semantic)
    });
    try {
      assertSynchronous(
        this.sink.persistRunnerCheckpoint(checkpoint),
        "DETECTOR_RUNNER_CHECKPOINT_ASYNC"
      );
    } catch {
      this.reasons.add("DETECTOR_RUNNER_CHECKPOINT_FAILED");
      this.observerFailureCount += 1;
      this.state = "FAILED";
      return false;
    }
    this.checkpointRevision = checkpoint.checkpointRevision;
    this.lastCheckpoint = checkpoint;
    return true;
  }
};
function createVolumeForwardMeasurementRunner(input) {
  const runner = new VolumeForwardMeasurementRunner(input);
  return Object.freeze({
    observe: (cut) => runner.observe(cut),
    advanceTime: (nowMs) => runner.advanceTime(nowMs),
    snapshot: () => runner.snapshot(),
    checkpoint: () => runner.checkpoint()
  });
}
export {
  VOLUME_FORWARD_MEASUREMENT_RUNNER_AUTHORITY,
  VOLUME_FORWARD_MEASUREMENT_RUNNER_CHECKPOINT_SCHEMA,
  VOLUME_FORWARD_MEASUREMENT_RUNNER_SCHEMA,
  VOLUME_FORWARD_RUNTIME_DETECTOR_CUT_SCHEMA,
  createVolumeForwardMeasurementRunner
};
