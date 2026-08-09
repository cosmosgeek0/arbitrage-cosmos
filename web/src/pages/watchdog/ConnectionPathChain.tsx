import { useCallback, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { ArrowLeftRight, Brain, Newspaper, Shield, Wifi } from 'lucide-react';

import type { ProductDependencyEdgeProjection } from '../../lib/productIntegration';
import { StatusChip, rungFromEdgeState } from './StatusChip';
import { ageWord } from './MachineValue';
import type { OwnerFact, WatchmanGroup } from './watchdogEvidence';
import './ConnectionPathChain.css';

/* =============================================================================
   ConnectionPathChain — the page's ONLY topology surface, and the sole renderer
   of `dependencyEdges` at page level.

   THE OPERATOR QUESTION, and there is exactly one: following my own request
   from this browser through to the owner-gated runner, which is the FIRST hop
   that is not proving itself, and which link is carrying the failure?

   The deleted Connection Watchman's single best structural idea was that the
   overview is a NARRATIVE, not a grid (§19 item 2): six fixed hops read as a
   sentence about where the failure is. This restores that and spends its one
   upgrade on the thing the modal never had — the connective tissue between
   hops is now the supervisor's own published dependency edge instead of a
   decorative arrow. `dependencyEdges` was unrendered data (§1.2.j); here it is
   the verb of the sentence.

   ---------------------------------------------------------------- IT DERIVES
   NOTHING. `fact.state` arrives already evidence-gated and continuity-
   downgraded by watchdogEvidence; `fact.statusLabel` is the server's own word;
   `edge.state` and `edge.reasonCodes[]` are the server's own enums. The single
   mapper from a server enum to a rung is StatusChip's `rungFromEdgeState`,
   imported rather than re-written — §3.1 owns the state vocabulary and
   re-implementing a state word anywhere else is wrong by construction.

   ------------------------------------------------------ BIBLE OVER ARCHITECTURE
   The build spec asked hover to drop the other five hops to 14-18% opacity.
   §3.16 forbids it in terms — "No opacity change anywhere... Emphasis PROMOTES
   the doubt path; nothing is ever hidden" — and 0.16 alpha puts a mandatory
   reason far under the ink floor. The bible wins: hover and focus PROMOTE the
   two adjacent wires (`data-path="lit"`) and dim nothing.

   NOTHING MOVES. The six positions come from CONNECTION_PATH_CHAIN_IDS, a
   module constant, laid out on a fixed CSS grid. No data value, hover,
   expansion or 5s poll can reach a position. The promoted wire is out of flow
   and centred, so promoting it shifts no pixel. Spatial memory is the entire
   value of this element.
   ========================================================================== */

/** The parity chain, verbatim (deleted Header.tsx `chainIds`). The order IS the sentence. */
export const CONNECTION_PATH_CHAIN_IDS = [
  'browser-session',
  'engine-supervisor',
  'market-universe',
  'public-usdm-source',
  'binance-account',
  'aws-runner',
] as const;

/* DELETED: `CONNECTION_PATH_SENTENCE_MIN_PX`. The real gate is
   `@container wdcpx (min-width: 1040px)` in ConnectionPathChain.css; the
   constant had no importer and was an unenforced duplicate of that magic
   number, which is worse than the number alone — it looks like the authority
   and is not. The breakpoint lives in the stylesheet that enforces it. */

type LinkProof = 'neutral' | 'unproven' | 'severed' | 'void';
type LinkOrientation = 'CHAIN' | 'UPSTREAM' | 'NONE';

interface ChainHop {
  readonly id: string;
  /** Present only when the owner model carried a fact for this chain id. */
  readonly fact: OwnerFact | null;
  readonly label: string;
  readonly group: WatchmanGroup | null;
  /** The §3.16 fill-ladder key. Mirrors StatusChip's stale demotion, below. */
  readonly surface: string;
  readonly proving: boolean;
}

interface ChainLink {
  readonly fromId: string;
  readonly toId: string;
  readonly fromLabel: string;
  readonly toLabel: string;
  readonly edge: Readonly<ProductDependencyEdgeProjection> | null;
  readonly orientation: LinkOrientation;
  readonly proof: LinkProof;
  readonly contract: 'required' | 'optional' | 'unknown';
}

/* --------------------------------------------------------------- primitives */

/**
 * §3.18 age-format law: ONE unit, INTEGER, max three digits.
 * `<60 -> Ns`, `<100m -> Nm`, `<100h -> Nh`, else `Nd`. Never `1h 04m` — mixed
 * units put the unit glyph at three x positions and the column stops reading
 * as a column.
 *
 * Local, and deliberately so: the house `timeAgo()` in web/src/format.ts calls
 * `Date.now()` at render time — the exact defect pinned by
 * web/test/productControlRoom/dashboard-age-clock.test.mjs — and returns a bare
 * em dash for null, which D37 bans as the most complete form of the lie. This
 * reads the operator clock passed down from the hook and nothing else.
 * MachineValue's `Age` takes a `Fact<number>`; the assessed cut arrives here as
 * a bare timestamp, so this is the same law applied to the other input shape.
 */
/* COLLAPSED AT INTEGRATION (Law 5). This file's own ladder ROUNDED where the
   other three FLOORED, so the same instant could read `1m` in the chain and
   `59s` in the ledger directly beneath it. MachineValue owns the one ladder
   now; rounding up also printed an age the clock had not yet reached, which is
   a value that was not measured (§5 L1). */

/**
 * The head's right rail. Three outcomes, and the third is the one that matters:
 * a cut stamped AHEAD of this browser's clock is not a 0s-old cut, it is a
 * clock-skew finding, and `Math.max(0, ...)` would silently render it as the
 * freshest possible evidence. The comparison threshold is the operator clock's
 * own 1000ms tick — a measured quantity, not a number anyone chose.
 */
function assessedWord(assessedAtMs: number | null, nowMs: number, unreadReason: string | null): string {
  /* NOT "Connecting". That word asserts an in-progress connection, which is a
     claim about the transport nobody here measured — and the reason the cut is
     unread (the provider's own error) exists and was being dropped on the
     floor. `VerdictHeader` gets this right with the word NEVER plus a stated
     reason; this rail now matches it. */
  if (assessedAtMs === null) return unreadReason ?? 'Never assessed · no reason published';
  const elapsed = nowMs - assessedAtMs;
  if (elapsed < -1000) return `Assessed ${ageWord(-elapsed)} AHEAD of this browser clock`;
  return `Assessed ${ageWord(elapsed)} ago`;
}

/** Parity label for an id the owner model never produced a fact for. */
function titleCaseId(id: string): string {
  return id.replaceAll('-', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

/** §7a parity abbreviations, verbatim — the chain has six narrow columns. */
function chainLabel(label: string): string {
  return label.replace('Binance ', '').replace('Browser / Website Session', 'Browser');
}

const GROUP_GLYPH: Readonly<Record<WatchmanGroup, typeof Wifi>> = Object.freeze({
  control_path: Wifi,
  binance: ArrowLeftRight,
  bot: Brain,
  sources: Newspaper,
  infrastructure: Shield,
});

const GROUP_WORD: Readonly<Record<WatchmanGroup, string>> = Object.freeze({
  control_path: 'Control path',
  binance: 'Binance',
  bot: 'Bot runtime',
  sources: 'Source network',
  infrastructure: 'Infrastructure',
});

/** The stated sentence for a chain id the owner model produced no fact for. */
const HOP_UNREAD_SENTENCE =
  'CHAIN_HOP_NOT_IN_OWNER_MODEL — this hop is part of the fixed custody chain, but the '
  + 'owner model carried no fact for it in this cut. It is not unhealthy; it is unread.';

function linkProof(edge: Readonly<ProductDependencyEdgeProjection> | null): LinkProof {
  /* §3.16: DEGRADED wires stay NEUTRAL. A slow channel is a proven channel;
     impairment belongs to the component, which carries its own fill. That
     collapse is what leaves this canvas one hue. */
  if (edge === null) return 'void';
  if (edge.state === 'BLOCKED') return 'severed';
  if (edge.state === 'UNKNOWN') return 'unproven';
  return 'neutral';
}

/* ---------------------------------------------------------------- component */

export function ConnectionPathChain(props: {
  readonly hops: readonly OwnerFact[];
  readonly edges: readonly Readonly<ProductDependencyEdgeProjection>[];
  readonly assessedAtMs: number | null;
  /** NON-NULL whenever `assessedAtMs` is null: why no cut has been assessed. */
  readonly assessedUnreadReason: string | null;
  readonly nowMs: number;
  readonly focusedOwnerId: string | null;
  readonly onFocusOwner: (id: string) => void;
}): JSX.Element {
  const { hops, edges, assessedAtMs, assessedUnreadReason, nowMs, focusedOwnerId, onFocusOwner } = props;

  /* `rovingId` records an explicit keyboard move INSIDE this element only. It
     is not a second copy of `focusedOwnerId` — see tabStopId below. `litId` is
     pure presentation: which path is promoted under a pointer or focus. */
  const [rovingId, setRovingId] = useState<string | null>(null);
  const [litId, setLitId] = useState<string | null>(null);
  const buttons = useRef(new Map<string, HTMLButtonElement>());

  const registerButton = useCallback((id: string, node: HTMLButtonElement | null): void => {
    if (node === null) buttons.current.delete(id);
    else buttons.current.set(id, node);
  }, []);

  /* Resolution is keyed on the module constant, never on the order or the
     length of `hops`. A chain id the owner model did not produce is rendered as
     a stated UNREAD hop, never silently dropped — the deleted modal's
     `.filter(Boolean)` shortened the chain in place, which renders a five-hop
     custody path as if it were the whole path. */
  const chain = useMemo<readonly ChainHop[]>(() => {
    const byId = new Map<string, OwnerFact>();
    for (const fact of hops) if (!byId.has(fact.id)) byId.set(fact.id, fact);
    return CONNECTION_PATH_CHAIN_IDS.map((id) => {
      const fact = byId.get(id) ?? null;
      if (fact === null) {
        return { id, fact: null, label: chainLabel(titleCaseId(id)), group: null, surface: 'UNKNOWN', proving: false };
      }
      /* §3.1's stale rule, mirrored onto §3.16's fill ladder so the node's
         container and the chip inside it can never disagree: a frozen success
         is not a success, so it draws a container like any other doubt. */
      const demoted = fact.stale && fact.state === 'READY';
      return {
        id,
        fact,
        label: chainLabel(fact.label),
        group: fact.group,
        surface: demoted ? 'UNKNOWN' : fact.state,
        proving: fact.state === 'READY' && !fact.stale && !fact.absent,
      };
    });
  }, [hops]);

  const links = useMemo<readonly ChainLink[]>(() => {
    const out: ChainLink[] = [];
    for (let index = 0; index < chain.length - 1; index += 1) {
      const from = chain[index];
      const to = chain[index + 1];
      /* Published edges point DEPENDENCY -> DEPENDENT
         (server/src/systemIntegration/supervisor/topology.ts:71). The custody
         hop is request flow, so a published edge is legitimately allowed to run
         the other way — `public-usdm-source -> market-universe` is exactly that
         case, and it is REAL: it is the only pair in this chain the supervisor
         publishes at all. Reporting NO PUBLISHED EDGE there because the
         orientation did not match would be false absence, which is false green
         inverted. So both orientations are matched, and the one that was found
         is named on screen. */
      const forward = edges.find(
        (edge) => edge.fromComponentId === from.id && edge.toComponentId === to.id,
      ) ?? null;
      const reverse = forward !== null
        ? null
        : edges.find((edge) => edge.fromComponentId === to.id && edge.toComponentId === from.id) ?? null;
      const edge = forward ?? reverse;
      out.push({
        fromId: from.id,
        toId: to.id,
        fromLabel: from.label,
        toLabel: to.label,
        edge,
        orientation: forward !== null ? 'CHAIN' : reverse !== null ? 'UPSTREAM' : 'NONE',
        proof: linkProof(edge),
        contract: edge === null ? 'unknown' : edge.required ? 'required' : 'optional',
      });
    }
    return out;
  }, [chain, edges]);

  const breakIndex = chain.findIndex((hop) => !hop.proving);
  const breakHop = breakIndex < 0 ? null : chain[breakIndex];

  /* The tab stop is DERIVED, so this element holds no duplicate of shell state:
     it follows the ledger when the ledger is on a chain hop, otherwise it lands
     on the break — the one decision this element exists to deliver. Six hops is
     one tab stop, not six (§4.7), and never zero. */
  const inChain = (id: string | null): boolean => id !== null && chain.some((hop) => hop.id === id);
  const tabStopId = (inChain(rovingId) ? rovingId : null)
    ?? (inChain(focusedOwnerId) ? focusedOwnerId : null)
    ?? breakHop?.id
    ?? chain[0].id;

  const onChainKeyDown = useCallback(
    (event: KeyboardEvent<HTMLOListElement>): void => {
      const index = chain.findIndex((hop) => hop.id === tabStopId);
      if (index < 0) return;
      let next = index;
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = Math.min(chain.length - 1, index + 1);
      else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = Math.max(0, index - 1);
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = chain.length - 1;
      else return;
      event.preventDefault();
      const target = chain[next].id;
      setRovingId(target);
      buttons.current.get(target)?.focus();
    },
    [chain, tabStopId],
  );

  return (
    <div className="wdcpx">
      {/* INTEGRATION FIX: the T2 title was deleted from this band. It repeated
          WatchdogSurface's section head, which already prints the ordinal, the
          title, the §3.14 partition and the section's evidence source — two T2
          heads thirty pixels apart is the box-filling this page was rebuilt to
          remove (§4.1). What survives is the sentence that teaches the
          interaction, which the shell cannot know, and the assessed rail below,
          whose third outcome (a cut stamped AHEAD of this browser's clock) is a
          finding the shell's stalest-age figure does not carry. */}
      <header className="wdcpx-head">
        <span className="wdcpx-head-copy">
          <p className="wd-t6">
            Your browser through to the owner-gated runner, read as one sentence. Current evidence
            by owner; activate a hop to open it in the ledger below.
          </p>
        </span>
        {/* §7a parity, item 22: the head's right rail is the cut's own age, or
            the literal word for having no cut yet. Never a dash, never a zero. */}
        <span
          className="wdcpx-assessed wd-t6 wd-num"
          data-connecting={assessedAtMs === null ? 'true' : undefined}
        >
          {assessedWord(assessedAtMs, nowMs, assessedUnreadReason)}
        </span>
      </header>

      {/* THE DECISION. One mark, one sentence, and the mark is hueless (D19/D23)
          so the ladder survives a monochrome screenshot and protanopia. */}
      <p className="wdcpx-verdict wd-t5">
        <i
          className="wdcpx-verdict-mark"
          data-break={breakHop === null ? undefined : 'true'}
          aria-hidden="true"
        />
        {breakHop === null ? (
          <span>
            No break in custody: all {chain.length} hops prove themselves at the assessed cut.
          </span>
        ) : (
          <span>
            First hop not proving itself:{' '}
            <b>{breakHop.label}</b>
            {breakHop.fact === null
              ? ' — its state was never read in this cut.'
              : ` — ${breakHop.fact.statusLabel}.`}
            {breakIndex < chain.length - 1
              ? ` Hops ${breakIndex + 2}–${chain.length} sit downstream of it.`
              : ' It is the last hop in the chain, so nothing is downstream of it.'}
          </span>
        )}
      </p>

      <ol
        className="wdcpx-chain"
        aria-label="Monitored connection path, six hops in custody order"
        onKeyDown={onChainKeyDown}
      >
        {chain.map((hop, index) => {
          const link = index < links.length ? links[index] : null;
          const edge = link === null ? null : link.edge;
          const rootCauseId = edge === null ? null : edge.rootCauseComponentId;
          const isBreak = breakHop !== null && hop.id === breakHop.id;
          const isCurrent = focusedOwnerId === hop.id;
          const lit = litId !== null && link !== null && (link.fromId === litId || link.toId === litId);
          const Glyph = hop.group === null ? Shield : GROUP_GLYPH[hop.group];
          const fact = hop.fact;
          const hopRootCause =
            fact !== null && fact.rootCauseComponentId !== null && fact.rootCauseComponentId !== fact.id
              ? fact.rootCauseComponentId
              : null;

          return (
            <li className="wdcpx-step" key={hop.id}>
              <button
                type="button"
                className="wdcpx-node"
                data-state={hop.surface}
                aria-current={isCurrent ? 'true' : undefined}
                tabIndex={hop.id === tabStopId ? 0 : -1}
                ref={(node) => registerButton(hop.id, node)}
                onClick={() => {
                  /* The tab stop follows the pointer too, so re-entering the
                     chain by keyboard resumes where the operator last acted
                     rather than where they last arrowed. */
                  setRovingId(hop.id);
                  onFocusOwner(hop.id);
                }}
                onPointerEnter={() => setLitId(hop.id)}
                onPointerLeave={() => setLitId((current) => (current === hop.id ? null : current))}
                onFocus={() => setLitId(hop.id)}
                onBlur={() => setLitId((current) => (current === hop.id ? null : current))}
              >
                <i className="wdcpx-node-mark" data-break={isBreak ? 'true' : undefined} aria-hidden="true" />
                <span className="wdcpx-glyph" aria-hidden="true"><Glyph size={12} /></span>
                <span className="wdcpx-node-body">
                  <span className="wdcpx-node-name wd-t4">
                    <span className="wdcpx-ordinal wd-t6" aria-hidden="true">{index + 1}</span>
                    {hop.label}
                  </span>

                  {fact === null ? (
                    /* Not a shrug and not an em dash: the chain id is named, the
                       reason code is real DOM text, and the state is UNKNOWN —
                       which is not the same claim as unhealthy. */
                    <StatusChip state="UNKNOWN" reason={HOP_UNREAD_SENTENCE} />
                  ) : (
                    <StatusChip
                      state={fact.state}
                      stale={fact.stale}
                      label={fact.statusLabel}
                      reason={fact.reason}
                    />
                  )}

                  {/* §7a node anatomy, restored verbatim: value + detail. Both
                      strings are composed once, in watchdogEvidence, from the
                      server's own owner / lifecycle / capability / truth /
                      blocker fields. Nothing is re-derived here, and nothing is
                      dropped: an absent component's `detail` is already the full
                      stated sentence for its absence. */}
                  {fact === null ? null : (
                    <span className="wdcpx-warrant">
                      <b className="wd-t4">{fact.value}</b>
                      <span className="wd-t6 wdcpx-detail">{fact.detail}</span>
                    </span>
                  )}

                  <span className="sr-only">
                    {hop.group === null ? '' : `${GROUP_WORD[hop.group]}. `}
                    {isBreak ? 'First hop not proving itself. ' : ''}
                    Hop {index + 1} of {chain.length}. Activate to focus and expand this owner in
                    the ledger.
                  </span>
                </span>
              </button>

              {/* The component's own root cause is a real control, exactly as it
                  is everywhere else on this page: it focuses and expands that
                  owner's row. Outside the node button so it is not a nested
                  interactive element. */}
              {hopRootCause === null ? null : (
                <p className="wdcpx-root-line wd-t6">
                  <span className="wdcpx-warrant-key">Root cause</span>
                  <button
                    type="button"
                    className="wdcpx-root wd-id"
                    onClick={() => onFocusOwner(hopRootCause)}
                  >
                    <b>{hopRootCause}</b>
                    <span className="sr-only"> — focus and expand this owner in the ledger</span>
                  </button>
                </p>
              )}

              {link === null ? null : (
                <div
                  className="wdcpx-link"
                  data-contract={link.contract}
                  data-proof={link.proof}
                  data-path={lit ? 'lit' : undefined}
                >
                  <span className="wdcpx-wire" aria-hidden="true" />
                  <div className="wdcpx-link-copy">
                    <p className="wdcpx-link-pair wd-t6">
                      {link.fromLabel}
                      <span aria-hidden="true"> → </span>
                      <span className="sr-only"> to </span>
                      {link.toLabel}
                    </p>

                    {edge === null ? (
                      /* An edge with no evidence is neither healthy nor broken.
                         Drawing it as a plain healthy line is the false-green
                         defect in graph form, so it renders in the unknown
                         treatment with its absence stated as a sentence. */
                      <StatusChip
                        state="UNKNOWN"
                        reason={(
                          <>
                            <span className="wd-id"><b>NO PUBLISHED EDGE</b></span>{' '}
                            The supervisor publishes no dependency edge between these two
                            components, in either direction. This link is not proven and not
                            broken — it is unmeasured, and nothing here can tell you whether the
                            hop above reaches the hop below.
                          </>
                        )}
                      />
                    ) : (
                      <>
                        <StatusChip
                          state={rungFromEdgeState(edge.state)}
                          label={edge.state}
                          reason={(
                            <>
                              {link.contract === 'required'
                                ? 'Required dependency.'
                                : 'Optional dependency — the supervisor keeps its degradation without failing the dependent.'}
                              {link.orientation === 'CHAIN' ? (
                                <>
                                  {' Published as '}
                                  <span className="wd-id"><b>{edge.fromComponentId}</b></span>
                                  {' → '}
                                  <span className="wd-id"><b>{edge.toComponentId}</b></span>.
                                </>
                              ) : (
                                <>
                                  {' Published in the opposite direction: '}
                                  <span className="wd-id"><b>{edge.fromComponentId}</b></span>
                                  {' → '}
                                  <span className="wd-id"><b>{edge.toComponentId}</b></span>
                                  {'. The custody hop reads '}
                                  {link.fromLabel}
                                  {' then '}
                                  {link.toLabel}
                                  {'; the supervisor’s dependency runs the other way.'}
                                </>
                              )}
                            </>
                          )}
                        />

                        {edge.reasonCodes.length > 0 ? (
                          <ul className="wdcpx-codes">
                            {edge.reasonCodes.map((code) => (
                              <li className="wd-id wd-t6" key={code}><b>{code}</b></li>
                            ))}
                          </ul>
                        ) : edge.state === 'AVAILABLE' ? null : (
                          /* A measured empty set is a complete answer (§3.12) —
                             but an ADVERSE edge with no reason code is a hole in
                             the evidence, and it says so. */
                          <p className="wd-t6 wd-nodata">NO REASON CODE PUBLISHED</p>
                        )}

                        {rootCauseId === null ? null : (
                          <p className="wdcpx-root-line wd-t6">
                            <span className="wdcpx-warrant-key">Link root cause</span>
                            <button
                              type="button"
                              className="wdcpx-root wd-id"
                              onClick={() => onFocusOwner(rootCauseId)}
                            >
                              <b>{rootCauseId}</b>
                              <span className="sr-only"> — focus and expand this owner in the ledger</span>
                            </button>
                          </p>
                        )}
                      </>
                    )}
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
