# S2 action-evidence research basis

`SYNTHETIC_ONLY` · `SUPPORTING_EVIDENCE_ONLY` · authority effect `NONE`

Retrieved 2026-07-14. These primary sources informed the packet-local evidence mechanics. They do not override the repository authority map, create an execution rule, or turn an evidence result into authorization.

## Current primary sources

- [NIST SP 800-53 Rev. 5, AC-5 Separation of Duties and CA-2 independent assessment](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final): supports explicit producer/verifier role separation and named independent assessment rather than self-attestation.
- [RFC 6960, Online Certificate Status Protocol](https://www.rfc-editor.org/rfc/rfc6960.html): supplies a mature three-state status precedent (`good`, `revoked`, `unknown`) and bounded response-validity fields. S2 adopts only the fail-closed tri-state and validity-window ideas, not OCSP wire semantics.
- [W3C Verifiable Credentials Data Model 2.0](https://www.w3.org/TR/vc-data-model-2.0/): supports subject binding, validity bounds, status/invalidation material, and the separation between verifying evidence and deciding whether to take an action.
- [RFC 9111, HTTP Caching](https://www.rfc-editor.org/rfc/rfc9111.html): supports explicit freshness lifetime, current-age evaluation, and invalidation rather than replaying stale state as current truth.
- [NIST SP 800-207, Zero Trust Architecture](https://doi.org/10.6028/NIST.SP.800-207): supports keeping policy inputs separate from the policy decision point. S2 is an input envelope; canonical Capital, Risk, Control, and execution owners remain the decision authorities.
- [SLSA v1.2, Verifying artifacts](https://slsa.dev/spec/v1.2/verifying-artifacts): supports binding a verified subject to expected identity and provenance, plus an explicit verifier step rather than trusting provenance merely because it exists.
- [SLSA v1.2 Verification Summary Attestation](https://slsa.dev/spec/v1.2/verification_summary): supports a bounded verification summary that records what was checked without becoming authority over an unrelated action lifecycle.

## Repository application

The implementation applies those ideas under `IP_ASSURANCE.md` amendment §3 and §11:

1. Every envelope binds one frozen-L action identity and one exact owner discriminant.
2. Every required evidence family names a producer and verifier. The same actor is `FAIL`; different actors that share a declared owner or independence domain remain `UNKNOWN` because independence is unproven.
3. Every result is exactly `PASS`, `FAIL`, or `UNKNOWN`.
4. Missing verification, expiry, staleness, invalidation, temporal incoherence, or unbounded scenario truth yields `UNKNOWN`; stale evidence can never retain `PASS` or `FAIL`.
5. A current contradiction or same-actor producer/verifier collision yields `FAIL`.
6. Dependencies close only within the same action record. No cross-action claim graph, common-mode analysis, ranking, or status aggregation is created here.
7. Every non-`SUPPORTING_EVIDENCE_ONLY` purpose is refused. Approval, admission, blocking, ranking, execution, and dispatch purposes throw `ACTION_EVIDENCE_NOT_AUTHORITY` for every evidence status.
8. The legal projection snapshots its request and envelope, recomputes the evaluation internally, validates the derived result, and never accepts a caller-supplied result.

The sources above are design evidence only. Frozen repository owners and immutable commits remain law.
