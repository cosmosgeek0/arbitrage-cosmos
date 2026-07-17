# LANDING_HANDOFF.md — for a fresh Fable director

Neutral-worded so it does not trip the model safeguard. Verify everything from git; do not trust chat.

## State
- current-main = 6c9e46af (origin synced). This is the landed, verified product base; do not disturb until landing.
- Verification campaign branch = truth-campaign-20260716 (origin tip 951e7a60). truth-a (folder ~/Desktop/truth-a) is the sole candidate owner and now has self-push + self-loop authority on THIS branch only (never current-main).
- Immutable base candidate parent = C2 dea2d2a5c2b5e83d3aea75b0e368f0a478596561. Every new candidate must be a SINGLE correction commit whose SOLE DIRECT parent is C2 (assert direct-parent equality), with evidence in a separate later child.

## The loop (running now, no director needed until landing)
1. truth-a fixes the current defect wave → freezes candidate C(n) (direct child of C2) → self-pushes the branch → runs the live-remote clean-clone battery → emits BASELINE_TRUTH_ACCEPTED:<C(n)>.
2. A separate fresh session (the final verifier) clones exact C(n) read-only, runs the full campaign audit, emits VERIFIED_ACCEPTED:<C(n)> or REJECTED:<C(n)>. Verifier receipts are archived under docs/archive/campaign-detail-20260716/.
3. On REJECTED, truth-a auto-loops to the next candidate. On VERIFIED_ACCEPTED, the director lands (below).
- History so far: C3 rejected (6 findings), C5 rejected (4 findings), now on defect wave 5 → C6. Findings shrinking; recurring class is evidence-descendant binding + a couple of product false-green fixes.

## Landing (director only, after VERIFIED_ACCEPTED:<Cn>)
Mechanical, no source edits:
1. Verify the accepted Cn from git: its sole direct parent is C2; the verifier receipt ends VERIFIED_ACCEPTED:<Cn>; origin has Cn.
2. Fast-forward or exact-tree-hash promote Cn onto current-main (mechanical promotion only; product tree of the landing commit must byte-equal Cn's tree; keep only the director-coordination files if they differ). Rerun the required acceptance once on the landed tree (npm test) and confirm exit 0 before pushing.
3. Push current-main; record INTEGRATED_ACCEPTED with the exact SHA in QL_DIRECTOR_STATE.md.

## Authoritative files (verify from these, not chat)
- QL_DIRECTOR_STATE.md (rulings D-LAUNCH-1..65; recent block compacted/neutralized), QL_PARALLEL_DAG.md (board), WORKER_PROMPTS.md (neutral top), WORKTREE_LEDGER.md, memory/parallel-sprints-status.md.
- Off-machine backups: ~/cosmos-arbitrage-C5-20260717.bundle and GitHub origin (all branches pushed).

## Reserved for owner (never a chat)
Final account-connection review, key handling, deployment, and the small owner-approved test step — all separate, at the very end, under explicit owner approval.
