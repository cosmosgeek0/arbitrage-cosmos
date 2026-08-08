# V-G2 public Spot volume-shock continuation

V-G2 is one bounded, public-only research packet for the N3 profitability
verdict. It tests whether an asset's own-history quote-volume shock, accompanied
by a positive completed-day return, continues after the signal in the
cross-section of Binance Spot USDT assets.

The experiment has no execution, account, private API, order, provider, host,
UI, deployment, or money authority. Its effect is `$0`. A `GO`, if earned, is
only a public-research instruction to continue shadow validation. It is never
capital authority.

## Frozen lifecycle

1. `inventory` authenticates already-acquired official ZIP and `.CHECKSUM`
   bytes without opening ZIP members and writes `source_manifest.v1.json`.
2. `freeze.v1.json` binds the protocol, evaluator, tests, source research,
   README, and source manifest before any outcome row is opened.
3. Focused synthetic tests exercise timestamp, causality, cash, multiplicity,
   PBO, drawdown, one-open, and tamper failures.
4. `develop` consumes the development authority once, opens only May
   2025–February 2026 archives, evaluates all twelve frozen trials in four
   chronological out-of-sample folds, and locks one champion.
5. `holdout` records its one allowed open before reading March–June 2026,
   evaluates only the locked champion, and writes the terminal verdict.
6. `report` authenticates committed evidence without recomputing outcomes.

The immutable external source root is
`/private/tmp/cosmos-s1f-weekly-momentum-cash-v1`. V-G2 reuses only its
checksum-bound public archive bytes. It does not reuse or rerun S-1F's protocol,
selection, or result.

## Commands

Run from `quant/` with the repository's pinned environment:

```sh
PYTHONPATH=. PYTHONHASHSEED=0 ./.venv/bin/python -B \
  research/vg2/experiment.py inventory \
  --state-root /private/tmp/cosmos-s1f-weekly-momentum-cash-v1

PYTHONPATH=. PYTHONHASHSEED=0 ./.venv/bin/python -B \
  research/vg2/experiment.py develop \
  --state-root /private/tmp/cosmos-s1f-weekly-momentum-cash-v1

PYTHONPATH=. PYTHONHASHSEED=0 ./.venv/bin/python -B \
  research/vg2/experiment.py holdout \
  --state-root /private/tmp/cosmos-s1f-weekly-momentum-cash-v1

PYTHONPATH=. PYTHONHASHSEED=0 ./.venv/bin/python -B \
  research/vg2/experiment.py report \
  --state-root /private/tmp/cosmos-s1f-weekly-momentum-cash-v1
```

Focused verification:

```sh
./.venv/bin/ruff check research/vg2
./.venv/bin/ruff format --check research/vg2
MYPYPATH=. ./.venv/bin/mypy --strict --explicit-package-bases \
  research/vg2/experiment.py research/vg2/test_experiment.py
PYTHONPATH=. PYTHONHASHSEED=0 ./.venv/bin/python -B -m pytest -q \
  -p no:cacheprovider research/vg2/test_experiment.py
shasum -a 256 -c research/vg2/SHA256SUMS
```

## Truth boundary

The packet reports an exact deterministic net edge for its declared public
scenario: completed daily bars, next-day open execution, the current published
Regular User taker fee of 10 basis points per side, and frozen adverse-execution
proxies. Historical account commission, historical symbol filters, bid/ask
spread, order-book impact, and executable capacity are unavailable from the
public daily archive. They remain `UNKNOWN`; daily quote volume supports only a
conservative participation proxy.
