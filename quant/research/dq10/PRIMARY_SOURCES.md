# DQ-10 primary-source ledger

Sources were rechecked on 2026-07-30 before implementation. They constrain
syntax, interoperable parsing, and transparent reporting. The DQ-10
`crediblePositive`, verdict, and authority rules remain local normative policy;
no external source below grants capital or execution authority.

| primary source | current URL | DQ-10 use | boundary |
|---|---|---|---|
| IETF RFC 8259, *The JavaScript Object Notation (JSON) Data Interchange Format* | <https://www.rfc-editor.org/rfc/rfc8259.html> | JSON values distinguish `null` from numbers; non-finite values are not JSON numbers; object-name duplication is an interoperability risk | Does not define research truth, verdicts, or capital semantics |
| IETF RFC 7493, *The I-JSON Message Format* | <https://www.rfc-editor.org/rfc/rfc7493.html> | Supports unique object names, interoperable numeric bounds, strict text handling, and the exact-integer range used for counts | DQ-10 is not a general I-JSON certification tool |
| JSON Schema Draft 2020-12, Core | <https://json-schema.org/draft/2020-12/json-schema-core.html> | Supports closed structural thinking through object properties and additional-property evaluation | DQ-10 uses a standalone stdlib validator, not a JSON Schema runtime |
| JSON Schema Draft 2020-12, Validation | <https://json-schema.org/draft/2020-12/json-schema-validation.html> | Confirms that `null`, `number`, `boolean`, and `integer` are distinct validation types and that required properties are explicit assertions | DQ-10 adds cross-field semantics beyond structural schema validation |
| Python 3 JSON documentation | <https://docs.python.org/3/library/json.html> | Documents `parse_int`, `parse_float`, `parse_constant`, and `object_pairs_hook`, which DQ-10 uses to preserve numeric lexemes and reject constants and duplicate names | Python defaults alone are not the contract; DQ-10 supplies stricter hooks and bounds |
| NIST FIPS 180-4, *Secure Hash Standard* | <https://csrc.nist.gov/pubs/fips/180-4/upd1/final> | Defines SHA-256, used to bind the exact caller-supplied policy bytes and exact result bytes | A digest establishes byte identity, not policy approval, research correctness, or authority |
| Python 3 `hashlib` documentation | <https://docs.python.org/3/library/hashlib.html> | Documents the stdlib `sha256(bytes).hexdigest()` operation used for policy, input, and report binding | DQ-10 hashes raw supplied bytes and does not canonicalize or sign the policy |
| CONSORT 2025 explanation and elaboration | <https://www.bmj.com/content/389/bmj-2024-081124> | Current primary reporting guidance supports explicit numbers analysed, outcome-specific denominators, and transparent missing/excluded counts | A trading-research envelope is not a clinical trial; DQ-11 owns stage construction and DQ-10 checks only declared denominator semantics |
| ASA statement on p-values | <https://doi.org/10.1080/00031305.2016.1154108> | Supports the rule that a thresholded p-value alone cannot establish a credible positive or justify a decision; design, effect size, uncertainty, and context remain necessary | The paper does not define DQ-10 `GO`; the pinned upstream policy defines gates and DQ-10 requires a strictly positive lower bound plus all mandatory gates |

## Normative translation

The sources above are translated into these DQ-10 invariants:

1. `UNKNOWN` values are explicit `null`, never an invented numeric zero.
2. Verified zero is a real number with evidence and remains distinct from
   unknown.
3. Mandatory-gate totals retain passed, failed, and unknown partitions.
4. The result gate inventory and mandatory/optional classification exactly
   match the supplied policy.
5. The result's policy SHA-256 matches the exact supplied policy bytes.
6. An incomplete sample, interval, or gate set is `UNMEASURED`.
7. A complete but non-credible result is `NO_GO`.
8. `GO` requires a strictly positive verified lower bound and every mandatory
   gate passing under the pinned upstream policy.
9. Every result keeps `capitalVerdict=NO_GO`,
   `capitalAuthority=NONE`, and `executionAuthority=NONE`.
10. N3 preapproves the policy digest and compares it with the DQ-10 report
    before consuming the digest-bound result projection.

## Recheck command placeholders

Current source identity should be rechecked before changing the contract:

```text
open https://www.rfc-editor.org/rfc/rfc8259.html
open https://www.rfc-editor.org/rfc/rfc7493.html
open https://json-schema.org/draft/2020-12/json-schema-core.html
open https://json-schema.org/draft/2020-12/json-schema-validation.html
open https://docs.python.org/3/library/json.html
open https://csrc.nist.gov/pubs/fips/180-4/upd1/final
open https://docs.python.org/3/library/hashlib.html
open https://www.bmj.com/content/389/bmj-2024-081124
open https://doi.org/10.1080/00031305.2016.1154108
```

These are documentation checks only. They perform no exchange, private,
provider, host, order, transfer, withdrawal, or money action.
