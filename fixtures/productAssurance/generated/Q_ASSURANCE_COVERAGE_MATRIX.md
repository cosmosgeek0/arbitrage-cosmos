# Q Assurance Coverage Matrix

Generated for f67db03293b184473f7f8e79b8872c6f6697f264 at 2026-07-13T14:29:41.020Z.

Read-only accepted-Q projection. No current assessment envelope or holdout evidence was supplied, so evaluation is UNKNOWN, the safe action is ABSTAIN_UNKNOWN, and authority is false.

| Identity | Immutable value |
| --- | --- |
| Accepted protocol commit | 73e1a1ff7daa48df8dac45713fc5f106842edafc |
| Accepted Q commit | 02b4eccc8d2ef53b830cafae06e5175715fa6ebb |
| Protocol schema digest | 229af0ff13d600c7d305c6deb7f57b61bdb6f8a35f6f2349d91f5ab1b4972f1c |
| Acceptance receipt digest | 9cfa0356228d7f48674df2d9db523f0f0d53dab1a4e4255b6ba9676e463ec5dc |

| Requirement | Source fields | Law | Verdict | Reason | Authority |
| --- | --- | --- | --- | --- | --- |
| ACCEPTED_Q_IDENTITY | acceptedProtocolCommit<br>acceptedQCommit<br>protocolSchemaDigest<br>acceptanceReceiptDigest<br>identityDigest | Immutable accepted Q and frozen protocol identities have independent evidence. | UNKNOWN | BOUND_ACCEPTED_ASSESSMENT_EVIDENCE_NOT_SUPPLIED | false |
| PROTOCOL_V1_COMPATIBILITY | envelopeSchema<br>envelopeVersion | Only the frozen EdgeAssessmentEnvelopeV1 version 1 is accepted. | UNKNOWN | BOUND_ACCEPTED_ASSESSMENT_EVIDENCE_NOT_SUPPLIED | false |
| LINEAGE_INTEGRITY | proofs.LINEAGE_INTEGRITY | Assessment lineage remains sealed and independently evidenced. | UNKNOWN | BOUND_ACCEPTED_ASSESSMENT_EVIDENCE_NOT_SUPPLIED | false |
| ASSESSMENT_FRESHNESS | proofs.ASSESSMENT_FRESHNESS | Expired, future-ambiguous, or unavailable assessment evidence is never green. | UNKNOWN | BOUND_ACCEPTED_ASSESSMENT_EVIDENCE_NOT_SUPPLIED | false |
| ADVISORY_ONLY_BOUNDARY | advisoryOnly<br>advisoryAction | Q output remains a research second opinion and never becomes a product authority. | UNKNOWN | BOUND_ACCEPTED_ASSESSMENT_EVIDENCE_NOT_SUPPLIED | false |
| NO_ORDER_OR_EXECUTION_AUTHORITY | orderAuthority<br>executionAuthority<br>capitalAuthority<br>moneyMutationCapability | Q grants no order, execution, capital, or money-mutation authority. | UNKNOWN | BOUND_ACCEPTED_ASSESSMENT_EVIDENCE_NOT_SUPPLIED | false |
| UNKNOWN_ECONOMICS_ABSTAINS | economicsState<br>advisoryAction | Unknown economics forces ABSTAIN_UNKNOWN. | UNKNOWN | BOUND_ACCEPTED_ASSESSMENT_EVIDENCE_NOT_SUPPLIED | false |
| DATA_SUFFICIENCY | proofs.DATA_SUFFICIENCY | Data sufficiency is explicit evidence, never inferred from an emitted assessment. | UNKNOWN | BOUND_ACCEPTED_ASSESSMENT_EVIDENCE_NOT_SUPPLIED | false |
| INDEPENDENT_VERIFICATION | proofs.INDEPENDENT_VERIFICATION | Unknown verifier independence stays UNKNOWN; common-mode proof cannot self-verify. | UNKNOWN | BOUND_ACCEPTED_ASSESSMENT_EVIDENCE_NOT_SUPPLIED | false |
| HOLDOUT_SEPARATION | proofs.HOLDOUT_SEPARATION | Unknown holdout identity stays UNKNOWN; overlap with training evidence fails. | UNKNOWN | BOUND_ACCEPTED_ASSESSMENT_EVIDENCE_NOT_SUPPLIED | false |
| FORBIDDEN_CONTENT_ABSENT | forbiddenCapabilityFieldsPresent | Protocol input contains no secret, private exchange, order, or capital authority fields. | UNKNOWN | BOUND_ACCEPTED_ASSESSMENT_EVIDENCE_NOT_SUPPLIED | false |
