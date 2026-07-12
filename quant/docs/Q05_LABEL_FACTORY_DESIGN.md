# Q05 label-factory design and honest data posture

Authored 2026-07-12 with the Q05 implementation. This note records every versioned
definition the factory ships, every rule derived beyond the directive's literal text,
and the lane's honest data reality. Nothing here claims edge, probability semantics or
economic truth.

## Honest data reality

The lane holds no persisted real market rows: the accepted Q03 bounded archive sample
was imported, validated and disposed, retaining hashes and counts only, and real forward
delivery remains `MISSING/BLOCKED`. Every executable Q05 proof therefore runs on
`SYNTHETIC` fixture evidence (with `REPLAY` reserved for future replayed evidence), and
real-data label coverage is `DATA_INSUFFICIENT` across the board. Q05 delivers the
machinery and its proofs, not populated labels.

## Versioned definitions shipped as v1

- **Outcome definition** (`OutcomeDefinitionV1`): last-at-or-before reference price with
  an explicit staleness bound; the §11.2 horizon grid `1s/5s/15s/30s/60s/5m/15m/1h`;
  horizons beyond a sample's label interval are `UNAVAILABLE`.
- **Barrier spec** (`BarrierSpecV1`): explicit signed rational barriers. Volatility or
  liquidity adjustment is a caller-supplied input, not computed here (features are Q06+).
- **Cost scenarios** (`CostScenarioV1`): additive round-trip cost ratio plus a
  submission latency; `net = gross(delayed entry) - cost` and
  `opportunity decay = gross(immediate) - gross(delayed)`. The additive model is a
  documented v1 simplification.
- **Stage definition** (`StageDefinitionV1`): dormant ceiling, ignition growth ratio,
  continuation floor and fade ceiling over baseline-relative activity ratios, with
  documented precedence (disorder → incomplete → dormant → no-event → ignition →
  early-expansion → fade → unwind → continuation → exhaustion). These are discovery
  descriptors, never truth; there is no relabeling API.
- **Basis definition** (`BasisDefinitionV1`): partial/full convergence as fractions of
  the absolute entry basis; right-censoring at label end or completeness end; funding
  summed over schedule events inside the holding window (entry to full convergence or
  censor), signed by construction.
- **Control match spec** (`ControlMatchSpecV1`): same symbol and regime id, row-count
  liquidity buckets, range-ratio volatility buckets, time-of-day buckets and
  UTC-anchored funding-cycle buckets, completeness required, and hard non-overlap with
  the candidate's `[feature lookback, label end]` interval; deterministic window-id
  ordering with a bounded selection.

## Rules derived beyond the quoted directive text

1. A candidate window with no operational record is `MISSED` (definition v1): nothing
   acted on or rejected it during its lifetime. `ACTED`/`REJECTED`/`EXPIRED` exist only
   through an explicit operational assertion; the factory never invents them, and
   control windows cannot carry assertions.
2. The §11.5 quality law overrides everything: any gap, duplicate or unknown
   completeness is `DATA_INVALID` regardless of assertions.
3. A gap-free, complete label window with no observations carries the reference forward
   (an unchanged-value proxy for trade evidence) with zero excursions; this proxy is a
   documented property of trade-derived series, not venue truth.
4. First-passage non-passage is right-censored at the label end (complete evidence) or
   the completeness end (incomplete evidence); passage checks stop at that boundary.
5. Quote mid returns are computed on the bid+ask sum, which is proportional to the mid,
   keeping the arithmetic exact without dividing by two.
6. Executable capacity and depth-deterioration outcomes are typed contracts pinned to
   `UNAVAILABLE`: they require depth evidence the lane does not hold.
7. All numeric outcomes are exact rationals over 10^38-aligned integers; the rational
   magnitude bound (10^60) is a bounded-resource law — pathological synthetic values
   fail closed with a contract error rather than rounding.
8. Evaluation groups merge same-symbol windows whose intervals touch within an explicit
   adjacency gap; group identity is the hash of the member window-id set.
9. The Q-E linkage exposes `owner=quantEdgeLabels`, the derived outcome id, its content
   SHA-256 and an explicit availability time — exactly the fields the accepted
   `OwnerAnnotationOutcomeLinkV1` contract requires. Labels never gain annotation
   authority.

## What §11 requires that remains honestly unpopulated

- Sector-residual returns require a caller-supplied market/sector series; without one
  the residual is `UNAVAILABLE`.
- Executable bid/ask outcomes require two-sided quote evidence; trade-mid series yield
  `UNAVAILABLE` spreads.
- Basis labels on real dual-leg evidence, real funding schedules and real borrow truth
  do not exist yet; the machinery is proven on synthetic legs and explicit assumptions,
  and reverse-basis feasibility stays `UNKNOWN` without borrow knownness.
- Owner annotations and objective-outcome links exist as contracts and a proven fixture
  path; no real annotation record exists.
