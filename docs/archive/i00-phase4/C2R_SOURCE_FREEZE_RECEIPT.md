# C2R source-freeze receipt

Date: `2026-07-16`

State: `C2R_SOURCE_FREEZE / LOCAL_ACCEPTANCE_PENDING / NOT_SELF_VERIFIED`

This receipt is committed atomically with the C2R source-freeze commit. A Git commit cannot name its own SHA or tree. Only the future sole-child seal S2 may bind exact C2R identity after complete exact-C2R acceptance passes. This receipt is not `INTEGRATION_CANDIDATE_READY`, independent verification, deployment evidence, or money authority.

## Immutable predecessor disposition

- Rejected candidate C remains `098f7b9449ab3b1c26bda19f51537bfea01d4c48`; its historical sole-child seal remains `517bd636d799c983ecddc9bda1985d0619b652d7`.
- Role 4 correction closure remains `37eeb5b006169ad1362ceaf060df678586738869`.
- C2 remains `449350d60ab30a385edeccdf4d91716ef8550537`, tree `58904993ee0d73576dc2715a78e7e249d1179fe7`, with exact ordered parents `517bd636d799c983ecddc9bda1985d0619b652d7` and `37eeb5b006169ad1362ceaf060df678586738869`.
- C2 Browser evidence passed. Its complete run stopped honestly at the stale donor-equality proof before performance, receipt rendering, or S2; C2 evidence cannot substitute for C2R evidence.
- No prior checkpoint, receipt, or commit was rewritten or relabeled.

## Director ruling and exact correction

- D-LAUNCH-47 is the immutable `QL_DIRECTOR_STATE.md` object at `723837873c4aef565eb1dea739c760f66252e1b9`.
- D-LAUNCH-48 is the immutable `QL_DIRECTOR_STATE.md` object at `4f3e10f2f0371278c4c953501c4ca532d6fe2f78`.
- Required-last L remains merge `ec82bc51d5311dfb3f505216bfb3fa41733f038c`, first parent `139d2cf07ffd3167bd54a3c14c0fc6671c2f02e9`, and donor/second parent `df6b472993ca9659ce09cf5f72004981c6835f0d`.
- The only authorized merge reachable after L is exact C2 `449350d60ab30a385edeccdf4d91716ef8550537`.
- The proof-owned immutable allowlist is exactly `[449350d60ab30a385edeccdf4d91716ef8550537]`. It is not caller-configurable. Missing, substituted, appended, or widened post-L topology fails `POST_L_MERGE_ALLOWLIST_MISMATCH`.
- Candidate receipt validation independently requires the same exact L identities and post-L allowlist. No compatibility alias retains the stale `noLaterMerge` assertion.
- No product, runtime, strategy, risk, execution, persistence, UI, or authority-owner source was changed. The correction is confined to the donor-equality command, its focused tests, and the necessary complete-acceptance proof consumer/contract tests.

## Focused evidence before C2R

| Command | Result |
| --- | --- |
| `node --test --test-concurrency=1 --test-reporter=spec test/i00/commands/donor-equality.test.mjs` | Exit `0`; `9/9` |
| donor proof against C2 topology | `PASS`; exact `16/16/16/16`; failures `[]`; exact L parents preserved; observed post-L merges equal the exact singleton allowlist |
| `npm run test:i00:commands` | Exit `0`; `28/28` |
| `npm run test:i00:acceptance-contract` | Exit `0`; `43/43` |
| independent read-only patch review | `PASS`; exact topology, hostile cases, downstream receipt binding, and `git diff --check` verified |
| `git diff --check` | Exit `0` |

These focused gates prove the bounded proof-harness correction. They do not substitute for the exact-C2R complete gate.

## Protected owner inputs and authority boundary

Exactly five physical regular owner directives remain untracked, unstaged, and hash-exact:

| Path | SHA-256 |
| --- | --- |
| `I00_PRODUCT_ASSEMBLY_CONTROL_ROOM_AND_LIVE_BRINGUP.md` | `9d7a36da6a2e6e7b3e905c73161b5e998a2f92416dd557e498ade3e73d5e5ef5` |
| `IP_RUNTIME.md` | `6e93016e3177db69a26844c12e6449d9afac1700e9946570a243051645565810` |
| `IP_CONTROL.md` | `5e57bf1d019f761731857be7a1c46c5b06eb7f80db9709d5425bbea749fb7278` |
| `IP_OPS.md` | `2af8348906f9306765a0d0d57f21b01349767e6115f04f43ce00fa6328f1b779` |
| `IP_PROOF.md` | `e59d516ba9acb9a7bb1ce63ca149ce662f308a0fd0900b72db3d2fe2e8bb93b6` |

Forbidden and not performed: `current-main` write, push, self-certification, new worktree creation, private read, signed call, AWS/Cloudflare mutation, deployment, test/live order, borrow/repay, leverage or margin mutation, transfer, withdrawal, or any money action. `LIVE_EXECUTION_NOT_IMPLEMENTED` remains enforced.

## Next exact transition

1. Freeze this exact commit as C2R and do not mutate its source.
2. Produce a fresh exact-C2R six-run Browser receipt; C2 bytes remain immutable and non-substitutable.
3. Run `npm run test:i00:complete -- --run ...` from exact C2R with the accepted Q virtualenv and immutable evidence.
4. Only if every step passes, render the canonical candidate receipt and create exactly one sole-child S2 that binds exact C2R SHA/tree and records both C2 and C2R.
5. A different fresh session must run validate-only. Until then, candidate readiness is not claimed.
