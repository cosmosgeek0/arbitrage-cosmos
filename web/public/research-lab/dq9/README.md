# DQ-9 sealed-research lifecycle validator

DQ-9 is one pure, prospective validator for the one-run and holdout lifecycle
used by future sealed S-1 and V-G research. It validates one complete snapshot
atomically, derives the only legal state, and emits a canonical SHA-256-bound
receipt for N3/future research intake.

DQ-9 is not an experiment runner. It opens no data, computes no statistic,
evaluates no historical packet, and grants no research, capital, execution,
order, transfer, withdrawal, or money authority.

## Frozen v1 state machine

| Derived state | Exact required prefix | Intake posture |
| --- | --- | --- |
| `FROZEN` | committed freeze artifact plus clean, exact, origin-preserved pre-run commit/tree | `NOT_TERMINAL_FOR_INTAKE` |
| `RUN_CONSUMED` | one run marker binding the frozen state before any development byte | permanently non-rerunnable |
| `DEVELOPMENT_OPENED` | one development marker after run consumption and before outcome bytes | permanently non-rerunnable |
| `CANDIDATE_SEALED` | exact development disposition, result, gates, frozen inputs, and candidate identity | holdout eligible only after `PASSED` |
| `HOLDOUT_OPENED` | one marker for the exact sealed candidate before any holdout byte or feedback | consumed and nonterminal |
| `TERMINAL` | one result binding every present predecessor, count, candidate seal, commit/tree, and freeze artifact | `TERMINAL_LIFECYCLE_VALID` |

`TERMINAL` is absorbing. No valid receipt ever sets rerun, resume, repair,
refreeze, fallback, successor, or capital authority.

## Honest failure path

After the run marker is consumed, a custody or evaluator failure is not
repairable. It is represented by:

1. a candidate seal with `developmentDisposition=UNMEASURED`;
2. `candidateId`, candidate artifact, and parameter digest set to `null`;
3. `holdoutEligible=false`;
4. no holdout opening; and
5. a terminal `UNMEASURED` result.

The implication is bidirectional: terminal `UNMEASURED` is invalid if a passed
or failed non-null disposition survives, or if any holdout was opened.

This path also covers a failure before the first development body is opened.
The consumed run stays consumed. An incomplete snapshot after run or holdout
opening is valid only as nonterminal custody evidence; it is never permission
to resume or rerun.

## Holdout rules

A holdout can appear only after:

- one development opening;
- a `PASSED` development disposition;
- one non-null candidate whose code, data, parameters, costs, statistic, and
  decision rule are frozen;
- a candidate seal that forbids fallback; and
- a holdout marker that repeats the exact candidate and precedes all holdout
  bytes and feedback.

`GO` requires that exact holdout prefix. A lifecycle-valid `GO` still has
`authority=NONE`; DQ-9 does not validate economics or make a profitability
claim.

## Identity and serialization

- Git identities are exact lowercase 40-hex commit/tree IDs.
- Origin refs use a strict ASCII subset of Git ref syntax and reject dotted
  traversal, consecutive dots, dot-prefixed components, `.lock` components,
  repeated slashes, forbidden punctuation, and non-canonical endpoints.
- Evidence identities are exact lowercase SHA-256 digests.
- The pre-run commit directly descends from the frozen static commit, has a
  distinct tree containing the freeze artifact, is clean, and is preserved by
  its named origin tracking ref.
- Every later record binds its predecessor digest plus the lifecycle/run
  identity appropriate to its phase.
- Counts are strict integers, never booleans, and are limited to `0|1`.
- The Python object boundary accepts exact frozen record classes and exact
  built-in scalar types only. Subclass equality, accessors, and virtual
  serialization hooks cannot participate in validation or receipt hashing.
- Serialized intake is strict bounded UTF-8 JSON. Duplicate keys, BOMs,
  non-finite values, floats, unknown fields, trailing documents, malformed
  hashes, and oversized/deep inputs fail closed.
- Canonical receipts use sorted compact JSON, no non-finite values, and one LF.

The validator consumes caller-supplied immutable facts. It cannot prove that an
undisclosed parallel run never occurred or that a marker was durably created
before an external process opened data. Future runners must create those
artifacts exclusively and durably; N3 must enforce one terminal receipt per
`lifecycleId`.

Past sealed packets are not retroactively validated or repaired.

## Public API

The names in `PUBLIC_API_V1` are the complete v1 surface. The only validation
path is:

```python
receipt = validate_lifecycle_v1(snapshot)
```

For serialized intake:

```python
receipt = validate_lifecycle_json_v1(snapshot_bytes)
```

Phase-specific public validators do not exist, so separate checks cannot derive
conflicting lifecycle states.

## Focused proof

Run from `quant/` with the accepted locked environment:

```text
PYTHONDONTWRITEBYTECODE=1 PYTHONHASHSEED=0 PYTHONPATH=src:. \
  .venv/bin/python -m pytest -q -p no:cacheprovider \
  research/dq9/test_validator.py

PYTHONDONTWRITEBYTECODE=1 PYTHONHASHSEED=0 PYTHONPATH=src:. \
  .venv/bin/python -m research.dq9.verify_known_answer

.venv/bin/ruff check research/dq9
.venv/bin/ruff format --check research/dq9

MYPYPATH=src:. .venv/bin/mypy --strict --explicit-package-bases \
  research/dq9/validator.py research/dq9/__init__.py \
  research/dq9/known_answer.py research/dq9/verify_known_answer.py
```

The fixtures cover every legal prefix, terminal failure before development,
development-only failure, champion-only holdout, exact known-answer replay,
mapping-order invariance, malformed identity and predecessor bindings, repeat
run authority, early openings, fallback/substitution, count disagreement,
terminal successors, ambiguous JSON, and effectful dependency exclusion.
