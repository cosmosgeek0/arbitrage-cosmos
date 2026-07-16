# Quant Edge Research

This package is an isolated, advisory-only research lane. It owns deterministic research configuration, evidence transformations, hypothesis/model experiments and advisory projections. It owns no public production source, strategy proposal, capital, risk, execution, ledger, control or supervisor authority.

## Locked environment

Q01 pins:

- CPython `3.13.14` in `.python-version`;
- `uv 0.11.28` through `[tool.uv].required-version`;
- every direct dependency exactly in `pyproject.toml` and every transitive distribution/hash in `uv.lock`.

Bootstrap from this directory:

```bash
uv python install 3.13.14
uv sync --locked --all-groups
```

`uv` uses Astral's managed `python-build-standalone` distributions because CPython does not publish portable interpreter archives. The Python implementation and `uv` artifact must therefore be verified as separate supply-chain inputs; the Q01 receipt records the observed artifacts and hashes.

## Stable Q01 commands

```bash
uv lock --check
uv run --locked --no-sync ruff check .
uv run --locked --no-sync ruff format --check .
uv run --locked --no-sync mypy --strict src tests
PYTHONHASHSEED=0 uv run --locked --no-sync pytest -q --hypothesis-seed=20260712
PYTHONHASHSEED=0 uv run --locked --no-sync pytest -q --hypothesis-seed=20260712 --cov=quant_edge --cov-branch --cov-report=term-missing --cov-fail-under=95
uv run --locked --no-sync quant-edge registry-verify --registry registry/edge_hypotheses.v1.json --map EDGE_HYPOTHESIS_MAP.md
uv run --locked --no-sync quant-edge protocol-verify --repo-root ..
bash tests/q00/scope_guard.test.sh
```

The tests are network-free. Dependency vulnerability queries are deliberately separate because their databases are time-varying external evidence; exact commands and retrieval time live in `docs/Q01_DEPENDENCY_SECURITY_LICENSE.md`.

## Minimal CLI

The CLI accepts all state explicitly and emits canonical JSON:

```bash
uv run --locked --no-sync quant-edge config --run-id q01.fixture --as-of-ms 1783814400000 --seed 20260712 --truth-posture SYNTHETIC
uv run --locked --no-sync quant-edge seed-fixture --seed 20260712 --count 8
uv run --locked --no-sync quant-edge registry-verify --registry registry/edge_hypotheses.v1.json --map EDGE_HYPOTHESIS_MAP.md
uv run --locked --no-sync quant-edge protocol-verify --repo-root ..
```

Library imports do not read the environment, filesystem, network or wall clock. Filesystem and subprocess access exists only in the explicit CLI composition boundary. Missing dataset/model/economic truth remains `null` or unavailable; the package never fabricates confidence or an actionable recommendation.
