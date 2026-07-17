# FULL LOCAL-STATE BRIEFING — Cosmos Arbitrage Control Room — 2026-07-16

**For:** the web commander (top-level ChatGPT commander). You have no repo access, no screenshots worth trusting, and no memory of prior sessions. This file is written to be **complete on its own**.
**By:** the independent read-only supervising commander (Claude, Fable 5) with direct filesystem + git access to every worktree on the owner's machine. Every SHA, count, and status below was **verified by direct git read on 2026-07-16 (~09:10Z)** — not taken from chat, and cross-checked against the acting director's own `COMMANDER_BRIEFING_20260716.md` (whose claims I independently confirmed; where I add or correct, I say so explicitly in §10).
**Repo:** `git@github.com:cosmosgeek0/arbitrage-cosmos.git` · branch `current-main` = `787b73d1` (local == origin, verified) · 94 registered worktrees · off-machine backup bundle `~/cosmos-arbitrage-backup-20260716.bundle` + GitHub origin.

---

## 0. Sixty-second orientation (read this even if you skip everything else)

1. **The core product LANDED yesterday**: `INTEGRATED_ACCEPTED` at merge `51efaaa4` (D-LAUNCH-50), after a full independent verification cycle that first **rejected** the candidate with 15 findings and only accepted the repaired one when **zero findings survived**. The product is a private Binance spot–perp arbitrage **control room**: deterministic strategy brain + capital/risk supervision + ledger + operator cockpit + a complete-but-unwired live-execution layer. It is still **validate-only**: it has never placed an order, never signed a private call, never deployed, and mechanically cannot move money (`LIVE_EXECUTION_NOT_IMPLEMENTED` is enforced and tripwire-tested).
2. **Right now** a post-landing burst is finishing: AI-operations code ports (8 of 9 sealed), an egress test patch, and a second CI determinism hotfix. GitHub CI shows red — that red is an **environment-only test-harness defect**, not a product defect (details §7.3).
3. **Next in line**: one fresh AI-Ops integrator + one fresh AI-Ops verifier (`VERIFIED_ACCEPTED` is the only acceptable token), two held-back donors admitted (A-FORMAL, S2), then the optional "Frontier" organ program behind an explicit authorization you (commander) and the owner control.
4. **The critical path has moved to the owner**: five items only the owner can do (signatures, ladder numbers, paging channel, key rotation, deployment authorizations). Machines are no longer the bottleneck.
5. Vocabulary decoder is in **Appendix B** — this project has heavy internal jargon (Q/L lanes, I00, C/C2/C2R, D-LAUNCH, ports, Frontier F-numbers). Use it.

---

## 1. What this product IS (plain terms, then precise terms)

**Plain:** a private, single-operator trading machine for Binance that hunts two edge families — (a) **Basis divergence**: the spot price and the perpetual-future price of the same asset drifting apart abnormally, traded two-legged (buy one, sell the other) to capture reconvergence plus funding; and (b) **Dead-volume wakeup**: dormant tokens showing early signs of coming back to life. Around that brain sits an "airplane cockpit" web control room, capital/risk supervision, a ledger that records everything, and (designed, being mounted now) an AI operations layer that watches/diagnoses/repairs the system under strict guardrails. It runs for one owner, on one EC2 box (eventually), behind Cloudflare. Nothing about it is public or multi-tenant.

**Precise:** Node/TypeScript backend (`server/`), React/Vite cockpit (`web/`), Python quant research factory (`quant/`), SQLite ledger + control persistence (`data/cosmos.db`), ops tooling (`ops/`: systemd/watchdog/backup/release scripts). Current posture: **live public market data in; simulated/validate-only decisions out; zero private/signed exchange calls in the composed runtime; no deployment yet (everything runs on the owner's Mac dev machine).**

---

## 2. EXACTLY what has been built (the anatomy, from the landed tree)

File counts are from `git ls-files` on the landed `current-main` — tracked source only, tests counted separately. Total tracked source across areas below ≈ **2,000+ files**; the owner's "half a million lines" characterization is consistent with this footprint.

| Area | Files | What it is |
| --- | --- | --- |
| `server/src` | 532 | the entire backend product (breakdown below) |
| `web/src` | 126 | cockpit: 33 pages, 37 feature modules, 26 components |
| `quant/` | 505 | Python research factory (Q lane): models, calibration, protocol, receipts |
| `server/test` + `test/` | 277 + 295 | the two test forests (focused + repo-level/acceptance) |
| `ops/` | 132 | deployment/watchdog/backup/release/drill scripts + their tests |
| `fixtures/` | 119 | deterministic test fixtures (incl. shadow-lane fixtures) |
| `docs/` | 69 | receipts archive, directives, evidence |

### 2.1 `server/src` — the backend organs (per-directory, verified counts)

- **`engine/` (42 files)** — the *sole strategy authority*: the Basis engine and Volume (dead-volume wakeup) engine. Deterministic; consumes live public Binance market data; produces proposals/opportunities. No other module may make strategy decisions (enforced by an authority map + tests).
- **`liveEdge/` (98 files — the largest organ)** — the **L-lane live-execution realism layer**, phases L00–L17, all `BUILT_AND_TESTED_UNWIRED`: private-truth model (what a real account looks like), a **signing kernel** (built, tested, *not connected to anything*), instrument specs, mutation journal (every would-be exchange mutation recorded durably), an **exchange twin** (simulated Binance for order lifecycles), execution policy, full two-leg lifecycles for normal-Basis / reverse-Basis / Volume, recovery/ambiguity handling (durable `UNKNOWN` on ambiguous outcomes — never blind resend), 27-role/18-control/36-metric/13-alarm evidence adapter (L13), external proof boundary (L16), and the final lane receipt (L17). **Non-sendable by construction:** nothing in this tree can reach the real exchange; that wiring is a separate, owner-gated future step.
- **`foundation/` (70 files)** — order/risk foundation: risk engine (≈884 assertions in its focused suite), execution coordinator (dry-run only), reconciliation fixtures, the canonical execution bridge (F-BRIDGE: terminalize-working-leg-before-hedge-sizing + cold-restart hydration — two real execution-correctness gaps found and fixed pre-landing).
- **`systemIntegration/` (70 files)** — composition root: supervisor, authenticated control APIs, kill-switch (fail-closed), vertical slice, System-Integration acceptance battery (180 checks).
- **`intelligenceRuntime/` (71) + `intelligenceFoundation/` (53)** — market-intelligence substrate and runtime: evidence collection, attention/queueing, composed public feeds.
- **`capitalFoundation/` (59 files)** — capital supervision: mandates, reservations (advisory until real account truth exists), capital→risk→execution→reconciliation chain (mounted during the fix cycle — was finding R3-A-CHAIN-002).
- **`productIntegration/` (30) + `productAssurance/` (14)** — I00 product-assembly layer: donor equality proofs, provenance, no-false-green inventory (expected vs discovered vs instrumented), assurance harnesses.
- **`services/` (10), `binance/` (10), `security/`, `ledger.ts`, `config.ts`** — public Binance adapters (read-only), service plumbing, perimeter/security checks (146+ perimeter tests), SQLite ledger owner.

### 2.2 `web/src` — the cockpit (126 files; 33 pages)

Airplane-cockpit UI on the existing design system: Dashboard, Control Room, Health/System, Opportunities, Risk, Markets, Accounts, Basis, Volume, Token, Orders, Positions, Fills, PnL, Borrow, Execution, Logs/Ledger, Notifications, and control surfaces. Truth-first rendering law: **no fake green** — missing/stale/unknown components must render as such (this law was enforced by the verification cycle; one of the 15 findings was exactly a suppressed attention queue and another a stale committed denominator). Browser ship-gate: 126+20 screenshot captures across light+dark themes are part of acceptance.

### 2.3 `quant/` — the Q lane research factory (505 files, frozen advisory)

Phases Q00–Q17 complete: data acquisition, microstructure features, derivatives/funding features, regime models, survival analysis, deep-model gate (honestly `FAIL_DATA_INSUFFICIENT` → `REFERENCE_ONLY`), validation infra, model registry, calibration, and the **edge protocol** (22/22 conformance). 3,011 pytest passing. Champion model `logistic:v1` exists but with `loadableModelPayload=false` → runtime answer is **`ABSTAIN_UNKNOWN`**, and edge status is **`NOT_ESTABLISHED`** — deliberately honest: no forward evidence exists yet, so the factory refuses to pretend. Q is advisory-only and cannot touch money.

### 2.4 `ops/` — deployment & operations tooling (132 files)

systemd unit templates, watchdog, backup/restore + restore-drill verification, release assembly/switch/rollback scripts, donor verification, static-safety tests. **Built and tested locally; no deployment has ever been executed** (deployment is owner-gated, I00 §20).

### 2.5 Assurance organs (landed: S1, S3, S4, S5, S6, S8; pending admission: A-FORMAL, S2)

Hazard analysis (S1/STPA), formal-model scaffolding (S3), assurance case (S4), cockpit assurance (S5), **A-AGENT (S6)** — the bounded propose-only LLM-investigator taxonomy that the AI-Ops plane activates — and stability (S8). **A-FORMAL** (deepened formal models M01–M13, at `b491893`) and **S2 actionEvidence** (`ca30adf`) were sealed *after* the candidate freeze and are queued for post-landing admission — excluded by ordering law, not by defect.

### 2.6 AI-Ops plane (ported, NOT yet integrated — important precision)

Under the controlling directive `POST_I00_EVENT_DRIVEN_AI_OPERATIONS_ACTIVATION.md`, five lanes (A1 contracts/policy/manifests, A2 case runtime, A3 provider adapters, A4 cockpit/permissions UI, A5 test harness) plus four support packets (ops/replay/obs/runbook) were built **speculatively in shadow** during the candidate crunch, then **re-built ("ported") against the landed tree with full re-acceptance** — shadow receipts never substituted. **Sealed+pushed ports:** a1 `8882644d`, a2 `6e9efe05`, a3 `21a0440f`, a5 `9769d461`, obs `884526c2`, ops `c5c9abb5`, replay `12f0934e`, runbook `05d3a1ff`. **Still in flight:** port-a4 (cockpit UI port), egress-patch, CI-HOTFIX-2. **Verified fact: `git ls-files | grep -c aiOps` on `current-main` = 0** — none of this is on main yet; it lands only through one fresh AI-Ops integrator + one fresh verifier (§8.1). Do not let anyone report AI-Ops as "done."

### 2.7 Frontier program (optional organs; PARKED behind your gate)

The organ-portfolio idea (digital twin, multi-venue eyes, edge meter, etc.) was adopted as directive `Frontier.md` — modules F0–F13. **Already built and sealed `PRESTAGE_READY`:** F0 Dock (frozen contract layer, 28/28 conformance, `e0ace68d`), F1 **VenueMesh** (multi-venue read-only market-data/basis sensor, `e435c1f0`), F2 **PortfolioLab** (`56a08f4e`), F3 **StrategyArena** (`3c9c794e`), F8 **EdgeMeter** (forward-only honest edge measurement, `7a658b98`). **Blocked/waiting:** F13 DecisionLab (needs an owner policy artifact that doesn't exist yet — sealed honest `BLOCKED` at `2c29de4e`), F11 (blocked on a dock facet), F4–F7/F9–F12 (need re-scouting — their target code was moving during the candidate). The whole program is parked until an explicit `FRONTIER_PORT_AUTHORIZED` decision.

---

## 3. HOW it was built (the method — why you can trust the above)

This project's distinguishing feature is not the code; it is the **operating system around the code**:

1. **Git + durable files are the only memory.** Every ruling is a numbered `D-LAUNCH-N` entry in `QL_DIRECTOR_STATE.md` (now 1–53); every worktree/branch/state is on a board (`QL_PARALLEL_DAG.md`, `WORKTREE_LEDGER.md` — machine-generated, 94 trees); every worker gets a copy-paste prompt block (`WORKER_PROMPTS.md`). Director chats have died/been replaced multiple times with **zero loss** — the resume law reconstructs everything from git.
2. **One writer per worktree, ever.** Parallelism came from cutting isolated worktrees per task (94 registered), each with exclusive paths, receipts sealed in-tree, and the director serially merging only verified work. No worker pushes; **only the director lands `current-main`**.
3. **Acceptance = receipts verified against git objects, never labels.** The integrator refused donors whose "ready" labels didn't verify (it caught a false "ready" on A-FORMAL by running the gate itself). Sealed receipts carry SHAs, test counts, and evidence paths.
4. **Roles were separated for the endgame** (this is the part that makes the landing trustworthy): Role-2 fresh integrator assembled 16 donors (L exactly last; donor equality 16/16/16/16); **Role-3 fresh independent verifier** ran everything from a clean detached tree and **REJECTED the first candidate** `098f7b9` with 15 findings — 3 Critical (deterministically broken completeness validator; non-dispositioned startup egress; tested-SHA readback could differ from candidate), 11 High (incl. unmounted capital→risk→execution chain, 33-role client omission, unbounded WS retries, watchdog deploy-lock, backup-manifest validation, crash-pending readback drop), 1 Medium (stale denominators). Four read-only analysis shards then **independently confirmed all 15 findings VALID**; Role-4 fixed all 15 plus 12 fix-audit rows; a stale provenance self-check failure on C2 was adjudicated (harness stale, not product — D-LAUNCH-48); the corrected freeze C2R `74eb452e` passed complete+performance+browser acceptance, an **independent validate-only run** passed, and a **fresh** Role-3 session returned `VERIFIED_CANDIDATE` with zero surviving findings. Then the director landed it (`51efaaa4`) and re-ran `npm test` on the landed tree: exit 0.
5. **Speculative work never contaminated acceptance.** During the fix crunch, shadow lanes pre-built the AI-Ops code under an explicit shadow law: outputs marked `SHADOW_SPECULATIVE`, no acceptance status, mandatory full rebuild ("port") against the landed tree afterward. That is exactly what the current port burst is doing.
6. **Test scale at acceptance:** root `npm test` 377/377 deterministic; full battery lanes ≈ gates 72, intelligence 152, runtime 394, capital 433, foundation 871 (risk 884 assertions), System Integration 180, L-lane accumulated `test:all` 2,479, Q lane 3,011 pytest + protocol 22/22, I00 proof 47/47, browser ship-gate 126+20 captures (both themes), plus security/perimeter suites. (Historic lane counts; the landed battery superset was green at Phase-5.)

**The single most important trust signal for you:** this process **rejected its own work product once** (15 findings, independently confirmed) and only accepted after a fresh verifier found nothing. Systems that rubber-stamp don't produce that history.

---

## 4. What is genuinely TRUE about capabilities right now (no marketing)

| Capability | Status |
| --- | --- |
| Live public market data (spot + USD-M), universe scan, Basis + Volume engines | **WORKING** (live public, read-only) |
| Cockpit (33 pages) with truth surfaces, controls, auth | **WORKING** locally; no deployment yet |
| Capital/risk supervision, ledger, kill switch, control APIs | **WORKING** (validate-only posture) |
| Two-leg execution lifecycles, recovery, signing kernel, exchange twin | **BUILT+TESTED, UNWIRED** — cannot send; wiring is a separate owner-gated step |
| Private account truth (balances, fees, real positions) | **MISSING by design** — requires owner-authorized private reads (never yet performed) |
| Signed/test orders, live orders, transfers, withdrawals | **MISSING/mechanically blocked** — no signed call has ever been made; no withdrawal/transfer code exists |
| Deployment (EC2/systemd/Cloudflare/sentinel) | **Templates+scripts built and tested; never executed** — owner-gated |
| AI-Ops plane | **Built + ported (8/9 sealed); not on main; not integrated; not activated** |
| Quant edge | **NOT_ESTABLISHED** — honest; zero forward evidence yet; Q abstains rather than pretends |
| Money at risk today | **Zero.** Nothing can move money. Canary ladder ($10→$50→$200) exists on paper only, each rung owner-gated |

---

## 5. The full journey in one paragraph (for your context)

A ~100k-line frontend-heavy "raw website" was progressively converted through directed sprints into organs (backend foundation, market intelligence, runtime, capital supervision, convergence), then a **two-lane program** built the real product: Q (research factory) and L (live-execution realism), plus IP packets (runtime/control/ops/proof) and eight assurance satellites, all as parallel one-writer worktrees with sealed receipts. A single controlling assembly program (I00) integrated 16 donors, and the four-role verification endgame (§3.4) landed it on 2026-07-16. Roughly 94 worktrees, 53 numbered director rulings, and two director-chat replacements were consumed in the process — with no loss, because the state lives in git.

---

## 6. What is running RIGHT NOW (verified ~09:10Z, 2026-07-16)

| Item | State |
| --- | --- |
| `current-main` | `787b73d1` = origin (two CI-hotfix commits + ledger regen atop the landing) |
| CI-HOTFIX-2 | worktree at `53c6da81` ("record CI hotfix 2 verification") — fix implemented+verified, sealing/landing imminent |
| port-a4 (AI-Ops cockpit UI) | in flight; worktree HEAD still at the landing commit ⇒ its work is **uncommitted in-tree** (protected by the no-clean law; 6 resume blocks were issued for capacity-stopped port chats) |
| egress-patch | same situation — in flight, uncommitted |
| Sealed today | ports a1/a2/a3/a5/obs/ops/replay/runbook (SHAs in §2.6) |
| Active writers (ledger) | ci-hotfix, egress-patch, port-a1/a4/a5/ops/obs |

### 6.1 Why GitHub CI is red (so you don't misread it)
Two **clean-checkout determinism defects in assurance harnesses** — not product logic. #1: an S4 harness assertion pinned a file count that was worktree-state-dependent (passed dirty, failed clean clone) — fixed+landed (D-LAUNCH-52, verified exit 0 in a fresh clone). #2: a proof-evidence renderer baked live-git provenance that differs on single-branch checkout — diagnosed exactly (D-LAUNCH-53), fix verified in the ci-hotfix worktree, landing next. Every red email since landing is this same gap re-reported per push. `INTEGRATED_ACCEPTED` stands; the director's reasoning (product tree byte-identical to the verified candidate; defect lives in harness environment-sensitivity) is sound and I verified the hotfix commits exist.

---

## 7. What REMAINS — the complete ordered roadmap

### 7.1 Immediate (this wave)
1. Seal CI-HOTFIX-2, port-a4, egress-patch (the three in-flight lanes).
2. **ONE fresh AI-Ops integrator** mounts the nine ported lanes into shared seams per the AIOPS-IR insertion registry (three registered insertion requests: one killable managed composition port; bounded AI read/chat routes behind existing operator middleware; single-Ledger persistence adapters — no second database/executor/authority).
3. **ONE fresh independent AI-Ops verifier** — only **`VERIFIED_ACCEPTED`** counts (POST_I00 law). Then the director lands AI-Ops onto main.
4. Director admissions of the two held-back donors: **A-FORMAL** (`b491893`) and **S2** (`ca30adf`).

### 7.2 AI-Ops activation (after it lands — phased, each gate owner-controlled)
`NOT_CONFIGURED` mount → provider owner-activation gate (real API project, budgets, retention posture — a chat subscription is *not* API capacity) → `SHADOW` (diagnoses recorded, zero influence) → `ADVISE` → `SANDBOX_PATCH` → per-runbook Class-A enablement with owner game-days. Hard denials are permanent (no order signing, no fund movement, no credential access, no self-approval, no self-deploy — even with every toggle on). 120 server-enforced cockpit controls; three isolated AI identities + optional shadow trade-context advisor.

### 7.3 Frontier (optional organs — your explicit gate)
Decide `FRONTIER_PORT_AUTHORIZED`: port F0/F1/F2/F3/F8 onto the landed tree (same port law as AI-Ops), order rescouts F4–F7/F9–F12, unblock F11 (dock facet), and F13 needs the **owner policy artifact** first.

### 7.4 Deployment & live bring-up (all owner-gated, none started)
EC2 provision + systemd + Cloudflare tunnel/Access + external sentinel + paging channel → **staging deployment rehearsal + game-day drills** (ops/runbook ports provide the templates) → private read-only keys (first-ever private calls; separate authorization) → signed **test** orders (validation only; separate authorization) → $10 canary → $50 → $200 (each rung a separate durable owner authorization with forward evidence).

### 7.5 Q lane forward restart
Q shifts from frozen-advisory to forward-testing **only after deployment** gives it a 24/7 runtime: forward shadow-intent recording starts the honest-edge clock (EdgeMeter/F8 exists for exactly this). Until then "edge NOT_ESTABLISHED" is the only true statement.

### 7.6 Owner-only checklist (the actual critical path now)
1. Sign `AI_OPS_RELIABILITY_TARGETS` + per-runbook manifests (drafts ready on `aiops-prestage-20260714` and `preverify-20260714 ownerPrep/`) — blocks AI-Ops acceptance.
2. Set capital-evidence ladder numbers.
3. Pick the paging destination (and set the AWS billing alarm at deploy time).
4. **Key rotation** (old hardcoded Alchemy key; any Binance key that ever touched a ZIP) — still owed.
5. Write F13's owner policy artifact (if DecisionLab is wanted).
6. The deployment / private-read / signed-test / canary authorizations, each separately, when their gates arrive.

---

## 8. Decision menu for YOU (the web commander) — with my recommendation on each

1. **CI standing law** (director proposal): make "all acceptance generators must be single-branch-clean-checkout deterministic" a permanent law + add a CI-equivalent clean-clone gate to every future seal. **Recommend: YES — adopt verbatim.** Two consecutive hotfixes prove the gap class is real.
2. **AI-Ops first activation ceiling**: OBSERVE vs SHADOW after `VERIFIED_ACCEPTED`. **Recommend: SHADOW** (diagnoses recorded but influencing nothing) — it generates the labeled evidence the graduation gates need, at zero authority; plus sign-off of the provider identity matrix at the same time.
3. **Frontier timing**: authorize the F0/F1/F2/F3/F8 port now (parallel with AI-Ops integration; disjoint namespaces) or after AI-Ops lands. **Recommend: after the AI-Ops verifier returns** — one integration in flight at a time kept this project alive; Frontier is parked safely and loses nothing by waiting days.
4. **Deployment game-day date + paging channel**: the single highest-leverage scheduling decision — everything in §7.5 (the edge clock itself) is downstream of a deployed runtime. **Recommend: schedule the staging rehearsal immediately after AI-Ops lands**, before Frontier.
5. **Q forward restart**: tie it to deployment day (it needs the 24/7 runtime), not to a calendar date.
6. **Data moat** (my addition): authorize continuous recording of full-depth tape + funding series now-ish — history not captured is gone forever, and the twin/EdgeMeter/autopsies all feed on it.

---

## 9. Where a mistake could still hurt (standing risk register)

1. **Uncommitted in-flight work** in port-a4/egress-patch trees — protected by the no-clean/no-prune law; resume blocks exist; do not let anyone "tidy" a dirty worktree.
2. **Approval fatigue**: post-landing the owner becomes the gate for many items; batch and schedule the signatures rather than drip them.
3. **Never treat CI-red as product-red or vice versa**: the current red is harness-environment; the standing-law fix (§8.1) closes the class.
4. **The unwired signing kernel** is the most dangerous future seam by nature; its wiring must arrive only through the owner-gated ladder with the same role-separated verification as I00 — never as a "quick patch."
5. **Vocabulary drift between commanders**: multiple AI commanders have introduced near-synonyms (Sentinel/AI-Ops/organs/Frontier). The controlling names are: **POST_I00 directive** for AI-Ops; **Frontier.md** for optional organs; everything older is `SUPERSEDED_REFERENCE_ONLY` and must never be revived as a parallel program.
6. **No false green** remains the prime directive for every future report you receive: demand receipts + SHAs, not labels — this briefing follows that rule itself.

## 10. My independent findings (things the director's briefing didn't say, or that I verified/corrected myself)

1. **`STATE.md` on the landed main is stale** — it still shows the pre-landing C2R-seal snapshot (`INDEPENDENT_VALIDATE_ONLY_PENDING`), because the landing kept the product tree byte-identical to the verified candidate. Truth lives in `QL_DIRECTOR_STATE.md` (D-LAUNCH-50) and the ledger, but STATE.md's own header law says it wins on "current state" — it should be atomically rewritten to the landed posture during this hotfix wave. Low risk, worth one commit.
2. **AI-Ops is 0 files on main** (verified `git ls-files`) — sealed ports live on branches only. Correct per process; flagged so nobody reports it as integrated.
3. **Two deferred money-path-adjacent contracts** from the L lane (ledger compare-and-set primitive; Foundation quantity-bridge contract, parked in `live-edge-receipts/patches/`) were queued for explicit disposition at I00 fan-in. I have not personally sighted their disposition receipts in the landed evidence. **Ask the director for the exact D-LAUNCH/receipt reference that dispositioned each** — expected answer is one line; if either was silently dropped, it must be re-queued (they are exactly the class of thing that must never disappear silently).
4. **The endgame proved the process**: I re-verified the landing chain by direct git read (C `098f7b9` → role4 closure `37eeb5b0` → C2 `449350d6` → C2R `74eb452e` → seal `cf3416be` → landing `51efaaa4` → hotfixes → `787b73d1`). All present, all consistent with the rulings. The director's briefing is accurate — no false claims found.
5. **Backup exists** (`~/cosmos-arbitrage-backup-20260716.bundle` + origin) — first-class off-machine recovery point; good; recommend regenerating it after AI-Ops lands.

## 11. Laws permanently in force (restate to every new worker)

One writer per worktree · only the director lands `current-main` · workers never push · **never** `git clean -fdx` / `worktree prune` / `reset --hard` on any tree · acceptance only via receipts verified against git objects · all external actions (deploy, AWS/Cloudflare/DNS, private reads, signed calls, capital, key handling) owner-gated **per action** · `LIVE_EXECUTION_NOT_IMPLEMENTED` and the §4.3 hard denials stand until the owner's separate live-bring-up gates · superseded directives are reference-only, never executed.

---

## Appendix A — SHA quick reference (all verified 2026-07-16)

| Thing | SHA |
| --- | --- |
| `current-main` (= origin) | `787b73d1` |
| Landing merge (`INTEGRATED_ACCEPTED`) | `51efaaa4` |
| Verified candidate C2R / its seal S2 | `74eb452e` / `cf3416be` |
| Rejected first candidate C / its seal | `098f7b9` / `517bd63` |
| C2 (corrected freeze) / Role-4 closure | `449350d6` / `37eeb5b0` |
| AI-Ops ports (sealed) | a1 `8882644d` · a2 `6e9efe05` · a3 `21a0440f` · a5 `9769d461` · obs `884526c2` · ops `c5c9abb5` · replay `12f0934e` · runbook `05d3a1ff` |
| CI hotfix #1 landed / #2 in worktree | `6c6d1edd` / `53c6da81` |
| Frontier sealed | F0 `e0ace68d` · F1 `e435c1f0` · F2 `56a08f4e` · F3 `3c9c794e` · F8 `7a658b98` · F13 blocked `2c29de4e` |
| Pending admissions | A-FORMAL `b491893` · S2 `ca30adf` |
| Q lane frozen | `02b4ecc` (3,011 pytest; protocol 22/22) |
| L lane sealed LANE_READY | `df6b472` |

## Appendix B — vocabulary decoder

**Q lane** research factory (Python; advisory; cannot touch money) · **L lane** live-execution realism layer (built, tested, unwired, non-sendable) · **I00** the single controlling final-assembly program · **IP-RUNTIME/CONTROL/OPS/PROOF** product-integration packets · **S1–S8 / A-\*** assurance satellites (S6/A-AGENT = the propose-only LLM investigator the AI-Ops plane activates) · **C / C2 / C2R / S2(seal)** candidate → corrected candidate → re-frozen corrected candidate → its sole-child evidence seal · **Role 1–4** director / fresh integrator / fresh independent verifier / fix owner · **D-LAUNCH-N** numbered director rulings (1–53) · **RUN-N / CHAT-N** worker prompt blocks · **port** rebuilding a shadow artifact against the landed tree with full re-acceptance · **AI-Ops (POST_I00)** the event-driven AI operations plane (watch → diagnose → propose → bounded repair, owner-gated) · **AIOPS-IR** its insertion-request registry · **Frontier F0–F13** optional organ program (F0 dock contract, F1 VenueMesh, F2 PortfolioLab, F3 StrategyArena, F8 EdgeMeter, F13 DecisionLab) · **canary ladder** $10→$50→$200 owner-gated live steps (none taken) · **no-false-green** the law that missing/unknown must never render as healthy.

*End. Written read-only; nothing in any worktree was modified. Every claim above is checkable against the repo by SHA.*
