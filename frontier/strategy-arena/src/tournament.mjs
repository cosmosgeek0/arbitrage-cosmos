import {
  canonicalize,
  cloneCanonical,
  deepFreeze,
  sha256,
  validateFixtureOutput,
} from '../../dock/src/index.mjs';
import {
  ARENA_LIMITS,
  ARENA_METRICS,
  COST_FIELDS,
  FIXED_LIMITATIONS,
} from './constants.mjs';
import {
  cloneValidatedCampaign,
  collectCampaignOwnerReferences,
  validateEvaluationCampaign,
  validateQValidationAuthorityAgainstOwner,
} from './contracts.mjs';
import { validateOwnerReferenceSet } from './adapters.mjs';
import {
  addMicros,
  compareCodeUnits,
  exactShape,
  negateMicros,
  ppm,
  record,
  safeInteger,
  sha256Value,
  stableSort,
  validateRecordHash,
} from './validation.mjs';

const SCORECARD_FIELDS = Object.freeze([
  'schema', 'version', 'snapshotId', 'strategySnapshotHash', 'canonicalStrategyRef', 'canonicalStrategyHash',
  'qExperimentAndModelRefs', 'sourceFamilyIds', 'comparability', 'unknownReasons', 'eventCount', 'decisions',
  'nonActionQuality', 'falsePositiveCount', 'falsePositiveRatePpm', 'missedOpportunityCount', 'ambiguityCount',
  'ambiguityRatePpm', 'capacityConstraintCount', 'capacityConstraintRatePpm', 'ownerDeclaredContentionCount',
  'costSurvivalRatePpm', 'costs', 'shadowPortfolio', 'stability', 'metricOrder', 'metricDirections', 'metricValues',
  'reality', 'attributionComputed', 'scorecardHash',
]);

const REPORT_FIELDS = Object.freeze([
  'schema', 'version', 'campaignId', 'campaignHash', 'campaignPhase', 'evaluationPolicyVersion', 'evaluationPolicyHash',
  'fixtureClock', 'seed', 'qAuthorityHash', 'qValidationFoldsDigest', 'strategyTrialEvidenceState',
  'strategyRecordedTrialCount', 'strategySelectionPressureRefs', 'selectionPressureReasonCodes',
  'ownerReferenceAttestationHash', 'ownerReferenceAttestationClass', 'ownerReferenceCount', 'sameEventComparison',
  'opportunityOverlapAndContention', 'scorecards', 'ranking', 'sourceDependenceWarnings', 'lifecycleAdvisories',
  'metaAllocationAdvisory', 'evidenceIndex', 'limitations', 'truthClass', 'canonical', 'authorityClass', 'networkMode',
  'reality', 'shadowOnly', 'attributionComputed', 'decisionAlternativesComputed', 'promotionAuthorized',
  'allocationAuthorized', 'executionAuthorized', 'lifecycleMutationPerformed', 'reportHash',
]);

function compareExact(left, right) {
  const a = BigInt(left);
  const b = BigInt(right);
  return a < b ? -1 : a > b ? 1 : 0;
}

function maxExact(left, right) {
  return compareExact(left, right) >= 0 ? left : right;
}

function eventRows(campaign) {
  const contextByHash = new Map(campaign.eventContexts.map((context) => [context.eventContextHash, context]));
  return campaign.observations.map((observation) => ({ observation, context: contextByHash.get(observation.eventContextHash) }));
}

function decisionCounts(rows) {
  const counts = {
    ACTED: 0,
    REJECTED: 0,
    EXPIRED: 0,
    MISSED: 0,
    QUIET_CONTROL: 0,
    DATA_INVALID: 0,
  };
  for (const { observation } of rows) counts[observation.decisionDisposition] += 1;
  return deepFreeze(counts);
}

function nonActionQuality(rows) {
  const abstained = rows.filter(({ observation }) => ['REJECTED', 'EXPIRED', 'MISSED', 'QUIET_CONTROL'].includes(observation.decisionDisposition));
  const helpful = abstained.filter(({ context }) => context.outcome.outcomeClass === 'UNFAVORABLE').length;
  const harmful = abstained.filter(({ context }) => context.outcome.outcomeClass === 'FAVORABLE').length;
  const unknown = abstained.length - helpful - harmful;
  return deepFreeze({
    mappedDispositionContract: 'EventDisposition',
    dispositions: ['EXPIRED', 'MISSED', 'QUIET_CONTROL', 'REJECTED'],
    total: abstained.length,
    helpful,
    harmful,
    unknown,
    qualityPpm: ppm(helpful, helpful + harmful),
  });
}

function aggregateCosts(rows, comparable) {
  const output = {};
  for (const field of COST_FIELDS) {
    output[`${field}Micros`] = comparable
      ? addMicros(rows.filter(({ observation }) => observation.economics.state === 'AVAILABLE').map(({ observation }) => observation.economics.costMicros[field]), `costs.${field}`)
      : null;
  }
  output.totalMicros = comparable ? addMicros(COST_FIELDS.map((field) => output[`${field}Micros`]), 'costs.total') : null;
  return deepFreeze(output);
}

function shadowPortfolio(rows, comparable) {
  if (!comparable) {
    return deepFreeze({
      reality: 'HYPOTHETICAL_REPLAY',
      canonical: false,
      attributionComputed: false,
      valuationUnit: 'USDT_MICROS',
      fixtureNetOutcomeMicros: null,
      maximumDrawdownMicros: null,
      exposedEventCount: null,
      noExposureEventCount: null,
      unknownExposureEventCount: null,
      peakDemandUnits: null,
      peakGrantedUnits: null,
      exposureWindows: null,
      realizationOrder: 'SHADOW_EXPOSURE_CLOSE_TIME',
    });
  }
  let cumulative = '0';
  let peak = '0';
  let maximumDrawdown = '0';
  let peakDemandUnits = 0;
  let peakGrantedUnits = 0;
  const windows = [];
  let noExposureEventCount = 0;
  for (const { observation, context } of stableSort(rows, (row) => `${String(row.observation.shadowExposure.closedAtMs ?? row.context.eventTimeMs).padStart(16, '0')}|${row.context.eventId}`)) {
    const exposure = observation.shadowExposure;
    if (exposure.state === 'NO_EXPOSURE') {
      noExposureEventCount += 1;
      peakDemandUnits = Math.max(peakDemandUnits, exposure.demandUnits ?? 0);
      continue;
    }
    cumulative = addMicros([cumulative, observation.economics.fixtureNetOutcomeMicros], 'shadowPortfolio.cumulative');
    peak = maxExact(peak, cumulative);
    maximumDrawdown = maxExact(maximumDrawdown, (BigInt(peak) - BigInt(cumulative)).toString());
    peakDemandUnits = Math.max(peakDemandUnits, exposure.demandUnits);
    peakGrantedUnits = Math.max(peakGrantedUnits, exposure.grantedUnits);
    windows.push({
      eventId: context.eventId,
      observationHash: observation.observationHash,
      openedAtMs: exposure.openedAtMs,
      closedAtMs: exposure.closedAtMs,
      demandUnits: exposure.demandUnits,
      grantedUnits: exposure.grantedUnits,
      allocationState: exposure.allocationState,
      fixtureNetOutcomeMicros: observation.economics.fixtureNetOutcomeMicros,
    });
  }
  return deepFreeze({
    reality: 'HYPOTHETICAL_REPLAY',
    canonical: false,
    attributionComputed: false,
    valuationUnit: 'USDT_MICROS',
    fixtureNetOutcomeMicros: cumulative,
    maximumDrawdownMicros: maximumDrawdown,
    exposedEventCount: windows.length,
    noExposureEventCount,
    unknownExposureEventCount: 0,
    peakDemandUnits,
    peakGrantedUnits,
    exposureWindows: windows,
    realizationOrder: 'SHADOW_EXPOSURE_CLOSE_TIME',
  });
}

function stability(rows, comparable) {
  if (!comparable) return deepFreeze({ slices: null, worstSlice: null });
  const slices = new Map();
  for (const { observation, context } of rows) {
    const contribution = observation.economics.state === 'AVAILABLE' ? observation.economics.fixtureNetOutcomeMicros : '0';
    for (const sliceId of [`fold:${context.qFoldId}`, `regime:${context.regime}`, `symbol:${context.symbol}`]) {
      slices.set(sliceId, addMicros([slices.get(sliceId) ?? '0', contribution], `stability.${sliceId}`));
    }
  }
  const output = [...slices.entries()].map(([sliceId, fixtureNetOutcomeMicros]) => ({ sliceId, fixtureNetOutcomeMicros }));
  const worstSlice = [...output].sort((left, right) => compareExact(left.fixtureNetOutcomeMicros, right.fixtureNetOutcomeMicros) || compareCodeUnits(left.sliceId, right.sliceId))[0] ?? null;
  return deepFreeze({ slices: output.sort((left, right) => compareCodeUnits(left.sliceId, right.sliceId)), worstSlice });
}

function unknownReasons(snapshot, rows, policy) {
  const reasons = [...snapshot.knownMissingInputs];
  if (rows.length < policy.minimumComparableEvents) reasons.push('MINIMUM_COMPARABLE_EVENTS_NOT_MET');
  for (const { observation, context } of rows) {
    if (observation.decisionDisposition === 'DATA_INVALID') reasons.push(`DATA_INVALID:${context.eventId}`);
    if (observation.economics.state === 'UNKNOWN') reasons.push(`ECONOMICS_UNKNOWN:${context.eventId}`);
    if (observation.shadowExposure.state === 'UNKNOWN') reasons.push(`EXPOSURE_UNKNOWN:${context.eventId}`);
    if (context.outcome.state === 'UNKNOWN') reasons.push(`OUTCOME_UNKNOWN:${context.eventId}`);
    if (context.outcome.ambiguityState === 'UNKNOWN') reasons.push(`AMBIGUITY_UNKNOWN:${context.eventId}`);
  }
  return [...new Set(reasons)].sort();
}

function scorecard(snapshot, rows, policy) {
  const reasons = unknownReasons(snapshot, rows, policy);
  const decisions = decisionCounts(rows);
  const nonAction = nonActionQuality(rows);
  const falsePositiveCount = rows.filter(({ observation, context }) => observation.decisionDisposition === 'ACTED' && context.outcome.outcomeClass === 'UNFAVORABLE').length;
  const missedOpportunityCount = rows.filter(({ observation, context }) => observation.decisionDisposition !== 'ACTED' && context.outcome.outcomeClass === 'FAVORABLE').length;
  const ambiguityCount = rows.filter(({ context }) => context.outcome.ambiguityState === 'AMBIGUOUS').length;
  const capacityConstraintCount = rows.filter(({ observation }) => ['BLOCKED', 'CAPPED'].includes(observation.shadowExposure.allocationState)).length;
  const ownerDeclaredContentionCount = rows.filter(({ observation }) => observation.capitalContentionRefs.length > 0).length;
  const falsePositiveRatePpm = ppm(falsePositiveCount, decisions.ACTED);
  const ambiguityRatePpm = ppm(ambiguityCount, rows.length);
  const capacityConstraintRatePpm = ppm(capacityConstraintCount, rows.length);
  const grossPositive = rows.filter(({ observation }) => observation.economics.state === 'AVAILABLE' && BigInt(observation.economics.grossOutcomeMicros) > 0n);
  const costSurvivors = grossPositive.filter(({ observation }) => BigInt(observation.economics.fixtureNetOutcomeMicros) > 0n).length;
  const costSurvivalRatePpm = ppm(costSurvivors, grossPositive.length);
  if (falsePositiveRatePpm === null) reasons.push('FALSE_POSITIVE_RATE_UNAVAILABLE_ZERO_ACTED');
  if (nonAction.qualityPpm === null) reasons.push('NON_ACTION_QUALITY_UNAVAILABLE_ZERO_COHORT');
  if (costSurvivalRatePpm === null) reasons.push('COST_SURVIVAL_UNAVAILABLE_ZERO_POSITIVE_GROSS');
  const finalReasons = [...new Set(reasons)].sort();
  const comparable = finalReasons.length === 0;
  const costs = aggregateCosts(rows, comparable);
  const portfolio = shadowPortfolio(rows, comparable);
  const slices = stability(rows, comparable);
  const metricValues = comparable ? {
    FIXTURE_NET_OUTCOME_MICROS: portfolio.fixtureNetOutcomeMicros,
    COST_SURVIVAL_RATE_PPM: costSurvivalRatePpm,
    NON_ACTION_QUALITY_PPM: nonAction.qualityPpm,
    FALSE_POSITIVE_RATE_PPM_INVERTED: ARENA_LIMITS.ppmScale - falsePositiveRatePpm,
    RECOVERY_BURDEN_MICROS_INVERTED: negateMicros(costs.recoveryMicros, 'scorecard.recovery'),
    AMBIGUITY_RATE_PPM_INVERTED: ARENA_LIMITS.ppmScale - ambiguityRatePpm,
    CAPACITY_CONSTRAINT_RATE_PPM_INVERTED: ARENA_LIMITS.ppmScale - capacityConstraintRatePpm,
    WORST_SLICE_NET_MICROS: slices.worstSlice.fixtureNetOutcomeMicros,
  } : null;
  const card = {
    schema: 'StrategyArenaScorecardV1',
    version: 1,
    snapshotId: snapshot.snapshotId,
    strategySnapshotHash: snapshot.snapshotHash,
    canonicalStrategyRef: snapshot.canonicalStrategyRef,
    canonicalStrategyHash: snapshot.canonicalStrategyHash,
    qExperimentAndModelRefs: cloneCanonical(snapshot.qExperimentAndModelRefs),
    sourceFamilyIds: deriveSourceFamilyIds(snapshot),
    comparability: comparable ? 'COMPARABLE_SYNTHETIC_FIXTURE' : 'ABSTAIN_UNKNOWN',
    unknownReasons: finalReasons,
    eventCount: rows.length,
    decisions,
    nonActionQuality: nonAction,
    falsePositiveCount,
    falsePositiveRatePpm,
    missedOpportunityCount,
    ambiguityCount,
    ambiguityRatePpm,
    capacityConstraintCount,
    capacityConstraintRatePpm,
    ownerDeclaredContentionCount,
    costSurvivalRatePpm,
    costs,
    shadowPortfolio: portfolio,
    stability: slices,
    metricOrder: cloneCanonical(policy.metricOrder),
    metricDirections: cloneCanonical(policy.metricDirections),
    metricValues,
    reality: 'HYPOTHETICAL_REPLAY',
    attributionComputed: false,
  };
  card.scorecardHash = sha256(card);
  return deepFreeze(card);
}

function compareMetric(metricId, left, right) {
  if (metricId.includes('MICROS')) return compareExact(left, right);
  return left < right ? -1 : left > right ? 1 : 0;
}

function dominates(left, right, metricOrder) {
  let strictlyBetter = false;
  for (const metricId of metricOrder) {
    const comparison = compareMetric(metricId, left.metricValues[metricId], right.metricValues[metricId]);
    if (comparison < 0) return false;
    if (comparison > 0) strictlyBetter = true;
  }
  return strictlyBetter;
}

function paretoRanking(scorecards, metricOrder, campaign) {
  const excluded = scorecards.filter((card) => card.comparability !== 'COMPARABLE_SYNTHETIC_FIXTURE').map((card) => card.snapshotId).sort();
  let remaining = scorecards.filter((card) => card.comparability === 'COMPARABLE_SYNTHETIC_FIXTURE');
  const tiers = [];
  while (remaining.length > 0) {
    const front = remaining.filter((candidate) => !remaining.some((other) => other !== candidate && dominates(other, candidate, metricOrder)));
    const ids = front.map((card) => card.snapshotId).sort();
    tiers.push(ids);
    const set = new Set(ids);
    remaining = remaining.filter((card) => !set.has(card.snapshotId));
  }
  return deepFreeze({
    method: 'PARETO_FRONT_PEELING',
    metricOrder: cloneCanonical(metricOrder),
    metricDirections: Object.fromEntries(metricOrder.map((metricId) => [metricId, 'MAXIMIZE'])),
    tiers,
    excluded,
    singleMetricWinnerSelected: false,
    automaticWinnerSelected: false,
    canonicalLifecycleChanged: false,
    selectionPressureState: campaign.strategyTrialEvidenceState,
    selectionPressureAdjusted: false,
    reasonCodes: cloneCanonical(campaign.selectionPressureReasonCodes),
  });
}

function deriveSourceFamilyIds(snapshot) {
  const qFamilies = snapshot.qExperimentAndModelRefs.map((reference) => `q-artifact:${reference.contentSha256}`);
  const qProjections = snapshot.qExperimentAndModelRefs.filter((reference) => reference.projectionSha256 !== null).map((reference) => `q-projection:${reference.projectionSha256}`);
  return [...new Set([`strategy:${snapshot.canonicalStrategyContentSha256}`, ...qFamilies, ...qProjections])].sort();
}

function sourceDependenceWarnings(snapshots) {
  const warnings = [];
  for (let leftIndex = 0; leftIndex < snapshots.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < snapshots.length; rightIndex += 1) {
      const left = snapshots[leftIndex];
      const right = snapshots[rightIndex];
      const leftFamilies = deriveSourceFamilyIds(left);
      const rightFamilies = deriveSourceFamilyIds(right);
      const sharedFamilies = leftFamilies.filter((family) => rightFamilies.includes(family)).sort();
      const sharedQRefs = left.qExperimentAndModelRefs.map((ref) => ref.ref).filter((ref) => right.qExperimentAndModelRefs.some((other) => other.ref === ref)).sort();
      if (sharedFamilies.length > 0 || sharedQRefs.length > 0) {
        warnings.push({
          snapshotIds: [left.snapshotId, right.snapshotId].sort(),
          sharedDerivedSourceFamilyIds: sharedFamilies,
          sharedQEvidenceRefs: sharedQRefs,
          independentConfirmationCount: 1,
          reasonCode: 'CORRELATED_SOURCES_COUNT_AS_ONE_EVIDENCE_FAMILY',
        });
      }
    }
  }
  return deepFreeze(warnings.sort((left, right) => compareCodeUnits(left.snapshotIds.join('|'), right.snapshotIds.join('|'))));
}

function lifecycleAdvisory(card, campaign, policy) {
  let state = 'NO_PROPOSAL';
  let reviewClass = 'CONTINUE_RESEARCH';
  const reasonCodes = [];
  if (campaign.strategyTrialEvidenceState === 'UNAVAILABLE_NO_Q_WHOLE_STRATEGY_TRIAL_LINKAGE') {
    state = 'ABSTAIN_UNKNOWN';
    reviewClass = 'SELECTION_PRESSURE_UNAVAILABLE';
    reasonCodes.push(...card.unknownReasons, ...campaign.selectionPressureReasonCodes);
  } else if (card.comparability !== 'COMPARABLE_SYNTHETIC_FIXTURE') {
    state = 'ABSTAIN_UNKNOWN';
    reviewClass = 'ABSTAIN_UNKNOWN';
    reasonCodes.push(...card.unknownReasons);
  } else {
    if (card.falsePositiveRatePpm > policy.maximumFalsePositiveRatePpm) reasonCodes.push('FALSE_POSITIVE_RATE_EXCEEDED');
    if (card.ambiguityRatePpm > policy.maximumAmbiguityRatePpm) reasonCodes.push('AMBIGUITY_RATE_EXCEEDED');
    if (BigInt(card.costs.recoveryMicros) > BigInt(policy.maximumRecoveryBurdenMicros)) reasonCodes.push('RECOVERY_BURDEN_EXCEEDED');
    if (card.capacityConstraintRatePpm > policy.maximumCapacityConstraintRatePpm) reasonCodes.push('CAPACITY_CONSTRAINT_RATE_EXCEEDED');
    if (BigInt(card.shadowPortfolio.fixtureNetOutcomeMicros) < 0n) reasonCodes.push('SHADOW_FIXTURE_NET_NEGATIVE');
    if (BigInt(card.stability.worstSlice.fixtureNetOutcomeMicros) < 0n) reasonCodes.push('WORST_SLICE_NEGATIVE');
    if (reasonCodes.length >= policy.retirementRequiresBreaches) {
      state = 'PROPOSED_REVIEW';
      reviewClass = 'RETIREMENT_REVIEW';
    } else if (reasonCodes.length >= policy.demotionRequiresBreaches) {
      state = 'PROPOSED_REVIEW';
      reviewClass = 'DEMOTION_REVIEW';
    }
  }
  const advisory = {
    schema: 'StrategyLifecycleAdvisoryV1',
    version: 1,
    state,
    reviewClass,
    targetStrategyRef: card.canonicalStrategyRef,
    targetStrategyHash: card.canonicalStrategyHash,
    targetSnapshotHash: card.strategySnapshotHash,
    campaignHash: campaign.campaignHash,
    evidenceScorecardHash: card.scorecardHash,
    reasonCodes: [...new Set(reasonCodes)].sort(),
    ownerSeam: 'STRATEGY_AND_Q_OWNER_REVIEW_REQUIRED',
    authorityClass: 'NO_AUTHORITY',
    canonical: false,
    mutationPerformed: false,
  };
  advisory.advisoryHash = sha256(advisory);
  return deepFreeze(advisory);
}

function opportunityOverlap(campaign, rows, scorecardByHash) {
  const overlaps = [];
  const contentionRefs = new Set();
  for (const { observation } of rows) observation.capitalContentionRefs.forEach((ref) => contentionRefs.add(ref));
  const exposed = rows.filter(({ observation }) => observation.shadowExposure.state === 'SHADOW_EXPOSED');
  for (let leftIndex = 0; leftIndex < exposed.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < exposed.length; rightIndex += 1) {
      const left = exposed[leftIndex];
      const right = exposed[rightIndex];
      const start = Math.max(left.observation.shadowExposure.openedAtMs, right.observation.shadowExposure.openedAtMs);
      const end = Math.min(left.observation.shadowExposure.closedAtMs, right.observation.shadowExposure.closedAtMs);
      if (end > start) {
        overlaps.push({
          eventIds: [left.context.eventId, right.context.eventId].sort(),
          observationHashes: [left.observation.observationHash, right.observation.observationHash].sort(),
          snapshotIds: [scorecardByHash.get(left.observation.strategySnapshotHash).snapshotId, scorecardByHash.get(right.observation.strategySnapshotHash).snapshotId].sort(),
          overlapStartMs: start,
          overlapEndMs: end,
          overlapDurationMs: end - start,
          allocationPerformed: false,
        });
      }
    }
  }
  return deepFreeze({
    method: 'GLOBAL_DECLARED_SHADOW_WINDOW_INTERSECTION',
    overlapCount: overlaps.length,
    overlaps: overlaps.sort((left, right) => compareCodeUnits(left.eventIds.join('|'), right.eventIds.join('|')) || compareCodeUnits(left.snapshotIds.join('|'), right.snapshotIds.join('|')) || compareCodeUnits(left.observationHashes.join('|'), right.observationHashes.join('|'))),
    ownerDeclaredContentionRefs: [...contentionRefs].sort(),
    capitalConflictInferred: false,
    allocationPerformed: false,
  });
}

function sameEventComparison(campaign, rows, scorecardByHash) {
  const byEvent = new Map();
  for (const { observation, context } of rows) {
    const bucket = byEvent.get(context.eventId) ?? { eventId: context.eventId, eventContextHash: context.eventContextHash, strategies: [] };
    const card = scorecardByHash.get(observation.strategySnapshotHash);
    bucket.strategies.push({
      snapshotId: card.snapshotId,
      decisionDisposition: observation.decisionDisposition,
      economicState: observation.economics.state,
      fixtureNetOutcomeMicros: observation.economics.state === 'AVAILABLE' ? observation.economics.fixtureNetOutcomeMicros : null,
      shadowExposureState: observation.shadowExposure.state,
      allocationState: observation.shadowExposure.allocationState,
      canonicalOutcome: false,
      alternativeDecisionComputed: false,
    });
    byEvent.set(context.eventId, bucket);
  }
  const comparisons = [...byEvent.values()].map((entry) => ({ ...entry, strategies: entry.strategies.sort((left, right) => compareCodeUnits(left.snapshotId, right.snapshotId)) })).sort((left, right) => compareCodeUnits(left.eventId, right.eventId));
  return deepFreeze({ eventCount: comparisons.length, comparisons, oneSharedContextPerEvent: true, automaticWinnerSelected: false });
}

function metaAllocationAdvisory(ranking, scorecards, warnings, campaign) {
  const candidateIds = ranking.tiers[0] ?? [];
  const topSet = new Set(candidateIds);
  const correlated = warnings.some((warning) => warning.snapshotIds.every((snapshotId) => topSet.has(snapshotId)));
  const unknown = candidateIds.length === 0;
  const insufficientDiversity = candidateIds.length < 2;
  const selectionPressureUnavailable = campaign.strategyTrialEvidenceState === 'UNAVAILABLE_NO_Q_WHOLE_STRATEGY_TRIAL_LINKAGE';
  const advisory = {
    schema: 'StrategyMetaAllocationAdvisoryV1',
    version: 1,
    state: unknown ? 'ABSTAIN_UNKNOWN' : 'NO_PROPOSAL',
    reviewClass: unknown ? 'INSUFFICIENT_COMPARABLE_EVIDENCE' : selectionPressureUnavailable ? 'SELECTION_PRESSURE_UNAVAILABLE' : insufficientDiversity ? 'INSUFFICIENT_DIVERSE_CANDIDATES' : correlated ? 'ABSTAIN_CORRELATED_EVIDENCE' : 'OWNER_REVIEW_REQUIRED',
    candidateStrategies: scorecards.filter((card) => topSet.has(card.snapshotId)).map((card) => ({ strategyRef: card.canonicalStrategyRef, strategyHash: card.canonicalStrategyHash, snapshotHash: card.strategySnapshotHash, evidenceScorecardHash: card.scorecardHash })).sort((left, right) => compareCodeUnits(left.strategyRef, right.strategyRef)),
    campaignHash: campaign.campaignHash,
    relativeWeightsPpm: null,
    capitalAmounts: null,
    ownerSeam: 'CAPITAL_AND_RISK_OWNER_REVIEW_REQUIRED',
    authorityClass: 'NO_AUTHORITY',
    canonical: false,
    allocationPerformed: false,
    mutationPerformed: false,
  };
  advisory.advisoryHash = sha256(advisory);
  return deepFreeze(advisory);
}

function evidenceIndex(campaign) {
  const contexts = new Map(campaign.eventContexts.map((context) => [context.eventContextHash, context]));
  return deepFreeze({
    strategies: campaign.strategySnapshots.map((snapshot) => ({
      snapshotId: snapshot.snapshotId,
      snapshotHash: snapshot.snapshotHash,
      canonicalStrategyRef: snapshot.canonicalStrategyRef,
      qExperimentAndModelRefs: cloneCanonical(snapshot.qExperimentAndModelRefs),
      evidenceSnapshotRefs: cloneCanonical(snapshot.evidenceSnapshotRefs),
      capitalRiskAssumptionRefs: cloneCanonical(snapshot.capitalRiskAssumptionRefs),
      executionCostAndRecoveryRefs: cloneCanonical(snapshot.executionCostAndRecoveryRefs),
    })),
    events: campaign.eventContexts.map((context) => ({
      eventId: context.eventId,
      eventContextHash: context.eventContextHash,
      qSplitMembershipRef: cloneCanonical(context.qSplitMembershipRef),
      evidenceSnapshotRefs: cloneCanonical(context.evidenceSnapshotRefs),
      outcomeFactHash: context.outcome.outcomeFactHash,
      outcomeOwnerRef: cloneCanonical(context.outcome.ownerContractRef),
    })),
    observations: campaign.observations.map((observation) => ({
      observationId: observation.observationId,
      observationHash: observation.observationHash,
      eventId: contexts.get(observation.eventContextHash).eventId,
      strategySnapshotHash: observation.strategySnapshotHash,
      ownerEvidenceRefs: cloneCanonical(observation.ownerEvidenceRefs),
      economicFactHash: observation.economics.economicFactHash,
      exposureFactHash: observation.shadowExposure.exposureFactHash,
    })),
  });
}

function buildTournamentReport(campaign, ownerResolver) {
  campaign = cloneValidatedCampaign(campaign);
  validateQValidationAuthorityAgainstOwner(campaign.qValidationAuthority, ownerResolver);
  const ownerReferenceAttestation = validateOwnerReferenceSet(collectCampaignOwnerReferences(campaign), ownerResolver);
  const rows = eventRows(campaign);
  const bySnapshot = new Map(campaign.strategySnapshots.map((snapshot) => [snapshot.snapshotHash, []]));
  for (const row of rows) bySnapshot.get(row.observation.strategySnapshotHash).push(row);
  const scorecards = campaign.strategySnapshots.map((snapshot) => scorecard(snapshot, bySnapshot.get(snapshot.snapshotHash), campaign.evaluationPolicy));
  const scorecardByHash = new Map(scorecards.map((card) => [card.strategySnapshotHash, card]));
  const ranking = paretoRanking(scorecards, campaign.evaluationPolicy.metricOrder, campaign);
  const warnings = sourceDependenceWarnings(campaign.strategySnapshots);
  const report = {
    schema: 'StrategyArenaReportV1',
    version: 1,
    campaignId: campaign.campaignId,
    campaignHash: campaign.campaignHash,
    campaignPhase: campaign.campaignPhase,
    evaluationPolicyVersion: `${campaign.evaluationPolicy.policyId}.${campaign.evaluationPolicy.policyVersion}`,
    evaluationPolicyHash: campaign.evaluationPolicy.policyHash,
    fixtureClock: cloneCanonical(campaign.fixtureClock),
    seed: campaign.seed,
    qAuthorityHash: campaign.qValidationAuthority.qAuthorityHash,
    qValidationFoldsDigest: campaign.qValidationAuthority.validationFoldsDigest,
    strategyTrialEvidenceState: campaign.strategyTrialEvidenceState,
    strategyRecordedTrialCount: campaign.strategyRecordedTrialCount,
    strategySelectionPressureRefs: cloneCanonical(campaign.strategySelectionPressureRefs),
    selectionPressureReasonCodes: cloneCanonical(campaign.selectionPressureReasonCodes),
    ownerReferenceAttestationHash: ownerReferenceAttestation.attestationHash,
    ownerReferenceAttestationClass: 'CALLER_SUPPLIED_PINNED_IDENTITY_ATTESTATION',
    ownerReferenceCount: ownerReferenceAttestation.attestations.length,
    sameEventComparison: sameEventComparison(campaign, rows, scorecardByHash),
    opportunityOverlapAndContention: opportunityOverlap(campaign, rows, scorecardByHash),
    scorecards,
    ranking,
    sourceDependenceWarnings: warnings,
    lifecycleAdvisories: scorecards.map((card) => lifecycleAdvisory(card, campaign, campaign.evaluationPolicy)),
    metaAllocationAdvisory: metaAllocationAdvisory(ranking, scorecards, warnings, campaign),
    evidenceIndex: evidenceIndex(campaign),
    limitations: [...FIXED_LIMITATIONS],
    truthClass: 'ADVISORY',
    canonical: false,
    authorityClass: 'NO_AUTHORITY',
    networkMode: 'FIXTURE_ONLY',
    reality: 'HYPOTHETICAL_REPLAY',
    shadowOnly: true,
    attributionComputed: false,
    decisionAlternativesComputed: false,
    promotionAuthorized: false,
    allocationAuthorized: false,
    executionAuthorized: false,
    lifecycleMutationPerformed: false,
  };
  report.reportHash = sha256(report);
  validateReportEnvelope(report);
  return deepFreeze(report);
}

export function evaluateTournament(campaign, ownerResolver) {
  return buildTournamentReport(campaign, ownerResolver);
}

function validateReportEnvelope(input) {
  const report = record(input, 'StrategyArenaReportV1');
  exactShape(report, REPORT_FIELDS, 'StrategyArenaReportV1');
  if (report.schema !== 'StrategyArenaReportV1' || report.version !== 1 || report.campaignPhase !== 'ITERATION') throw Object.assign(new TypeError('report must be an iteration StrategyArena V1 report'), { code: 'ARENA_REPORT_VERSION_INVALID' });
  for (const [name, value] of [['campaignHash', report.campaignHash], ['evaluationPolicyHash', report.evaluationPolicyHash], ['qAuthorityHash', report.qAuthorityHash], ['qValidationFoldsDigest', report.qValidationFoldsDigest], ['ownerReferenceAttestationHash', report.ownerReferenceAttestationHash]]) sha256Value(value, `StrategyArenaReportV1.${name}`);
  if (report.strategyTrialEvidenceState !== 'UNAVAILABLE_NO_Q_WHOLE_STRATEGY_TRIAL_LINKAGE' || report.strategyRecordedTrialCount !== null || report.strategySelectionPressureRefs.length !== 0 || canonicalize(report.selectionPressureReasonCodes) !== canonicalize(['CAMPAIGN_BOUND_Q_SELECTION_BUNDLE_MISSING']) || report.ownerReferenceAttestationClass !== 'CALLER_SUPPLIED_PINNED_IDENTITY_ATTESTATION') throw Object.assign(new TypeError('report selection-pressure or owner-attestation posture widened'), { code: 'ARENA_REPORT_EVIDENCE_POSTURE_INVALID' });
  safeInteger(report.ownerReferenceCount, 'StrategyArenaReportV1.ownerReferenceCount', 1, ARENA_LIMITS.maxReferences);
  if (!Array.isArray(report.scorecards) || report.scorecards.length === 0 || report.scorecards.length > ARENA_LIMITS.maxStrategies) throw Object.assign(new TypeError('report scorecard set is invalid'), { code: 'ARENA_REPORT_SCORECARDS_INVALID' });
  for (const card of report.scorecards) {
    exactShape(card, SCORECARD_FIELDS, 'StrategyArenaScorecardV1');
    if (card.schema !== 'StrategyArenaScorecardV1' || card.version !== 1 || card.reality !== 'HYPOTHETICAL_REPLAY' || card.attributionComputed !== false) throw Object.assign(new TypeError('scorecard widened fixture authority'), { code: 'ARENA_SCORECARD_AUTHORITY_WIDENING' });
    validateRecordHash(card, 'scorecardHash', 'StrategyArenaScorecardV1');
  }
  if (!Array.isArray(report.lifecycleAdvisories) || report.lifecycleAdvisories.length !== report.scorecards.length) throw Object.assign(new TypeError('report lifecycle advisory set is incomplete'), { code: 'ARENA_REPORT_ADVISORY_SET_INVALID' });
  for (const advisory of report.lifecycleAdvisories) {
    record(advisory, 'StrategyLifecycleAdvisoryV1');
    if (advisory.authorityClass !== 'NO_AUTHORITY' || advisory.canonical !== false || advisory.mutationPerformed !== false) throw Object.assign(new TypeError('lifecycle advisory widened authority'), { code: 'ARENA_REPORT_AUTHORITY_WIDENING' });
    validateRecordHash(advisory, 'advisoryHash', 'StrategyLifecycleAdvisoryV1');
  }
  record(report.ranking, 'StrategyArenaReportV1.ranking');
  record(report.metaAllocationAdvisory, 'StrategyMetaAllocationAdvisoryV1');
  if (report.metaAllocationAdvisory.authorityClass !== 'NO_AUTHORITY' || report.metaAllocationAdvisory.canonical !== false || report.metaAllocationAdvisory.allocationPerformed !== false || report.metaAllocationAdvisory.mutationPerformed !== false || report.metaAllocationAdvisory.relativeWeightsPpm !== null || report.metaAllocationAdvisory.capitalAmounts !== null) throw Object.assign(new TypeError('meta-allocation advisory widened authority'), { code: 'ARENA_REPORT_AUTHORITY_WIDENING' });
  validateRecordHash(report.metaAllocationAdvisory, 'advisoryHash', 'StrategyMetaAllocationAdvisoryV1');
  if (report.truthClass !== 'ADVISORY' || report.canonical !== false || report.authorityClass !== 'NO_AUTHORITY' || report.networkMode !== 'FIXTURE_ONLY' || report.reality !== 'HYPOTHETICAL_REPLAY' || report.shadowOnly !== true || report.attributionComputed !== false || report.decisionAlternativesComputed !== false || report.promotionAuthorized !== false || report.allocationAuthorized !== false || report.executionAuthorized !== false || report.lifecycleMutationPerformed !== false) throw Object.assign(new TypeError('report widened fixture authority'), { code: 'ARENA_REPORT_AUTHORITY_WIDENING' });
  if (report.evidenceIndex === null || typeof report.evidenceIndex !== 'object' || !Array.isArray(report.evidenceIndex.strategies) || !Array.isArray(report.evidenceIndex.events) || !Array.isArray(report.evidenceIndex.observations)) throw Object.assign(new TypeError('report evidence index is missing'), { code: 'ARENA_REPORT_EVIDENCE_INVALID' });
  validateRecordHash(report, 'reportHash', 'StrategyArenaReportV1');
  validateFixtureOutput(report);
  return true;
}

export function validateStrategyArenaReport(input, campaign, ownerResolver) {
  if (campaign === null || typeof campaign !== 'object' || typeof ownerResolver !== 'function') {
    throw Object.assign(new TypeError('report validation requires its originating campaign and injected owner resolver'), { code: 'ARENA_REPORT_DERIVATION_CONTEXT_REQUIRED' });
  }
  const boundReport = deepFreeze(cloneCanonical(input));
  const boundCampaign = deepFreeze(cloneCanonical(campaign));
  validateReportEnvelope(boundReport);
  const expected = buildTournamentReport(boundCampaign, ownerResolver);
  if (canonicalize(boundReport) !== canonicalize(expected)) {
    throw Object.assign(new TypeError('report does not equal the deterministic derivation of its bound campaign'), { code: 'ARENA_REPORT_DERIVATION_MISMATCH' });
  }
  return true;
}

export function compareTournamentReports(left, right, { leftCampaign, rightCampaign = leftCampaign, ownerResolver } = {}) {
  const boundLeft = deepFreeze(cloneCanonical(left));
  const boundRight = deepFreeze(cloneCanonical(right));
  const boundLeftCampaign = deepFreeze(cloneCanonical(leftCampaign));
  const boundRightCampaign = deepFreeze(cloneCanonical(rightCampaign));
  validateStrategyArenaReport(boundLeft, boundLeftCampaign, ownerResolver);
  validateStrategyArenaReport(boundRight, boundRightCampaign, ownerResolver);
  return deepFreeze({
    sameCampaign: boundLeft.campaignHash === boundRight.campaignHash,
    sameReport: boundLeft.reportHash === boundRight.reportHash,
    leftReportHash: boundLeft.reportHash,
    rightReportHash: boundRight.reportHash,
    authorityClass: 'NO_AUTHORITY',
  });
}
