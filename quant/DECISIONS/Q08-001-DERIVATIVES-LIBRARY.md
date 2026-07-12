# Q08-001 — derivatives, Basis and cross-market library (design record and decisions)

Status: `ACCEPTED_FOR_Q08`

Shard: `q08-derivatives-20260712` from accepted Q06 base `24ccf58`, under director order
D-LAUNCH-5. This note also carries the phase design record because `quant/docs/**` is
read-only for this shard.

## D1 — package boundary and reuse

`quant_edge.derivatives` is a new leaf package. It reuses, read-only and without
duplication: the Q05 rational/series/borrow/outcome contracts, the Q06 fixed-point,
bar, card/registry, value and equivalence laws, and `DeterministicRandom`. The
Q06-frozen `features` package and Q05 `labels` package are never edited; the one
Q05-semantics reimplementation is the six-line NORMAL/REVERSE borrow feasibility truth
table (`borrow.construction_feasibility`), pinned by test to the accepted Q05 law,
because the Q05 function is private to the frozen module.

## D2 — executable versus indicative truth is a type boundary

Executable basis exists only in `executable.py` and only from two-sided sized quotes
(`SizedQuoteV1`) with typed legs (`LegKind`): NORMAL = `(perp_bid - spot_ask) /
spot_ask`, REVERSE = `(spot_bid - perp_ask) / spot_bid`, each construction consuming
exactly its crossed sides and denominators. Indicative reference prices
(LAST_TRADE/MID/MARK/INDEX) live in `references.py` and can never enter an executable
construction — a contract test asserts the executable module names no reference type.
Basis paths (`basis_path.py`) declare the one reference kind their evidence kind can
prove (`TRADE_MID_PROXY -> LAST_TRADE`, `MID -> MID`); MARK/INDEX paths are
unrepresentable until a series kind exists that proves them.

## D3 — unknown never becomes zero (the §20 Q08 acceptance law)

- `CostStackV1` must declare every `CostKind` exactly once with per-component
  knownness; one UNKNOWN component removes the total. Funding carry alone may be
  negative (a credit).
- `BorrowObservationV1` extends the accepted `BorrowAssumptionV1` with inventory,
  interest timing and validity, allowed only under KNOWN_AVAILABLE; KNOWN_AVAILABLE
  additionally REQUIRES an explicit `valid_until_ns` (adversarial-review finding:
  without it, availability truth would outlive its observation and grant REVERSE
  feasibility forever). Expired or pre-observation as-of degrades to UNKNOWN.
- `net_executable_edge` yields a value only when basis AVAILABLE, size SUFFICIENT,
  every cost KNOWN and (REVERSE only) borrow KNOWN_AVAILABLE; every failing
  ingredient is a reason code and nothing is zero-filled.
- Funding features return UNKNOWN/STALE statuses through the frozen `FeatureValueV1`
  law; `time_to_next_funding` refuses to fabricate a default interval.

## D4 — sampled evidence keeps its sampling label

OI (polled) and liquidations (official stream semantics cannot prove completeness)
return `SampledFeatureValueV1` with status vocabulary
AVAILABLE_SAMPLED/STALE/UNKNOWN, structurally unable to claim complete truth; the
liquidation evidence container rejects any quality other than SAMPLED/PARTIAL, counts
are explicitly *observed* lower-bound facts, and a single unknown notional makes the
notional sum UNKNOWN. Under the frozen Q06 quality mapping these sources would erase
to UNKNOWN; carrying the sampling label preserves the evidence without upgrading it.

## D5 — bar features under the frozen harness

Basis bars are emitted in the frozen `BarSeriesV1` shape with aligned value =
fixed-point basis mantissa × 10^26 (exactly `ExactScaledValueV1(mantissa, scale=12)`
under the accepted 10^38 alignment), no volume, and a strictly stronger completeness
law: a bar intersecting a known evidence gap is never complete. Four registered
features (`basis_gap_velocity`, `basis_gap_acceleration`, `basis_sign_persistence`,
`basis_converging_fraction`) carry complete Q06 cards at tolerance 0 ulp and pass the
frozen `run_equivalence` on golden and seeded series. Difference features resume from
the last complete close (the frozen `bar_return` convention); windowed features reset
at incomplete/empty/gapped bars.

## D6 — leg attribution decomposition order

`basis_delta = spot_contribution + perp_contribution` exactly, with the perp leg
evaluated at the current spot price and the spot leg at the previous perp price — a
documented deterministic order (any two-way exact decomposition must pick one).
Drivers: SPOT_LEG/PERP_LEG by strictly larger absolute contribution, BOTH_EQUAL on
exact ties, NONE when nothing moved.

## D7 — state-space and mean-reversion are challengers, not truth

The fixed-gain scalar filter runs the frozen fixed-point recurrence style (bounded
state on any path length; an exact-rational recurrence was rejected because its
denominators grow without bound) and is labeled `REFERENCE_ONLY`. The zero-mean AR(1)
diagnostic is the tested hypothesis, never an assumption: `phi` is an exact rational,
and the discrete half-life is bracketed by exact integer comparison
`2*|num|^k <= den^k` with censoring at 64 steps, NON_MEAN_REVERTING at `|phi| >= 1`
and UNKNOWN below 8 observations or at zero variance.

## D8 — convergence honesty

Half-life estimates carry an explicit `(lower, upper]` bracket between discrete
observations, never a false point estimate; non-convergence is right-censored at
`min(horizon, completeness_end)`; gaps over the interval are DATA_INVALID; a zero
entry gap has no convergence question. `ConvergenceTargetV1` projects observed
durations (upper bracket) and censored durations for the later survival phases,
construction-distinct end to end.

## D9 — lead-lag is evidence only

Lagged signed r-squared (the accepted Q06 exact-rational convention) over lags −4..+4
on shared wall bars; MIN 6 pairs per lag; ties are AMBIGUOUS; halves-based stability;
the report type structurally requires the `EVIDENCE_ONLY` posture note. Granger and
transfer-entropy methods are deferred to the model phases per launch §6 Q-C;
leadership is never called tradable alpha (no cost/latency validation exists here).

## D10 — campaign as the only composition boundary

`quant_edge.derivatives.campaign` is the sole module with filesystem/argv access
(mirroring the `cli.py` convention); every library module is inert. Because
`quant/scripts/**` and `quant/fixtures/**` are read-only for this shard, the golden
fixture lives at `quant/tests/q08/fixtures/` and generated evidence under
`quant/generated/q08/`. Everything is SYNTHETIC, seed `20260712`, byte-deterministic
across CWD/TZ/hash-seed changes.

## Deferred with reasons

- Error-correction/cointegration diagnostics beyond zero-mean AR(1): Q09/Q10
  hypothesis territory; must not be assumed here.
- Granger/transfer-entropy lead-lag challengers: launch §6 Q-C, model phases, with
  multiple-testing control.
- Depth-ladder intended-size feasibility beyond top-of-book sized quotes: requires
  Q04 book integration at merge-back; top-of-book coverage is honest but partial.
- Funding-cap/regime discovery beyond schedule-spacing change: Q09 regime shard.
- Known-gap modeling on OI/liquidation evidence containers: bounded v1; staleness
  and sampled labeling carry the current honesty burden.
- Per-time (rather than per-observation) OI acceleration normalization: sampled
  cadence is not guaranteed uniform; consumers see observation-difference semantics.

## Adversarial review findings corrected before commit

1. `CostStackV1` validated component kinds before the isinstance guard, crashing
   with `AttributeError` on hostile members instead of the contract error (found by
   test, fixed by reordering).
2. KNOWN_AVAILABLE borrow observations without a validity horizon would never
   decay, granting REVERSE feasibility on arbitrarily old truth; validity is now
   mandatory for KNOWN_AVAILABLE (regression test added).
3. The exact-rational fixed-gain filter recurrence had unbounded denominator growth
   on long paths; replaced with the frozen fixed-point recurrence style before any
   test depended on it.
4. Liquidation notional quantization through `ExactRatioV1` could exceed the ratio
   magnitude bound at hostile scales; replaced with direct half-even quantization.
5. Three provably-dead defensive branches (duplicate-registry guard, stack-lookup
   fallback, filter length guard already enforced by the path contract) were
   restructured away per house style; two impossible-by-law `None` checks became
   documented casts.
6. `aligned` price bounds: `BasisPointV1` rejects aligned legs beyond 10^60 so exact
   ratio arithmetic over leg differences stays lawful.
