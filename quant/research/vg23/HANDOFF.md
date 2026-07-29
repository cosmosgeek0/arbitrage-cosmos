# V-G23 terminal handoff

## Disposition

`NO_GO`

V-G23 measured one public-only Binance Spot market-wide abnormal-volume-breadth
allocator. The selected development trial was `A200_S50`: a symbol is abnormal
when its five-day mean quote volume is at least `2.00x` its immediately prior
60-day median, and the breadth scalar reaches full exposure at `0.50`. Breadth
changes only the total allocation to a fixed 50/50 BTCUSDT/ETHUSDT sleeve. It
does not rank, select, rotate, or relatively weight symbols, so it is distinct
from V-G8 cross-sectional rotation.

The public-stress holdout lost `$158.06202075` per initial `$1,000`. The
dependence-aware 90% block interval was
`[-$317.61630380, +$7.59813671]`, and the one-sided p-value was
`0.919697339517`. Twelve of 27 frozen gates passed; 15 failed.

## Economics and diagnostics

| Measure | Result |
|---|---:|
| Holdout gross net / `$1k` | `-$145.36868753` |
| Holdout public-base net / `$1k` | `-$152.65113377` |
| Holdout public-stress net / `$1k` | `-$158.06202075` |
| Holdout fee-stress net / `$1k` | `-$161.65135195` |
| Holdout stress 90% block interval | `[-$317.61630380, +$7.59813671]` |
| Holdout stress one-sided p | `0.919697339517` |
| Holdout matched-benchmark excess / `$1k` | `+$14.48390667` |
| Benchmark-excess 90% block interval | `[-$233.69074467, +$333.58606512]` |
| Daily-close max drawdown | `20.16000454%` |
| Development CSCV PBO | `0.385714285714` (`27/70` adverse splits) |
| Development champion Holm-adjusted p | `1` |
| White RC p versus cash / matched benchmark | `0.911642665365 / 0.286062972907` |
| Holdout valid formations / daily observations / fills | `17 / 120 / 36` |

The public-print participation proxy was complete for all 36 holdout fills:
maximum participation `0.005669251542 bp`, public `C1bp` strategy-capital proxy
`$176,390.12710117`, and minimum per-fill notional at 1 bp
`$52,426.43636815`. These are daily-volume scaling diagnostics only.
Historical executable book capacity remains `UNMEASURED`.

## Failures and limitations

The result failed development evidence gates (only two positive stress months,
negative stress net and lower bound, Holm p `1`, and both White Reality Check
p-values), and held-out economic/statistical gates (zero positive stress
months, negative base/stress/fee-stress nets, negative lower bound, one-sided p
`0.919697339517`, and non-positive benchmark-excess lower bound). The
top-asset positive-profit share was not measurable and therefore failed its
gate; the top-five profitable-spell share also exceeded its limit at
`85.70584260%`.

The parser recorded and causally excluded 81 checksum-valid malformed
symbol-months: 80 daily-close-boundary failures and one non-increasing day
sequence. None was repaired or hard-coded away.

This is public shadow research only. Account-effective maker/taker, VIP, BNB,
special, tax, discount, and promotion fees are `UNKNOWN`; historical filters,
permissions, spread, depth, latency, impact, fills, and executable capacity are
`UNMEASURED`. The four-month holdout has only 17 weekly formations. Overlapping
sibling volume lanes make the global-family holdout
`NOT_CERTIFIED_SHARED_REUSE_RISK`; the N3 consumer-adjusted p-value is `1`.
Capital verdict is `NO_GO`, execution authority is `NONE`, and effect is `$0`.

## Consumer

Consumer: `N3 successor/orchestrator scoreboard`.

Disposition: `TERMINAL_EVIDENCE_READY; NO_GO; CAPITAL NO_GO; AUTHORITY NONE;
PRESERVED_WAITING(N3 successor/final convergence); NOT_LANDED; STOP`.
