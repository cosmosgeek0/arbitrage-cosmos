# V-G14 terminal evidence

## Verdict

`NO_GO` at development. This is a valid negative measurement, not
`UNMEASURED`.

- The evaluator was frozen before acquisition.
- 100 official Binance Spot monthly ZIPs matched their colocated checksum
  sidecars before any member was opened.
- The one development marker was written before the first member open.
- 145,920 exact-grid 30-minute bars across the frozen ten-symbol cohort passed
  custody, schema, timestamp, continuity, duplicate, and positive-value checks.
- All four preregistered trials failed multiple formal gates.
- No candidate seal exists. Holdout acquisition, source manifest, result,
  marker, and raw custody are all absent; holdout opens are `0/1`.

## Development results

| Trial | Round trips | Gross return | Base return | Stress return | Severe return | Holm p | Stress max drawdown |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| R2x-H6h | 745 | 31.40% | -85.96% | -96.85% | -99.84% | 1.0000 | 96.91% |
| R2x-H12h | 421 | 1.60% | -71.29% | -87.65% | -97.72% | 1.0000 | 89.13% |
| R4x-H6h | 544 | -15.97% | -83.59% | -94.48% | -99.38% | 1.0000 | 94.83% |
| R4x-H12h | 331 | 0.33% | -62.86% | -80.87% | -94.93% | 1.0000 | 83.91% |

Every trial passed only the active-month, distinct-symbol, and round-trip
sample gates. Every trial failed the stress-return, bootstrap lower-bound,
Holm-adjusted significance, maximum-drawdown, positive-month, and proxy-capacity
gates. The least-negative stress trial, R4x-H12h, still lost 80.87% under the
frozen stress proxy, had a -0.6967% bootstrap lower bound per round trip, and
failed the one-basis-point quote-volume capacity screen on 46.53% of entries.

## Exact limitation

The verdict applies only to the frozen ten-symbol cohort, dates, 30-minute
same-slot seasonal baseline, delayed entry, holding periods, and public cost
proxies. Account-effective fees remain `UNKNOWN`. Historical spread, depth,
impact, fillability, latency, filters, and executable capacity remain
`UNMEASURED`; the quote-volume participation screen is not executable capacity.
This result is not a claim about every Binance Spot symbol, is not capital
authority, and caused no private call, order, transfer, withdrawal, host, UI,
deployment, or money effect.

Machine authority remains `NONE`; effect remains `$0`.
