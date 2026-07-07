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
