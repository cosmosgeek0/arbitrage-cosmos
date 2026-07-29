# V-G12 — sealed Spot volume-entropy broadening regime

V-G12 is one public-data trial. Every Monday it builds a causal top-30 USDT Spot
cohort by the prior 30-day median quote volume ending before the 35-day signal
window. It compares normalized Shannon entropy across the most recent seven days
with the immediately prior 28 days. A strict increase holds the entire equal-weight
cohort from Tuesday open to the next Tuesday open; a tie or decrease holds cash.

Quote volume and entropy use frozen 80-digit, round-half-even decimal arithmetic.
Liquidity medians, window sums, entropy, and the final comparison all execute
inside that same local context. Per-bar quote volume may be zero; only a positive
aggregate cohort mass defines an entropy window. A zero-mass window, a difference
within `1E-40`, or narrowing is cash.

Each member needs 120 contiguous complete bars through the prior Sunday. A missing
or checksum-valid semantically anomalous source month makes only that symbol
ineligible for formations whose required prior window overlaps the month. A missing
entry, exit, or required mark for an actually held strategy/benchmark member makes
the sole run terminal `UNMEASURED`.

The signal does not use price, returns, taker flow, trade count, futures, funding,
private/account data, or symbol-level share/entropy ranking. Prices measure returns
only after the cohort and regime decision are fixed.

The pre-freeze sibling re-audit inspected the exact V-G8 through V-G11 protocol
bytes recorded in `protocol.v1.json` and returned `MATERIAL_DISTINCTNESS_PASS`.
V-G8 has the highest overlap—weekly dates and quote volume—but uses a different
transform and action. Correlated sibling outcomes remain global multiplicity
evidence, not independent confirmation.

## Lifecycle

1. The successor/orchestrator performs final source preflight.
2. `freeze` reads the already verified shared discovery/acquisition JSON manifests,
   authenticates the full shared discovery scope (including every sorted
   acquisition row and absence plus their full counts and digests), then requires
   the protocol months to be one continuous ordered subset. It separately binds
   the exact V-G12 target-slice inventory, pair count, and absence count while
   opening no archive body. Out-of-slice shared rows are authenticated, never
   ignored. The protocol independently pins the exact full discovery/acquisition
   raw hashes, 28-month roster, 605-symbol universe hash/count, and full
   `11245`/`5695` pair/absence digests and counts. A coherent replacement cannot
   shrink the shared scope by rewriting both manifests and the freeze.
3. Commit the real freeze before the one-shot run.
4. `run` requires a clean committed packet whose source and freeze bytes are
   tracked at a one-parent HEAD directly above the canonical base. It verifies the
   HEAD blobs, then records the exact commit, tree, and parent before opening any
   development ZIP.
5. The fixed trial must pass every frozen development gate. A development `NO_GO`
   is terminal and leaves holdout unopened. Only a qualifying development result
   receives a candidate seal before the one-use holdout marker and before any
   March–June 2026 ZIP is opened.
6. Before `TERMINAL_FINALIZING`, the exact canonical terminal-result draft is
   exclusively written and fsynced; the journal binds its hash and the final result
   must be byte-identical. Every phase is append-fsynced. Interruption recovery
   reuses an existing draft without a new timestamp; only when no draft exists does
   it create one terminal `UNMEASURED` draft. It never reopens archives.
7. `seal` writes exact packet checksums; `verify.py packet` authenticates bytes,
   gates, lifecycle, and limitations without recomputing outcomes.

This implementation task intentionally does **not** create the real freeze, run
marker, result, receipt, or checksums. Synthetic tests create temporary manifests,
archives, freezes, and markers only below pytest-owned temporary directories.

## Successor commands

```sh
PY=/Users/cosmosgeek/Desktop/cosmos-merge/quant/.venv/bin/python
PYTHONHASHSEED=0 "$PY" quant/research/vg12/experiment.py freeze
PYTHONHASHSEED=0 "$PY" quant/research/vg12/verify.py freeze
# commit the frozen packet before the sole run
PYTHONHASHSEED=0 "$PY" quant/research/vg12/experiment.py run
# interruption recovery only; never a rerun
PYTHONHASHSEED=0 "$PY" quant/research/vg12/experiment.py finalize-unmeasured
PYTHONHASHSEED=0 "$PY" quant/research/vg12/experiment.py seal
PYTHONHASHSEED=0 "$PY" quant/research/vg12/verify.py packet
```

Focused pre-outcome verification:

```sh
cd quant
PYTHONPATH=. PYTHONHASHSEED=0 \
  /Users/cosmosgeek/Desktop/cosmos-merge/quant/.venv/bin/pytest -q \
  research/vg12/test_experiment.py
/Users/cosmosgeek/Desktop/cosmos-merge/quant/.venv/bin/ruff check research/vg12
/Users/cosmosgeek/Desktop/cosmos-merge/quant/.venv/bin/ruff format --check research/vg12
```

The terminal measurement vocabulary is exactly `GO`, `NO_GO`, or `UNMEASURED`.
Even `GO` is retrospective public shadow research with capital verdict `NO_GO`,
capital/execution authority `NONE`, account fees `UNKNOWN`, and historical
spread/impact/book capacity `UNMEASURED`.

Positive-month gates use the exit month of each Tuesday-to-Tuesday spell. Every
frozen required exit-month bucket must contain at least one scheduled exit; these
are not entry-month or generic calendar-month claims.
