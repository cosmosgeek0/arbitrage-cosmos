# Q01-001 — locked deterministic research workspace

Status: `ACCEPTED_FOR_Q01_IMPLEMENTATION`

Date: 2026-07-12

## Decision

Use CPython `3.13.14` and `uv 0.11.28`/`uv-build 0.11.28` as the Q-lane package boundary. Lock only Polars `1.42.1`, PyArrow `25.0.0` and DuckDB `1.5.4` as immediate runtime dependencies. Lock the exact lint, type, test, coverage, property, vulnerability and license tools declared in `pyproject.toml`; defer every modeling, registry-server, sequence and external-data framework until its named data/phase gate.

The package exposes immutable explicit config, injected clock, a specified SHA-256 counter random source, canonical JSON and an offline CLI. Filesystem and subprocess composition are confined to CLI commands. The package imports no runtime owner, environment, network, private client, money path or foreign serialized artifact.

Create `EDGE_HYPOTHESIS_MAP.md` plus one canonical machine registry with honest `UNTESTED`, `DATA_INSUFFICIENT` and `RESEARCH` statuses. Preserve directive §14.10 identities exactly: H1 dormant-to-active, H2 continuation/exhaustion, H3 executable normal Basis, H4 reverse Basis feasibility, H5 false-burst/manipulation-risk filtering and H6 cross-source leadership; funding/context extensions are H7/H8. The Markdown is rendered exactly from every substantive machine field, so manual prose/status drift fails verification. These statuses describe a falsification portfolio and never assert edge, probability calibration, causal intent or actionability.

Protocol verification is an identity-bound compatibility probe, not an arbitrary subprocess success check. The CLI has no public runner override; it verifies the frozen document, test, fixture and schema SHA-256 values and accepts only the deterministic 22/22 output hash before reporting success.

## Basis

- Official release, lifecycle, security, license and compatibility evidence was retrieved on 2026-07-12 and is recorded in `docs/Q01_FRAMEWORK_ADOPTION.md`.
- CPython 3.13 is the newest line supported by every immediate dependency at intake; the exact patch is pinned separately even though project metadata admits only that one minor line.
- Polars/Arrow/DuckDB are the minimal Q02-ready columnar set. They own no source, feature, lake, registry, strategy, ledger or database authority by themselves.
- The larger framework set creates substantial transitive, native, server or authority surface without Q01 labels/models. Deferral preserves an explicit test/ablation seam without installing unused machinery.
- A hash-locked clean environment, scanner inventory and deterministic seed proof are acceptance evidence; popularity and compilation are not.

## Rejected alternatives

- Host Python 3.9.6: outside the selected support/language boundary.
- Python 3.14.6: newer, but immediate Polars intake metadata did not yet declare 3.14 support.
- Loose version ranges, unverified global tools or an un-hashed `requirements.txt`: insufficient replay identity.
- Immediate installation of scikit-learn, XGBoost, River, MLflow, PyTorch or every directive candidate: no Q01 data-supported execution seam.
- A second exchange connector, scanner, feature store, experiment authority, trading engine or model-serving listener: conflicts with `ARCHITECTURE.md` Part II and the advisory-only lane.
- Standard-library global RNG, import-time clocks/I/O, environment-derived config and pickle/joblib model loading: nondeterministic or unsafe boundaries.

## Consequences

- Q01 can prove deterministic package/CLI/registry behavior without claiming research results.
- Q02 may build bounded immutable columnar storage on the locked data stack, but it must still implement corruption, schema, path and extension denial.
- Deferred frameworks require a later phase decision and lock amendment after data sufficiency and comparative fit; this decision does not pre-approve them.
- Vulnerability and license observations expire as external databases and package metadata change. They must be regenerated whenever the lock changes.
