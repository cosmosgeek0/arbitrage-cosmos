# DIRECTOR.md — how this project is directed

The director is the repo controller, not the primary coder. Builders (Codex or Claude subagents) construct; the director owns isolation, scope, verification, landing, and documentation. A fresh director must be able to take over from the root docs alone: read `STATE.md`, then `MISSION.md`, then `ARCHITECTURE.md`, then this file.

## Actor hierarchy

```text
Owner  ->  Director (Claude Code / Fable)  ->  one builder lead per sprint (Codex or Claude)
                                              -> bounded subagents, exclusive directories each
```

- One writer per working tree, always. Two builders never share a checkout.
- The director never writes in a tree while a builder runs in it.
- Builders never commit to `current-main`, never merge, never push. The director lands.

## The sprint pattern (proven five times)

1. **Directive** — one markdown file states scope, exclusive write namespaces (`server/src/<family>/**`, `server/test/<family>/**`, allowed root receipts), safety laws, waves, tests, receipt format. Archive it in `docs/archive/` when the sprint lands.
2. **Isolation** — parallel sprints get disjoint namespaces; if two must run at once, one runs in a fresh `git clone --no-local` of the repo and is fetched back later. A sprint editing shared files (startup, routes, package.json, web) can never run in parallel with anything.
3. **Branch** — the director pre-creates the feature branch from the verified base SHA and records it. Builders resume it, never invent one.
4. **Checkpoints** — builders commit complete, tested waves only; suggested messages live in the directive. No half-implemented lane in a final commit.
5. **Verification (director, from git — never from screenshots or chat claims):**
   - scope: `git diff --name-only <base>..HEAD` must stay inside the allowed namespaces;
   - build + every focused suite + the full battery (`npm run test:all`), capturing **real exit codes** (beware pipelines eating them — check `PIPESTATUS` or log to a file);
   - static scans: no network/fs/env/timers/random/wall-clock in pure domains, no secret-like literals, no forbidden authority imports;
   - the anti-garbage gate: deterministic behavior, injected clocks, no import-time side effects, meaningful failure tests, documented wiring seams.
6. **Landing** — fast-forward or clean merge into `current-main`, tag the sprint tip (`sprint-<name>-final`), push branch + tag + `current-main`, then update `STATE.md` in the same landing.
7. **Receipts** — every sprint ends with a components manifest and a measured receipt; both move to `docs/archive/` at landing with `STATE.md` pointing at them.

## Safety laws (non-negotiable, inherited by every builder)

- No live orders, test orders, borrow/repay, transfer, withdrawal, leverage or margin mutation — ever, in any sprint, until the owner's separate signed-validation program starts.
- `LIVE_EXECUTION_NOT_IMPLEMENTED` stays mechanically enforced and tripwire-tested.
- No secrets in code, fixtures, logs, receipts, or prompts. `.env` is never read by pure domain code.
- Deterministic tests are network-free; public smoke programs are explicit, manual, and honest about PARTIAL results.
- Unknown values stay `null`/`UNKNOWN`/`UNAVAILABLE` — never fabricated zeros or confidence.
- Existing engines own strategy; nothing recomputes their scores. One concept, one owner (see ARCHITECTURE.md Part II).
- Never `git reset --hard`, force-push, or clean an unexplained working tree. Preserve unfamiliar files and ask.

## Token economy

Builders burn build tokens; the director stays cheap: setup, prompts, scope checks, test runs, landing. If a builder dies mid-sprint (usage limits), the director inspects git, then writes a self-contained resume prompt stating: expected branch/SHA, committed checkpoints, what the untracked drafts are, and exactly what remains. Never restart a sprint that can be resumed.

## Documentation law (how the project self-documents)

- `STATE.md` is updated in the same commit as any landed state change — component status, verification counts, next steps. This replaces chat history as memory.
- Root holds exactly one file per purpose (README, MISSION, STATE, ARCHITECTURE, AGENTS, DIRECTOR, DESIGN). Adding a root doc requires retiring one.
- Sprint directives, receipts, manifests, audits, and superseded blueprints live in `docs/archive/` — never deleted, never bloating the root.
- ARCHITECTURE.md Part II (authority map) is amended in the same change that shifts any ownership.
- No chronological diaries: state, not story.
