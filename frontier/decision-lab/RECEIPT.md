# F13 DecisionLab blocked-build receipt

## Terminal accounting

```text
buildState: BUILDING
disposition: BLOCKED
terminalLabel: BLOCKED_OWNER_POLICY_ARTIFACT_UNAVAILABLE
RESEARCH_ONLY
NO_DECISION_AUTHORITY
```

`PRESTAGE_READY` is not claimed. The fail-closed scaffold is locally green, but accepted owner artifacts cannot support Section 9G's alternative-behavior capability.

## Isolation, ancestry, and governing law

| Evidence | Exact value |
|---|---|
| Worktree | `/Users/cosmosgeek/Desktop/f-decide` |
| Branch | `f-decide-0715f` |
| Frontier accepted base | `f0168cb37bd04d21bc90591ab2256770de3b75bc` |
| Branch start HEAD | `e0ace68de5d56bdfe51bb30cf74e44c6f109dfd5` |
| F0 Dock SHA | `e0ace68de5d56bdfe51bb30cf74e44c6f109dfd5` |
| Dock ancestry | `git merge-base --is-ancestor e0ace68de5d56bdfe51bb30cf74e44c6f109dfd5 HEAD` returned `0` before writing |
| Directive path | `frontier/directives/Frontier.md` |
| Directive SHA-256 | `4bb325b23c70e56103ee1553f0ea4396774ce0950d7abc9c73faa01f7006e1ad` |
| Directive read | complete, 1,419 lines; execution limited to 9G and shared Sections 0–2, 10–12 |
| Exclusive write inventory | only `frontier/decision-lab/**` |

The final sealed HEAD is the commit containing this receipt. Because a commit cannot contain its own SHA, resolve it exactly with `git log -1 --format=%H -- frontier/decision-lab/RECEIPT.md`; the stopping report records the resulting SHA after clean-tree verification.

## Dock and scout evidence

- Dock `CONTRACT_HASHES.sha256`: verified without mismatch before implementation.
- F13 usable facets: exact `EXPERIMENT_PROVIDER` binding hash `1a28f00b6e2f9e042beb3923271caf2b0f376233fa7092e725ad07d15503a698` and `COCKPIT_PROJECTION` binding hash `588e54eb6cafc8ca0114e3f11eac55801fc4b4957d1f6a32bfb797f9754ffa00`.
- Coordinator scout object: `git:887221418345ad54d7b98881b359fab85a6188e6:frontier/coordinator/scouts/F13.json`.
- Scout Git blob: `4d0f5046ece03673233c211526d92354854c4ec8`.
- Scout file SHA-256: `5b066bbd6febc7e669b1cbe81be0bfd7db55d96dd63064e6be09207aeb0196b6`.
- Scout canonical `contentHash`: `874b1a13a051c0ceac61e403d901d54b6e59bde9b5fb5d214e6a7fb4769426bf`.
- Scout disposition: `APPROVED_REAL_DELTA` for a bounded reference/report adapter only, with existing Q/L/Main owners preserved.

## Accepted owner evidence

All pinned full-file SHA-256 values were recomputed from the exact Git objects:

| Owner object | SHA-256 |
|---|---|
| `f0168cb37bd04d21bc90591ab2256770de3b75bc:server/src/engine/v0/types.ts` | `bdb99ede2e5aaf6a01b28c805681aa8ce4594553708e2e6f974f17aac8a1efd0` |
| `f0168cb37bd04d21bc90591ab2256770de3b75bc:server/src/intelligenceFoundation/contracts/types.ts` | `7eb6b169cdf3a2d59e2ceccc000c8c9668d79a3b2aac6fbbe21c32e836f5d60d` |
| `f0168cb37bd04d21bc90591ab2256770de3b75bc:server/src/capitalFoundation/economics/types.ts` | `0234aa421140ddab58436756b72d254599944dd85d49a745013aac026f4f265a` |
| `02b4eccc8d2ef53b830cafae06e5175715fa6ebb:quant/src/quant_edge/labels/disposition.py` | `3998cfe32649f527a6bdba064d029cb292a26208781269b1ff4bfdff705275f1` |
| `02b4eccc8d2ef53b830cafae06e5175715fa6ebb:quant/src/quant_edge/ensemble/abstention.py` | `7d45cfd8b96df1d2b9affb80c19f0f7745315dd20aa0615727c3b6ff09257f5e` |
| `02b4eccc8d2ef53b830cafae06e5175715fa6ebb:quant/src/quant_edge/registry_ops/contracts.py` | `c0fa30ec2fed7d72ff75d3a05d9699bb7ce37a3d755cfcfb2b0cca690ea538dc` |
| `02b4eccc8d2ef53b830cafae06e5175715fa6ebb:quant/src/quant_edge/labels/outcomes.py` | `bc4ed86fd972d3f2bdd637b28187b7ae99d715f3b719d9e62aeaec9b233f2150` |
| `02b4eccc8d2ef53b830cafae06e5175715fa6ebb:quant/src/quant_edge/features/values.py` | `44fc57eeda5d4fc0ecf45b79bb45c01a4570831d72b89f4ac8cd6a5a4c17ebfb` |
| `02b4eccc8d2ef53b830cafae06e5175715fa6ebb:quant/src/quant_edge/validation/comparison.py` | `ab385e3ff957e17c184062d0e9b857941fdc81911f5606caa323889429e7b01f` |
| `02b4eccc8d2ef53b830cafae06e5175715fa6ebb:quant/src/quant_edge/lake/contracts.py` | `b190ec64068e8a1d7b79c49c75c74304b770688d86eba03c6454108a93c3d32a` |
| `df6b472993ca9659ce09cf5f72004981c6835f0d:server/src/liveEdge/adapters/exchangeTwin/types.ts` | `c3bf70a72a5d87d6899e0cc21a7dcd106842e6de57002c8fcbd08decdea097f9` |
| `df6b472993ca9659ce09cf5f72004981c6835f0d:server/src/liveEdge/adapters/executionPolicy/types.ts` | `da466c08356b6707f69f3df85501661d3d985082feddb4127b7e7974cdf54402` |
| `df6b472993ca9659ce09cf5f72004981c6835f0d:server/src/liveEdge/adapters/exposureRecoveryProjection/types.ts` | `bbf281353b6010ed6fd5b67a7ddbb8f4301d816cb578fba11d1eba0ac6a7e649` |

DecisionLab-local `contractVersion` labels are frozen aliases where Main/L export no version literal. They never replace the exact type/schema name, Git ref, commit, and file hash above.

## Owner adjudication and blocker

1. Accepted Q at `02b4eccc8d2ef53b830cafae06e5175715fa6ebb` has relevant contract primitives and experiment metadata, but no immutable materialized Q policy payloads for the six Q-owned alternatives, no logging-policy probabilities, and no owner-evaluated decision-level ablations.
2. Accepted L at `df6b472993ca9659ce09cf5f72004981c6835f0d` has `ExecutionPolicyCandidate` types and a `makeCandidate` source recipe at `git:df6b472993ca9659ce09cf5f72004981c6835f0d:server/test/liveEdge/executionPolicy/fixtures.mjs#makeCandidate`, SHA-256 `e1ab8c2274553eb23bffa70829172fdbb939fb7e4ad559890e6bdd953605e5a9`; it has no serialized candidate or owner evaluation that DecisionLab may claim.
3. No accepted Main/Q artifact provides a complete immutable recorded decision, point-in-time feature/evidence set, market path, cost scenario, outcome, and liability tuple.
4. Q03 Event Atlas is the only real-data candidate: `git:02b4eccc8d2ef53b830cafae06e5175715fa6ebb:quant/generated/q03/event_atlas.v1.json`, SHA-256 `f8d59dea19be7a4f633f73deaccc3910b086c5a50fa03c07a1b4147ba297b21c`. It is `RESEARCH_ONLY`, `DISCOVERY_ONLY_NOT_EVENT_TRUTH`, with `laterOutcomesStatus: UNAVAILABLE`, so it is evidence-reference-only.

Therefore all 7 alternative outcomes and all 8 ablation baselines/variants remain `UNAVAILABLE`; counterfactual evaluation is not authorized or technically supported.

## Focused proof

Command:

```text
node --test frontier/decision-lab/tests/decision-lab.test.mjs
```

Final focused result before sealing:

```text
tests: 62
pass: 62
fail: 0
cancelled: 0
skipped: 0
todo: 0
```

The suite covers deterministic envelopes/reports, seven alternatives, eight ablations, temporal non-interference, same-path/same-cost identity, unknown propensity/support, unavailable-outcome semantics, copied-source/bias warnings, rehash attacks, closed records, structural bounds, accepted-owner attribution, exact Q15 identity/roundtrip, read-only unmounted projection, the Dock-valid single Q seam, and the exact Dock `UNAVAILABLE_PRESTAGE` resource claim.

No full repository, I00, browser, integration, network, or product acceptance battery was run.

## Independent adversarial review

Independent read-only review reproduced and drove correction of authority-smuggling, preview-validation, Unicode ordering, Q15 bounds, owner-attribution, outcome-availability, insertion-conformance, resource-claim, and stale-schema issues. Final independent ruling:

- validator and Dock compatibility paths are clean at the contract level;
- the 62-test focused suite is green;
- accepted owner artifacts still cannot support the core Section 9G capability;
- required terminal accounting is `BUILDING / BLOCKED / BLOCKED_OWNER_POLICY_ARTIFACT_UNAVAILABLE`.

## Public research and scope

The separate public-documentation research action, URLs, access times, licensing notes, retrieval digests, and implementation rulings are in `RESEARCH.md`.

Final scope inspection before commit must show only `frontier/decision-lab/**`. Runtime-source search found no filesystem, environment, network, timer, randomness, credential, persistence, process-execution, or product/core import.

## Explicit non-claims

No claim is made of `PRESTAGE_READY`, live or wired behavior, integration, deployment, trade readiness, edge, profitability, causal identification, policy evaluation/selection, registry authority, cockpit authority, decision authority, or production socket/runtime safety.
