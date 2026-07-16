# Q08 acceptance receipt — derivatives, Basis and cross-market library (shard)

Acceptance status: `ACCEPTED` (shard self-acceptance under D-LAUNCH-2/D-LAUNCH-5 terms; director audit occurs at merge-back, where the full accumulated lane suite runs).

Acceptance date: 2026-07-12

## Accepted commits

- Implementation commit C8: `4c9b02672aed7c02149fd7e37e9fd2ec5552107a`; exact parent = shard base `24ccf5880cbce8b1ee81ddd7d33f7c9c7271aacd`; tree `da7a50d205e8232b57d91d80d13195733b46b395`; 35 changed paths, all inside the D-LAUNCH-5 shard allowlist; immutable receipt `quant/RECEIPTS/Q08.md` blob SHA-256 `567ca1e189bd32d6eba504a9b9050e2cce8023e09f315467b56506451de9c4ad`.
- Correction commit C8.1: `6649749c700fbb6825f44e22bf551e82effea4d1`; exact parent C8; tree `0745bba06309f8b7959b64f7f1145643da0f7bdd`; 1 changed path (`quant/tests/q08/test_q08_scope.py`, SHA-256 `12a15ddf1c034f5955cc08a3bbd6aa9ebd7c7a135bd33422bcc844e9e9c5e120`). Finding from independent archive verification of C8: the four shard-scope tests failed in an exported archive because no Git history exists there; they now verify the resolved repository root and shard-base commit and skip with a stated reason outside the real worktree. Worktree behavior unchanged.
- Accepted shard HEAD for director merge-back: `6649749c700fbb6825f44e22bf551e82effea4d1`.

## Independent exact-commit verification

- Ancestry: `24ccf58..HEAD` contains exactly C8 and C8.1 with exact recorded parents; shard base is an ancestor.
- Scope: every committed path matches the D-LAUNCH-5 allowlist (verified by `git log --name-only`, by `quant/tests/q08/test_q08_scope.py` in-worktree, and by the lane guard `Q_EXPECTED_BRANCH=q08-derivatives-20260712 bash quant/scripts/check-scope.sh`, `Q_SCOPE_OK` at every staging).
- Frozen paths (protocol files, directive lock, `features`/`labels`/`lake`/`book`/`bootstrap`, `pyproject.toml`, `uv.lock`) byte-identical to the shard base; `git diff-tree --check` clean; all committed modes regular `100644`.
- Committed blob hashes equal the measured artifact hashes recorded in the immutable receipt (task `5be8a858…`, decision `13a85425…`, golden fixture `8820d4d5…`, campaign JSON `d2054e47…`, campaign Markdown `68a60221…`).
- Archive-derived verification at accepted HEAD (archive SHA-256 `51f37e3b0c49d417f41ddaf49bf7c1393df998826b02a82c397a56ddf8bf20ce`): clean locked install (uv `0.11.28`, CPython `3.13.14`), Ruff and strict mypy clean, quant suite `1565 passed, 4 skipped` (exactly the worktree-only scope tests, each with its stated reason), and `python -m quant_edge.derivatives.campaign` regenerated all three committed artifacts byte-identically.
- In-worktree at accepted HEAD: focused Q08 `197 passed` at `100.00%` statements/branches on `quant_edge.derivatives`; accumulated quant `1569 passed` at `100.00%` total; frozen protocol `22/22`; `npm test` exit 0 unchanged; Q00 lane scope guard `6/6`.

## §20 Q08 acceptance conditions verified

- Normal and reverse constructions remain distinct: distinct typed formulas over distinct crossed sides and denominators, typed legs that reject interchange, reverse-only borrow feasibility law, distinctness pinned in unit tests and in the committed golden fixture.
- Missing borrow or funding never becomes zero: unknown borrow yields UNKNOWN reverse edges with reason codes; known-unavailable borrow yields INFEASIBLE without value; missing/stale funding yields UNKNOWN/STALE with no value; one unknown cost component removes the net edge; all pinned by tests and goldens.

## Standing limitations

As recorded in the immutable `quant/RECEIPTS/Q08.md`: synthetic-only evidence, no predictive/validated/economic claim, top-of-book size feasibility only, mark/index paths unrepresentable pending proving evidence kinds, v1 gap modeling limits on OI/liquidation containers, deferred Granger/cointegration challengers.
