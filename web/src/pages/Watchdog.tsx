import { useEffect, useMemo, useRef, useState } from 'react';
import { Activity, ShieldCheck } from 'lucide-react';
import { useProductControlRoomContext } from '../features/productControlRoom/ProductControlRoomProvider';
import { useStore } from '../store';
import { timeAgo } from '../format';
import { apiErrorMessage, fetchJson } from '../lib/http';
import { createSettledPoll } from '../lib/polling';
import type {
  ProductComponentProjection,
  ProductDependencyEdgeProjection,
  ProductWatchmanStatus,
} from '../lib/productIntegration';
import './Health.css';
import './Watchdog.css';

// Watchdog is the dedicated connections/lag observatory. It is view-only: the
// page mounts exactly two observers — one bounded 5s read of the server
// watchdog owner, and a passive 2s scan of this tab's own resource-timing
// buffer. It never mutates, never recovers, and never claims a fact it has not
// read. Anything unread renders UNKNOWN/UNAVAILABLE rather than a guess.

const WATCHDOG_ENDPOINT = '/api/watchdog';
const WATCHDOG_POLL_MS = 5_000;
const RESOURCE_SCAN_MS = 2_000;
/** Shared browser fetch fuse (lib/http default request lifetime). */
const TRANSPORT_FUSE_MS = 10_000;
const TRANSPORT_ALERT_MS = 8_000;
const LANE_SAMPLE_LIMIT = 20;

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
  staleServedCount: number | null;
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
  return Object.freeze({
    observedAtMs,
    loopCurrentMs: nonNegative(loop.currentMs),
    loopP95Ms: nonNegative(loop.p95Ms),
    loopMaxMs: nonNegative(loop.maxMs),
    buildDurationMs: nonNegative(build.lastBuildDurationMs),
    buildAtMs: nonNegative(build.lastBuildAtMs),
    buildInFlight: boolOrNull(build.inFlight),
    staleServedCount: nonNegative(build.staleServedCount),
  });
}

// ---- passive browser transport (RUM) ------------------------------------

type LaneId =
  | 'supervisor' | 'events' | 'state' | 'engine-basis'
  | 'engine-volume' | 'markets' | 'calendar' | 'watchdog';

type LaneSample = Readonly<{
  durationMs: number;
  transferSize: number | null;
  decodedBodySize: number | null;
}>;

// First match wins, so the two product-integration lanes are listed before the
// generic prefixes they share.
const LANES: readonly Readonly<{ id: LaneId; label: string; prefix: string }>[] = Object.freeze([
  { id: 'supervisor', label: 'Supervisor', prefix: '/api/product-integration/v1/supervisor' },
  { id: 'events', label: 'Material Events', prefix: '/api/product-integration/v1/material-events' },
  { id: 'state', label: 'State', prefix: '/api/state' },
  { id: 'engine-basis', label: 'Engine · Basis', prefix: '/api/engine/basis' },
  { id: 'engine-volume', label: 'Engine · Volume', prefix: '/api/engine/volume' },
  { id: 'markets', label: 'Markets', prefix: '/api/markets' },
  { id: 'calendar', label: 'Calendar', prefix: '/api/calendar' },
  { id: 'watchdog', label: 'Watchdog', prefix: WATCHDOG_ENDPOINT },
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
 * the page reads measurements the browser already recorded.
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
 * envelope always draws the same picture. A dependency cycle cannot extend the
 * layering past the component count, so relaxation is bounded by it.
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

function nodeX(layer: number): number {
  return GRAPH_PAD + layer * (NODE_WIDTH + LAYER_GAP);
}

function nodeY(row: number): number {
  return GRAPH_PAD + row * (NODE_HEIGHT + ROW_GAP);
}

function ConnectionFabricGraph({
  nodes,
  edges,
}: Readonly<{
  nodes: readonly FabricNode[];
  edges: readonly Readonly<ProductDependencyEdgeProjection>[];
}>) {
  const placed = new Map(nodes.map((node) => [node.id, node]));
  const width = nodeX(Math.max(0, ...nodes.map((node) => node.layer))) + NODE_WIDTH + GRAPH_PAD;
  const height = nodeY(Math.max(0, ...nodes.map((node) => node.row))) + NODE_HEIGHT + GRAPH_PAD;
  return (
    <svg
      className="wdogx-fabric-svg"
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      role="img"
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
          return (
            <path
              key={`${edge.fromComponentId}->${edge.toComponentId}`}
              className={`wdogx-edge state-${edge.state.toLowerCase()}${edge.required ? '' : ' optional'}`}
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
        {nodes.map((node) => (
          <g key={node.id} className={`wdogx-node tone-${node.tone}`}>
            <rect
              x={nodeX(node.layer)}
              y={nodeY(node.row)}
              width={NODE_WIDTH}
              height={NODE_HEIGHT}
              rx={8}
              ry={8}
            >
              <title>{node.detail}</title>
            </rect>
            <text x={nodeX(node.layer) + 12} y={nodeY(node.row) + 17} className="wdogx-node-label">{node.label}</text>
            <text x={nodeX(node.layer) + 12} y={nodeY(node.row) + 30} className="wdogx-node-status">{node.statusLabel}</text>
          </g>
        ))}
      </g>
    </svg>
  );
}

// ---- sparkline -----------------------------------------------------------

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
  const cursorRef = useRef(0);
  const lanesRef = useRef<LaneBuffer>(EMPTY_LANES);

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
          setSampleCount((count) => count + collected.added);
        }
      }
      setObservedAt(Date.now());
    };
    scan();
    const timer = window.setInterval(scan, RESOURCE_SCAN_MS);
    return () => window.clearInterval(timer);
  }, []);

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
  const healthEvidence = snapshot?.surfaces.health.evidence ?? [];
  const ledgerWritability = healthEvidence.find((datum) => datum.fieldId === 'db-ledger');
  const bootRelease = snapshot?.bootReleaseReadback ?? null;
  const bootSha = bootRelease?.latest?.deployedCommit ?? bootRelease?.latest?.testedCommit ?? null;

  const fabricNodes = useMemo(
    () => (snapshot ? layerDependencyGraph(snapshot.components, snapshot.dependencyEdges) : []),
    [snapshot],
  );

  const controls = snapshot?.controls ?? [];

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
            <span className="healthx-access">
              <ShieldCheck size={14} />
              Observe Only
            </span>
          </div>
        </header>

        <div className="healthx-summary" aria-label="Watchdog Metric Quad">
          <div className="healthx-summary-cell">
            <span>Server Loop Lag</span>
            <strong className={reading === null ? 'not_configured' : undefined}>
              {reading === null ? (readState === 'LOADING' ? 'READING' : UNAVAILABLE) : msLabel(reading.loopCurrentMs)}
            </strong>
            <small>
              {reading === null
                ? readError ?? `${WATCHDOG_ENDPOINT} not read yet`
                : `p95 ${msLabel(reading.loopP95Ms)} · max ${msLabel(reading.loopMaxMs)}`}
            </small>
          </div>
          <div className="healthx-summary-cell">
            <span>Envelope Build</span>
            <strong className={reading === null ? 'not_configured' : undefined}>
              {reading === null ? (readState === 'LOADING' ? 'READING' : UNAVAILABLE) : msLabel(reading.buildDurationMs)}
            </strong>
            <small>
              {reading === null
                ? `Build telemetry unavailable from ${WATCHDOG_ENDPOINT}`
                : `Built ${reading.buildAtMs === null ? UNKNOWN : timeAgo(reading.buildAtMs)} · In flight ${reading.buildInFlight === null ? UNKNOWN : reading.buildInFlight ? 'YES' : 'NO'} · Stale served ${reading.staleServedCount === null ? UNKNOWN : reading.staleServedCount}`}
            </small>
          </div>
          <div className="healthx-summary-cell">
            <span>Browser Transport</span>
            <strong className={stateLane.lastMs === null ? 'not_configured' : stateLane.lastMs >= TRANSPORT_ALERT_MS ? 'broken' : undefined}>
              {stateLane.lastMs === null ? UNKNOWN : msLabel(stateLane.lastMs)}
            </strong>
            <small>
              State lane · Supervisor {supervisorLane.lastMs === null ? UNKNOWN : msLabel(supervisorLane.lastMs)} · {sampleCount} samples this visit
            </small>
          </div>
          <div className="healthx-summary-cell">
            <span>Delivery Channel</span>
            <strong className={connected ? 'healthy' : 'broken'}>{connected ? 'SOCKET LIVE' : 'SOCKET OFFLINE'}</strong>
            <small>
              Continuity {binding.continuity} · Material {materialEvents?.continuity ?? UNKNOWN} · Last delta {latestEvent === null ? UNKNOWN : timeAgo(latestEvent.occurredAtMs)}
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
            <span><b>Connection Fabric</b><em>Canonical components layered left to right by published dependency depth</em></span>
            <strong>
              {snapshot
                ? `${fabricNodes.length} components · ${snapshot.dependencyEdges.length} edges · Binding ${binding.continuity}`
                : UNAVAILABLE}
            </strong>
          </div>
          {snapshot && fabricNodes.length > 0 ? (
            <div className="wdogx-fabric-scroll" role="region" aria-label="Dependency Fabric" tabIndex={0}>
              <ConnectionFabricGraph nodes={fabricNodes} edges={snapshot.dependencyEdges} />
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
            <span><b>Browser Transport</b><em>Passive resource-timing read of this tab · no request is issued by this table</em></span>
            <strong>{sampleCount} samples · last {LANE_SAMPLE_LIMIT} per lane · buffer resets on navigation</strong>
          </div>
          <div className="wdogx-table" role="table" aria-label="Browser Transport Lanes" aria-colcount={7}>
            <div className="wdogx-table-head" role="row">
              <span role="columnheader">Lane</span>
              <span role="columnheader">Last</span>
              <span role="columnheader">Median</span>
              <span role="columnheader">Max</span>
              <span role="columnheader">Wire</span>
              <span role="columnheader">Fuse Margin</span>
              <span role="columnheader">Last {LANE_SAMPLE_LIMIT}</span>
            </div>
            {laneRows.map((lane) => (
              <div className="wdogx-table-row" role="row" key={lane.id}>
                <span role="cell" className="wdogx-lane">
                  <strong>{lane.label}</strong>
                  <small>{lane.prefix}</small>
                </span>
                <span role="cell" className={`wdogx-num${lane.lastMs !== null && lane.lastMs > TRANSPORT_ALERT_MS ? ' alarm' : ''}`}>
                  {lane.lastMs === null ? UNKNOWN : msLabel(lane.lastMs)}
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
              </div>
            ))}
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
              <strong className={marketStatus === 'CURRENT' ? 'healthy' : marketStatus === 'UNAVAILABLE' ? 'broken' : 'degraded'}>{marketStatus}</strong>
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
              <span>Material Continuity</span>
              <strong>{materialEvents?.continuity ?? UNAVAILABLE}</strong>
              <small>
                {materialEvents === null
                  ? 'No material-event page published.'
                  : `High water ${materialEvents.highWaterCursor} · ${materialEvents.items.length} items · ${materialEvents.hasMore ? 'MORE PENDING' : 'TERMINAL'}`}
              </small>
            </div>
          </div>
        </section>

        <section className="wdogx-card" aria-label="Engine Compute">
          <div className="wdogx-card-head">
            <span><b>Engine Compute</b><em>Canonical control registry mirrored read-only · no handler is mounted on this page</em></span>
            <strong>{snapshot ? `${controls.length} controls` : UNAVAILABLE}</strong>
          </div>
          {controls.length > 0 ? (
            <div className="wdogx-controls">
              {controls.map((control) => {
                const enumeration = control.payloadEnumeration.map((option) => String(option));
                const effective = control.currentEffectiveValue.trim();
                const binary = enumeration.length === 2 ? enumeration : null;
                const engaged = binary === null ? null : effective === binary[1] ? true : effective === binary[0] ? false : null;
                return (
                  <article className="wdogx-control" key={control.controlId}>
                    <span className="wdogx-control-copy">
                      <b>{control.label}</b>
                      <em>{control.group} · {control.owner}</em>
                      <code>{control.controlId}</code>
                    </span>
                    <span className="wdogx-control-value">
                      <b>{effective || UNKNOWN}</b>
                      <em>{control.currentDesiredValue.trim() === effective ? 'Desired matches effective' : `Desired ${control.currentDesiredValue.trim() || UNKNOWN}`}</em>
                    </span>
                    <span className={`wdogx-switch${engaged === true ? ' on' : engaged === false ? ' off' : ' unknown'}`} role="img" aria-label={`${control.label} ${engaged === null ? UNKNOWN : engaged ? 'engaged' : 'released'} (observe only)`}>
                      <i />
                    </span>
                    <em className={`wdogx-chip ${control.wiringState === 'WIRED_LIVE' ? 'ok' : 'idle'}`}>{control.wiringState}</em>
                    <em className="wdogx-chip observe">OBSERVE-ONLY</em>
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
          <span>Observed {timeAgo(observedAt)} · Watchdog owner {readState} · Passive scan every {RESOURCE_SCAN_MS / 1_000}s · Owner read every {WATCHDOG_POLL_MS / 1_000}s</span>
        </div>
      </section>
    </div>
  );
}
