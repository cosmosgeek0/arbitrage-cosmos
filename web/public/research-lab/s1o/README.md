# S-1O — OI-conditioned funding persistence

S-1O is a sealed, public-only Binance USD-M research packet for one materially narrow
hypothesis:

> On BTCUSDT only, does a two-event funding-sign streak persist for the next actual funding
> settlement often enough to survive conservative public cost proxies when the signal is
> conditioned on strictly lagged five-minute open-interest expansion?

It is not cross-sectional, basis or premium trading, a spot hedge, funding acceleration, a
sign-flip reversal, or an immediate post-settlement unwind. It cannot place an order, call a
private endpoint, use a credential, or authorize capital.

## Frozen truth boundary

- Calendar: warmup June 2025; development
  `[2025-07-01,2026-02-10)`; embargo `[2026-02-10,2026-02-17)`; untouched holdout
  `[2026-02-17,2026-07-01)`.
- Trials: 2 OI windows × 2 minimum OI growth levels × 2 minimum absolute funding rates = 8
  frozen multiplicity trials.
- OI is read only from complete, bounded as-of rows before entry. No future row and no
  forward-fill beyond ten minutes is admissible.
- Entry/exit use the first complete contract five-minute bar close after each exact funding
  timestamp. The position crosses exactly one next actual settlement.
- Base, stress, and severe taker/adverse-fill scenarios are decomposed separately from price
  and funding PnL. They are proxies; account-effective fees remain `UNKNOWN`.
- Development statistics use a centered seven-day circular-block bootstrap, Holm across all
  eight trials, a White max-mean reality check, and an eight-block/70-split CSCV-PBO
  diagnostic. CSCV/PBO is diagnostic, not a gate.
- A development failure is `NO_GO` and leaves holdout unopened. Valid but incomplete public
  evidence is `UNMEASURED`. A numeric success is still capped at `UNMEASURED` because the
  official archive documentation does not establish metrics semantics and execution/account
  truth. `GO` is structurally unreachable; capital disposition is always `NO_GO`.

The exact protocol is [protocol.v1.json](protocol.v1.json). The official citation and
limitation freeze is [OFFICIAL_SOURCE_RESEARCH.md](OFFICIAL_SOURCE_RESEARCH.md).

## Deterministic workflow

Use Python 3.13 from a quant virtual environment prepared from the repository's exact
`pyproject.toml` and `uv.lock`. The placeholder below must be replaced by that locked
environment's interpreter; bare ambient `python` is not acceptance evidence.

```bash
QPY=/absolute/path/to/locked/quant/.venv/bin/python
"$QPY" experiment.py plan
"$QPY" experiment.py freeze
"$QPY" experiment.py acquire --data-root /absolute/unique/external/s1o-data
"$QPY" experiment.py run --data-root /absolute/unique/external/s1o-data
"$QPY" experiment.py verify
```

Rules enforced by the CLI:

1. `freeze` is create-once. Identical reread is allowed; any changed protocol, source note, or
   evaluator is refused.
2. `acquire` refuses before that exact freeze and writes only to a caller-supplied absolute
   root outside the repository. All 437 archive objects are checked against official sidecars.
   The root marker is path-bound; symlinks, hardlinks, shared file identities, and non-regular
   archive/checksum inputs are rejected.
3. Development and holdout use separate custody roots. February monthly archives are
   independently verified copies; development parsing stops at its exact boundary.
4. `generated/RUN_CONSUMED.json` is atomically created before the first development member is
   opened. Before that marker, the fully verified 437-record external manifest is copied
   create-once to `generated/source-data-manifest.v1.json`. Any later failure consumes the run.
5. Holdout cannot be opened until every development gate passes, a champion seal exists, and
   `generated/HOLDOUT_OPENED.json` has been atomically created.
6. `verify` rechecks freeze, result/artifact hashes, verdict law, fee truth, capital posture,
   and champion-before-holdout custody.

Raw archives stay external and are never committed. Generated result and SHA manifests remain
inside this packet. Fixture tests are network-free and never create the real run marker.

## Focused verification

From the repository's `quant/` directory:

```bash
QPY=/absolute/path/to/locked/quant/.venv/bin/python
"$QPY" -m pytest -q research/s1o/test_experiment.py
"$QPY" -m ruff format --check research/s1o/__init__.py research/s1o/experiment.py research/s1o/test_experiment.py
"$QPY" -m ruff check research/s1o/__init__.py research/s1o/experiment.py research/s1o/test_experiment.py
MYPYPATH=. "$QPY" -m mypy --strict --explicit-package-bases research/s1o/experiment.py research/s1o/test_experiment.py
"$QPY" -m json.tool research/s1o/protocol.v1.json
```

The result is evidence for the N3 successor/orchestrator profitability scoreboard only. It is
not a production strategy, integration, deployment, fee claim, fill claim, capacity claim, or
capital instruction.
