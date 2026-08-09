# DQ-14 primary references

Checked 2026-07-30. These are the current official sources used for the DQ-14 contract.

- [Python 3.14 `sys` — `sys.addaudithook`](https://docs.python.org/3.14/library/sys.html#sys.addaudithook) — Python explicitly warns that Python-level audit hooks are not a sandbox and can be bypassed. DQ-14 therefore replays events supplied by a controlled facade and makes no ambient-I/O claim.
- [Python 3.14 `json`](https://docs.python.org/3.14/library/json.html) — Python accepts repeated object names and non-finite numbers by default, motivating strict decoding before canonical replay.
- [Python 3.14 `zipfile`](https://docs.python.org/3.14/library/zipfile.html) — `infolist()` preserves on-disk member order, `open()` accepts a `ZipInfo` identity, and `testzip()` reads member content. These semantics motivate ordinal member identity and distinct open/read transitions; the replay core itself does not open ZIP files.
- [Python 3.14 `hashlib`](https://docs.python.org/3.14/library/hashlib.html) — supplies SHA-256. The replay contract hashes canonical bytes and does not rely on `file_digest()` or its file-position side effects.
- [RFC 8785, JSON Canonicalization Scheme](https://www.rfc-editor.org/rfc/rfc8785.html) — defines deterministic JSON serialization suitable for stable digest inputs.
- [RFC 8259, JSON Data Interchange Format](https://www.rfc-editor.org/rfc/rfc8259.html) — defines the JSON grammar and interoperability baseline, including UTF-8 requirements for exchanged JSON.
- [NIST FIPS 180-4, Secure Hash Standard](https://csrc.nist.gov/pubs/fips/180-4/upd1/final) — specifies SHA-256, used for content identities, the event chain, and exact claim bindings.
- [in-toto Statement v1](https://github.com/in-toto/attestation/blob/main/spec/v1/statement.md) — establishes the pattern of binding a claim to immutable subjects by digest. DQ-14 borrows the binding discipline, not authenticated attestation status.
- [SLSA v1.2 Verification Summary Attestation](https://slsa.dev/spec/v1.2/verification_summary) — distinguishes a verification result from the signature, subject, verifier, policy, and trust checks needed to rely on it. DQ-14 performs deterministic self-consistency checks only.
