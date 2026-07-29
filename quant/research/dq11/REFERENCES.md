# DQ-11 primary-source notes

Checked on 2026-07-30 before implementation. These sources informed the
validator design; none defines the Cosmos-specific schema or grants operational
authority.

## Participant/sample accounting

- [STROBE combined checklist v4](https://www.strobe-statement.org/fileadmin/Strobe/uploads/checklists/STROBE_checklist_v4_combined.pdf)
  asks observational-study reports to account for participant numbers at each
  stage, reasons for non-participation, missing values, and outcome events.
- [CONSORT 2025](https://www.consort-spirit.org/) and its
  [BMJ statement](https://www.bmj.com/content/389/bmj-2024-081123) retain
  participant-flow and exclusion/loss reporting as core randomized-trial
  reporting requirements.
- [FDA ICH E9(R1)](https://www.fda.gov/regulatory-information/search-fda-guidance-documents/e9r1-statistical-principles-clinical-trials-addendum-estimands-and-sensitivity-analysis-clinical)
  emphasizes prospectively defined target populations, outcomes, handling of
  intercurrent events, and sensitivity to assumptions.

DQ-11's exact set partitions, frozen admitted identity digest, error codes, and
zero-denominator receipt state are project decisions implementing conservative
research evidence accounting. They are not claims that DQ-11 is a clinical
reporting implementation.

## Strict JSON and deterministic evidence

- [RFC 8259](https://www.rfc-editor.org/rfc/rfc8259.html) says JSON object names
  should be unique and documents unpredictable behavior when implementations
  encounter duplicates.
- [Python 3 JSON documentation](https://docs.python.org/3/library/json.html)
  documents that the default decoder accepts repeated names using the last
  value and accepts non-finite `NaN`/`Infinity` values. DQ-11 overrides both
  behaviors and fails closed.
- [JSON Schema Validation Draft 2020-12](https://json-schema.org/draft/2020-12/json-schema-validation)
  informed the closed structural vocabulary. The executable validator remains
  the authority for cross-stage set equations that a structural schema alone
  does not express.
- [RFC 8785, JSON Canonicalization Scheme](https://www.rfc-editor.org/rfc/rfc8785.html)
  informed deterministic serialization and hash-bound evidence. DQ-11 uses its
  own documented, ASCII-only, domain-separated canonical JSON profile; it does
  not claim general RFC 8785 conformance.
