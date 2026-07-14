# Q07 acceptance receipt — exact microstructure-library commit verification

Acceptance status: `ACCEPTED`

Accepted implementation commit C7: `22ab5bc8db94bf92883fdeac2a397ebf8c132ca0`

Exact parent: `d0573734e2e2ab5576863ca5fe6875d770dfe68a`

Verification completed: 2026-07-12T14:49:52Z

Acceptance commit A7: the later commit that first contains this immutable receipt and generation-24 state; intentionally non-self-referential.

Acceptance authority: standing order D-LAUNCH-2 self-acceptance with the full evidenced loop; lane operated by the Fable lead under D-LAUNCH-3; D-LAUNCH-5 amendment verified (`d0e34f0310ebb5ad67b9c7f1ed4785a49a4bb0f8`): the spine parks after this acceptance; subject to director audit at LANE_READY.

## Commit-object verification

- Canonical base, protocol `73e1a1f…`, accepted Q06 `24ccf58…` and activation `d0573734e2…` are ancestors of C7; the exact parent is the activation commit.
- C7 tree is `919f86ce835dac86d9c534ff5734d4361c8198c4`; exactly 23 changed paths, all under `quant/**`, all mode `100644`; 22 additions plus the generation-23 state modification.
- The A6-to-C7 range touches no accepted receipt/task and no accepted `book`/`bootstrap`/`lake`/`labels`/`features` module; frozen protocol paths and the input lock remain untouched (scope gate `Q_SCOPE_OK`, 23 staged paths).
- `git diff-tree --check C7^ C7`: exit `0`.
- Q07 task SHA-256 `11da284da20e5fea637c3794a3cb328b4b2b3bbe65ba97df52005976b334338d`; unchanged from activation.
- Implementation receipt SHA-256 `06bcc7ca89160d9d6351ca26f0125bde48b064dbc8a049cad8ea6bf1b2292162`.
- Generation-23 state SHA-256 `bb992e2ca0eb0fd28b68a4b6e584157bd3688b7402719787b9e71d5b6204751b`; 299 lines, within the ~300-line guidance after compacting Q04/Q05 measurement detail into their immutable receipts.
- Committed fixture/campaign/script/design/decision blob hashes match the implementation receipt exactly (`d8308437…4ce3`, `dbb303be…a950`, `d1ab9605…7032`, `8cc7da7f…88cc`, `e9151a9f…ca3d`, `a7da1a54…3254`).
- The first C7 attempt carried a hand-expanded activation-SHA tail; the parent check caught it, and the unpushed, unreferenced commit was re-created with the true SHA before verification (recorded as receipt finding 7). This acceptance verifies the re-created C7 only.
- The two owner-provided root directives remain the only preserved untracked inputs and were never staged.

## Exact-commit archive verification

C7 exported with deterministic `git archive --format=tar`: 15,759,360 bytes, SHA-256 `6bdf3da023a1a333df89ac897f4edecc5ee7a61b7ac8140a612fb75c99e0a408`. A clean locked environment (`uv 0.11.28 sync --frozen`, CPython `3.13.14`, 51 packages) built from the archive returned no blocker:

- Ruff lint and strict mypy: exit `0`; 128 files.
- Full fixed-seed Q suite under hostile env (`TZ=Pacific/Kiritimati`, `PYTHONHASHSEED=987654`): exit `0`, `1456 passed`; total coverage 8,716 statements and 2,906 branches, `100.00%`.
- The campaign script re-run from the archive under the same hostile env reproduced the committed Q07 fixture and both campaign artifacts byte-for-byte; all earlier accumulated proofs (Q02 golden, Q03 evidence, Q04 replay, Q05 labels, Q06 features) re-passed from the archive.

## Worktree-level verification after C7

- Accumulated Q00 scope suite `6/6`; frozen protocol `22/22` and `npm test` exit 0 verified during the phase loop; working tree clean except the two exempted owner directives.

## Acceptance conditions checked

- Every implemented feature (16) carries a complete AlgorithmCard, golden examples, documented failure cases and a deterministic incremental-update benchmark; streaming/batch equivalence passes at the declared 0-ulp tolerance everywhere, on golden and seeded evidence.
- Every §13.1 bullet has exactly one honest recorded disposition; the blocked family names its missing evidence (cancellation/execution decomposition from public diff-depth) and nothing was fabricated to unblock it; spoof semantics never attribute individual intent.
- Measured update costs stay within declared bounds (`depth_resiliency` 8 ≤ 9; window features ≤ 16; ladder walks ≤ declared); wall-time evidence is stdout-only and never asserted.
- All evidence is honestly `SYNTHETIC`; no predictive, economic or spoofing claim exists; missing evidence is UNKNOWN, never zero.
- Adversarial findings (dead branches under strict-ordering invariants, unsorted card tuples, Kyle-slope missing-quote divergence, initially missing task deliverables, hand-derived test errors, the fabricated SHA tail) were corrected before this acceptance with regression tests or protocol reinforcement.

Q07 is `ACCEPTED`. Per D-LAUNCH-5 the spine now STOPS and PARKS: Q08/Q09/Q14 are shard-owned in separate worktrees and Q10+ waits for the director's shard merge onto this lane branch.
