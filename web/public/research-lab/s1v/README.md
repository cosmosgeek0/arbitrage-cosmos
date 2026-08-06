# S-1V — USD-M funding-dispersion transition

S-1V is one sealed Binance-public-only experiment. It tests whether a
cross-sectional funding-rate dispersion expansion immediately after a
compressed regime contains a short-horizon relative-price signal. It is
distinct from S-1C through S-1U: its signal is the transition in dispersion and
its portfolio is built from same-sign, interval-stable funding innovations.

## Frozen design

- June 2025 is a two-stage screen, not an outcome period.
- Candidate USD-M symbols must have checksum-valid June `fundingRate`,
  `klines/1h`, and `markPriceKlines/1h` archives.
- Both kline kinds must contain exactly the full 720 UTC hourly opens.
- `universe.v1.json` freezes the full screen-attempt ledger, exactly one row per
  stage-one candidate in ASCII-symbol order. Every row records its exact screen
  `archive_member_open_count`, `reason_code`, and `SUCCESS` or
  `INVALID_EVIDENCE` status. A success has `reason_code: null` and records the
  June contract-quote-volume sum plus all six June ZIP and sidecar digests; an
  invalid row has a stable first-failure code in `reason_code`.
- Top-level screen archive-member opens equal the sum of the per-attempt counts,
  and `candidate_count` equals the number of successful rows. Rank every
  successful row by June contract quote-volume sum descending, then ASCII
  symbol, and mechanically project the first 30 into `screen_rows` and
  `selected_symbols`; fewer is `SCREEN_INVALID/UNMEASURED`. This ledger proves
  both invalid and valid-but-unselected exclusions and reconciles every June
  member open.
- Development is `2025-07-01` through `2026-04-01`.
- `2026-04-01` through `2026-04-08` is an embargo. If development passes,
  embargo rows may update lagged state but are never scored.
- The sealed holdout is `2026-04-08` through `2026-07-01`.
- The complete selected source set is 30 symbols × 3 kinds × 13 months =
  1,170 ZIP/sidecar pairs. Any missing or corrupt selected object invalidates
  evidence; it does not permit a replacement symbol.
- The sole acquisition state is
  `LOCAL_OFFICIAL_ARCHIVE_REUSE_CHECKSUM_VERIFIED`: clone or copy the
  pre-existing official Binance public archive cache into the packet-owned
  `/private/tmp` source root, hash every ZIP and adjacent official `.CHECKSUM`,
  and verify each ZIP against its sidecar.
- The experiment engine is network-free. It performs no fresh public download
  and observes no S-1V HTTP response; manifest `http_status` is `null`.
  `source_url` retains only the official origin path.
- Binance may have revised the remote archive. The frozen, locally reused,
  checksum-verified bytes are the evaluated evidence; S-1V makes no current
  HTTP-200 or current-remote-equality claim.
- The pre-development manifest hashes every selected ZIP and sidecar and
  verifies each ZIP digest against its sidecar, but does not open post-screen
  archive members. The screen validates June. Only after the development
  `O_EXCL` run marker does the engine validate and stitch June-through-March.
  April-through-June members stay unopened unless
  every development gate passes, the champion seal is written, and the
  `holdout_open` marker is created; only then may it validate and stitch
  March-through-June.
- Each opened funding CSV must be nonempty. Its first and last rows must be
  within `1.5 × reported interval + 1,000 ms` of the UTC month boundaries.
  Within each permitted phase, the stitched sequence is strictly increasing
  and unique, and every adjacent gap, including month boundaries, is at most
  `1.5 × max(adjacent intervals) + 1,000 ms`.

The screen marker is created with exclusive-create semantics before any screen
member is opened. The run marker is likewise created before any development
archive member is opened. The candidate seal and `holdout_open` marker must
exist before any holdout member is opened. All markers are one-use. There is no
repair, deletion, or rerun.

## Causal signal

At each UTC hour `h`, use only funding rows whose millisecond `calc_time` is
strictly earlier than `h`. Evaluate the hour only when at least one selected
member's latest eligible row changed since `h-1h`; duplicate snapshots do not
become extra observations. Thus a standard 08:00 settlement first enters a
09:00 decision snapshot. This is a conservative clock rule, not proof of
historical publication latency.

Every decision snapshot must contain all 30 latest rows, and each row's age at
`h` must be no more than `1.5 × its interval + 1,000 ms`. Missing, stale, or
corrupt selected evidence is `INVALID_EVIDENCE/UNMEASURED`, never a cash
decision. A valid warmup row without its own prior row remains cash.

Normalize every settled rate to an eight-hour equivalent using its own
historical interval. Across all 30 members, compute dispersion as median
absolute deviation from the cross-sectional median. The baseline is the median
of the prior 28 distinct decision-epoch dispersions.

A trial triggers only when:

- each of the prior `C` dispersions is at or below its own prior baseline;
- the immediately prior dispersion is at or below the current baseline;
- the current baseline is positive; and
- current dispersion divided by baseline is at least `X`.

For each symbol, innovation is its latest normalized settled rate minus its
immediately prior normalized settled rate. The pair is eligible only when the
historical interval is unchanged and the two nonzero rates retain the same
sign. Select the three largest strictly positive innovations for longs and the
three most negative innovations for shorts. Enumerate all six perfect
matchings and minimize total absolute prior-rate gap; a lexicographic canonical
pair tuple breaks ties.

## Trials and allocation

The 12-trial family is the Cartesian product:

- compression observations `C`: 3 or 6;
- expansion ratio `X`: 1.25 or 1.75;
- hold `H`: 6, 12, or 24 hours.

Each event is either six distinct legs or exactly `$1,000` cash. Gross entry
notional is `$1,000`: `$500` long and `$500` short, divided equally across
three symbols per side. Entry is the mark-price `1h` open exactly at decision
hour `h`; exit is the open exactly at `h+H`. A trial cannot overlap cohorts or
re-enter at the same open as an exit. Settlements strictly inside the holding
interval affect PnL only and never alter the selected cohort. Funding notional
uses the `1h` mark open at the UTC hour containing `calc_time`; this is a public
hourly-mark proxy, not an exact settlement mark or account debit. Settlements
equal to entry or exit are excluded.

## Costs, inference, and verdict

All fills are taker proxies:

- base: 4 bp fee + 2 bp adverse execution per fill;
- stress: 8 + 5 bp;
- severe: 10 + 10 bp.

Binance's signed commission documentation uses 4 bp only as an example. S-1V
does not call it. Every scenario is proxy-only; the account-effective rate is
`UNKNOWN`.

For inference, assign a complete cohort's entire final scenario net—price,
funding, fees, and adverse execution—to its UTC exit day. Every other fixed
partition calendar day is zero. All trials and scenarios share the same sampled
day indices in each seven-day circular-bootstrap replicate.

The one-sided centered p-value is
`(1 + count(T_boot >= sqrt(n) × observed mean)) / (B + 1)`; equality counts.
The Bonferroni lower bound is in whole-partition net USD per fixed `$1,000`
gross: subtract the sorted centered-resampled partition-total order statistic
from the observed partition total at one-based index
`ceil((1 - 0.05/12) × 4096)`, without interpolation; this is index `4079`.
This equals `n` times the corresponding daily-mean lower-bound form. Holm
orders by raw
worst-of-base-and-stress p-value then trial
ID and uses the standard step-down adjusted p-values. White's Reality Check is
separate for base and stress: center each trial by its mean, then compare the
observed maximum `sqrt(n) × mean` with the bootstrap maximum using plus-one and
`>=`.

CSCV-PBO uses the first 264 development days as twelve 22-day blocks. Each
block's first 20 days score and its final two purge. A cohort contributes to
PBO only when its closed `[entry, exit]` interval fits wholly inside one score
segment. Across each of all 924 six-block splits, the in-sample winner has the
largest mean stress score, with trial-ID tie-break. Its complementary score
gets the worst rank among OOS ties, rank 1 best; `omega=(13-rank)/13`,
`lambda=ln(omega/(1-omega))`, and PBO is the share with `lambda <= 0`. PBO
`<= 0.5` is a development gate.

The champion maximizes the smaller of its base and stress Bonferroni one-sided
lower bounds, then uses stress net, severe drawdown, and trial ID as frozen tie
breaks. Both lower bounds and both White tests must pass. Per-leg stress
contribution is signed price PnL plus that leg's funding minus its actual
entry/exit stress fee and adverse costs. Aggregate by symbol, choose the maximum
even if all are nonpositive with ASCII tie-break, and remove every cohort
containing it. Separately choose the maximum entry-month cohort stress total
even if all months are negative, earliest month on ties, and remove that month.
Both recomputed stress nets must remain positive.

Frozen counters are mechanical: valid causal epochs are unique development UTC
hours with a changed funding row and a complete fresh 30-member snapshot;
active cohorts are full six-leg cohorts entered inside the partition; active
weeks are unique UTC ISO `(week-year, week-number)` pairs of those entries; and
distinct symbols are the union of all six legs.

Severe maximum drawdown uses complete hourly marked equity, including open
positions, costs, funding, and reserved exit costs. Capacity uses the minimum
of trailing 24 fully closed hourly quote volume and the median of the prior
seven complete UTC days; base participation is 0.5 bp. Public capacity is not
executable capacity. Report its minimum and 5th percentile across active
cohorts independently for development and for holdout if opened; no stress or
severe capacity participation rate exists.

Development chooses at most one champion. April-through-June holdout archive
members, including embargo rows, remain unopened
unless every development validity, sample, positive-net, familywise,
multiplicity, drawdown, and public-capacity gate passes and the champion seal
is written. A valid measured gate failure is `NO_GO`; a custody or semantic
failure after marker consumption is `UNMEASURED` with no rerun. Even an
all-gates public-proxy pass is `PUBLIC_PROXY_PASS_CAPITAL_NO_GO` while
publication latency, account-effective costs, and executable capacity remain
unknown.

## Packet map

- [`protocol.v1.json`](protocol.v1.json): binding signal, clock, allocation,
  cost, statistics, gate, custody, verdict, and authority law.
- [`source_plan.v1.json`](source_plan.v1.json): official archive paths,
  two-stage screen, 1,170-pair freeze, and holdout custody.
- [`trial_ledger.v1.json`](trial_ledger.v1.json): the only 12 allowed trials.
- [`OFFICIAL_SOURCE_RESEARCH.md`](OFFICIAL_SOURCE_RESEARCH.md): current
  official-source findings and honest limits.

Before implementation, official-source research opened only the CSV header of
the remote BTCUSDT June-2026 funding archive and zero outcome rows. That
schema-only probe was outside the selected source-root lifecycle. The binding
claim is that selected-source-root holdout outcome rows stay unopened unless
all development gates pass.

This packet has no credential, private-read, order, transfer, withdrawal,
provider, host, deployment, UI, canonical-branch, or money authority.
