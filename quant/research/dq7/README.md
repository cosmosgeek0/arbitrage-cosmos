# DQ-7 predictive-family distinctness and global multiplicity

DQ-7 is a deterministic, fail-closed validator for a normalized research-program
manifest. It gives the scheduler and N3 intake one shared answer to two questions:

1. Are two proposed “families” actually the same predictive hypothesis under a
   renamed venue, sizing rule, bookkeeping rule, label, or implementation wrapper?
2. Does the submitted program bind every included attempt and predictive-family
   component into one pre-outcome, program-wide multiplicity plan?

The receipt has `authority: "NONE"`. Passing DQ-7 is structural admissibility only.
It is not a positive result, a profitability finding, evidence that an adjustment
was executed correctly, or authority for private data, orders, transfers, or money.

## Consumer contract

The public entrypoints are:

```python
from pathlib import Path

from research.dq7 import validate_program_file_v1, validate_program_v1

receipt = validate_program_file_v1(Path("program.json"))
if receipt.scheduler_disposition == "REJECT":
    ...
if receipt.n3_intake_disposition == "INADMISSIBLE":
    ...
```

`validate_program_v1()` accepts an already-decoded exact JSON object.
`validate_program_file_v1()` additionally rejects invalid UTF-8, duplicate JSON
keys, and non-finite JSON numbers.

Every accepted receipt is canonical JSON with a final LF and includes:

- normalized manifest, attempt-ledger, family-universe, and receipt digests;
- per-attempt family, hypothesis, signal-root, nuisance, and anchor fingerprints;
- exact family components and deterministic findings;
- ordered reason codes;
- scheduler and N3 dispositions; and
- `verifiedPositiveStructurallyEligible`, whose name deliberately limits the claim
  to this validator's structural gates.

## Predictive identity law

The input is a closed feature DAG. Node IDs and node order are bookkeeping only.
Each node is reduced bottom-up into domain-separated SHA-256 identities.

The **family fingerprint** commits:

- the closed operation ID;
- ordered child family fingerprints, except for explicitly commutative operations;
- the source's semantic role;
- parameter role IDs, but not their selected values; and
- the prediction anchor: outcome, instrument topology, forecast clock, population
  topology, and target role.

The **hypothesis fingerprint** additionally commits concrete parameter values,
target value, polarity, and action mapping. Parameter choices can therefore be
separate attempts inside one family without pretending to be new families.

The following are deliberately excluded from predictive identity and committed
separately as nuisance identity:

- display name and internal node IDs;
- venue/provider selection;
- sizing and bookkeeping policies;
- universe and data-window labels;
- implementation digest; and
- result digest.

Changing only those fields cannot manufacture a new predictive hypothesis.
Noncommutative child order is preserved; commutative child identities are sorted.
Every node must be reachable from a non-source root, so unreachable or cyclic
payloads cannot hide undeclared semantics.

The v1 operation set is closed:

```text
SOURCE
ABS AUTOCORRELATION CHANGE CLIP ENTROPY LAG MEAN NEGATE RANK RETURN
STDDEV THRESHOLD ZSCORE
DIFFERENCE RATIO RESIDUAL
INTERACTION PRODUCT SUM
```

Free text is never parsed to infer signal meaning.

## Exact distinctness findings

DQ-7 uses exact fingerprints and graph membership, not names, fuzzy text matching,
or similarity thresholds.

| Reason code | Rule | Disposition |
| --- | --- | --- |
| `FAMILY_RENAME_DUPLICATE` | Same concrete hypothesis and no nuisance change | block |
| `RENAMED_VENUE_DUPLICATE` | Same concrete hypothesis; venue is the only changed nuisance | block |
| `SIZING_ONLY_DUPLICATE` | Same concrete hypothesis; sizing is the only changed nuisance | block |
| `BOOKKEEPING_ONLY_DUPLICATE` | Same concrete hypothesis; bookkeeping is the only changed nuisance | block |
| `NONPREDICTIVE_ONLY_DUPLICATE` | Same concrete hypothesis; another nuisance-only combination changed | block |
| `SEMANTIC_COLLISION_IMPLEMENTATION_DIVERGENCE` | Same hypothesis with implementation or result divergence | block |
| `DECLARED_FAMILY_ALIAS` | Different declared family IDs reduce to one family fingerprint | block |
| `DECLARED_FAMILY_SPLIT` | One declared family ID reduces to different family fingerprints | block |
| `SHARED_SIGNAL_COMPONENT` | Same-target candidates share a non-source signal subgraph | disclose |
| `SHARED_SIGNAL_CROSS_TARGET` | Cross-target candidates share a non-source signal subgraph | disclose |
| `SHARED_SOURCE_ONLY` | Candidates share only source roles | disclose |
| `PREDICTIVE_FAMILY_OVERLAP` | A complete signal root is a proper subgraph of another family under the same anchor | block |

Blocking alias, duplicate, split, and overlap findings are unioned into deterministic
family components. Shared-signal and shared-source findings disclose dependence but
do not by themselves claim that two predictive families are identical.

## Program-wide multiplicity gate

More than one submitted attempt requires `globalMultiplicity`. The plan must:

- use `scopeId: "PROGRAM_WIDE"`;
- name a registered program-level method;
- encode alpha as bounded exact integers, not a floating-point value;
- attest `frozenBeforeAnyOutcome: true`;
- contain the exact sorted attempt IDs and family-component IDs computed by DQ-7;
- bind those sets with the exact attempt-ledger and family-universe digests; and
- name both `SCHEDULER` and `N3_INTAKE` as consumers.

The registered v1 identifiers are:

```text
PROGRAM_BONFERRONI_FWER
PROGRAM_HIERARCHICAL_FWER
PROGRAM_HOLM_FWER
PROGRAM_ROMANO_WOLF_STEPDOWN
PROGRAM_WHITE_REALITY_CHECK
```

Registration means that the plan identifier is permitted at this boundary. DQ-7
does **not** execute or verify the named statistical procedure. A downstream
evidence packet must still prove that the selected procedure was implemented
correctly.

The multiplicity reason codes are:

```text
PROGRAM_MULTIPLICITY_PLAN_MISSING
PROGRAM_MULTIPLICITY_SCOPE_INVALID
PROGRAM_MULTIPLICITY_METHOD_INVALID
PROGRAM_MULTIPLICITY_NOT_PREOUTCOME
PROGRAM_ATTEMPT_LEDGER_INCOMPLETE
PROGRAM_FAMILY_SET_MISMATCH
PROGRAM_MULTIPLICITY_DIGEST_MISMATCH
PROGRAM_MULTIPLICITY_CONSUMER_MISMATCH
```

### Freeze workflow

For a new program, submit the complete candidate registry with
`globalMultiplicity: null`. The rejected draft receipt exposes the exact ledger,
component, and universe coordinates. Before any outcome access, freeze a plan that
binds those coordinates, then resubmit it. The valid fixture demonstrates the
covered state.

DQ-7 can prove exact membership only relative to the manifest it receives. It
cannot discover omitted historical attempts or prove that a caller supplied the
complete global ledger. Scheduler/N3 integration must therefore source manifests
from the accepted global attempt registry, not an experiment-local selection.

## Determinism and canonicalization

V1 uses `RFC8785_ASCII_KEY_SAFE_INTEGER_SUBSET_WITH_LF`:

- closed ASCII keys and identifiers;
- no floats in the accepted contract;
- integers bounded to the interoperable safe-integer range;
- strict UTF-8 strings without control characters or lone surrogates;
- lexicographically sorted object keys;
- compact JSON; and
- exactly one trailing LF.

All cryptographic commitments are SHA-256 with distinct domain prefixes. Input
candidate order, node order, commutative child order, and internal node renaming do
not change the semantic receipt. Noncommutative child order does.

## Evidence

The checked-in evidence is intentionally small and hostile:

- `fixtures/valid_program.v1.json` — three distinct families with one exact
  program-wide plan;
- `fixtures/hostile_cases.v1.json` — every semantic and multiplicity reason-code
  family, including venue/sizing/bookkeeping wrappers, overlap, shared signals,
  missing membership, and missing consumers;
- `fixtures/duplicate_key_program.v1.json` — loader-level shadow-key attack;
- `fixtures/known_answer.v1.json` — frozen valid and hostile receipt digests; and
- `test_validator.py` — contract, graph, invariance, malformed, hostile, and known
  answer checks.

Run from `quant/`:

```bash
PYTHONPATH=. pytest -q research/dq7/test_validator.py
PYTHONPATH=. python research/dq7/verify_known_answer.py
ruff check research/dq7
ruff format --check research/dq7
MYPYPATH=. mypy --strict --explicit-package-bases \
  research/dq7/validator.py \
  research/dq7/__init__.py \
  research/dq7/fixture_harness.py \
  research/dq7/verify_known_answer.py
```

No test opens prior experiments, holdouts, provider endpoints, private accounts, or
network resources.

## Boundaries

DQ-7 does not:

- inspect or rerun an experiment;
- infer equivalence from prose or recover absent registry entries;
- validate a p-value, effect size, fee, fill, PnL, profitability, or economic claim;
- certify causal independence merely because fingerprints differ;
- execute multiplicity adjustment;
- integrate itself into scheduler or N3-owned paths; or
- authorize UI, canonical, live, host, provider, private, order, transfer,
  withdrawal, or money changes.

See [REFERENCES.md](REFERENCES.md) for the method and serialization basis.
