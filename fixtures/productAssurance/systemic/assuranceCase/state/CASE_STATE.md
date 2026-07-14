# S4 assurance-case packet state

State: **CASE_PRESTAGE_READY**

This state accepts only the packet-local S4 assurance-case artifact. It grants
no runtime, supervisor, Risk, Capital, execution, Control, persistence, repair,
deployment, external-configuration, integration, or I00 authority.

## Identity

| Field | Value |
| --- | --- |
| Branch | `ip-assur-case-20260713` |
| Assigned base | `c57610cb5f7d56efb61e53ae27057fbe92a6a2f6` |
| Original implementation | `2f20acddcfbaba8db042fab024443924f7dee7d3` |
| D-LAUNCH-16 ruling | `a4a8ebd349e638e047a9ebf20bf6ec170376d08e` |
| Scope baseline | director merge `2d840599c716b5da8f5c42a272fc2232792f868c` |
| Accepted source | commit `c2201cf91a60387d2cd6901cb42f1c3532ca9b53`, tree `50ed5f8408cd6e575e8d10314ca6c0c5306b48a1` |
| Accepted fixture subtree | `691930c526556bb14b310daa21f2b66aecf1aea3` |
| Accepted test subtree | `69c0f1c60912fb8a71b930cad0027f14d1f38484` |
| Accepted S1 input | `ip-assur-hazard-20260713` at `ab33b3712cddd67c3ec91cfa1dd232c75226cd9f` |
| Truth label | `SYNTHETIC_ONLY` |
| Authority effect | `NONE` |
| Seal date | `2026-07-14` (`Asia/Kolkata`) |

## Acceptance truth

- D-LAUNCH-16 exempts the latest qualifying two-parent `director:` merge from
  the worker allowlist. The scope gate now preserves assigned-base ancestry but
  checks every worker commit after that merge plus all staged, unstaged, and
  untracked paths. The two allowed roots were not widened.
- Exact-source scope/import purity passes `7/7`; the full S4 suite passes
  `233/233`; all `32` packet/test `.mjs` files pass syntax checks.
- Exact-source `npm test` and `npm run test:all` both exit `0`; the latter ends
  with System Integration `180/180`.
- The original S4 evaluator, contracts, fixtures, accepted-S1 projection,
  render-neutral view, and DRAFT insertion rows retain their previously
  reviewed semantics. Only the scope test and packet-local acceptance evidence
  changed after the director repair merge.
- The protected untracked I00 remains byte-identical at SHA-256
  `9d7a36da6a2e6e7b3e905c73161b5e998a2f92416dd557e498ade3e73d5e5ef5`.
- No production, shared, Q/L, package, UI, runtime, or other satellite file was written.

## Boundary and evidence

- The artifact remains a read-only `SYNTHETIC_ONLY` assurance projection with
  no command, mutation, recovery, or capital authority.
- The prior `CASE_BLOCKED_RECEIPT.md` and
  `CASE_REBASE_SCOPE_BLOCKED_RECEIPT.md` remain immutable historical evidence.
- Acceptance evidence is
  `receipts/CASE_ACCEPTANCE_RECEIPT.md`; its enclosing seal commit is the Git
  authority for the final documentation-only commit ID.
- This state is not whole-program `ASSURANCE_PRESTAGE_READY`, `INTEGRATED`,
  `LIVE`, `DEPLOYED_PROVED`, or `I00_ACCEPTED`.
- No merge, rebase, push, `current-main` mutation, secret use, private or signed
  call, order, transfer, withdrawal, borrow, repay, leverage mutation, or
  external mutation occurred.
