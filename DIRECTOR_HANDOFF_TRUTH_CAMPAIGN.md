# DIRECTOR_HANDOFF_TRUTH_CAMPAIGN.md — required by campaign §21 (D-LAUNCH-54)

Written 2026-07-16 by the high-context director, which hereby RETIRES from final integration and final acceptance per the campaign order. It remains recorder/coordinator only.

- Controlling campaign: Desktop INDEPENDENT_PRODUCT_TRUTH_AND_LIVE_READINESS_CAMPAIGN_20260716.md sha256 ae9638ba0b85…
- current-main = 787b73d108764d628f925ee630bfe2fbef89458e (== origin). Landed core: INTEGRATED_ACCEPTED D-LAUNCH-50 (C2R 74eb452e, seal cf3416be, landing 51efaaa4).
- ACTIVE WRITERS (must not be touched; finish + seal only): port-a4 (~25 dirty tracked, web/src/aiOps port), egress-patch (~6 dirty tracked, test-offline mode), ci-hotfix (CI-HOTFIX-2, D-LAUNCH-53 defect: test/i00/render-reports.mjs live-git bake-in vs single-branch checkout).
- SEALED+PUSHED unmerged lanes: port-a1 8882644d, a2 6e9efe05, a3 21a0440f, a5 9769d461, obs 884526c2, ops c5c9abb5, replay 12f0934e, runbook 05d3a1ff; A-FORMAL b491893; S2 ca30adf; frontier F0 e0ace68d + F1/F2/F3/F8 sealed (PARKED, unauthorized).
- Money-path dispositions the campaign demands (P0 item 7/8): ledger CAS + Foundation quantity bridge — dispositioned during Role-2 integration and encoded in candidate receipt schema v2 (see docs/archive/i00-phase2/INTEGRATION_CANDIDATE_READY_RECEIPT.md and QL_DIRECTOR_STATE.md D-LAUNCH-19/20 + PF-005 row); Account A must cite exact receipts, not this summary.
- STATE.md: rewritten at landing; A must re-verify currency at candidate freeze (P0 item 3).
- Authority map: ARCHITECTURE.md Part II; rulings D-LAUNCH-1..54 in QL_DIRECTOR_STATE.md; board QL_PARALLEL_DAG.md; 94-tree WORKTREE_LEDGER.md; prompts WORKER_PROMPTS.md.
- Off-machine backup: ~/cosmos-arbitrage-backup-20260716.bundle + GitHub origin (all sealed branches pushed).
- EXACT NEXT ACTION: Account A (worktree ~/Desktop/truth-a, branch truth-campaign-20260716) executes campaign §7 Pass 0 + §17-A; Account B (~/Desktop/truth-b, detached, read-only) executes §17-B. Blocks in WORKER_PROMPTS.md. In-flight three lanes seal first; A merges sealed lanes into ITS candidate branch (never current-main), freezes C, emits BASELINE_TRUTH_ACCEPTED:<sha>. Only Account B may ever emit VERIFIED_ACCEPTED. current-main landing after that requires explicit owner instruction.
