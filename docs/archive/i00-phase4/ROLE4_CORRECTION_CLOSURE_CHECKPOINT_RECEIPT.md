# Role 4 Phase 4 correction-closure checkpoint receipt

Date: `2026-07-15`

Status: `CORRECTION_SOURCE_VERIFIED / C2_LIVE_ACCEPTANCE_BLOCKED / NOT_CANDIDATE_READY`

This receipt closes Role 4's correction branch without relabeling it as C2. The
tested correction source is commit
`35bcfe96314f5047957bdff251831ab309c9be19`, tree
`82c359b0baaeb1ec5c605340addaa1bb487384fd`, on branch
`role4-fix-20260715`. The commit containing this receipt is a documentation-only
checkpoint child of that tested source; it is not a source freeze, candidate,
seal, or certification.

## Correction closure

- Governing Role 3 findings: `15`; fixed: `15`; evidence-refused: `0`;
  pending: `0`.
- Independent FIX_AUDIT rows: `12 COVERED`; `0 PARTIAL`;
  `0 REGRESSION_RISK`.
- BACKUP-008 source and hostile regression are bound in commit
  `bc39e9b989d37d12c77ed3854adca97a847f51de`.
- R3-STATE-013 denominator correction is bound in commit
  `643d2e3e4d123edeaef550b4f050b7f7db7bbfaa`.
- Closure evidence and BACKUP-008 audit disposition are bound in commit
  `9cc41eee782ccb31c99bbffd2ab7dcb99236cdac`.
- CLEAN-009 independent aggregate/performance bytes are bound in commit
  `35bcfe96314f5047957bdff251831ab309c9be19`.

The late post-publication BACKUP probe was adjudicated `NO_CHANGE`: it mutates
the canonical database after that object's exact post-rename proof, which is
the receipts' explicit subsequent same-UID target-mutation limitation, not the
original staged-byte publication defect. A final rehash only moves that race;
closing it requires a different OS principal or atomic-generation publication
contract. The original staged database, evidence, report, and sparse-growth
attacks all fail in the `109/109` focused regression.

## Exact correction-source verification

All commands below ran from the tested source with zero Git status bytes before
report regeneration. No protected directive was created, copied, edited,
staged, or committed.

| Command or artifact | Result |
| --- | --- |
| `npm run typecheck` | Exit `0`; server and web pass |
| `npm run build` | Exit `0`; server and web pass; Vite `1,883` modules |
| `node server/test/gates.mjs` | Exit `0`; `82/82` |
| `npm run test:product-control:built` | Exit `0`; `102/102` |
| `npm run test:i00:proof:built` | Exit `0`; `47/47` |
| targeted inventory regression | Exit `0`; `1/1` |
| `bash ops/tests/i00/test-r3-d-backup-008.sh` | Exit `0`; `109/109` |
| `npm test` | Exit `0`; local log `45,121` bytes; SHA-256 `6d7fdd3f1f26e9efcf76060edd9be41c2487bd851f18cf71935bf48fc84e3866` |
| `npm run test:all` | Exit `0`; local log `434,100` bytes; SHA-256 `1680c390fcb565dcfb073506d6d9ded2c6bda1376d75e51595ba84456c99f4fb` |
| `bash ops/tests/run-all.sh` | Exit `0`; `12/12`; `384` total cases including the 35-case lane gate; local log `31,322` bytes; SHA-256 `99c74ed2aa872cf3c8073f975000e24b2b8c69add98a4c30afaeec3f5206d36d` |
| `bash ops/tests/i00/run-all.sh` | Exit `0`; `12/12`; `725` additive assertions; local log `10,934` bytes; SHA-256 `4a2a071137de85b6619956479317e37d9d3fedea478a1dca5b9af1b313181e21` |
| report regeneration and proof runner | Exit `0`; `47/47`; two consecutive regenerations byte-identical |

`npm run test:all` includes Product Assurance `518` scanned files,
`205/205` operation sites, `802` behavior plus `4` provenance proofs; app
`82/82`; System Integration `401/401`; Product Integration `111/111`;
Product Control `102/102`; I00 proof `47/47`; I00 commands `28/28`; and
live-edge `1618/1618`.

The regenerated artifact SHA-256 values are:

- `MISSION_COVERAGE_MATRIX.md`:
  `27ce42fd293983ef471c6038afc6b428411e2669de435635a156fc464a1e175e`;
- `AUTONOMY_CLOSURE_REPORT.md`:
  `9736d6be7eba903579f97f27e2eacb202c0f6765c227f1b3633464d86318f1ee`;
- `NO_TERMINAL_DEPENDENCY_REPORT.md`:
  `b999e6a07341275fbd80a2d0b612481a0a39ad4d68bcdb8656029aa4748a3ee3`;
- `RESOURCE_AND_BACKPRESSURE_REPORT.md`:
  `a90824b0e0e3e07b63436204fa3ddc2ce1fb3b9a34a6c2fb2180731abfcd3354`;
- `OFFICIAL_INTERFACE_MATRIX.md`:
  `d2d9cdb2dc7e6c9f38679e90e092a88f5899e32fa64b22f2be54657d2083f3ff`;
- `integration/reports/i00-proof-evidence.json`:
  `d3a67b8658c7ea441a086c11e84e1147633c15ed037c05527154ba4354f05df5`.

## Exact complete-acceptance blocker

Literal `npm run test:i00:complete` exits `0` only in `PLAN_ONLY` mode; its
`2,437`-byte local output has SHA-256
`47bfd0b34141849ceb7a1664f85de18b425ac92618c8e9fd97898ec16cdfdf4c`.
The effectful entry was invoked with deliberately unused placeholder paths so
that source identity was the first real preflight. It exited `1` immediately:

```text
LOCAL_COMPLETE_ACCEPTANCE_FAILED:INTEGRATION_BRANCH_REQUIRED:role4-fix-20260715
```

That `238`-byte local output has SHA-256
`188baa78d19d7cc6da215b0c6fa9f983c260e9534f053ae5c5c850f6be85d1e2`.
No Q, browser, performance, source-freeze, evidence, or complete-receipt step
ran.

The same unchanged harness additionally requires five exact physical regular
untracked owner directives in integration/pre-seal mode. All five are absent
in this checkout:

- `I00_PRODUCT_ASSEMBLY_CONTROL_ROOM_AND_LIVE_BRINGUP.md`;
- `IP_CONTROL.md`;
- `IP_OPS.md`;
- `IP_PROOF.md`;
- `IP_RUNTIME.md`.

The tracked verifier bundle is explicitly `VERIFIER_ONLY / NOT_LIVE_OWNER_INPUT`
and cannot satisfy this provenance law. The user forbade touching other
worktrees and protected owner inputs, so Role 4 had no authority to move the
correction source to the required branch or supply the missing live inputs.

## Terminal ruling

This checkpoint is clean correction closure only. It is not C2, has no S2,
contains no candidate receipt, is not parked as an integration candidate, and
does not authorize `INTEGRATION_CANDIDATE_READY`. No push, merge, deployment,
private/signed call, external mutation, or money path was performed.
