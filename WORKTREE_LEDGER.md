# WORKTREE_LEDGER.md — complete machine inventory (director-owned)

Durable pre-freeze census: **101 entries = 96 live Git worktrees + 5 `REMOVED_SAFE` tombstones**. The original 94-row registry was generated at `2026-07-16T13:38:58.633839`; the two campaign worktrees omitted from that table were captured immediately before the C6-C8 correction sequence began and are appended below. Rows are immutable census observations, not promises about later branch switches: in particular, the `truth-a` row intentionally records its clean pre-freeze state at `951e7a60709683d969abcca06de26197052cb374`, even after that worktree moves to a correction branch. States/rulings are authoritative in QL_PARALLEL_DAG.md + QL_DIRECTOR_STATE.md (D-LAUNCH-1..65). ACTIVE WRITERS: ci-hotfix (CI-HOTFIX-2), egress-patch, port-a1/a4/a5/ops/obs. LAWS: one writer per tree; NEVER git clean -fdx / worktree prune / reset --hard on any tree; only director lands current-main. Off-machine backup: ~/cosmos-arbitrage-backup-20260716.bundle + GitHub origin.

| Worktree | Branch | HEAD | Dirt |
| --- | --- | --- | --- |
| ~/Main | current-main | 453fde2 | dirty:1 |
| ~/aiops-prestage | aiops-prestage-20260714 | 08e0bea | dirty:0 |
| ~/aiops-shadow-a1 | aiops-shadow-a1-20260715 | e65cdca | dirty:0 |
| ~/aiops-shadow-a2 | aiops-shadow-a2-20260715 | 9ae6c22 | dirty:0 |
| ~/aiops-shadow-a3 | aiops-shadow-a3-20260715 | c6397f5 | dirty:0 |
| ~/aiops-shadow-a4 | aiops-shadow-a4-20260715 | 6204667 | dirty:0 |
| ~/aiops-shadow-a5 | aiops-shadow-a5-20260715 | e8e005e | dirty:0 |
| ~/c-shard-1 | (detached) | 098f7b9 | dirty:0 |
| ~/c-shard-2 | (detached) | 098f7b9 | dirty:0 |
| ~/c-shard-3 | (detached) | 098f7b9 | dirty:0 |
| ~/c-shard-4 | (detached) | 098f7b9 | dirty:0 |
| ~/c-shard-5 | (detached) | 098f7b9 | dirty:0 |
| ~/c-shard-6 | (detached) | 098f7b9 | dirty:0 |
| ~/c2r-validate | (detached) | 74eb452 | dirty:0 |
| ~/ci-hotfix | ci-hotfix-20260716 | 7d524d8 | dirty:0 |
| ~/dash-shell | dashboard-shell-20260712 | 6925015 | dirty:0 |
| ~/egress-patch | egress-patch-20260716 | 492e3f6 | dirty:6 |
| ~/f-arena | f-arena-0715f | 3c9c794 | dirty:0 |
| ~/f-bridge | f-bridge-execution-20260713 | a0c0c2e | dirty:0 |
| ~/f-coord | frontier-coordinator-0715f | 8872214 | dirty:0 |
| ~/f-decide | f-decide-0715f | 2c29de4 | dirty:0 |
| ~/f-dock | f-dock-0715f | e0ace68 | dirty:0 |
| ~/f-edge | f-edge-0715f | 7a658b9 | dirty:0 |
| ~/f-lab | f-lab-0715f | 56a08f4 | dirty:0 |
| ~/f-venue | f-venue-0715f | e435c1f | dirty:0 |
| ~/f1-scout | (detached) | f0168cb | dirty:0 |
| ~/f10-scout | (detached) | f0168cb | dirty:0 |
| ~/f11-scout | (detached) | f0168cb | dirty:0 |
| ~/f12-scout | (detached) | f0168cb | dirty:0 |
| ~/f13-scout | (detached) | f0168cb | dirty:0 |
| ~/f2-scout | (detached) | f0168cb | dirty:0 |
| ~/f3-scout | (detached) | f0168cb | dirty:0 |
| ~/f4-scout | (detached) | f0168cb | dirty:0 |
| ~/f5-scout | (detached) | f0168cb | dirty:0 |
| ~/f6-scout | (detached) | f0168cb | dirty:0 |
| ~/f7-scout | (detached) | f0168cb | dirty:0 |
| ~/f8-scout | (detached) | f0168cb | dirty:0 |
| ~/f9-scout | (detached) | f0168cb | dirty:0 |
| ~/fix-audit | (detached) | afed4d5 | dirty:0 |
| ~/i00-assembly | i00-product-assembly-20260713 | cf3416b | dirty:0 |
| ~/ip-assur-action | ip-assur-action-20260714 | ca30adf | dirty:0 |
| ~/ip-assur-agent | ip-assur-agent-20260713 | 97e87bd | dirty:0 |
| ~/ip-assur-case | ip-assur-case-20260713 | b4d8a44 | dirty:0 |
| ~/ip-assur-cockpit | ip-assur-cockpit-20260713 | d4ff9c9 | dirty:0 |
| ~/ip-assur-formal | ip-assur-formal-20260713 | b491893 | dirty:0 |
| ~/ip-assur-hazard | ip-assur-hazard-20260713 | ab33b37 | dirty:0 |
| ~/ip-assur-stability | ip-assur-stability-20260713 | d35674e | dirty:0 |
| ~/ip-assurance | ip-assurance-20260713 | 08a0a09 | dirty:0 |
| ~/ip-control | ip-control-20260713 | 56c47da | dirty:0 |
| ~/ip-ops | ip-ops-20260713 | 6bfd543 | dirty:0 |
| ~/ip-proof | ip-proof-20260713 | 23e985c | dirty:0 |
| ~/ip-runtime | ip-runtime-20260713 | 8058ab8 | dirty:0 |
| ~/l09-normal-basis | l09-normal-basis-20260712 | 10cb9d2 | dirty:0 |
| ~/l10-reverse-basis | l10-reverse-basis-20260712 | 77a6eb7 | dirty:0 |
| ~/l11-volume | l11-volume-20260712 | 22a7acf | dirty:0 |
| ~/l14-controls | l14-controls-20260712 | 04e50f4 | dirty:0 |
| ~/l15-infra | l15-deploy-infra-20260712 | 2cec412 | dirty:0 |
| ~/live-execution-proof-20260712 | live-execution-control-proof-20260712 | df6b472 | dirty:0 |
| ~/obs-shadow | obs-shadow-20260715 | 20608c4 | dirty:0 |
| ~/ops-shadow | ops-shadow-20260715 | cdf64b6 | dirty:0 |
| ~/port-a1 | port-a1-20260716 | 492e3f6 | dirty:0 |
| ~/port-a2 | port-a2-20260716 | 6e9efe0 | dirty:0 |
| ~/port-a3 | port-a3-20260716 | 21a0440 | dirty:0 |
| ~/port-a4 | port-a4-20260716 | 492e3f6 | dirty:25 |
| ~/port-a5 | port-a5-20260716 | 492e3f6 | dirty:0 |
| ~/port-obs | port-obs-20260716 | 930d61c | dirty:0 |
| ~/port-ops | port-ops-20260716 | 492e3f6 | dirty:0 |
| ~/port-plan | (detached) | afed4d5 | dirty:0 |
| ~/port-replay | port-replay-20260716 | 12f0934 | dirty:0 |
| ~/port-runbook | port-runbook-20260716 | 05d3a1f | dirty:0 |
| ~/preverify | preverify-20260714 | 46b2f1e | dirty:0 |
| ~/q08-derivatives | q08-derivatives-20260712 | 4bac089 | dirty:0 |
| ~/q09-regime | q09-regime-20260712 | a3426e5 | dirty:0 |
| ~/q11-survival | q11-survival-20260712 | d04286d | dirty:0 |
| ~/q13-deep-gate | q13-deep-gate-20260712 | 06f0a8f | dirty:0 |
| ~/q14-validation-infra | q14-validation-infra-20260712 | e266b42 | dirty:0 |
| ~/q15-registry | q15-registry-20260712 | e69f687 | dirty:0 |
| ~/quant-edge-research-20260712 | quant-edge-research-factory-20260712 | 02b4ecc | dirty:0 |
| ~/r9-a | (detached) | 098f7b9 | dirty:0 |
| ~/r9-b | (detached) | 098f7b9 | dirty:0 |
| ~/r9-c | (detached) | 098f7b9 | dirty:0 |
| ~/r9-d | (detached) | 098f7b9 | dirty:0 |
| ~/replay-shadow | replay-shadow-20260715 | 7666930 | dirty:0 |
| ~/role3-c2 | (detached) | 74eb452 | dirty:0 |
| ~/role3-preflight | role3-preflight-20260715 | 06bb64a | dirty:0 |
| ~/role3-verify | (detached) | 098f7b9 | dirty:0 |
| ~/role4-fix | role4-fix-20260715 | 37eeb5b | dirty:0 |
| ~/runbook-shadow | runbook-shadow-20260715 | 25a3762 | dirty:0 |
| ~/si-recon | si-recon-ruling-20260714 | f03ed78 | dirty:0 |
| ~/truth-a | truth-campaign-20260716 | 951e7a60709683d969abcca06de26197052cb374 | tracked:0; untracked:0; clean pre-freeze snapshot |
| ~/truth-b | (detached) | 787b73d108764d628f925ee630bfe2fbef89458e | tracked:0; untracked:7 |
| ~/v1 | (detached) | 74eb452 | dirty:0 |
| ~/v2 | (detached) | 74eb452 | dirty:0 |
| ~/v3 | (detached) | 74eb452 | dirty:0 |
| ~/v4 | (detached) | 74eb452 | dirty:0 |
| ~/v5 | (detached) | 74eb452 | dirty:0 |

## `REMOVED_SAFE` tombstones

These five D-LAUNCH-61 read-only helper worktrees are no longer live Git registrations. D-LAUNCH-65 authorizes their durable tombstones; the four accepted outputs are retained as byte-exact candidate archive copies, while the two other lanes had no accepted output.

| `former_absolute_path` | `worktree_name` | `live_registration_state` | `classification` | `disposition` | `disposition_reason` | `disposition_evidence` | `archive_source_commit` | `accepted_output_state` | `outputs` |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `/Users/cosmosgeek/Desktop/prep-act` | `prep-act` | `REMOVED` | `REMOVED_SAFE` | `REMOVED_SAFE` | Director-authorized removal of a read-only D-LAUNCH-61 helper; no candidate source owned | `D-LAUNCH-65` | `0e4b364849075a454d7dd624ca068c238f4196c2` | `CANDIDATE_TRACKED_BYTE_EXACT_ARCHIVE_COPY` | 2 |
| `/Users/cosmosgeek/Desktop/shard-prov` | `shard-prov` | `REMOVED` | `REMOVED_SAFE` | `REMOVED_SAFE` | Director-authorized removal of a read-only D-LAUNCH-61 helper; no candidate source owned | `D-LAUNCH-65` | `0e4b364849075a454d7dd624ca068c238f4196c2` | `CANDIDATE_TRACKED_BYTE_EXACT_ARCHIVE_COPY` | 1 |
| `/Users/cosmosgeek/Desktop/shard-sec` | `shard-sec` | `REMOVED` | `REMOVED_SAFE` | `REMOVED_SAFE` | Director-authorized removal of a read-only D-LAUNCH-61 helper; no candidate source owned | `D-LAUNCH-65` | `0e4b364849075a454d7dd624ca068c238f4196c2` | `NO_ACCEPTED_OUTPUT` | 0 |
| `/Users/cosmosgeek/Desktop/v-clean` | `v-clean` | `REMOVED` | `REMOVED_SAFE` | `REMOVED_SAFE` | Director-authorized removal of a read-only D-LAUNCH-61 helper; no candidate source owned | `D-LAUNCH-65` | `0e4b364849075a454d7dd624ca068c238f4196c2` | `CANDIDATE_TRACKED_BYTE_EXACT_ARCHIVE_COPY` | 1 |
| `/Users/cosmosgeek/Desktop/v-cockpit` | `v-cockpit` | `REMOVED` | `REMOVED_SAFE` | `REMOVED_SAFE` | Director-authorized removal of a read-only D-LAUNCH-61 helper; no candidate source owned | `D-LAUNCH-65` | `0e4b364849075a454d7dd624ca068c238f4196c2` | `NO_ACCEPTED_OUTPUT` | 0 |
