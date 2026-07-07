# PROJECT_MEMORY.md — Cosmos Arbitrage Control Room

Last updated: 2026-07-07 11:17 IST
Permanent role of this file: the durable living-state log for the project. The other three core docs are mostly static blueprints; this file records what is *true right now* — current source-of-truth folder, git/deploy state, active phase, outstanding decisions, and a dated changelog. A new Director should read this file to learn the present state without any old chat history.

Update this file whenever the project state changes. When in doubt, this file wins on "what is the current state"; the blueprints win on "what is the intended design."

---

## 1. Core docs (four, not three)

The permanent root docs are:

1. `DIRECTOR_RULEBOOK.md` — operating rules, safety laws, worker coordination, commit discipline.
2. `BLUEPRINT.md` — product / UI / backend / deploy / reconstruction blueprint.
3. `ENGINE.md` — engine / algorithm / risk / ledger blueprint.
4. `PROJECT_MEMORY.md` — this file. Current live state and changelog.

`README.md` stays short and points to these four.

---

## 2. Source-of-truth decision (current)

`/Users/cosmosgeek/Desktop/Main` is the **active source-of-truth working folder**. This overrides earlier notes in `DIRECTOR_RULEBOOK.md` §7 / `BLUEPRINT.md` §4 that treated `Main` as an untrusted post-Spark recovery copy.

Owner directive (2026-07-07):
- Do not treat old folder names (e.g. `arbitrage-cosmos`) as authoritative.
- Do not restore from `/Users/cosmosgeek/Desktop/arbitrage-cosmos` unless explicitly asked.
- Do not treat old GitHub `main` history as product truth.
- Use `Main` for surgical edits and normal work.

`Main` is now Git-tracked for bookkeeping and recoverability (see §3).

---

## 3. Git / remote state

- Local Git: initialized in `Main` on 2026-07-07 (for bookkeeping + recoverability). Before init, a safety copy of the working tree was taken to `~/Desktop/Main-safety-<timestamp>` (excludes regenerable `node_modules/`).
- Remote `origin`: `git@github.com:cosmosgeek0/arbitrage-cosmos.git`. SSH auth verified working as GitHub user `cosmosgeek0`.
- History posture: the fresh local history is unrelated to the old GitHub `main`. Do **not** force-push over old `main`. The current tree is published to branch `current-main` instead of overwriting old history.
- `.gitignore` excludes: `node_modules/`, `dist/`, `data/`, `.env`, `.env.*` (keeps `.env.example`), `.DS_Store`, `*.log`. Runtime DB (`data/cosmos.db*`) is intentionally not tracked; it is preserved on disk and in the safety copy.

---

## 4. Current app-state snapshot

- Stack: npm workspaces — `server/` (Node + TypeScript, `src/{binance,engine,services,config.ts,index.ts,ledger.ts,types.ts}`) and `web/` (React + Vite, `src/{App.tsx,pages,components,store.tsx,styles.css}`).
- Root scripts (`package.json`): `build` = server+web builds; `start` = `node server/dist/index.js`; `dev` = `npm run dev -w server`; `test` = `node server/test/gates.mjs`.
- `data/cosmos.db` present (SQLite ledger/state, active WAL). Preserve.
- `.env` absent (good). `.env.example` present, placeholders only — no real keys anywhere in tree.
- No Binance keys wired yet. Account surfaces should show disconnected/setup state, not fake data.

---

## 5. Active phase and next actions

**PHASE SNAPSHOT (2026-07-07 evening): UI/COCKPIT PHASE COMPLETE — ENGINE PHASE STARTING.**
- Cockpit is done to owner's product-truth standard: 6-group sidebar + bottom utility; four Control surfaces rebuilt by parallel Codex 5.5 workers and fully merged (byte-parity verified, including their final uncommitted polish + topbar quick-settings Header rework); read-only Binance account live (key-scope permission truth, masked fingerprint); RefreshDock = sync/health bubble; build clean, gates 50/50.
- Recovery checkpoint tag: `checkpoint-ui-complete-pre-engine` (see tags on origin).
- localhost:8080 serves the app from Main (a stale worktree server that squatted 8080 was killed; watch for agent worktree dev servers grabbing ports).
- `cosmos-{risk,logs,health,settings}` worktrees: fully merged + clean; Codex chat processes still attached — safe to `git worktree remove` once those windows close.
- **NEXT: Engine Part 0 — planning-only survey per ENGINE.md §16/§17** (no code, no trading). Worktree + brief prepared: `../cosmos-engine` / `TASK_ENGINE_PART0.md`.


- Phase A (docs + state lock): four core docs present; Git bookkeeping established. **Done.**
- SKELETON PASS 1 (6-group sidebar, merged Execution page, Basis/Volume scanners, News/Calendar tiles restored, in-app CloudShell overlay): **Done** — committed & pushed, current head `be7a7f8` on `current-main`.
- Current phase: skeleton shipped, builds clean, gates 50/50; awaiting owner review before the next surface work.
- Next options (owner picks): (a) reference-image visual polish pass, surface-by-surface; (b) dark-mode pass; or (c) Engine v0 Part 0 planning-only survey (ENGINE.md §16). Engine coding stays gated until the skeleton is signed off.

---

## 6. Outstanding decisions / unknowns

- Whether to publish `current-main` to GitHub on every milestone or keep local-only between milestones.
- How/when to reconcile (or formally retire) the old GitHub `main` and the separate `arbitrage-cosmos` folder — not to be touched unless the owner asks.
- All infra unknowns from RULEBOOK §6 (AWS region, instance ID, security groups, tunnel ID, deploy-key write state, whether Binance keys exist) remain unverified.

---

## 7. Run log (newest first)

### 2026-07-07 — UI phase close-out + engine setup
- Merged the three worktrees' final UNCOMMITTED polish (risk/logs/health — committed in worktrees as 3a17c79/33b5f9e/6fa6afd, merged as `80e2c27`; styles.css consolidated −~108KB). Byte-parity verified across all worker files.
- Fixed localhost:8080: the Logs agent's leftover dev server (cwd `cosmos-logs/server`, no web/dist → "Cannot GET /") was killed; Main's server now on 8080 (HTTP 200, keys present, connected). Killed remaining stray cosmos-logs vite/tsx dev servers.
- Tagged recovery checkpoint `checkpoint-ui-complete-pre-engine`; ENGINE.md got a one-line status (engine not started; Part 0 next).
- Created engine worktree `../cosmos-engine` (branch `engine-part0`) + `TASK_ENGINE_PART0.md` (planning-only survey per ENGINE.md §16 Part 0 / §17 — NO code).
- Worktrees cosmos-{risk,logs,health,settings}: merged + clean, left in place because Codex chats still hold processes there; remove after windows close.

### 2026-07-07 — Missed-file fix: settings worker's Header.tsx (topbar quick-settings)
- Owner caught a merge gap: the settings worker's FINAL commit (7273d1a) also reworked `Header.tsx` — compact topbar quick-settings popover (theme+accent, zoom, currency chips, basis, refresh, table density, motion, "Open settings →"), alert toggles folded into notifications, redundant network/alerts/currency/zoom/theme popovers removed. First reconcile only took page tsx + css, so the component was dropped (its CSS had merged, orphaned).
- Fixed: `git checkout 7273d1a -- web/src/components/Header.tsx` → commit `8755803`, pushed. Build clean, gates 50/50, popover verified live, no console errors.
- Exhaustive audit after fix: every file changed by each worker-final (7273d1a/2d22560/8833b93/d93fff8 vs base ba804d8) is now byte-identical on current-main, and each worker's styles.css appended block is byte-contained in the merged styles.css (verified non-empty, literal SHAs).
- **Lesson:** when merging worker branches, enumerate `git diff --name-only <base> <tip>` at the FINAL tip — never assume the file list from an earlier tip; workers add files (esp. shared ones like Header.tsx) in later commits.

### 2026-07-07 — Merged all four Control rebuilds into current-main
- Four Codex 5.5 workers finished (worktrees cosmos-{risk,logs,health,settings}). Merged one at a time, squashed, into `current-main`: Settings `119b9aa`, Health `9fe42e7`, Logs `87de7b2`, Risk `2689268`; then reconcile fix `2eb1f80`.
- Result: Risk = pre-trade safety console (posture + blocker stack, kill switch, live-arm gate, wired limits + six "not wired" guards disabled-with-reason, gate probe, allow/blocklist, rejections→Logs); Logs = incident/audit console (severity strip, debug hidden, event table + inspector + JSON drawer, error-first); Health = machine trust dashboard (overall verdict + data-path checks green/amber/red/gray + "what to fix next"); Settings = boring local prefs only. build clean, gates 50/50, all four verified styled in-browser, no console errors.
- **Merge lesson (record):** each worker made 4-5 iterative commits that each APPENDED a marked block to `styles.css`; the squash-union of four such files left **+5 unbalanced braces** → a CSS parse break that silently unstyled Risk. Also workers kept committing after I merged (tips moved), so merged tsx/css drifted. Fix pattern that worked: reconstruct `styles.css` deterministically = base (verified clean prefix) + each worker-final's appended block, and pull the page `.tsx` from the SAME worker-final commit. Note: `git show $VAR:path` fails in this sandbox — use literal SHAs.
- Worktrees still registered (cosmos-*); agents may still be committing. Prune when confirmed idle.
- Next: **Engine Part 0** (scanner-only, no trading) per ENGINE.md §16.

### 2026-07-07 — Worktrees + briefs for Control page rebuild (routing, not building)
- Owner rejected the current Control pages on product-seriousness grounds (not build/test). Director routes the rebuild via isolated worktrees; does NOT rebuild pages in-chat.
- Created 4 git worktrees off `current-main` @ ba804d8, one branch each:
  - `../cosmos-risk` (branch `rebuild-risk`) → `TASK_RISK_REBUILD.md`
  - `../cosmos-logs` (branch `rebuild-logs`) → `TASK_LOGS_REBUILD.md`
  - `../cosmos-health` (branch `rebuild-health`) → `TASK_HEALTH_REBUILD.md`
  - `../cosmos-settings` (branch `rebuild-settings`) → `TASK_SETTINGS_REBUILD.md`
- Each brief (in its own worktree, gitignored) rewritten to the higher "product truth" standard: Risk = pre-trade safety console with blocker stack + rejections; Logs = incident console with severity strip + error-first mode + JSON drawer; Health = trust dashboard with overall verdict + "what to fix next"; Settings = boring/local only. Each: one page file only, scoped CSS appended under a marked block, npm install→build→test→screenshot→commit to its branch, no engine/secrets/live-trading/other-pages.
- Worker = Codex 5.5 only (no Spark/5.3 for UI). Workers run in their worktrees so they cannot clobber Header/App/store/styles/server.
- Merge order (Director merges one branch at a time into current-main; build/test/screenshot/commit/push + update BLUEPRINT/PROJECT_MEMORY after each accepted page): **Settings → Health → Logs → Risk** (simplest → most complex; styles.css conflicts resolved append-only by Director).
- current-main clean @ ba804d8; page rebuilds pending workers.

### 2026-07-07 — PRODUCT TRUTH PASS: sidebar restructure + 5 rebuild briefs
- Directive: the Control cleanup polished existing pages instead of rebuilding them from their job. Now rebuild each Control page from its operator job; restructure the sidebar; Settings is bottom utility, not Control.
- Director did directly (tiny + docs): restructured sidebar in `Header.tsx` — **Borrow moved Market→Capital** (Capital = Account/Wallets/Borrow), **Market = Markets only**, **Control = Risk/Logs/Health** (Settings removed), **Settings moved to bottom utility** (`snav-utils` = News/Calendar/Settings). Updated BLUEPRINT §6 to this source-of-truth. `.gitignore` now ignores `TASK_*.md`.
- Wrote 5 single-surface worker briefs (gitignored/local, for Codex 5.5, one worktree each): `TASK_RISK_REBUILD.md`, `TASK_LOGS_REBUILD.md`, `TASK_HEALTH_REBUILD.md`, `TASK_SETTINGS_REBUILD.md`, `TASK_SIDEBAR_AND_REFRESH_DOCK.md`. Each: rebuild-from-job (not preserve), one file only, disabled-with-reason instead of fake numbers, no Header/App/store/server unless explicit.
- Each page rebuilt from its single question: Risk="can anything act?"; Logs="what happened/failed/why?" (incident console, severity, hide debug); Health="can I trust the system now?" (green/amber/red/gray); Settings="how does this browser display the cockpit?" (local UI only).
- RefreshDock already meets the Sync/Health Dock spec (verified prior run) — no rebuild needed; remaining dock work = optional topbar compaction (dedupe Wi-Fi/data-health icons).
- Execution model: **sequential or one git worktree per worker** (agents must not share Header/App/store/styles/server — those are Director merge points). Recommended order if sequential: Risk → Logs → Health → Settings.
- build clean, gates 50/50. Sidebar committed; page rebuilds pending Codex 5.5.
- Next step: run the 4 page briefs (parallel worktrees or sequential); Director verifies + merges each with build/test/screenshot before the next.

### 2026-07-07 — Verify + commit Control cleanup (B–E done) + parallel-agent lessons
- Codex 5.5 executed the B–E brief (18 min, ~99% context — one 4-surface brief was too big for a single agent).
- Verified on disk + browser (build clean, gates 50/50, no console errors):
  - Risk = execution-guard controls only, embedded Rules&governance removed.
  - Logs = operator audit surface: severity model (Critical/Warning/Info/Debug), filters (severity/kind/symbol/text/time/accepted-rejected/group), summary counts, reasons-first timeline, useful event detail + Raw JSON. Debug/system-noise hidden by default.
  - Health = trust/status board, duplicate Safe-routes removed, gray engine-heartbeat placeholder.
  - Settings = local UI prefs only (+currency), all API/withdrawal/health/risk posture moved out; tiny "keys are server-only → Account/Health" reminder.
- **Sync/Health bubble = the existing `RefreshDock`** (bottom-right). Codex folded brief-D's health model into it (browser→server, Binance REST, socket, feed, account sync, user stream, clock drift, rate budget, Ledger DB, last error) + click-refresh spin/ok/err. The flickering `SyncHub.tsx` was a scratch attempt, correctly discarded — NOT a missing piece (no duplicate bubble).
- Also captured a **parallel agent's reliability work**: `ErrorBoundary.tsx` + window error/rejection breadcrumbs (`main.tsx`) + static-asset cache policy (`server/index.ts`, fixes blank-white after rebuild).
- Commits: `2def993` (fix: error boundary + breadcrumbs + cache policy), `a2518e1` (ui: simplify control surfaces + health refresh model). Pushed.
- **Lesson (parallel agents):** multiple agents in ONE working tree collided — the ErrorBoundary agent's `App.tsx` overwrote Codex's `<SyncHub/>` mount, and files flickered in/out. Going forward: one **git worktree per agent**, one **surface per brief** (small context), and never let concurrent agents share `App.tsx`/`styles.css`/`store.tsx`/`Header.tsx`/`server/index.ts` — those are Director-owned merge points.

### 2026-07-07 — Control cleanup pass: sidebar rename + brief (A done, B–E briefed)
- Asked: clean the Control section (Risk/Ledger/System/Settings) to operator-grade; keep four surfaces; rename Ledger→Logs, System→Health; scope B–E to Codex 5.5 via TASK_BRIEF.md.
- Gate: branch `current-main`, tree clean, no concurrent editing (last edits were the committed permission fix).
- Director did directly (tiny + docs): sidebar labels **Ledger→Logs**, **System→Health** (`Header.tsx`, page ids unchanged `ledger`/`system`); BLUEPRINT §6 Control responsibilities + Sync/Health bubble spec + Settings-local-only + Logs-hides-debug + Earn-belongs-Wallets.
- Wrote `TASK_BRIEF.md` (gitignored/disposable) for Codex 5.5 covering B (Risk = guard controls only, drop the embedded Rules&governance section, add Open-logs link), C (Logs severity model + filters + summary + hide debug by default), D (Health cleanup + new bottom-right `SyncHub` bubble, don't break API-key icon/RefreshDock), E (Settings = local UI prefs only, move API/security/health out).
- Build/test: run after the rename (see report). Current URL: local preview autoport.
- Next step: paste `TASK_BRIEF.md` into a Codex 5.5 chat to execute B–E; Director verifies + commits `ui: simplify control surfaces and health refresh model`.

**TODO (Wallets/Capital future pass):** Earn balance is NOT part of normal spot balances. A future read-only Wallets pass should add Simple Earn flexible/locked position adapters and **cache** them (endpoints are signed + high request-weight — do not poll Earn aggressively).

### 2026-07-07 — Full account + project audit (pre tab-by-tab pass)
- Purpose: confirm nothing broken/missing before editing each tab.
- Build clean; gates 50/50. All 15 sidebar surfaces render (no error boundaries, none empty); Execution's 5 sub-tabs (Ticket/Orders/Positions/Fills/PnL) all switch correctly (earlier "sticking" was a stale-DOM-ref test artifact — `<main key={page}>` remounts).
- Endpoint parity: every frontend `/api/*` call has a matching server route. All 14 read endpoints return 200 with real data: markets 442 rows, events 200, loans 166 loanable/119 collateral, account 5 assets / $50.03, feeds all open (spot-miniticker, futures-markprice, futures-liquidations), proposals 2, open orders 0, fills 0 (honest — no recent spot trades). No console errors/warnings.
- **Known limitation (not a blocker):** user data stream = `listenKey unavailable: Gone` — Binance returns **410 Gone**; the legacy listenKey user-stream endpoint is deprecated. App correctly falls back to 30s polling (account data stays live). Real fix = migrate to Binance WebSocket-API user data stream (own task; note the current HMAC key can't do the Ed25519 `session.logon` the new WS API wants).
- Cosmetic: some token icons are ORB-blocked from external CDNs (jsdelivr/coincap) in the preview sandbox → letter-avatar fallback; production uses the server icon resolver + CSP allowlist.
- Stale data: old ledger `error_event` "API key has WITHDRAWAL permission enabled" warnings are historical (pre key-scope fix, when it read account-level canWithdraw). New syncs no longer emit them.
- Verdict: **ready for tab-by-tab editing** — builds, tests, renders, real data all green.

### 2026-07-07 — Fix Binance key-permission detection (key-scope truth)
- Asked: stop judging safety by account-level `canTrade`/`canWithdraw`; use per-KEY `/sapi/v1/account/apiRestrictions` fields and posture rules; fingerprint 6+4; update Account permission map + System Health; keep trading/withdrawals blocked.
- Changed: `client.ts` — `maskApiKey` → first6+last4; defensive `coerceBool`/`normalizeRestrictions` ("false" string is truthy → would invert a check); exported `keyPosture()` (worst-wins: withdrawals→unsafe, universal/internal transfer→unsafe, spot&margin→trading, margin/futures/options→elevated, reading-only→"Read-only key OK"; carries ipRestricted). `account.ts` — `canTrade`/`canWithdraw` now sourced from key flags (`enableSpotAndMarginTrading`/`enableWithdrawals`), account-level only as fallback. `index.ts` — expose `keyPermissions` + `keyPosture` on `/api/state` and `/api/system`. `types.ts` + `Account.tsx` (full per-key permission map, posture badge, IP-restricted chip, unsafe warn only on real unsafe) + `SystemHealth.tsx` ("API key scope" row).
- Verified live (real key): `keyPosture=Read-only key OK` (level read_only), `ipRestrict=true`, all trade/transfer/withdraw flags false, fingerprint `MGVMfD••••VSPa`, Account posture 6/6, no console errors. build clean, gates 50/50.
- README: setup wording already correct (Reading only / withdrawals+transfer+trading off / IP restrict) — unchanged.
- Still blocked: trading (kill switch + risk gate), withdrawals/transfer-out (no routes). No raw key/secret exposed.
- Note: signed read-only endpoints need BOTH key + secret (HMAC signature) — `.env` has both, confirmed working.

### 2026-07-07 — Refresh/reconnect dock + authoritative per-key permissions
- Asked: cleanly push another chat's additions — top-bar key manifest, a bottom refresh/reconnect dock, connection-health.
- Changed (concurrent-session work, not Director-authored): 13 files + new `web/src/lib/refresh.ts`. Highlights: `RefreshDock` (bottom, WAA-driven spin, success/fail marks, health popover) + global `fireRefresh`/`useRefreshSignal`; `POST /api/refresh` (server resync); `GET /api/apikey` (key manifest — masked fingerprint + first-8 prefix only, never full key/secret); new client `apiRestrictions()` → `/sapi/v1/account/apiRestrictions` for **authoritative per-key** permissions.
- Security **correction** to prior run: the active key is genuinely **read-only** — per-key `apiRestrictions` = `{reading:true, spotMargin:false, marginLoan:false, withdrawals:false, universalTransfer:false, futures:false}`. Last turn's `canWithdraw:true` was the *account-level* flag (true even for read-only keys); the new per-key check is the real scope. No over-permissioned key. A second "secrets-full" manifest entry is a *planned* AWS-Secrets key (withdrawals still false), not active.
- Safety: no withdrawal/transfer/trade routes added; no secret in responses/logs. build clean, gates 50/50. Browser-verified: dock renders, no console errors, `/api/apikey` masked, dashboard shows real $50.031 equity, posture 5/6 "withdrawals disabled".
- Committed & pushed to `current-main`. Old `main` untouched.
- Next action: owner review; user-stream still on polling fallback; optionally wire the planned AWS-Secrets key later.

### 2026-07-07 — READ-ONLY BINANCE API PHASE
- Asked: show real Binance read-only account state from server-side env; no trading, no withdrawals/transfers, no frontend keys, no secrets in git/logs.
- Env names (already standard, no rename): **`BINANCE_API_KEY`**, **`BINANCE_API_SECRET`**. Server has a no-dependency `.env` loader (`server/src/index.ts` `loadDotEnv`). `.env` present, gitignored, untracked.
- Found: backend already had a full read-only account service (balances, equity, positions, PnL from ledger, permissions `canTrade`/`canWithdraw`, open orders, fills, user-stream+polling). Only gap = masked key fingerprint.
- Changed: `maskApiKey()` (first4••••last4 of the KEY only, never the secret); `keyFingerprint` added to `/api/state` + `/api/system` binance blocks; web type + Account "API keys" card show it; recreated `.env.example` (placeholders + read-only posture); README "Local read-only Binance setup"; `SKIP_DOTENV` flag so the gates harness boots keyless deterministically (real `.env` had broken the 8 disconnected-state gates).
- Verified live (real key): `connected=true`, masked fingerprint `MGVM••••VSPa`, 5 assets + live equity, open orders 0, `mode=HALTED`. build clean, gates 50/50. No console errors.
- SECURITY finding: the loaded key reports **`canTrade=true` AND `canWithdraw=true`**. The app blocks all of it (kill switch ON, no withdrawal/transfer route exists) and flags it loudly ("unsafe key scope" badge, warn strip, ledger warning), but the key is over-permissioned — owner should recreate it as Reading-only, trading OFF, withdrawals OFF.
- `userStream=failed` → polling fallback active (account data live via ~30s poll).
- Still blocked: trading (kill switch + live-off + risk gate), withdrawals/universal transfer/margin loan-repay-transfer (no routes exist).
- Next action: owner recreates the Binance key with read-only permissions; optionally revisit user-stream vs polling.

### 2026-07-07 — Commit animated top-bar menus
- Asked: push the current on-disk state cleanly — the other chat animated the top bar.
- Changed (concurrent-session UI work, not Director-authored): `web/src/components/Header.tsx` (unified top-bar menu/popover with slide+fade animation, rAF-tweened left/width), `web/src/styles.css` (`smIn`/`smFade` keyframes), `web/index.html` (favicon → arbitrage mark, title → "Arbitrage Control Room").
- Safeguard: build clean, gates 50/50 before commit. Tree was stable (last edit ~4 min prior).
- Committed `53ba5d5` (ui: animated top-bar menus + arbitrage favicon/title); pushed to `current-main`. Working tree now clean.
- Topbar control *set* unchanged (animation polish only) → no BLUEPRINT structural change. Old `main` untouched @ `80c234f`.
- Next action: resume skeleton/visual pass or Engine v0 Part 0; tag a fresh checkpoint if a pinned recovery point is wanted at `53ba5d5`.

### 2026-07-07 — Session-tracking checkpoint (formalized) + concurrent-edit note
- current branch: `current-main`.
- latest clean commit before the WIP: `75b10ee` (bootstrap audit).
- WIP summary: **active session tracking** — server `GET /api/sessions` (per-device, IP+UA, Cloudflare-aware, 30-min TTL) + account-card "Active sessions" list + `TrustedAdvisor` panel. Real request-derived data.
- files changed (in the WIP commit `c7d10d7`): `server/src/index.ts`, `web/src/components/Header.tsx`, `web/src/styles.css`.
- build/test result: **build clean, gates 50/50** — verified last turn at the exact content now committed as `c7d10d7`. Not re-run this turn because another agent is mid-edit on `Header.tsx` (would test a half-written file, not the committed checkpoint).
- GitHub state: default branch is now **`current-main`** (owner set it via the UI after last turn — origin HEAD symref confirms). Old `main` untouched @ `80c234f`.
- Director capability note: **can** push branches and tags over SSH; **cannot** change GitHub repo settings (default branch, etc.) or hit the REST API without `gh` or a Personal Access Token. Can read the remote default branch via `git ls-remote --symref origin HEAD` (no token needed).
- Concurrent-tree hazard: two agents share this working tree; `Header.tsx` observed flipping clean→modified in seconds. Do not stage/commit another session's files; commit only Director-owned docs.
- Checkpoint tags: `checkpoint-skeleton-pass1-current-main` (last turn) and `checkpoint-current-main-session-tracking` (this turn) both point at the committed session-tracking state.
- next exact step: let the other session finish `Header.tsx`; then, if a fresher checkpoint is wanted, re-run build/test on a clean tree and move the tag or cut a new one.

### 2026-07-07 — Source checkpoint tag (skeleton pass 1)
- Asked: create a recoverable source checkpoint tag `checkpoint-skeleton-pass1-current-main` on `current-main`; don't commit node_modules/dist/data/.env/secrets; leave old `main` untouched.
- Blocker found: working tree was NOT clean — ~298 lines of uncommitted "active session tracking + TrustedAdvisor" feature (server `/api/sessions`, account-card session list, styles), almost certainly from the other chat running a dev server in this folder.
- Owner decision: commit the WIP with safeguards (do NOT tag the old clean commit over real WIP).
- Safeguards run before committing: verified feature is wired end-to-end; build clean; gates 50/50.
- Changed: committed the 3 WIP files as `c7d10d7` (feat: active session tracking + trusted advisor panel). Then tagged `checkpoint-skeleton-pass1-current-main` and pushed branch + tag.
- Note for authoring session: BLUEPRINT.md still needs a proper entry for the new `/api/sessions` contract + account-card "Active sessions" / TrustedAdvisor UI — I committed but did not design it, so I left the product doc to the author.
- Old `main` @ `80c234f`: untouched.
- Next action: owner review; resume skeleton/visual pass or Engine v0 Part 0.

### 2026-07-07 — DIRECTOR BOOTSTRAP AUDIT
- Asked: prove the project survives if this chat dies — verify repo truth, docs-vs-code match, and that a fresh Director can resume from files alone; no UI/engine work.
- Verified: path `/Users/cosmosgeek/Desktop/Main`, branch `current-main`, head `be7a7f8`, remote `git@github.com:cosmosgeek0/arbitrage-cosmos.git`, clean tree; node_modules/data/.env/dist ignored, nothing forbidden tracked. Code sidebar (6 groups) + topbar + pages match BLUEPRINT §6; README → 4 core docs.
- Doc gaps closed: PROJECT_MEMORY §5 phase was stale (still said "next = screenshot") → updated to skeleton-done; RULEBOOK §22 Worker routing policy added (Director/Codex 5.5/Spark-restricted/Fable/Opus + 1-surface blast-radius cap); RULEBOOK §23 TASK_BRIEF.md context rule added (>40-line prompts go to TASK_BRIEF, worker gets one-line instruction); `.gitignore` now ignores `TASK_BRIEF.md`.
- Code changed: none (no doc-vs-code drift found).
- Bootstrap test: a fresh Director can answer all 12 questions from files alone → PASS.
- Next action: owner review; then reference-image visual pass, dark-mode pass, or Engine v0 Part 0.

### 2026-07-07 — Restore News/Calendar tiles + in-app CloudShell overlay
- Asked (owner correction to SKELETON PASS 1): put the bottom-left News/Calendar sidebar tiles back; put the topbar Cloud Shell button back; and make that top button open an in-app AWS CloudShell-style popup (like the News quick-view), not a new tab.
- Changed:
  - `Header.tsx`: restored `snav-utils` News/Calendar tiles; restored topbar CloudShell button (wired to `openOverlay('cloudshell')`); re-added `IconTerminal` import + `CLOUD_SHELL_URL`; new `CloudShellModal` (terminal-styled honest launcher) added to `Overlays()`.
  - `lib/overlay.ts`: `OverlayKind` now includes `'cloudshell'`.
  - `styles.css`: appended `.cs-*` terminal overlay styles (dark, AWS-orange banner, green prompt, native caret).
  - `BLUEPRINT.md` §6 updated: News/Calendar tiles kept; topbar set now lists CloudShell quick-view; CloudShell honesty note.
- CloudShell overlay is an honest launcher — real deploy-target facts (cg-arbitrage-01, /opt/arbitrage-cosmos, ubuntu, SSM), live host prompt `ubuntu@ip-172-31-2-134:~$`; "Open in AWS"/Enter opens the real console. No faked attached session.
- Tests: build clean; gates **50/50**. Browser-verified: bottom tiles visible, top button opens overlay (banner/region/prompt correct), zero console errors.
- Failed: nothing.
- Next action: owner review; then dark-mode screenshot pass or Engine v0 Part 0.

### 2026-07-07 — SKELETON PASS 1 (done)
- Asked: collapse cockpit into 6-group sidebar (OVERVIEW/CAPITAL/MARKET/ENGINE/EXECUTION/CONTROL); merge Trade/Orders/Positions/Fills into one Execution page with tabs; remove Tokens/Rules/Cloud Shell/News/Calendar from sidebar; rename Strategies→Basis Scanner; create Volume Scanner placeholder; keep topbar as-is (no additions).
- Started from clean tree @ 6131312 on `current-main`.
- Inspected: App.tsx routing, Header.tsx (sidebar/topbar/search), store.tsx Page ids, Palette, Rules/Risk/Dashboard/Strategies/SystemHealth pages.
- Changed:
  - Sidebar → 14 items / 6 groups exactly per spec. Tokens, Rules, Cloud Shell, News/Calendar tiles removed. Cloud Shell topbar icon also removed (not in the keep-list); admin link added inside System → Cost & usage.
  - New `web/src/pages/Execution.tsx`: tabs Ticket/Orders/Positions/Fills/**PnL**. PnL kept as a 5th tab (blueprint requires PnL under Execution; it had no other home) — flag to owner if unwanted. Old page ids stay valid internal routes → all existing setPage()/openTicket() deep links land on the right tab; sidebar keeps Execution highlighted via `match` list.
  - New `web/src/pages/VolumeScanner.tsx`: honest placeholder, 11 exact decision-board columns, no fake engine (page id `volume`).
  - Strategies renamed Basis Scanner (nav label, page title, doc titles). Page id stays `strategies`.
  - Rules page → `GovernanceSection` embedded at the bottom of Risk ("Rules & governance"); `rules` page id deleted from store/Palette/search; Dashboard links repointed to Risk.
  - Palette + sidebar search entries updated to the new skeleton; Token Detail reachable via Markets rows and token search only.
  - Page-scoped CSS appended to styles.css (exec-tabs, vol-*, risk-governance-card) — no global token changes.
- Tests: root build clean (tsc + vite); `npm test` gates **50/50 passed**. Browser-verified on session preview (port auto-assigned): Dashboard, Markets, Execution (tab switching works), Risk (governance section: 9 rule rows), Volume Scanner, Basis Scanner — zero console errors.
- Screenshots: Dashboard, Markets, Execution, Risk captured in-session (light mode).
- Failed: nothing.
- Blockers: none for skeleton. Next-step blockers: dark-mode screenshot pass not done this run; owner decision whether PnL stays a 5th Execution tab.
- Next action: owner review of skeleton → then Phase C/F visual pass with reference screenshots, or start Engine v0 Part 0 planning survey.
- New facts: another session's dev server occupies port 8080 in this folder; this session's preview auto-assigned a free port (launch.json `autoPort` works).

### 2026-07-07 11:17 IST — DOC SYNC protocol adopted
- Asked: make a DOC SYNC mandatory at the end of every Director run — define which of the four docs updates when, the grinder/`TASK_BRIEF.md` boundary, and the required final-response format.
- Inspected: RULEBOOK doc-ownership sections (§8, §20) for consistency with the new protocol.
- Changed: added `DIRECTOR_RULEBOOK.md` §21 (DOC SYNC protocol, doc ownership, grinder/`TASK_BRIEF.md` boundary, required final-response format); fixed §20 to send end-of-context state updates to `PROJECT_MEMORY.md` instead of the rulebook; added this run log.
- Committed/pushed: pushed to `current-main` this run (hash in `git log` / Director report).
- Failed: nothing.
- Current state: `Main` = git-tracked source of truth, branch `current-main`, clean tree, four core docs. App not run yet this session.
- Next action: Phase B — run the app and screenshot every current surface (light/dark).
- New facts: workflow rule — grinders never read `PROJECT_MEMORY.md`; Director issues one scoped `TASK_BRIEF.md` per worker.

### 2026-07-07 (~11:14 IST) — Main established as source-of-truth git repo
- Asked: make `Main` the committable/recoverable source-of-truth; init git if absent; attach remote without overwriting old history.
- Inspected: `.git` absence, tree sizes, GitHub SSH auth, `.claude/launch.json`, staged-file safety.
- Changed: added `PROJECT_MEMORY.md` (4th core doc); updated `README.md` + `DIRECTOR_RULEBOOK.md` §8 to four core docs.
- Committed/pushed: `68b28c7` initial import → pushed to new branch `current-main` (no force). Safety copy at `~/Desktop/Main-safety-20260707-111420` (excludes `node_modules/`).
- Failed: nothing.
- Current state: remote has `current-main @ 68b28c7` and untouched `main @ 80c234f`.
- New facts: GitHub SSH auth works as `cosmosgeek0`; `origin = git@github.com:cosmosgeek0/arbitrage-cosmos.git`.

### 2026-07-06 — Core docs authored
- Three core docs (`DIRECTOR_RULEBOOK`, `BLUEPRINT`, `ENGINE`) authored/installed in `Main`.
