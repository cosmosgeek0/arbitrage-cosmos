# Replacement candidate source-freeze receipt

Date: `2026-07-15`

State: `REPLACEMENT_SOURCE_FREEZE / LOCAL_ACCEPTANCE_PENDING / NOT_SELF_VERIFIED`

This receipt is committed atomically with replacement candidate source-freeze commit **C**. A commit cannot name its own SHA or tree. Only the sole-child readiness seal **S** may bind those identities after the complete exact-C acceptance passes. This receipt is not `INTEGRATION_CANDIDATE_READY`, independent verification, deployment evidence, or money authority.

## Immutable predecessor disposition

- Initial clean restart baseline: commit `6b50cca34a5615e828e9606cd7201daf81272ec7`; tree `731dec2404bab0d27a804c634cda1518a6dcef5d`.
- Rejected pre-evidence source-freeze checkpoint: commit `9bde37bc716194c241fb20bda4fdca4e451b1915`; tree `b7747152c926b688545e6e123ce34b49c1b1198e`; parent `6b50cca34a5615e828e9606cd7201daf81272ec7`.
- The checkpoint remains immutable Git history but was rejected as sealable source after pre-evidence browser-capture review exposed incomplete PF-001 coverage. No browser, performance, complete-acceptance, readiness, or S receipt was created for it. This is a Role 2 source disposition, not a Phase 3 `REJECTED_CANDIDATE` verdict.

## Replacement source disposition

- TokenDetail no longer creates a browser-owned Binance kline WebSocket; its candles use the same-origin server route.
- TokenIcon no longer creates jsDelivr or CoinCap fallback transports; unresolved icons use the deterministic monogram.
- Deterministic offline mode fails moneyflow, profile, profile warming, News, News Context, forced News refresh, Calendar, FX, and source-logo acquisition closed before transport creation.
- Profile, icon, and passive liquidation cache defaults resolve beneath the isolated `DATA_DIR`; explicit cache overrides remain available for separately authorized runtime configuration.
- The proof catalog retires the prior UI-local TokenDetail socket exception and requires zero browser token exchange-socket and fallback-CDN hits.
- The existing D-LAUNCH-22 Binance attempt disposition remains historical authority evidence only. Every other deterministic test-time egress is forbidden.

The replacement does not claim that every production browser resource is same-origin: validated server-resolved CoinGecko image URLs remain possible outside deterministic offline mode. The exact-C in-app Browser network campaign is still mandatory.

## Mandatory candidate-receipt law preserved

The later S-bound `INTEGRATION_CANDIDATE_READY` receipt must independently regenerate and encode:

- donor equality `expected = discovered = receipt-accepted = integrated = 16/16/16/16`;
- A-FORMAL `b491893416006cf529aef02e5dd4a25d6475e7b8` and A-ACTION-EVIDENCE/S2 `ca30adf5e97b6697afec49f13073024d953b117b` as `POSTLANDING_EXCLUDED`;
- Q C17 `4cc83f43edd9a50ff2d3e20970a57e2d0a57e92a` as the sole direct parent of A17 `02b4eccc8d2ef53b830cafae06e5175715fa6ebb`;
- the existing Ledger compare-and-set and Foundation quantity-bridge dispositions, each with no send or source-authority grant.

This source receipt cannot substitute for those Git-backed S validations.

## Focused evidence before C

| Command | Result |
| --- | --- |
| `npm run typecheck` | Exit `0`; server and web pass |
| `npm run build` | Exit `0`; server and web pass; Vite `1,880` modules; advisory chunk warning only |
| `node server/test/gates.mjs` | Exit `0`; `82/82`; forced GET/POST public-source routes produced zero external network attempts; default profile/icon/liquidation cache reads were behaviorally rooted under `DATA_DIR` |
| `npm run test:product-control:built` | Exit `0`; `76/76` |
| `npm run test:i00:proof:built` | Exit `0`; `47/47` |
| `node --test --test-concurrency=1 --test-reporter=spec --test-name-pattern='inventory inspection downgrades' server/test/systemIntegration/persistence/live-edge-mutation-journal-adapter.test.mjs` | Exit `0`; `1/1`; an independently advancing canonical registry is transiently `PERSISTENCE_UNAVAILABLE`, then a stable retry converges |
| `npm test` | Exit `0`; Product Assurance `517` files, `205` discovered operations, `205` covered operations, `0` uncovered operations, `802` behavior checks, `4` provenance checks, and `41/41` acceptance contracts |
| `npm run test:all` | Exit `0`; all aggregate suites passed, including System Integration `373/373` and the `1,618/1,618` live-edge serial campaign |
| `node test/i00/render-reports.mjs --write` | Exit `0`; five living-pin reports and machine evidence regenerated; immediate second regeneration preserved every SHA-256 byte-for-byte |

These pre-C source gates do not substitute for exact-C acceptance. Exact-Q, operations, generated-report parity, performance, Browser, restart, and C-bound complete-acceptance results remain intentionally absent until they are measured from immutable C.

## Authority and exclusions

- Exclusive writer: Role 2 on `i00-product-assembly-20260713` only.
- Forbidden: `current-main` writes, push, Phase 3 self-certification, deployment, private/signed calls, test/live orders, borrow/repay, leverage or margin mutation, transfer, withdrawal, and any money action.
- Exactly five protected owner directives remain untracked and excluded from C: `I00_PRODUCT_ASSEMBLY_CONTROL_ROOM_AND_LIVE_BRINGUP.md`, `IP_RUNTIME.md`, `IP_CONTROL.md`, `IP_OPS.md`, and `IP_PROOF.md`.
- `LIVE_EXECUTION_NOT_IMPLEMENTED` remains enforced.
