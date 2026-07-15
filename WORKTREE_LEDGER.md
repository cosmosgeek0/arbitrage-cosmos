# WORKTREE_LEDGER.md — complete machine-derived inventory (director-owned)

Generated 2026-07-15T14:57:33.243042 by `git worktree list --porcelain` + per-tree status. Regenerated at every major event. Cross-reference states on QL_PARALLEL_DAG.md; rulings in QL_DIRECTOR_STATE.md (D-LAUNCH-1..37); prompts in WORKER_PROMPTS.md.

ACTIVE WRITERS RIGHT NOW (7): role4-fix (RUN-9, sole candidate repair authority) + aiops-shadow-a2/a3 + ops/replay/obs/runbook-shadow (RUN-14..19, spare account). EVERYTHING ELSE IS PARKED/SEALED — no chat may write there.

LAWS: one writer per worktree; never git clean -fdx / worktree prune / reset --hard on any tree not your own; untracked receipts + owner directives are intentional; only the director lands current-main.

| Worktree | Branch | HEAD | Dirt |
| --- | --- | --- | --- |
| ~/Main | current-main | d090d00 | tracked-dirty:0 untracked:9 |
| ~/aiops-prestage | aiops-prestage-20260714 | 08e0bea | tracked-dirty:0 untracked:0 |
| ~/aiops-shadow-a1 | aiops-shadow-a1-20260715 | 83c1624 | tracked-dirty:0 untracked:0 |
| ~/aiops-shadow-a2 | aiops-shadow-a2-20260715 | ca1fb09 | tracked-dirty:0 untracked:0 |
| ~/aiops-shadow-a3 | aiops-shadow-a3-20260715 | c345fbb | tracked-dirty:0 untracked:0 |
| ~/aiops-shadow-a4 | aiops-shadow-a4-20260715 | b5f4c47 | tracked-dirty:0 untracked:0 |
| ~/aiops-shadow-a5 | aiops-shadow-a5-20260715 | e0411ea | tracked-dirty:0 untracked:0 |
| ~/c-shard-1 | (detached) | 098f7b9 | tracked-dirty:0 untracked:1 |
| ~/c-shard-2 | (detached) | 098f7b9 | tracked-dirty:0 untracked:1 |
| ~/c-shard-3 | (detached) | 098f7b9 | tracked-dirty:0 untracked:1 |
| ~/c-shard-4 | (detached) | 098f7b9 | tracked-dirty:0 untracked:1 |
| ~/c-shard-5 | (detached) | 098f7b9 | tracked-dirty:0 untracked:1 |
| ~/c-shard-6 | (detached) | 098f7b9 | tracked-dirty:0 untracked:1 |
| ~/dash-shell | dashboard-shell-20260712 | 6925015 | tracked-dirty:0 untracked:0 |
| ~/f-bridge | f-bridge-execution-20260713 | a0c0c2e | tracked-dirty:0 untracked:2 |
| ~/i00-assembly | i00-product-assembly-20260713 | 517bd63 | tracked-dirty:0 untracked:5 |
| ~/ip-assur-action | ip-assur-action-20260714 | ca30adf | tracked-dirty:0 untracked:0 |
| ~/ip-assur-agent | ip-assur-agent-20260713 | 97e87bd | tracked-dirty:0 untracked:1 |
| ~/ip-assur-case | ip-assur-case-20260713 | b4d8a44 | tracked-dirty:0 untracked:1 |
| ~/ip-assur-cockpit | ip-assur-cockpit-20260713 | d4ff9c9 | tracked-dirty:0 untracked:1 |
| ~/ip-assur-formal | ip-assur-formal-20260713 | b491893 | tracked-dirty:0 untracked:1 |
| ~/ip-assur-hazard | ip-assur-hazard-20260713 | ab33b37 | tracked-dirty:0 untracked:1 |
| ~/ip-assur-stability | ip-assur-stability-20260713 | d35674e | tracked-dirty:0 untracked:1 |
| ~/ip-assurance | ip-assurance-20260713 | 08a0a09 | tracked-dirty:0 untracked:1 |
| ~/ip-control | ip-control-20260713 | 56c47da | tracked-dirty:0 untracked:2 |
| ~/ip-ops | ip-ops-20260713 | 6bfd543 | tracked-dirty:0 untracked:2 |
| ~/ip-proof | ip-proof-20260713 | 23e985c | tracked-dirty:0 untracked:2 |
| ~/ip-runtime | ip-runtime-20260713 | 8058ab8 | tracked-dirty:0 untracked:2 |
| ~/l09-normal-basis | l09-normal-basis-20260712 | 10cb9d2 | tracked-dirty:0 untracked:2 |
| ~/l10-reverse-basis | l10-reverse-basis-20260712 | 77a6eb7 | tracked-dirty:0 untracked:2 |
| ~/l11-volume | l11-volume-20260712 | 22a7acf | tracked-dirty:0 untracked:2 |
| ~/l14-controls | l14-controls-20260712 | 04e50f4 | tracked-dirty:0 untracked:2 |
| ~/l15-infra | l15-deploy-infra-20260712 | 2cec412 | tracked-dirty:0 untracked:2 |
| ~/live-execution-proof-20260712 | live-execution-control-proof-20260712 | df6b472 | tracked-dirty:0 untracked:2 |
| ~/obs-shadow | obs-shadow-20260715 | 098f7b9 | tracked-dirty:0 untracked:0 |
| ~/ops-shadow | ops-shadow-20260715 | 098f7b9 | tracked-dirty:0 untracked:0 |
| ~/preverify | preverify-20260714 | 46b2f1e | tracked-dirty:0 untracked:3 |
| ~/q08-derivatives | q08-derivatives-20260712 | 4bac089 | tracked-dirty:0 untracked:2 |
| ~/q09-regime | q09-regime-20260712 | a3426e5 | tracked-dirty:0 untracked:2 |
| ~/q11-survival | q11-survival-20260712 | d04286d | tracked-dirty:0 untracked:2 |
| ~/q13-deep-gate | q13-deep-gate-20260712 | 06f0a8f | tracked-dirty:0 untracked:2 |
| ~/q14-validation-infra | q14-validation-infra-20260712 | e266b42 | tracked-dirty:0 untracked:2 |
| ~/q15-registry | q15-registry-20260712 | e69f687 | tracked-dirty:0 untracked:2 |
| ~/quant-edge-research-20260712 | quant-edge-research-factory-20260712 | 02b4ecc | tracked-dirty:0 untracked:2 |
| ~/r9-a | (detached) | 098f7b9 | tracked-dirty:0 untracked:1 |
| ~/r9-b | (detached) | 098f7b9 | tracked-dirty:0 untracked:1 |
| ~/r9-c | (detached) | 098f7b9 | tracked-dirty:0 untracked:1 |
| ~/r9-d | (detached) | 098f7b9 | tracked-dirty:0 untracked:1 |
| ~/replay-shadow | replay-shadow-20260715 | 098f7b9 | tracked-dirty:0 untracked:0 |
| ~/role3-preflight | role3-preflight-20260715 | 06bb64a | tracked-dirty:0 untracked:0 |
| ~/role3-verify | (detached) | 098f7b9 | tracked-dirty:0 untracked:1 |
| ~/role4-fix | role4-fix-20260715 | 88d5719 | tracked-dirty:9 untracked:2 |
| ~/runbook-shadow | runbook-shadow-20260715 | 098f7b9 | tracked-dirty:0 untracked:0 |
| ~/si-recon | si-recon-ruling-20260714 | f03ed78 | tracked-dirty:0 untracked:1 |
