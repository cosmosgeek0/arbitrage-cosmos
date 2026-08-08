import type { ResearchLabExperiment } from './researchLab';
import { RESEARCH_LAB_ARTIFACTS } from './researchLabArtifacts';

export type ResearchLabGateCategory = 'LCB_INTERVAL' | 'HOLM_MULTIPLICITY' | 'WHITE_RC' | 'DRAWDOWN' | 'NET_POSITIVE' | 'POSITIVE_PERIOD' | 'SAMPLE_ACTIVITY_BREADTH' | 'PBO' | 'OTHER';
export type ResearchLabGateEvidence = Readonly<{
  family: string;
  artifactPath: string;
  jsonPath: string;
  phase: 'DEV' | 'HOLDOUT' | 'FULL' | 'GLOBAL';
  category: ResearchLabGateCategory;
  codes: readonly string[];
}>;

export const RESEARCH_LAB_GATE_EVIDENCE: readonly ResearchLabGateEvidence[] = Object.freeze([
  {"family":"s1y","artifactPath":"s1y/result.v1.json","jsonPath":"/development/family_statistics/primary_gates","phase":"DEV","category":"LCB_INTERVAL","codes":["stress_bootstrap_lower_gt_zero"]},
  {"family":"s1y","artifactPath":"s1y/result.v1.json","jsonPath":"/development/family_statistics/primary_gates","phase":"DEV","category":"HOLM_MULTIPLICITY","codes":["holm_adjusted_primary_p_lte_0p05"]},
  {"family":"s1y","artifactPath":"s1y/result.v1.json","jsonPath":"/development/family_statistics/primary_gates","phase":"DEV","category":"WHITE_RC","codes":["reality_check_p_lte_0p05"]},
  {"family":"s1y","artifactPath":"s1y/result.v1.json","jsonPath":"/development/family_statistics/primary_gates","phase":"DEV","category":"DRAWDOWN","codes":["maximum_drawdown_lte_10pct"]},
  {"family":"s1y","artifactPath":"s1y/result.v1.json","jsonPath":"/development/family_statistics/primary_gates","phase":"DEV","category":"NET_POSITIVE","codes":["stress_total_gt_zero"]},
  {"family":"s1z","artifactPath":"s1z/result.v1.json","jsonPath":"/gates","phase":"DEV","category":"NET_POSITIVE","codes":["developmentStressPositive"]},
  {"family":"s1z","artifactPath":"s1z/result.v1.json","jsonPath":"/gates","phase":"HOLDOUT","category":"NET_POSITIVE","codes":["holdoutStressPositive"]},
  {"family":"s1z","artifactPath":"s1z/result.v1.json","jsonPath":"/gates","phase":"FULL","category":"NET_POSITIVE","codes":["fullSeverePositive","fullStressPositive"]},
  {"family":"s1z","artifactPath":"s1z/result.v1.json","jsonPath":"/gates","phase":"GLOBAL","category":"LCB_INTERVAL","codes":["block14LowerPositive","block28LowerPositive"]},
  {"family":"s1z","artifactPath":"s1z/result.v1.json","jsonPath":"/gates","phase":"GLOBAL","category":"HOLM_MULTIPLICITY","codes":["primaryHolmP"]},
  {"family":"s1z","artifactPath":"s1z/result.v1.json","jsonPath":"/gates","phase":"GLOBAL","category":"WHITE_RC","codes":["whiteRealityCheck"]},
  {"family":"s1z","artifactPath":"s1z/result.v1.json","jsonPath":"/gates","phase":"GLOBAL","category":"DRAWDOWN","codes":["severeDrawdownAtMost10Pct"]},
  {"family":"s1z","artifactPath":"s1z/result.v1.json","jsonPath":"/gates","phase":"GLOBAL","category":"OTHER","codes":["removeBestAssetPositive","removeBestMonthPositive"]},
  {"family":"s2g","artifactPath":"s2g/result.v1.json","jsonPath":"/development/trials/*/gates","phase":"DEV","category":"LCB_INTERVAL","codes":["lcbAboveZero"]},
  {"family":"s2g","artifactPath":"s2g/result.v1.json","jsonPath":"/development/trials/*/gates","phase":"DEV","category":"HOLM_MULTIPLICITY","codes":["holmPBelow0.05"]},
  {"family":"s2g","artifactPath":"s2g/result.v1.json","jsonPath":"/development/trials/*/gates","phase":"DEV","category":"WHITE_RC","codes":["whitePBelow0.05"]},
  {"family":"s2g","artifactPath":"s2g/result.v1.json","jsonPath":"/development/trials/*/gates","phase":"DEV","category":"DRAWDOWN","codes":["drawdownAtMost25Pct"]},
  {"family":"s2g","artifactPath":"s2g/result.v1.json","jsonPath":"/development/trials/*/gates","phase":"DEV","category":"NET_POSITIVE","codes":["netAboveZero"]},
  {"family":"s2g","artifactPath":"s2g/result.v1.json","jsonPath":"/development/trials/*/gates","phase":"DEV","category":"POSITIVE_PERIOD","codes":["positiveMonthsAtLeast5"]},
  {"family":"s2g","artifactPath":"s2g/result.v1.json","jsonPath":"/development/trials/*/gates","phase":"DEV","category":"OTHER","codes":["rawPBelow0.05"]},
  {"family":"vg15","artifactPath":"vg15/result.v1.json","jsonPath":"/development/candidateRows/*/gates","phase":"DEV","category":"LCB_INTERVAL","codes":["baseOneSided95LcbPositive"]},
  {"family":"vg15","artifactPath":"vg15/result.v1.json","jsonPath":"/development/candidateRows/*/gates","phase":"DEV","category":"HOLM_MULTIPLICITY","codes":["holmAdjustedPBelow005"]},
  {"family":"vg15","artifactPath":"vg15/result.v1.json","jsonPath":"/development/candidateRows/*/gates","phase":"DEV","category":"DRAWDOWN","codes":["maxDrawdownAtMost10Pct"]},
  {"family":"vg15","artifactPath":"vg15/result.v1.json","jsonPath":"/development/candidateRows/*/gates","phase":"DEV","category":"NET_POSITIVE","codes":["stressMeanPositive"]},
  {"family":"vg15","artifactPath":"vg15/result.v1.json","jsonPath":"/development/candidateRows/*/gates","phase":"DEV","category":"POSITIVE_PERIOD","codes":["positiveTwoMonthFoldsAtLeast3Of4"]},
  {"family":"vg17","artifactPath":"vg17/result.v1.json","jsonPath":"/reason/details","phase":"DEV","category":"LCB_INTERVAL","codes":["BASE_14D_BOOTSTRAP_LOWER_NOT_POSITIVE","BASE_7D_BOOTSTRAP_LOWER_NOT_POSITIVE","STRESS_14D_BOOTSTRAP_LOWER_NOT_POSITIVE","STRESS_7D_BOOTSTRAP_LOWER_NOT_POSITIVE"]},
  {"family":"vg17","artifactPath":"vg17/result.v1.json","jsonPath":"/reason/details","phase":"DEV","category":"HOLM_MULTIPLICITY","codes":["HOLM_CHAMPION_NOT_REJECTED"]},
  {"family":"vg17","artifactPath":"vg17/result.v1.json","jsonPath":"/reason/details","phase":"DEV","category":"WHITE_RC","codes":["WHITE_REALITY_CHECK_NOT_BELOW_0_05"]},
  {"family":"vg17","artifactPath":"vg17/result.v1.json","jsonPath":"/reason/details","phase":"DEV","category":"DRAWDOWN","codes":["BASE_DRAWDOWN_EXCEEDS_0_40","STRESS_DRAWDOWN_EXCEEDS_0_40"]},
  {"family":"vg17","artifactPath":"vg17/result.v1.json","jsonPath":"/reason/details","phase":"DEV","category":"NET_POSITIVE","codes":["STRESS_NET_MEAN_NOT_POSITIVE"]},
  {"family":"vg17","artifactPath":"vg17/result.v1.json","jsonPath":"/reason/details","phase":"DEV","category":"SAMPLE_ACTIVITY_BREADTH","codes":["DISTINCT_ASSETS_BELOW_15"]},
  {"family":"vg17","artifactPath":"vg17/result.v1.json","jsonPath":"/reason/details","phase":"DEV","category":"PBO","codes":["PBO_EXCEEDS_0_50"]},
  {"family":"vg20","artifactPath":"vg20/result.v1.json","jsonPath":"/development/failedFormalGates","phase":"DEV","category":"LCB_INTERVAL","codes":["BOOTSTRAP_LOWER_BOUND"]},
  {"family":"vg20","artifactPath":"vg20/result.v1.json","jsonPath":"/development/failedFormalGates","phase":"DEV","category":"HOLM_MULTIPLICITY","codes":["HOLM_ADJUSTED_P_VALUE"]},
  {"family":"vg20","artifactPath":"vg20/result.v1.json","jsonPath":"/development/failedFormalGates","phase":"DEV","category":"WHITE_RC","codes":["WHITE_REALITY_CHECK"]},
  {"family":"vg20","artifactPath":"vg20/result.v1.json","jsonPath":"/development/failedFormalGates","phase":"DEV","category":"SAMPLE_ACTIVITY_BREADTH","codes":["CLOSED_COHORT_EVENTS","POTENTIAL_EVENTS"]},
  {"family":"vg23","artifactPath":"vg23/result.v1.json","jsonPath":"/gateDecisions","phase":"DEV","category":"LCB_INTERVAL","codes":["DEV_STRESS_LCB"]},
  {"family":"vg23","artifactPath":"vg23/result.v1.json","jsonPath":"/gateDecisions","phase":"DEV","category":"HOLM_MULTIPLICITY","codes":["DEV_HOLM_P"]},
  {"family":"vg23","artifactPath":"vg23/result.v1.json","jsonPath":"/gateDecisions","phase":"DEV","category":"WHITE_RC","codes":["DEV_WHITE_RC_BENCHMARK","DEV_WHITE_RC_CASH"]},
  {"family":"vg23","artifactPath":"vg23/result.v1.json","jsonPath":"/gateDecisions","phase":"DEV","category":"NET_POSITIVE","codes":["DEV_STRESS_NET"]},
  {"family":"vg23","artifactPath":"vg23/result.v1.json","jsonPath":"/gateDecisions","phase":"DEV","category":"POSITIVE_PERIOD","codes":["DEV_POSITIVE_STRESS_MONTHS"]},
  {"family":"vg23","artifactPath":"vg23/result.v1.json","jsonPath":"/gateDecisions","phase":"HOLDOUT","category":"LCB_INTERVAL","codes":["HOLDOUT_MATCHED_BENCHMARK_EXCESS_LCB","HOLDOUT_STRESS_LCB"]},
  {"family":"vg23","artifactPath":"vg23/result.v1.json","jsonPath":"/gateDecisions","phase":"HOLDOUT","category":"NET_POSITIVE","codes":["HOLDOUT_BASE_NET","HOLDOUT_FEE_STRESS_NET","HOLDOUT_STRESS_NET"]},
  {"family":"vg23","artifactPath":"vg23/result.v1.json","jsonPath":"/gateDecisions","phase":"HOLDOUT","category":"POSITIVE_PERIOD","codes":["HOLDOUT_POSITIVE_STRESS_MONTHS"]},
  {"family":"vg23","artifactPath":"vg23/result.v1.json","jsonPath":"/gateDecisions","phase":"HOLDOUT","category":"OTHER","codes":["HOLDOUT_STRESS_ONE_SIDED_P","HOLDOUT_TOP_ASSET_CONCENTRATION","HOLDOUT_TOP_FIVE_SPELL_CONCENTRATION"]},
  {"family":"vg25","artifactPath":"vg25/result.v1.json","jsonPath":"/developmentGates","phase":"DEV","category":"LCB_INTERVAL","codes":["primaryInterval","sensitivityInterval","timingBenchmarkInterval"]},
  {"family":"vg25","artifactPath":"vg25/result.v1.json","jsonPath":"/developmentGates","phase":"DEV","category":"HOLM_MULTIPLICITY","codes":["holm"]},
  {"family":"vg25","artifactPath":"vg25/result.v1.json","jsonPath":"/developmentGates","phase":"DEV","category":"WHITE_RC","codes":["whiteRealityCheck"]},
  {"family":"vg25","artifactPath":"vg25/result.v1.json","jsonPath":"/developmentGates","phase":"DEV","category":"SAMPLE_ACTIVITY_BREADTH","codes":["activeWeeks","completedCohorts","distinctSelectedSymbols"]},
  {"family":"vg25","artifactPath":"vg25/result.v1.json","jsonPath":"/developmentGates","phase":"DEV","category":"OTHER","codes":["profitConcentration"]},
  {"family":"vg26","artifactPath":"vg26/result.v1.json","jsonPath":"/development/candidateRows/*/gates","phase":"DEV","category":"LCB_INTERVAL","codes":["absoluteBaseOneSided95LcbPositive","excessOneSided95LcbPositive"]},
  {"family":"vg26","artifactPath":"vg26/result.v1.json","jsonPath":"/development/candidateRows/*/gates","phase":"DEV","category":"HOLM_MULTIPLICITY","codes":["holmAdjustedPBelow005"]},
  {"family":"vg26","artifactPath":"vg26/result.v1.json","jsonPath":"/development/candidateRows/*/gates","phase":"DEV","category":"DRAWDOWN","codes":["maxDrawdownAtMost20Pct"]},
  {"family":"vg26","artifactPath":"vg26/result.v1.json","jsonPath":"/development/candidateRows/*/gates","phase":"DEV","category":"NET_POSITIVE","codes":["baseExcessTotalPositive","stressMeanPositive"]},
  {"family":"vg26","artifactPath":"vg26/result.v1.json","jsonPath":"/development/candidateRows/*/gates","phase":"DEV","category":"POSITIVE_PERIOD","codes":["positiveAbsoluteTwoMonthFoldsAtLeast4Of5","positiveExcessTwoMonthFoldsAtLeast4Of5"]},
  {"family":"vg26","artifactPath":"vg26/result.v1.json","jsonPath":"/development/candidateRows/*/gates","phase":"DEV","category":"SAMPLE_ACTIVITY_BREADTH","codes":["onDayCountAtLeast30"]},
  {"family":"vg28","artifactPath":"vg28/result.v1.json","jsonPath":"/development/candidateRows/*/gates","phase":"DEV","category":"LCB_INTERVAL","codes":["accelerationMinusDecelerationBaseLower95Positive","baseBootstrapLower95Positive"]},
  {"family":"vg28","artifactPath":"vg28/result.v1.json","jsonPath":"/development/candidateRows/*/gates","phase":"DEV","category":"HOLM_MULTIPLICITY","codes":["holmAdjustedPBelow005"]},
  {"family":"vg28","artifactPath":"vg28/result.v1.json","jsonPath":"/development/candidateRows/*/gates","phase":"DEV","category":"WHITE_RC","codes":["whiteRealityCheckPAtMost010"]},
  {"family":"vg28","artifactPath":"vg28/result.v1.json","jsonPath":"/development/candidateRows/*/gates","phase":"DEV","category":"DRAWDOWN","codes":["baseMaxDrawdownAtMost15Pct","stressMaxDrawdownAtMost20Pct"]},
  {"family":"vg28","artifactPath":"vg28/result.v1.json","jsonPath":"/development/candidateRows/*/gates","phase":"DEV","category":"NET_POSITIVE","codes":["baseNetPositive","stressNetPositive"]},
  {"family":"vg28","artifactPath":"vg28/result.v1.json","jsonPath":"/development/candidateRows/*/gates","phase":"DEV","category":"SAMPLE_ACTIVITY_BREADTH","codes":["activeDaysAtLeast30","episodeCountAtLeast40"]},
  {"family":"vg28","artifactPath":"vg28/result.v1.json","jsonPath":"/development/candidateRows/*/gates","phase":"DEV","category":"PBO","codes":["cscvPboAtMost020"]},
  {"family":"vg29","artifactPath":"vg29/result.v1.json","jsonPath":"/development/gateFailures","phase":"DEV","category":"LCB_INTERVAL","codes":["BASE_INTERVAL_LOWER_BOUND_NOT_POSITIVE","STRESS_INTERVAL_LOWER_BOUND_NOT_POSITIVE"]},
  {"family":"vg29","artifactPath":"vg29/result.v1.json","jsonPath":"/development/gateFailures","phase":"DEV","category":"HOLM_MULTIPLICITY","codes":["HOLM_ADJUSTED_P_NOT_BELOW_LIMIT"]},
  {"family":"vg29","artifactPath":"vg29/result.v1.json","jsonPath":"/development/gateFailures","phase":"DEV","category":"WHITE_RC","codes":["WHITE_REALITY_CHECK_P_NOT_BELOW_LIMIT"]},
  {"family":"vg29","artifactPath":"vg29/result.v1.json","jsonPath":"/development/gateFailures","phase":"DEV","category":"SAMPLE_ACTIVITY_BREADTH","codes":["ACTIVE_WEEKS_BELOW_MINIMUM","ROUND_TRIPS_BELOW_MINIMUM"]},
  {"family":"vg29","artifactPath":"vg29/result.v1.json","jsonPath":"/development/gateFailures","phase":"DEV","category":"PBO","codes":["PBO_ABOVE_LIMIT"]},
  {"family":"vg29","artifactPath":"vg29/result.v1.json","jsonPath":"/development/gateFailures","phase":"DEV","category":"OTHER","codes":["EXTERNAL_VG_ADJUSTED_P_NOT_BELOW_LIMIT"]},
  {"family":"vg31","artifactPath":"vg31/result.v1.json","jsonPath":"/development/trials/*/gates","phase":"DEV","category":"LCB_INTERVAL","codes":["lcbAboveZero"]},
  {"family":"vg31","artifactPath":"vg31/result.v1.json","jsonPath":"/development/trials/*/gates","phase":"DEV","category":"HOLM_MULTIPLICITY","codes":["holmPBelow0.05"]},
  {"family":"vg31","artifactPath":"vg31/result.v1.json","jsonPath":"/development/trials/*/gates","phase":"DEV","category":"WHITE_RC","codes":["whitePBelow0.05"]},
  {"family":"vg31","artifactPath":"vg31/result.v1.json","jsonPath":"/development/trials/*/gates","phase":"DEV","category":"DRAWDOWN","codes":["drawdownAtMost25Pct"]},
  {"family":"vg31","artifactPath":"vg31/result.v1.json","jsonPath":"/development/trials/*/gates","phase":"DEV","category":"NET_POSITIVE","codes":["netAboveZero"]},
  {"family":"vg31","artifactPath":"vg31/result.v1.json","jsonPath":"/development/trials/*/gates","phase":"DEV","category":"POSITIVE_PERIOD","codes":["positiveMonthsAtLeast5"]},
  {"family":"vg31","artifactPath":"vg31/result.v1.json","jsonPath":"/development/trials/*/gates","phase":"DEV","category":"OTHER","codes":["rawPBelow0.05"]},
  {"family":"vg32","artifactPath":"vg32/result.v1.json","jsonPath":"/developmentGateDecisions","phase":"DEV","category":"LCB_INTERVAL","codes":["DEV_ALWAYS_ON_EXCESS_14_DAY_LCB","DEV_PUBLIC_BASE_14_DAY_LCB","DEV_PUBLIC_BASE_7_DAY_LCB"]},
  {"family":"vg32","artifactPath":"vg32/result.v1.json","jsonPath":"/developmentGateDecisions","phase":"DEV","category":"HOLM_MULTIPLICITY","codes":["DEV_HOLM_ADJUSTED_P"]},
  {"family":"vg32","artifactPath":"vg32/result.v1.json","jsonPath":"/developmentGateDecisions","phase":"DEV","category":"WHITE_RC","codes":["DEV_WHITE_ALWAYS_ON_P","DEV_WHITE_CASH_P"]},
  {"family":"vg32","artifactPath":"vg32/result.v1.json","jsonPath":"/developmentGateDecisions","phase":"DEV","category":"DRAWDOWN","codes":["DEV_BASE_DRAWDOWN","DEV_STRESS_DRAWDOWN"]},
  {"family":"vg32","artifactPath":"vg32/result.v1.json","jsonPath":"/developmentGateDecisions","phase":"DEV","category":"POSITIVE_PERIOD","codes":["DEV_POSITIVE_PUBLIC_STRESS_MONTHS"]},
  {"family":"vg32","artifactPath":"vg32/result.v1.json","jsonPath":"/developmentGateDecisions","phase":"DEV","category":"PBO","codes":["DEV_CSCV_PBO"]},
  {"family":"vg35","artifactPath":"vg35/result.v1.json","jsonPath":"/developmentGates","phase":"DEV","category":"LCB_INTERVAL","codes":["primaryInterval","sensitivityInterval","sensitivityTimingBenchmarkInterval","timingBenchmarkInterval"]},
  {"family":"vg35","artifactPath":"vg35/result.v1.json","jsonPath":"/developmentGates","phase":"DEV","category":"HOLM_MULTIPLICITY","codes":["holmAbsolute","holmTimingMatched"]},
  {"family":"vg35","artifactPath":"vg35/result.v1.json","jsonPath":"/developmentGates","phase":"DEV","category":"WHITE_RC","codes":["whiteCash","whiteTimingMatched"]},
  {"family":"vg35","artifactPath":"vg35/result.v1.json","jsonPath":"/developmentGates","phase":"DEV","category":"POSITIVE_PERIOD","codes":["positiveFeeStressMonths"]},
  {"family":"vg35","artifactPath":"vg35/result.v1.json","jsonPath":"/developmentGates","phase":"DEV","category":"SAMPLE_ACTIVITY_BREADTH","codes":["activeCalendarDays","completedCohorts","completedSymbolSides","hazardRiskSet"]},
  {"family":"vg38","artifactPath":"vg38/result.v1.json","jsonPath":"/development/candidateRows/*/gates","phase":"DEV","category":"LCB_INTERVAL","codes":["absoluteBaseOneSided95LcbPositive","excessOneSided95LcbPositive"]},
  {"family":"vg38","artifactPath":"vg38/result.v1.json","jsonPath":"/development/candidateRows/*/gates","phase":"DEV","category":"HOLM_MULTIPLICITY","codes":["q14HolmSelectedAtFwer005"]},
  {"family":"vg38","artifactPath":"vg38/result.v1.json","jsonPath":"/development/candidateRows/*/gates","phase":"DEV","category":"DRAWDOWN","codes":["maxDrawdownAtMost20Pct"]},
  {"family":"vg38","artifactPath":"vg38/result.v1.json","jsonPath":"/development/candidateRows/*/gates","phase":"DEV","category":"NET_POSITIVE","codes":["baseExcessTotalPositive","stressExcessTotalPositive","stressNetTotalPositive"]},
  {"family":"vg38","artifactPath":"vg38/result.v1.json","jsonPath":"/development/candidateRows/*/gates","phase":"DEV","category":"POSITIVE_PERIOD","codes":["positiveAbsoluteTwoMonthFoldsAtLeast4Of5","positiveExcessTwoMonthFoldsAtLeast4Of5"]},
  {"family":"vg38","artifactPath":"vg38/result.v1.json","jsonPath":"/development/candidateRows/*/gates","phase":"DEV","category":"SAMPLE_ACTIVITY_BREADTH","codes":["onDayCountAtLeast30"]},
  {"family":"vg38","artifactPath":"vg38/result.v1.json","jsonPath":"/development/candidateRows/*/gates","phase":"DEV","category":"PBO","codes":["q14PboAvailableAndAtMost020"]},
  {"family":"vg8","artifactPath":"vg8/result.v1.json","jsonPath":"/gateDecisions","phase":"DEV","category":"LCB_INTERVAL","codes":["DEV_STRESS_LCB"]},
  {"family":"vg8","artifactPath":"vg8/result.v1.json","jsonPath":"/gateDecisions","phase":"DEV","category":"HOLM_MULTIPLICITY","codes":["DEV_HOLM_P"]},
  {"family":"vg8","artifactPath":"vg8/result.v1.json","jsonPath":"/gateDecisions","phase":"DEV","category":"WHITE_RC","codes":["DEV_WHITE_RC_BENCHMARK","DEV_WHITE_RC_CASH"]},
  {"family":"vg8","artifactPath":"vg8/result.v1.json","jsonPath":"/gateDecisions","phase":"DEV","category":"NET_POSITIVE","codes":["DEV_STRESS_NET"]},
  {"family":"vg8","artifactPath":"vg8/result.v1.json","jsonPath":"/gateDecisions","phase":"DEV","category":"POSITIVE_PERIOD","codes":["DEV_POSITIVE_STRESS_MONTHS"]},
  {"family":"vg8","artifactPath":"vg8/result.v1.json","jsonPath":"/gateDecisions","phase":"HOLDOUT","category":"LCB_INTERVAL","codes":["HOLDOUT_MATCHED_BENCHMARK_EXCESS_LCB","HOLDOUT_STRESS_LCB"]},
  {"family":"vg8","artifactPath":"vg8/result.v1.json","jsonPath":"/gateDecisions","phase":"HOLDOUT","category":"DRAWDOWN","codes":["HOLDOUT_DRAWDOWN"]},
  {"family":"vg8","artifactPath":"vg8/result.v1.json","jsonPath":"/gateDecisions","phase":"HOLDOUT","category":"NET_POSITIVE","codes":["HOLDOUT_BASE_NET","HOLDOUT_FEE_STRESS_NET","HOLDOUT_STRESS_NET"]},
  {"family":"vg8","artifactPath":"vg8/result.v1.json","jsonPath":"/gateDecisions","phase":"HOLDOUT","category":"POSITIVE_PERIOD","codes":["HOLDOUT_POSITIVE_STRESS_MONTHS"]},
  {"family":"vg8","artifactPath":"vg8/result.v1.json","jsonPath":"/gateDecisions","phase":"HOLDOUT","category":"OTHER","codes":["HOLDOUT_STRESS_ONE_SIDED_P"]},
] as const);

export type ResearchLabGateCategorySummary = Readonly<{
  category: ResearchLabGateCategory;
  label: string;
  familyCount: number;
  evidence: readonly ResearchLabGateEvidence[];
}>;
const GATE_CATEGORY_ORDER: readonly ResearchLabGateCategory[] = Object.freeze(["LCB_INTERVAL","HOLM_MULTIPLICITY","WHITE_RC","DRAWDOWN","NET_POSITIVE","POSITIVE_PERIOD","SAMPLE_ACTIVITY_BREADTH","PBO","OTHER"]);
const GATE_CATEGORY_LABELS: Readonly<Record<ResearchLabGateCategory, string>> = Object.freeze({
  LCB_INTERVAL: 'Uncertainty Interval / LCB',
  HOLM_MULTIPLICITY: 'Holm / Multiplicity',
  WHITE_RC: 'White / Reality Check',
  DRAWDOWN: 'Drawdown',
  NET_POSITIVE: 'Positive Net / Mean',
  POSITIVE_PERIOD: 'Positive-Period Consistency',
  SAMPLE_ACTIVITY_BREADTH: 'Sample / Activity / Breadth',
  PBO: 'PBO',
  OTHER: 'Other / Unmapped',
});

export function researchLabGateSummary(experiments: readonly ResearchLabExperiment[]): Readonly<{
  noGoFamilies: number;
  categorizedFamilies: number;
  uncategorizedFamilies: number;
  categories: readonly ResearchLabGateCategorySummary[];
}> {
  const noGo = new Set(experiments.filter((experiment) => experiment.verdict === 'NO_GO').map((experiment) => experiment.family));
  const evidence = RESEARCH_LAB_GATE_EVIDENCE.filter((row) => noGo.has(row.family));
  const named = new Set(evidence.map((row) => row.family));
  return Object.freeze({
    noGoFamilies: noGo.size,
    categorizedFamilies: named.size,
    uncategorizedFamilies: Math.max(0, noGo.size - named.size),
    categories: Object.freeze(GATE_CATEGORY_ORDER.map((category) => {
      const matching = evidence.filter((row) => row.category === category);
      return Object.freeze({
        category,
        label: GATE_CATEGORY_LABELS[category],
        familyCount: new Set(matching.map((row) => row.family)).size,
        evidence: Object.freeze(matching),
      });
    })),
  });
}

const rawGateRows = RESEARCH_LAB_GATE_EVIDENCE.reduce((total, row) => total + row.codes.length, 0);
const namedGateFamilies = new Set(RESEARCH_LAB_GATE_EVIDENCE.map((row) => row.family)).size;
const actualGateCounts = GATE_CATEGORY_ORDER.map((category) => new Set(RESEARCH_LAB_GATE_EVIDENCE.filter((row) => row.category === category).map((row) => row.family)).size);
const expectedGateCounts = Object.freeze([16,16,13,11,11,9,8,5,7]);
const shippedGateArtifactPaths = new Set(RESEARCH_LAB_ARTIFACTS.map((artifact) => artifact.path));
if (
  rawGateRows !== 151
  || namedGateFamilies !== 16
  || actualGateCounts.some((count, index) => count !== expectedGateCounts[index])
  || RESEARCH_LAB_GATE_EVIDENCE.some((row) => !shippedGateArtifactPaths.has(row.artifactPath))
) {
  throw new TypeError('RESEARCH_LAB_GATE_ANALYTICS_INTEGRITY_INVALID');
}
