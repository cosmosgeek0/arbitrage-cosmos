# Q05 acceptance receipt — exact label-factory commit verification

Acceptance status: `ACCEPTED`

Accepted implementation commit C5: `a1baa003b2d9a1c746fe55956cad7b9633bcecdd`

Exact parent: `a8e701e3d191561035753e5298bdf5c25dc3194f`

Verification completed: 2026-07-12T13:32:15Z

Acceptance commit A5: the later commit that first contains this immutable receipt and generation-18 state; intentionally non-self-referential.

Acceptance authority: standing order D-LAUNCH-2 self-acceptance with the full evidenced loop; lane operated by the Fable lead under D-LAUNCH-3; subject to director audit at LANE_READY.

## Commit-object verification

- Canonical base `7010499…`, protocol `73e1a1f…`, accepted Q04 `3455216…` and activation `a8e701e…` are ancestors of C5; the exact parent is the activation commit.
- C5 tree is `f59734a85329a55aa76d98432b76c090646c9206`.
- C5 has exactly 28 changed paths, all under `quant/**`, all mode `100644`, with no symlink, submodule or executable; 27 additions plus the generation-17 state modification.
- The A4-to-C5 range touches no accepted receipt/task and no accepted `book`/`bootstrap`/`lake` module; the frozen protocol paths and `quant/DIRECTIVE_INPUTS.lock` remain untouched throughout (scope gate `Q_SCOPE_OK`, 28 staged paths).
- `git diff-tree --check C5^ C5`: exit `0`.
- Q05 task SHA-256 `b2bb8c1404bf9fc655aefd11bc63e4c82598fb76036eeb28fd653a8a1adae232`; unchanged from activation.
- Implementation receipt SHA-256 `36b34d000d3f02af8180f047b83a65a718cb713639987aebc90249bd171272b9`.
- Generation-17 state SHA-256 `3c9f3a9a765445d4547a7f0a7bf676ff2a6bbffab606ba1650633aa8a39ac5e7`; 287 lines, below the 300-line limit.
- Committed golden-fixture, campaign-JSON, campaign-Markdown and module blob hashes match the implementation receipt exactly (`f36a9b08…fe47`, `9a5e5dcc…0c7e`, `e6daad17…d6b9`, ten `labels/*.py` digests).
- The two owner-provided root directives remain the only preserved untracked inputs and were never staged.

## Exact-commit archive verification

C5 was exported with deterministic `git archive --format=tar`: 15,329,280 bytes, SHA-256 `8628e338beb21274b473819bf0d32bc7d62c5a29829f71c1b373d170a796b0e9`. A clean locked environment (`uv 0.11.28 sync --frozen`, CPython `3.13.14`, 51-package resolution) was created from the archive copy and returned no blocker:

- Ruff lint and format: exit `0`; 95 files compliant.
- Strict mypy: exit `0`; 95 source/test files including both campaign scripts.
- Full fixed-seed Q suite: exit `0`, `1298 passed`; total coverage 6,744 statements and 2,406 branches, `100.00%`.
- The in-suite contract tests reproduced the committed Q05 fixture and campaign artifacts byte-for-byte and re-proved subprocess determinism under `TZ=UTC`/`PYTHONHASHSEED=0` and `TZ=Pacific/Kiritimati`/`PYTHONHASHSEED=987654`; the Q04 golden replay and all earlier accumulated proofs also re-passed from the archive.
- Independently of the suite, the Q05 campaign script previously produced byte-identical artifact trees from two separate processes with different CWD, timezone and hash seed.

## Worktree-level verification after C5

- Accumulated Q00 scope suite: `6/6`. Frozen protocol conformance: `22/22`. `npm test`: exit `0` with unchanged baseline (verified during the phase loop).
- Working tree clean except the two exempted owner directives.

## Acceptance conditions checked

- No feature can observe its own future label interval: the §11.7 seven-law matrix passes one-for-one, including pre-cutoff digest invariance under future-value injection and label-end movement.
- Controls are reproducible, matched on symbol/liquidity/volatility/regime/time-of-day/funding-cycle/completeness, and provably non-overlapping with event feature/label intervals; no future-membership field exists.
- Outcome/stage/Basis/disposition semantics follow the directive vocabularies exactly; unknown stays unknown; gaps are `DATA_INVALID`; truncation is `CENSORED` with explicit times; no float enters any numeric path.
- Every label artifact carries complete point-in-time lineage and versioned definitions; cost/execution-assumption changes change identities.
- All evidence is honestly `SYNTHETIC`; real label coverage is recorded as `DATA_INSUFFICIENT`; no new external data entered the lane.
- Adversarial findings (pre-validation AttributeError, dead residual branches, control-pool duplicate ids, test-construction defects) were corrected before C5 with regression tests.

Q05 is `ACCEPTED`. The next bounded phase is Q06 (feature registry and robust baselines), activated by a separate task and activation commit.
