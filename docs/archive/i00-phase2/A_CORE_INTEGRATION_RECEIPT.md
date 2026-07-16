# A-CORE integration receipt

Status: `A_CORE_INTEGRATED / CORE_SCAFFOLD_READY_PRESERVED`

Date: `2026-07-14`

This receipt closes one accepted donor row only. `CORE_SCAFFOLD_READY` is preserved exactly; it is not widened to `ASSURANCE_PRESTAGE_READY`, production wiring, deployment, live truth, or external action authority.

## Immutable donor

- Branch: `ip-assurance-20260713`.
- Accepted tip: `08a0a09780727e2b4ba59017b5701998abe29b77`.
- Donor tree: `b904ca0f5b6f7c8df294274351611635560f80f7`.
- Frozen assurance base: `9785c93102b00389847b77c2f9348c06abc4344b`.
- Receipt: `fixtures/productAssurance/receipts/IP_ASSURANCE_RECEIPT.md`; Git blob `ad22f9ab75deffcb62fa2a6986dbed6ac61595b2`; 10,703 bytes; SHA-256 `93b1f6283d48ddeadf9b7205e47f3ccfc698d4f79f98b8e82ecad1d7aa4a302e`; terminal `CORE_SCAFFOLD_READY`.
- Donor delta: 36 paths; sorted newline-terminated path-set SHA-256 `9ee8554b60e5e580169b65671baf9899d53d46a79e500a1004230ece81c9af5e`.
- Donor worktree had no staged or modified tracked path. Its only untracked owner directive was protected input and was not copied, staged, removed, or used as implementation.

## Integration identity and scope

- Merge commit: `3ee0eda6b0da01b6fae441c684fa53829cab15be`.
- Merge tree: `cb1d785f69c2b1d36fc11d88446acc64cf53a33d`.
- Parents in order: pre-A-CORE integration `d3ae63f7c755ac5bb56889207e698c23a895798a`; exact donor `08a0a09780727e2b4ba59017b5701998abe29b77`.
- First-parent delta: 38 paths; sorted newline-terminated path-set SHA-256 `448fa55af2a15d3c08a5de524dc082a2168834eca3ffcbb38947055130fca0c8`.
- All 36 donor paths were compared by Git blob: 36 checked, 0 mismatches.
- Production scaffold: 14 files under `server/src/productAssurance/**`; donor and target tree `835daddf26f53886618eeabc3d169d4622953faf`.
- Integration-owned paths: `I00_PRODUCT_BUILD_STATE.md` and `STATE.md` only.
- `git merge-base --is-ancestor 08a0a09… 3ee0eda…`: exit 0.
- `git diff --check 3ee0eda^1 3ee0eda`: exit 0.

## Deferred insertion inventory

`fixtures/productAssurance/generated/ASSURANCE_INSERTION_REQUEST.md` is retained byte-identically as Git blob `207ba5a15fc4782612567dfc40c7a45c845fb67a`, SHA-256 `899f8aea317ebe4c9c5144ae9f04b1f8eb68703632b208de4fe0ac29edd6a1b1`. Its 68 data rows remain `NOT_CONFIGURED`, `WAITING`, `UNKNOWN`, or otherwise non-authoritative until the Phase 2 serial spine applies and verifies them through their existing owners.

## Measured verification

| Gate | Measured result |
| --- | --- |
| `npm run build -w server` | Exit 0 |
| `node --test --test-concurrency=1 --test-reporter=spec "server/test/productAssurance/**/*.test.mjs"` | Exit 0; `32/32` |
| `node test/productAssurance/production-operation-scan.mjs --fail-on-uncovered` | Exit 0; 386 files; 143/143 operation sites registered; zero uncovered |
| `npm test` | Exit 0; typecheck/build green; deterministic `377/377`; existing Vite chunk-size warning only |
| `npm run test:all` | Exit 0; deterministic 377, application runtime 72, intelligence 152, intelligence runtime 394, capital 433, Foundation all green, System Integration `180/180` |

## Honest gaps

- Root `npm test` and `npm run test:all` do not yet discover `test/productAssurance/**`; the root harness insertion remains serial-spine work.
- Satellite assurance donors are not implied by A-CORE and are integrated separately.
- S2/action evidence is missing; S4 and Formal remain refused at their recorded blockers.
- Rate-budget, resource-owner, target-readback, and other owner contracts remain `WAITING`, `UNKNOWN`, or `NOT_CONFIGURED` as generated.
- The scaffold is dormant and adds no timer, socket, filesystem, environment, network, execution, or money authority.

## Ruling

Expected A-CORE donor = discovered immutable tip = receipt-accepted donor = integrated donor by exact merge ancestry. Its scaffold, evidence, receipt, and insertion inventory are byte-identical; focused and repository-wide gates are green; overall assurance readiness is not claimed.
