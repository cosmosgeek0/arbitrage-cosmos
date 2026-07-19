import type {
  TokenEvidenceCapability,
  TokenEvidenceCapabilityId,
  TokenIntelligenceRead,
} from './tokenIntelligence';

export const VOLUME_OUTCOME_OWNER_TRUTH = Object.freeze({
  state: 'NOT_CONFIGURED' as const,
  frozenPreMoveCount: null,
  completedOutcomeCount: null,
  falsePositiveOutcomeCount: null,
  reasonCodes: Object.freeze([
    'OUTCOME_CAPTURE_OWNER_NOT_MOUNTED',
    'RETAINED_EVIDENCE_IS_NOT_OUTCOME_TRUTH',
  ]),
});

export interface VolumeWorkspaceTruth {
  symbol: string;
  observedAtMs: number;
  projectionState: TokenIntelligenceRead['projection']['state'];
  stage: Readonly<{
    hypothesis: string | null;
    marketStage: string | null;
    changedFirst: string | null;
    changedAtMs: number | null;
    leadMarket: NonNullable<TokenIntelligenceRead['bridge']['thesis']>['leadMarket'];
    evaluatedAtMs: number | null;
    freshness: NonNullable<TokenIntelligenceRead['bridge']['thesis']>['freshness'] | 'MISSING';
    completeness: NonNullable<TokenIntelligenceRead['bridge']['thesis']>['completeness'] | 'MISSING';
  }>;
  leadership: Readonly<{
    freshness: TokenEvidenceCapability['freshness'];
    completeness: TokenEvidenceCapability['completeness'];
    leadMarket: NonNullable<TokenIntelligenceRead['bridge']['thesis']>['leadMarket'];
    lastEvidenceTimeMs: number | null;
    sourceIds: readonly string[];
    reasonCodes: readonly string[];
  }>;
  markFunding: TokenIntelligenceRead['markFunding'];
  openInterest: TokenIntelligenceRead['openInterest'];
  liquidation: TokenIntelligenceRead['liquidation'];
  forensics: TokenIntelligenceRead['bridge']['forensics'];
  capabilities: readonly TokenEvidenceCapability[];
  retainedEvidence: Readonly<{
    count: number;
    state: TokenIntelligenceRead['bridge']['evidenceHistoryState'];
    evaluatedAtMs: number;
  }>;
  outcomeOwner: typeof VOLUME_OUTCOME_OWNER_TRUTH;
}

function capability(
  read: TokenIntelligenceRead,
  id: TokenEvidenceCapabilityId,
): TokenEvidenceCapability | null {
  return read.routing.capabilities.find((entry) => entry.capability === id) ?? null;
}

const INVALID_PLAIN_DATA = Symbol('invalid-plain-data');

function clonePlainData(
  value: unknown,
  state: { seen: WeakSet<object>; nodes: number } = { seen: new WeakSet<object>(), nodes: 0 },
): unknown | typeof INVALID_PLAIN_DATA {
  if (value === null || typeof value !== 'object') return value;
  try {
    if (state.seen.has(value) || state.nodes >= 16_384) return INVALID_PLAIN_DATA;
    state.seen.add(value);
    state.nodes += 1;
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype) return INVALID_PLAIN_DATA;
      const descriptors = Object.getOwnPropertyDescriptors(value) as Record<string, PropertyDescriptor>;
      const length = descriptors['length']?.value;
      if (!Number.isSafeInteger(length) || length < 0 || length > 4_096
          || Reflect.ownKeys(value).some((key) => typeof key !== 'string')
          || Object.keys(descriptors).filter((key) => key !== 'length').length !== length) return INVALID_PLAIN_DATA;
      const output: unknown[] = [];
      for (let index = 0; index < length; index += 1) {
        const descriptor = descriptors[String(index)];
        if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) return INVALID_PLAIN_DATA;
        const child = clonePlainData(descriptor.value, state);
        if (child === INVALID_PLAIN_DATA) return INVALID_PLAIN_DATA;
        output.push(child);
      }
      return output;
    }
    if (Object.getPrototypeOf(value) !== Object.prototype
        || Reflect.ownKeys(value).some((key) => typeof key !== 'string')) return INVALID_PLAIN_DATA;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Object.keys(descriptors);
    if (keys.length > 1_024) return INVALID_PLAIN_DATA;
    const output: Record<string, unknown> = {};
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (!Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) return INVALID_PLAIN_DATA;
      const child = clonePlainData(descriptor.value, state);
      if (child === INVALID_PLAIN_DATA) return INVALID_PLAIN_DATA;
      output[key] = child;
    }
    return output;
  } catch {
    return INVALID_PLAIN_DATA;
  }
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): Readonly<T> {
  if (typeof value !== 'object' || value === null || seen.has(value)) return value;
  seen.add(value);
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
    if (Object.hasOwn(descriptor, 'value')) deepFreeze(descriptor.value, seen);
  }
  return Object.freeze(value);
}

function detachedFact<T extends object>(
  fact: TokenIntelligenceRead['markFunding'] | TokenIntelligenceRead['openInterest'] | TokenIntelligenceRead['liquidation'],
): typeof fact {
  return {
    state: fact.state,
    sourceId: fact.sourceId,
    dataset: fact.dataset,
    observedAtMs: fact.observedAtMs,
    value: fact.value === null ? null : { ...fact.value } as T,
    reasonCodes: [...fact.reasonCodes],
  } as typeof fact;
}

/**
 * Presentation-only projection of the strict exact-symbol read. It preserves
 * owner values and only removes a leadership direction when its capability is
 * not current. It never scores, classifies, or attributes an outcome.
 */
export function projectVolumeWorkspaceTruth(
  input: TokenIntelligenceRead | null,
  expectedSymbol: string,
): VolumeWorkspaceTruth | null {
  const cloned = clonePlainData(input);
  if (cloned === INVALID_PLAIN_DATA || cloned === null || typeof cloned !== 'object') return null;
  const read = cloned as TokenIntelligenceRead;
  try {
  if (read.symbol !== expectedSymbol) return null;
  const thesis = read.bridge.thesis;
  const current = read.projection.state === 'ACTIVE' && read.bridge.currentState === 'CURRENT';
  const thesisUsable = current && thesis?.freshness === 'FRESH' && thesis.completeness === 'COMPLETE';
  const leadership = capability(read, 'CROSS_MARKET_LEADERSHIP');
  if (leadership === null) return null;
  const snapshot: VolumeWorkspaceTruth = {
    symbol: read.symbol,
    observedAtMs: read.observedAtMs,
    projectionState: read.projection.state,
    stage: {
      hypothesis: thesisUsable ? thesis.hypothesis : null,
      marketStage: thesisUsable ? thesis.stage : null,
      changedFirst: thesisUsable ? thesis.changedFirst : null,
      changedAtMs: thesisUsable ? thesis.changedAtMs : null,
      leadMarket: thesisUsable ? thesis.leadMarket : 'UNKNOWN',
      evaluatedAtMs: current ? thesis?.evaluatedAtMs ?? null : null,
      freshness: current ? thesis?.freshness ?? 'MISSING' : 'MISSING',
      completeness: current ? thesis?.completeness ?? 'MISSING' : 'MISSING',
    },
    leadership: {
      freshness: leadership.freshness,
      completeness: leadership.completeness,
      // Routing owns current evidence availability, not a directional claim.
      // The retained thesis direction is exposed separately with its own cut.
      leadMarket: 'UNKNOWN',
      lastEvidenceTimeMs: leadership.lastEvidenceTimeMs,
      sourceIds: [...leadership.sourceIds],
      reasonCodes: [...leadership.reasonCodes],
    },
    markFunding: detachedFact(read.markFunding) as TokenIntelligenceRead['markFunding'],
    openInterest: detachedFact(read.openInterest) as TokenIntelligenceRead['openInterest'],
    liquidation: detachedFact(read.liquidation) as TokenIntelligenceRead['liquidation'],
    forensics: current && read.bridge.forensics !== null
      ? {
          ...read.bridge.forensics,
          reasonCodes: [...read.bridge.forensics.reasonCodes],
        }
      : null,
    capabilities: read.routing.capabilities.map((entry) => ({
      ...entry,
      sourceIds: [...entry.sourceIds],
      reasonCodes: [...entry.reasonCodes],
    })),
    retainedEvidence: {
      count: read.bridge.evidenceHistoryCount,
      state: read.bridge.evidenceHistoryState,
      evaluatedAtMs: read.bridge.evaluatedAtMs,
    },
    outcomeOwner: VOLUME_OUTCOME_OWNER_TRUTH,
  };
  return deepFreeze(snapshot) as VolumeWorkspaceTruth;
  } catch {
    return null;
  }
}
