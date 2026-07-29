# DQ-1 Binance public 1d-kline boundary

DQ-1 is a deterministic, offline custody and semantic boundary for Binance Spot
public `1d` kline ZIPs. It converts only complete daily rows into one canonical
microsecond-timestamp CSV, emits a mandatory censoring sidecar, and binds both
to a provenance receipt.

It is research infrastructure only. It does not call Binance, inspect private
state, place or simulate orders, open holdouts, repair consumed packets, infer
symbol lifecycle, or authorize a canonical landing.

## Frozen behavior

- ZIP bytes, sidecar bytes, acquisition receipt, expected member, and official
  source-document revisions must all match.
- The executing checkout hashes its local policy, validator source, and
  `quant/uv.lock` and rejects a caller-declared context that differs. Official
  documentation pins are matched to frozen constants; DQ-1 never refreshes
  them during offline validation.
- Native timestamps are selected from the pinned partition: pre-2025 Spot
  archives are milliseconds; 2025 onward are microseconds. Value magnitude is
  never a unit heuristic.
- A complete `1d` row opens at UTC midnight and closes at
  `openNative + dayNative - 1`. Canonical output multiplies both published
  timestamps into microseconds; it does not fabricate extra close precision.
- A contiguous same-open run may collapse only when record payload bytes are
  identical. The first record is kept, ordinals and byte digests are receipted,
  and no extra coverage is granted. One pair is the frozen cap.
- A shortened row may be quarantined only when it is the final logical group.
  Its cause remains `UNKNOWN`; it is never consumed as a complete bar.
- Any conflict, nonadjacent recurrence, descending open, earlier truncation,
  boundary overflow, schema defect, custody drift, or empty complete output is
  `INADMISSIBLE` and emits no canonical CSV.

The complete normative contract is [policy.v1.json](policy.v1.json). The
official-versus-project evidence split is in
[OFFICIAL_SOURCE_RESEARCH.md](OFFICIAL_SOURCE_RESEARCH.md).

## Outcomes

- `ADMISSIBLE`: nonempty complete output; no exclusions.
- `ADMISSIBLE_WITH_EXCLUSIONS`: nonempty complete output plus only frozen,
  capped duplicate/truncation events. This is not a green or consumer-ready
  state.
- `INADMISSIBLE`: failure receipt only; no complete-bar artifact.

## Reproduce

From the repository root:

```sh
PYTHONPATH=quant PYTHONHASHSEED=0 quant/.venv/bin/python -B -m pytest -q -p no:cacheprovider quant/research/dq1/test_boundary.py
quant/.venv/bin/ruff check quant/research/dq1
quant/.venv/bin/ruff format --check quant/research/dq1
MYPYPATH=quant quant/.venv/bin/mypy --strict --explicit-package-bases quant/research/dq1/boundary.py quant/research/dq1/test_boundary.py quant/research/dq1/verify.py quant/research/dq1/__init__.py
PYTHONPATH=quant quant/.venv/bin/python -B -m research.dq1.verify
```

The CLI accepts only local files and writes receipt/output artifacts atomically:

```sh
PYTHONPATH=quant quant/.venv/bin/python -B -m research.dq1.boundary \
  --archive ARCHIVE.zip \
  --checksum ARCHIVE.zip.CHECKSUM \
  --acquisition-receipt acquisition.json \
  --validation-context context.json \
  --receipt-out boundary-receipt.json \
  --canonical-out complete-bars.csv \
  --exclusions-out censoring.json
```

Exit `0` means structurally admissible under the frozen DQ-1 policy. Exit `2`
means inadmissible; any stale canonical/exclusion outputs at the requested paths
are removed.

## Consumer rule

Before any future input inspection, the sealed protocol must freeze DQ-1's
policy, validator, runtime, expected archive inventory, allowed exclusion caps,
and terminal-censoring behavior. After offline validation but before any
evaluator or holdout access, it must freeze the exact acquisition, canonical
output, censoring, and dataset-manifest digests.

A consumer may use only the emitted complete rows and only when every frozen
digest matches. It must separately reconcile missing/extra symbol-months,
cross-partition ordering, lifecycle, and required coverage. A terminal censored
event must follow the predeclared sample-invalid, missing-exit/terminal-loss, or
controlled conservative-exit rule; it cannot disappear as ordinary missing
data.

DQ-1 is prospective only. It gives no authority to reopen, repair, reclassify,
or rerun S-1/V-G or any other consumed run.

## Exact limitations

- Physical duplicate and shortened-row causes are not documented by Binance.
- Sidecars are unsigned current-byte equality evidence; archives may change.
- `ADMISSIBLE_WITH_EXCLUSIONS` is not source completeness, lifecycle truth,
  profitability evidence, capital authority, or permission to open a holdout.
- Coverage receipts distinguish dates with no observed logical open from dates
  with no admitted complete bar. Neither range proves why data is absent or
  whether coverage is sufficient. Expected inventory and lifecycle remain a
  separately frozen responsibility.
