# F13 DecisionLab state

```text
module: F13 DecisionLab
branch: f-decide-0715f
frontierBaseSha: f0168cb37bd04d21bc90591ab2256770de3b75bc
dockSha: e0ace68de5d56bdfe51bb30cf74e44c6f109dfd5
branchStartHead: e0ace68de5d56bdfe51bb30cf74e44c6f109dfd5
buildState: BUILDING
disposition: BLOCKED
terminalLabel: BLOCKED_OWNER_POLICY_ARTIFACT_UNAVAILABLE
posture: RESEARCH_ONLY
authority: NO_DECISION_AUTHORITY
networkMode: FIXTURE_ONLY
mutationImplemented: false
```

DecisionLab is not `PRESTAGE_READY`. The module-local fail-closed scaffold is deterministic and its focused suite passes 62/62, but Section 9G's actual alternative-behavior capability cannot be reached from accepted owner artifacts.

## Exact blocker

Accepted Q at `02b4eccc8d2ef53b830cafae06e5175715fa6ebb` contains experiment, disposition, feature, outcome, and comparison contract metadata, but no immutable materialized policy payloads for `NO_TRADE`, `EARLIER_TIMING`, `DELAYED_TIMING`, `THRESHOLD`, `ENTRY`, or `EXIT`, and no owner-evaluated decision-level ablations.

Accepted L at `df6b472993ca9659ce09cf5f72004981c6835f0d` contains the `ExecutionPolicyCandidate` type and a `makeCandidate` test-fixture factory source. It does not contain a serialized/materialized candidate, candidate identity, or owner evaluation that DecisionLab may bind.

No complete immutable recorded decision + point-in-time information set + path + cost + outcome + liability fixture exists in accepted Main or Q. The sole real-data candidate, Q03 Event Atlas, is `RESEARCH_ONLY`, `DISCOVERY_ONLY_NOT_EVENT_TRUTH`, and records later outcomes as `UNAVAILABLE`.

## Current proof boundary

- Alternatives: 7/7 structurally present; 7/7 outcomes `UNAVAILABLE`.
- Counterfactual owner policy payloads: 0/6 available.
- Recorded decision fixtures: 0 available.
- Ablations: 8/8 structurally present; 8/8 baselines and variants `UNAVAILABLE`.
- Causal effects: never estimated; `causalEffect: null`.
- Logging propensities and importance weights: `UNKNOWN`.
- Preview: local, deterministic, read-only, synthetic/unverified-shape only, unmounted, non-canonical, and control-free.
- Dock seams proven locally: exact F13 facet selection, lossless Q15 fixture validation, unmounted cockpit projection, and exact Q-only insertion request.

## Resume condition

Resume only after Q admits exact-hash immutable owner artifacts at `quant/research:decision-level-counterfactual-owner-artifact-admission` and the artifacts satisfy the tests in `INSERTION.md`. The external L dependency must be materialized and evaluated by its owner and adjudicated through Q; DecisionLab must not call L or create a substitute policy.

## HEAD accounting

The immutable branch start and Dock tip are recorded above. A Git commit cannot embed its own SHA without changing it; the exact sealed HEAD is the commit containing this file and is resolved with:

```text
git log -1 --format=%H -- frontier/decision-lab/STATE.md
```

The stopping report must state that exact SHA after commit and clean-tree verification.

No claim is made of readiness, mounting, integration, live behavior, trade readiness, edge, profit, policy selection, or decision authority.
