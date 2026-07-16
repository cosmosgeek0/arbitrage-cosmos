# A-COCKPIT integration receipt

Status: `A_COCKPIT_INTEGRATED / COCKPIT_PRESTAGE_READY_PRESERVED`

Date: `2026-07-14`

This receipt closes one accepted donor row only. The packet is fixture-backed and render-neutral; it does not mount a production route or panel, claim browser visibility, mint live green, or grant control/execution authority.

## Immutable donor

- Branch: `ip-assur-cockpit-20260713`.
- Accepted tip: `d4ff9c94c9fec9477481223c4b33d8f671a34f6d`.
- Donor tree: `bda9b452c9e6564576fa3cd390a5981cd6907c09`.
- Frozen assurance base: `9785c93102b00389847b77c2f9348c06abc4344b`.
- Receipt: `fixtures/productAssurance/systemic/cockpit/receipts/COCKPIT_PRESTAGE_RECEIPT.v1.json`; Git blob `e02c7f40eec4aad271ee47461e1c8a313709b588`; 14,175 bytes; SHA-256 `b75055388f99632f2dc5ebb87d92b6d969f666397014e89a616a6e262f0650dd`; terminal `COCKPIT_PRESTAGE_READY`.
- Donor delta: 53 paths; sorted newline-terminated path-set SHA-256 `870d23aebb1d60b12eabb91364a134b97569dc21ba4345618282b1355d39e01d`.
- Donor worktree had no staged or modified tracked path; its protected untracked I00 directive was not copied, staged, removed, or used as implementation.

## Integration identity and scope

- Merge commit: `0204687d8c65875c99d17ae7bee1c61707f0be0f`.
- Merge tree: `317994f194899f0edfe170d2dcab4386280b9489`.
- Parents in order: pre-A-COCKPIT integration `9edc3230f1b2411efee4a5d9b112c979ec74024c`; exact donor `d4ff9c94c9fec9477481223c4b33d8f671a34f6d`.
- First-parent delta: 55 paths; sorted newline-terminated path-set SHA-256 `683b122418cd7bdcf9124323a15717464e8e2daff839fde197de51fb29f3ac4b`.
- All 53 donor paths were compared by Git blob: 53 checked, 0 mismatches.
- Cockpit subtree donor/target: `a6863cccd1f3957f62f0a0bcc91ab7e2e3e6003c`.
- Observability subtree donor/target: `db923bf1d54c26632cbbb800b1fcb4607249fdc5`.
- Integration-owned paths: `I00_PRODUCT_BUILD_STATE.md` and `STATE.md` only.
- Exact donor ancestry and `git diff --check` both pass.

## Measured verification

| Gate | Measured result |
| --- | --- |
| `node --test --test-concurrency=1 test/productAssurance/systemic/cockpit/*.test.mjs` | Exit 0; `50/50` |
| `node --test --test-concurrency=1 test/productAssurance/systemic/observability/*.test.mjs` | Exit 0; `100/100` |
| `npm test` | Exit 0; typecheck/build green; deterministic `377/377`; existing Vite chunk-size warning only |
| `npm run test:all` | Exit 0; deterministic 377, application runtime 72, intelligence 152, intelligence runtime 394, capital 433, Foundation including observability green, System Integration `180/180` |

## Honest gaps

- Cockpit and telemetry insertion artifacts remain draft/director-mount-only.
- `DIRECTOR_MOUNT_REQUIRED` remains controlling; this donor contains no production route, page, provider, polling binding, or browser proof.
- Synthetic/fixture evidence cannot be upgraded to `LIVE_PUBLIC`; UNKNOWN, stale, silent, missing, uninstrumented, or unreconciled axes remain non-green.
- The packet is still outside current root-script discovery except for its Foundation observability files; serial-spine root-harness wiring remains pending.
- Overall `ASSURANCE_PRESTAGE_READY` is not claimed.

## Ruling

Expected A-COCKPIT donor = discovered immutable tip = receipt-accepted donor = integrated donor by exact merge ancestry. All 53 paths are byte-identical and both focused suites plus repository-wide gates are green; fixture-only and mount-required boundaries are preserved.
