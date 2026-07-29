# V-G8 terminal verification

## Outcome

`NO_GO` is the frozen measurement verdict. The locked development champion was
`K08_B00` (top eight, no retention buffer). The result is terminal: run count 1/1,
holdout open count 1/1, no rerun, retune, runner-up evaluation, or holdout reopening.

| Held-out metric | Result |
| --- | ---: |
| Measurement period | 2026-03-03 entry through 2026-06-30 exit |
| Valid formations / daily observations | 17 / 120 |
| Modeled fills / holding spells / distinct symbols | 211 / 136 / 40 |
| Gross net per initial $1,000 | -$68.61546213 |
| Public base net per initial $1,000 | -$104.11769814 |
| Public stress net per initial $1,000 | -$129.82060084 |
| Fee stress net per initial $1,000 | -$146.52948943 |
| Public-stress 90% block interval | [-$509.96394644, +$560.53624915] |
| Public-stress one-sided p-value | 0.650720039053 |
| Stress excess over liquidity-rank benchmark | -$27.54522709 |
| Stress excess 90% block interval | [-$307.01215262, +$351.60345058] |
| Daily-close maximum drawdown | 32.11477951% |
| Maximum / p95 public-print participation proxy | 0.141267963702 / 0.125632511421 bp |
| Public-print C_1bp capacity proxy | $7,078.74576652 |
| Historical executable capacity | UNMEASURED |

Development used 34 formations and 430 modeled fills. CSCV PBO was
0.614285714286 (43 underperforming splits of 70); PBO is diagnostic only. The
champion lost $551.04433740 per initial $1,000 under public stress in development,
with a -$847.12821323 one-sided 95% lower confidence bound.

Fourteen of 27 frozen gates failed. Material failures included development stress
net/LCB, Holm and both White Reality Checks, positive-month breadth, held-out
base/stress/fee-stress net, held-out stress LCB and one-sided p-value, excess LCB,
and the 25% drawdown ceiling. Sample, fill, diversification, concentration, and
public-print proxy-capacity gates passed.

## Custody and sealing

- Canonical base:
  `a169b123fb186d1943a75ad648552c4d95be1be1`
- Pre-outcome freeze commit:
  `c0239415b8f3a0d5d04ff5d7c01fe270926a872c`
- Protocol:
  `5dddd302a69be73494cb5ed06d674982a5ecebfa5dcc573799b2c0207965a579`
- Freeze:
  `409bbda893693e8f4a673bfbd694dd2e71acc9580ec0ac144f12e576ced38741`
- Evaluator:
  `5590ec67900f505b71e742a13ab47d99850204268532d8f5d5e90ea6f3b7e699`
- Shared discovery:
  `b4a8f7abd36df19eff0510dfcc3c61fd0df9fdcab5f4d248892ee10010fb21c3`
- Shared checksum-verified acquisition:
  `01f58272602e43bfb914b649adc00d8273b2d423492220a55f86443bb6441176`
- Frozen target inventory:
  `95b7f00860711f7c34bce775b518fc4f33fa1894f45b2599aacba04645ab177e`
- Run marker:
  `5fa94ded8fbcf3d9edfec60fe7945fbd96c127038d8fb03d30bcd7eeecf2d605`
- Candidate seal:
  `2894f2ccc2592b94bed4cdeb1276789336580e70a09684f193b5e00de9f7f012`
- Holdout-open marker:
  `e23c4c3728c51593761d8b5d0d1d397b0c20a73c097e4949e43e8b89ef5c91a9`
- Packet run receipt:
  `40e6f1a01b27b5b541e4d27e7639021e7e4fbef89228ac6a1c0c9086e8dd5ff3`
- Result:
  `93173e5ce1697a3912f15d87c6327d1ba0c97a384cdecd3bd10f6896446dc48b`

The run receipt embeds canonical copies of all three one-use markers. Offline packet
verification binds those copies to the result; local verification additionally
matches them byte-for-byte to the fixed external state root.

One official-checksum-valid `AXSUSDT` February 2026 archive contained non-increasing
daily rows. The frozen missingness law made that unselected history causally
ineligible and recorded it; it was not normalized, repaired, replaced, or rerun.

## Focused proof

Run from `quant/` with Python 3.13.14 and `PYTHONHASHSEED=0`:

```sh
PYTHONPATH=. PYTHONHASHSEED=0 \
  /Users/cosmosgeek/Desktop/cosmos-merge/quant/.venv/bin/pytest -q \
  research/vg8/test_experiment.py
/Users/cosmosgeek/Desktop/cosmos-merge/quant/.venv/bin/ruff check research/vg8
/Users/cosmosgeek/Desktop/cosmos-merge/quant/.venv/bin/ruff format --check research/vg8
MYPYPATH=. PYTHONHASHSEED=0 \
  /Users/cosmosgeek/Desktop/cosmos-merge/quant/.venv/bin/mypy \
  --strict --explicit-package-bases \
  research/vg8/experiment.py research/vg8/test_experiment.py
PYTHONHASHSEED=0 \
  /Users/cosmosgeek/Desktop/cosmos-merge/quant/.venv/bin/python \
  research/vg8/experiment.py verify
(cd research/vg8 && shasum -a 256 -c SHA256SUMS)
```

Pre-seal focused tests, Ruff, formatting, and strict mypy passed. Independent
read-only review found and forced correction of fixed-root custody, marker
authentication, calendar-month PBO partitioning, and the Python runtime/shebang
before the freeze was created. A second read-only blocker review found no remaining
fatal issue before the sole run.

The first manual checksum invocation was run from `quant/` against a manifest whose
entries are packet-relative basenames, so it failed to locate the files. The
subshell command above corrects only that proof-command working directory; no
protocol, evaluator, source, marker, result, or outcome byte changed.

## Limitations and authority

- Four held-out months and 17 weekly formations do not establish durable
  long-horizon performance.
- Public daily OHLCV does not prove historical spread, depth, impact, latency,
  `LOT_SIZE`/`MARKET_LOT_SIZE`/notional filters, or actual fills.
- The reported capacity number is a quote-volume participation proxy; executable
  capacity remains `UNMEASURED`.
- The 10 bp public regular-user fee is a scenario. Account-effective standard,
  special, tax, discount, VIP, BNB, and promotion truth remains `UNKNOWN`.
- Archive-discovered causal membership reduces current-survivor filtering but cannot
  prove the absence of all historical listing/survivorship bias.
- USDT is treated as USD 1:1 only for reporting.
- Public research has capital verdict `NO_GO`, execution authority `NONE`, and money
  effect `$0`.

`run.md` is shared and outside the exclusive writer scope, so it was not edited.
`HANDOFF.md` contains exactly one proposed §5 row for the successor/orchestrator.
