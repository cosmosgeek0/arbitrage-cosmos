# F13 DecisionLab future insertion request

## Request

Canonical owner: **Q research only**

Exact requested seam: `quant/research:decision-level-counterfactual-owner-artifact-admission`
Machine-readable request: `contracts/insertion-request.v1.json`

This request does not authorize a shared edit, mount, evaluation, registry write, treatment, policy selection, order, or external mutation.

## Required Q-owned artifacts

Q must adjudicate and, if accepted, expose immutable exact-hash references for:

1. predeclared owner policy payloads for `NO_TRADE`, `EARLIER_TIMING`, `DELAYED_TIMING`, `THRESHOLD`, `ENTRY`, and `EXIT`;
2. one immutable recorded decision and its exact decision time/information cutoff;
3. the point-in-time feature and evidence set available at that cutoff;
4. one immutable market path and one immutable cost-scenario identity shared by every alternative;
5. recorded outcome, economic-cost, uncertainty, and residual-liability owner records, or explicit unavailable states;
6. owner-evaluated counterfactual results for every admitted alternative;
7. Q-assisted-versus-market-only, one-evidence-source-removed, and one-feature-family-removed results with exact retained information-set proofs.

## External L dependency

`EXECUTION_POLICY` additionally requires a materialized, serialized, identity-derived, validated, and owner-evaluated L `ExecutionPolicyCandidate`. DecisionLab does not request L directly, execute its factory, call its evaluator, or select a candidate. Q research must adjudicate this dependency through its canonical composition boundary.

## Admission tests

Future owner artifacts must make these previously unreachable tests meaningful:

- reject any alternative without an immutable exact-hash owner policy payload;
- reject any feature/evidence record not available at the decision cutoff;
- reject any alternative or ablation with a different market-path or cost identity;
- reject any counterfactual labeled realized, selected, ranked, causal, profitable, or trade-ready;
- reject missing/forged owner commit, type/schema, content hash, record identity, revision, or predeclaration proof;
- prove input permutation cannot change canonical report bytes;
- prove outcome bytes are unavailable to decision construction and loaded only after the immutable decision artifact exists;
- prove all missing support/logging probabilities remain unknown rather than estimated or zero-filled;
- prove Q owns all admitted evaluations and DecisionLab remains descriptive, fixture-only, read-only, and non-authoritative;
- rerun this module's focused suite plus new exact-owner admission vectors; broader integration remains a later owner-authorized activity.

## Current evidence boundary

Q03 Event Atlas may be cited only as `RECORDED_EVIDENCE_REFERENCE_ONLY`:

```text
git:02b4eccc8d2ef53b830cafae06e5175715fa6ebb:quant/generated/q03/event_atlas.v1.json
sha256: f8d59dea19be7a4f633f73deaccc3910b086c5a50fa03c07a1b4147ba297b21c
posture: RESEARCH_ONLY
ruleSemantics: DISCOVERY_ONLY_NOT_EVENT_TRUTH
laterOutcomesStatus: UNAVAILABLE
```

It does not satisfy any missing decision, policy, point-in-time feature, outcome, or liability artifact.

Until this request is owner-adjudicated and independently accepted, the module remains:

```text
buildState: BUILDING
disposition: BLOCKED
terminalLabel: BLOCKED_OWNER_POLICY_ARTIFACT_UNAVAILABLE
```
