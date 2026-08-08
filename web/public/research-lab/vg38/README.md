# V-G38 — lagged BTC quote-volume volatility-of-volume compression

V-G38 asks one narrow Binance-public-only question:

> Does compression in BTCUSDT daily quote-volume variability, observed before a
> full completed-bar gap, identify a later fixed-cohort long/cash regime with
> positive public-model net value after frozen costs?

This file records the frozen pre-outcome design only. It reports no development
or holdout result and makes no profitability claim.

## Frozen signal

Let `Q_t` be BTCUSDT Spot quote-asset volume from one fully completed UTC daily
bar, and define the volume innovation:

```text
x_t = ln(Q_t) - ln(Q_t-1)
```

For an entry at UTC daily open `D`, the newest signal observation is `x_(D-2)`.
The complete `D-1` daily bar is an untouched gap between the score and the
entry. No bar at or after `D-1` may affect the decision at `D`.

Each trial compares two disjoint causal windows:

- recent MAD of `x`: exactly `R` observations ending at `D-2`, with
  `R ∈ {7,14}`;
- prior MAD of `x`: exactly `P` immediately preceding observations, with
  `P ∈ {30,45}`;
- compression ratio: `recent_MAD / prior_MAD`;
- ON when the ratio is at or below `C`, with `C ∈ {0.50,0.75}`.

The full family is therefore `2 × 2 × 2 = 8` frozen trials. Missing,
nonpositive, nonfinite, discontinuous, overlapping, or zero-denominator
evidence cannot create a numeric score or a passing event. There is no alternate
window, threshold, polarity, transform, runner-up family, or post-open retuning.

Only BTCUSDT quote volume can determine ON or OFF. Price, return, high, low,
range, taker flow, trade count, derivatives, funding, private/account data, and
the other cohort members' volume are forbidden signal inputs.

## Portfolio and schedule

ON holds the complete fixed twelve-symbol Spot cohort at equal initial
notional:

```text
BTCUSDT ETHUSDT BNBUSDT XRPUSDT ADAUSDT DOGEUSDT
SOLUSDT TRXUSDT LTCUSDT BCHUSDT LINKUSDT AVAXUSDT
```

OFF holds 100% zero-yield USDT cash. On an OFF-to-ON transition, the current
research notional is divided equally across all twelve members. Those units
remain fixed until the next ON-to-OFF transition; there is no daily
rebalancing, ranking, rotation, replacement, shorting, borrowing, or leverage.
A missing required constituent entry, mark, or exit is terminal
`UNMEASURED`, never a partial cohort or backfill.

- Initial research notional: `$1,000`.
- Development: first eligible entry `2025-03-03`; final liquidation
  `2025-12-31`.
- Holdout: first eligible entry `2026-01-02`; final liquidation
  `2026-03-31`.
- The holdout may be opened once, for the single frozen development champion,
  only if every development gate passes.
- Base cost sensitivity: `20 bp` per executed side.
- Stress cost sensitivity: `35 bp` per executed side.

Account-effective fees are `UNKNOWN`. Historical spread, depth, impact, queue,
filters, fillability, latency, and executable capacity are `UNMEASURED`.
Public daily quote volume is not executable capacity.

## Inference and search control

All eight development trials remain in the family. One-sided development
evidence is Holm-adjusted across that complete family. Q14 owns the frozen PBO
calculation over the same trial identities and chronological development
partitions; PBO must be available and at most `0.20`. Base and stress total
net/$1k, and base and stress total excess versus the identical always-on
cohort, must be positive. PBO cannot select a different family member, rescue a
failed gate, authorize a second holdout opening, or justify retuning.

The development/holdout boundary is strict: no position, signal window,
selection evidence, or realized PnL crosses it. A failed development gate
leaves holdout archive bodies unopened. A consumed run or holdout marker permits
no repair, retry, refreeze, substitution, or rerun.

## Material distinctness and metamorphic proof

V-G38 owns temporal compression in the dispersion of BTC quote-volume
innovations. Synthetic proof and direct signal-surface inspection must establish
all of these separations before any outcome archive is opened. Only the first
item is a scale invariance; the seasonality item is a structural exclusion, not
a claim that the raw series is immune to calendar effects:

- **Not low-volume level:** multiplying every `Q_t` by one positive constant
  leaves the signal unchanged; high-volume and low-volume paths with identical
  innovations have the same score.
- **Not a volume shock:** changing one current quote-volume level without
  changing the frozen recent/prior MAD relationship cannot become a
  shock-threshold family, and no contemporaneous extreme-volume requirement
  exists.
- **Not entropy:** permuting volume mass among non-BTC symbols cannot change the
  signal; no cohort share or Shannon-entropy statistic is computed.
- **Not turnover:** changing Top-K membership or symbol identities outside
  BTCUSDT cannot change the signal; no roster-intersection statistic is used.
- **Not seasonality level:** changing a same-slot level residual while
  preserving the two innovation-MAD windows leaves the signal unchanged; there
  is no current-versus-seasonal-median threshold.
- **Not synchronization:** changing ETHUSDT or any alt volume, including
  simultaneous major-volume shocks, cannot change the signal; no joint,
  cross-symbol, lead-lag, or diffusion condition exists.
- **Not acceleration/curvature:** paths may have different second differences
  but the same recent/prior MAD ratio, and vice versa.
- **Not price-volume decoupling:** arbitrary price and return changes cannot
  alter trial identity, signal state, or cohort selection.

Any exact signal, universe, schedule, or allocation collision discovered before
the source freeze stops V-G38 as `UNMEASURED_COLLISION`; parameter changes alone
do not establish distinctness.

## Source custody and commands

V-G38 reuses the checksum-bound V-G26 Binance Spot daily-kline corpus read-only:

```text
/private/tmp/cosmos-vg26-price-volume-correlation-v1
```

The corpus, its acquisition manifest, ZIP files, checksum sidecars, and V-G26
receipts are immutable inputs. V-G38 writes no shared-corpus byte and inherits
no V-G26 signal, trial, outcome, marker, or verdict. `freeze` authenticates and
binds the exact acquisition-manifest SHA-256
`fb9335c4372b979cb930bee059e41f02db355973ddf1e1ae4d878b828df3517a`
and every required compressed byte without opening an archive member.

Run only these packet commands from `quant/` with the repository-pinned Python
environment:

```bash
PYTHONPATH=src:. PYTHONHASHSEED=0 uv run --locked --no-sync python -B research/vg38/experiment.py freeze
PYTHONPATH=src:. PYTHONHASHSEED=0 uv run --locked --no-sync python -B research/vg38/experiment.py run
PYTHONPATH=src:. PYTHONHASHSEED=0 uv run --locked --no-sync python -B research/vg38/experiment.py verify
```

There is no V-G38 acquisition command and no checksum/hash refresh command.
`run` creates the exclusive one-use development marker before the first
development archive-member open. `verify` authenticates frozen and terminal
bytes without rerunning research, opening an archive member, changing custody,
or recomputing returns.

## Authority boundary

Scope is public retrospective research only. Consumer:
`N3 successor/orchestrator scoreboard`.

Capital authority and execution authority are `NONE`; effect is `$0`.
Credentials, private APIs, account state, orders, test orders, transfers,
withdrawals, host/provider operations, deployment, canonical landing, runtime
wiring, and UI changes are forbidden and absent.
