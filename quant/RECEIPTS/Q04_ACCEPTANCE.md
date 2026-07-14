# Q04 acceptance receipt — exact local-book commit verification

Acceptance status: `ACCEPTED`

Accepted implementation commit C4: `668ab5d0548d1713c299e85972fcbc6433c59504`

Exact parent: `c7ff41c9f1a82aefd879f3f7ca56b29e5ea79b91`

Verification completed: 2026-07-12T12:42:50Z

Acceptance commit A4: the later commit that first contains this immutable receipt and generation-15 state; intentionally non-self-referential.

Acceptance authority: standing order D-LAUNCH-2 (`84d2ff65…`) self-acceptance with the full evidenced loop; lane operated by the Fable lead under D-LAUNCH-3 (`cf37df4a…`); subject to director audit at LANE_READY.

## Commit-object verification

- Canonical base `7010499170e24b31c9c0be2c9d73a536e680c6fe`, protocol `73e1a1ff7daa48df8dac45713fc5f106842edafc`, accepted Q03 `9e7d4aabae68a0e20479c389c0f08c33886bdeb4` and activation `c7ff41c9…` are ancestors of C4; the exact parent is the activation commit.
- C4 tree is `8611a1ac3c9f23fa61aa806ae5dcfc4e00e4f017`.
- C4 has exactly 21 changed paths, all under `quant/**`, all mode `100644`, with no symlink, submodule or executable; 20 additions plus the generation-14 state modification.
- The protocol-to-C4 history remains empty for `EDGE_PROTOCOL_V1.md`, `packages/edge-protocol/**`, `packages/edge-protocol-tests/**` and `quant/DIRECTIVE_INPUTS.lock` (scope gate `Q_SCOPE_OK`, 21 staged paths). The A3-to-C4 range touches no accepted Q00–Q03 receipt or task.
- `git diff-tree --check C4^ C4`: exit `0`.
- Q04 task SHA-256 `b75c17be4648da35bdab3966df6d05176fae714548ec4a14e52abb59b2083554`; blob `0afb5568245b9fc35a068f6c178ac89c6e38715b`; 155 lines; unchanged from activation.
- Implementation receipt SHA-256 `95b87d68b781f6cdeca560249d848fb7512d94b844051ce360bcd882c4f03a47`; blob `b19d7d4e1c96661e3809d12891f3f59a1591d93a`; 108 lines.
- Generation-14 state SHA-256 `64b9857df5abd40de478f7fce8e720b8afd63afa5f6589d8fb2902e5c531476c`; blob `d1a31bb57e5182e827ef9d9b45b27daabe7bdd25`; 261 lines, below the 300-line limit.
- Committed golden-fixture, campaign-JSON, campaign-Markdown and all five book-module blob hashes match the implementation receipt exactly (`32e13493…6aec`, `e9cd85c0…7334`, `321cb6c2…14b9e`, `be49645e…`, `f623db9a…`, `6027d6b8…`, `7e689bd7…`, `e7107837…`).
- The two owner-provided root directives remain the only preserved untracked inputs and were never staged.

## Exact-commit archive verification

C4 was exported with deterministic `git archive --format=tar`: 14,970,880 bytes, SHA-256 `b1680299466a2e903f9e5aad2a2bf8633539cf00ea2ba994d0dbe18e5f217918`. A clean locked environment (`uv 0.11.28 sync --frozen`, CPython `3.13.14`, 51-package resolution) was created from the archive copy and returned no blocker:

- Ruff lint and format: exit `0`; 74 files compliant.
- Strict mypy: exit `0`; 74 source/test files including the campaign script.
- Full fixed-seed Q suite: exit `0`, `1172 passed`; total coverage 5,223 statements and 1,864 branches, `100.00%`.
- Focused `quant_edge.book` coverage inside the same run: 1,020 statements and 302 branches, `100.00%`.
- The in-suite contract tests reproduced the committed golden fixture and campaign artifacts byte-for-byte, replayed both golden scripts to their exact result digests, and re-proved subprocess determinism under `TZ=UTC`/`PYTHONHASHSEED=0` and `TZ=Pacific/Kiritimati`/`PYTHONHASHSEED=987654`.
- Independently of the suite, the campaign script previously produced byte-identical artifact trees from two separate processes with different CWD, timezone and hash seed.

## Worktree-level verification after C4

- Accumulated Q00 scope suite: `6/6`, including the reverted out-of-scope history case with C4 present.
- Frozen protocol conformance: `22/22`.
- `npm test`: exit `0` with unchanged baseline subtotals (107/107, 124, 59/59 financial safety, 29/29 storage).
- Working tree clean except the two exempted owner directives.

## Acceptance conditions checked

- Both official product laws implemented exactly and separately with research-pinned citations; derived fail-closed refinements documented as derived; no blended law.
- Gap campaigns (unit case matrix, 120 seeded property schedules and the committed replay campaign) never expose a model-eligible book between anomaly detection and validated resynchronization; eligibility is provably `COMPLETE`-only.
- Clocks are injected and separated; Spot snapshots carry no fabricated exchange clock; receive time never impersonates exchange time.
- Replay is deterministic and byte-identical across hostile environment changes; the committed fixture binds exact digests.
- All Q04 evidence is honestly `SYNTHETIC`; real forward delivery remains `MISSING/BLOCKED`; no socket, REST, env, secret, storage or money/order/capital/risk path exists in the book package.
- Adversarial findings (replay counters, stream-id contract, unbounded intent window, unreachable branches, test-construction defects) were corrected before C4 with regression tests.

Q04 is `ACCEPTED`. The next bounded phase is Q05 (label and matched-control factory), activated by a separate task and activation commit.
