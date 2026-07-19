# Exact C9 Verdict State

Status: `PENDING_FRESH_VERIFIER`

Selection ID: `C9_FINAL_VERDICT_PENDING_FRESH_VERIFIER`

- Exact candidate: `d8a86f722689ed82ad40f9ec44bbbc19c2347646`
- Candidate tree: `1da28eb2dcc03a0545fc2bc51e2a735e88826014`
- Sole direct parent: `dea2d2a5c2b5e83d3aea75b0e368f0a478596561`
- Actor: `NO_FINAL_VERIFIER_ASSIGNED`
- Candidate source write authority: `false`

## Result

The package records exact evidence and rejected history without self-certifying a final verdict.

Unavailable or skipped: A fresh independent verifier decision is pending.

## Machine proof references

| Proof ID | Commit | Path | Git blob | SHA-256 | Bytes |
| --- | --- | --- | --- | --- | ---: |
| `SEALED_C9_SELECTION_V2` | `5fd74604082420fbe46d98e408ef4ca0d1b57711` | `verification/product-truth-20260716/EVIDENCE_SELECTION.json` | `d742ee7ac15e352fb281177111fe2bd20fd0e4b6` | `186ef8ba0fac457ad60738fac57c662745cf32f367f6cc706558f0ccbc9fdc01` | 4312 |
| `SEALED_C9_FINDINGS` | `5fd74604082420fbe46d98e408ef4ca0d1b57711` | `verification/product-truth-20260716/INDEPENDENT_FINDINGS.json` | `53eb697f7ac9048c4679b39b4d125395d9656d0f` | `17f5a99f433a81310ab5cadcdde06962c3eb2a80c4a5ec8fa271adf0b00b06a6` | 8465 |
| `SEALED_C9_PRODUCT_ASSURANCE` | `5fd74604082420fbe46d98e408ef4ca0d1b57711` | `verification/product-truth-20260716/PRODUCT_ASSURANCE_C2_DISPOSITION.json` | `71720f5e2d43735b2125022c44a2973b65b86056` | `a02540e684a52f918e9896c0196d2e46b050d841612a1248a177edfe2a037654` | 4152 |

## Rejected candidate history

| Label | Commit | Tree | Disposition | Reason |
| --- | --- | --- | --- | --- |
| C3 | `78f708d6cdb9d1618c53d3f08f71097b4320a63b` | `9e54ae92bd3cc4d30d3114590d7da6d81e019f16` | `REJECTED_FINAL_VERIFICATION` | `SIX_FINAL_VERIFIER_FINDINGS_AND_INELIGIBLE_ANCESTRY` |
| C4 | `4c9143a0bcc331aa170e9e26b741240b39df8b9e` | `164c5e812f609364ce6cd3fa37fb91530a226db2` | `REJECTED_REPORT_PARITY` | `CANONICAL_AND_SINGLE_BRANCH_REPORT_PARITY_42_OF_44_STALE_MACHINE_REPORT` |
| C5 | `959a5f9900e25f53414710bbfb3464c3ccb67a5d` | `28d3d9922cc1201333775a458919afe9158e6dc2` | `REJECTED_FINAL_VERIFICATION` | `VFINAL5_UNBOUND_GENERATOR_INCOMPLETE_INPUT_MAP_STALE_CENSUS_LEDGER_WATCHMAN_FALSE_GREEN` |
| C6 | `89cd7e066b97f2f33d730d1e0adf291ebe7c4f64` | `2dd6399ff0aa2fb21c3b4632815333cf015c053a` | `REJECTED_CANONICAL_SECURITY_GATE` | `CAMPAIGN_CONTRACT_TEST_USED_FORBIDDEN_CHILD_PROCESS_AND_ENVIRONMENT_ACCESS` |
| C7 | `a283eb859ec1142aadecbd64e0b84959535f6216` | `ffe2be1f1c4504fbb17228d2a905fe8b763af5e6` | `REJECTED_EXACT_EVIDENCE_INTEGRITY` | `STALE_PAYLOAD_INVENTORY_CHECKSUM_AND_FALSE_PROVENANCE_BLOB_COUNT` |
| C8 | `6ab02a82931ae8234456c0710cca41b94fdc12c9` | `4dbb427b357b87b9c58bfe97d06a584bd5c973ef` | `REJECTED_EXACT_CENSUS_NON_IDEMPOTENT` | `POST_EVIDENCE_GENERATOR_PASS_REWROTE_CUSTODY_HEAD_DERIVED_CENSUS_FIELDS` |

## Receipt fields

- Command or operator action: deterministic output-only rendering from verified Git objects; no candidate mutation and no live-worktree census.
- Start UTC: `2026-07-17T14:43:20+05:30`
- End UTC: `2026-07-17T14:43:20+05:30`
- Timestamp basis: `EXACT_CANDIDATE_COMMITTER_TIMESTAMP_DETERMINISTIC`
- Artifact generation result: `PENDING_FRESH_VERIFIER`
- Candidate source write authority: `false`
