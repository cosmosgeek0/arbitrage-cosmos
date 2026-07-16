# Q07 — microstructure and liquidity library design

Status: implemented in `quant_edge.micro`; all evidence `SYNTHETIC`.

Q07 delivers the §13.1 microstructure/liquidity families as a pure deterministic
library over the evidence shapes the lane honestly holds. No network, environment,
clock, storage or authority exists anywhere in the package; no feature is claimed
predictive, validated or economically valuable.

## Input contracts (`inputs.py`)

- `TopOfBookPointV1` — one L1 observation (Binance bookTicker shape): bid/ask price and
  size as `ExactScaledValueV1`, strictly positive, never crossed
  (`bid_price <= ask_price` enforced at construction). `mid_aligned_x2` carries twice
  the mid exactly so no halving ever rounds.
- `TradePointV1` — one maker-flagged trade (aggTrades shape); `taker_is_buyer` is the
  exchange truth `not is_buyer_maker`, never inferred from prices.
- `LadderSnapshotV1`/`LadderLevelV1` — book-view ladders: bids strictly descending,
  asks strictly ascending, positive aligned prices/sizes, never crossed or locked;
  `ladder_from_book_view` adapts aligned `(price, size)` pairs (the Q04 book-view
  shape). Empty sides are honest truth (`mid_aligned_x2` is then `None`).
- Series containers (`TopOfBookSeriesV1`, `TradeSeriesV1`, `LadderSeriesV1`) are
  bounded (`MAX_ITEMS` 100 000), time-ordered with strictly increasing ordinals, and
  carry only `SYNTHETIC`/`REPLAY` posture — Q07 owns no live market evidence.
- `join_trades_with_quotes` — deterministic as-of join: each trade receives the last
  quote at or before its event time; a trade before the first quote has `prevailing =
  None`, honestly, and every consumer treats that as UNKNOWN, never as zero.

## Equivalence and cost discipline (`equivalence.py`)

`MicroFeatureImplementationV1[ItemT]` binds a complete Q06 `FeatureCardV1`, a batch
reference over item prefixes, a streaming factory and `declared_max_update_ops`.
`run_micro_equivalence` replays every prefix through the batch reference and compares
against the streamed vector:

- a value/None disagreement is a status mismatch and fails the report;
- value disagreement is measured in integer ulps against the card's declared tolerance
  (every Q07 card declares `0`: agreement must be exact);
- `last_update_ops` is a deterministic elementary-operation count (never wall time);
  the observed maximum must stay within the declared bound;
- the streamed vector is digest-bound (`micro_vector_digest`) for golden pinning.

`MicroEquivalenceReportV1.passed` must equal the measured truth by construction — the
report contract cannot claim success that was not measured.

## L1 family (`l1.py`)

- `ofi_l1:v1` — Cont/Kukanov/Stoikov e_n law per best-quote transition (bid additions
  at or above the previous bid, departures at or below; mirrored on asks), rolling sum
  over the last 16 transitions. Sign law: with prices pinned, OFI is exactly the bid
  size change minus the ask size change.
- `l1_queue_imbalance:v1` — `(Qb - Qa) / (Qb + Qa)`, exact, bounded in `[-1, 1]`.
- `microprice_displacement:v1` — exact rational
  `(2*(Pb*Qa + Pa*Qb) - mid2*Qtot) / (mid2*Qtot)`, quantized once at the end.

`fp_from_aligned` / `fp_from_fraction` are the only quantization gates: aligned 10^38
integers or exact fractions to fixed-point 10^-12 mantissas with half-even rounding.

## Book family (`bookfeat.py`)

All book features read the top `BAND_LEVELS = 5` levels.

- `band_flow:v1` — delta of bid-band depth minus delta of ask-band depth between
  consecutive snapshots; documented as snapshot-differenced flow, not event-level OFI.
- `cumulative_band_imbalance:v1` — `(B5 - A5) / (B5 + A5)`; empty bands are UNKNOWN.
- `book_slope_imbalance:v1` — exact-rational OLS slope of cumulative depth on doubled
  distance from mid per side; strict ladder ordering makes both OLS denominators and
  both slopes strictly positive, so the slope imbalance `(sb - sa)/(sb + sa)` is total.
  Fewer than two levels on either side, or a missing mid, is UNKNOWN.
- `depth_resiliency:v1` — a bid-band drop to <= 1/2 of the previous depth opens an
  event; recovery to >= 9/10 of the pre-depletion depth within 4 snapshots counts as
  replenished; the value is the recovered fraction over the last 8 closed events.
  Bounded pending set keeps the update cost within `BAND_LEVELS + 4` operations.
- `vwap_spread_at_size:v1` — walk both ladders for the versioned intended size (10 size
  units at alignment scale); the relative spread of the two executable VWAPs, exact;
  insufficient depth is UNKNOWN, never a partial fill pretending to be full.

## Flow family (`flow.py`)

All trade features run over the last `FLOW_WINDOW = 16` joined trades.

- `signed_trade_imbalance:v1` — signed/total taker volume using exchange maker flags.
- `trade_intensity:v1` — `(n - 1) / span` trades per second; zero span or a single
  trade is UNKNOWN.
- `trade_dispersion:v1` — index of dispersion (variance/mean, no square roots) of
  inter-arrival times, exact-rationally in seconds; perfectly regular arrivals score
  exactly zero; fewer than three trades or zero mean inter-arrival is UNKNOWN.
- `size_concentration_hhi:v1` — `sum(size^2) / total^2`, in `(0, 1]`.
- `effective_spread:v1` — `2*|price - mid| / mid` against the prevailing quote,
  computed in doubled-mid space to stay exact; no prevailing quote is UNKNOWN.
- `kyle_slope:v1` — exact-rational OLS slope of doubled-mid change on signed size over
  quote-bearing trades; quote-less trades leave the pair set unchanged in both batch
  and streaming; fewer than three pairs or zero flow variance is UNKNOWN.
- `absorption_ratio:v1` — `volume / (volume + 100*|mid drift|)` over the window; the
  response weight 100 is a versioned v1 parameter recorded on the card; fewer than two
  observed mids is UNKNOWN.
- `amihud_illiquidity:v1` — mean `|close move| / (previous close * volume)` over the
  last 16 valid complete bars (Q06 `BarV1`); incomplete and empty bars are skipped
  fully; zero/unknown volume moves the reference close without fabricating a value.

## §13.1 dispositions (`families.py`)

Every §13.1 bullet carries exactly one `FamilyRecordV1` with a machine-checkable law:
implemented features exist exactly for `ADOPT`/`ADAPT` records. 17 records: 8 ADOPT,
5 ADAPT (each naming what is deferred and why), 1 `BLOCKED_DATA` (cancellation/addition
intensity — public diff-depth and snapshots cannot separate cancellations from
executions; recorded, never faked) and 3 `REFERENCE_ONLY` (wall persistence, failed
moves, adverse selection — each naming the definition or join it waits for). The table
is digest-bound (`disposition_table_digest`). `spoof_pattern_semantics()` fixes the
only lawful wording: public evidence can describe `possible_spoof_like_pattern`, never
individual intent.

## Campaign evidence

`scripts/q07_micro_campaign.py` writes the golden fixture (registry of all 16 cards,
16 passing golden equivalence reports, the disposition table with digest and the spoof
semantics) and hash-bound campaign artifacts, byte-deterministically across processes,
timezones and hash seeds. Ten seeded scenarios (`DeterministicRandom`, seed 20260712)
sweep randomized quotes/ladders/trades/bars; measured max ulp deviation is 0 for every
feature and measured update costs stay within declared bounds. Host wall-time
measurements print to stdout as environment-specific evidence only — they never enter
artifacts and no test asserts them.

## Honesty constraints

- Missing evidence is UNKNOWN (`None`), never zero, never carried forward.
- No float exists in any public numeric contract; every quantization is one half-even
  rounding at a documented gate.
- No cancellation/execution decomposition is inferred from diff-depth; no spoofing
  intent is ever attributed; no predictive or economic claim exists anywhere.
- The lane still holds no persisted real market rows; every Q07 proof is synthetic.
