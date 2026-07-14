# A-STABILITY integration receipt

Status: `A_STABILITY_INTEGRATED / STABILITY_PRESTAGE_READY_PRESERVED`

Date: `2026-07-14`

This receipt closes one accepted donor row only. The packet is deterministic, fixture-backed, and render-neutral. It does not claim a production owner, activate a repair loop, grant control or effect authority, or claim overall Product Assurance readiness.

## Immutable donor

- Branch: `ip-assur-stability-20260713`.
- Accepted tip: `d35674e7f9621320c35e0bc0270efd515cc64dbd`.
- Donor tree: `16c92923b837105471b232df0480d1270bda756e`.
- Frozen assurance base: `9785c93102b00389847b77c2f9348c06abc4344b`.
- Receipt: `fixtures/productAssurance/systemic/stability/receipts/STABILITY_ACCEPTANCE_RECEIPT.md`; Git blob `d441a5d23bf87178af47b143e4a955d826aeb711`; SHA-256 `b26f902d90fb82633ac8532d5aa82169801ded3ec6d7bcf3477737a64eab2168`; terminal `STABILITY_PRESTAGE_READY`.
- Donor delta: 19 paths; sorted newline-terminated path-set SHA-256 `84b18ffcfd1893442eedacad74d4ef94823a4f5d846a1a5362e859ed6c5cc117`.
- Donor worktree had no staged or modified tracked path; its protected untracked I00 directive was not copied, staged, removed, or used as implementation.

## Integration identity and scope

- Merge commit: `332208e64fb9b54ef2b6320c7609e53833da469f`.
- Merge tree: `b776b00591e853d1ed6acd9fbdef99fc9f06b2b8`.
- Parents in order: pre-A-STABILITY integration `57aff72c1d557572558aee795c5e0a669bf080af`; exact donor `d35674e7f9621320c35e0bc0270efd515cc64dbd`.
- First-parent delta: 19 paths; sorted newline-terminated path-set SHA-256 `84b18ffcfd1893442eedacad74d4ef94823a4f5d846a1a5362e859ed6c5cc117`.
- All 19 donor paths were compared by Git blob: 19 checked, 0 mismatches.
- No integration-owned production path changed in this merge; exact donor ancestry and `git diff --check` pass.

## Measured verification

| Gate | Measured result |
| --- | --- |
| Exact focused command at immutable donor tip | Exit 0; `212/212` |
| Exact focused command on accumulated integration branch | Expected context-only exit 1; `211/212`; the sole failure is the immutable donor-branch/path-scope assertion |
| Eight non-context test files | Exit 0; `209/209` |
| Two positive-selected non-Git assertions from `scope.test.mjs` | Exit 0; `2/2` |
| Combined integration-safe behavior | Exit 0; `211/211` |
| Git-backed integration provenance | Exact merge second parent, 19/19 blob equality, exact path-set hash, and accepted receipt identity all pass |
| `npm test` | Exit 0; typecheck/build green; deterministic `377/377`; existing Vite chunk-size warning only |
| `npm run test:all` | Exit 0; deterministic 377, application runtime 72, intelligence 152, intelligence runtime 394, capital 433, Foundation 871, System Integration `180/180` |

The donor-branch-only assertion is not weakened, rewritten, or reported green on the integration branch. Its valid donor-tip result and replacement Git-object proof are recorded separately.

## Honest gaps

- Draft insertion rows remain non-authoritative; serial-spine production owner wiring is pending.
- Resource ownership remains exactly `OWNER_CONFIRMATION_REQUIRED` and the resource result remains `UNKNOWN`.
- The packet has no runtime, route, persistence, control, effect, exchange, external, or money authority.
- The packet is still outside current root-script discovery; integration-safe Product Assurance harness wiring remains pending.
- Overall `ASSURANCE_PRESTAGE_READY` is not claimed.

## Ruling

Expected A-STABILITY donor = discovered immutable tip = receipt-accepted donor = integrated donor by exact merge ancestry. All 19 donor paths are byte-identical, all 212 donor-tip proofs and all 211 integration-safe behavior proofs pass, the immutable Git-context difference is explicitly proven rather than suppressed, repository-wide gates are green, and `UNKNOWN` resource ownership remains honest.
