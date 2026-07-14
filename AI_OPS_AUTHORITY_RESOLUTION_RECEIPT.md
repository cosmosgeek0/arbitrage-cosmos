# AI_OPS_AUTHORITY_RESOLUTION_RECEIPT.md — director-owned (D-LAUNCH-28)

Written 2026-07-14 per command.txt correction 1. Every authority named by the AI-Ops directive is resolved to REAL repository content by direct Git inspection. No dummy file was or will be created to satisfy a referenced name.

## Controlling documents (owner Desktop, hashes recorded)

| File | SHA-256 (first 12) | Status |
| --- | --- | --- |
| POST_I00_EVENT_DRIVEN_AI_OPERATIONS_ACTIVATION.md | `cbc523fd1857` | CONTROLLING subordinate AI-Ops directive |
| command.txt | `4d938de306fb` | Binding launch corrections (authority resolution; 5-state subscription-worker model) |
| AI_OPS_ACTIVATION_ADDENDUM_FOR_DIRECTOR.md | — | **NOT_PRESENT on Desktop at adjudication.** If it arrives it must arrive as a file and be hashed + adjudicated before consumption; nothing is assumed from its name |

## Authority name → real repository content (blob SHAs at current-main d78be24)

| Name referenced by directive | Real authority | Blob/hash | Reason |
| --- | --- | --- | --- |
| BLUEPRINT.md | MISSION.md + ARCHITECTURE.md (Part I orientation) | `239f0f938360` / `93d7604599b4` | Root docs frozen 2026-07-12 to one-file-per-purpose; blueprint concept split across mission + architecture; no file named BLUEPRINT.md exists and none will be created |
| DIRECTOR_RULEBOOK.md | DIRECTOR.md + AGENTS.md | `c8f6b263904e` / `d1c22f41616f` | Directing method + binding agent rules are these two frozen root docs |
| PROJECT_MEMORY.md | docs/archive/** (historical journal) + QL_DIRECTOR_STATE.md (live program state) | archive tree / `8116ec491fc7` | Journal archived at docs freeze; live memory is the director state file per its own header |
| ENGINE.md | ARCHITECTURE.md Part II (engine/authority rows) | `93d7604599b4` | No standalone engine doc exists; Part II is the accepted System Authority Map (also serves LIVE_PRODUCT_AUTHORITY_MAP per D-LAUNCH history) |
| STATE.md | STATE.md (root) — STALE BY DESIGN until landing | `0f0a8418a3b1` | Rewritten atomically only in the Phase-5 landing commit (D-LAUNCH-19.4); AI-Ops work must not treat current content as integration truth |
| I00 §14 (diagnostic plane owner) | I00_PRODUCT_ASSEMBLY_CONTROL_ROOM_AND_LIVE_BRINGUP.md (owner directive, untracked, preserved) | `9d7a36da6a2e` | Hash matches D-LAUNCH acceptance log |
| IP-ASSURANCE §§3.1–3.9 / Amendment §7 S6 | IP_ASSURANCE.md (tracked, amended at c57610c) | `308a7b90a3a7` | S6/A-AGENT law source |
| S6/A-AGENT accepted owner | branch `ip-assur-agent-20260713` tip `97e87bd` — integrated into the I00 candidate | git object | The contracts the AI plane must REUSE; no competing AgentOps system |
| Operational Failure Atlas | S1 hazard owner, branch `ip-assur-hazard-20260713` tip `ab33b37` — integrated | git object | Atlas + expected-family denominator live here |
| Canonical incident/material-event owners, command/remediation registry, Control Plane, durable ledger/persistence, cockpit APIs | Canonical server/web code inside the I00 integration candidate (branch `i00-product-assembly-20260713`) | candidate SHA at freeze | Exact file-level seams to be enumerated by the AIOPS-PRESTAGE reuse inventory (read-only) and ratified at A-lane worktree cut |
| Superseded LLM/Sentinel drafts (SEN-00..SEN-18 etc.) | NONE — must not be executed or reconstructed | — | Directive §0 supersedes them; no Sentinel database/executor/control-plane/website/veto is authorized |

## Subscription-worker correction (command.txt §2, supersedes directive text)

Provider/worker states are exactly: `NOT_CONFIGURED`, `SUBSCRIPTION_CODEX_WORKER`, `SUBSCRIPTION_CLAUDE_CODE_WORKER`, `API_CONFIGURED`, `DIAGNOSTIC_PLANE_UNAVAILABLE`. Subscription workers: trusted private machine/runner only; normal subscription limits; NEVER silent switch to API billing/credits/another account; honest transition to `DIAGNOSTIC_PLANE_UNAVAILABLE` on limit/auth loss; scope = incident diagnosis, research, isolated worktree repair, tests, verification, owner-visible recommendations ONLY; zero trading/Capital/Risk/credential/deployment/Main-write/self-approval/self-expansion authority; no consumer login embedded in the website; no subscription credential exposed to app/browser/models/repo/workers.

## Standing gate

Program state: **WAITING_INTEGRATED_ACCEPTED.** Until the immutable `INTEGRATED_ACCEPTED` SHA exists: read-only inventory + collision mapping only; no Main/integration/shared-seam writes; A1–A5 launch only from that exact SHA (five isolated worktrees, one writer each). All §4.3 hard denials of the directive are law from this moment and forever.
