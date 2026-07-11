import type {
  BorrowTruth,
} from '../../foundation/borrow/index.js';
import type {
  ContractResult,
  PlanLifecycle,
  ReconciliationStatus,
} from '../../foundation/contracts/index.js';
import type { TruthMetadata as IntelligenceTruthMetadata } from '../../intelligenceFoundation/contracts/index.js';
import type { BoundRiskDecisionReference, ControlPostureSnapshot } from './capital.js';
import type { CapitalEventId } from './identity.js';
import type { ProposalIntakeRecord } from './opportunity.js';
import type { TruthMetadata } from './truth.js';

/** Read ports expose already-supplied values. Core policy never fetches. */
export interface ProposalIntakePort {
  readonly readProposalIntakes: () => readonly Readonly<ProposalIntakeRecord>[];
}

export interface IntelligenceEvidenceReference {
  readonly evidenceId: string;
  readonly kind: string;
  readonly instrumentId: string;
  readonly truth: IntelligenceTruthMetadata;
  readonly exactFinancialFactIds: readonly string[];
  readonly omittedNumericFields: readonly string[];
}

export interface IntelligenceEvidencePort {
  readonly readEvidenceReferences: (ids: readonly string[]) => readonly Readonly<IntelligenceEvidenceReference>[];
}

export interface IntelligenceThesisPort {
  readonly readThesisReference: (id: string) => Readonly<IntelligenceThesisReference> | null;
}

export interface IntelligenceThesisReference {
  readonly thesisPacketId: string;
  readonly instrumentId: string;
  readonly hypothesis: string;
  readonly stage: string;
  readonly leadMarket: 'SPOT' | 'PERPETUAL' | 'NEITHER' | 'UNKNOWN';
  readonly supportingFactIds: readonly string[];
  readonly conflictingFactIds: readonly string[];
  readonly unavailableFactIds: readonly string[];
  readonly tradeability: 'SUPPORTED' | 'BLOCKED' | 'UNKNOWN';
  readonly reasonCodes: readonly string[];
  readonly truth: IntelligenceTruthMetadata;
  readonly omittedNumericFields: readonly string[];
}

export interface OutcomeReferencePort {
  readonly readOutcomeReferenceIds: (proposalId: string) => readonly string[];
}

export interface BorrowTruthPort {
  readonly readBorrowTruth: () => readonly Readonly<BorrowTruth>[];
}

export interface ControlPosturePort {
  readonly readControlPosture: () => Readonly<ControlPostureSnapshot>;
}

export interface RiskDecisionPort {
  readonly readBoundRiskDecision: (mandateId: string) => Readonly<BoundRiskDecisionReference> | null;
}

export interface ExecutionStateSlice {
  readonly externalPlanId: string;
  readonly correlationId: string;
  readonly lifecycle: PlanLifecycle;
  readonly observedAtMs: number;
  readonly sequence: number | null;
  readonly revision: string | null;
  readonly truth: Readonly<TruthMetadata>;
}

export interface ExecutionStatePort {
  readonly readExecutionState: (externalPlanId: string) => Readonly<ExecutionStateSlice> | null;
}

export interface ReconciliationStateSlice {
  readonly externalPlanId: string;
  readonly correlationId: string;
  readonly status: ReconciliationStatus;
  readonly observedAtMs: number;
  readonly sequence: number | null;
  readonly revision: string | null;
  readonly reasonCodes: readonly string[];
  readonly truth: Readonly<TruthMetadata>;
}

export interface ReconciliationStatePort {
  readonly readReconciliationState: (externalPlanId: string) => Readonly<ReconciliationStateSlice> | null;
}

export type CapitalJsonValue =
  | string
  | boolean
  | null
  | readonly CapitalJsonValue[]
  | { readonly [key: string]: CapitalJsonValue };

/**
 * Runtime guard for checkpoint/event payloads. Numbers are deliberately
 * rejected: timestamps/revisions live in typed envelope fields, while every
 * exact financial value is serialized as a canonical decimal string.
 */
export function validateCapitalJsonValue(value: unknown): readonly string[] {
  const issues: string[] = [];
  const seen = new Set<object>();
  const visit = (current: unknown, path: string, depth: number): void => {
    if (depth > 64) {
      issues.push(`${path}:DEPTH_LIMIT_EXCEEDED`);
      return;
    }
    if (current === null || typeof current === 'string' || typeof current === 'boolean') return;
    if (typeof current === 'number') {
      issues.push(`${path}:NUMBER_REQUIRES_STRING_ENCODING`);
      return;
    }
    if (typeof current !== 'object') {
      issues.push(`${path}:UNSERIALIZABLE_VALUE`);
      return;
    }
    if (seen.has(current)) {
      issues.push(`${path}:CYCLIC_VALUE`);
      return;
    }
    seen.add(current);
    if (Array.isArray(current)) {
      current.forEach((entry, index) => visit(entry, `${path}[${index}]`, depth + 1));
    } else if (Object.getPrototypeOf(current) === Object.prototype || Object.getPrototypeOf(current) === null) {
      for (const key of Object.keys(current).sort()) {
        visit((current as Record<string, unknown>)[key], `${path}.${key}`, depth + 1);
      }
    } else {
      issues.push(`${path}:PLAIN_OBJECT_REQUIRED`);
    }
    seen.delete(current);
  };
  visit(value, '$', 0);
  return Object.freeze(issues);
}

export interface CapitalEventEnvelope {
  readonly id: CapitalEventId;
  readonly schemaVersion: number;
  readonly streamId: string;
  readonly sequence: number;
  readonly kind: string;
  readonly occurredAtMs: number;
  readonly correlationId: string;
  readonly payload: CapitalJsonValue;
}

/** Definition only. This sprint supplies no implementation and performs no I/O. */
export interface CapitalPersistencePort {
  readonly append: (events: readonly Readonly<CapitalEventEnvelope>[]) => ContractResult<readonly CapitalEventId[]>;
}
