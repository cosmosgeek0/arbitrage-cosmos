# N3-I1 edge-verdict intake

N3-I1 is an offline, read-only intake boundary. It verifies independently
pinned canonical documents, joins them to the frozen registry, evaluates the
declared gates, and returns an `IntakeDecisionV1`. Its authority is always
`NONE`.

## Public API

```python
from quant_edge.n3_intake import (
    PinnedDocumentV1,
    adapt_smeta1_n3_bridge,
    bridge_to_canonical_bytes,
    decision_to_canonical_bytes,
    evaluate_intake,
    render_bridge_fable5,
    render_fable5,
)

decision = evaluate_intake(
    registry_document,
    result_documents,
)
machine_bytes = decision_to_canonical_bytes(decision)
owner_row = render_fable5(decision)

bridge = adapt_smeta1_n3_bridge(canonical_bridge_bytes)
bridge_receipt = bridge_to_canonical_bytes(bridge)
bridge_owner_row = render_bridge_fable5(bridge)
```

`registry_document` is one `PinnedDocumentV1` for `S_META1`.
`result_documents` is a tuple containing exactly one independently pinned
document for each result role, in the registry-defined universe.

## Roles and schemas

| Role | Required schema |
|---|---|
| `S_META1` | `S_META1_N3_REGISTRY_V1` |
| `E1` | `E1_N3_RESULT_V1` |
| `VE1` | `VE1_N3_RESULT_V1` |
| `S1C` | `S1C_N3_RESULT_V1` |
| `S1D` | `S1D_N3_RESULT_V1` |
| `S1E` | `S1E_N3_RESULT_V1` |

The five result roles have the fixed order `E1`, `VE1`, `S1C`, `S1D`,
`S1E`. A schema from one role is not valid for another role.

## Independent custody

Every document requires a caller-supplied `ArtifactPinV1`. The pin binds the
role, full raw SHA-256, exact byte length, producer commit, producer tree,
repository-relative path, acceptance state, and accepted identity. Artifact
claims do not pin themselves. Raw-byte and semantic hashes remain separate and
are both retained in machine output.

Before constructing a pin, the upstream caller or orchestrator must
independently resolve and verify the full producer commit and tree, prove that
the exact repository-relative path resolves to the intended ordinary Git blob,
verify its byte length and raw SHA-256, and verify the published acceptance
identity. N3-I1 does not run Git, discover paths, consult a publication system,
or make caller-asserted commit, tree, path, or acceptance metadata
self-authenticating.

Missing, duplicate, orphan, unsupported, noncanonical, or mismatched custody
input is invalid input. Invalid input raises a `ContractValueError`; it
produces no `IntakeDecisionV1` and no FABLE5 card. Invalid input is not
converted into `NO_GO` or `UNKNOWN`. A structurally valid `PENDING` acceptance
remains explicit and makes the aggregate verdict `UNKNOWN`, with
`credible_positive_count=null`. A `REJECTED` acceptance is invalid input and
produces no decision or card.

## Verdict states

- `VERIFIED_POSITIVE`: custody is accepted, no required truth is unknown, and
  at least one role satisfies every mandatory positive gate.
- `NO_GO`: custody and required truth are complete, and no role satisfies every
  mandatory positive gate.
- `UNKNOWN`: acceptance or required evaluation truth is unresolved.
  `credible_positive_count` is `null`.

For metrics, `MEASURED` carries an integer value. `UNKNOWN` and
`NOT_ESTIMABLE` carry `null`. A measured zero is not `null`, and neither state
is inferred from a missing field.

## Mandatory positive gates

A positive assessment requires all applicable gates to pass:

- terminal result, registry-family binding, and exact frozen candidate membership;
- declared and observed trial counts, trial ledger, ledger provenance, and
  multiplicity method;
- multiplicity plus required PBO, global-test, and DSR gates;
- sealed-forward holdout with `singleUse=true`, `openedAfterFreeze=true`,
  `selectionInsideEvaluation=true`, and `reuseCount=1`;
- required account-effective fee and maker-entry evidence, complete costs, and
  regime coverage;
- measured net, holdout lower bound, stress net, capacity, and drawdown within
  the registry policy thresholds;
- exact evidence class and no required `UNKNOWN` or `NOT_ESTIMABLE` value.

No individual result can bypass an unresolved registry or role acceptance.
Source packet `reasonCodes` are retained separately from N3-I1-derived
assessment reasons. V1 defines no trusted pass/fail taxonomy for producer
reason strings, so any nonempty source `reasonCodes` tuple forces that role to
`UNKNOWN`; a `VERIFIED_POSITIVE` source packet must use an empty tuple. N3-I1
requires the result candidate to appear in the registry's exact sorted
`candidateIds` tuple and requires the frozen ledger digest in result
provenance. It does not replay candidate generation or ledger calculations, so
accepted producer evidence remains an upstream prerequisite and source reasons
cannot be discarded or overwritten by a synthesized pass.

## Outputs

`decision_to_canonical_bytes` emits deterministic canonical JSON containing all
decision fields; the complete registry and five result custody receipts
(`role`, full `rawSha256`, `byteLength`, full `producerCommit`, full
`producerTree`, `relativePath`, `acceptanceState`, and `acceptanceSha256` or
`null`); full semantic hashes; per-role status; source and derived reason codes;
and each metric's exact state/value pair.

Machine assessment statuses report the role's gate evaluation and travel
beside their exact custody receipts. `render_fable5` projects effective
acceptance-aware statuses: a pending registry makes every rendered role
`UNKNOWN`, and a pending result makes that rendered role `UNKNOWN`.

The renderer emits one physical Markdown bullet with:

- fixed `item` and `expected` fields;
- registry raw/semantic hash suffixes;
- role count and counts for `VERIFIED_POSITIVE`, `NO_GO`, and `UNKNOWN`;
- `crediblePositiveCount` as an integer or `null`;
- `authority=NONE`;
- fixed-order per-role status plus raw/semantic hash suffixes;
- `status` equal to the decision status.

The owner row contains last-four identifiers only. It contains no packet prose,
paths, recommendation, action authority, or full hashes.

## Publication state

S-META1 source commit `1fb305a7a57724a6904d624894d8e620db19b636`
is independently accepted as source-only. The canonical
`smeta1_n3_bridge.v1.json` binds that exact registry and freeze receipt to the
five N3 roles without pretending that the seven-family registry is the older
synthetic five-family result schema.

The bridge binds exact independently accepted V-E1, S-1C, and S-1D packets,
the accepted E-1 receipt-only identities, and S-1E through its accepted F15
composite. S-1C remains in its producer-native
`S1CPostFundingCrowdUnwindResultV1` shape: the bridge binds its exact result,
freeze, checksum, seal, and source-manifest identities without coercing it
through the synthetic `S1C_N3_RESULT_V1` adapter. E-1 remains receipt-only
because its accepted temporary packet has no current Git blob. S-1E has no
standalone acceptance. Those distinctions remain machine-visible.

F02 and F03 remain in the seven-family Holm universe even though they have no
separate N3 packet roles. F06 and F07 keep
`attemptedHypothesisCount=null` and effective p exactly `1/1`; the minimum
attempt floor of one is not promoted into an exact count.

This milestone is the current accepted-evidence bridge and scoreboard. The
existing `evaluate_intake` path and all result fixtures remain synthetic
fixture-only; the bridge does not call the decision evaluator. The accepted
S-1C role is locally
`NO_GO_ACCOUNT_EFFECTIVE_FEES_UNKNOWN`, with observed credible-positive subsets
equal to zero. The global scoreboard remains `UNKNOWN` under the frozen
S-META1 policy because material fee, ledger/custody, attempt-count, and holdout
truth remains incomplete. It deterministically reports
`crediblePositiveCount=null`, `observedCrediblePositiveSubsets=0`,
`fixtureOnly=false`, `positiveEdgeClaim=NOT_MADE`, `recommendation=NONE`, and
`authority=NONE`.
