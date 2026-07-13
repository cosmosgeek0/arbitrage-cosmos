# L09 state — normal Basis lifecycle shard

Generation: `7`

Status: `BLOCKED_UNRESOLVED_ACCEPTANCE_GAPS`

Implementation acceptance: `NO`

Integrated acceptance: `NO`

Surviving correction: `BUILT_AND_TESTED_NOT_PHASE_ACCEPTED`

## Git and frozen inputs

- Worktree: `/Users/cosmosgeek/Desktop/l09-normal-basis`.
- Branch: `l09-normal-basis-20260712`.
- Director F-BRIDGE integration merge:
  `ecd800679ded1fe21e3d9e97774bbfcaa9341070`.
- F-BRIDGE accepted implementation/test cut:
  `1e9d28a565935d3cb1aa6c98a209697d9fabdf05`.
- F-BRIDGE acceptance documentation:
  `a0c0c2e5ef3180aa720488463643433cefeb65e5`.
- F-BRIDGE director merge/current-main merge-base:
  `c9009079b0c27c2a7e2d1a0111a022bceb2e61db`.
- Prior L09 implementation:
  `36d5e2a39b013b51d2b932f902ec272c9217c23c`.
- Surviving correction:
  `a7a0f7c8f154539b05b7fb9845f1a4a3dec60eb8`.
- Correction tree:
  `27c688759a74026a15ea63c3300545c191c10cc2`.
- Rejected emergency acceptance checkpoint:
  `2fdb6806e35da404134dbc537695f2860a369078`.
- Frozen protocol SHA:
  `73e1a1ff7daa48df8dac45713fc5f106842edafc`.

The correction changes exactly six source files, three test modules and one
fixture under the exclusive normalBasis implementation namespaces. No shared
owner changed.

The owner inputs remain untracked and unstaged:

- `DIRECTOR_Q_L_TWO_LANE_LAUNCH.md` SHA-256:
  `26b1d5ce118982b4b3ba64b44b7fb3e88b0b7ded26a818a775a65bffaa0f2c06`.
- `LIVE_EXECUTION_REALISM_CONTROL_PROOF_12H.md` SHA-256:
  `40de1feb6678d8741bd38f7538b2c6f25304c0f64195a596961fdb2539a3b037`.

Both identities match `live-edge-receipts/DIRECTIVE_INPUTS.lock`.

## Surviving implementation truth

- F-BRIDGE closes shared opening-remainder and cold-restart gaps.
- `a7a0f7c` materially closes L09-003 groups 3–4: real owner identities,
  canonical checkpoint hydration/reconciliation, recovery lineage and exact
  mutation binding.
- Source aggregate SHA-256:
  `e541485191e43df3bb1dcde0756cc5f04640953a9d3acf7a75affce1c6bcb848`.
- Test-namespace aggregate SHA-256:
  `79a32ba6d067b44874944b6d416830613cf135435ce2db92bb053b89a699595d`.
- Ten-path aggregate SHA-256:
  `4b48e80b7f2cc21d71436de61f5086396719566ee8ac319ec26f972656664a20`.
- Wiring: `UNWIRED`; money authority and external actions: `NONE`.

## Blocking findings

1. Conflict-free one-way USD-M position/open-order truth is not proved.
2. Base-asset fee-adjusted Spot exposure is not modeled.
3. `reduceOnly`/`positionSide` are not bound to complete runtime twin request
   evidence.
4. Venue-arrival expiry is not checked against accepted policy/proposal expiry.
5. A binary64 Foundation partial-close residual can reject matching exact
   decimal venue owner truth.
6. `REJECTED`/`EXPIRED_IN_MATCH` vocabulary and terminal-partial preservation
   are not proved.
7. `FAILED` agreement is absent, and partial/rejected/terminal-partial close
   plus close/recovery cold-restart matrix rows remain missing.
8. The non-green full System Integration result has no explicit director
   baseline-exception ruling for L09 acceptance.

The earlier deep-copy/freeze finding is materially resolved by `a7a0f7c`.

L09-003 made groups 1–5 independently blocking. The later group 3–4 assignment
does not explicitly supersede groups 5–6. The acceptance verdict in `2fdb680`
is therefore rejected.

## Measured recovery verification

- Server build: exit `0`.
- Normal Basis: `23/23`, exit `0`.
- Exchange twin: `78/78`, exit `0`.
- Execution policy: `49/49`, exit `0`.
- Foundation execution: `173/173`, exit `0`.
- Frozen protocol: `22/22`, exit `0`.
- Import purity: `4/4`, exit `0`.
- `npm test`: `377/377`, exit `0`.
- System Integration: `179/180`, exit `1`; expected `PARTIAL`, actual
  `DIVERGED` at
  `server/test/systemIntegration/verticalSlice/authority.scenarios.test.mjs:521`.
- `git diff --check`: pass.

The shared mismatch has no normalBasis import and relevant blobs are unchanged
from `ecd8006`; it is not an L09 regression and is not represented as green.

## Durable blocked disposition

- Decision:
  `live-edge-receipts/DECISIONS/L09-005-EMERGENCY-CHECKPOINT-AUDIT-BLOCKERS.md`.
- Receipt:
  `live-edge-receipts/RECEIPTS/L09_BLOCKED_EMERGENCY_CHECKPOINT_AUDIT.md`.

This generation cannot record the SHA of its own containing blocked-audit
commit. A following state-only seal records that commit, tree and both content
hashes without changing implementation, decision or receipt.

## Current posture and non-claims

- L09: `BLOCKED_UNRESOLVED_ACCEPTANCE_GAPS`.
- Implementation: `BUILT_AND_TESTED_NOT_PHASE_ACCEPTED`.
- Wiring: `UNWIRED`.
- Money authority: `NONE`.
- External actions: `NONE`.
- Secrets inspected: `NONE`.
- Live/test/signed orders or private reads: `NONE`.
- Merge/push: `NONE`.

All artifacts remain PAPER/synthetic, non-sendable, `NONE_RECORD_ONLY`, with
external authorization `NONE`. `LIVE_EXECUTION_NOT_IMPLEMENTED` remains
enforced.

## Exact resume

- Current step: `6/7` — emergency checkpoint audit and blocked documentation
  complete in the containing commit.
- Exact next task: record that commit SHA/tree plus the L09-005 decision and
  blocked-receipt SHA-256 values in this state file only, commit the state-only
  seal, then stop `BLOCKED`.
- Do not modify implementation. Resume implementation only after the explicit
  director ruling or bounded authorization required by L09-005.
