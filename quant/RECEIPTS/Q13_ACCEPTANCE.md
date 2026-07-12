# Q13 acceptance receipt — deep-sequence gate (shard)

Acceptance status: `ACCEPTED`

Date: 2026-07-13

Acceptance authority: Q13 shard lead under the standing full-evidence loop and
director order D-LAUNCH-5, verified at `fc267a3`.

## Accepted implementation commit

- C13: `d28131c7745dda884a8918aa8bf5279004615c05`
- Tree: `8f491ff65489e0c4740338f648c43d0aab1b1ebc`
- Exact parent/base: `f756f3b582f24857811e6ec4c0d08a3a61026b74`
- Immutable implementation receipt `quant/RECEIPTS/Q13.md` SHA-256:
  `b3108cb60401999581174ab6c8ecd8d17219ac8d44d98574673faa34620235be`
- First-written data-sufficiency receipt SHA-256:
  `64dd4d6c19d671937c048f8c00e6dbab19bff1f905aab53731c7659ecb583449`

Neither implementation receipt was rewritten after C13.

## Independent exact-commit verification

- Git identity: C13's exact parent is the assigned D-LAUNCH-5 base; C13 descends
  from the frozen protocol ancestor `73e1a1f`.
- Scope: exactly 24 changed paths, every one inside
  `quant/src/quant_edge/deep/**`, `quant/tests/q13/**`,
  `quant/generated/q13/**`, or `quant/TASKS|RECEIPTS|DECISIONS/Q13*`.
  No out-of-scope path and no change to the spine state, frozen protocol, registry,
  dependencies, Q10/Q11/Q14, product, runtime, UI, or root docs.
- Modes: all 24 C13 paths are regular `100644` additions.
- `git diff-tree --check C13^ C13`: exit 0.
- C13 artifact hashes equal every claim in the immutable receipt. The generated
  campaign is `e918dc41…087c`; the reference catalog is `f6dfb85d…d800e`.
- `quant/pyproject.toml` remains
  `a4d68e05b607e60a99fa3856ed8f8cd3addc80998c65ca6d458118745970ca81`;
  `quant/uv.lock` remains
  `716a9d0208f449bba51cde7fd67f9c90206ab0724aeac86ba862e119be859d29`.

## Clean archive verification

- `git archive` of exact C13 SHA-256:
  `d9d049fb981f6fb46bfed448554531d3a565cfc7300b2b70cd77354c6e38d618`.
- Archive extracted into a clean temporary directory; no working-tree or untracked
  owner input was present.
- `/Users/cosmosgeek/.local/bin/uv sync --all-extras --frozen`: exit 0 on the
  unchanged 68-package lock.
- Ruff lint and format-check: exit 0; strict `mypy --strict .`: exit 0,
  262 source files.
- With `TZ=Pacific/Kiritimati` and `PYTHONHASHSEED=314159`, focused Q13:
  `69 passed`; `quant_edge.deep` 100% statement/branch coverage (425/114).
- Under the same hostile environment, full quant: `2251 passed, 4 skipped`.
  The four skips are the pre-existing Q08 shard-only scope checks.
- The focused golden test re-generated every Q13 JSON/Markdown artifact and proved
  committed-byte equality under the changed environment.

The pre-commit worktree proof also passed Q13 plus unit `1217 passed`, full quant
with 100% total statement/branch coverage (17,342/5,868), frozen protocol `22/22`,
Q00 scope `6/6`, registry verification, `uv lock --check`, and root `npm test`
(377 underlying checks).

## Q13 acceptance condition

The data gate was evaluated before model construction and honestly failed:

- retained real evidence is only 832 BNBUSDT Spot aggregate trades on one historical
  day, with no complete historical L2, real point-in-time labels/outcomes,
  cost/actionability truth, independent multi-day/regime cohort, measured training
  budget, or untouched chronological holdout;
- simple MLP, DeepLOB-style, and TLOB-style candidates are all exactly
  `REFERENCE_ONLY`, each carrying the immutable receipt's exact evidence gap;
- no PyTorch/deep dependency, model, weights, score, training, benchmark,
  probability/calibration claim, holdout grant, or promotion path exists;
- the future Q14 binding is fail-closed at the actual report;
- adversarial fixture attacks prove Q14 rejects truthful future-value leakage as
  `REJECTED_TEMPORAL_LEAK` and rejects forged lineage as
  `REJECTED_IMPLAUSIBLE_SKILL`;
- missing cost truth yields 32/32 `ABSTAIN_UNKNOWN`, never zero.

This satisfies Q13 exactly through interfaces and deterministic fixtures. It does not
claim a deep model, actionable prediction, probability, or edge.

## Re-entry and integration boundary

A later revision needs a new immutable receipt proving all seven Section 14.8 facts
on one current cost-aware chronological cohort before implementing a simple MLP and
one shadow challenger. Q14 validation and cost evidence remain necessary but not
sufficient for promotion. The director may merge C13/A13 later; this shard does not
merge or push.

## Acceptance commit A13

A13 is the commit that first contains this immutable acceptance receipt and
generation-2 shard state; intentionally non-self-referential. Q13 is `ACCEPTED` at
A13. The final handoff records the resulting A13 SHA.
