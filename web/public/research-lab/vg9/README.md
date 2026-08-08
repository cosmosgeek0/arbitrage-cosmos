# V-G9 — Spot/USD-M quote-volume-share leadership

V-G9 is a public, price-free signal experiment. Each completed UTC week it ranks the
common Spot/USD-M `BASEUSDT` universe by

`log(Spot trailing quote-volume share / USD-M trailing quote-volume share)`.

It then waits a full 24 hours and holds an equal-weight **long Spot only** portfolio
for one week. USD-M is signal-only. Future Spot prices exist only to measure the
post-selection payoff. The matched comparator uses the identical schedule, eligible
set, portfolio count, weighting, and costs but ranks trailing Spot quote-volume share
alone.

This phase freezes code and metadata only. It has not opened a ZIP body, consumed
development, sealed a champion, opened holdout, or produced an outcome.

## Frozen sources

- Spot monthly `1d` archives (read-only):
  `/private/tmp/cosmos-s1f-weekly-momentum-cash-v1/archives`
- USD-M monthly `1h` archives (read-only):
  `/private/tmp/cosmos-s1d-funding-dispersion-v1/raw/data/futures/um/monthly/klines`

`source_manifest.v1.json` binds deterministic per-month enumeration digests made
from archive paths, adjacent CHECKSUM contents, and file metadata only. Its creation
and verification never read a ZIP body. Archive bodies may be read only after the
appropriate one-shot marker.

## Lifecycle

1. `verify.py` authenticates the Phase-1 packet and re-enumerates only metadata.
2. After the Phase-1 freeze is independently accepted, `experiment.py development`
   atomically writes `development_opened.v1.json` before reading a development ZIP.
3. Development failure leaves holdout untouched. Development success writes
   `candidate_seal.v1.json`.
4. `experiment.py holdout` authenticates the candidate, writes
   `holdout_opened.v1.json`, invokes the canonical grant-bound holdout opener, and
   only then reads holdout ZIP bodies.
5. `experiment.py seal` copies the immutable one-shot JSON artifacts into the
   tracked `evidence/` directory and writes an evidence checksum manifest. It does
   not recompute any outcome.
6. Any marker or terminal result makes the corresponding action refuse a rerun.

The one-shot state root is separate from the shared archives:

`/private/tmp/cosmos-vg9-spot-usdm-volume-leadership-v1`

## Phase-1 proof

Run from `quant/`:

```sh
PYTHONPATH=.:src PYTHONHASHSEED=0 .venv/bin/pytest -q \
  research/vg9/test_experiment.py research/vg9/test_verify.py
.venv/bin/ruff check research/vg9
.venv/bin/ruff format --check research/vg9
PYTHONPATH=.:src PYTHONHASHSEED=0 .venv/bin/python research/vg9/verify.py
shasum -a 256 -c research/vg9/SHA256SUMS
```

No private endpoint, account credential, current `exchangeInfo`, UI, host, provider,
order, transfer, withdrawal, deployment, or capital action is authorized. Even `GO`
would mean public-proxy research only, with execution authority `NONE`.
