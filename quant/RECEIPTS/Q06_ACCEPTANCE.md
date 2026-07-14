# Q06 acceptance receipt — exact feature-registry commit verification

Acceptance status: `ACCEPTED`

Accepted implementation commit C6: `3bf9e2a775c0aa91a29ab2f67c27544b9ddc6602`

Exact parent: `8f0af66df40843c8ca0fabca065ebd1b38df5686`

Verification completed: 2026-07-12T13:59:00Z

Acceptance commit A6: the later commit that first contains this immutable receipt and generation-21 state; intentionally non-self-referential.

Acceptance authority: standing order D-LAUNCH-2 self-acceptance with the full evidenced loop; lane operated by the Fable lead under D-LAUNCH-3; subject to director audit at LANE_READY.

## Commit-object verification

- Canonical base, protocol `73e1a1f…`, accepted Q05 `8986653…` and activation `8f0af66…` are ancestors of C6; the exact parent is the activation commit.
- C6 tree is `e183d53c1cc0d2866211824cde020e6149147a85`; exactly 24 changed paths, all under `quant/**`, all mode `100644`; 23 additions plus the generation-20 state modification.
- The A5-to-C6 range touches no accepted receipt/task and no accepted `book`/`bootstrap`/`lake`/`labels` module; frozen protocol paths and the input lock remain untouched (scope gate `Q_SCOPE_OK`, 24 staged paths).
- `git diff-tree --check C6^ C6`: exit `0`.
- Q06 task SHA-256 `c68962f1267c09e5fa88abf0c80418981d82d320ed1bdd936ab42e44f86cf59f`; unchanged from activation.
- Implementation receipt SHA-256 `084836741fd74759b526760d6b2657deb7137d6d1f4ce227565dfb63ed26bddf`.
- Generation-20 state SHA-256 `3dd1192d49d4b47cd34f9e45f602b72da11ec8d314cfeaff9b3dbaf2208f91f3`; 314 lines — slightly above the ~300-line guidance; the generation-21 state compacts historical measurement detail back under the limit (full detail remains in the immutable receipts).
- Committed fixture/campaign/script blob hashes match the implementation receipt exactly (`06c81655…abb3`, `51b87e70…da0c`, `622d580f…3a42`, `65977b1c…5634`).
- The two owner-provided root directives remain the only preserved untracked inputs and were never staged.

## Exact-commit archive verification

C6 exported with deterministic `git archive --format=tar`: 15,523,840 bytes, SHA-256 `50c15a2fad7f158228cfb0061525e547a2abb7c3ca0ce3fe199b55ac5c5f0f27`. A clean locked environment (`uv 0.11.28 sync --frozen`, CPython `3.13.14`, 51 packages) built from the archive returned no blocker:

- Ruff lint/format and strict mypy: exit `0`; 112 files.
- Full fixed-seed Q suite: exit `0`, `1372 passed`; total coverage 7,829 statements and 2,704 branches, `100.00%`.
- In-suite contract tests reproduced the committed Q06 fixture and campaign artifacts byte-for-byte and re-proved subprocess determinism under two hostile environment combinations; all earlier accumulated proofs (Q02 golden, Q03 evidence, Q04 replay, Q05 labels) re-passed from the archive.

## Worktree-level verification after C6

- Accumulated Q00 scope suite `6/6` with C6 in history; frozen protocol `22/22` and `npm test` exit 0 verified during the phase loop; working tree clean except the two exempted owner directives.

## Acceptance conditions checked

- Streaming and batch golden vectors agree within each card's declared tolerance (measured EWMA drift 2 ulp against declared 64; all other features 0 ulp); the harness fails disagreement and the report contract cannot claim otherwise.
- Every registered feature carries the complete §12 card; the registry digest and Markdown projection are deterministic and drift-rejected.
- Baselines are context-conditioned and history-gated (`UNKNOWN`, never fabricated); all four sampling domains carry explicit boundary and empty/incomplete-bar truth; volume bars refuse unknown volume.
- Quality/freshness propagation never upgrades a status; a value exists only when `AVAILABLE`.
- All evidence is honestly `SYNTHETIC`; deferred §12.3 diagnostics are recorded as deferred with reasons.
- Adversarial findings (batch-EWMA unit error, feature-id law, slots violation, dead branches, coverage-exposed test defects) were corrected before C6 with regression tests.

Q06 is `ACCEPTED`. The next bounded phase is Q07 (microstructure and liquidity library), activated by a separate task and activation commit.
