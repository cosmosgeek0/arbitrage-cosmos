# V-G28 intraday quote-volume acceleration/deceleration

| item | expected | found | status |
|---|---|---|---|
| scope | one distinct Binance-public-only verdict | fixed ten-symbol Spot USDT cohort; own-symbol log quote-volume curvature | PREDECLARED |
| family | exactly 12 trials | `W={1,2,4}h × z={1.5,2.5} × hold={2,6}h` | PREDECLARED |
| allocation | qualifier cohort or cash | all eligible qualifiers equal-weight when at least three; otherwise 100% USDT cash | PREDECLARED |
| comparator | deceleration without shorting | matched long-only `z<=-threshold` cohort/cash; comparator only | PREDECLARED |
| timing | completed signal then delayed entry | decision at `00/06/12/18` UTC; one full hourly bar intervenes; entry at `D+1h` open | PREDECLARED |
| partitions | twelve-month development plus holdout | development Jul-2025..Feb-2026; sealed holdout Mar-Jun 2026; Jan-Jun 2025 warmup | PREDECLARED |
| costs | public proxy, not account truth | 10 bp fee plus 10/25/50 bp adverse price per fill; account-effective fee `UNKNOWN` | PREDECLARED |
| inference | interval and search control | 4,096 seeded circular seven-day blocks; Holm and White over all 12; 8-block/70-split CSCV PBO | PREDECLARED |
| authority | research cannot act | consumer `N3 successor/final convergence`; execution `NONE`; capital `NO_GO` | PREDECLARED |

At decision boundary `D`, each symbol and window width `W` uses three adjacent,
non-overlapping completed windows:

```text
V0 = quote volume [D-W,  D)
V1 = quote volume [D-2W, D-W)
V2 = quote volume [D-3W, D-2W)
curvature = ln(V0) - 2 ln(V1) + ln(V2)
```

The robust z-score compares that curvature with the strictly prior 28 values
for the same symbol, `W`, and UTC decision hour:
`(x - median) / (1.4826 × MAD)`. Zero MAD or incomplete causal history cannot
qualify. Liquidity eligibility uses the median daily quote volume of the exact
30 fully closed UTC days before `D`, with a fixed `$10m` minimum. Price fields
are forbidden until cohort selection is complete.

Acceleration is the long strategy (`z>=threshold`). Deceleration
(`z<=-threshold`) is a matched long-only comparator, never a short leg and
never a second selection family. Each holds its own full cohort or cash and
ignores new formations until flat.

## Frozen gates

Development needs at least 40 accelerator episodes, 30 active UTC days, and
six active months. Public base and stress net must both exceed zero. The
one-sided 95% public-base lower bounds for accelerator net and
accelerator-minus-decelerator net must both exceed zero. The champion must
Holm-reject at 5%; White reality-check `p<=0.10`; diagnostic-required CSCV
`PBO<=0.20`; base/stress drawdown at most 15%/20%; and causal public capacity
lower p05 at least `$1,000`.

The diagnostic champion is frozen as the highest development public-stress
net per `$1,000` across all 12 trials, then trial ID ascending. That same trial
must pass every development gate; there is no runner-up substitution. Only
then may its holdout be opened once. Holdout needs at least 20 accelerator episodes,
20 active days, and three active months; positive base and stress net; both
public-base lower bounds positive; base/stress drawdown at most 15%/20%; and
public capacity p05 at least `$1,000`. Failure leaves the holdout unopened or
produces a terminal `NO_GO`; interruption or invalid custody produces
`UNMEASURED`. There is no repair, retune, runner-up, resume, or rerun.

Capacity is a public print proxy. For every entered member it is one basis
point of quote volume in the exact trailing 24 completed hourly bars ending at
`D`. Episode sleeve capacity is qualifier count times the minimum member
proxy; the gate uses the lower empirical p05 across accelerator episodes. It
does not measure executable capacity.

## Commands

Run from `quant/` in this order:

```bash
PYTHONPATH=src:. PYTHONHASHSEED=0 uv run --frozen python -B \
  research/vg28/experiment.py inventory

PYTHONPATH=src:. PYTHONHASHSEED=0 uv run --frozen python -B \
  research/vg28/experiment.py freeze

PYTHONPATH=src:. PYTHONHASHSEED=0 uv run --frozen python -B \
  research/vg28/experiment.py run

PYTHONPATH=src:. PYTHONHASHSEED=0 uv run --frozen python -B \
  research/vg28/experiment.py seal

PYTHONPATH=src:. PYTHONHASHSEED=0 uv run --frozen python -B \
  research/vg28/experiment.py report

(cd research/vg28 && shasum -a 256 -c SHA256SUMS)
```

`inventory` is network-free in this packet. It re-admits the pinned external
cache's exact official raw ZIP and adjacent checksum bytes by fresh local
SHA-256 and Binance sidecar validation; it never opens an archive member and
never trusts or reuses the earlier experiment's features, outcomes, or seals.
Commit the new source manifest so the worktree is clean before `freeze`.
`freeze` binds the protocol, evaluator, tests, runtime, and raw-byte inventory
before outcomes. Commit that freeze receipt so the worktree is clean before
`run`.

`run` exclusively creates and syncs the one-run marker before the first warmup
or development member open. It evaluates development once. A holdout marker is
created and synced before the first holdout member open, and only if every
development gate passes. `seal` is network-free and writes the terminal packet
and checksums without reopening custody. `seal` also derives one exact
`HANDOFF.md` FABLE5 §5 row from the immutable result and authenticates it in
`SHA256SUMS`. The N3 successor may append that row to shared `run.md`; V-G28
itself never mutates the shared ledger. `report` verifies and renders the
sealed result; it cannot run the experiment or open archive members.

## Distinctness from V-G1 through V-G29

| comparison | distinct V-G28 boundary |
|---|---|
| V-G1 | no BTC-only taker-buy pressure or price compression |
| V-G2 | no daily level shock plus positive-return continuation |
| V-G3 | no negative-return shock reversal |
| V-G4 | no price-volume divergence reversal |
| V-G5 | no abnormal-volume price breakout |
| V-G6 | no low-volume compression breakout |
| V-G7 | no climax/exhaustion price reversal |
| V-G8 | no eligible-universe volume share; own-symbol curvature only |
| V-G9 | Spot only; no Spot/USD-M leadership |
| V-G10 | no taker-buy imbalance |
| V-G11 | no trade-count/notional fragmentation |
| V-G12 | no cross-sectional entropy |
| V-G13 | no price-volatility decoupling |
| V-G14 | second difference, not same-slot quote-volume level residual |
| V-G15 | no cross-sectional breadth regime |
| V-G16 | no cross-sectional concentration change |
| V-G17 | no price-impact efficiency |
| V-G18 | no trade-size skew |
| V-G19 | second difference, not abnormal-volume level autocorrelation |
| V-G20 | no synchronized-major-to-alt diffusion |
| V-G21 | no market-factor residual volume |
| V-G22 | continuous log curvature, not first difference of discrete adjacent regimes |
| V-G23 | no abnormal-volume breadth allocation |
| V-G24 | no cross-symbol lead-lag network |
| V-G25 | no shock recovery-horizon state |
| V-G26 | no price-volume correlation |
| V-G27 | own-symbol time-series curvature, not cross-sectional residual dispersion |
| V-G29 | no quote-volume/price-range elasticity or elasticity break |

The study reports net USD per `$1,000`, bootstrap intervals, multiplicity/PBO,
drawdown, and public capacity. Hourly opens plus fixed adverse prices are only
proxies. Historical spread, depth, impact, queue, latency, filters, fills,
publication timing, account fees, and executable capacity remain
`UNMEASURED` or `UNKNOWN`. A positive public verdict cannot authorize trading,
capital, private reads, orders, transfers, withdrawals, UI, host, or provider
effects.
