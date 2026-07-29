# DQ-9 current-source research

Sources were rechecked on 2026-07-30 before implementation. They shape the
prospective integrity contract; they do not certify any Cosmos experiment or
economic result.

| Source | DQ-9 use |
| --- | --- |
| [SLSA v1.2 source requirements](https://slsa.dev/spec/v1.2/source-requirements) | Bind an immutable source revision and its exact digest; preserve repository/revision identity instead of accepting a floating branch label. |
| [SLSA v1.2 source verification](https://slsa.dev/spec/v1.2/verifying-source) | Match the evidence subject digest and repository/ref expectations before consuming a revision. |
| [in-toto Attestation Framework v1 statement](https://github.com/in-toto/attestation/blob/main/spec/v1/statement.md) | Bind each statement to an immutable subject digest and an explicit predicate type. DQ-9 mirrors the subject/predecessor binding without claiming an in-toto attestation. |
| [RFC 8785 JSON Canonicalization Scheme](https://www.rfc-editor.org/rfc/rfc8785.html) | Use invariant property ordering and strict JSON values for repeatable hashes. DQ-9 uses a narrower ASCII-and-integer domain and its own documented canonical bytes, not a claim of full JCS conformance. |
| [Python 3.13 `json` documentation](https://docs.python.org/3.13/library/json.html) | Apply sorted compact encoding, `allow_nan=False`, strict UTF-8 decoding, and hooks that reject duplicate keys, floats, and non-finite constants. |
| [OSF registrations and preregistrations](https://help.osf.io/article/330-welcome-to-registrations) | Preserve the plan as a time-stamped read-only record before analysis; amendments do not rewrite the original frozen record. |
| [scikit-learn common pitfalls](https://scikit-learn.org/stable/common_pitfalls.html) | Keep test/holdout data out of development choices and preprocessing. |
| [The Update Framework specification](https://theupdateframework.github.io/specification/) | Carry monotone version/expiry and predecessor checks as a general model for rejecting rollback or frozen/replayed state. DQ-9 adapts only the monotone-state discipline. |
| [Git `check-ref-format`](https://git-scm.com/docs/git-check-ref-format) | Apply Git's component rules to origin tracking refs: no dot-prefixed or `.lock` components, consecutive dots, forbidden punctuation, repeated slashes, or ambiguous endpoints. DQ-9 uses a stricter ASCII subset. |

## Local evidence inspected without opening experiments

- DQ-3 provided the pure dataclass/enum API, stable error codes, known-answer
  receipt, and strict static-check convention.
- V-G37 showed the protocol commit → source-freeze/pre-run commit → consumed
  marker → terminal chain and the need for one distinct candidate seal.
- The current `run.md` acceptance rows for V-G12, V-G32, and V-G35 showed why
  pre-run object durability, exact causal inputs, absorbing terminal state, and
  no repair/rerun must be explicit.

DQ-9 does not import their result bytes, open their archives, or reclassify
their terminal dispositions.
