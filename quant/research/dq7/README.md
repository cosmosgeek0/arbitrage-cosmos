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

Two trust pins must be supplied **out of band**, from the accepted registry — never
from the manifest under validation. A manifest carries its own ontology and its own
freeze coordinate; those are claims, and DQ-7 only treats them as binding when they
equal the externally pinned values:

```python
from pathlib import Path

from research.dq7 import validate_program_file_v1, validate_program_v1

receipt = validate_program_file_v1(
    Path("program.json"),
    accepted_semantic_ontology_digest=registry.semantic_ontology_digest,
    accepted_pre_outcome_freeze_digest=registry.pre_outcome_freeze_digest,
)
if receipt.scheduler_disposition == "REJECT":
    ...
if receipt.n3_intake_disposition == "INADMISSIBLE":
    ...
```

Omitting either pin is not a convenience default. An absent pin blocks with
`PROGRAM_SEMANTIC_ONTOLOGY_UNTRUSTED` or `PROGRAM_PREOUTCOME_FREEZE_UNTRUSTED`,
because an unpinned program has shown only self-consistency.

`validate_program_v1()` accepts an already-decoded exact JSON object.
`validate_program_file_v1()` additionally rejects invalid UTF-8, duplicate JSON
keys, and non-finite JSON numbers.

Every accepted receipt is canonical JSON with a final LF and includes:

- normalized manifest, attempt-ledger, family-universe, semantic-ontology,
  execution-state, and receipt digests;
- `computedPreOutcomeFreezeDigest` and `acceptedPreOutcomeFreezeDigest` as separate
  fields, so a coordinate DQ-7 recomputed from the submission is never mistaken for
  one the registry pinned;
- per-attempt family, hypothesis, signal-root, nuisance, design-nuisance, and anchor
  fingerprints;
- exact family components and deterministic findings;
- ordered reason codes;
- scheduler and N3 dispositions; and
- `verifiedPositiveStructurallyEligible`, whose name deliberately limits the claim
  to this validator's structural gates.

The full pinning surface is exported from `research.dq7`; `PUBLIC_API_V1` is the
declared contract and is asserted to cover every public validator symbol.

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

### Associative and commutative normalization

Noncommutative child order is preserved and is part of identity. For the commutative
operations `INTERACTION`, `PRODUCT`, and `SUM`, child identities are sorted and
same-operation children are flattened, so `SUM(SUM(a,b),c)` and `SUM(a,b,c)` are one
family.

Normalization applies to **subgraph membership as well as fingerprints**. A
commutative node that is not a root and whose every consumer is a same-operation
commutative node is absorbed by flattening, so its intermediate fingerprint is
excluded from the non-source membership set. Without that, the two spellings above
would carry different membership sets and could reach opposite
`PREDICTIVE_FAMILY_OVERLAP` verdicts for one family. When any consumer differs, or
when the node is a root, flattening cannot erase it and its fingerprint is retained
under both spellings.

Erasing the intermediate node must not erase the containment it expressed. Each
surviving commutative node therefore carries a canonical **counted term multiset**,
and containment is tested by proper sub-multiset inclusion under the same anchor: a
complete signal `SUM(a,b)` is a proper subgraph of `SUM(a,b,c)` whichever way the
wider signal is spelled. Overlap evidence names the containing node, so it is exact
and order-independent.

Operands are counted, never expanded. Two distinct nodes may share one fingerprint —
directly, or because two registered aliases canonicalize to one identifier — so an
expanded operand list doubles at every level and reaches `2**63` terms inside the
128-node bound. A counted multiset holds one entry per distinct term, giving
`O(nodes x distinct terms)` time and memory. Total operand multiplicity is bounded by
`_MAX_ASSOCIATIVE_TERMS` (1024 = 128 nodes x 8 inputs), checked on every increment, so
a multiplying graph fails closed with `FEATURE_ASSOCIATIVE_TERMS_EXCEEDED` and no
accumulated count can leave the interoperable safe-integer range.

### Exact operation role sets

Every non-`SOURCE` operation binds an **exact** role set: no role is optional. Role
presence is not a semantic channel. If omission were allowed to mean "the default",
one hypothesis would acquire two family fingerprints — an unregistered distinction
that would evade `FAMILY_RENAME_DUPLICATE` and inflate the multiplicity family count.
Defaults must therefore be registered `PARAMETER_VALUE` identifiers and bound
explicitly. `ENTROPY` binds `BINNING_POLICY` and `LOOKBACK`; `THRESHOLD` binds
`COMPARISON_DIRECTION` and `THRESHOLD_VALUE`; `RANK` binds `LOOKBACK`.

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
| `PREDICTIVE_FAMILY_OVERLAP` | A complete signal root is a proper subgraph of another family under the same anchor, by exact fingerprint membership or proper sub-multiset containment of commutative terms | block |

Blocking alias, duplicate, split, and overlap findings are unioned into deterministic
family components. Shared-signal and shared-source findings disclose dependence but
do not by themselves claim that two predictive families are identical.

## Program-wide multiplicity gate

Every submitted program requires `globalMultiplicity`, including a single-attempt
program: a lone attempt is still a selection from a program, and admitting it without
a registered plan would leave the first attempt permanently unaccounted for. The plan
must:

- name the same `programId` as the manifest;
- use `scopeId: "PROGRAM_WIDE"`;
- name a registered program-level method;
- encode alpha as bounded exact integers, not a floating-point value;
- attest `frozenBeforeAnyOutcome: true`;
- contain the exact sorted attempt IDs and family-component IDs computed by DQ-7;
- bind those sets with the exact attempt-ledger, family-universe, and
  semantic-ontology digests; and
- name both `SCHEDULER` and `N3_INTAKE` as consumers.

The attempt-ledger digest commits the semantic-ontology digest, so one ledger
coordinate cannot be reused under a second alias map.

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
PROGRAM_MULTIPLICITY_PROGRAM_MISMATCH
PROGRAM_SEMANTIC_ONTOLOGY_MISMATCH
PROGRAM_SEMANTIC_ONTOLOGY_UNTRUSTED
PROGRAM_PREOUTCOME_FREEZE_DIGEST_MISMATCH
PROGRAM_PREOUTCOME_FREEZE_UNTRUSTED
```

### Freeze workflow

1. Submit the complete candidate registry with `globalMultiplicity: null`. The
   rejected draft receipt exposes the exact ledger, component, universe, and ontology
   coordinates.
2. Build the plan from those coordinates with `preOutcomeFreezeDigest: null`. The
   field is nullable precisely so that a draft can be expressed without a placeholder
   digest; no sentinel value such as an all-zero digest is ever legitimate.
3. Call `calculate_pre_outcome_freeze_digest_v1()` on that draft manifest to obtain
   the freeze coordinate, and substitute it for the null.
4. Register the coordinate externally, before any outcome access.
5. Resubmit with both the ontology and freeze pins supplied out of band.

`calculate_pre_outcome_freeze_digest_v1()` fails closed with
`PREOUTCOME_FREEZE_CLOSED` unless every attempt is still freeze-open — `PLANNED`,
`outcomeAccessed: false`, and `resultDigest: null`. That gate is what makes the
coordinate evidence of pre-outcome commitment: a coordinate that could be minted
after outcomes were known would prove nothing about when the plan was fixed.

The coordinate is deliberately **invariant to execution state**, so a program that
was pinned while open keeps validating as it runs. Recording status, outcome access,
and result digests moves `executionStateDigest` and `manifestDigest` while leaving
the ledger, universe, and freeze coordinates intact. Changing any *design* field
after the freeze — venue, sizing, bookkeeping, universe, data window, implementation,
membership — moves the ledger and therefore breaks the freeze coordinate.

That invariance is also the limit of the guarantee. DQ-7 cannot observe when a
registry accepted a coordinate; it can only refuse to compute one from a closed
manifest. Registry discipline — accept a coordinate only from a freeze-open
submission, and never re-accept for a program already under way — remains a
registry-owned control.

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
candidate order, node order, commutative child order, commutative associative
nesting, and internal node renaming do not change the semantic receipt.
Noncommutative child order does.

### Normalized bytes, not submitted bytes

`manifestDigest` commits the **normalized** manifest that DQ-7 reconstructs from the
parse: canonical key order, canonical identifiers, resolved semantics, and no
bookkeeping-only fields — `displayName` and internal node IDs are parsed, checked, and
then dropped. It is therefore not a commitment to the bytes a caller submitted, and it
cannot be used to prove what a caller sent. Binding submitted bytes is out of scope
for v1; a caller that needs that evidence must digest the transport payload itself,
outside DQ-7.

## Evidence

The checked-in evidence is intentionally small and hostile:

- `fixtures/valid_program.v1.json` — three distinct families with one exact
  program-wide plan and the closed semantic ontology;
- `fixtures/accepted_registry.v1.json` — the out-of-band ontology and freeze pins,
  standing in for the external accepted registry. Fixture validation always takes
  both pins from here and never reads them back out of the manifest under test; a
  self-pinned fixture would only prove that a submission agrees with itself. Each
  hostile record additionally checks in its own `acceptedPreOutcomeFreezeDigest`, so
  a legitimately different program keeps focused distinctness coverage while a
  plan-tampering case is still judged against the already-accepted coordinate;
- `fixtures/hostile_cases.v1.json` — every semantic and multiplicity reason-code
  family, including venue/sizing/bookkeeping wrappers, alias canonicalization,
  overlap, shared signals, missing membership, foreign program and ontology
  coordinates, and missing consumers;
- `fixtures/duplicate_key_program.v1.json` — loader-level shadow-key attack;
- `fixtures/known_answer.v1.json` — frozen valid and hostile receipt digests; and
- `test_validator.py` — contract, graph, invariance, associativity, exact-role,
  freeze-lifecycle, pinning, malformed, hostile, and known-answer checks.

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

The frozen answer is regenerated only for a reviewed contract change:

```bash
PYTHONPATH=. python research/dq7/verify_known_answer.py --write
```

No test opens prior experiments, holdouts, provider endpoints, private accounts, or
network resources.

## Boundaries

DQ-7 does not:

- inspect or rerun an experiment;
- infer equivalence from prose or recover absent registry entries;
- validate a p-value, effect size, fee, fill, PnL, profitability, or economic claim;
- certify causal independence merely because fingerprints differ;
- commit the submitted transport bytes, or prove what a caller sent;
- observe when a registry accepted a freeze coordinate;
- execute multiplicity adjustment;
- integrate itself into scheduler or N3-owned paths; or
- authorize UI, canonical, live, host, provider, private, order, transfer,
  withdrawal, or money changes.

See [REFERENCES.md](REFERENCES.md) for the method and serialization basis.
