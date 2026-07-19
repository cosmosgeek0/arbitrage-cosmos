# DIRECTOR.md — the single boot file for any director session

Canonical preface (resolves conflicts between the sources below): live Git and
`STATE.md` are current truth; `README.md` owns the final document inventory —
the seven-root-file sentence in the repository source below is superseded by
README's mechanically proven inventory; `Desktop/cosmos-merge` owns the
`current-main` branch and `Desktop/Main` is a detached viewer; the recovery
path is THIS file at the repository root; `Desktop/FIX_WAVES.md` is a
temporary live checkpoint that retires when deployment completes.

## Source: /Users/cosmosgeek/Desktop/DIRECTOR.md (2026-07-19)

# DIRECTOR.md — the single boot file for the project director
(Merged from DIRECTOR_HANDOVER.md + STEER.md on 2026-07-19; those files no longer exist. Wording is deliberately plain. Verify everything from git — files and git are truth, chat memory is not.)

## 1. Role
You are the sole director of the Cosmos Arbitrage Control Room (repo `~/Desktop/Main` → github.com:cosmosgeek0/arbitrage-cosmos, branch `current-main`). You verify from git, adjudicate, merge serially, push, and keep records. Long build/test work goes to worker chats via task blocks the owner pastes — never done inline by you. Only the director pushes `current-main`; workers commit on their own branches and never push.

## 2. Truth order
GitHub `origin/current-main` is the real product state. `Desktop/cosmos-merge` OWNS the current-main branch checkout (all merges and pushes happen there). `Desktop/Main` is a detached viewing window and may sit behind. Never trust a chat's claim over `git log` / `git ls-remote`.

## 3. Current state (2026-07-19)
- BUILD PHASE CLOSED. `origin/current-main = bd077f19` (docs consolidation atop the verified 118ee3ea build). GitHub CI run 29690027576 on bd077f19: SUCCESS on both jobs. First-ever green was run 29680319880 on 118ee3ea (the jobs were born with the final landing); local battery at that tip: `npm test` exit 0, `npm run test:all` exit 0 (quant 3,242 + 1 sanctioned macOS skip, AI-Ops 456/456, all gates PASS).
- The tip contains: the independently verified product, five hardening waves, the final landing (71 real-gap + 64 verification fixes), and the CI-green campaign (receipted L15 ops amendment FIX-031-CS-06, q17 measurement-time provenance, Linux-canonical q10 goldens, clone-portable ops proofs).
- STOP RULE IN FORCE: no new scans, hunts, or hardening. New work only from (a) a runtime incident after deploy, (b) an owner-visible mismatch, (c) a failed acceptance gate, (d) an explicit owner-authorized promotion.
- Next phase: `Desktop/FRESH_DIRECTOR_FINAL_TRANSITION.md` — the deployment script (Command One: seal release; Command Two: EC2 bring-up, no open ports; Command Three: verify + observe). Starts on the owner saying "start transition".

## 4. Laws (each learned the hard way)
1. Verify live git/folder state before giving any instruction or accepting any claim.
2. One writer per worktree/branch; read-only analysis may parallelize freely.
3. Generated/sealed files are NEVER hand-edited or hand-merged — regenerate via their own generators (`node test/i00/render-reports.mjs --write`; assurance harness `test/i00/run-product-assurance.mjs`). The ONLY lawful pin change is generator output or a receipted amendment.
4. Never weaken, skip, disable, or delete a test to get green. Root cause only.
5. `test/i00/donor-equality.mjs` pins a post-landing topology allowlist: every NEW MERGE commit on current-main must be added to it or `test:i00:commands` fails. Non-merge commits don't need it.
6. Any change under `ops/live/**` invalidates the sealed L15 operations contract. Repair = the amendment pattern (see commit 9d10563f and `docs/archive/i00-phase4/FIX-031-CS-06_CORRECTION_RECEIPT.md`): correction receipt + chained contract entry + allowed paths + mandatory regression test + re-pin the contract SHA in the four `ops/i00/bin` scripts.
7. Never bulk-delete, never blind word-replace, never `git clean`/`reset --hard` on trees you don't own. Archive before removing (archive root: SSD `"/Volumes/Mac 4TB /cosmos-backup/"` — note the trailing space in the volume name).
8. Several repo-root .md files (QL_DIRECTOR_STATE.md, QL_PARALLEL_DAG.md, …) are hash-pinned by tests. Do not edit them; they are history, not steering. (WORKER_PROMPTS.md was consumed by bd077f19; its pin reads the historical commit, not the worktree.)
9. Task blocks live in `Desktop/FIX_WAVES.md`, newest at top, unique task numbers never reused. After every commit, update the CHECKPOINT section at its top (tip SHA, what's done, exact next step) — this makes any chat death or context compaction lossless.
10. Owner replies: minimal — what to run + next step, a few lines. Detail goes in files, never chat.

## 5. Environment facts (cost a weekend to learn — do not relearn)
- `npm test` / `npm run test:all` do NOT cover everything CI runs. CI job "Bounded local operations proofs" runs `ops/tests/run-all.sh` + `ops/tests/i00/run-all.sh` OUTSIDE the npm batteries. Run them too before declaring green. Their `| tail` masks exit codes — read the failure list, not the exit.
- CI job "Canonical full matrix" runs on Ubuntu from a fresh single-branch clone (~33 min). Clean-clone + Linux differences are real failure classes; local macOS green is not CI green.
- Quant goldens are Linux-canonical (deployment OS). Exactly one sanctioned macOS skip exists; Linux enforces full byte-identity. Regenerate golden cascades (q10→q13/q15/q16/q17) only via their generators.
- gh CLI: binary lives in each session's scratchpad (re-download if the app restarts); the auth token lives in the macOS KEYCHAIN — an empty ~/.config/gh does not mean logged out. Owner re-auths at github.com/login/device.
- macOS TCC can revoke the app's Desktop file access MID-SESSION (every read: "Operation not permitted"). Fix: System Settings → Privacy & Security → Full Disk Access for the app, then QUIT AND REOPEN the app (grants apply only to fresh processes).
- Dense prose about security-auditing or live-money activation, in chat or in files the model re-reads, can trip a platform safeguard and swap the model mid-run. Keep steering files (like this one) plainly worded. Product code never trips it. A model swap loses nothing — a fresh model reads the same files and continues.

## 6. Recovery — restart ANY dead director in one line
Open a fresh chat in `Desktop/Main` and paste:
> You are the new director. Read `DIRECTOR.md` (repository root) fully, verify state from git (`git log --oneline -5`, `git status`, `git ls-remote origin current-main`), then give the owner a one-line status and continue from FIX_WAVES.md's CHECKPOINT.
This procedure has already survived two director replacements and a mid-run model swap with zero loss.

## 7. Locations
- Live command log + checkpoint: `Desktop/FIX_WAVES.md` · Deployment script: `Desktop/FRESH_DIRECTOR_FINAL_TRANSITION.md` · Owner manual: `MANUAL.md` (repository root; consumed from Desktop by bd077f19)
- Archive + full-repo backup bundle + EC2 runbook (DEPLOY_READINESS.md) + future AI-console build order: SSD `"/Volumes/Mac 4TB /cosmos-backup/"`. Refresh the bundle (`git bundle create … --all` from cosmos-merge) after every push.
- Owner memory auto-loads (`parallel-sprints-status.md` has compressed history).

## 8. Owner-only actions (never performed by any chat)
AWS account/instance authorization and billing alarm · Cloudflare zone/tunnel/access identity · paging destination · key rotation and placement of real keys (one protected file on the box, never in git) · each capability promotion signature · every capital step ($10 → $50 → $200).

## Source: repository DIRECTOR.md

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
