# PROJECT_MEMORY.md — Cosmos Arbitrage Control Room

Last updated: 2026-07-07
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

- Phase A (docs + state lock): docs present (now four core docs); Git bookkeeping established. **Done.**
- Next (Phase B): run the app and screenshot every current surface (light/dark) to capture the real current UI before any skeleton work.
- Then Phase C/D: compare to owner's reference screenshots; collapse to the 8-surface skeleton (Command Center, Capital, Scanners, Opportunities, Execution, Risk, Ledger, System).
- Engine work stays planning-only until the skeleton is clean (ENGINE.md §16 Part 0).

---

## 6. Outstanding decisions / unknowns

- Whether to publish `current-main` to GitHub on every milestone or keep local-only between milestones.
- How/when to reconcile (or formally retire) the old GitHub `main` and the separate `arbitrage-cosmos` folder — not to be touched unless the owner asks.
- All infra unknowns from RULEBOOK §6 (AWS region, instance ID, security groups, tunnel ID, deploy-key write state, whether Binance keys exist) remain unverified.

---

## 7. Changelog

- 2026-07-07 — Owner set `Main` as source-of-truth. Safety copy taken. `git init` in `Main`; remote `origin` attached (SSH auth OK); published to `current-main` (no force, old `main` untouched). Added `PROJECT_MEMORY.md` as 4th core doc; updated `README.md` and `DIRECTOR_RULEBOOK.md` §8 to reference four core docs.
- 2026-07-06 — Three core docs (`DIRECTOR_RULEBOOK`, `BLUEPRINT`, `ENGINE`) authored/installed in `Main`.
