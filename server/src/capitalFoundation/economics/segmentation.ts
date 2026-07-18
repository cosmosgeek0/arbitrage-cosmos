import { isValidUtcMillis } from '../../foundation/contracts/index.js';
import {
  capitalDigest,
  isExactDecimal,
  sumExactDecimals,
  type EconomicComponent,
  type ExactDecimal,
} from '../contracts/index.js';
import { composeEconomicReport } from './compose.js';
import type { EconomicReport } from './types.js';

export const NET_PNL_SEGMENTATION_AXES = Object.freeze([
  'strategy',
  'regime',
  'symbolClass',
  'confidence',
  'entryStage',
  'holdingPeriod',
  'reason',
  'executionPath',
  'modelVersion',
] as const);
export type NetPnlSegmentationAxis = (typeof NET_PNL_SEGMENTATION_AXES)[number];

export type NetPnlEvidencePosture = 'PRODUCTION_OBSERVED' | 'RECORDED_REPLAY';

export const PRODUCTION_NET_PNL_CORPUS_NOT_CONFIGURED =
  'PRODUCTION_NET_PNL_CORPUS_NOT_CONFIGURED';

export interface NetPnlDimensions {
  readonly strategy: string | null;
  readonly regime: string | null;
  readonly symbolClass: string | null;
  readonly confidence: string | null;
  readonly entryStage: string | null;
  readonly holdingPeriod: string | null;
  readonly reason: string | null;
  readonly executionPath: string | null;
  readonly modelVersion: string | null;
}

export interface NetPnlSegmentationRecord {
  readonly recordId: string;
  readonly sourceRevision: string;
  readonly evidencePosture: NetPnlEvidencePosture;
  readonly closedAtMs: number;
  readonly dimensions: Readonly<NetPnlDimensions>;
  readonly economicReport: Readonly<EconomicReport>;
}

export interface NetPnlSegment {
  readonly segmentId: string;
  readonly dimensions: Readonly<NetPnlDimensions>;
  readonly recordIds: readonly string[];
  readonly recordCount: number;
  readonly netPnl: ExactDecimal;
}

export interface NetPnlRecordLineage {
  readonly recordId: string;
  readonly sourceRevision: string;
  readonly evidencePosture: NetPnlEvidencePosture;
  readonly closedAtMs: number;
  readonly closedOutcomeScopeId: string;
  readonly economicReportRevision: string;
  readonly policyRevision: string;
  /** Canonical union of source IDs from the owner's included economic components. */
  readonly evidenceSourceIds: readonly string[];
}

export interface BuildNineAxisNetPnlReportInput {
  readonly reportId: string;
  readonly valuationAsset: string;
  readonly evaluatedAtMs: number;
  readonly records: readonly Readonly<NetPnlSegmentationRecord>[];
}

export interface NineAxisNetPnlReport {
  readonly reportId: string;
  readonly revision: string;
  readonly valuationAsset: string;
  readonly evaluatedAtMs: number;
  readonly axes: readonly NetPnlSegmentationAxis[];
  readonly status:
    | 'AVAILABLE'
    | 'DATA_INSUFFICIENT'
    | 'DIVERGENT'
    | 'PARTIAL'
    | 'RECORDED_REPLAY'
    | 'UNAVAILABLE';
  readonly segments: readonly Readonly<NetPnlSegment>[];
  readonly recordLineages: readonly Readonly<NetPnlRecordLineage>[];
  readonly includedRecordIds: readonly string[];
  readonly excludedRecordIds: readonly string[];
  readonly reasonCodes: readonly string[];
}

interface EligibleRecord {
  readonly recordId: string;
  readonly sourceRevision: string;
  readonly posture: NetPnlEvidencePosture;
  readonly closedAtMs: number;
  readonly closedOutcomeScopeId: string;
  readonly dimensions: Readonly<NetPnlDimensions>;
  readonly netPnl: ExactDecimal;
  readonly economicReportRevision: string;
  readonly policyRevision: string;
  readonly evidenceSourceIds: readonly string[];
}

interface RecordAssessment {
  readonly reasons: readonly string[];
  readonly eligible: EligibleRecord | null;
}

const MAX_RECORDS = 10_000;
const MAX_COMPONENTS_PER_RECORD = 128;
const MAX_EVIDENCE_REFS_PER_RECORD = 64;
const MAX_IDENTITY_LENGTH = 256;

function nonEmpty(value: unknown, maximum = 256): value is string {
  return typeof value === 'string'
    && value.trim() === value
    && value.length > 0
    && value.length <= maximum;
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sortedUnique<T extends string>(values: readonly T[]): readonly T[] {
  return Object.freeze([...new Set(values)].sort(compareCodeUnits));
}

function canonicalSetValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value
      .map((entry) => canonicalSetValue(entry))
      .sort((left, right) => {
        const digestOrder = compareCodeUnits(capitalDigest(left), capitalDigest(right));
        if (digestOrder !== 0) return digestOrder;
        return compareCodeUnits(JSON.stringify(left), JSON.stringify(right));
      });
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => compareCodeUnits(left, right))
      .map(([key, entry]) => [key, canonicalSetValue(entry)]));
  }
  return value;
}

function canonicalComponent(component: Readonly<EconomicComponent>): Readonly<EconomicComponent> {
  return Object.freeze({
    ...component,
    estimateRange: component.estimateRange === null
      ? null
      : Object.freeze({ ...component.estimateRange }),
    sourceIds: sortedUnique(component.sourceIds),
    reasonCodes: sortedUnique(component.reasonCodes),
  });
}

function canonicalComponents(
  components: readonly Readonly<EconomicComponent>[],
): readonly Readonly<EconomicComponent>[] {
  return Object.freeze(components.map(canonicalComponent).sort((left, right) => {
    const identityOrder = compareCodeUnits(left.id, right.id);
    return identityOrder !== 0
      ? identityOrder
      : compareCodeUnits(capitalDigest(left), capitalDigest(right));
  }));
}

function freezeDimensions(value: Readonly<NetPnlDimensions>): Readonly<NetPnlDimensions> {
  return Object.freeze(Object.fromEntries(
    NET_PNL_SEGMENTATION_AXES.map((axis) => [axis, value[axis]]),
  ) as unknown as NetPnlDimensions);
}

function assessRecord(
  record: Readonly<NetPnlSegmentationRecord>,
  valuationAsset: string,
  evaluatedAtMs: number,
): RecordAssessment {
  const reasons: string[] = [];
  if (!nonEmpty(record.recordId, MAX_IDENTITY_LENGTH)) reasons.push('RECORD_ID_INVALID');
  if (!nonEmpty(record.sourceRevision, MAX_IDENTITY_LENGTH)) reasons.push('SOURCE_REVISION_INVALID');
  if (record.evidencePosture !== 'PRODUCTION_OBSERVED'
    && record.evidencePosture !== 'RECORDED_REPLAY') reasons.push('EVIDENCE_POSTURE_INVALID');
  if (record.evidencePosture === 'PRODUCTION_OBSERVED') {
    // A caller-selected posture and source revision are not production authority.
    // No canonical realized-outcome corpus/attestation owner is configured yet, so
    // production-tagged rows stay excluded until that owner can issue and validate
    // a content-bound attestation rather than letting this pure report mint truth.
    reasons.push(PRODUCTION_NET_PNL_CORPUS_NOT_CONFIGURED);
  }
  if (!isValidUtcMillis(record.closedAtMs)) {
    reasons.push('CLOSED_AT_INVALID');
  }
  if (!record.dimensions || typeof record.dimensions !== 'object') {
    reasons.push('DIMENSIONS_REQUIRED');
  } else {
    for (const axis of NET_PNL_SEGMENTATION_AXES) {
      if (!nonEmpty(record.dimensions[axis], MAX_IDENTITY_LENGTH)) {
        reasons.push(`DIMENSION_${axis.toUpperCase()}_UNAVAILABLE`);
      }
    }
  }
  const report = record.economicReport;
  if (!report || typeof report !== 'object') {
    return Object.freeze({ reasons: sortedUnique([...reasons, 'ECONOMIC_REPORT_REQUIRED']), eligible: null });
  }

  try {
    if (report.scope.kind !== 'CLOSED_OUTCOME') reasons.push('CLOSED_OUTCOME_REQUIRED');
    for (const identity of [
      report.scope.id,
      report.scope.strategy,
      report.scope.opportunityId,
      report.scope.configRevision,
      report.scope.stage,
      report.scope.symbol,
      report.scope.legId,
      report.scope.correlationId,
      report.policy.authority.sourceId,
      report.policy.authority.revision,
    ]) {
      if (identity !== null && !nonEmpty(identity, MAX_IDENTITY_LENGTH)) {
        reasons.push('ECONOMIC_IDENTITY_INVALID');
      }
    }
    if (record.dimensions?.strategy !== report.scope.strategy) reasons.push('STRATEGY_SCOPE_DIVERGENT');
    if (report.attribution.valuationAsset !== valuationAsset) reasons.push('VALUATION_ASSET_DIVERGENT');
    if (!Array.isArray(report.attribution.components)
      || report.attribution.components.length > MAX_COMPONENTS_PER_RECORD) {
      reasons.push('ECONOMIC_COMPONENTS_UNBOUNDED');
      return Object.freeze({ reasons: sortedUnique(reasons), eligible: null });
    }
    const components: readonly Readonly<EconomicComponent>[] = Array.isArray(report.attribution.components)
      ? report.attribution.components
      : [];
    for (const component of components) {
      for (const identity of [
        component.id,
        component.valuationAsset,
        component.strategy,
        component.opportunityId,
        component.configRevision,
        component.stage,
        component.symbol,
        component.legId,
        component.correlationId,
      ]) {
        if (identity !== null && !nonEmpty(identity, MAX_IDENTITY_LENGTH)) {
          reasons.push('ECONOMIC_COMPONENT_IDENTITY_INVALID');
        }
      }
      if (!Array.isArray(component.sourceIds)
        || component.sourceIds.some((sourceId) => !nonEmpty(sourceId, MAX_IDENTITY_LENGTH))
        || new Set(component.sourceIds).size !== component.sourceIds.length) {
        reasons.push('ECONOMIC_COMPONENT_SOURCE_IDS_INVALID');
      }
      if (Array.isArray(component.sourceIds)
        && component.sourceIds.length > MAX_EVIDENCE_REFS_PER_RECORD) {
        reasons.push('EVIDENCE_SOURCE_IDS_UNBOUNDED');
      }
      if (!Array.isArray(component.reasonCodes)
        || component.reasonCodes.length > MAX_EVIDENCE_REFS_PER_RECORD
        || component.reasonCodes.some((reason) => !nonEmpty(reason, MAX_IDENTITY_LENGTH))
        || new Set(component.reasonCodes).size !== component.reasonCodes.length) {
        reasons.push('ECONOMIC_COMPONENT_REASON_CODES_INVALID');
      }
      if (component.observedAtMs !== null
        && (!isValidUtcMillis(component.observedAtMs)
          || (isValidUtcMillis(record.closedAtMs) && component.observedAtMs > record.closedAtMs))) {
        reasons.push('COMPONENT_OBSERVED_AFTER_CLOSE');
      }
      if ((component.status === 'KNOWN' || component.status === 'ESTIMATED')
        && component.observedAtMs === null) {
        reasons.push('COMPONENT_OBSERVED_AT_REQUIRED');
      }
    }
    if (reasons.includes('EVIDENCE_SOURCE_IDS_UNBOUNDED')) {
      return Object.freeze({ reasons: sortedUnique(reasons), eligible: null });
    }
    if (!isValidUtcMillis(report.attribution.evaluatedAtMs)
      || (isValidUtcMillis(record.closedAtMs)
        && record.closedAtMs > report.attribution.evaluatedAtMs)
      || report.attribution.evaluatedAtMs > evaluatedAtMs) {
      reasons.push('ECONOMIC_REPORT_CHRONOLOGY_INVALID');
    }

    let recomposed: Readonly<EconomicReport> | null = null;
    try {
      recomposed = composeEconomicReport({
        scope: report.scope,
        valuationAsset: report.attribution.valuationAsset,
        components: canonicalComponents(components),
        policy: Object.freeze({
          ...report.policy,
          authority: Object.freeze({ ...report.policy.authority }),
          expectedComponentKinds: sortedUnique(report.policy.expectedComponentKinds),
        }),
        evaluatedAtMs: report.attribution.evaluatedAtMs,
      });
    } catch {
      reasons.push('ECONOMIC_REPORT_RECOMPOSITION_FAILED');
    }
    if (recomposed !== null
      && capitalDigest(canonicalSetValue(report)) !== capitalDigest(canonicalSetValue(recomposed))) {
      reasons.push('ECONOMIC_REPORT_CONTENT_MISMATCH');
    }
    if (recomposed === null) return Object.freeze({ reasons: sortedUnique(reasons), eligible: null });

    if (recomposed.accountingStatus !== 'COMPLETE'
      || recomposed.attribution.completeness !== 'COMPLETE'
      || recomposed.identity.proven !== true
      || recomposed.attribution.accountingIdentityProven !== true) {
      reasons.push('ACCOUNTING_IDENTITY_INCOMPLETE');
    }
    if (recomposed.measures.realizedPnl.status !== 'KNOWN'
      || recomposed.measures.realizedPnl.knownAmount === null) reasons.push('REALIZED_PNL_UNAVAILABLE');
    if (!isExactDecimal(recomposed.attribution.netKnown)) reasons.push('NET_PNL_INVALID');

    const includedIds = new Set(recomposed.attribution.includedComponentIds);
    const evidenceSourceIds = sortedUnique(recomposed.attribution.components
      .filter((component) => includedIds.has(component.id))
      .flatMap((component) => component.sourceIds));
    if (evidenceSourceIds.length === 0 || evidenceSourceIds.length > MAX_EVIDENCE_REFS_PER_RECORD) {
      reasons.push('EVIDENCE_SOURCE_IDS_UNBOUNDED');
    }
    const canonicalReasons = sortedUnique(reasons);
    if (canonicalReasons.length > 0) {
      return Object.freeze({ reasons: canonicalReasons, eligible: null });
    }
    const economicReportRevision = `capital-economic-report:${capitalDigest(canonicalSetValue(recomposed))}`;
    return Object.freeze({
      reasons: Object.freeze([]),
      eligible: Object.freeze({
        recordId: record.recordId,
        sourceRevision: record.sourceRevision,
        posture: record.evidencePosture,
        closedAtMs: record.closedAtMs,
        closedOutcomeScopeId: recomposed.scope.id,
        dimensions: freezeDimensions(record.dimensions),
        netPnl: recomposed.attribution.netKnown,
        economicReportRevision,
        policyRevision: recomposed.policy.authority.revision,
        evidenceSourceIds,
      }),
    });
  } catch {
    return Object.freeze({
      reasons: sortedUnique([...reasons, 'ECONOMIC_REPORT_INVALID']),
      eligible: null,
    });
  }
}

function buildSegments(records: readonly EligibleRecord[]): readonly Readonly<NetPnlSegment>[] {
  const groups = new Map<string, EligibleRecord[]>();
  for (const record of [...records].sort((left, right) => compareCodeUnits(left.recordId, right.recordId))) {
    const key = capitalDigest(record.dimensions);
    const group = groups.get(key) ?? [];
    group.push(record);
    groups.set(key, group);
  }
  return Object.freeze([...groups.entries()]
    .sort(([left], [right]) => compareCodeUnits(left, right))
    .map(([segmentId, group]) => Object.freeze({
      segmentId,
      dimensions: group[0].dimensions,
      recordIds: sortedUnique(group.map((record) => record.recordId)),
      recordCount: group.length,
      netPnl: sumExactDecimals(group.map((record) => record.netPnl)),
    })));
}

export function buildNineAxisNetPnlReport(
  input: BuildNineAxisNetPnlReportInput,
): Readonly<NineAxisNetPnlReport> {
  if (!nonEmpty(input.reportId)) throw new TypeError('net-PnL report ID is invalid');
  if (!nonEmpty(input.valuationAsset, 32)) throw new TypeError('net-PnL valuation asset is invalid');
  if (!isValidUtcMillis(input.evaluatedAtMs)) throw new TypeError('evaluatedAtMs must be UTC milliseconds');
  if (!Array.isArray(input.records) || input.records.length > MAX_RECORDS) {
    throw new TypeError('net-PnL records must be a bounded array');
  }
  const recordIds = input.records.map((record) => record.recordId);
  if (recordIds.length !== new Set(recordIds).size) throw new TypeError('net-PnL record IDs must be unique');
  const eligible: EligibleRecord[] = [];
  const excludedRecordIds: string[] = [];
  const reasonCodes: string[] = [];
  for (const record of input.records) {
    const assessment = assessRecord(record, input.valuationAsset, input.evaluatedAtMs);
    if (assessment.eligible === null) {
      excludedRecordIds.push(record.recordId);
      reasonCodes.push(...assessment.reasons.map((reason) => `${nonEmpty(record.recordId) ? record.recordId : 'UNKNOWN'}:${reason}`));
      continue;
    }
    eligible.push(assessment.eligible);
  }
  const postures = new Set(eligible.map((record) => record.posture));
  const declaredPostures = new Set(input.records
    .map((record) => record.evidencePosture)
    .filter((posture): posture is NetPnlEvidencePosture => posture === 'PRODUCTION_OBSERVED'
      || posture === 'RECORDED_REPLAY'));
  if (declaredPostures.size > 1) reasonCodes.push('EVIDENCE_POSTURE_DIVERGENT');
  const scopeOwners = new Map<string, string[]>();
  for (const record of input.records) {
    const scope = record.economicReport?.scope;
    if (scope?.kind !== 'CLOSED_OUTCOME' || !nonEmpty(scope.id, MAX_IDENTITY_LENGTH)) continue;
    const owners = scopeOwners.get(scope.id) ?? [];
    owners.push(record.recordId);
    scopeOwners.set(scope.id, owners);
  }
  const duplicateScopeIds = [...scopeOwners.entries()]
    .filter(([, owners]) => owners.length > 1)
    .map(([scopeId]) => scopeId)
    .sort(compareCodeUnits);
  reasonCodes.push(...duplicateScopeIds.map((scopeId) => `CLOSED_OUTCOME_SCOPE_ID_DIVERGENT:${scopeId}`));
  const divergent = declaredPostures.size > 1 || duplicateScopeIds.length > 0;
  const segments = divergent ? Object.freeze([]) : buildSegments(eligible);
  const recordLineages = Object.freeze(eligible
    .map((record): Readonly<NetPnlRecordLineage> => Object.freeze({
      recordId: record.recordId,
      sourceRevision: record.sourceRevision,
      evidencePosture: record.posture,
      closedAtMs: record.closedAtMs,
      closedOutcomeScopeId: record.closedOutcomeScopeId,
      economicReportRevision: record.economicReportRevision,
      policyRevision: record.policyRevision,
      evidenceSourceIds: record.evidenceSourceIds,
    }))
    .sort((left, right) => compareCodeUnits(left.recordId, right.recordId)));
  let status: NineAxisNetPnlReport['status'];
  if (input.records.length === 0) status = 'DATA_INSUFFICIENT';
  else if (divergent) status = 'DIVERGENT';
  else if (eligible.length === 0) status = 'UNAVAILABLE';
  else if (excludedRecordIds.length > 0) status = 'PARTIAL';
  else if (postures.has('RECORDED_REPLAY')) status = 'RECORDED_REPLAY';
  else status = 'AVAILABLE';
  const payload = {
    axes: NET_PNL_SEGMENTATION_AXES,
    evaluatedAtMs: input.evaluatedAtMs,
    excludedRecordIds: sortedUnique(excludedRecordIds),
    includedRecordIds: sortedUnique(eligible.map((record) => record.recordId)),
    reasonCodes: sortedUnique(reasonCodes),
    recordLineages,
    reportId: input.reportId,
    segments,
    status,
    valuationAsset: input.valuationAsset,
  };
  return Object.freeze({
    ...payload,
    revision: `capital-net-pnl:${capitalDigest(payload)}`,
    axes: Object.freeze([...NET_PNL_SEGMENTATION_AXES]),
    segments,
  });
}
