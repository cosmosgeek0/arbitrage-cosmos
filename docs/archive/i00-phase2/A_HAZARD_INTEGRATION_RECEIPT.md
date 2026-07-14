# A-HAZARD integration receipt

Status: `A_HAZARD_INTEGRATED / HAZARD_PRESTAGE_READY_PRESERVED`

Date: `2026-07-14`

This receipt closes one accepted donor row only. It preserves a dormant, synthetic assurance packet and grants no machine, remediation, production, external, execution, or money authority.

## Immutable donor

- Branch: `ip-assur-hazard-20260713`.
- Accepted tip: `ab33b3712cddd67c3ec91cfa1dd232c75226cd9f`.
- Donor tree: `e33224d4b2e6b018fd39bfdcb403b3d88e74712f`.
- Frozen assurance base: `9785c93102b00389847b77c2f9348c06abc4344b`.
- Accepted audit receipt: `fixtures/productAssurance/systemic/hazard/receipts/HAZARD_D_LAUNCH_10_AUDIT_RECEIPT.md`; Git blob `5dc3bd4bafe7eb9a42e9547989cd7f488eb72c74`; 6,077 bytes; SHA-256 `ecfca4e7d60d9dca3b07e4e21d4595ebb234dab421924f14226cf39f8a9c85ea`; terminal `HAZARD_PRESTAGE_READY`.
- Donor delta: 24 paths; sorted newline-terminated path-set SHA-256 `f715f96f1a77bd37acc5810acf6121af622cf404441345eeca4f28b0129946e2`.
- Donor worktree had no staged or modified tracked path; its protected untracked I00 directive was not copied, staged, removed, or used as implementation.

## Integration identity and scope

- Merge commit: `bfb813ba1c15a23c7f4f0bff6a8da2f13d5c2729`.
- Merge tree: `7eed3e5336354c03455282b9ee3421c7d90a0a92`.
- Parents in order: pre-A-HAZARD integration `66aa2155d8587897fc59d25f40dfa6c1e3461213`; exact donor `ab33b3712cddd67c3ec91cfa1dd232c75226cd9f`.
- First-parent delta: 26 paths; sorted newline-terminated path-set SHA-256 `6a4b7f88097789a53c45556d52c46afc2d5c74f5726bd7a0dcb42ab0115290de`.
- All 24 donor paths were compared by Git blob: 24 checked, 0 mismatches.
- Donor and target hazard subtree: `018187be07156abaea60c0ba91875232bb331803`.
- Integration-owned paths: `I00_PRODUCT_BUILD_STATE.md` and `STATE.md` only.
- Exact donor ancestry and `git diff --check` both pass.

## Measured verification

| Gate | Measured result |
| --- | --- |
| `node --test --test-concurrency=1 --test-reporter=spec "test/productAssurance/systemic/hazard/**/*.test.mjs"` | Exit 0; `69/69` |
| `npm test` | Exit 0; typecheck/build green; deterministic `377/377`; existing Vite chunk-size warning only |
| `npm run test:all` | Exit 0; deterministic 377, application runtime 72, intelligence 152, intelligence runtime 394, capital 433, Foundation all green, System Integration `180/180` |

The focused suite proves finite-denominator coverage, exact owner/release binding, stale and contradicted evidence handling, non-vacuous failure, deterministic projections, and purity. It does not prove real production hazard coverage.

## Honest gaps

- Every insertion artifact remains explicitly `DRAFT` and non-authoritative until consumed through A-CORE and the Phase 2 serial spine.
- The packet remains fixture-backed, dormant, and outside current root-script discovery.
- It adds no machine-readiness verdict, live control, timer, socket, filesystem/environment read, remote call, or remediation authority.
- Overall `ASSURANCE_PRESTAGE_READY` is not claimed.

## Ruling

Expected A-HAZARD donor = discovered immutable tip = receipt-accepted donor = integrated donor by exact merge ancestry. All 24 paths are byte-identical and focused plus repository-wide gates are green; draft and non-authoritative boundaries are preserved.
