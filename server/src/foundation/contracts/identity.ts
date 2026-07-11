/**
 * Foundation contracts — stable identity (WAVE 0, frozen).
 *
 * Deterministic ID derivation for every ID kind the sprint directive
 * freezes: command, correlation, source/canonical decision, source/canonical
 * proposal, plan, leg, event, state revision, and configuration version.
 * (Client-order IDs live in exchange.ts because they carry a venue charset
 * constraint; they reuse the hash kernel exported here.)
 *
 * LAWS:
 *   - An ID is a pure function of its semantic inputs. Same inputs => same
 *     ID, forever, across processes.
 *   - IDs never depend on array position, iteration order, or wall clock.
 *     When an occurrence time is semantically part of an identity, the
 *     caller passes it explicitly as data.
 *   - Invalid inputs throw TypeError; an ID is never fabricated from junk.
 *
 * Pure module: no I/O, no clocks, no randomness, no import-time side effects.
 */

// ---------- canonical JSON ----------

/**
 * Deterministic JSON: object keys sorted, arrays kept in order. Rejects
 * (throws TypeError) anything that cannot round-trip honestly: undefined,
 * functions, symbols, bigints, NaN/Infinity, class instances, Dates, Maps,
 * Sets, and cyclic structures. Used for identity derivation, configuration
 * versioning, and checksums.
 */
export function canonicalJson(value: unknown): string {
  return encodeCanonical(value, new Set<object>(), '$');
}

function encodeCanonical(value: unknown, seen: Set<object>, path: string): string {
  if (value === null) return 'null';
  const t = typeof value;
  if (t === 'boolean') return value ? 'true' : 'false';
  if (t === 'number') {
    if (!Number.isFinite(value as number)) {
      throw new TypeError(`canonicalJson: non-finite number at ${path}`);
    }
    return JSON.stringify(value);
  }
  if (t === 'string') return JSON.stringify(value);
  if (t === 'undefined' || t === 'function' || t === 'symbol' || t === 'bigint') {
    throw new TypeError(`canonicalJson: unserializable ${t} at ${path}`);
  }
  const obj = value as object;
  if (seen.has(obj)) {
    throw new TypeError(`canonicalJson: cyclic structure at ${path}`);
  }
  if (Array.isArray(obj)) {
    seen.add(obj);
    const parts = obj.map((item, i) => encodeCanonical(item, seen, `${path}[${i}]`));
    seen.delete(obj);
    return `[${parts.join(',')}]`;
  }
  const proto = Object.getPrototypeOf(obj);
  if (proto !== Object.prototype && proto !== null) {
    throw new TypeError(`canonicalJson: non-plain object at ${path}`);
  }
  seen.add(obj);
  const keys = Object.keys(obj).sort();
  const parts: string[] = [];
  for (const key of keys) {
    const v = (obj as Record<string, unknown>)[key];
    if (v === undefined) {
      throw new TypeError(`canonicalJson: undefined value at ${path}.${key}`);
    }
    parts.push(`${JSON.stringify(key)}:${encodeCanonical(v, seen, `${path}.${key}`)}`);
  }
  seen.delete(obj);
  return `{${parts.join(',')}}`;
}

// ---------- hash kernel (FNV-1a 64-bit, dependency-free) ----------

const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const MASK_64 = 0xffffffffffffffffn;

function fnv1a64(input: string): bigint {
  let hash = FNV_OFFSET;
  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i);
    hash = ((hash ^ BigInt(code & 0xff)) * FNV_PRIME) & MASK_64;
    hash = ((hash ^ BigInt(code >>> 8)) * FNV_PRIME) & MASK_64;
  }
  return hash;
}

/** 16 lowercase hex chars, deterministic across processes. */
export function stableHash64Hex(input: string): string {
  if (typeof input !== 'string') throw new TypeError('stableHash64Hex: input must be a string');
  return fnv1a64(input).toString(16).padStart(16, '0');
}

/** 32 lowercase hex chars (two independent 64-bit lanes). */
export function stableHash128Hex(input: string): string {
  if (typeof input !== 'string') throw new TypeError('stableHash128Hex: input must be a string');
  return stableHash64Hex(input) + stableHash64Hex(`\u0001${input}`);
}

// ---------- shared input validation ----------

function requireLabel(name: string, value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > 256) {
    throw new TypeError(`${name} must be a non-empty string (<=256 chars)`);
  }
  return value;
}

function requireCount(name: string, value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${name} must be a non-negative safe integer`);
  }
  return value;
}

/** namespace + canonical fields -> 16-hex digest. */
function digest(namespace: string, fields: Record<string, string | number>): string {
  return stableHash64Hex(`${namespace}|${canonicalJson(fields)}`);
}

// ---------- ID kinds ----------

export type CommandId = `cmd_${string}`;
export type CorrelationId = `cor_${string}`;
export type SourceDecisionId = `sdec_${string}`;
export type CanonicalDecisionId = `cdec_${string}`;
export type SourceProposalId = `sprop_${string}`;
export type CanonicalProposalId = `cprop_${string}`;
export type PlanId = `plan_${string}`;
export type LegId = `leg_${string}`;
export type EventId = `evt_${string}`;
export type StateRevisionId = `rev_${string}`;
export type ConfigVersionId = `cfg_${string}`;

/** Operator/system command identity: what, against what, at which revision. */
export interface CommandIdInput {
  /** Command verb, e.g. a ControlCommand like 'START'. */
  command: string;
  /** Target scope, e.g. 'runtime.basis' or 'runtime' for global. */
  scope: string;
  /** Command revision (monotonic per scope, supplied by the issuer). */
  revision: number;
}

export function deriveCommandId(input: CommandIdInput): CommandId {
  return `cmd_${digest('command', {
    command: requireLabel('command', input.command),
    scope: requireLabel('scope', input.scope),
    revision: requireCount('revision', input.revision),
  })}`;
}

/** Correlation identity: origin kind + the origin's own stable key. */
export interface CorrelationIdInput {
  /** e.g. 'command', 'plan', 'reconciliation'. */
  origin: string;
  /** The origin's stable key, e.g. a CommandId or PlanId. */
  key: string;
}

export function deriveCorrelationId(input: CorrelationIdInput): CorrelationId {
  return `cor_${digest('correlation', {
    origin: requireLabel('origin', input.origin),
    key: requireLabel('key', input.key),
  })}`;
}

/** Engine-local decision identity, preserved verbatim from the source engine. */
export interface SourceRecordIdInput {
  /** Source strategy, e.g. 'BASIS' | 'VOLUME'. */
  source: string;
  /**
   * The source engine's own stable key for the record (its id/sequence/
   * symbol+ts composite). Semantic data, never an array index.
   */
  engineKey: string;
}

export function deriveSourceDecisionId(input: SourceRecordIdInput): SourceDecisionId {
  return `sdec_${digest('sourceDecision', {
    source: requireLabel('source', input.source),
    engineKey: requireLabel('engineKey', input.engineKey),
  })}`;
}

export function deriveSourceProposalId(input: SourceRecordIdInput): SourceProposalId {
  return `sprop_${digest('sourceProposal', {
    source: requireLabel('source', input.source),
    engineKey: requireLabel('engineKey', input.engineKey),
  })}`;
}

/** Canonical (read-model) identity: source + source record id + symbol. */
export interface CanonicalRecordIdInput {
  source: string;
  /** The derived source record ID (sdec_ or sprop_ prefixed). */
  sourceRecordId: string;
  symbol: string;
}

export function deriveCanonicalDecisionId(input: CanonicalRecordIdInput): CanonicalDecisionId {
  return `cdec_${digest('canonicalDecision', {
    source: requireLabel('source', input.source),
    sourceRecordId: requireLabel('sourceRecordId', input.sourceRecordId),
    symbol: requireLabel('symbol', input.symbol),
  })}`;
}

export function deriveCanonicalProposalId(input: CanonicalRecordIdInput): CanonicalProposalId {
  return `cprop_${digest('canonicalProposal', {
    source: requireLabel('source', input.source),
    sourceRecordId: requireLabel('sourceRecordId', input.sourceRecordId),
    symbol: requireLabel('symbol', input.symbol),
  })}`;
}

/** Execution plan identity: which canonical proposal, which attempt. */
export interface PlanIdInput {
  canonicalProposalId: string;
  /** 0-based attempt counter for re-planning the same proposal. */
  attempt: number;
}

export function derivePlanId(input: PlanIdInput): PlanId {
  return `plan_${digest('plan', {
    canonicalProposalId: requireLabel('canonicalProposalId', input.canonicalProposalId),
    attempt: requireCount('attempt', input.attempt),
  })}`;
}

/** Leg identity: which plan, which semantic role (never leg index). */
export interface LegIdInput {
  planId: string;
  /** Semantic role, e.g. 'SPOT_ENTRY', 'PERP_HEDGE', 'PERP_CLOSE'. */
  legRole: string;
}

export function deriveLegId(input: LegIdInput): LegId {
  return `leg_${digest('leg', {
    planId: requireLabel('planId', input.planId),
    legRole: requireLabel('legRole', input.legRole),
  })}`;
}

/** Event identity: which stream, which source-assigned sequence/key. */
export interface EventIdInput {
  /** Stream identity, e.g. 'plan:plan_ab12/lifecycle'. */
  streamId: string;
  /** Source-assigned sequence number or stable event key — never a position. */
  sequence: number | string;
}

export function deriveEventId(input: EventIdInput): EventId {
  const sequence =
    typeof input.sequence === 'number'
      ? requireCount('sequence', input.sequence)
      : requireLabel('sequence', input.sequence);
  return `evt_${digest('event', {
    streamId: requireLabel('streamId', input.streamId),
    sequence,
  })}`;
}

/** State revision identity: which state scope, which monotonic revision. */
export interface StateRevisionIdInput {
  /** Owning state scope, e.g. 'controlPlane.runtime'. */
  scope: string;
  revision: number;
}

export function deriveStateRevisionId(input: StateRevisionIdInput): StateRevisionId {
  return `rev_${digest('stateRevision', {
    scope: requireLabel('scope', input.scope),
    revision: requireCount('revision', input.revision),
  })}`;
}

/**
 * Configuration version identity: content-addressed. The payload is
 * canonicalized (key order irrelevant) and hashed, so the same effective
 * configuration always yields the same version ID.
 */
export interface ConfigVersionIdInput {
  /** Config scope, e.g. 'foundation.risk'. */
  scope: string;
  /** Plain-data configuration content. */
  payload: unknown;
}

export function deriveConfigVersionId(input: ConfigVersionIdInput): ConfigVersionId {
  const scope = requireLabel('scope', input.scope);
  const canonical = canonicalJson(input.payload);
  return `cfg_${stableHash64Hex(`configVersion|${scope}|${canonical}`)}`;
}
