# Q01 acceptance receipt — exact implementation commit verification

Acceptance status: `ACCEPTED`

Accepted implementation commit C: `73330e281c7a91fa5fba2059570e9619f9ade34d`

Exact parent: `90e1ef89edd4cc449664ac05cb429448e0bac6f0`

Verification completed: 2026-07-12T06:12:57Z

Acceptance commit A: the later commit that first contains this immutable receipt and generation-6 state; intentionally non-self-referential.

## Commit-object verification

- Canonical base `7010499170e24b31c9c0be2c9d73a536e680c6fe` and protocol commit `73e1a1ff7daa48df8dac45713fc5f106842edafc` are ancestors of C.
- C has exactly 32 changed paths: 31 additions and one build-state modification.
- Every changed path is under `quant/**`; no outside path and no frozen `quant/DIRECTIVE_INPUTS.lock` path is present.
- The C range is empty for `EDGE_PROTOCOL_V1.md`, `packages/edge-protocol/**`, `packages/edge-protocol-tests/**` and `quant/DIRECTIVE_INPUTS.lock`.
- `git diff-tree --check C^ C`: exit `0`.
- The task is unchanged from parent through C; SHA-256 `8c830de5b97673dc6593bb29adcedaa26542d9c2060ceaa4d7ba8e4dde2c22ee`.
- Implementation receipt SHA-256 is `254b638eaa00b3f2ea06f12a3c5b460ac330c0ca5e48236042ea97ddb543114e`, exactly matching generation-5 state.
- Generation-5 state SHA-256 is `2f0a5cb30e5b6642f09ea40fdab8962be323a7f3e0b47c6e4eca26aa190cc1ba`; 173 lines, below the 300-line limit.
- The deterministic full-repository C archive SHA-256 is `c4e53bd84e1cb928791e23c5db600d2b008db03326ca2c767bb7de0578db42b0`.
- The two owner-provided root directives remain the only untracked files and were never included.

## Critical committed hashes

| Artifact | Verified SHA-256 |
| --- | --- |
| `quant/pyproject.toml` | `a782bc239e433073409e893da7b6e806fbf30f90bea3820ca3f808e60e53d36a` |
| `quant/uv.lock` | `3449f6eb892e2e5dd27dd48a735f9fe30d1ddfb38f16d858bba60202f5f4ed81` |
| hypothesis Markdown | `234b0daf3086ce6e3a27fd96fa48581370bbdc427fb76cef63197fc6b303d3b4` |
| hypothesis registry | `24c78ece6b0d6fb7307ba3b6fb01a396632db5ca557a7d52889e890b3912425e` |
| deterministic seed fixture | `b01207e33339c44e15500091ea52a019a2983a69b3702da46f87f9a04804cd05` |
| framework adoption evidence | `0a34c7f700e39282b8bb068e1d0854556123ff16d9a338a4d7ac5ae5892cf668` |
| dependency security/license evidence | `4a366e39b9ca349a6eb056e8433e2b86e7daa47d737759fd3dd6aa51e3eb26aa` |
| durable audit summary | `3284393f4c4d572dbb1ea4ec43f9953bda9a36274122f2487e9778fc1e74391e` |
| durable license inventory | `1055ace0fc9bbd78c4be8930244da8c821a0dedba6df9d4b584571aa5c6ac834` |
| Q01 decision | `5302e0930a482781b40c65cd5ef522626798febb7f7681cbf02a5c4c80de2e34` |
| frozen directive-input lock | `410010ef635a5e44b205e56c6b38f2d06e5b8e72312f5d63edcb24a5086355e1` |

## Exact-commit archive verification

C was exported with `git archive` into a new directory and tested with a new `/tmp/q01-c-venv`, so verification did not depend on uncommitted Q01 source:

- CPython `3.13.14`; `uv lock --check` and `uv sync --locked --all-groups`: exit `0`, 51 resolved entries / 50 installed packages plus local project;
- exact package/framework imports: `quant-edge-research 0.1.0`, DuckDB `1.5.4`, Polars `1.42.1`, PyArrow `25.0.0`;
- Ruff lint and format: exit `0`, 17 files formatted;
- strict mypy: exit `0`, 17 source files;
- pytest/coverage: exit `0`, `88 passed`, branch coverage `96.71%` versus `95%` floor;
- registry/map: exit `0`, 8 families, statuses `DATA_INSUFFICIENT=5`, `RESEARCH=2`, `UNTESTED=1`;
- frozen protocol: exit `0`, `22/22`, output SHA-256 `6591ec8e208d1c17f43c99522660d8d7f1d039347a3ea7b0aecd986e6b0c8d54`;
- separate seed processes: byte-identical to committed fixture, SHA-256 `b01207e33339c44e15500091ea52a019a2983a69b3702da46f87f9a04804cd05`;
- accumulated Q00 scope suite: `6/6`.

The independent commit auditor separately returned `VERIFIED` for parent, ancestry, changed-path scope, frozen emptiness, receipt/state/task/artifact hashes and exact-commit protocol/scope evidence.

## Acceptance judgment

Q01 satisfies its task and directive acceptance conditions:

- clean hash-locked environment, import, CLI, lint, typing, tests, coverage and deterministic fixture pass;
- direct/transitive dependencies are pinned and security/license evidence is durable with explicit external limitations;
- library configuration, clock and randomness are injected; ambient environment/network/filesystem/wall-clock state is absent;
- mandatory H1–H6 meanings are preserved and the H1–H8 portfolio makes no edge/profit/intent/probability/actionability claim;
- protocol verification is hostile to arbitrary-executable/empty-output false greens;
- malformed, oversized, deep, noncanonical and Unicode-hostile inputs fail nonzero without traceback;
- no authority duplication, money path, secret/env read, external dataset, production source or frozen/shared edit exists;
- independent adversarial review ended with `SEAL`, no P0–P3 findings.

Q01 is accepted. Q02 remains `NOT_STARTED`; activation requires a new bounded task after this acceptance commit exists. Never rebuild or rewrite accepted Q01 artifacts during resume.
