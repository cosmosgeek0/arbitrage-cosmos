# DQ-11 portable sample/admission denominator validator

DQ-11 is a deterministic, standard-library Python boundary for one research
sample funnel. It verifies immutable `(sampleId, originDigest)` identities,
declared cardinalities, identity-set digests, complete loss dispositions, and
one independently declared admitted-sample anchor.

Its authority is `NONE`. It does not select a strategy, estimate profitability,
access an account or provider, place an order, move money, or authorize capital.
Its named consumer is the N3 successor/final-convergence task.

## Frozen v1 semantics

Every required stage is present and explicitly `OBSERVED`:

`available → eligible → {quarantined, admitted} → signaled → filled → scored`

`quarantined` is the terminal side branch `eligible − admitted`; it is not a
population through which admitted samples pass. The validator enforces these
exact, disjoint identity equations:

```text
available = eligible ⊎ dispositions(after AVAILABLE)
eligible  = quarantined ⊎ admitted
quarantined = dispositions(after ELIGIBLE)
admitted  = signaled ⊎ dispositions(after ADMITTED)
signaled  = filled ⊎ dispositions(after SIGNALED)
filled    = scored ⊎ dispositions(after FILLED)
```

Counts never establish these equations. Each stage repeats the full identity
pair, and DQ-11:

- rejects duplicate `sampleId` values and duplicate origin identities;
- rejects any changed `originDigest`, foreign identity, or stage bypass;
- derives cardinality from unique identities and matches `declaredCount`;
- recomputes a domain-separated, order-independent identity-set digest;
- requires exactly one observed reason for every identity that leaves a parent;
- matches the frozen admission count and digest to the admitted identity set;
- reports signaled, filled, and scored numerators against that same admitted
  denominator, never a shrinking downstream denominator.

The input is a closed JSON object with schema
`cosmos.dq11.sample-admission-denominator.v1`. See
`fixtures/valid-mixed.v1.json` for the complete shape.

## Missing, duplicate, and zero semantics

- `MISSING` is explicit and invalid for consumption. It is never converted to
  an empty identity set or numeric zero.
- Any duplicate JSON key, stage identity, origin identity, or terminal
  disposition fails closed. DQ-11 never deduplicates.
- An `OBSERVED` empty set is a known zero only after every upstream identity is
  conserved in an observed disposition.
- A positive admitted denominator with zero signaled/filled/scored samples is a
  valid observed-zero funnel. Exact ratios retain the admitted denominator.
- A fully reconciled zero admitted denominator is structurally valid but
  `denominatorUsable=false` and
  `admissionStatus=UNMEASURED_ZERO_DENOMINATOR`. No ratio, score, or economics
  value is fabricated.
- No scored samples produce `UNMEASURED_NO_SCORED_SAMPLES`; this validator
  contains no performance metrics.

Validation emits the first deterministic error code and no partial receipt.
The raw input SHA-256 preserves byte provenance. `flowDigest` binds normalized
semantic content and is invariant to identity/disposition ordering.

## Portability and proof

The validator and CLI use only Python 3.13 standard-library modules. From
`quant/`:

```sh
PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=src:. \
  python -B -m research.dq11 research/dq11/fixtures/valid-mixed.v1.json

PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=src:. \
  uv run --locked --no-sync pytest -q -p no:cacheprovider \
  research/dq11/test_validator.py

PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=src:. \
  uv run --locked --no-sync python -B research/dq11/verify_known_answer.py

uv run --locked --no-sync ruff check research/dq11
uv run --locked --no-sync ruff format --check research/dq11
MYPYPATH=src:. uv run --locked --no-sync mypy --strict \
  --explicit-package-bases research/dq11/validator.py \
  research/dq11/__init__.py research/dq11/__main__.py \
  research/dq11/verify_known_answer.py

(cd research/dq11 && shasum -a 256 -c SHA256SUMS)
```

The CLI accepts a path or `-` for stdin, caps raw input at 1 MiB, caps each
identity/disposition collection at 100,000 entries, writes one canonical JSON
receipt on success, and exits `2` with one canonical error object on failure.

The in-packet frozen anchor detects internal drift; it is not a signature. A
consumer that needs tamper authority must pin the raw `sourceSha256`, a trusted
outer manifest, or an exact Git object. The checked-in known answer and
`SHA256SUMS` provide repository-level byte evidence, not deployment authority.

Current primary-source provenance and the boundary between external guidance
and DQ-11 project decisions are recorded in `REFERENCES.md`.
