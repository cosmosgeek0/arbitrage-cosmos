import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Activity, RefreshCw, ShieldCheck } from 'lucide-react';
import { useProductControlRoomContext } from '../features/productControlRoom/ProductControlRoomProvider';
import { useStore } from '../store';
import { timeAgo } from '../format';
import { apiErrorMessage, fetchJson } from '../lib/http';
import { createDelayedResetOwner, createSettledPoll } from '../lib/polling';
import { fireRefresh } from '../lib/refresh';
import {
  canonicalKillSwitchEngagePosture,
  canonicalRefreshTargetPosture,
  type CanonicalRefreshTarget,
} from '../lib/operatorControlPosture';
import {
  mutateSystemControl,
  type SystemComponentId,
  type SystemControlState,
  type SystemSafeMode,
  type SystemControlMutation,
} from '../lib/systemIntegration';
import { PillSelect } from '../components/PillSelect';
import type {
  ProductCommandScalar,
  ProductComponentProjection,
  ProductControlRegistryEntry,
  ProductDependencyEdgeProjection,
  ProductWatchmanStatus,
} from '../lib/productIntegration';
import './Health.css';
import './Watchdog.css';

// Watchdog is the site's connections/lag observatory. Its reads are bounded and
// its writes are exactly the canonical operational contracts the product
// already mounts: POST /api/refresh for bounded public-source refresh, and
// POST /api/system-integration/controls for the canonical control registry.
// Nothing here is fabricated: unread facts render UNKNOWN/UNAVAILABLE, and
// every action's outcome is the server's own response, never an optimistic
// local claim.

const WATCHDOG_ENDPOINT = '/api/watchdog';
const WATCHDOG_POLL_MS = 5_000;
const RESOURCE_SCAN_MS = 2_000;
const AGE_TICK_MS = 1_000;
/** Shared browser fetch fuse (lib/http default request lifetime). */
const TRANSPORT_FUSE_MS = 10_000;
const TRANSPORT_ALERT_MS = 8_000;
const LANE_SAMPLE_LIMIT = 20;
/** The dock's exact bounded refresh lifetime. */
const REFRESH_TIMEOUT_MS = 8_000;
const REFRESH_OK_RESET_MS = 1_500;
const REFRESH_ERR_RESET_MS = 2_400;
/** An armed control disarms itself; a stale arm can never apply. */
const CONTROL_ARM_WINDOW_MS = 5_000;

type Tone = 'healthy' | 'degraded' | 'broken' | 'idle';

const UNKNOWN = 'UNKNOWN';
const UNAVAILABLE = 'UNAVAILABLE';

// ---- exact readers -------------------------------------------------------
// Every projection below fails closed: a value that is not an exact finite
// number/boolean becomes null, and null renders as UNKNOWN.

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function nonNegative(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function boolOrNull(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function textOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function msLabel(value: number | null): string {
  if (value === null) return UNKNOWN;
  if (value < 1_000) return `${Math.round(value)} ms`;
  return `${Math.round(value / 100) / 10} s`;
}

function kbLabel(transferSize: number | null, decodedBodySize: number | null): string {
  if (transferSize !== null && transferSize > 0) return `${Math.round(transferSize / 102.4) / 10} KB`;
  if (decodedBodySize !== null && decodedBodySize > 0) return 'CACHED';
  return UNKNOWN;
}

function words(value: string): string {
  return value.replaceAll('-', ' ').replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function count(value: number | null): string {
  return value === null ? UNKNOWN : String(value);
}

function componentTone(status: ProductWatchmanStatus): Tone {
  if (status === 'operational') return 'healthy';
  if (status === 'outage') return 'broken';
  if (status === 'planned') return 'idle';
  return 'degraded';
}

// ---- server watchdog owner ----------------------------------------------

type WatchdogReadState = 'LOADING' | 'CURRENT' | 'UNAVAILABLE';

type WatchdogReading = Readonly<{
  observedAtMs: number;
  loopCurrentMs: number | null;
  loopP95Ms: number | null;
  loopMaxMs: number | null;
  buildDurationMs: number | null;
  buildAtMs: number | null;
  buildInFlight: boolean | null;
  buildError: string | null;
  buildsStarted: number | null;
  buildsSucceeded: number | null;
  staleServedCount: number | null;
  cacheAgeMs: number | null;
  cacheDigestPrefix: string | null;
  wsClients: number | null;
  rssMb: number | null;
  uptimeSec: number | null;
}>;

/**
 * Project the watchdog owner payload. Both the grouped and the flat publication
 * shapes are accepted because the browser must not assert which one the owner
 * publishes; every field it cannot read exactly stays null.
 */
export function projectWatchdogReading(payload: unknown, observedAtMs: number): WatchdogReading {
  const root = asRecord(payload) ?? {};
  const loop = asRecord(root.loopLag) ?? asRecord(root.eventLoop) ?? root;
  const build = asRecord(root.envelopeBuild) ?? asRecord(root.build) ?? root;
  const cache = asRecord(root.cache) ?? {};
  const process = asRecord(root.process) ?? {};
  return Object.freeze({
    observedAtMs,
    loopCurrentMs: nonNegative(loop.currentMs),
    loopP95Ms: nonNegative(loop.p95Ms),
    loopMaxMs: nonNegative(loop.maxMs),
    buildDurationMs: nonNegative(build.lastBuildDurationMs),
    buildAtMs: nonNegative(build.lastBuildCompletedAtMs ?? build.lastBuildAtMs),
    buildInFlight: boolOrNull(build.inFlight),
    buildError: textOrNull(build.lastBuildError),
    buildsStarted: nonNegative(build.buildsStarted),
    buildsSucceeded: nonNegative(build.buildsSucceeded),
    staleServedCount: nonNegative(build.staleServedCount),
    cacheAgeMs: nonNegative(cache.ageMs),
    cacheDigestPrefix: textOrNull(cache.digestPrefix8),
    wsClients: nonNegative(root.wsClients),
    rssMb: nonNegative(process.rssMb),
    uptimeSec: nonNegative(process.uptimeSec),
  });
}

// ---- passive browser transport (RUM) + one-shot probe --------------------

type LaneId =
  | 'supervisor' | 'events' | 'state' | 'engine-basis'
  | 'engine-volume' | 'markets' | 'calendar' | 'watchdog';

type LaneSample = Readonly<{
  durationMs: number;
  transferSize: number | null;
  decodedBodySize: number | null;
}>;

// First match wins, so the two product-integration lanes are listed before the
// generic prefixes they share. `probePath` is a read-only GET on that lane's
// own owner — the Probe button never mutates anything.
const LANES: readonly Readonly<{ id: LaneId; label: string; prefix: string; probePath: string }>[] = Object.freeze([
  { id: 'supervisor', label: 'Supervisor', prefix: '/api/product-integration/v1/supervisor', probePath: '/api/product-integration/v1/supervisor' },
  { id: 'events', label: 'Material Events', prefix: '/api/product-integration/v1/material-events', probePath: '/api/product-integration/v1/material-events?afterCursor=0&limit=1' },
  { id: 'state', label: 'State', prefix: '/api/state', probePath: '/api/state?view=slim' },
  { id: 'engine-basis', label: 'Engine · Basis', prefix: '/api/engine/basis', probePath: '/api/engine/basis' },
  { id: 'engine-volume', label: 'Engine · Volume', prefix: '/api/engine/volume', probePath: '/api/engine/volume' },
  { id: 'markets', label: 'Markets', prefix: '/api/markets', probePath: '/api/markets' },
  { id: 'calendar', label: 'Calendar', prefix: '/api/calendar', probePath: '/api/calendar' },
  { id: 'watchdog', label: 'Watchdog', prefix: WATCHDOG_ENDPOINT, probePath: WATCHDOG_ENDPOINT },
]);

export function classifyTransportLane(pathname: string): LaneId | null {
  return LANES.find((lane) => pathname.startsWith(lane.prefix))?.id ?? null;
}

type LaneBuffer = Readonly<Record<LaneId, readonly LaneSample[]>>;

const EMPTY_LANES: LaneBuffer = Object.freeze(
  Object.fromEntries(
    LANES.map((lane) => [lane.id, Object.freeze<LaneSample[]>([])]),
  ) as unknown as Record<LaneId, readonly LaneSample[]>,
);

/**
 * Append this origin's new /api/* resource entries to their lane buffers. The
 * caller advances `afterStartTime` so an entry is never counted twice, and each
 * lane retains only its last LANE_SAMPLE_LIMIT samples. No request is issued:
 * the page reads measurements the browser already recorded — including the ones
 * a Probe click produced, so a probe is measured by the browser, not by a
 * wall clock the page could get wrong.
 */
export function collectTransportSamples(
  entries: readonly PerformanceResourceTiming[],
  current: LaneBuffer,
  afterStartTime: number,
): Readonly<{ lanes: LaneBuffer; cursor: number; added: number }> {
  const next: Record<LaneId, LaneSample[]> = Object.fromEntries(
    LANES.map((lane) => [lane.id, [...current[lane.id]]]),
  ) as Record<LaneId, LaneSample[]>;
  let cursor = afterStartTime;
  let added = 0;
  for (const entry of entries) {
    if (!(entry.startTime > afterStartTime)) continue;
    if (entry.startTime > cursor) cursor = entry.startTime;
    if (entry.initiatorType !== 'fetch' && entry.initiatorType !== 'xmlhttprequest') continue;
    let pathname: string;
    try {
      const url = new URL(entry.name, window.location.href);
      if (url.origin !== window.location.origin) continue;
      pathname = url.pathname;
    } catch {
      continue;
    }
    const laneId = classifyTransportLane(pathname);
    if (laneId === null) continue;
    const durationMs = nonNegative(entry.duration);
    if (durationMs === null) continue;
    next[laneId].push(Object.freeze({
      durationMs,
      transferSize: nonNegative(entry.transferSize),
      decodedBodySize: nonNegative(entry.decodedBodySize),
    }));
    added += 1;
  }
  return Object.freeze({
    lanes: Object.freeze(
      Object.fromEntries(
        LANES.map((lane) => [lane.id, Object.freeze(next[lane.id].slice(-LANE_SAMPLE_LIMIT))]),
      ) as Record<LaneId, readonly LaneSample[]>,
    ),
    cursor,
    added,
  });
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

type FuseVerdict = 'OK' | 'CLOSE' | 'BLOWN';

export function transportFuseVerdict(lastMs: number | null): FuseVerdict | null {
  if (lastMs === null) return null;
  const marginMs = TRANSPORT_FUSE_MS - lastMs;
  if (marginMs <= 0) return 'BLOWN';
  return marginMs <= TRANSPORT_FUSE_MS - TRANSPORT_ALERT_MS ? 'CLOSE' : 'OK';
}

type ProbeState = Readonly<{ state: 'PENDING' | 'OK' | 'ERR'; detail: string }>;

const REFRESH_TARGETS: readonly Readonly<{ id: CanonicalRefreshTarget; label: string }>[] = Object.freeze([
  { id: 'all', label: 'Mounted Connections' },
  { id: 'market', label: 'Market Network' },
  { id: 'runtime', label: 'Bot Runtimes' },
  { id: 'news', label: 'News Sources' },
  { id: 'calendar', label: 'Calendar' },
  { id: 'fx', label: 'FX Rates' },
]);

// ---- canonical control mutation projection -------------------------------

/**
 * Narrow a canonical registry entry onto the exact mounted control contract.
 * The route validates a strict per-command key allowlist, so anything whose
 * backend command or payload shape is not exactly one of the four mounted
 * operational commands returns null and stays an observe-only mirror. This is
 * also the money-path guard: capital-authority and any future command are
 * refused here rather than being sent speculatively.
 */
export function projectSystemControlMutation(
  backendCommandId: string,
  payload: Readonly<Record<string, ProductCommandScalar>>,
): SystemControlMutation | null {
  const keys = Object.keys(payload);
  if (keys.length !== 1) return null;
  if (backendCommandId === 'SET_SAFE_MODE') {
    const safeMode = payload.safeMode;
    return safeMode === 'READ_ONLY' || safeMode === 'ADVISORY' || safeMode === 'VALIDATE_ONLY'
      ? { command: 'SET_SAFE_MODE', safeMode: safeMode as SystemSafeMode }
      : null;
  }
  if (backendCommandId === 'SET_KILL_SWITCH') {
    return typeof payload.engaged === 'boolean' ? { command: 'SET_KILL_SWITCH', engaged: payload.engaged } : null;
  }
  if (backendCommandId === 'SET_INTAKE_PAUSED') {
    return typeof payload.paused === 'boolean' ? { command: 'SET_INTAKE_PAUSED', paused: payload.paused } : null;
  }
  if (backendCommandId === 'RESTART_COMPONENT') {
    return typeof payload.componentId === 'string' && payload.componentId.trim() !== ''
      ? { command: 'RESTART_COMPONENT', componentId: payload.componentId as SystemComponentId }
      : null;
  }
  return null;
}

export function describeMutation(mutation: SystemControlMutation): string {
  const [field, value] = Object.entries(mutation).find(([key]) => key !== 'command') ?? ['', ''];
  return `POST ${mutation.command} ${field}=${String(value)}`;
}

type ControlDisposition = Readonly<{
  live: boolean;
  mutation: SystemControlMutation | null;
  commandText: string | null;
  blockedReason: string;
}>;

/**
 * Decide whether a registry entry may become a real toggle on this page. Every
 * gate the canonical registry already publishes is honoured — wiring, the
 * entry's own disabledReason, the engage-only kill-switch posture — and a
 * command whose effect is already the current effective value is refused as a
 * no-op rather than sent.
 */
export function liveControlDisposition(
  control: Readonly<ProductControlRegistryEntry>,
  expectedRevision: number | null,
): ControlDisposition {
  const refuse = (blockedReason: string): ControlDisposition => Object.freeze({
    live: false, mutation: null, commandText: null, blockedReason,
  });
  if (control.wiringState !== 'WIRED_LIVE') return refuse(`${control.wiringState} · canonical wiring is not live`);
  if (control.payloadEnumeration.length !== 2) return refuse('Not a two-value canonical toggle');
  if (control.disabledReason !== null) return refuse(control.disabledReason);
  if (expectedRevision === null) return refuse('Canonical control revision unavailable');
  const mutation = projectSystemControlMutation(control.backendCommandId, control.payload);
  if (mutation === null) return refuse(`${control.backendCommandId} is not a mounted operational command`);
  if (mutation.command === 'SET_KILL_SWITCH') {
    const posture = canonicalKillSwitchEngagePosture({
      currentEffectiveValue: control.currentEffectiveValue,
      payload: control.payload,
    });
    if (!posture.actionAllowed) return refuse(posture.disabledReason ?? 'Kill switch action is unavailable');
  }
  const [, target] = Object.entries(mutation).find(([key]) => key !== 'command') ?? ['', ''];
  if (control.currentEffectiveValue.trim() === String(target)) return refuse(`Already ${String(target)}`);
  return Object.freeze({ live: true, mutation, commandText: describeMutation(mutation), blockedReason: '' });
}

/** The server's own readback field for a command, or null when it publishes none. */
export function readbackValue(command: SystemControlMutation['command'], state: Readonly<SystemControlState>): string | null {
  if (command === 'SET_SAFE_MODE') return state.safeMode;
  if (command === 'SET_KILL_SWITCH') return state.killSwitchEngaged ? 'ENGAGED' : 'CLEAR';
  if (command === 'SET_INTAKE_PAUSED') return state.intakePaused ? 'PAUSED' : 'ACTIVE';
  return null;
}

// ---- deterministic layered dependency graph ------------------------------

type FabricNode = Readonly<{
  id: string;
  label: string;
  tone: Tone;
  statusLabel: string;
  detail: string;
  layer: number;
  row: number;
}>;

/**
 * Longest-path layering: a component sits one layer right of its deepest
 * published dependency. Ordering inside a layer is alphabetical so the same
 * envelope always draws the same picture regardless of hover or selection. A
 * dependency cycle cannot extend the layering past the component count, so
 * relaxation is bounded by it.
 */
export function layerDependencyGraph(
  components: readonly Readonly<ProductComponentProjection>[],
  edges: readonly Readonly<ProductDependencyEdgeProjection>[],
): readonly FabricNode[] {
  const known = new Set(components.map((component) => component.componentId));
  const live = edges.filter((edge) => known.has(edge.fromComponentId) && known.has(edge.toComponentId));
  const layers = new Map<string, number>(components.map((component) => [component.componentId, 0]));
  for (let pass = 0; pass < components.length; pass += 1) {
    let moved = false;
    for (const edge of live) {
      if (edge.fromComponentId === edge.toComponentId) continue;
      const candidate = (layers.get(edge.fromComponentId) ?? 0) + 1;
      if (candidate > (layers.get(edge.toComponentId) ?? 0)) {
        layers.set(edge.toComponentId, candidate);
        moved = true;
      }
    }
    if (!moved) break;
  }
  const rows = new Map<number, number>();
  return Object.freeze(
    [...components]
      .sort((a, b) => {
        const byLayer = (layers.get(a.componentId) ?? 0) - (layers.get(b.componentId) ?? 0);
        return byLayer !== 0 ? byLayer : a.componentId.localeCompare(b.componentId);
      })
      .map((component) => {
        const layer = layers.get(component.componentId) ?? 0;
        const row = rows.get(layer) ?? 0;
        rows.set(layer, row + 1);
        const freshness = component.heartbeatAtMs === null
          ? 'Heartbeat UNKNOWN'
          : `Heartbeat ${timeAgo(component.heartbeatAtMs)}`;
        return Object.freeze({
          id: component.componentId,
          label: words(component.componentId),
          tone: componentTone(component.canonicalPresentation.status),
          statusLabel: component.canonicalPresentation.statusLabel,
          detail: `${component.canonicalPresentation.statusLabel} · ${freshness} · ${component.freshnessState} · Lifecycle ${component.observedLifecycle} · Capability ${component.capability}${component.blockerCode ? ` · ${component.blockerCode}` : ''}`,
          layer,
          row,
        });
      }),
  );
}

const NODE_WIDTH = 176;
const NODE_HEIGHT = 40;
const LAYER_GAP = 78;
const ROW_GAP = 16;
const GRAPH_PAD = 18;

const nodeX = (layer: number): number => GRAPH_PAD + layer * (NODE_WIDTH + LAYER_GAP);
const nodeY = (row: number): number => GRAPH_PAD + row * (NODE_HEIGHT + ROW_GAP);

function ConnectionFabricGraph({
  nodes,
  edges,
  selectedId,
  hoveredId,
  provenContinuity,
  onSelect,
  onHover,
}: Readonly<{
  nodes: readonly FabricNode[];
  edges: readonly Readonly<ProductDependencyEdgeProjection>[];
  selectedId: string | null;
  hoveredId: string | null;
  provenContinuity: boolean;
  onSelect: (id: string) => void;
  onHover: (id: string | null) => void;
}>) {
  const placed = new Map(nodes.map((node) => [node.id, node]));
  const width = nodeX(Math.max(0, ...nodes.map((node) => node.layer))) + NODE_WIDTH + GRAPH_PAD;
  const height = nodeY(Math.max(0, ...nodes.map((node) => node.row))) + NODE_HEIGHT + GRAPH_PAD;
  // Focus is hover-first so pointing never loses the pinned selection.
  const focusId = hoveredId ?? selectedId;
  const linked = new Set<string>();
  if (focusId !== null) {
    linked.add(focusId);
    for (const edge of edges) {
      if (edge.fromComponentId === focusId) linked.add(edge.toComponentId);
      if (edge.toComponentId === focusId) linked.add(edge.fromComponentId);
    }
  }
  return (
    <svg
      className={`wdogx-fabric-svg${focusId === null ? '' : ' focused'}${provenContinuity ? ' proven' : ''}`}
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      aria-label="Canonical component dependency fabric"
    >
      <g className="wdogx-fabric-edges">
        {edges.map((edge) => {
          const from = placed.get(edge.fromComponentId);
          const to = placed.get(edge.toComponentId);
          if (!from || !to) return null;
          const x1 = nodeX(from.layer) + NODE_WIDTH;
          const y1 = nodeY(from.row) + NODE_HEIGHT / 2;
          const x2 = nodeX(to.layer);
          const y2 = nodeY(to.row) + NODE_HEIGHT / 2;
          const bend = Math.max(18, (x2 - x1) / 2);
          const touching = focusId !== null
            && (edge.fromComponentId === focusId || edge.toComponentId === focusId);
          return (
            <path
              key={`${edge.fromComponentId}->${edge.toComponentId}`}
              className={`wdogx-edge state-${edge.state.toLowerCase()}${edge.required ? '' : ' optional'}${touching ? ' linked' : ''}`}
              d={`M${x1} ${y1} C${x1 + bend} ${y1} ${x2 - bend} ${y2} ${x2} ${y2}`}
              fill="none"
            >
              <title>
                {`${edge.fromComponentId} → ${edge.toComponentId} · ${edge.state} · ${edge.required ? 'REQUIRED' : 'OPTIONAL'}${edge.reasonCodes.length ? ` · ${edge.reasonCodes.join(' · ')}` : ''}`}
              </title>
            </path>
          );
        })}
      </g>
      <g className="wdogx-fabric-nodes">
        {nodes.map((node) => {
          const x = nodeX(node.layer);
          const y = nodeY(node.row);
          return (
            <g
              key={node.id}
              className={`wdogx-node tone-${node.tone}${node.id === selectedId ? ' selected' : ''}${focusId !== null && linked.has(node.id) ? ' linked' : ''}`}
              role="button"
              tabIndex={0}
              aria-pressed={node.id === selectedId}
              aria-label={`${node.label} · ${node.statusLabel}`}
              onClick={() => onSelect(node.id)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onSelect(node.id);
                }
              }}
              onMouseEnter={() => onHover(node.id)}
              onMouseLeave={() => onHover(null)}
              onFocus={() => onHover(node.id)}
              onBlur={() => onHover(null)}
            >
              <rect x={x} y={y} width={NODE_WIDTH} height={NODE_HEIGHT} rx={8} ry={8}>
                <title>{node.detail}</title>
              </rect>
              {node.tone === 'healthy' ? (
                <circle className="wdogx-node-pulse" cx={x + NODE_WIDTH - 13} cy={y + 13} r={3} />
              ) : null}
              <text x={x + 12} y={y + 17} className="wdogx-node-label">{node.label}</text>
              <text x={x + 12} y={y + 30} className="wdogx-node-status">{node.statusLabel}</text>
            </g>
          );
        })}
      </g>
    </svg>
  );
}

function ComponentDrawer({
  component,
  edges,
  onSelect,
  onClose,
}: Readonly<{
  component: Readonly<ProductComponentProjection>;
  edges: readonly Readonly<ProductDependencyEdgeProjection>[];
  onSelect: (id: string) => void;
  onClose: () => void;
}>) {
  const upstream = edges.filter((edge) => edge.toComponentId === component.componentId);
  const downstream = edges.filter((edge) => edge.fromComponentId === component.componentId);
  const tone = componentTone(component.canonicalPresentation.status);
  const chip = (id: string, state: string, key: string) => (
    <button type="button" key={key} className={`wdogx-dep-chip state-${state.toLowerCase()}`} onClick={() => onSelect(id)}>
      {words(id)}<em>{state}</em>
    </button>
  );
  return (
    <aside className="wdogx-drawer" aria-label={`${component.componentId} detail`}>
      <header className="wdogx-drawer-head">
        <span>
          <b>{words(component.componentId)}</b>
          <code>{component.componentId}</code>
        </span>
        <span className={`healthx-state ${tone}`}><i aria-hidden="true" />{component.canonicalPresentation.statusLabel}</span>
        <button type="button" className="wdogx-drawer-close" onClick={onClose} aria-label="Close component detail">×</button>
      </header>
      <dl className="wdogx-drawer-facts">
        <div>
          <dt>Owner / Truth</dt>
          <dd>{component.owner} · {component.truthLabel}</dd>
        </div>
        <div>
          <dt>Lifecycle</dt>
          <dd>{component.desiredLifecycle} → {component.observedLifecycle} · {component.capability}</dd>
        </div>
        <div>
          <dt>Freshness / Heartbeat</dt>
          <dd>
            {component.heartbeatAtMs === null ? UNKNOWN : timeAgo(component.heartbeatAtMs)} · {component.freshnessState}
            {' · '}Source age {msLabel(component.sourceAgeMs)} · Advance {component.lastAdvanceAtMs === null ? UNKNOWN : timeAgo(component.lastAdvanceAtMs)}
          </dd>
        </div>
        <div>
          <dt>Lag / Backlog</dt>
          <dd>
            Lag {msLabel(component.processingLagMs)} · Queue {count(component.queueDepth)}/{count(component.queueCapacity)}
            {' · '}Drops {count(component.droppedCount)} · Processing age {msLabel(component.processingAgeMs)}
          </dd>
        </div>
        <div>
          <dt>Last Failure</dt>
          <dd>
            {component.blockerCode ?? 'No blocker published'}
            {' · '}Root {component.rootCauseComponentId ?? 'NONE'}
            {' · '}Retry {component.retryState} {count(component.retryAttempt)}/{count(component.retryCeiling)}
            {component.backoffMs === null ? '' : ` · Backoff ${msLabel(component.backoffMs)}`}
          </dd>
        </div>
        <div>
          <dt>Quality</dt>
          <dd>
            {component.dataQualityState} · Invalid {count(component.dataQualityInvalidCount)} · Duplicate {count(component.dataQualityDuplicateCount)}
            {' · '}Out of order {count(component.dataQualityOutOfOrderCount)} · Gaps {count(component.dataQualitySequenceGapCount)}
          </dd>
        </div>
        <div>
          <dt>Checkpoint / Restart</dt>
          <dd>
            {component.checkpointState} · {component.checkpointRevision ?? 'No revision'} · Saved {component.checkpointPersistedAtMs === null ? UNKNOWN : timeAgo(component.checkpointPersistedAtMs)}
            {' · '}{component.restartState} · Generation {component.generation} · {component.restartCount} restarts
          </dd>
        </div>
        <div>
          <dt>Capital Relevance</dt>
          <dd>{component.capitalRelevance}</dd>
        </div>
      </dl>
      <div className="wdogx-drawer-deps">
        <span>Depends On</span>
        <div>{upstream.length > 0 ? upstream.map((edge) => chip(edge.fromComponentId, edge.state, `up-${edge.fromComponentId}`)) : <em className="wdogx-chip idle">NONE PUBLISHED</em>}</div>
        <span>Feeds</span>
        <div>{downstream.length > 0 ? downstream.map((edge) => chip(edge.toComponentId, edge.state, `down-${edge.toComponentId}`)) : <em className="wdogx-chip idle">NONE PUBLISHED</em>}</div>
      </div>
    </aside>
  );
}

// ---- sparkline + change flash --------------------------------------------

function Sparkline({ samples }: Readonly<{ samples: readonly LaneSample[] }>) {
  if (samples.length < 2) return <span className="wdogx-spark-empty">{samples.length === 1 ? '1 sample' : 'No sample'}</span>;
  const values = samples.map((sample) => sample.durationMs);
  const max = Math.max(...values, 1);
  const step = 58 / (values.length - 1);
  const points = values
    .map((value, index) => `${(index * step).toFixed(1)},${(16 - (value / max) * 14).toFixed(1)}`)
    .join(' ');
  return (
    <svg className="wdogx-spark" viewBox="0 0 58 18" width={58} height={18} aria-hidden="true">
      <polyline points={points} fill="none" />
    </svg>
  );
}

/**
 * Value-change flash with no timer and no state: keying the span on the value
 * remounts it when — and only when — the rendered fact actually changed, which
 * restarts the CSS animation. A repeated value never flashes.
 */
function Flash({ value, className }: Readonly<{ value: string; className?: string }>) {
  return <span key={value} className={`wdogx-flash${className ? ` ${className}` : ''}`}>{value}</span>;
}

// ---- page ----------------------------------------------------------------

export function Watchdog() {
  const { connected, marketStatus, marketsUpdatedAt, marketsError, markets } = useStore();
  const { binding } = useProductControlRoomContext();
  const snapshot = binding.snapshot;

  const [reading, setReading] = useState<WatchdogReading | null>(null);
  const [readState, setReadState] = useState<WatchdogReadState>('LOADING');
  const [readError, setReadError] = useState<string | null>(null);
  const [lanes, setLanes] = useState<LaneBuffer>(EMPTY_LANES);
  const [sampleCount, setSampleCount] = useState(0);
  const [observedAt, setObservedAt] = useState(() => Date.now());
  const [tick, setTick] = useState(() => Date.now());
  const cursorRef = useRef(0);
  const lanesRef = useRef<LaneBuffer>(EMPTY_LANES);
  const scanRef = useRef<() => void>(() => {});

  // U1 fabric interaction
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  // U2 bounded public refresh — the retired dock's exact contract and states.
  const [refreshTarget, setRefreshTarget] = useState<CanonicalRefreshTarget>('news');
  const [refreshSt, setRefreshSt] = useState<'idle' | 'spin' | 'ok' | 'err'>('idle');
  const [refreshIssues, setRefreshIssues] = useState<readonly string[]>([]);
  const [refreshTs, setRefreshTs] = useState<number | null>(null);
  const refreshBusy = useRef(false);
  const refreshReset = useMemo(() => createDelayedResetOwner(), []);

  // U2 per-lane probe
  const [probes, setProbes] = useState<Readonly<Partial<Record<LaneId, ProbeState>>>>({});

  // U3 canonical control arm/apply
  const [armed, setArmed] = useState<Readonly<{ controlId: string; commandText: string }> | null>(null);
  const [controlBusy, setControlBusy] = useState<string | null>(null);
  const [controlResults, setControlResults] = useState<Readonly<Record<string, Readonly<{ tone: Tone; text: string }>>>>({});
  const [readback, setReadback] = useState<Readonly<SystemControlState> | null>(null);

  useEffect(() => () => refreshReset.cancel(), [refreshReset]);

  // One bounded 5s read of the server watchdog owner, mounted with the page and
  // stopped with it. The shared settled poll never overlaps generations.
  useEffect(() => {
    const poll = createSettledPoll<unknown>({
      intervalMs: WATCHDOG_POLL_MS,
      timeoutMs: TRANSPORT_FUSE_MS,
      request: (signal) => fetchJson<unknown>(WATCHDOG_ENDPOINT, { cache: 'no-store', signal }, TRANSPORT_FUSE_MS),
      onSuccess: (payload) => {
        setReading(projectWatchdogReading(payload, Date.now()));
        setReadState('CURRENT');
        setReadError(null);
      },
      onError: (error) => {
        setReading(null);
        setReadState('UNAVAILABLE');
        setReadError(apiErrorMessage(error, 'Watchdog owner read failed'));
      },
    });
    poll.start();
    return () => poll.stop();
  }, []);

  // Passive resource-timing scan. Zero added network load: it only reads what
  // the browser already recorded for requests other owners issued.
  useEffect(() => {
    const scan = () => {
      if (typeof performance?.getEntriesByType === 'function') {
        const entries = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
        const collected = collectTransportSamples(entries, lanesRef.current, cursorRef.current);
        cursorRef.current = collected.cursor;
        if (collected.added > 0) {
          lanesRef.current = collected.lanes;
          setLanes(collected.lanes);
          setSampleCount((c) => c + collected.added);
        }
      }
      setObservedAt(Date.now());
    };
    scanRef.current = scan;
    scan();
    const timer = window.setInterval(scan, RESOURCE_SCAN_MS);
    return () => window.clearInterval(timer);
  }, []);

  // One-second age ticker so published ages keep counting between reads.
  useEffect(() => {
    const timer = window.setInterval(() => setTick(Date.now()), AGE_TICK_MS);
    return () => window.clearInterval(timer);
  }, []);

  // An arm expires on its own; nothing can apply outside the window.
  useEffect(() => {
    if (armed === null) return;
    const timer = window.setTimeout(() => setArmed(null), CONTROL_ARM_WINDOW_MS);
    return () => window.clearTimeout(timer);
  }, [armed]);

  const finishRefresh = useCallback((ok: boolean, issues: readonly string[], ts: number) => {
    setRefreshTs(ts);
    setRefreshIssues(issues);
    setRefreshSt(ok ? 'ok' : 'err');
    refreshReset.schedule(ok ? REFRESH_OK_RESET_MS : REFRESH_ERR_RESET_MS, () => setRefreshSt('idle'));
  }, [refreshReset]);

  // Exactly the retired dock's bounded public refresh: the canonical posture
  // gate first, then the same POST, then the same unconditional release. A
  // local acknowledgement is never promoted into canonical recovery truth.
  const runRefresh = useCallback(async (target: CanonicalRefreshTarget) => {
    const posture = canonicalRefreshTargetPosture(target);
    if (!posture.actionAllowed) {
      finishRefresh(false, [`${posture.statusLabel} · ${posture.reason}`], Date.now());
      return;
    }
    if (refreshBusy.current) return;
    refreshBusy.current = true;
    refreshReset.cancel();
    setRefreshSt('spin');
    let ok = false;
    let issues: string[] = [];
    let ts = Date.now();
    try {
      const result = await fetchJson<{ ok?: boolean; issues?: string[]; ts?: number }>('/api/refresh', {
        method: 'POST',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target }),
      }, REFRESH_TIMEOUT_MS);
      ok = result.ok === true;
      issues = result.issues ?? (ok ? [] : [`${target} refresh failed`]);
      ts = result.ts ?? Date.now();
      fireRefresh();
    } catch (error) {
      issues = [apiErrorMessage(error, `${target} refresh failed`)];
    } finally {
      refreshBusy.current = false;
      finishRefresh(ok && issues.length === 0, issues, ts);
      void binding.refresh();
    }
  }, [binding, finishRefresh, refreshReset]);

  // One read-only GET on the lane's own owner. The sample it produces is picked
  // up from the browser's resource buffer by the scan below, so the ring keeps
  // exactly one browser-measured entry per request and never a page-timed guess.
  const runProbe = useCallback(async (lane: typeof LANES[number]) => {
    setProbes((current) => ({ ...current, [lane.id]: { state: 'PENDING', detail: `GET ${lane.probePath}` } }));
    const startedAt = performance.now();
    try {
      await fetchJson<unknown>(lane.probePath, { cache: 'no-store' }, TRANSPORT_FUSE_MS);
      const elapsed = Math.round(performance.now() - startedAt);
      setProbes((current) => ({ ...current, [lane.id]: { state: 'OK', detail: `200 · ${elapsed} ms` } }));
    } catch (error) {
      setProbes((current) => ({ ...current, [lane.id]: { state: 'ERR', detail: apiErrorMessage(error, 'Probe failed') } }));
    } finally {
      scanRef.current();
    }
  }, []);

  // Control revisions increase monotonically, and this page is not their only
  // writer — the control room, another tab, or an autonomous alarm actor can
  // advance them underneath us. So the freshest evidence wins rather than the
  // most recent local one: pinning our own receipt would wedge every later
  // command on STALE_COMMAND_REVISION until the page was reloaded.
  const envelopeRevision = snapshot?.dashboard?.control?.revision ?? null;
  const controlRevision = readback === null
    ? envelopeRevision
    : envelopeRevision === null
      ? readback.revision
      : Math.max(readback.revision, envelopeRevision);
  // A receipt is only rendered as the current state while it is still the
  // newest truth; once the envelope catches up or overtakes it, the envelope
  // owns the display again.
  const servedReadback = readback !== null
    && (envelopeRevision === null || readback.revision >= envelopeRevision)
    ? readback
    : null;

  // Second click inside the arm window applies. The rendered outcome is the
  // server's receipt — applied or not — never an optimistic local state.
  const applyControl = useCallback(async (control: Readonly<ProductControlRegistryEntry>) => {
    const disposition = liveControlDisposition(control, controlRevision);
    if (!disposition.live || disposition.mutation === null || controlRevision === null) return;
    setArmed(null);
    setControlBusy(control.controlId);
    setControlResults((current) => ({
      ...current,
      [control.controlId]: { tone: 'degraded', text: `Sending ${disposition.commandText}` },
    }));
    try {
      const receipt = await mutateSystemControl(
        controlRevision,
        `Watchdog observatory applied ${control.controlId}`.slice(0, 240),
        disposition.mutation,
      );
      setReadback(receipt.after);
      setControlResults((current) => ({
        ...current,
        [control.controlId]: {
          tone: receipt.applied ? 'healthy' : 'broken',
          text: `${receipt.applied ? 'APPLIED' : 'NOT APPLIED'} · ${receipt.code} · revision ${receipt.before.revision} → ${receipt.after.revision}${receipt.ledgerEventId === null ? ' · no ledger event' : ` · ledger #${receipt.ledgerEventId}`}`,
        },
      }));
      void binding.refresh();
    } catch (error) {
      setControlResults((current) => ({
        ...current,
        [control.controlId]: { tone: 'broken', text: `REJECTED · ${apiErrorMessage(error, 'Control command rejected')}` },
      }));
      // A rejection is often a revision the envelope has not caught up to yet.
      // Re-read so the next attempt is made against current truth.
      void binding.refresh();
    } finally {
      setControlBusy(null);
    }
  }, [binding, controlRevision]);

  const laneRows = useMemo(() => LANES.map((lane) => {
    const samples = lanes[lane.id];
    const values = samples.map((sample) => sample.durationMs);
    const last = samples.length > 0 ? samples[samples.length - 1] : null;
    return {
      ...lane,
      samples,
      lastMs: last?.durationMs ?? null,
      medianMs: median(values),
      maxMs: values.length > 0 ? Math.max(...values) : null,
      wire: last ? kbLabel(last.transferSize, last.decodedBodySize) : UNKNOWN,
      fuse: transportFuseVerdict(last?.durationMs ?? null),
    };
  }), [lanes]);

  const supervisorLane = laneRows.find((lane) => lane.id === 'supervisor')!;
  const stateLane = laneRows.find((lane) => lane.id === 'state')!;
  const worstLastMs = laneRows.reduce<number | null>(
    (worst, lane) => (lane.lastMs === null ? worst : worst === null ? lane.lastMs : Math.max(worst, lane.lastMs)),
    null,
  );

  // Header verdict: BLOCKED binding is red; an unread envelope or a browser lane
  // that reached the fuse is orange; only a proven read with current lanes is
  // green. The page never upgrades a verdict it cannot substantiate.
  const tone: Tone = binding.continuity === 'BLOCKED'
    ? 'broken'
    : snapshot === null || binding.error !== null
      ? 'degraded'
      : worstLastMs !== null && worstLastMs >= TRANSPORT_FUSE_MS
        ? 'degraded'
        : 'healthy';
  const toneLabel = tone === 'broken'
    ? 'Envelope Binding Blocked'
    : tone === 'degraded'
      ? snapshot === null ? 'Canonical Read Unavailable' : 'Transport Stale'
      : 'Connections Current';

  const latestReadMs = Math.max(reading?.observedAtMs ?? 0, snapshot?.evaluatedAtMs ?? 0);
  const supervisorSample = supervisorLane.samples[supervisorLane.samples.length - 1] ?? null;
  const compression = supervisorSample
    && supervisorSample.transferSize !== null && supervisorSample.transferSize > 0
    && supervisorSample.decodedBodySize !== null && supervisorSample.decodedBodySize > 0
    ? `${supervisorSample.transferSize < supervisorSample.decodedBodySize ? '−' : '+'}${Math.round(Math.abs(1 - supervisorSample.transferSize / supervisorSample.decodedBodySize) * 100)}%`
    : null;

  const materialEvents = snapshot?.materialEvents ?? null;
  const latestEvent = materialEvents && materialEvents.items.length > 0
    ? materialEvents.items[materialEvents.items.length - 1]
    : null;
  // Ages tick each second from the page clock; the published instant is fixed.
  const deltaAgeSec = latestEvent === null ? null : Math.max(0, Math.round((tick - latestEvent.occurredAtMs) / 1_000));
  const healthEvidence = snapshot?.surfaces.health.evidence ?? [];
  const ledgerWritability = healthEvidence.find((datum) => datum.fieldId === 'db-ledger');
  const bootRelease = snapshot?.bootReleaseReadback ?? null;
  const bootSha = bootRelease?.latest?.deployedCommit ?? bootRelease?.latest?.testedCommit ?? null;

  const fabricNodes = useMemo(
    () => (snapshot ? layerDependencyGraph(snapshot.components, snapshot.dependencyEdges) : []),
    [snapshot],
  );
  const selectedComponent = selectedId === null
    ? null
    : snapshot?.components.find((component) => component.componentId === selectedId) ?? null;

  const controls = snapshot?.controls ?? [];
  const refreshPosture = canonicalRefreshTargetPosture(refreshTarget);
  // Every canonical target stays visible so the preview-required truth is shown
  // rather than hidden behind a shorter menu.
  const refreshOptions = REFRESH_TARGETS.map(({ id, label }) => {
    const posture = canonicalRefreshTargetPosture(id);
    return { id, label: posture.actionAllowed ? label : `${label} · Preview Required` };
  });

  return (
    <div className="container page healthx-page wdogx-page">
      <section className="healthx-frame">
        <header className="healthx-toolbar">
          <div className="healthx-title">
            <img className="healthx-page-mark" src="/connection-reset-mark.svg" alt="" aria-hidden="true" />
            <h1>Watchdog</h1>
            <span className={`healthx-live ${tone}`}>
              <i aria-hidden="true" />
              {toneLabel}
            </span>
            <span className="healthx-updated">
              {latestReadMs > 0 ? `Updated ${timeAgo(latestReadMs)}` : binding.loading ? 'Reading Canonical Owner' : 'No Current Read'}
            </span>
          </div>
          <div className="healthx-toolbar-actions">
            <PillSelect
              value={refreshTarget}
              options={refreshOptions}
              onChange={setRefreshTarget}
              ariaLabel="Public Refresh Target"
              className="wdogx-refresh-select"
              buttonClassName="wdogx-refresh-trigger"
            />
            <button
              type="button"
              className={`healthx-button${refreshSt === 'spin' ? ' loading' : ''} wdogx-refresh-btn state-${refreshSt}`}
              disabled={refreshSt === 'spin' || !refreshPosture.actionAllowed}
              title={refreshPosture.reason}
              onClick={() => void runRefresh(refreshTarget)}
            >
              <RefreshCw size={14} />
              {refreshSt === 'spin' ? 'Refreshing' : refreshSt === 'ok' ? 'Refreshed' : refreshSt === 'err' ? 'Needs Review' : refreshPosture.actionLabel}
            </button>
            <span className="healthx-access">
              <ShieldCheck size={14} />
              {refreshTs === null ? 'No local refresh' : `Last attempt ${timeAgo(refreshTs)}`}
            </span>
          </div>
        </header>

        {refreshIssues.length > 0 ? (
          <div className="healthx-alert" title={refreshIssues.join(' · ')}>
            <Activity size={14} />
            {refreshIssues[0]}
          </div>
        ) : null}

        <div className="healthx-summary" aria-label="Watchdog Metric Quad">
          <div className="healthx-summary-cell">
            <span>Server Loop Lag</span>
            <strong className={reading === null ? 'not_configured' : undefined}>
              {reading === null
                ? (readState === 'LOADING' ? 'READING' : UNAVAILABLE)
                : <Flash value={msLabel(reading.loopCurrentMs)} />}
            </strong>
            <small>
              {reading === null
                ? readError ?? `${WATCHDOG_ENDPOINT} not read yet`
                : `p95 ${msLabel(reading.loopP95Ms)} · max ${msLabel(reading.loopMaxMs)} · RSS ${reading.rssMb === null ? UNKNOWN : `${reading.rssMb} MB`}`}
            </small>
          </div>
          <div className="healthx-summary-cell">
            <span>Envelope Build</span>
            <strong className={reading === null ? 'not_configured' : reading.buildError !== null ? 'broken' : undefined}>
              {reading === null
                ? (readState === 'LOADING' ? 'READING' : UNAVAILABLE)
                : <Flash value={msLabel(reading.buildDurationMs)} />}
            </strong>
            <small>
              {reading === null
                ? `Build telemetry unavailable from ${WATCHDOG_ENDPOINT}`
                : `Built ${reading.buildAtMs === null ? UNKNOWN : timeAgo(reading.buildAtMs)} · In flight ${reading.buildInFlight === null ? UNKNOWN : reading.buildInFlight ? 'YES' : 'NO'} · Stale served ${count(reading.staleServedCount)}${reading.buildError === null ? '' : ` · ${reading.buildError}`}`}
            </small>
          </div>
          <div className="healthx-summary-cell">
            <span>Browser Transport</span>
            <strong className={stateLane.lastMs === null ? 'not_configured' : stateLane.lastMs >= TRANSPORT_ALERT_MS ? 'broken' : undefined}>
              {stateLane.lastMs === null ? UNKNOWN : <Flash value={msLabel(stateLane.lastMs)} />}
            </strong>
            <small>
              State lane · Supervisor {supervisorLane.lastMs === null ? UNKNOWN : msLabel(supervisorLane.lastMs)} · {sampleCount} samples this visit
            </small>
          </div>
          <div className="healthx-summary-cell">
            <span>Delivery Channel</span>
            <strong className={connected ? 'healthy' : 'broken'}>{connected ? 'SOCKET LIVE' : 'SOCKET OFFLINE'}</strong>
            <small>
              {reading?.wsClients == null ? '' : `${reading.wsClients} delivery clients · `}
              Continuity {binding.continuity} · Material {materialEvents?.continuity ?? UNKNOWN} · Last delta {deltaAgeSec === null ? UNKNOWN : `${deltaAgeSec}s ago`}
            </small>
          </div>
        </div>

        {readState === 'UNAVAILABLE' ? (
          <div className="healthx-alert" title={readError ?? undefined}>
            <Activity size={14} />
            Watchdog owner {UNAVAILABLE} · {WATCHDOG_ENDPOINT} · {readError ?? 'no reason published'} · loop-lag and envelope-build rows stay unread
          </div>
        ) : null}

        <section className="wdogx-card" aria-label="Connection Fabric">
          <div className="wdogx-card-head">
            <span><b>Connection Fabric</b><em>Click a component for its envelope truth · hover to isolate its edges</em></span>
            <strong>
              {snapshot
                ? `${fabricNodes.length} components · ${snapshot.dependencyEdges.length} edges · Binding ${binding.continuity}`
                : UNAVAILABLE}
            </strong>
          </div>
          {snapshot && fabricNodes.length > 0 ? (
            <div className="wdogx-fabric-body">
              <div className="wdogx-fabric-scroll" role="region" aria-label="Dependency Fabric" tabIndex={0}>
                <ConnectionFabricGraph
                  nodes={fabricNodes}
                  edges={snapshot.dependencyEdges}
                  selectedId={selectedId}
                  hoveredId={hoveredId}
                  provenContinuity={binding.continuity === 'PROVEN'}
                  onSelect={(id) => setSelectedId((current) => (current === id ? null : id))}
                  onHover={setHoveredId}
                />
              </div>
              {selectedComponent ? (
                <ComponentDrawer
                  component={selectedComponent}
                  edges={snapshot.dependencyEdges}
                  onSelect={setSelectedId}
                  onClose={() => setSelectedId(null)}
                />
              ) : null}
            </div>
          ) : (
            <div className="healthx-empty">
              <Activity size={18} />
              <strong>Connection Fabric {UNAVAILABLE}</strong>
              <span>{binding.error ?? (binding.loading ? 'Reading the Product Integration supervisor.' : 'No canonical component graph has been published.')}</span>
            </div>
          )}
        </section>

        <section className="wdogx-card" aria-label="Browser Transport">
          <div className="wdogx-card-head">
            <span><b>Browser Transport</b><em>Passive resource-timing read · Probe fires one read-only GET on that lane's owner</em></span>
            <strong>{sampleCount} samples · last {LANE_SAMPLE_LIMIT} per lane · buffer resets on navigation</strong>
          </div>
          <div className="wdogx-table" role="table" aria-label="Browser Transport Lanes" aria-colcount={8}>
            <div className="wdogx-table-head" role="row">
              <span role="columnheader">Lane</span>
              <span role="columnheader">Last</span>
              <span role="columnheader">Median</span>
              <span role="columnheader">Max</span>
              <span role="columnheader">Wire</span>
              <span role="columnheader">Fuse Margin</span>
              <span role="columnheader">Last {LANE_SAMPLE_LIMIT}</span>
              <span role="columnheader">Probe</span>
            </div>
            {laneRows.map((lane) => {
              const probe = probes[lane.id];
              return (
                <div className="wdogx-table-row" role="row" key={lane.id}>
                  <span role="cell" className="wdogx-lane">
                    <strong>{lane.label}</strong>
                    <small>{probe ? probe.detail : lane.prefix}</small>
                  </span>
                  <span role="cell" className={`wdogx-num${lane.lastMs !== null && lane.lastMs > TRANSPORT_ALERT_MS ? ' alarm' : ''}`}>
                    {lane.lastMs === null ? UNKNOWN : <Flash value={msLabel(lane.lastMs)} />}
                  </span>
                  <span role="cell" className="wdogx-num">{lane.medianMs === null ? UNKNOWN : msLabel(lane.medianMs)}</span>
                  <span role="cell" className="wdogx-num">{lane.maxMs === null ? UNKNOWN : msLabel(lane.maxMs)}</span>
                  <span role="cell" className="wdogx-num">{lane.wire}</span>
                  <span role="cell">
                    {lane.fuse === null
                      ? <em className="wdogx-chip idle">{UNKNOWN}</em>
                      : (
                        <em
                          className={`wdogx-chip ${lane.fuse.toLowerCase()}`}
                          title={`${TRANSPORT_FUSE_MS} ms fuse − ${Math.round(lane.lastMs!)} ms last`}
                        >
                          {lane.fuse} {msLabel(TRANSPORT_FUSE_MS - lane.lastMs!)}
                        </em>
                      )}
                  </span>
                  <span role="cell" className="wdogx-spark-cell">
                    <Sparkline samples={lane.samples} />
                    <small>{lane.samples.length}</small>
                  </span>
                  <span role="cell">
                    <button
                      type="button"
                      className={`wdogx-probe-btn${probe ? ` state-${probe.state.toLowerCase()}` : ''}`}
                      disabled={probe?.state === 'PENDING'}
                      title={`GET ${lane.probePath}`}
                      onClick={() => void runProbe(lane)}
                    >
                      {probe?.state === 'PENDING' ? 'Probing' : 'Probe'}
                    </button>
                  </span>
                </div>
              );
            })}
          </div>
        </section>

        <section className="wdogx-card" aria-label="Feeds And Sources">
          <div className="wdogx-card-head">
            <span><b>Feeds &amp; Sources</b><em>Existing store and envelope truth only · this card adds no polling</em></span>
            <strong>{snapshot ? `Revision ${snapshot.revision}` : UNAVAILABLE}</strong>
          </div>
          <div className="wdogx-grid">
            <div className="wdogx-fact">
              <span>Market Publication</span>
              <strong className={marketStatus === 'CURRENT' ? 'healthy' : marketStatus === 'UNAVAILABLE' ? 'broken' : 'degraded'}>
                <Flash value={marketStatus} />
              </strong>
              <small>{marketsError ?? `${markets.length} rows · Published ${marketsUpdatedAt === null ? UNKNOWN : timeAgo(marketsUpdatedAt)}`}</small>
            </div>
            <div className="wdogx-fact">
              <span>Basis Engine</span>
              <strong>{snapshot?.surfaces.basis.bindingState ?? UNAVAILABLE}</strong>
              <small>{snapshot?.surfaces.basis.blocker ?? snapshot?.surfaces.basis.summary ?? 'Canonical basis surface unavailable.'}</small>
            </div>
            <div className="wdogx-fact">
              <span>Volume Engine</span>
              <strong>{snapshot?.surfaces.volume.bindingState ?? UNAVAILABLE}</strong>
              <small>{snapshot?.surfaces.volume.blocker ?? snapshot?.surfaces.volume.summary ?? 'Canonical volume surface unavailable.'}</small>
            </div>
            <div className="wdogx-fact">
              <span>Ledger Writability</span>
              <strong>{ledgerWritability?.value ?? UNKNOWN}</strong>
              <small>{ledgerWritability?.unavailableReason ?? ledgerWritability?.truthLabel ?? 'Canonical ledger evidence unavailable.'}</small>
            </div>
            <div className="wdogx-fact">
              <span>Ops Interlock</span>
              <strong className={snapshot?.opsIntakeInterlock.state === 'OPS_INTERLOCK_CLEAR' ? 'healthy' : snapshot ? 'degraded' : undefined}>
                {snapshot?.opsIntakeInterlock.state ?? UNAVAILABLE}
              </strong>
              <small>{snapshot?.opsIntakeInterlock.reasonCodes[0] ?? 'Canonical ops readback unavailable.'}</small>
            </div>
            <div className="wdogx-fact">
              <span>Boot Release</span>
              <strong className="wdogx-mono">{bootSha === null ? UNKNOWN : bootSha.slice(0, 12)}</strong>
              <small>{bootRelease === null ? 'Boot release readback unavailable.' : `${bootRelease.state} · ${bootRelease.latest?.lifecycleState ?? UNKNOWN} · Identity ${bootRelease.latest?.identityState ?? UNKNOWN}`}</small>
            </div>
            <div className="wdogx-fact">
              <span>Edge Compression</span>
              <strong>{compression === null ? UNKNOWN : `gzip ${compression}`}</strong>
              <small>
                {supervisorSample === null
                  ? 'No supervisor resource sample in this tab yet.'
                  : `Supervisor wire ${kbLabel(supervisorSample.transferSize, supervisorSample.decodedBodySize)} · decoded ${supervisorSample.decodedBodySize === null ? UNKNOWN : `${Math.round(supervisorSample.decodedBodySize / 102.4) / 10} KB`}`}
              </small>
            </div>
            <div className="wdogx-fact">
              <span>Published Cut</span>
              <strong className="wdogx-mono">{reading?.cacheDigestPrefix ?? UNKNOWN}</strong>
              <small>
                {reading === null
                  ? 'No watchdog cut telemetry.'
                  : `Cut age ${msLabel(reading.cacheAgeMs)} · Builds ${count(reading.buildsSucceeded)}/${count(reading.buildsStarted)} · Material ${materialEvents?.continuity ?? UNKNOWN}`}
              </small>
            </div>
          </div>
        </section>

        <section className="wdogx-card" aria-label="Engine Compute">
          <div className="wdogx-card-head">
            <span><b>Engine Compute</b><em>Canonical control registry · live toggles arm first and apply the server's own readback</em></span>
            <strong>{snapshot ? `${controls.length} controls · revision ${controlRevision ?? UNKNOWN}` : UNAVAILABLE}</strong>
          </div>
          {controls.length > 0 ? (
            <div className="wdogx-controls">
              {controls.map((control) => {
                const disposition = liveControlDisposition(control, controlRevision);
                const effective = control.currentEffectiveValue.trim();
                const served = servedReadback === null
                  ? null
                  : readbackValue(control.backendCommandId as SystemControlMutation['command'], servedReadback);
                const shown = served ?? effective;
                const enumeration = control.payloadEnumeration.map((option) => String(option));
                const engaged = enumeration.length === 2
                  ? (shown === enumeration[1] ? true : shown === enumeration[0] ? false : null)
                  : null;
                const isArmed = armed?.controlId === control.controlId;
                const busy = controlBusy === control.controlId;
                const result = controlResults[control.controlId];
                return (
                  <article className={`wdogx-control${disposition.live ? ' live' : ''}${isArmed ? ' armed' : ''}`} key={control.controlId}>
                    <span className="wdogx-control-copy">
                      <b>{control.label}</b>
                      <em>{control.group} · {control.owner}</em>
                      <code>{control.controlId}</code>
                    </span>
                    <span className="wdogx-control-value">
                      <b><Flash value={shown || UNKNOWN} /></b>
                      <em>{served !== null ? 'Server readback' : control.currentDesiredValue.trim() === effective ? 'Desired matches effective' : `Desired ${control.currentDesiredValue.trim() || UNKNOWN}`}</em>
                    </span>
                    {disposition.live ? (
                      <button
                        type="button"
                        className={`wdogx-switch live${engaged === true ? ' on' : engaged === false ? ' off' : ' unknown'}${isArmed ? ' armed' : ''}`}
                        disabled={busy}
                        aria-label={isArmed ? `Confirm ${disposition.commandText}` : `Arm ${control.label}`}
                        title={isArmed ? `Confirm ${disposition.commandText}` : `Arm ${control.label} · ${control.confirmationText}`}
                        onClick={() => {
                          if (busy) return;
                          if (isArmed) void applyControl(control);
                          else setArmed({ controlId: control.controlId, commandText: disposition.commandText ?? '' });
                        }}
                      >
                        <i />
                      </button>
                    ) : (
                      <span
                        className={`wdogx-switch${engaged === true ? ' on' : engaged === false ? ' off' : ' unknown'}`}
                        role="img"
                        aria-label={`${control.label} ${engaged === null ? UNKNOWN : engaged ? 'engaged' : 'released'} (observe only)`}
                      >
                        <i />
                      </span>
                    )}
                    <em className={`wdogx-chip ${control.wiringState === 'WIRED_LIVE' ? 'ok' : 'idle'}`}>{control.wiringState}</em>
                    <em className={`wdogx-chip ${disposition.live ? (isArmed ? 'close' : 'ok') : 'observe'}`}>
                      {disposition.live ? (busy ? 'SENDING' : isArmed ? 'CONFIRM' : 'LIVE') : 'OBSERVE-ONLY'}
                    </em>
                    <span className="wdogx-control-note">
                      {busy
                        ? <em className="wdogx-note-pending">Awaiting server receipt…</em>
                        : isArmed
                          ? (
                            <em className="wdogx-note-armed" title={control.confirmationText}>
                              Armed · click again within {CONTROL_ARM_WINDOW_MS / 1_000}s to send <code>{disposition.commandText}</code> · {control.effect} · {control.reversibility}
                            </em>
                          )
                          : result
                            ? <em className={`wdogx-note-${result.tone}`}>{result.text}</em>
                            : <em className="wdogx-note-idle">{disposition.live ? disposition.commandText : disposition.blockedReason}</em>}
                    </span>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="healthx-empty">
              <Activity size={18} />
              <strong>Control Registry {UNAVAILABLE}</strong>
              <span>{binding.error ?? 'No canonical control registry has been published.'}</span>
            </div>
          )}
        </section>

        <div className="healthx-filter-actions">
          <span>Observed {timeAgo(observedAt)} · Watchdog owner {readState} · Passive scan every {RESOURCE_SCAN_MS / 1_000}s · Owner read every {WATCHDOG_POLL_MS / 1_000}s · Uptime {reading?.uptimeSec == null ? UNKNOWN : `${Math.round(reading.uptimeSec / 60)} min`}</span>
        </div>
      </section>
    </div>
  );
}
