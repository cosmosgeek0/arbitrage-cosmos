# DQ-5 sealed-corpus and holdout reuse gate

DQ-5 is a metadata-only, fail-closed research-intake gate. It compares one proposed
registration with a complete global registry and rejects:

- intersecting half-open corpus windows;
- reuse across declared research families;
- reused or shared holdouts;
- any holdout with an append-only open or open-attempt event; and
- a `freshHoldoutClaim` contradicted by the registered history.

It never reads a dataset, artifact, experiment result, archive, network resource, clock,
environment variable, or repository state. It has no execution or capital authority. Every report
therefore carries `authority: "NONE"`.

Before policy checks, the exact candidate registration must already be custody-persisted in the
registry's `pendingRegistrations` ledger. Absence or any field mismatch is invalid input, so an
eligibility report can never bind a registry snapshot that omits its own subject.

## Contract

Inputs are exact canonical UTF-8 JSON: sorted object keys, no insignificant whitespace, one trailing
LF, no duplicate keys, and no floating-point values. The CLI accepts only bounded regular
non-symlink files.

The registry has schema `DQ5_REGISTRY_V1`:

```json
{
  "corpora": [
    {
      "instrumentId": "BTCUSDT",
      "productId": "SPOT",
      "providerId": "BINANCE_PUBLIC",
      "venueId": "BINANCE"
    }
  ],
  "coverageComplete": true,
  "custodyReceiptSha256": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
  "holdoutOpenEvents": [],
  "pendingRegistrations": [],
  "registrations": [],
  "schemaVersion": "DQ5_REGISTRY_V1"
}
```

The candidate has schema `DQ5_CANDIDATE_V1`:

```json
{
  "registration": {
    "familyId": "FAMILY-B",
    "freshHoldoutClaim": true,
    "protocolSha256": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    "researchId": "NEW-B",
    "windows": []
  },
  "schemaVersion": "DQ5_CANDIDATE_V1"
}
```

Each registration requires at least one `DEVELOPMENT` and one `HOLDOUT` window. A window is a
non-empty half-open interval `[startMs, endMs)`. Adjacent windows do not overlap.

The `corpus` object names the statistical exposure population:

```json
{
  "instrumentId": "BTCUSDT",
  "productId": "SPOT",
  "providerId": "BINANCE_PUBLIC",
  "venueId": "BINANCE"
}
```

It deliberately has no channel, cadence, file path, or URL. Relabeling the same
population from one-minute to daily bars, or from one downloaded file to another, must not evade
window-overlap detection. Every candidate corpus identity must already exist in the registry's
custody-controlled `corpora` catalog; unknown aliases fail closed. Aggregate identities such as
`ALL`, `ANY`, and `UNKNOWN` are rejected, and a multi-instrument study must register every
population window explicitly.

Every window requires `artifactSha256`, the immutable seal of its exact bytes. DQ-5 checks both the
population/time window and exact seal reuse, so changing either the label or the file encoding
cannot weaken the other check.

Holdout state comes only from the registry's append-only event ledger. A candidate cannot submit or
omit its own event history. `OPEN_ATTEMPTED` and `OPENED` are irreversible evidence and may
reference only a settled `registration` or a custody-persisted `pendingRegistration`. Every
candidate has exactly one pre-persisted pending record carrying its full sealed registration,
matched by exact content rather than by `researchId`. Only that occurrence is excluded from the
candidate's own history. Every other pending record participates in every reuse check, including a
competing proposal with the same `researchId`. There is no mutable `OPENED -> SEALED` field.

A pending record is an unvalidated proposal, not settled ledger history. Canonical form, structural
requirements, ordering, and bounds apply immediately. Corpus-catalog membership and research-ID
distinctness are policy questions evaluated as `DQ5_CORPUS_NOT_REGISTERED` and
`DQ5_RESEARCH_ID_REUSED`; settled `registrations` remain strictly catalog-controlled.

`coverageComplete: true` asserts that the controlled corpus catalog, registration history, and
open-event history are complete. A false value rejects every intake. `custodyReceiptSha256` binds
the registry to its external custody receipt, and the exact registry bytes and receipt digest are
both echoed into the report. DQ-5 does not authenticate that external receipt: N3 must supply a
custody-verified registry.

Eligibility is valid only for the exact registry digest in the report. N3 must serialize registry
intake. N3 first atomically appends the exact candidate registration to `pendingRegistrations`,
together with any open event it is about to record, then freezes the custody-verified registry and
candidate bytes and runs DQ-5. There is no admission path for a candidate absent from the snapshot
DQ-5 hashed. Under compare-and-swap on the report's exact registry digest, N3 records the decision
and moves an eligible pending record to settled `registrations`. A rejected record remains durable
pending evidence unless N3 can move it without violating settled-ledger invariants; an event and
the registration it references are never separated. Every event enters the same ordered ledger
before a competing admission can commit. A changed registry digest invalidates the report and
requires DQ-5 to run against the new snapshot; it never requires re-appending the pending record.
Two content-distinct proposals may be pending under one `researchId`; each sees the other and is
rejected with `DQ5_RESEARCH_ID_REUSED`. Byte-identical duplicate pending rows are invalid because
the candidate's own occurrence would be ambiguous. Open events remain conservatively keyed by
research and holdout IDs, so they taint every matching same-ID proposal. DQ-5 never grants admission
by itself.

Arrays must be canonically sorted:

- settled registry registrations by unique `researchId`;
- pending registrations by the canonical registration key: research ID, family ID, protocol
  digest, freshness claim, then the full ordered window sequence including each seal digest;
- controlled corpora by canonical corpus identity;
- windows by corpus identity, start, end, role, holdout ID, and window ID;
- open events by research ID, holdout ID, recorded time, event type, and event ID.

`familyId` is supplied by the research-family distinctness owner. DQ-5 detects exact declared family
IDs; it cannot prove that differently named strategies are economically distinct.

## CLI

From `quant/`:

```bash
PYTHONPATH=src:. python -m research.dq5 \
  --registry research/dq5/fixtures/valid/registry_pending_fresh.json \
  --candidate research/dq5/fixtures/valid/candidate_fresh.json
```

Exit codes:

- `0`: `ELIGIBLE_FOR_INTAKE`;
- `1`: deterministic policy rejection;
- `2`: malformed, noncanonical, unsafe, or unavailable metadata input.

The canonical report is written to stdout. It binds the exact registry and candidate bytes plus the
registry custody-receipt digest, contains no timestamp, sorts and deduplicates every finding, and
never returns partial green after its bounded finding capacity is exceeded.

## Stable public reason codes

- `DQ5_REGISTRY_HISTORY_INCOMPLETE`
- `DQ5_VALIDATION_CAPACITY_EXCEEDED`
- `DQ5_RESEARCH_ID_REUSED`
- `DQ5_CORPUS_NOT_REGISTERED`
- `DQ5_CANDIDATE_DEVELOPMENT_HOLDOUT_OVERLAP`
- `DQ5_CORPUS_WINDOW_OVERLAP`
- `DQ5_CORPUS_WINDOW_REUSED_ACROSS_FAMILY`
- `DQ5_SEALED_ARTIFACT_REUSED`
- `DQ5_SEALED_ARTIFACT_REUSED_ACROSS_FAMILY`
- `DQ5_HOLDOUT_ID_REUSED`
- `DQ5_HOLDOUT_SHARED`
- `DQ5_HOLDOUT_SHARED_ACROSS_FAMILY`
- `DQ5_HOLDOUT_OPENED_OR_ATTEMPTED`
- `DQ5_FRESH_HOLDOUT_REQUIRED`
- `DQ5_FRESH_HOLDOUT_CLAIM_FALSE`

Consumers branch only on these codes. Window IDs, overlap bounds, and conflicting registration IDs
are separate evidence fields.

## Focused verification

From `quant/`:

```bash
PYTHONPATH=src:. MYPYPATH=src:. PYTHONHASHSEED=0 \
  uv run --locked --no-sync pytest -q research/dq5/tests
uv run --locked --no-sync ruff check research/dq5
uv run --locked --no-sync ruff format --check research/dq5
PYTHONPATH=src:. MYPYPATH=src:. \
  uv run --locked --no-sync mypy --strict --explicit-package-bases research/dq5
```

The valid fixtures prove custody-persisted empty-history admission and adjacent cross-family
boundaries. The hostile fixtures cover a candidate absent from the pending ledger, corpus
intersection, exact-seal reuse, an unregistered alias, authoritative opened/shared holdouts, reused
holdout identity, cross-family reuse, an internally contaminated split, incomplete registry
history, and an already-opened candidate.

## Design basis

- Dwork et al., *Generalization in Adaptive Data Analysis and Holdout Reuse*, shows that adaptive
  reuse of a holdout can overfit the holdout itself:
  https://proceedings.neurips.cc/paper_files/paper/2015/hash/bad5f33780c42f2588878a9d07405083-Abstract.html
- Scikit-learn's current `TimeSeriesSplit` documentation requires time-ordered evaluation and
  exposes an explicit gap between train and test:
  https://scikit-learn.org/stable/modules/generated/sklearn.model_selection.TimeSeriesSplit.html
- NIST Research Data Framework 2.0 treats metadata, provenance, persistent identity, integrity,
  and reuse as research-data lifecycle concerns:
  https://nvlpubs.nist.gov/nistpubs/SpecialPublications/1500-18/NIST.SP.1500-18r2.html
- Zhang et al., ICML 2025, argues that train-test overlap must be reported for evaluation results
  to be interpreted correctly:
  https://proceedings.mlr.press/v267/zhang25dt.html
- Python 3.13's `json` documentation records the interpreter digit limit applied by the default
  integer parser; DQ-5 normalizes that bounded decoder failure into deterministic invalid input:
  https://docs.python.org/3.13/library/json.html

These sources motivate a global exposure ledger. They do not turn simple rejection rules into a
statistical reusable-holdout mechanism, and DQ-5 makes no such claim.
