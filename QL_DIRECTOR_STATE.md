# QL_DIRECTOR_STATE.md — director-owned durable state for the Q/L two-lane program

Updated: 2026-07-12 (launch gate). This file is sprint state, not product truth; it folds into STATE.md/docs/archive at integration.

## Canonical base (verified from Git, not chat)

- Repository: `/Users/cosmosgeek/Desktop/Main` (sole workspace; no other writers — all prior clones/worktrees removed 2026-07-12, `git worktree list` = Main only at launch)
- Branch: `current-main` · CANONICAL_BASE_SHA: `7010499170e24b31c9c0be2c9d73a536e680c6fe` · origin/current-main: `7010499` (byte-synced)
- Includes: audit `b272049` → organs `c4ae7a9`/`87af782` → convergence `b58e64e` → docs freeze `8069f9b` → `7010499`
- git status at launch: clean except the three exempted owner directives (untracked, preserved byte-for-byte)
- PROTOCOL_SHA: recorded in the protocol commit itself (the commit containing this file, EDGE_PROTOCOL_V1.md, packages/edge-protocol*, quant/DIRECTIVE_INPUTS.lock)

## Accepted canonical documents

- Authority map: `ARCHITECTURE.md` (Part II = accepted System Authority Map; `SYSTEM_AUTHORITY_MAP.md` archived at docs/archive; **no separate LIVE_PRODUCT_AUTHORITY_MAP.md exists — ARCHITECTURE.md Part II serves both roles**) — sha256 `beb8be8baefe2faa78356e2dc44983735b855535c21cd5f0172a8e1e3fa665db`
- Mission: `MISSION.md` — sha256 `95e152d76844aa391b7a28bd45548d7fe58f83ed1ced558dbdbeb01797436362`
- Current state: `STATE.md` — sha256 `c9dc6675c167fea2680236c280f292d94ea765895a1356a5b8530490ca9946f5`

## Owner directive hashes (recomputed at launch)

| File | git blob | SHA-256 | MD5 |
| --- | --- | --- | --- |
| DIRECTOR_Q_L_TWO_LANE_LAUNCH.md | `587c1b83e8f9` | `0cc192e348f51f7ab372b0245568bbf88f3ccbf23d3f0c581e853dd9f30cd3cc` | — |
| QUANT_EDGE_RESEARCH_FACTORY_12H.md | `eebe7b0c751c` | `198f131d4b04c1edab728b85ea6a5e5c5f7f80875866e407a3c93a24aafa5ab4` (matches launch file) | `63ca3f39e3d3aeee2cce5e71c1978a9c` (matches) |
| LIVE_EXECUTION_REALISM_CONTROL_PROOF_12H.md | `53fea2b71b06` | `40de1feb6678d8741bd38f7538b2c6f25304c0f64195a596961fdb2539a3b037` | `7ef86a5d1078c664a66ba9720a6e38d6` (matches) |

**Hash discrepancy resolved:** the launch file records the L SHA-256 as `…961bdf25…`; the actual file hashes to `…961fdb25…` (3-char transposition). The launch file's own MD5 for L matches the file exactly, proving the file authentic and the launch file's SHA-256 entry a transcription typo. Director accepts the file; computed SHA-256 above is authoritative.

## Verified build/test at CANONICAL_BASE_SHA (measured 2026-07-12)

- `npm test` → exit 0 (typecheck, build, engines 107+124, financial safety 59, storage 29, focused node suites, gates in integration lane)
- Full battery (last complete run, twice, identical): existing 377 · gates 72 · intelligence 152 · runtime 394 · capital 433 · foundation 871 (incl. risk 884 assertions) · integration scenarios 30 · `npm run test:all` exit 0
- Protocol tests: `node packages/edge-protocol-tests/protocol.test.mjs` → 22/22

## Current capability map (release labels per ARCHITECTURE.md)

- LIVE_PUBLIC: audited product services/Binance owners/ledger/cockpit; Basis + Volume engines; composed public Spot/USD-M acquisition; authenticated supervisor/control APIs; SQLite persistence
- WIRED: foundation (control/risk/execution-dry-run/reconciliation via adapters); intelligenceFoundation; intelligenceRuntime (composed sources); capitalFoundation (read/advisory; reservation UNAVAILABLE pending real account truth); systemIntegration composition/supervisor/vertical slice
- VALIDATE_ONLY: operator modes READ_ONLY/ADVISORY/VALIDATE_ONLY; sealed dry-run two-leg coordinator
- SYNTHETIC: capital mandate fixtures; reconciliation fixtures
- UNWIRED/DORMANT: foundation USD-M test-order boundary (no transport)
- MISSING by design: signed/private calls, live execution (`LIVE_EXECUTION_NOT_IMPLEMENTED` tripwire-tested), borrow/transfer/withdraw paths

## Lane registry

| Lane | Worktree | Branch | Directive | Extra orchestration | Status |
| --- | --- | --- | --- | --- | --- |
| Q | `/Users/cosmosgeek/Desktop/quant-edge-research-20260712` | `quant-edge-research-factory-20260712` | QUANT_EDGE_RESEARCH_FACTORY_12H.md | launch file Section 6 only | LAUNCHED — current phase: Q00 |
| L | `/Users/cosmosgeek/Desktop/live-execution-proof-20260712` | `live-execution-control-proof-20260712` | LIVE_EXECUTION_REALISM_CONTROL_PROOF_12H.md | launch file Section 7 only | LAUNCHED — current phase: L00 |

Both branches descend from PROTOCOL_SHA. Main stays director-owned; neither Codex writes here. Lane durable state: `quant/QUANT_EDGE_BUILD_STATE.md` (Q) and `LIVE_EXECUTION_BUILD_STATE.md` (L) per their directives.

## Director acceptance log

- (append: phase, lane, accepted commit, receipt path, date)

## External-action boundary (launch §10)

No private reads, signed test orders, AWS/Cloudflare/Secrets mutations, deployment, process restarts, Margin actions, real orders, capital increases, or automated live entries without separate explicit owner authorization. Implement boundaries; never exercise them.
