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

## Commander corrections — resolved 2026-07-12 (post-launch verification pass)

1. **L SHA-256:** recorded value here and in the lock is already the corrected `40de1feb…961fdb25…9b037`; the transposed value exists only inside the owner's untracked launch file (preserved byte-for-byte, not edited). RESOLVED.
2. **Path semantics:** Mission = root `MISSION.md`; SYSTEM_AUTHORITY_MAP concept = `ARCHITECTURE.md` Part II; LIVE_PRODUCT_AUTHORITY_MAP concept = `ARCHITECTURE.md` Part II **plus** current canonical source and the accepted receipts under `docs/archive/` (all five sprint receipts + convergence receipt); obsolete directives = `docs/archive/**` historical evidence only. Q00/L00 are NOT blocked by retired filenames. RESOLVED.
3. **Repository identity:** the project is `/Users/cosmosgeek/Desktop/Main` → `git@github.com:cosmosgeek0/arbitrage-cosmos.git` branch `current-main`. "CG Signal Lab" was an informal chat label; verified absent from all state, lock, protocol, and prompts. RESOLVED.
4. **DIRECTOR_VERDICT_GAP_AUDIT.md:** verified to no longer exist anywhere on this machine (Main, Desktop, Downloads searched 2026-07-12). Non-controlling per launch §0; its corrected additions already live in launch §6/§7; it was never supplied to any builder. Clean-tree gate carries only the three exempted directives. RESOLVED — nothing to archive.
5. **Live-product consolidation:** verified from Git — convergence `b58e64e` and all organ work are ancestors of canonical base `7010499`; receipts present in `docs/archive/`. Q §3.3 "launch Q alone" contingency DOES NOT APPLY; Q and L launch concurrently from PROTOCOL_SHA `73e1a1f`. RESOLVED.
6. **Setup inspection:** protocol commit `73e1a1f` descends from `7010499` (ancestry-verified); both lane branches point at `73e1a1f`; protocol content encodes no obsolete path or competing authority; conformance 22/22 re-verified in the L worktree. No patch to the frozen protocol needed; PROTOCOL_SHA unchanged.

## NEW-DIRECTOR RESUME (read this first if the director conversation is replaced)

1. Truth = this file + QL_PARALLEL_DAG.md (board) + WORKER_PROMPTS.md (owner copy-paste blocks) + lane state files + receipts. Chat memory is nothing; git is everything. Verify `git worktree list`, each worktree's HEAD/status, and the board before any action.
2. HARD OWNER RULES: (a) anything a builder chat can do goes into WORKER_PROMPTS.md as a block — the director NEVER implements lane/packet work itself; director does only: verify from git, authority decisions, serial merges (only into PARKED worktrees), shard/worktree cuts, board/state updates, I00 shared wiring + acceptance, landing/pushing current-main. (b) At EVERY event (ACCEPTED/PARKED/BLOCKED/READY), immediately re-derive the maximum honest set of parallel chat blocks and update WORKER_PROMPTS.md — the owner sprints multiple chats and has limited time. (c) Replies to the owner: minimal words; prompts live in WORKER_PROMPTS.md, not chat.
3. Merge law: serial, tests after each (Q: quant venv pytest; L: server build + liveEdge suites), scope-guard branch-skip fixes follow the Q08/Q15 pattern (documented director commits). Merge queue and event map live at the bottom of WORKER_PROMPTS.md and on the board.
4. Owner directives arrive from "commanders" (external ChatGPT) as .md files — verify hashes, correct stale assumptions from git truth (they are navigation hints, not acceptance evidence), register a D-LAUNCH-N acceptance entry here, then cut worktrees + blocks.
5. External-action boundary (launch §10 / I00 §20) is never delegated and never inferred.

## Director acceptance log

- **D-LAUNCH-1 (2026-07-12): authentic launch-file digest bound.** Both lanes correctly blocked at the launch hash gate: prompts cited sha256 `0cc192e3…d3cc`, actual bytes hash to `26b1d5ce118982b4b3ba64b44b7fb3e88b0b7ded26a818a775a65bffaa0f2c06` (git blob `587c1b83e8f9d32b9097d88df7fea40d9829b68e`). Root cause: the owner re-saved DIRECTOR_Q_L_TWO_LANE_LAUNCH.md between the director's first shasum measurement and the blob/copy step; all three copies (Main, Q worktree, L worktree) verified byte-identical, blob matches the frozen lock throughout, and the file still contains the known (waived) L-directive SHA typo on line 18 — content unchanged in substance. DIRECTOR ACCEPTS blob `587c1b83` / sha256 `26b1d5ce…0f2c06` as THE authentic launch file. `0cc192e3…` is a stale measurement, superseded. Lanes: record this acceptance in your DECISIONS, treat the launch hash gate as PASSED with the corrected digest, complete Q00/L00 acceptance, and continue. Do not redo the already-verified reuse audits or research.
- **D-LAUNCH-2 (2026-07-12): standing continuous-run authorization.** The owner confirms ample usage quota; the launch-file §8 one-hour caution is obsolete. Both lanes are authorized to run CONTINUOUSLY through all remaining phases (Q00→Q17 / L00→L17) without stopping for per-phase director acceptance. Delegation terms: each phase is SELF-ACCEPTED only when its full loop is complete and evidenced in the immutable receipt (implementation → focused tests → accumulated lane tests → adversarial review → corrections → implementation commit → receipt → durable state update); the director audits every receipt at LANE_READY before integration and may retroactively reject any phase whose receipt lacks measured evidence — retroactive rejection reopens that phase, so shallow receipts save no time. All scope gates, safety laws, and the external-action boundary remain fully in force and are NOT delegated. Lanes stop only for: (a) a genuine frozen-input/authority/protocol conflict (BLOCKED), (b) the external-action boundary, (c) LANE_READY completion. Context compaction is not a stop: resume from durable state and continue silently. No routine questions, no pauses for acknowledgment.
- **D-LAUNCH-4 (2026-07-12): L-lane ownership → Fable lead.** Owner-ordered capacity emergency: the Codex L lead's quota is exhausted mid-L05. Same pattern as D-LAUNCH-3: a Fable/Claude Code session takes exclusive ownership of the L worktree, resuming from durable state (L00–L04 ACCEPTED; L04 receipt sha256 recorded in lane state). The Codex L chat must never be resumed after the Fable lead's first commit. Continuous execution L05→L17 under D-LAUNCH-2 terms.
- **D-LAUNCH-5 (2026-07-12): pre-authorized parallel fan-out (owner order, packets-only).** Q06 verified ACCEPTED at `24ccf58` (state gen-21; Q07 not activated). Q spine is PARKED at Q06 — its session must NOT be resumed; Q07+ runs as shards. Four shard worktrees cut TODAY from exact `24ccf58`: q07-microstructure / q08-derivatives / q09-regime / q14-validation-infra (branches `<name>-20260712`, all in Main's object store). Three L shards (L09-normal-basis, L10-reverse-basis, L11-volume) are PRE-AUTHORIZED to be cut from the exact accepted-L08 SHA the moment the L lead records L08 acceptance. SHARD LAW: one writer per shard worktree; exclusive write allowlist = the shard's own `quant/src/quant_edge/<family>/**`, `quant/tests/<phase>/**`, `quant/generated/<phase>/**`, plus its own TASKS/RECEIPTS/DECISIONS entries (L shards analogous under liveEdge namespaces); Q06-frozen registry and all shared/barrel/package files are READ-ONLY — needs go to `SHARED_CHANGE_REQUEST.md` in the shard root and that piece stops; shards run focused + own-family suites; the FULL accumulated lane suite runs at merge-back, which the DIRECTOR alone performs serially onto the lane branch (tests after each merge); shards never merge, never push, never touch Main, other worktrees, or lane branches. Board: `QL_PARALLEL_DAG.md`.
- **D-LAUNCH-6 (2026-07-13): I00 program accepted.** `I00_PRODUCT_ASSEMBLY_CONTROL_ROOM_AND_LIVE_BRINGUP.md` (sha256 9d7a36da6a2e6e7b…) is the single controlling final-gap directive; FINAL_GAP_EXECUTION_ORDER / FINAL_ASSEMBLY_*_DAG / FINAL_MASTER_* are superseded and were never installed. Subordinate packets IP_RUNTIME (6e93016e…), IP_CONTROL (5e57bf1d…), IP_OPS (2af83489…), IP_PROOF (e59d516b…) installed at root (untracked owner inputs) and copied into four worktrees cut from 420cc83: ip-runtime/-control/-ops/-proof (branches ip-*-20260713). ONE DIRECTOR LAW UNCHANGED: this session remains sole director (authority, shared files, serial I00 spine, merges, acceptance); packets are bounded workers in exclusive additive paths, runnable in parallel with Q/L. Donors: dash-shell (6925015, sole shell donor), l15-infra (2cec412). Final shared-file integration begins only from accepted immutable Q/L tips.
- **D-LAUNCH-7 (2026-07-13): I00 frozen-input acceptance for living director state.** IP-PROOF's packet-time hash pins for QL_DIRECTOR_STATE.md / QL_PARALLEL_DAG.md are historical snapshots; those two files are LIVING director-owned state and change at every event by design. Ruling: the I00 frozen-input gate must treat them as owner-accepted at the latest commit of current-main touching them (verify via `git log -1 --format=%H -- <file>` in the shared object store), re-pinning exact hashes only once at the FINAL I00 real-adapter run. The five owner directive files (I00 parent + four IP packets) are now present in the i00-assembly worktree root, hashes as recorded in D-LAUNCH-6. Do not overwrite historical IP-PROOF receipt hashes. Also records L09 BLOCKED finding: accepted L04/L08 lacks a Spot order/TIF capability bridge (see live-edge-receipts/DECISIONS/L09-001-NORMAL-BASIS-BLOCKER.md); director authorizes a bounded L-spine bridge phase (L08.1) in the parked L spine worktree; L09/L10/L11 re-base on its accepted SHA.
- Lane checkpoints observed (pre-acceptance, not yet accepted phases): Q `fa6fecd` (Q00 impl/receipt) + `1dca8ce` (durable state, HEAD); L `1b97515e` (L00 authority/source evidence) + `310063c8` (blocked state + immutable receipt).
- (append: phase, lane, accepted commit, receipt path, date)

## External-action boundary (launch §10)

No private reads, signed test orders, AWS/Cloudflare/Secrets mutations, deployment, process restarts, Margin actions, real orders, capital increases, or automated live entries without separate explicit owner authorization. Implement boundaries; never exercise them.
