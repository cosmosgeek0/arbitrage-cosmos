import {
  EVIDENCE_KINDS,
  canonicalJson,
  makeStableFailure,
  sortedUnique,
  stableId,
  validateNoSecretFields,
  validateNormalizedEvidence,
  validateTruthMetadata,
  type EvidenceKind,
  type EvidencePolarity,
  type FeatureValue,
  type HypothesisClass,
  type InstrumentIdentity,
  type NormalizedDepth,
  type NormalizedEvidence,
  type ThesisEvidence,
  type ThesisPacket,
  type TradeabilityEvidence,
  type TruthMetadata,
  type ValidationResult,
} from '../contracts/index.js';
import { classifyHypothesis, classifyMarketStage } from './classification.js';
import { THESIS_FEATURE_BINDINGS } from './config.js';
import { derivedThesisTruth } from './truth.js';
import type {
  HypothesisClassificationInput,
  ResolvedThesisSignal,
  StageClassificationInput,
  ThesisBuildInput,
  ThesisRules,
} from './types.js';

const COMPONENT = 'intelligence_foundation_thesis';

function relatedInstrument(primary: InstrumentIdentity, candidate: InstrumentIdentity): boolean {
  if (candidate.instrumentId === primary.instrumentId) return true;
  if (candidate.venue !== primary.venue || candidate.baseAsset !== primary.baseAsset) return false;
  if (candidate.productFamily === 'BORROW') {
    return candidate.quoteAsset === null && candidate.pair === null;
  }
  return candidate.symbol === primary.symbol
    && candidate.pair === primary.pair
    && candidate.quoteAsset === primary.quoteAsset;
}

function failed(
  code: Parameters<typeof makeStableFailure>[0],
  message: string,
  field: string | null,
  evidenceIds: string[] = [],
): ValidationResult<never> {
  return { ok: false, failure: makeStableFailure(code, COMPONENT, message, field, evidenceIds) };
}

function safeTime(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 256;
}

function validateBuildInput(input: ThesisBuildInput, rules: ThesisRules): ValidationResult<true> {
  const secret = validateNoSecretFields({ input, rules }, COMPONENT);
  if (!secret.ok) return secret as ValidationResult<true>;
  if (!nonEmpty(input.candidate.id) || !nonEmpty(input.candidate.instrumentId)) {
    return failed('INVALID_VALUE', 'candidate identity is required', 'candidate');
  }
  if (
    !safeTime(input.evaluatedAtMs)
    || !safeTime(input.candidate.openedAtMs)
    || !safeTime(input.candidate.updatedAtMs)
    || input.candidate.updatedAtMs < input.candidate.openedAtMs
    || input.candidate.updatedAtMs > input.evaluatedAtMs
  ) {
    return failed('INVALID_VALUE', 'candidate and evaluation times must be ordered non-negative safe integers', 'evaluatedAtMs');
  }
  if (
    input.intendedQuoteNotional !== null
    && (!Number.isFinite(input.intendedQuoteNotional) || input.intendedQuoteNotional <= 0)
  ) {
    return failed('INVALID_VALUE', 'intended quote notional must be null or positive', 'intendedQuoteNotional');
  }
  if (input.analogueIds.some((id) => !nonEmpty(id))) {
    return failed('INVALID_VALUE', 'analogue identifiers must be non-empty', 'analogueIds');
  }
  if (input.requiredEvidenceKinds.some((kind) => !(EVIDENCE_KINDS as readonly string[]).includes(kind))) {
    return failed('INVALID_VARIANT', 'required evidence contains an unknown kind', 'requiredEvidenceKinds');
  }

  if (!nonEmpty(rules.version) || rules.version.length > 128) {
    return failed('INVALID_VALUE', 'rules version must be a non-empty bounded string', 'rules.version');
  }
  const bindingEntries = Object.entries(rules.bindings);
  const requiredBindingKeys = Object.keys(THESIS_FEATURE_BINDINGS);
  if (
    bindingEntries.length === 0
    || requiredBindingKeys.some((key) => !Object.hasOwn(rules.bindings, key))
    || bindingEntries.some(([, value]) => !nonEmpty(value))
  ) {
    return failed('INVALID_VALUE', 'every feature binding must be a non-empty string', 'rules.bindings');
  }
  const numericRuleEntries = Object.entries(rules)
    .filter(([key]) => key !== 'version' && key !== 'bindings') as Array<[string, number]>;
  if (numericRuleEntries.some(([, value]) => typeof value !== 'number' || !Number.isFinite(value))) {
    return failed('INVALID_VALUE', 'numeric rules must be finite', 'rules');
  }
  if (
    !safeTime(rules.shortWindowMs)
    || !safeTime(rules.confirmationWindowMs)
    || !safeTime(rules.mediumWindowMs)
    || rules.shortWindowMs === 0
    || rules.shortWindowMs >= rules.confirmationWindowMs
    || rules.confirmationWindowMs >= rules.mediumWindowMs
    || !safeTime(rules.leadLagTieMs)
    || !safeTime(rules.tooLateDetectionLagMs)
    || !safeTime(rules.maxFreshAgeMs)
    || rules.maxFreshAgeMs === 0
  ) {
    return failed('INVALID_VALUE', 'rules windows, lag, and freshness limits are invalid', 'rules');
  }
  const mustBeNonNegative = numericRuleEntries.filter(([key]) => ![
    'shortWindowMs',
    'confirmationWindowMs',
    'mediumWindowMs',
    'leadLagTieMs',
    'tooLateDetectionLagMs',
    'maxFreshAgeMs',
    'oiDropPct',
  ].includes(key));
  if (mustBeNonNegative.some(([, value]) => value < 0)) {
    return failed('INVALID_VALUE', 'threshold rules must be non-negative', 'rules');
  }

  const validateTruthAt = (truth: TruthMetadata, field: string): ValidationResult<true> => {
    const valid = validateTruthMetadata(truth);
    if (!valid.ok) return { ok: false, failure: valid.failure };
    const times = [
      truth.temporal.sourceEventTimeMs,
      truth.temporal.sourceTransactionTimeMs,
      truth.temporal.receivedTimeMs,
    ].filter((time): time is number => time !== null);
    if (times.some((time) => time > input.evaluatedAtMs)) {
      return failed('NO_LOOK_AHEAD_VIOLATION', 'source metadata extends beyond the evaluation cutoff', field);
    }
    return { ok: true, value: true };
  };

  const candidateTruth = validateTruthAt(input.candidate.truth, 'candidate.truth');
  if (!candidateTruth.ok) return candidateTruth;
  if (input.baseline !== null) {
    if (!nonEmpty(input.baseline.id) || input.baseline.instrumentId !== input.candidate.instrumentId) {
      return failed('INVALID_VALUE', 'baseline identity must match the candidate instrument', 'baseline.instrumentId');
    }
    const baselineTruth = validateTruthAt(input.baseline.truth, 'baseline.truth');
    if (!baselineTruth.ok) return baselineTruth;
  }

  const allFeatures = [
    ...input.features,
    ...(input.baseline?.normalActivity ?? []),
    ...(input.baseline?.deadActivity ?? []),
  ];
  const inputFeatureIds = new Set<string>();
  for (let index = 0; index < allFeatures.length; index += 1) {
    const feature = allFeatures[index];
    const field = `features[${index}]`;
    if (
      !nonEmpty(feature.id)
      || !nonEmpty(feature.instrumentId)
      || !nonEmpty(feature.feature)
      || !nonEmpty(feature.featureVersion)
      || !nonEmpty(feature.unit)
      || !(feature.windowMs === null || safeTime(feature.windowMs) && feature.windowMs > 0)
      || !(feature.observationStartMs === null || safeTime(feature.observationStartMs))
      || !(feature.observationEndMs === null || safeTime(feature.observationEndMs))
      || (feature.observationStartMs !== null && feature.observationEndMs !== null
        && feature.observationStartMs > feature.observationEndMs)
      || (feature.observationEndMs !== null && feature.observationEndMs > input.evaluatedAtMs)
      || (typeof feature.value === 'number' && !Number.isFinite(feature.value))
    ) {
      return failed('INVALID_VALUE', 'feature metadata or value is invalid', field, [feature.id]);
    }
    const featureTruth = validateTruthAt(feature.truth, `${field}.truth`);
    if (!featureTruth.ok) return featureTruth;
    if (feature.instrumentId !== input.candidate.instrumentId) {
      return failed('INVALID_VALUE', 'cross-instrument features are not accepted', `${field}.instrumentId`, [feature.id]);
    }
    if (index < input.features.length) {
      if (inputFeatureIds.has(feature.id)) return failed('INVALID_VALUE', 'duplicate feature identifier', `${field}.id`, [feature.id]);
      inputFeatureIds.add(feature.id);
    }
  }

  const evidenceIds = new Set<string>();
  const validatedEvidence: NormalizedEvidence[] = [];
  for (let index = 0; index < input.evidence.length; index += 1) {
    const evidence = input.evidence[index];
    const valid = validateNormalizedEvidence(evidence);
    if (!valid.ok) return valid as ValidationResult<true>;
    const evidenceTruth = validateTruthAt(evidence.truth, `evidence[${index}].truth`);
    if (!evidenceTruth.ok) return evidenceTruth;
    if (evidenceIds.has(evidence.id)) return failed('INVALID_VALUE', 'duplicate evidence identifier', `evidence[${index}].id`, [evidence.id]);
    evidenceIds.add(evidence.id);
    validatedEvidence.push(valid.value);
  }
  const primaryInstrument = validatedEvidence.find((evidence) =>
    evidence.instrument.instrumentId === input.candidate.instrumentId)?.instrument ?? null;
  for (let index = 0; index < validatedEvidence.length; index += 1) {
    const evidence = validatedEvidence[index];
    if (evidence.instrument.instrumentId === input.candidate.instrumentId) continue;
    if (primaryInstrument === null || !relatedInstrument(primaryInstrument, evidence.instrument)) {
      return failed('INVALID_VALUE', 'evidence is outside the candidate market scope', `evidence[${index}].instrument`, [evidence.id]);
    }
  }
  return { ok: true, value: true };
}

function freshnessBasisTime(truth: TruthMetadata): number | null {
  if (truth.freshness.basis === 'SOURCE_EVENT_TIME') return truth.temporal.sourceEventTimeMs;
  if (truth.freshness.basis === 'SOURCE_TRANSACTION_TIME') return truth.temporal.sourceTransactionTimeMs;
  if (truth.freshness.basis === 'RECEIVE_TIME') return truth.temporal.receivedTimeMs;
  return null;
}

function truthUsable(truth: TruthMetadata, evaluatedAtMs: number, maxFreshAgeMs: number): boolean {
  if (truth.freshness.state !== 'FRESH' || truth.completeness.state !== 'COMPLETE') return false;
  const basisTime = freshnessBasisTime(truth);
  if (basisTime === null || basisTime > evaluatedAtMs) return false;
  const declaredMaximum = truth.freshness.maxAgeMs ?? maxFreshAgeMs;
  return evaluatedAtMs - basisTime <= Math.min(maxFreshAgeMs, declaredMaximum);
}

function unavailableSignal(reasonCodes: readonly string[], truths: readonly TruthMetadata[] = []): ResolvedThesisSignal {
  return {
    state: 'UNAVAILABLE',
    value: null,
    featureIds: [],
    observationStartMs: null,
    observationEndMs: null,
    reasonCodes: sortedUnique(reasonCodes),
    truths: [...truths],
  };
}

function resolveFeature(
  features: readonly FeatureValue[],
  instrumentId: string,
  featureName: string,
  windowMs: number | null,
  evaluatedAtMs: number,
  maxFreshAgeMs: number,
): ResolvedThesisSignal {
  const matches = features
    .filter((feature) => feature.instrumentId === instrumentId && feature.feature === featureName && feature.windowMs === windowMs)
    .sort((left, right) => {
      const leftTime = left.observationEndMs ?? -1;
      const rightTime = right.observationEndMs ?? -1;
      if (leftTime !== rightTime) return rightTime - leftTime;
      return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
    });
  if (matches.length === 0) return unavailableSignal(['FEATURE_BINDING_NOT_OBSERVED']);
  const newestTime = matches[0].observationEndMs;
  const newest = matches.filter((feature) => feature.observationEndMs === newestTime);
  const distinctValues = sortedUnique(newest.map((feature) => canonicalJson(feature.value)));
  if (distinctValues.length > 1) {
    return {
      state: 'UNAVAILABLE',
      value: null,
      featureIds: sortedUnique(newest.map((feature) => feature.id)),
      observationStartMs: minimum(newest.map((feature) => feature.observationStartMs)),
      observationEndMs: newestTime,
      reasonCodes: ['AMBIGUOUS_SAME_TIME_FEATURE_VALUES'],
      truths: newest.map((feature) => feature.truth),
    };
  }
  const selected = newest[0];
  if (selected.value === null) {
    return {
      state: 'UNAVAILABLE',
      value: null,
      featureIds: [selected.id],
      observationStartMs: selected.observationStartMs,
      observationEndMs: selected.observationEndMs,
      reasonCodes: ['FEATURE_VALUE_UNAVAILABLE'],
      truths: [selected.truth],
    };
  }
  if (!truthUsable(selected.truth, evaluatedAtMs, maxFreshAgeMs)) {
    return {
      state: 'UNAVAILABLE',
      value: null,
      featureIds: [selected.id],
      observationStartMs: selected.observationStartMs,
      observationEndMs: selected.observationEndMs,
      reasonCodes: ['FEATURE_NOT_FRESH_AND_COMPLETE'],
      truths: [selected.truth],
    };
  }
  return {
    state: 'AVAILABLE',
    value: selected.value,
    featureIds: [selected.id],
    observationStartMs: selected.observationStartMs,
    observationEndMs: selected.observationEndMs,
    reasonCodes: [],
    truths: [selected.truth],
  };
}

function numberOf(signal: ResolvedThesisSignal): number | null {
  return signal.state === 'AVAILABLE' && typeof signal.value === 'number' && Number.isFinite(signal.value)
    ? signal.value
    : null;
}

function booleanOf(signal: ResolvedThesisSignal): boolean | null {
  if (signal.state !== 'AVAILABLE') return null;
  if (typeof signal.value === 'boolean') return signal.value;
  if (typeof signal.value === 'number') return signal.value === 1 ? true : signal.value === 0 ? false : null;
  if (typeof signal.value !== 'string') return null;
  const normalized = signal.value.trim().toUpperCase();
  if (['TRUE', 'YES', 'DEAD'].includes(normalized)) return true;
  if (['FALSE', 'NO', 'ACTIVE'].includes(normalized)) return false;
  return null;
}

function maximum(values: readonly (number | null)[]): number | null {
  const available = values.filter((value): value is number => value !== null);
  return available.length === 0 ? null : Math.max(...available);
}

function minimum(values: readonly (number | null)[]): number | null {
  const available = values.filter((value): value is number => value !== null);
  return available.length === 0 ? null : Math.min(...available);
}

function firstNumber(...signals: ResolvedThesisSignal[]): number | null {
  for (const signal of signals) {
    const value = numberOf(signal);
    if (value !== null) return value;
  }
  return null;
}

function observationTime(signal: ResolvedThesisSignal): number | null {
  if (signal.observationEndMs !== null) return signal.observationEndMs;
  for (const truth of signal.truths) {
    const time = truth.temporal.sourceEventTimeMs ?? truth.temporal.sourceTransactionTimeMs;
    if (time !== null) return time;
  }
  return null;
}

function evidenceObservationTime(evidence: NormalizedEvidence): number | null {
  return evidence.truth.temporal.sourceEventTimeMs ?? evidence.truth.temporal.sourceTransactionTimeMs;
}

interface ChangeEvent {
  label: string;
  market: 'SPOT' | 'PERPETUAL' | 'OTHER';
  timeMs: number;
  signal: ResolvedThesisSignal;
}

function addChange(
  events: ChangeEvent[],
  signal: ResolvedThesisSignal,
  predicate: (value: number) => boolean,
  label: string,
  market: ChangeEvent['market'],
): void {
  const value = numberOf(signal);
  const timeMs = observationTime(signal);
  if (value !== null && timeMs !== null && predicate(value)) events.push({ label, market, timeMs, signal });
}

function activityState(activity: number | null, acceleration: number | null, rules: ThesisRules): boolean | null {
  if (activity === null && acceleration === null) return null;
  return (activity !== null && activity >= rules.activityMultiple)
    || (acceleration !== null && acceleration >= rules.arrivalAcceleration);
}

function persistentActivity(states: readonly (boolean | null)[]): boolean | null {
  const available = states.filter((state): state is boolean => state !== null);
  if (available.length < 2) return null;
  return available.filter(Boolean).length >= 2;
}

export function buildThesisPacket(input: ThesisBuildInput, rules: ThesisRules): ValidationResult<ThesisPacket> {
  const valid = validateBuildInput(input, rules);
  if (!valid.ok) return valid;

  const resolve = (name: string, windowMs: number | null): ResolvedThesisSignal => resolveFeature(
    input.features,
    input.candidate.instrumentId,
    name,
    windowMs,
    input.evaluatedAtMs,
    rules.maxFreshAgeMs,
  );
  const bindings = rules.bindings;

  const spotRelativeShort = resolve(bindings.spotRelativeVolume, rules.shortWindowMs);
  const spotRelativeConfirmation = resolve(bindings.spotRelativeVolume, rules.confirmationWindowMs);
  const spotRelativeMedium = resolve(bindings.spotRelativeVolume, rules.mediumWindowMs);
  const perpetualRelativeShort = resolve(bindings.perpetualRelativeVolume, rules.shortWindowMs);
  const perpetualRelativeConfirmation = resolve(bindings.perpetualRelativeVolume, rules.confirmationWindowMs);
  const perpetualRelativeMedium = resolve(bindings.perpetualRelativeVolume, rules.mediumWindowMs);
  const spotArrivalShort = resolve(bindings.spotArrivalAcceleration, rules.shortWindowMs);
  const spotArrivalConfirmation = resolve(bindings.spotArrivalAcceleration, rules.confirmationWindowMs);
  const spotArrivalMedium = resolve(bindings.spotArrivalAcceleration, rules.mediumWindowMs);
  const perpetualArrivalShort = resolve(bindings.perpetualArrivalAcceleration, rules.shortWindowMs);
  const perpetualArrivalConfirmation = resolve(bindings.perpetualArrivalAcceleration, rules.confirmationWindowMs);
  const perpetualArrivalMedium = resolve(bindings.perpetualArrivalAcceleration, rules.mediumWindowMs);

  const symbolReturnShort = resolve(bindings.symbolReturnPct, rules.shortWindowMs);
  const symbolReturnConfirmation = resolve(bindings.symbolReturnPct, rules.confirmationWindowMs);
  const symbolReturnMedium = resolve(bindings.symbolReturnPct, rules.mediumWindowMs);
  const spotReturnShort = resolve(bindings.spotReturnPct, rules.shortWindowMs);
  const spotReturnConfirmation = resolve(bindings.spotReturnPct, rules.confirmationWindowMs);
  const spotReturnMedium = resolve(bindings.spotReturnPct, rules.mediumWindowMs);
  const perpetualReturnShort = resolve(bindings.perpetualReturnPct, rules.shortWindowMs);
  const perpetualReturnConfirmation = resolve(bindings.perpetualReturnPct, rules.confirmationWindowMs);
  const perpetualReturnMedium = resolve(bindings.perpetualReturnPct, rules.mediumWindowMs);

  const aggressorImbalance = resolve(bindings.aggressorImbalance, rules.confirmationWindowMs);
  const priceResponsePerFlow = resolve(bindings.priceResponsePerFlow, rules.confirmationWindowMs);
  const depthSupportRatio = resolve(bindings.depthSupportRatio, rules.confirmationWindowMs);
  const depthChangeRatio = resolve(bindings.depthChangeRatio, rules.confirmationWindowMs);
  const spreadChangeBps = resolve(bindings.spreadChangeBps, rules.confirmationWindowMs);
  const replenishmentRatio = resolve(bindings.replenishmentRatio, rules.confirmationWindowMs);
  const absorptionRatio = resolve(bindings.absorptionRatio, rules.confirmationWindowMs);
  const fundingRateChange = resolve(bindings.fundingRateChange, rules.confirmationWindowMs);
  const openInterestChangePct = resolve(bindings.openInterestChangePct, rules.confirmationWindowMs);
  const liquidationFlowShare = resolve(bindings.liquidationFlowShare, rules.confirmationWindowMs);
  const marketParticipationRatio = resolve(bindings.marketParticipationRatio, rules.confirmationWindowMs);
  const symbolMarketResidualReturnPct = resolve(bindings.symbolMarketResidualReturnPct, rules.confirmationWindowMs);
  const fadeFromPeakPct = resolve(bindings.fadeFromPeakPct, rules.confirmationWindowMs);
  const historicalAnalogueCount = resolve(bindings.historicalAnalogueCount, null);
  const tradeSizeRepeatRatio = resolve(bindings.tradeSizeRepeatRatio, rules.confirmationWindowMs);
  const sideAlternationRatio = resolve(bindings.sideAlternationRatio, rules.confirmationWindowMs);

  let deadBaselineFlag: ResolvedThesisSignal;
  if (input.baseline === null) {
    deadBaselineFlag = unavailableSignal(['BASELINE_UNAVAILABLE']);
  } else if (input.baseline.state !== 'READY') {
    deadBaselineFlag = unavailableSignal([`BASELINE_${input.baseline.state}`], [input.baseline.truth]);
  } else {
    deadBaselineFlag = resolveFeature(
      input.features,
      input.candidate.instrumentId,
      bindings.deadBaselineFlag,
      null,
      input.evaluatedAtMs,
      rules.maxFreshAgeMs,
    );
  }

  const events: ChangeEvent[] = [];
  const activityPredicate = (value: number): boolean => value >= rules.activityMultiple;
  const accelerationPredicate = (value: number): boolean => value >= rules.arrivalAcceleration;
  for (const signal of [spotRelativeShort, spotRelativeConfirmation, spotRelativeMedium]) {
    addChange(events, signal, activityPredicate, 'SPOT_ACTIVITY', 'SPOT');
  }
  for (const signal of [spotArrivalShort, spotArrivalConfirmation, spotArrivalMedium]) {
    addChange(events, signal, accelerationPredicate, 'SPOT_ACTIVITY', 'SPOT');
  }
  for (const signal of [perpetualRelativeShort, perpetualRelativeConfirmation, perpetualRelativeMedium]) {
    addChange(events, signal, activityPredicate, 'PERPETUAL_ACTIVITY', 'PERPETUAL');
  }
  for (const signal of [perpetualArrivalShort, perpetualArrivalConfirmation, perpetualArrivalMedium]) {
    addChange(events, signal, accelerationPredicate, 'PERPETUAL_ACTIVITY', 'PERPETUAL');
  }
  for (const signal of [
    symbolReturnShort,
    symbolReturnConfirmation,
    symbolReturnMedium,
    spotReturnShort,
    spotReturnConfirmation,
    spotReturnMedium,
    perpetualReturnShort,
    perpetualReturnConfirmation,
    perpetualReturnMedium,
  ]) {
    addChange(events, signal, (value) => Math.abs(value) >= rules.visibleMovePct, 'PRICE_MOVE', 'OTHER');
  }
  addChange(events, aggressorImbalance, (value) => Math.abs(value) >= rules.flowImbalanceAbs, 'AGGRESSOR_FLOW', 'OTHER');
  addChange(events, depthSupportRatio, (value) => value < rules.depthSupportRatio, 'DEPTH_WEAKENING', 'OTHER');
  addChange(events, depthChangeRatio, (value) => value <= rules.depthCollapseRatio, 'DEPTH_WEAKENING', 'OTHER');
  addChange(events, liquidationFlowShare, (value) => value >= rules.liquidationFlowShare, 'LIQUIDATION_FLOW', 'PERPETUAL');
  events.sort((left, right) => left.timeMs - right.timeMs
    || (left.label < right.label ? -1 : left.label > right.label ? 1 : 0)
    || (left.signal.featureIds[0] ?? '').localeCompare(right.signal.featureIds[0] ?? ''));

  const changedAtMs = events[0]?.timeMs ?? null;
  const firstLabels = changedAtMs === null
    ? []
    : sortedUnique(events.filter((event) => event.timeMs === changedAtMs).map((event) => event.label));
  const changedFirst = firstLabels.length === 0
    ? null
    : firstLabels.length === 1
      ? firstLabels[0]
      : `MULTIPLE:${firstLabels.join('+')}`;
  const spotChangedAt = minimum(events.filter((event) => event.market === 'SPOT').map((event) => event.timeMs));
  const perpetualChangedAt = minimum(events.filter((event) => event.market === 'PERPETUAL').map((event) => event.timeMs));
  const leadMarket: ThesisPacket['leadMarket'] = spotChangedAt === null || perpetualChangedAt === null
    ? 'UNKNOWN'
    : Math.abs(spotChangedAt - perpetualChangedAt) <= rules.leadLagTieMs
      ? 'NEITHER'
      : spotChangedAt < perpetualChangedAt
        ? 'SPOT'
        : 'PERPETUAL';

  const shortActivityMultiple = maximum([numberOf(spotRelativeShort), numberOf(perpetualRelativeShort)]);
  const confirmationActivityMultiple = maximum([numberOf(spotRelativeConfirmation), numberOf(perpetualRelativeConfirmation)]);
  const mediumActivityMultiple = maximum([numberOf(spotRelativeMedium), numberOf(perpetualRelativeMedium)]);
  const shortArrivalAcceleration = maximum([numberOf(spotArrivalShort), numberOf(perpetualArrivalShort)]);
  const confirmationArrivalAcceleration = maximum([numberOf(spotArrivalConfirmation), numberOf(perpetualArrivalConfirmation)]);
  const mediumArrivalAcceleration = maximum([numberOf(spotArrivalMedium), numberOf(perpetualArrivalMedium)]);
  const shortMovePct = firstNumber(symbolReturnShort, spotReturnShort, perpetualReturnShort);
  const confirmationMovePct = firstNumber(symbolReturnConfirmation, spotReturnConfirmation, perpetualReturnConfirmation);
  const mediumMovePct = firstNumber(symbolReturnMedium, spotReturnMedium, perpetualReturnMedium);
  const activityStates = [
    activityState(shortActivityMultiple, shortArrivalAcceleration, rules),
    activityState(confirmationActivityMultiple, confirmationArrivalAcceleration, rules),
    activityState(mediumActivityMultiple, mediumArrivalAcceleration, rules),
  ];
  const activityPersists = persistentActivity(activityStates);
  const spotActivityStates = [
    activityState(numberOf(spotRelativeShort), numberOf(spotArrivalShort), rules),
    activityState(numberOf(spotRelativeConfirmation), numberOf(spotArrivalConfirmation), rules),
    activityState(numberOf(spotRelativeMedium), numberOf(spotArrivalMedium), rules),
  ];
  const knownSpotActivity = spotActivityStates.filter((state): state is boolean => state !== null);
  const spotActivityHot = knownSpotActivity.length === 0 ? null : knownSpotActivity.some(Boolean);
  const visibleMove = confirmationMovePct === null && mediumMovePct === null
    ? null
    : Math.max(Math.abs(confirmationMovePct ?? 0), Math.abs(mediumMovePct ?? 0)) >= rules.visibleMovePct;

  const stageInput: StageClassificationInput = {
    baselineReady: input.baseline?.state === 'READY',
    shortMovePct,
    confirmationMovePct,
    mediumMovePct,
    shortActivityMultiple,
    confirmationActivityMultiple,
    mediumActivityMultiple,
    shortArrivalAcceleration,
    confirmationArrivalAcceleration,
    mediumArrivalAcceleration,
    aggressorImbalance: numberOf(aggressorImbalance),
    depthSupportRatio: numberOf(depthSupportRatio),
    depthChangeRatio: numberOf(depthChangeRatio),
    spreadChangeBps: numberOf(spreadChangeBps),
    fadeFromPeakPct: numberOf(fadeFromPeakPct),
    candidateOpenedAtMs: input.candidate.openedAtMs,
    changedAtMs,
  };
  const stageAssessment = classifyMarketStage(stageInput, rules);

  const hypothesisInput: HypothesisClassificationInput = {
    stage: stageAssessment.stage,
    leadMarket,
    deadBaseline: booleanOf(deadBaselineFlag),
    spotActivityHot,
    persistentActivity: activityPersists,
    visibleMove,
    aggressorImbalance: numberOf(aggressorImbalance),
    priceResponsePerFlow: numberOf(priceResponsePerFlow),
    depthSupportRatio: numberOf(depthSupportRatio),
    depthChangeRatio: numberOf(depthChangeRatio),
    replenishmentRatio: numberOf(replenishmentRatio),
    absorptionRatio: numberOf(absorptionRatio),
    fundingRateChange: numberOf(fundingRateChange),
    openInterestChangePct: numberOf(openInterestChangePct),
    liquidationFlowShare: numberOf(liquidationFlowShare),
    marketParticipationRatio: numberOf(marketParticipationRatio),
    symbolMarketResidualReturnPct: numberOf(symbolMarketResidualReturnPct),
    tradeSizeRepeatRatio: numberOf(tradeSizeRepeatRatio),
    sideAlternationRatio: numberOf(sideAlternationRatio),
  };
  const hypothesisAssessment = classifyHypothesis(hypothesisInput, rules);

  const primaryInstrument = input.evidence.find((evidence) =>
    evidence.instrument.instrumentId === input.candidate.instrumentId)?.instrument ?? null;
  const scopedEvidence = input.evidence
    .filter((evidence) => primaryInstrument !== null && relatedInstrument(primaryInstrument, evidence.instrument))
    .sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
  const usableScopedEvidence = scopedEvidence.filter((evidence) => truthUsable(
    evidence.truth,
    input.evaluatedAtMs,
    rules.maxFreshAgeMs,
  ));
  const evidenceByKinds = (kinds: readonly EvidenceKind[]): NormalizedEvidence[] => usableScopedEvidence
    .filter((evidence) => kinds.includes(evidence.kind))
    .slice(0, 512);

  const changeSignals = sortedUnique(events.map((event) => event.signal.featureIds[0]).filter((id): id is string => id !== undefined))
    .map((id) => events.find((event) => event.signal.featureIds.includes(id))?.signal)
    .filter((signal): signal is ResolvedThesisSignal => signal !== undefined);
  const activitySignals = [
    spotRelativeShort, spotRelativeConfirmation, spotRelativeMedium,
    perpetualRelativeShort, perpetualRelativeConfirmation, perpetualRelativeMedium,
    spotArrivalShort, spotArrivalConfirmation, spotArrivalMedium,
    perpetualArrivalShort, perpetualArrivalConfirmation, perpetualArrivalMedium,
  ];
  const returnSignals = [
    symbolReturnShort, symbolReturnConfirmation, symbolReturnMedium,
    spotReturnShort, spotReturnConfirmation, spotReturnMedium,
    perpetualReturnShort, perpetualReturnConfirmation, perpetualReturnMedium,
  ];
  const depthSignals = [depthSupportRatio, depthChangeRatio, spreadChangeBps, replenishmentRatio, absorptionRatio];
  const derivativeSignals = [fundingRateChange, openInterestChangePct, liquidationFlowShare];
  const allSignals = [
    ...activitySignals,
    ...returnSignals,
    aggressorImbalance,
    priceResponsePerFlow,
    ...depthSignals,
    ...derivativeSignals,
    marketParticipationRatio,
    symbolMarketResidualReturnPct,
    fadeFromPeakPct,
    historicalAnalogueCount,
    tradeSizeRepeatRatio,
    sideAlternationRatio,
    deadBaselineFlag,
  ];

  const makeEvidence = (args: {
    key: string;
    fact: string;
    polarity: EvidencePolarity;
    reasonCode: string;
    signals: readonly ResolvedThesisSignal[];
    kinds: readonly EvidenceKind[];
    extraTruths?: readonly TruthMetadata[];
    extraRecordIds?: readonly string[];
  }): ThesisEvidence => {
    const records = evidenceByKinds(args.kinds);
    const usableSignals = args.signals.filter((signal) => signal.state === 'AVAILABLE');
    const featureIds = sortedUnique(usableSignals.flatMap((signal) => signal.featureIds));
    const evidenceIds = sortedUnique(records.map((record) => record.id));
    const signalStarts = usableSignals.map((signal) => signal.observationStartMs);
    const signalEnds = usableSignals.map((signal) => signal.observationEndMs);
    const evidenceTimes = records.map(evidenceObservationTime);
    const observationStartMs = minimum([...signalStarts, ...evidenceTimes]);
    const observationEndMs = maximum([...signalEnds, ...evidenceTimes]);
    const truths = [
      input.candidate.truth,
      ...usableSignals.flatMap((signal) => signal.truths),
      ...records.map((record) => record.truth),
      ...(args.extraTruths ?? []).filter((truth) => truthUsable(
        truth,
        input.evaluatedAtMs,
        rules.maxFreshAgeMs,
      )),
    ];
    const truth = derivedThesisTruth({
      dataset: `thesis-evidence-${args.key.toLowerCase()}`,
      rulesVersion: rules.version,
      evaluatedAtMs: input.evaluatedAtMs,
      maxFreshAgeMs: rules.maxFreshAgeMs,
      truths,
      recordIds: [input.candidate.id, ...featureIds, ...evidenceIds, ...(args.extraRecordIds ?? [])],
      transforms: [args.key, args.reasonCode],
      observedFields: args.polarity === 'UNAVAILABLE' ? [] : [args.key],
      missingFields: args.polarity === 'UNAVAILABLE' ? [args.key] : [],
      reasonCodes: [args.reasonCode, ...args.signals.flatMap((signal) => signal.reasonCodes)],
    });
    return {
      id: stableId('thesis-evidence', {
        candidateId: input.candidate.id,
        rulesVersion: rules.version,
        key: args.key,
        polarity: args.polarity,
        reasonCode: args.reasonCode,
        featureIds,
        evidenceIds,
        extraRecordIds: sortedUnique(args.extraRecordIds ?? []),
        observationStartMs,
        observationEndMs,
      }),
      fact: args.fact,
      polarity: args.polarity,
      reasonCode: args.reasonCode,
      featureIds,
      evidenceIds,
      observationStartMs,
      observationEndMs,
      truth,
    };
  };

  const hypothesis = hypothesisAssessment.hypothesis;
  const expansionHypotheses: readonly HypothesisClass[] = [
    'DEAD_VOLUME_WAKEUP',
    'ACCUMULATION_TO_EXPANSION',
    'SPOT_LED_EXPANSION',
    'PERPETUAL_LED_SQUEEZE',
    'LIQUIDATION_DRIVEN_MOVE',
  ];
  const symbolSpecificHypotheses: readonly HypothesisClass[] = [
    ...expansionHypotheses,
    'THIN_BOOK_DISLOCATION',
    'CHURN_WITHOUT_FOLLOW_THROUGH',
  ];
  const facts: ThesisEvidence[] = [];

  facts.push(makeEvidence({
    key: 'CHANGE_SEQUENCE',
    fact: changedAtMs === null
      ? 'No qualifying source-time change sequence is available.'
      : `The earliest qualifying source-time change is ${changedFirst} at ${changedAtMs}.`,
    polarity: changedAtMs === null ? 'UNAVAILABLE' : hypothesis === 'UNCLASSIFIED_ANOMALY' ? 'NEUTRAL' : 'SUPPORTING',
    reasonCode: changedAtMs === null ? 'CHANGE_SEQUENCE_UNAVAILABLE' : 'CHANGE_SEQUENCE_OBSERVED',
    signals: changeSignals,
    kinds: ['TRADE', 'BOOK_TICKER', 'DEPTH_SNAPSHOT', 'FUNDING', 'OPEN_INTEREST', 'LIQUIDATION'],
  }));

  const expectedLead = hypothesis === 'SPOT_LED_EXPANSION'
    ? 'SPOT'
    : ['PERPETUAL_LED_SQUEEZE', 'LIQUIDATION_DRIVEN_MOVE'].includes(hypothesis)
      ? 'PERPETUAL'
      : hypothesis === 'MARKET_WIDE_BETA_MOVE'
        ? 'NEITHER'
        : null;
  const leadPolarity: EvidencePolarity = leadMarket === 'UNKNOWN'
    ? 'UNAVAILABLE'
    : expectedLead === null
      ? 'NEUTRAL'
      : leadMarket === expectedLead
        ? 'SUPPORTING'
        : 'CONFLICTING';
  facts.push(makeEvidence({
    key: 'LEAD_MARKET',
    fact: leadMarket === 'UNKNOWN'
      ? 'A spot-versus-perpetual lead cannot be established from usable source times.'
      : leadMarket === 'NEITHER'
        ? 'Spot and perpetual changes are within the configured tie interval.'
        : `${leadMarket} changed first across the paired market observations.`,
    polarity: leadPolarity,
    reasonCode: leadMarket === 'UNKNOWN'
      ? 'LEAD_MARKET_UNAVAILABLE'
      : leadMarket === 'NEITHER'
        ? 'LEAD_MARKET_TIED'
        : `LEAD_MARKET_${leadMarket}`,
    signals: activitySignals,
    kinds: ['TRADE', 'MARK_PRICE'],
  }));

  const persistenceExpected = expansionHypotheses.includes(hypothesis)
    || hypothesis === 'CHURN_WITHOUT_FOLLOW_THROUGH'
    || hypothesis === 'ACCUMULATION_TO_EXPANSION';
  const persistencePolarity: EvidencePolarity = activityPersists === null
    ? 'UNAVAILABLE'
    : !persistenceExpected
      ? 'NEUTRAL'
      : activityPersists
        ? 'SUPPORTING'
        : 'CONFLICTING';
  facts.push(makeEvidence({
    key: 'FLOW_PERSISTENCE',
    fact: activityPersists === null
      ? 'Cross-window activity persistence is unavailable.'
      : activityPersists
        ? 'Elevated activity persists across at least two configured windows.'
        : 'Elevated activity does not persist across two configured windows.',
    polarity: persistencePolarity,
    reasonCode: activityPersists === null
      ? 'FLOW_PERSISTENCE_UNAVAILABLE'
      : activityPersists
        ? 'FLOW_PERSISTS_ACROSS_WINDOWS'
        : 'FLOW_DOES_NOT_PERSIST',
    signals: activitySignals,
    kinds: ['TRADE'],
  }));

  const response = numberOf(priceResponsePerFlow);
  const lowResponse = response === null ? null : Math.abs(response) <= rules.lowPriceResponsePerFlow;
  const responseExpectedLow = hypothesis === 'CHURN_WITHOUT_FOLLOW_THROUGH';
  const responseExpectedHigh = expansionHypotheses.includes(hypothesis);
  const responsePolarity: EvidencePolarity = lowResponse === null
    ? 'UNAVAILABLE'
    : responseExpectedLow
      ? lowResponse ? 'SUPPORTING' : 'CONFLICTING'
      : responseExpectedHigh
        ? lowResponse ? 'CONFLICTING' : 'SUPPORTING'
        : 'NEUTRAL';
  facts.push(makeEvidence({
    key: 'PRICE_RESPONSE',
    fact: response === null
      ? 'Price response per unit of aggressive flow is unavailable.'
      : `Observed price response per unit of aggressive flow is ${response}.`,
    polarity: responsePolarity,
    reasonCode: response === null
      ? 'PRICE_RESPONSE_UNAVAILABLE'
      : lowResponse
        ? 'PRICE_RESPONSE_LOW'
        : 'PRICE_RESPONSE_PRESENT',
    signals: [priceResponsePerFlow, aggressorImbalance, ...returnSignals],
    kinds: ['TRADE', 'BOOK_TICKER'],
  }));

  const support = numberOf(depthSupportRatio);
  const depthChange = numberOf(depthChangeRatio);
  const weakDepth = support === null && depthChange === null
    ? null
    : (support !== null && support < rules.depthSupportRatio)
      || (depthChange !== null && depthChange <= rules.depthCollapseRatio);
  const depthPolarity: EvidencePolarity = weakDepth === null
    ? 'UNAVAILABLE'
    : hypothesis === 'THIN_BOOK_DISLOCATION'
      ? weakDepth ? 'SUPPORTING' : 'CONFLICTING'
      : expansionHypotheses.includes(hypothesis) || hypothesis === 'ACCUMULATION_TO_EXPANSION'
        ? weakDepth ? 'CONFLICTING' : 'SUPPORTING'
        : 'NEUTRAL';
  facts.push(makeEvidence({
    key: 'DEPTH_SUPPORT',
    fact: weakDepth === null
      ? input.intendedQuoteNotional === null
        ? 'Depth support is unavailable and an intended quote size was not supplied.'
        : `Depth support for intended quote size ${input.intendedQuoteNotional} is unavailable.`
      : weakDepth
        ? input.intendedQuoteNotional === null
          ? 'Observed depth is weak or has collapsed relative to its reference state.'
          : `Observed depth does not support intended quote size ${input.intendedQuoteNotional} at the configured threshold.`
        : input.intendedQuoteNotional === null
          ? 'Observed depth meets the configured support threshold; intended quote size remains unspecified.'
          : `Observed depth supports intended quote size ${input.intendedQuoteNotional} at the configured threshold.`,
    polarity: depthPolarity,
    reasonCode: weakDepth === null ? 'DEPTH_SUPPORT_UNAVAILABLE' : weakDepth ? 'DEPTH_WEAK_OR_COLLAPSED' : 'DEPTH_SUPPORT_PRESENT',
    signals: depthSignals,
    kinds: ['BOOK_TICKER', 'DEPTH_SNAPSHOT', 'DEPTH_DELTA'],
  }));

  const participation = numberOf(marketParticipationRatio);
  const residual = numberOf(symbolMarketResidualReturnPct);
  const marketWide = participation === null || residual === null
    ? null
    : participation >= rules.marketParticipationRatio && Math.abs(residual) <= rules.maxSymbolResidualPct;
  const specificityPolarity: EvidencePolarity = marketWide === null
    ? 'UNAVAILABLE'
    : hypothesis === 'MARKET_WIDE_BETA_MOVE'
      ? marketWide ? 'SUPPORTING' : 'CONFLICTING'
      : symbolSpecificHypotheses.includes(hypothesis)
        ? marketWide ? 'CONFLICTING' : 'SUPPORTING'
        : 'NEUTRAL';
  facts.push(makeEvidence({
    key: 'SYMBOL_SPECIFICITY',
    fact: marketWide === null
      ? 'Market participation or symbol residual evidence is unavailable.'
      : marketWide
        ? 'Broad participation and a small symbol residual indicate a market-wide move.'
        : 'The move is not explained by broad participation with a small symbol residual.',
    polarity: specificityPolarity,
    reasonCode: marketWide === null ? 'SYMBOL_SPECIFICITY_UNAVAILABLE' : marketWide ? 'MARKET_WIDE_PATTERN' : 'SYMBOL_SPECIFIC_PATTERN',
    signals: [marketParticipationRatio, symbolMarketResidualReturnPct],
    kinds: ['CONTEXT'],
  }));

  const funding = numberOf(fundingRateChange);
  const openInterest = numberOf(openInterestChangePct);
  const liquidations = numberOf(liquidationFlowShare);
  const derivativeObserved = [funding, openInterest, liquidations].some((value) => value !== null);
  const derivativeAlignmentCount = [
    funding !== null && Math.abs(funding) >= rules.fundingChangeAbs,
    openInterest !== null && Math.abs(openInterest) >= rules.oiChangeAbs,
    liquidations !== null && liquidations >= rules.liquidationFlowShare / 2,
  ].filter(Boolean).length;
  const derivativeExpected = ['PERPETUAL_LED_SQUEEZE', 'LIQUIDATION_DRIVEN_MOVE'].includes(hypothesis);
  const derivativesPolarity: EvidencePolarity = !derivativeObserved
    ? 'UNAVAILABLE'
    : derivativeExpected
      ? derivativeAlignmentCount >= 2 ? 'SUPPORTING' : 'CONFLICTING'
      : hypothesis === 'SPOT_LED_EXPANSION' && derivativeAlignmentCount >= 2
        ? 'CONFLICTING'
        : 'NEUTRAL';
  facts.push(makeEvidence({
    key: 'DERIVATIVES_ALIGNMENT',
    fact: !derivativeObserved
      ? 'Funding, open-interest, and liquidation alignment is unavailable.'
      : `${derivativeAlignmentCount} derivative evidence categories meet their configured change thresholds.`,
    polarity: derivativesPolarity,
    reasonCode: !derivativeObserved
      ? 'DERIVATIVES_ALIGNMENT_UNAVAILABLE'
      : derivativeAlignmentCount >= 2
        ? 'DERIVATIVES_ALIGNED'
        : 'DERIVATIVES_NOT_ALIGNED',
    signals: derivativeSignals,
    kinds: ['MARK_PRICE', 'FUNDING', 'OPEN_INTEREST', 'LIQUIDATION'],
  }));

  facts.push(makeEvidence({
    key: 'MARKET_STAGE',
    fact: stageAssessment.stage === 'UNCLASSIFIED'
      ? 'The current market stage cannot be classified from the available observations.'
      : `The current market stage is ${stageAssessment.stage}.`,
    polarity: stageAssessment.stage === 'UNCLASSIFIED' ? 'UNAVAILABLE' : 'SUPPORTING',
    reasonCode: stageAssessment.reasonCodes[0] ?? 'STAGE_EVIDENCE_UNAVAILABLE',
    signals: [...activitySignals, ...returnSignals, aggressorImbalance, ...depthSignals, fadeFromPeakPct],
    kinds: ['TRADE', 'BOOK_TICKER', 'DEPTH_SNAPSHOT', 'DEPTH_DELTA'],
  }));

  const analogueIds = sortedUnique(input.analogueIds);
  const analogueCount = numberOf(historicalAnalogueCount);
  facts.push(makeEvidence({
    key: 'HISTORICAL_ANALOGUES',
    fact: analogueIds.length === 0
      ? 'No historical analogue records are attached.'
      : analogueCount === null
        ? `${analogueIds.length} historical analogue record${analogueIds.length === 1 ? ' is' : 's are'} attached without an asserted match quality.`
        : `${analogueIds.length} historical analogue record${analogueIds.length === 1 ? ' is' : 's are'} attached; the bound count feature reports ${analogueCount}.`,
    polarity: analogueIds.length === 0 ? 'UNAVAILABLE' : 'NEUTRAL',
    reasonCode: analogueIds.length === 0 ? 'HISTORICAL_ANALOGUES_UNAVAILABLE' : 'HISTORICAL_ANALOGUES_ATTACHED',
    signals: [historicalAnalogueCount],
    kinds: ['CONTEXT'],
    extraRecordIds: analogueIds,
  }));

  const deadBaseline = booleanOf(deadBaselineFlag);
  const baselinePolarity: EvidencePolarity = deadBaseline === null
    ? 'UNAVAILABLE'
    : hypothesis === 'DEAD_VOLUME_WAKEUP'
      ? deadBaseline ? 'SUPPORTING' : 'CONFLICTING'
      : 'NEUTRAL';
  facts.push(makeEvidence({
    key: 'BASELINE_REGIME',
    fact: deadBaseline === null
      ? 'The baseline activity regime is unavailable.'
      : deadBaseline
        ? 'The instrument was in its configured dead-activity baseline regime.'
        : 'The instrument was not in its configured dead-activity baseline regime.',
    polarity: baselinePolarity,
    reasonCode: deadBaseline === null ? 'BASELINE_REGIME_UNAVAILABLE' : deadBaseline ? 'DEAD_BASELINE_PRESENT' : 'DEAD_BASELINE_ABSENT',
    signals: [deadBaselineFlag],
    kinds: [],
    extraTruths: input.baseline === null ? [] : [input.baseline.truth],
    extraRecordIds: input.baseline === null ? [] : [input.baseline.id],
  }));

  const tradeability = buildTradeabilityEvidence({
    input,
    rules,
    scopedEvidence,
    depthSupportRatio,
    stage: stageAssessment.stage,
    coreUnknownReasonCodes: [
      ...(changedAtMs === null ? ['CHANGE_SEQUENCE_UNAVAILABLE'] : []),
      ...(leadMarket === 'UNKNOWN' ? ['LEAD_MARKET_UNAVAILABLE'] : []),
      ...(activityPersists === null ? ['FLOW_PERSISTENCE_UNAVAILABLE'] : []),
      ...(response === null ? ['PRICE_RESPONSE_UNAVAILABLE'] : []),
      ...(weakDepth === null ? ['DEPTH_SUPPORT_UNAVAILABLE'] : []),
      ...(marketWide === null ? ['SYMBOL_SPECIFICITY_UNAVAILABLE'] : []),
      ...(!derivativeObserved ? ['DERIVATIVES_ALIGNMENT_UNAVAILABLE'] : []),
      ...(stageAssessment.stage === 'UNCLASSIFIED' ? ['MARKET_STAGE_UNCLASSIFIED'] : []),
      ...(hypothesisAssessment.hypothesis === 'UNCLASSIFIED_ANOMALY' ? ['HYPOTHESIS_UNCLASSIFIED'] : []),
    ],
  });
  const byPolarity = (polarity: EvidencePolarity): ThesisEvidence[] => facts
    .filter((fact) => fact.polarity === polarity)
    .sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
  const reasonCodes = sortedUnique([
    ...stageAssessment.reasonCodes,
    ...hypothesisAssessment.reasonCodes,
    ...facts.map((fact) => fact.reasonCode),
    ...allSignals.flatMap((signal) => signal.reasonCodes),
    ...tradeability.reasonCodes,
    'EVIDENCE_ONLY_NOT_TRADE_DECISION',
  ]);
  const allFeatureIds = sortedUnique(facts.flatMap((fact) => fact.featureIds));
  const allEvidenceIds = sortedUnique(facts.flatMap((fact) => fact.evidenceIds));
  const packetTruth = derivedThesisTruth({
    dataset: 'thesis-packet',
    rulesVersion: rules.version,
    evaluatedAtMs: input.evaluatedAtMs,
    maxFreshAgeMs: rules.maxFreshAgeMs,
    truths: [input.candidate.truth, ...facts.map((fact) => fact.truth)],
    recordIds: [input.candidate.id, ...facts.map((fact) => fact.id), ...allFeatureIds, ...allEvidenceIds, ...analogueIds],
    transforms: ['thesis-packet', stageAssessment.stage, hypothesisAssessment.hypothesis],
    observedFields: ['hypothesis', 'stage', 'tradeability'],
    missingFields: facts.filter((fact) => fact.polarity === 'UNAVAILABLE').map((fact) => fact.reasonCode),
    reasonCodes,
  });
  const packet: ThesisPacket = {
    id: stableId('thesis', {
      candidateId: input.candidate.id,
      instrumentId: input.candidate.instrumentId,
      rulesVersion: rules.version,
      hypothesis: hypothesisAssessment.hypothesis,
      stage: stageAssessment.stage,
      changedFirst,
      changedAtMs,
      leadMarket,
      factIds: facts.map((fact) => fact.id).sort(),
      analogueIds,
      tradeability,
    }),
    instrumentId: input.candidate.instrumentId,
    hypothesis: hypothesisAssessment.hypothesis,
    stage: stageAssessment.stage,
    changedFirst,
    changedAtMs,
    leadMarket,
    supporting: byPolarity('SUPPORTING'),
    conflicting: byPolarity('CONFLICTING'),
    neutral: byPolarity('NEUTRAL'),
    unavailable: byPolarity('UNAVAILABLE'),
    tradeability,
    analogueIds,
    reasonCodes,
    truth: packetTruth,
  };

  for (const fact of facts) {
    const factTruth = validateTruthMetadata(fact.truth);
    if (!factTruth.ok) return factTruth as ValidationResult<ThesisPacket>;
  }
  const truthValidation = validateTruthMetadata(packet.truth);
  if (!truthValidation.ok) return truthValidation as ValidationResult<ThesisPacket>;
  const outputSecret = validateNoSecretFields(packet, COMPONENT);
  if (!outputSecret.ok) return outputSecret as ValidationResult<ThesisPacket>;
  return { ok: true, value: packet };
}

function buildTradeabilityEvidence(args: {
  input: ThesisBuildInput;
  rules: ThesisRules;
  scopedEvidence: readonly NormalizedEvidence[];
  depthSupportRatio: ResolvedThesisSignal;
  stage: ThesisPacket['stage'];
  coreUnknownReasonCodes: readonly string[];
}): TradeabilityEvidence {
  const requiredKinds = sortedUnique(args.input.requiredEvidenceKinds) as EvidenceKind[];
  const usable = args.scopedEvidence.filter((evidence) => truthUsable(
    evidence.truth,
    args.input.evaluatedAtMs,
    args.rules.maxFreshAgeMs,
  ));
  const fullDepth = usable.filter((evidence): evidence is NormalizedDepth => evidence.kind === 'DEPTH_SNAPSHOT'
    && evidence.maximumLevelsKnown !== null
    && evidence.maximumLevelsKnown > 0
    && evidence.bookScope !== 'UNKNOWN'
    && evidence.bids.length > 0
    && evidence.asks.length > 0);
  const usableForKind = (kind: EvidenceKind): NormalizedEvidence[] => kind === 'DEPTH_SNAPSHOT'
    ? fullDepth
    : usable.filter((evidence) => evidence.kind === kind);
  const missingEvidenceKinds = sortedUnique([
    ...requiredKinds.filter((kind) => usableForKind(kind).length === 0),
    ...(fullDepth.length === 0 ? ['DEPTH_SNAPSHOT'] : []),
  ]) as EvidenceKind[];
  const requiredEvidenceIds = sortedUnique([
    ...requiredKinds.flatMap((kind) => usableForKind(kind).map((evidence) => evidence.id)),
    ...fullDepth.map((evidence) => evidence.id),
  ]);
  const lateStage = ['EXHAUSTION', 'REVERSAL', 'TOO_LATE'].includes(args.stage);
  const depthSupport = numberOf(args.depthSupportRatio);
  const sizeBlocked = args.input.intendedQuoteNotional !== null
    && depthSupport !== null
    && depthSupport < args.rules.depthSupportRatio;
  const reasonCodes = ['EVIDENCE_ONLY_NOT_TRADE_DECISION'];
  if (lateStage) reasonCodes.push('STAGE_BLOCKS_TRADEABILITY');
  if (sizeBlocked) reasonCodes.push('INTENDED_SIZE_NOT_SUPPORTED_BY_DEPTH');
  if (lateStage || sizeBlocked) {
    return {
      state: 'BLOCKED',
      reasonCodes: sortedUnique(reasonCodes),
      requiredEvidenceIds,
      missingEvidenceKinds,
    };
  }

  if (missingEvidenceKinds.length > 0) reasonCodes.push('REQUIRED_EVIDENCE_MISSING_OR_STALE');
  if (fullDepth.length === 0) reasonCodes.push('FULL_DEPTH_UNAVAILABLE');
  if (args.input.intendedQuoteNotional === null) reasonCodes.push('INTENDED_SIZE_UNSPECIFIED');
  if (depthSupport === null) reasonCodes.push('DEPTH_SUPPORT_UNAVAILABLE');
  if (args.coreUnknownReasonCodes.length > 0) {
    reasonCodes.push('CORE_THESIS_FACTS_UNAVAILABLE', ...args.coreUnknownReasonCodes);
  }
  if (
    missingEvidenceKinds.length > 0
    || args.input.intendedQuoteNotional === null
    || depthSupport === null
    || args.coreUnknownReasonCodes.length > 0
  ) {
    return {
      state: 'UNKNOWN',
      reasonCodes: sortedUnique(reasonCodes),
      requiredEvidenceIds,
      missingEvidenceKinds,
    };
  }

  reasonCodes.push('INTENDED_SIZE_SUPPORTED_BY_DEPTH', 'REQUIRED_EVIDENCE_FRESH_AND_COMPLETE');
  return {
    state: 'SUPPORTED',
    reasonCodes: sortedUnique(reasonCodes),
    requiredEvidenceIds,
    missingEvidenceKinds: [],
  };
}
