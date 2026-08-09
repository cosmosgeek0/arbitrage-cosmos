import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { ApiRequestError } from '../../lib/http';
import type { SystemSupervisorSnapshot } from '../../lib/systemIntegration';
import {
  ProductBindingError,
  type ProductComponentProjection,
  type ProductCorrelationTrace,
  type ProductDependencyEdgeProjection,
  type ProductIntegrationClient,
} from '../../lib/productIntegration';
import type { Attempt, Fact, OwnerFact } from './watchdogEvidence';
import './OwnerEvidence.css';

// OwnerEvidence — depth 3 of the page's three named depths (verdict → row → drill).
//
// This region replaces the ComponentDrawer whose eight <dl> rows dumped ~30
// fields at equal weight. Everything here is cut by decision value: the first
// thing an operator reads is the server's own recommended action, then who is
// blaming this component, then what is downstream of it, then the measurements
// that explain the state, and only on demand the correlation trace.
//
// It draws no card, no border and no fill around any group (Law 4: nothing
// insets content). Every field puts its label on the left and its value on the
// page's shared right edge; a field that cannot prove itself pushes its reason
// onto a second row, so an unproven field is physically taller than a proven
// one and no configuration can suppress that.

// ---------------------------------------------------------------------------
// The dashboard shapes this region reads, taken structurally from the client's
// own declaration so no field name is ever assumed.
// ---------------------------------------------------------------------------

export type SystemRootCause = SystemSupervisorSnapshot['rootCauses'][number];
export type SystemAttentionEntry = SystemSupervisorSnapshot['attentionQueue'][number];

/**
 * The exact OwnerFact surface this region reads. `watchdogEvidence.ts` is the
 * single producer of OwnerFact; this narrows it to the four members the
 * expansion consumes, so a contract gap surfaces as ONE named error here
 * rather than as scattered property errors through the render tree.
 */
export interface OwnerEvidenceFactSurface {
  /** Canonical component id, `browser-session`, `binance-account` or `aws-runner`. */
  readonly id: string;
  /** True when a SYSTEM_COMPONENT_IDS member is absent from snapshot.components. */
  readonly absent: boolean;
  /** The producer's own sentence: the five-branch browser ladder, the private-read
   *  posture, the owner-gated statement, or the reason a component is absent. */
  readonly detail: string;
  /** Null for the three locally-owned owners and for an absent component. */
  readonly component: Readonly<ProductComponentProjection> | null;
}

const ownerEvidenceFactSurface = (fact: OwnerFact): OwnerEvidenceFactSurface => fact;

// ---------------------------------------------------------------------------
// The one duration scale on this surface (§3.3 law 1: one column, one unit).
//
// A GROUP picks one unit from its own largest member and every member of that
// group prints in it, so no value inside a group can read smaller than a
// neighbour that is larger. The unit rides each value — a copied cell is
// self-describing, which is the whole point of pasting evidence into a ticket
// — and is restated once in the group's eyebrow.
// ---------------------------------------------------------------------------

type DurUnit = 'ms' | 's' | 'min' | 'h';
interface DurScale { readonly unit: DurUnit; readonly per: number; readonly digits: number }

const DUR_MS: DurScale = { unit: 'ms', per: 1, digits: 0 };
const DUR_S: DurScale = { unit: 's', per: 1_000, digits: 1 };
const DUR_MIN: DurScale = { unit: 'min', per: 60_000, digits: 1 };
const DUR_H: DurScale = { unit: 'h', per: 3_600_000, digits: 1 };

const DUR_UNIT_WORD: Readonly<Record<DurUnit, string>> = {
  ms: 'milliseconds', s: 'seconds', min: 'minutes', h: 'hours',
};

function durScale(values: readonly (number | null)[]): DurScale {
  let max = 0;
  for (const value of values) if (value !== null && Number.isFinite(value)) max = Math.max(max, Math.abs(value));
  if (max < 10_000) return DUR_MS;
  if (max < 600_000) return DUR_S;
  if (max < 36_000_000) return DUR_MIN;
  return DUR_H;
}

interface DurParts { readonly sign: string; readonly spoken: string; readonly figure: string }

/**
 * §3.3 law 4: below the group's resolution renders `<` and the smallest
 * representable figure — never a zero the data did not have. The sign track is
 * two characters wide so a negative below-resolution value can print `-<`
 * rather than silently dropping its direction.
 */
function durParts(ms: number, scale: DurScale): DurParts {
  const magnitude = Math.abs(ms) / scale.per;
  const figure = magnitude.toFixed(scale.digits);
  const negative = ms < 0;
  if (magnitude > 0 && Number(figure) === 0) {
    const floor = (1 / 10 ** scale.digits).toFixed(scale.digits);
    return {
      sign: negative ? '-<' : '<',
      spoken: negative ? 'minus less than ' : 'less than ',
      figure: floor,
    };
  }
  return { sign: negative ? '-' : '', spoken: negative ? 'minus ' : '', figure };
}

function words(value: string): string {
  return value.replaceAll('-', ' ').replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

const ENV = 'GET /api/product-integration/v1/supervisor';
const TRACE_LIMIT = 200;

// ---------------------------------------------------------------------------
// Glyphs, inline: this region owns no icon dependency, and the dependency wire
// has to carry §3.16's own stroke vocabulary rather than an icon set's.
// ---------------------------------------------------------------------------

function GlyphBinding(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
      <path d="M2.5 8h9M8.5 4.5 12 8l-3.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="square" />
    </svg>
  );
}

function GlyphAdvisory(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
      <path d="M3 4.5h10M3 8h10M3 11.5h6" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="square" />
    </svg>
  );
}

/**
 * §3.16 — the wire reports the CHANNEL, never the component. `required` sets
 * the weight, `UNKNOWN` dashes it, `BLOCKED` severs it. DEGRADED deliberately
 * stays neutral: a slow channel is a proven channel, and the impairment
 * belongs to the component, which has a chip in its own ledger row.
 */
function EdgeWire({ direction }: { readonly direction: 'up' | 'down' }): JSX.Element {
  const head = direction === 'up' ? 'M6 3.5 10 7.5M14 7.5l4-4' : 'M6 11.5 10 7.5M14 7.5l4 4';
  return (
    <svg className="wdoe-wire" viewBox="0 0 24 15" width="24" height="15" aria-hidden="true" focusable="false">
      <path className="wdoe-wire-line" d="M2 7.5h20" />
      <path className="wdoe-wire-head" d={head} />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Absence. Every adverse state carries its reason as real DOM text in reading
// order — never a title attribute, never a bare em dash, never a zero.
// ---------------------------------------------------------------------------

/**
 * §3.12 SLOT — the slot exists and is unwritten. It is 3ch in every field, so
 * this region's blindness reads as a countable regular structure down the
 * right edge instead of noise. It is never the answer: the answer is the
 * sentence beneath it, which is real text at full reason legibility.
 */
function VoidSlot(): JSX.Element {
  return <span className="wdoe-void" aria-hidden="true" />;
}

function Absent({ reason }: { readonly reason: string }): JSX.Element {
  return <p className="wd-t5 wdoe-absent">{reason}</p>;
}

interface FieldProps {
  readonly label: string;
  /** The rendered value. Null renders the void slot plus `reason`, never both a value and a reason. */
  readonly value: JSX.Element | string | null;
  readonly reason?: string | null;
  /** Provenance or consequence. Sits on its own row, so an annotated field is taller. */
  readonly note?: string | null;
  readonly numeric?: boolean;
  /**
   * A real value whose provenance is not clean — here, only the published
   * failure fields the web client's own type does not declare. It recedes by
   * ONE ink step and its note is structurally required (§3.5).
   */
  readonly qualified?: boolean;
  /** `exposed` is the one hue an evidence field may carry (§3.13). */
  readonly exposure?: 'exposed' | null;
}

function Field(props: FieldProps): JSX.Element {
  const known = props.value !== null;
  const proof = known ? (props.qualified ? 'qualified' : 'direct') : 'absent';
  const why = known ? props.note : (props.reason ?? 'No reason was published for this absence.');
  return (
    // A <dt> may be followed by MORE THAN ONE <dd>, so the reason line is a
    // second definition rather than a stray <p> smuggled into a <dl>.
    <div className="wdoe-field" data-proof={proof}>
      <dt className="wd-t3 wdoe-label">{props.label}</dt>
      <dd className="wdoe-cell">
        {known
          ? (
            <span
              className={props.numeric ? 'wd-t4 wd-num wdoe-value' : 'wd-t4 wdoe-value'}
              data-exposure={props.exposure ?? undefined}
            >
              {props.value}
            </span>
          )
          : <VoidSlot />}
      </dd>
      {why === null || why === undefined
        ? null
        : <dd className={known ? 'wd-t6 wdoe-why' : 'wd-t5 wdoe-why'}>{why}</dd>}
    </div>
  );
}

function Duration({ ms, scale }: { readonly ms: number; readonly scale: DurScale }): JSX.Element {
  const parts = durParts(ms, scale);
  return (
    <span className="wdoe-dur">
      <i className="wdoe-dur-sign" aria-hidden="true">{parts.sign}</i>
      {parts.spoken === '' ? null : <span className="sr-only">{parts.spoken}</span>}
      <b className="wdoe-dur-figure">{parts.figure}</b>
      <em className="wdoe-dur-unit">{scale.unit}</em>
    </span>
  );
}

/** A component id, always rendered in full (§3.2: an unregistered kind is never elided). */
function OwnerButton({
  id, onFocusOwner, selfId,
}: {
  readonly id: string;
  readonly onFocusOwner: (id: string) => void;
  readonly selfId: string;
}): JSX.Element {
  if (id === selfId) {
    return (
      <span className="wd-id wdoe-idself">
        {id}
        <i className="wdoe-selfmark"> · this row</i>
      </span>
    );
  }
  return (
    <button
      type="button"
      className="wdoe-idbtn"
      onClick={() => onFocusOwner(id)}
      aria-label={`Open ${words(id)} in the owner ledger`}
    >
      <span className="wd-id">{id}</span>
    </button>
  );
}

function OwnerButtonList({
  ids, onFocusOwner, selfId, separator,
}: {
  readonly ids: readonly string[];
  readonly onFocusOwner: (id: string) => void;
  readonly selfId: string;
  readonly separator?: string;
}): JSX.Element {
  return (
    <span className="wdoe-idlist" data-sep={separator ? 'true' : undefined}>
      {ids.map((id, index) => (
        <span className="wdoe-idlist-item" key={`${id}-${index}`}>
          {index > 0 && separator ? <i className="wdoe-idlist-sep" aria-hidden="true">{separator}</i> : null}
          <OwnerButton id={id} onFocusOwner={onFocusOwner} selfId={selfId} />
        </span>
      ))}
    </span>
  );
}

function Group({
  label, unitWord, children,
}: {
  readonly label: string;
  readonly unitWord?: string;
  readonly children: ReactNode;
}): JSX.Element {
  const headId = useId();
  return (
    <div className="wdoe-group" role="group" aria-labelledby={headId}>
      <p className="wd-t3 wdoe-eyebrow" id={headId}>
        {label}
        {unitWord ? <i className="wdoe-eyebrow-unit"> · {unitWord}</i> : null}
      </p>
      <dl className="wdoe-fields">{children}</dl>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The structured failure. The web client declares three of the nine fields the
// server publishes on it (server/src/foundation/contracts/failures.ts). The
// other six are read through a guarded structural check and render as
// qualified values, or UNKNOWN with a stated reason when the wire did not
// carry them. Nothing is assumed into existence either way.
// ---------------------------------------------------------------------------

function failureText(failure: unknown, key: string): string | null {
  if (failure === null || typeof failure !== 'object') return null;
  const value = (failure as Record<string, unknown>)[key];
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function failureBool(failure: unknown, key: string): boolean | null {
  if (failure === null || typeof failure !== 'object') return null;
  const value = (failure as Record<string, unknown>)[key];
  return typeof value === 'boolean' ? value : null;
}

const UNDECLARED = 'Published on the wire but not declared by the web client contract';

// ---------------------------------------------------------------------------
// The correlation trace lane. GET /api/product-integration/v1/traces/:id — the
// endpoint no web surface has ever called, though every component, incident
// and surface projection has carried a correlationId for it. On demand only,
// aborted on collapse and on id change, and every attempt is recorded after a
// response or a caught error exists, never before.
// ---------------------------------------------------------------------------

type TracePhase = 'IDLE' | 'READING' | 'READ' | 'FAILED';

interface TraceLane {
  readonly phase: TracePhase;
  readonly correlationId: string | null;
  readonly trace: Readonly<ProductCorrelationTrace> | null;
  readonly failureCode: string | null;
  readonly failureMessage: string | null;
}

const IDLE_TRACE: TraceLane = { phase: 'IDLE', correlationId: null, trace: null, failureCode: null, failureMessage: null };

/**
 * "The evidence is not there" and "we ran out of retention before we could
 * look" are different findings, so they get different sentences and different
 * treatments — and neither takes a hue, because both are unknowns (§1.6 r4).
 */
const EVIDENCE_SENTENCE: Readonly<Record<'PRESENT' | 'ABSENT' | 'UNKNOWN_DUE_TO_TRUNCATION', string>> = {
  PRESENT: 'Correlation event present.',
  ABSENT: 'No event was published for this stage.',
  UNKNOWN_DUE_TO_TRUNCATION: 'Retention ended before this stage could be read. Presence is unknown, not absent.',
};

export function OwnerEvidence(props: {
  readonly fact: OwnerFact;
  readonly edges: readonly ProductDependencyEdgeProjection[];
  readonly rootCause: Fact<SystemRootCause>;
  readonly attention: Fact<SystemAttentionEntry>;
  readonly nowMs: number;
  readonly client: Readonly<ProductIntegrationClient>;
  readonly openTraceCorrelationId: string | null;
  readonly onOpenTrace: (correlationId: string | null) => void;
  readonly onFocusOwner: (id: string) => void;
  readonly onRecordAttempt: (a: Omit<Attempt, 'id'>) => void;
}): JSX.Element {
  const {
    edges, rootCause, attention, nowMs, client,
    openTraceCorrelationId, onOpenTrace, onFocusOwner, onRecordAttempt,
  } = props;

  const fact = ownerEvidenceFactSurface(props.fact);
  const component = fact.component;
  const selfId = fact.id;
  const correlationId = component?.correlationId ?? null;
  const traceOpen = correlationId !== null && openTraceCorrelationId === correlationId;

  const [lane, setLane] = useState<TraceLane>(IDLE_TRACE);
  const abortRef = useRef<AbortController | null>(null);
  const requestedRef = useRef<string | null>(null);
  const baseId = useId();
  const traceRegionId = `${baseId}trace`;
  const traceHeadId = `${baseId}tracehead`;
  const egoHeadId = `${baseId}egohead`;
  const localHeadId = `${baseId}localhead`;

  // WRITE LANE (a declared exception): this component owns readTrace, so it is
  // one of the three places under pages/watchdog that may read a wall clock —
  // and only to stamp an Attempt with when the request actually resolved.
  const readTrace = useCallback(async (id: string) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLane({ phase: 'READING', correlationId: id, trace: null, failureCode: null, failureMessage: null });
    const path = `/api/product-integration/v1/traces/${encodeURIComponent(id)}?limit=${TRACE_LIMIT}`;
    const startedAt = performance.now();
    try {
      const trace = await client.readTrace(id, TRACE_LIMIT, controller.signal);
      if (controller.signal.aborted) return;
      setLane({ phase: 'READ', correlationId: id, trace, failureCode: null, failureMessage: null });
      onRecordAttempt({
        atMs: Date.now(),
        kind: 'TRACE',
        method: 'GET',
        path,
        status: '200',
        elapsedMs: Math.round(performance.now() - startedAt),
        detail: `${trace.stages.length} stages · ${trace.completeness}`,
      });
    } catch (error) {
      if (controller.signal.aborted) return;
      const code = error instanceof ApiRequestError
        ? error.code
        : error instanceof ProductBindingError
          ? (error.codes[0] ?? 'TRACE_RESPONSE_INVALID')
          : 'TRACE_READ_FAILED';
      const message = error instanceof Error && error.message
        ? error.message
        : 'The trace read failed and carried no message.';
      setLane({ phase: 'FAILED', correlationId: id, trace: null, failureCode: code, failureMessage: message });
      onRecordAttempt({
        atMs: Date.now(),
        kind: 'TRACE',
        method: 'GET',
        path,
        status: error instanceof ApiRequestError ? String(error.status) : code,
        elapsedMs: Math.round(performance.now() - startedAt),
        detail: message,
      });
    }
  }, [client, onRecordAttempt]);

  // Never auto-fetched: the shell only sets openTraceCorrelationId in response
  // to this region's own button. Aborts on collapse (unmount) and on id change.
  useEffect(() => {
    if (!traceOpen || correlationId === null) {
      abortRef.current?.abort();
      abortRef.current = null;
      requestedRef.current = null;
      setLane(IDLE_TRACE);
      return;
    }
    if (requestedRef.current === correlationId) return;
    requestedRef.current = correlationId;
    void readTrace(correlationId);
  }, [traceOpen, correlationId, readTrace]);

  useEffect(() => () => { abortRef.current?.abort(); }, []);

  // -- guidance ------------------------------------------------------------
  // Verbatim, and first. The server's own recommended action is the only
  // sentence on this page that tells an operator what to do, and the drawer
  // this region replaces never rendered it at all. The supervisor copies the
  // root's action onto every attention entry beneath it, so an undeduplicated
  // render would print the same sentence twice and call it density.
  const rootAction = rootCause.value?.failure?.recommendedOperatorAction ?? null;
  const attentionAction = attention.value?.recommendedOperatorAction ?? null;
  const failureMessage = rootCause.value?.failure?.message ?? null;
  const failureCode = rootCause.value?.failure?.code ?? null;
  const sameAction = rootAction !== null && attentionAction !== null && rootAction === attentionAction;

  const guidance: Array<{ key: string; register: 'binding' | 'advisory'; say: string; prov: string }> = [];
  if (rootAction !== null) {
    guidance.push({
      key: 'root',
      register: 'binding',
      say: rootAction,
      prov: sameAction ? 'rootCause+queue' : 'rootCause',
    });
  }
  if (attentionAction !== null && !sameAction) {
    guidance.push({ key: 'attention', register: 'binding', say: attentionAction, prov: 'queue' });
  }
  // §3.11 caps a host surface at three rows. Two actions plus one explanation
  // is the whole budget, and the explanation only lands if a slot is free.
  if (failureMessage !== null && guidance.length < 3) {
    guidance.push({ key: 'failure', register: 'advisory', say: failureMessage, prov: failureCode ?? 'failure' });
  }

  // -- dependency ego view -------------------------------------------------
  const upstream = component === null ? [] : edges.filter((edge) => edge.toComponentId === selfId);
  const downstream = component === null ? [] : edges.filter((edge) => edge.fromComponentId === selfId);
  const declaredUpstream = component?.dependencyIds ?? [];
  const publishedUpstream = new Set(upstream.map((edge) => edge.fromComponentId));
  // A declared dependency with no published edge is a hole in the topology.
  // It is a finding, so it is a row — never silently dropped into agreement.
  const unpublishedUpstream = declaredUpstream.filter((id) => !publishedUpstream.has(id));

  // -- measured scales -----------------------------------------------------
  const heartbeatAge = component?.heartbeatAtMs != null ? nowMs - component.heartbeatAtMs : null;
  const advanceAge = component?.lastAdvanceAtMs != null ? nowMs - component.lastAdvanceAtMs : null;
  const freshnessScale = durScale([
    heartbeatAge, advanceAge,
    component?.sourceAgeMs ?? null, component?.eventAgeMs ?? null,
    component?.processingAgeMs ?? null, component?.processingLagMs ?? null,
  ]);
  const retryIn = component?.retryAtMs != null ? component.retryAtMs - nowMs : null;
  const cooldownIn = component?.cooldownUntilMs != null ? component.cooldownUntilMs - nowMs : null;
  const retryScale = durScale([component?.backoffMs ?? null, retryIn, cooldownIn]);
  const checkpointAge = component?.checkpointPersistedAtMs != null ? nowMs - component.checkpointPersistedAtMs : null;
  const qualityAge = component?.dataQualityObservedAtMs != null ? nowMs - component.dataQualityObservedAtMs : null;
  const projectionScale = durScale([checkpointAge, qualityAge]);

  const stageAges = lane.trace === null
    ? []
    : lane.trace.stages.map((stage) => (stage.occurredAtMs === null ? null : nowMs - stage.occurredAtMs));
  const stageScale = durScale(stageAges);

  // -- blame ---------------------------------------------------------------
  const severity = rootCause.value?.severity ?? attention.value?.severity ?? null;
  const severitySource = rootCause.value ? 'From the published root cause' : attention.value ? 'From the attention queue' : null;
  const reasonCodes = rootCause.value?.reasonCodes ?? attention.value?.reasonCodes ?? [];
  const capitalExposed = rootCause.value?.capitalExposed ?? attention.value?.capitalExposed ?? null;
  const rawFailure: unknown = rootCause.value?.failure ?? null;
  const safeCurrentState = failureText(rawFailure, 'safeCurrentState');
  const retryable = failureBool(rawFailure, 'retryable');
  const failureCorrelationId = failureText(rawFailure, 'correlationId');

  const notBlamed = 'This component is neither a published root cause nor in the attention queue.';
  const blameUnreadable = rootCause.known || attention.known
    ? null
    : `${rootCause.reason ?? 'The root-cause read is unavailable.'} ${attention.reason ?? 'The attention-queue read is unavailable.'}`;
  const blameAbsent = blameUnreadable ?? notBlamed;
  const rootAbsent = rootCause.known
    ? 'This component is not a published root cause.'
    : rootCause.reason ?? 'The root-cause read is unavailable.';
  const failureAbsent = rawFailure === null
    ? 'No structured failure is attached to this component.'
    : null;

  return (
    <div className="wdoe" data-mode={fact.absent ? 'absent' : component === null ? 'local' : 'canonical'}>

      {/* 1 · GUIDANCE — what the server itself told you to do, verbatim, first. */}
      {guidance.length > 0
        ? (
          <ol className="wdoe-guide">
            {guidance.map((row) => (
              <li className="wdoe-guide-row" data-register={row.register} key={row.key}>
                <span className="wdoe-guide-glyph">
                  {row.register === 'binding' ? <GlyphBinding /> : <GlyphAdvisory />}
                </span>
                <span className="wdoe-guide-body">
                  <span className="wd-t5 wdoe-say">{row.say}</span>
                </span>
                <span className="wdoe-guide-prov">{row.prov}</span>
              </li>
            ))}
          </ol>
        )
        : (
          <p className="wd-t5 wdoe-say wdoe-guide-none">
            No operator action is published for this owner.
            <span className="wd-t6 wdoe-note-inline">
              {rootCause.known ? 'It is not a published root cause.' : rootCause.reason ?? 'Root-cause read unavailable.'}
              {' '}
              {attention.known ? 'It is not in the attention queue.' : attention.reason ?? 'Attention-queue read unavailable.'}
            </span>
          </p>
        )}

      {/* The three locally-owned owners, and any canonical component the
          supervisor did not report, carry their producer's own sentence.
          There is no projection to render, and none is implied. */}
      {component === null ? (
        <div className="wdoe-local" role="group" aria-labelledby={localHeadId}>
          <p className="wd-t3 wdoe-eyebrow" id={localHeadId}>{fact.absent ? 'Unmet measurement contract' : 'Lane evidence'}</p>
          <p className="wd-t5 wdoe-say wdoe-local-say">{fact.detail}</p>
          <dl className="wdoe-fields">
            <Field
              label="Owner id"
              value={<span className="wd-id">{selfId}</span>}
              note={fact.absent
                ? `Expected in the canonical component set · absent from ${ENV} · components[]`
                : 'Observed by this browser, not projected by the supervisor'}
            />
            <Field
              label="Canonical projection"
              value={null}
              reason={fact.absent
                ? 'COMPONENT_ABSENT — the supervisor published no record for this canonical component, so no lifecycle, freshness, backpressure, retry or readiness measurement exists to read. Its state here is not degraded; it is unmeasured.'
                : 'This owner is observed by the browser, not projected by the supervisor, so it has no lifecycle, queue, retry or readiness record by construction.'}
            />
            <Field
              label="Dependencies"
              value={null}
              reason="NO PUBLISHED EDGE — the supervisor declares dependency edges only between canonical components, so this owner has neither a published upstream nor a published downstream."
            />
            <Field
              label="Operator action"
              value={null}
              reason={fact.absent
                ? 'NONE — the supervisor must publish the component before any measurement can be taken. No control on this page can cause it to appear, so none is offered.'
                : 'NONE — this row is evidence about the browser or an owner-gated boundary. What recovery exists lives in the recovery console, not here.'}
            />
          </dl>
        </div>
      ) : (
        <>
          {/* 2 · BLAME — why it is in this state, and who is legitimately blamed. */}
          <Group label="Blame">
            <Field
              label="Blocker"
              value={component.blockerCode === null ? null : <code className="wd-id">{component.blockerCode}</code>}
              reason="No blocker code is published for this component."
            />
            <Field
              label="Root cause"
              value={component.rootCauseComponentId === null
                ? null
                : <OwnerButton id={component.rootCauseComponentId} onFocusOwner={onFocusOwner} selfId={selfId} />}
              reason="No root cause is attributed to this component."
              note={component.rootCauseComponentId === selfId ? 'This component is the origin, not a casualty' : null}
            />
            <Field
              label="Severity"
              value={severity}
              reason={blameAbsent}
              note={severitySource}
            />
            <Field
              label="Reason codes"
              value={reasonCodes.length > 0
                ? <span className="wdoe-codes">{reasonCodes.map((code) => <code className="wd-id wdoe-code" key={code}>{code}</code>)}</span>
                : null}
              reason={blameAbsent}
            />
            <Field
              label="Capital exposed"
              value={capitalExposed === null ? null : capitalExposed ? 'EXPOSED' : 'NONE'}
              exposure={capitalExposed === true ? 'exposed' : null}
              reason={blameAbsent}
            />
            {component.capitalRelevance !== 'NONE' ? (
              <Field
                label="Capital relevance"
                value={component.capitalRelevance}
                exposure={component.capitalRelevance === 'EXPOSED' ? 'exposed' : null}
              />
            ) : null}
            <Field
              label="Failure code"
              value={failureCode === null ? null : <code className="wd-id">{failureCode}</code>}
              reason={failureAbsent ?? rootAbsent}
            />
            <Field
              label="Safe current state"
              value={safeCurrentState}
              qualified
              note={safeCurrentState === null ? null : `The state the machine is safely in after the failure · ${UNDECLARED}`}
              reason={failureAbsent ?? 'The attached failure did not carry safeCurrentState.'}
            />
            <Field
              label="Retryable"
              value={retryable === null ? null : retryable ? 'YES' : 'NO'}
              qualified
              note={retryable === null
                ? null
                : retryable
                  ? `Repeating the same action can plausibly succeed · ${UNDECLARED}`
                  : `Repeating the same action cannot succeed · ${UNDECLARED}`}
              reason={failureAbsent ?? 'The attached failure did not carry retryable.'}
            />
            <Field
              label="Blame path"
              value={rootCause.value === null || rootCause.value.dependencyPath.length === 0
                ? null
                : <OwnerButtonList ids={rootCause.value.dependencyPath} onFocusOwner={onFocusOwner} selfId={selfId} separator="→" />}
              reason={rootCause.value === null ? rootAbsent : 'The published blame path for this root is empty.'}
              note={rootCause.value === null ? null : 'The resolved upstream chain that ends at this root'}
            />
            <Field
              label="Affected downstream"
              value={rootCause.value === null || rootCause.value.affectedComponentIds.length === 0
                ? null
                : <OwnerButtonList ids={rootCause.value.affectedComponentIds} onFocusOwner={onFocusOwner} selfId={selfId} />}
              reason={rootCause.value === null
                ? rootAbsent
                : 'No downstream component is attributed to this root — the blast radius is this component alone.'}
              note={rootCause.value === null ? null : 'What you lose while this stays broken'}
            />
          </Group>

          {/* 3 · DEPENDENCY EGO VIEW — direction is the decision. */}
          <div className="wdoe-ego" role="group" aria-labelledby={egoHeadId}>
            <p className="wd-t3 wdoe-eyebrow" id={egoHeadId}>
              Dependencies
              <i className="wdoe-eyebrow-unit"> · the wire states the channel; each neighbour&rsquo;s own posture is in its own ledger row</i>
            </p>
            <div className="wdoe-ego-cols">
              <div className="wdoe-ego-col" data-dir="up">
                <p className="wd-t3 wdoe-ego-head">Upstream · this depends on</p>
                {upstream.length === 0 && unpublishedUpstream.length === 0
                  ? <Absent reason="NO REQUIRED UPSTREAM — the supervisor published no incoming dependency edge, and the component declares none." />
                  : (
                    <ol className="wdoe-ego-list">
                      {upstream.map((edge) => (
                        <li
                          className="wdoe-ego-item"
                          key={`up-${edge.fromComponentId}`}
                          data-contract={edge.required ? 'required' : 'optional'}
                          data-proof={edge.state === 'BLOCKED' ? 'severed' : edge.state === 'UNKNOWN' ? 'unproven' : 'proven'}
                        >
                          <EdgeWire direction="up" />
                          <span className="wdoe-ego-body">
                            <OwnerButton id={edge.fromComponentId} onFocusOwner={onFocusOwner} selfId={selfId} />
                            <span className="wd-t6 wdoe-ego-channel">
                              {edge.required ? 'required' : 'optional'} · {edge.state}
                            </span>
                            {edge.rootCauseComponentId !== null && edge.rootCauseComponentId !== edge.fromComponentId ? (
                              <span className="wd-t6 wdoe-ego-channel">
                                blamed on <OwnerButton id={edge.rootCauseComponentId} onFocusOwner={onFocusOwner} selfId={selfId} />
                              </span>
                            ) : null}
                            {edge.reasonCodes.length > 0
                              ? <span className="wd-t5 wdoe-ego-why">{edge.reasonCodes.join(' · ')}</span>
                              : null}
                          </span>
                        </li>
                      ))}
                      {unpublishedUpstream.map((id) => (
                        <li className="wdoe-ego-item" key={`decl-${id}`} data-contract="required" data-proof="unproven">
                          <EdgeWire direction="up" />
                          <span className="wdoe-ego-body">
                            <OwnerButton id={id} onFocusOwner={onFocusOwner} selfId={selfId} />
                            <span className="wd-t5 wdoe-ego-why">
                              Declared in this component&rsquo;s dependencyIds, but the supervisor published no edge for it.
                              The channel is not measured — treat it as unproven, not as working.
                            </span>
                          </span>
                        </li>
                      ))}
                    </ol>
                  )}
              </div>

              <div className="wdoe-ego-col" data-dir="self">
                <p className="wd-t3 wdoe-ego-head">This owner</p>
                <p className="wd-t4 wdoe-ego-self"><span className="wd-id">{selfId}</span></p>
                <p className="wd-t6 wdoe-ego-selfnote">
                  {upstream.length} published upstream · {downstream.length} published downstream
                  {unpublishedUpstream.length > 0 ? ` · ${unpublishedUpstream.length} declared with no edge` : ''}
                </p>
              </div>

              <div className="wdoe-ego-col" data-dir="down">
                <p className="wd-t3 wdoe-ego-head">Downstream · depends on this</p>
                {downstream.length === 0
                  ? <Absent reason="NO DECLARED DOWNSTREAM — no published component declares a dependency on this one, so nothing here is waiting on it." />
                  : (
                    <ol className="wdoe-ego-list">
                      {downstream.map((edge) => (
                        <li
                          className="wdoe-ego-item"
                          key={`down-${edge.toComponentId}`}
                          data-contract={edge.required ? 'required' : 'optional'}
                          data-proof={edge.state === 'BLOCKED' ? 'severed' : edge.state === 'UNKNOWN' ? 'unproven' : 'proven'}
                        >
                          <EdgeWire direction="down" />
                          <span className="wdoe-ego-body">
                            <OwnerButton id={edge.toComponentId} onFocusOwner={onFocusOwner} selfId={selfId} />
                            <span className="wd-t6 wdoe-ego-channel">
                              {edge.required ? 'required' : 'optional'} · {edge.state}
                            </span>
                            {edge.reasonCodes.length > 0
                              ? <span className="wd-t5 wdoe-ego-why">{edge.reasonCodes.join(' · ')}</span>
                              : null}
                          </span>
                        </li>
                      ))}
                    </ol>
                  )}
              </div>
            </div>
          </div>

          {/* 4 · THE MEASUREMENTS. Open, because each changes what you do next. */}
          <Group label="Lifecycle">
            <Field
              label="Desired → observed"
              value={<>{component.desiredLifecycle} <i className="wdoe-arrow" aria-hidden="true">→</i> {component.observedLifecycle}</>}
              note={component.desiredLifecycle === component.observedLifecycle
                ? 'Observed matches desired'
                : 'Observed has not reached desired'}
            />
            <Field label="Capability" value={component.capability} />
            <Field label="Restart state" value={component.restartState} />
            <Field label="Generation" value={String(component.generation)} numeric note="Increments on every supervised restart" />
            <Field label="Restart count" value={String(component.restartCount)} numeric />
          </Group>

          <Group label="Freshness" unitWord={DUR_UNIT_WORD[freshnessScale.unit]}>
            <Field label="Freshness state" value={component.freshnessState} />
            <Field
              label="Heartbeat age"
              value={heartbeatAge === null ? null : <Duration ms={heartbeatAge} scale={freshnessScale} />}
              reason="No heartbeat timestamp is published, so this component has never proven it is alive."
              numeric
            />
            <Field
              label="Advance age"
              value={advanceAge === null ? null : <Duration ms={advanceAge} scale={freshnessScale} />}
              reason="No meaningful-advance timestamp is published. A heartbeat on its own is not proof of work."
              numeric
              note={advanceAge !== null && heartbeatAge !== null && advanceAge > heartbeatAge
                ? 'Older than the heartbeat — it is alive but it is not advancing'
                : null}
            />
            <Field
              label="Source age"
              value={component.sourceAgeMs === null ? null : <Duration ms={component.sourceAgeMs} scale={freshnessScale} />}
              reason="Source age is not published for this component."
              numeric
            />
            <Field
              label="Event age"
              value={component.eventAgeMs === null ? null : <Duration ms={component.eventAgeMs} scale={freshnessScale} />}
              reason="Event age is not published for this component."
              numeric
            />
            <Field
              label="Processing age"
              value={component.processingAgeMs === null ? null : <Duration ms={component.processingAgeMs} scale={freshnessScale} />}
              reason="Processing age is not published for this component."
              numeric
            />
            <Field
              label="Processing lag"
              value={component.processingLagMs === null ? null : <Duration ms={component.processingLagMs} scale={freshnessScale} />}
              reason="Processing lag is not published for this component."
              numeric
            />
          </Group>

          <Group label="Backpressure">
            <Field
              label="Queue depth"
              value={component.queueDepth === null
                ? null
                : (
                  <>
                    {component.queueDepth}
                    <i className="wdoe-of" aria-hidden="true"> / </i>
                    <span className="sr-only">of</span>
                    {component.queueCapacity === null
                      ? <b className="wdoe-inline-nodata">capacity unpublished</b>
                      : component.queueCapacity}
                  </>
                )}
              reason="No queue is published for this component."
              numeric
              note={component.queueCapacity === null && component.queueDepth !== null
                ? 'A depth with no capacity cannot say how close this is to dropping'
                : null}
            />
            <Field
              label="Dropped"
              value={component.droppedCount === null ? null : String(component.droppedCount)}
              reason="Drop count is not published for this component."
              numeric
              note={component.droppedCount !== null && component.droppedCount > 0
                ? 'Proven loss — these events are gone and will not be replayed'
                : null}
            />
          </Group>

          <Group label="Retry" unitWord={DUR_UNIT_WORD[retryScale.unit]}>
            <Field label="Retry state" value={component.retryState} />
            <Field
              label="Attempt"
              value={component.retryAttempt === null
                ? null
                : (
                  <>
                    {component.retryAttempt}
                    <i className="wdoe-of" aria-hidden="true"> / </i>
                    <span className="sr-only">of</span>
                    {component.retryCeiling === null
                      ? <b className="wdoe-inline-nodata">no ceiling published</b>
                      : component.retryCeiling}
                  </>
                )}
              reason="No retry attempt count is published for this component."
              numeric
            />
            <Field
              label="Backoff"
              value={component.backoffMs === null ? null : <Duration ms={component.backoffMs} scale={retryScale} />}
              reason="No backoff interval is published for this component."
              numeric
            />
            <Field
              label="Retry at"
              value={retryIn === null ? null : <Duration ms={retryIn} scale={retryScale} />}
              reason="No next-retry time is published for this component."
              numeric
              note={retryIn === null ? null : retryIn >= 0 ? 'From now' : 'The retry time has already passed'}
            />
            <Field
              label="Cooldown until"
              value={cooldownIn === null ? null : <Duration ms={cooldownIn} scale={retryScale} />}
              reason="No cooldown is published for this component."
              numeric
              note={cooldownIn === null ? null : cooldownIn >= 0 ? 'From now' : 'The cooldown has expired'}
            />
          </Group>

          <Group label="Service readiness">
            <Field label="Basis" value={component.serviceReadiness.basis} />
            <Field
              label="Expected → observed"
              value={(
                <>
                  {component.serviceReadiness.expected ? 'EXPECTED' : 'NOT EXPECTED'}
                  {' '}<i className="wdoe-arrow" aria-hidden="true">→</i>{' '}
                  {component.serviceReadiness.observed ? 'OBSERVED' : 'NOT OBSERVED'}
                </>
              )}
              note={component.serviceReadiness.expected && !component.serviceReadiness.observed
                ? 'Expected but not observed — this is what a readiness blocker is made of'
                : null}
            />
            <Field
              label="Counts toward readiness"
              value={component.serviceReadiness.excludedFromServiceReadiness
                ? 'EXCLUDED'
                : component.serviceReadiness.requiredForServiceReadiness ? 'REQUIRED' : 'NOT REQUIRED'}
              note={component.serviceReadiness.excludedFromServiceReadiness
                ? 'Explicitly excluded, so its state cannot block service readiness'
                : null}
            />
            {component.serviceReadiness.waiver !== null ? (
              <Field
                label="Waiver"
                value={<code className="wd-id">{component.serviceReadiness.waiver.id}</code>}
                note={`${component.serviceReadiness.waiver.status} · ${component.serviceReadiness.waiver.mode} · scope ${component.serviceReadiness.waiver.scope} · owner ${component.serviceReadiness.waiver.owner} · expires ${component.serviceReadiness.waiver.expiresAt} · ${component.serviceReadiness.waiver.reason}`}
              />
            ) : (
              <Field
                label="Waiver"
                value={null}
                reason="No readiness waiver is attached, so this component is held to the unwaived contract."
              />
            )}
          </Group>

          {/* 5 · FULL PROJECTION — everything that does not change the next action. */}
          <details className="wdoe-more">
            <summary className="wd-t3 wdoe-more-head">
              Full projection
              <i className="wdoe-eyebrow-unit"> · data quality, checkpoint, ownership</i>
            </summary>
            <div className="wdoe-more-body">
              <Group label="Data quality" unitWord={DUR_UNIT_WORD[projectionScale.unit]}>
                <Field label="State" value={component.dataQualityState} />
                <Field label="Invalid" value={component.dataQualityInvalidCount === null ? null : String(component.dataQualityInvalidCount)} reason="Invalid-record count is not published." numeric />
                <Field label="Duplicate" value={component.dataQualityDuplicateCount === null ? null : String(component.dataQualityDuplicateCount)} reason="Duplicate count is not published." numeric />
                <Field label="Out of order" value={component.dataQualityOutOfOrderCount === null ? null : String(component.dataQualityOutOfOrderCount)} reason="Out-of-order count is not published." numeric />
                <Field label="Sequence gaps" value={component.dataQualitySequenceGapCount === null ? null : String(component.dataQualitySequenceGapCount)} reason="Sequence-gap count is not published." numeric />
                <Field
                  label="Counters observed"
                  value={qualityAge === null ? null : <Duration ms={qualityAge} scale={projectionScale} />}
                  reason="No observation time is published for these counters, so their age is unknown."
                  numeric
                  note={qualityAge === null ? null : 'Ago'}
                />
              </Group>
              <Group label="Checkpoint" unitWord={DUR_UNIT_WORD[projectionScale.unit]}>
                <Field label="State" value={component.checkpointState} />
                <Field
                  label="Revision"
                  value={component.checkpointRevision === null ? null : <code className="wd-id">{component.checkpointRevision}</code>}
                  reason="No checkpoint revision is published."
                />
                <Field
                  label="Persisted"
                  value={checkpointAge === null ? null : <Duration ms={checkpointAge} scale={projectionScale} />}
                  reason="No checkpoint has ever been persisted for this component."
                  numeric
                  note={checkpointAge === null ? null : 'Ago'}
                />
              </Group>
              <Group label="Ownership">
                <Field label="Owner" value={<code className="wd-id">{component.owner}</code>} note="CODEOWNERS-shaped source location" />
                <Field label="Truth label" value={component.truthLabel} note="Evidence class — not a health verdict" />
                <Field
                  label="Supported controls"
                  value={component.supportedControlIds.length > 0
                    ? <span className="wdoe-codes">{component.supportedControlIds.map((id) => <code className="wd-id wdoe-code" key={id}>{id}</code>)}</span>
                    : null}
                  reason="This component publishes no supported control id, so nothing on this page can mutate it."
                  note={component.supportedControlIds.length > 0 ? 'Armed or refused in the control ledger, not here' : null}
                />
                <Field
                  label="Correlation id"
                  value={correlationId === null ? null : <code className="wd-id">{correlationId}</code>}
                  reason="No correlation id is published, so no trace can be requested for this component."
                />
                {failureCorrelationId !== null && failureCorrelationId !== correlationId ? (
                  <Field
                    label="Failure correlation id"
                    value={<code className="wd-id">{failureCorrelationId}</code>}
                    qualified
                    note={`Differs from the component's own correlation id · ${UNDECLARED}`}
                  />
                ) : null}
              </Group>
            </div>
          </details>

          {/* 6 · THE TRACE. Depth stops here: a fourth level would be a link out. */}
          <div className="wdoe-trace-region" role="group" aria-labelledby={traceHeadId}>
            <p className="wd-t3 wdoe-eyebrow" id={traceHeadId}>
              Correlation trace
              <i className="wdoe-eyebrow-unit"> · GET /api/product-integration/v1/traces</i>
            </p>
            {correlationId === null
              ? (
                <Absent reason="No correlation id is published for this component, so there is nothing to trace. The control that would read it is absent rather than disabled — an unbindable button is not an affordance." />
              )
              : (
                <>
                  <button
                    type="button"
                    className="wdb wdoe-trace-btn"
                    aria-expanded={traceOpen}
                    aria-controls={traceRegionId}
                    aria-busy={lane.phase === 'READING'}
                    data-phase={lane.phase}
                    onClick={() => onOpenTrace(traceOpen ? null : correlationId)}
                  >
                    <span className="wdb-spin" aria-hidden="true" />
                    {traceOpen
                      ? lane.phase === 'READING'
                        ? 'Reading trace…'
                        : lane.phase === 'READ' && lane.trace !== null
                          ? `Hide trace · ${lane.trace.stages.length} stages · ${lane.trace.completeness}`
                          : lane.phase === 'FAILED'
                            ? `Hide trace · ${lane.failureCode}`
                            : 'Hide trace'
                      : 'Load trace'}
                  </button>

                  <div id={traceRegionId} className="wdoe-trace" hidden={!traceOpen}>
                    {lane.phase === 'READING' ? (
                      <p className="wd-t5 wdoe-say">
                        Requesting up to {TRACE_LIMIT} correlation events for <code className="wd-id">{correlationId}</code>.
                      </p>
                    ) : null}

                    {lane.phase === 'FAILED' ? (
                      <div className="wdoe-trace-failed">
                        <p className="wd-t4 wdoe-trace-failed-code">{lane.failureCode}</p>
                        <p className="wd-t5 wdoe-say">{lane.failureMessage}</p>
                        <p className="wd-t6 wdoe-meta">
                          GET /api/product-integration/v1/traces/{correlationId}?limit={TRACE_LIMIT}
                          {' · '}nothing was read, so nothing above this changed.
                        </p>
                      </div>
                    ) : null}

                    {lane.phase === 'READ' && lane.trace !== null ? (
                      <>
                        {lane.trace.completeness === 'TRUNCATED' ? (
                          <div className="wdoe-trunc">
                            <p className="wd-t4 wdoe-trunc-head">TRUNCATED</p>
                            <p className="wd-t5 wdoe-say">
                              Retention ended inside this correlation. Stages marked unknown below were not read,
                              and their silence is not evidence that nothing happened. This is retention loss,
                              not pagination — there is no next page to request.
                            </p>
                          </div>
                        ) : null}
                        <p className="wd-t6 wdoe-meta">
                          {lane.trace.completeness} · {lane.trace.stages.length} canonical stages
                          {lane.trace.symbol === null ? ' · no symbol on this correlation' : ` · symbol ${lane.trace.symbol}`}
                          {' · '}ages in {DUR_UNIT_WORD[stageScale.unit]}
                        </p>
                        <ol className="wdoe-stages">
                          {lane.trace.stages.map((stage, index) => {
                            const stageAge = stageAges[index] ?? null;
                            return (
                              <li className="wdoe-stage" data-evidence={stage.evidenceState} key={`${stage.stage}-${index}`}>
                                <span className="wdoe-stage-n wd-t6 wd-num">{index + 1}</span>
                                <span className="wdoe-stage-body">
                                  <span className="wd-t4 wdoe-stage-name">{stage.stage}</span>
                                  <span className="wd-t6 wdoe-stage-owner">{stage.owner}</span>
                                  <span className="wd-t5 wdoe-stage-why">{EVIDENCE_SENTENCE[stage.evidenceState]}</span>
                                  <span className="wd-t6 wdoe-stage-out">
                                    {stage.outcome} · {stage.truthLabel}
                                    {stage.referenceId !== null ? <> · <code className="wd-id">{stage.referenceId}</code></> : null}
                                  </span>
                                </span>
                                <span className="wdoe-stage-age wd-t6 wd-num">
                                  {stageAge === null
                                    ? <VoidSlot />
                                    : <Duration ms={stageAge} scale={stageScale} />}
                                </span>
                              </li>
                            );
                          })}
                        </ol>
                      </>
                    ) : null}
                  </div>
                </>
              )}
          </div>
        </>
      )}
    </div>
  );
}
