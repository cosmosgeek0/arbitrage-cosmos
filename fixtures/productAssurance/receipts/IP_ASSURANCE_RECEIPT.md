# IP Assurance Receipt

## Identity and disposition

| Field | Value |
| --- | --- |
| Schema | PRODUCT_ASSURANCE_RECEIPT_V2 |
| Branch | ip-assurance-20260713 |
| Frozen base | 9785c93102b00389847b77c2f9348c06abc4344b |
| Implementation commit | f67db03293b184473f7f8e79b8872c6f6697f264 |
| Tested commit | f67db03293b184473f7f8e79b8872c6f6697f264 |
| D-LAUNCH-13 ruling commit | c57610cb5f7d56efb61e53ae27057fbe92a6a2f6 |
| Evaluated UTC | 2026-07-13T14:29:41.020Z |
| Generator-owned scaffold state | **CORE_SCAFFOLD_READY** |
| Full prestage state | NOT_CLAIMED_PENDING_DIRECTOR_FAN_IN |
| Authority granted | false |

This receipt records only facts verified by this generator: exact input identities, branch/HEAD/base gates, exported owner-adapter seams, the digest-bound canonical news disposition, static operation coverage, synthetic fault-model results, and the closure output set. Focused and repository-wide command results are deliberately not attested here. ASSURANCE_PRESTAGE_READY is not claimed.

## Verified governing inputs

| Source | Role | SHA-256 | Verified |
| --- | --- | --- | --- |
| IP_ASSURANCE.md | FROZEN_D_LAUNCH_8_PACKET_PROVENANCE | 5f6d4b3b70e384f6123e9ccc01891faf04aef9da7f7cfd1e0c63be5c3ba68803 | true |
| c57610cb5f7d56efb61e53ae27057fbe92a6a2f6:IP_ASSURANCE.md | D_LAUNCH_13_GOVERNING_PACKET | 49dcd690275ff35cb32566af307ad572d2a527e06d7388885f98826560968e84 | true |
| c57610cb5f7d56efb61e53ae27057fbe92a6a2f6:QL_DIRECTOR_STATE.md | D_LAUNCH_13_DIRECTOR_RULING | ec61e1678dcb108a92b9dda5503233c76b35fa5301c36077e04bdaead7b44307 | true |
| I00_PRODUCT_ASSEMBLY_CONTROL_ROOM_AND_LIVE_BRINGUP.md | PROTECTED_UNTRACKED_I00_OWNER_INPUT | 9d7a36da6a2e6e7b3e905c73161b5e998a2f92416dd557e498ade3e73d5e5ef5 | true |
| fixtures/productAssurance/generated/SYSTEMIC_ASSURANCE_DEDUP_MATRIX.md | DIRECTOR_ACCEPTED_DEDUP_LAW_PROTECTED_INPUT | 22686d2cd1c54bbc39af56399298a0ed9563bbc8643ad4f0e498718de83cb2cd | true |

The protected untracked I00 file, canonical news service, local historical packet, and dedup matrix were not modified by generation.

## Owner adapter boundaries

| Surface | Owner | Target seam | Blocker | State | Authority |
| --- | --- | --- | --- | --- | --- |
| ACTION_EVIDENCE | ACTION_EVIDENCE_SATELLITE | fixtures/productAssurance/systemic/actionEvidence/** | DIRECTOR_ACCEPTED_SATELLITE_COMMIT_MISSING | WAITING / UNKNOWN | false |
| ASSURANCE_CASE | ASSURANCE_CASE_SATELLITE | fixtures/productAssurance/systemic/assuranceCase/** | DIRECTOR_ACCEPTED_SATELLITE_COMMIT_MISSING | WAITING / UNKNOWN | false |
| DIAGNOSTIC_GOVERNANCE | A_AGENT_DIAGNOSTIC_GOVERNANCE | fixtures/productAssurance/systemic/agentBoundary/** | DIRECTOR_ACCEPTED_SATELLITE_COMMIT_MISSING | WAITING / UNKNOWN | false |
| COVERAGE | I08_S5_COVERAGE_OWNER | canonical systemIntegration supervisor plus accepted S5 coverage contract | DIRECTOR_ACCEPTED_S5_AND_I08_OWNER_CONTRACT_MISSING | WAITING / UNKNOWN | false |
| RATE_BUDGET | INTELLIGENCE_RUNTIME_RATE_BUDGET | server/src/intelligenceRuntime lifecycle and aggregate snapshot contract | AGGREGATE_RATE_BUDGET_OWNER_CONTRACT_NOT_CONFIGURED | WAITING / UNKNOWN | false |

The exported seam metadata is WAITING / UNKNOWN and grants no authority. Behavioral proofs for absence handling and exact owner/release/subject/digest binding belong to the separately observed focused suite; this generator does not claim that suite ran.

## Generator-owned verification

| Evidence | Generator-verified result | Limit |
| --- | --- | --- |
| Branch / HEAD / frozen-base ancestry | PASS | exact assigned branch and tested commit |
| Governing input digests | PASS 5/5 | exact worktree or Git-object bytes |
| Product Assurance registry denominators | PASS | compiled registry shape imported by this generator |
| Production operation scan | PASS 143/143, uncovered 0, exit 0 | static source registration |
| Reviewed news disposition | PASS 1/1 | exact site, source digest, ruling and observed-semantics registration |
| Synthetic fault model | PASS 103/103 | SYNTHETIC_ONLY; real soak NOT_RUN |
| Closure output path set | PASS 12/12 | nine reports, two JSON files and this receipt |
| Runtime/browser/deployment/private/signed proof | NOT_RUN / NOT_CONFIGURED | no live claim |

Focused tests, server typecheck/build, scope/import/secret purity, the edge-protocol suite, root npm test, root npm run test:all, and two-pass byte identity are **NOT_ATTESTED_BY_THIS_GENERATOR**. Their observed results and byte manifests must be sealed separately after execution.

Reviewed news site: OPSITE_FD086559819579DF346A, source SHA-256 38aa196200f1325cd135f2a8a00f46ace5caa1d2fcf0811c357c52f80f47bede, PURE_READ / KEEP_CANONICAL, owner EXISTING_NEWS_CONTEXT_SERVICE. No service bytes were changed.

## Local counts

| Registry | Count |
| --- | ---: |
| Operation policies | 14 |
| Safety invariants | 15 |
| Owner questions | 25 |
| Fault scenarios | 103 |
| Cockpit sections | 11 |
| Q requirements | 11 |
| Owner adapter surfaces | 5 |
| Insertion requests | 68 |

## Artifact seal

The receipt excludes its own digest. The generator emits 12 closure outputs: nine reports, two JSON evidence files, and this receipt. The other 11 output hashes calculated from the bytes this invocation writes are:

| Path | SHA-256 |
| --- | --- |
| fixtures/productAssurance/fixtures-root/core-assurance-evidence.json | 10f32bcbe45a4dce9f46abf5ebacbbc79eb9715a3d42d78bd066c6f4b6708776 |
| fixtures/productAssurance/fixtures-root/fault-harness-synthetic.json | a39b031bf19d1d027e504233e6d4ebbd3b7fe35bcb90183dd70aae13da552c1e |
| fixtures/productAssurance/generated/AGENTIC_DIAGNOSTIC_BOUNDARY.md | 949f6ac7209315601be0dd874961668f068d608d831c899acd7fab38f4baeb2f |
| fixtures/productAssurance/generated/ASSURANCE_INSERTION_REQUEST.md | 899f8aea317ebe4c9c5144ae9f04b1f8eb68703632b208de4fe0ac29edd6a1b1 |
| fixtures/productAssurance/generated/FAULT_INJECTION_AND_SOAK_REPORT.md | 85378bd1c58aba3c6dc3120e8361d49d0057f8702c1024f7884241eb098be69c |
| fixtures/productAssurance/generated/OPERATIONAL_FAILURE_ATLAS.md | 32ca295d30c9c1c9822ebcc7d176916718d26fc6f8d7af06b9d9683cf1772914 |
| fixtures/productAssurance/generated/OUT_OF_BAND_RECOVERY_REPORT.md | e7cb05da115e3e946a475ae0775f9a7a8bd7dda23739d80ad879989c45de60b5 |
| fixtures/productAssurance/generated/Q_ASSURANCE_COVERAGE_MATRIX.md | 4c3dd83174aaeecd210d91d0aa8b45c026a00307b8226384dccaaf4b60eaa3ea |
| fixtures/productAssurance/generated/RELIABILITY_POLICY_REGISTRY.md | 727363acf2f38b07b97a7ad2f9dfbf8394578f1f375cd82cedfd01003fde4898 |
| fixtures/productAssurance/generated/SAFETY_INVARIANT_CATALOG.md | d06319be01c66745064ec5bb614570d5f5ef2861519c782ac9f0b0d166a05cb0 |
| fixtures/productAssurance/generated/TELEMETRY_COVERAGE_MATRIX.md | 1ea1062c7c2cd53b817e69ffa5e525f1f7278981ea4e5898bb468115a83fe9f3 |

This receipt does not self-attest a second invocation. The separately protected dedup matrix was verified at SHA-256 22686d2cd1c54bbc39af56399298a0ed9563bbc8643ad4f0e498718de83cb2cd. Any two-pass byte-identity claim must come from an external comparison of all 12 generated outputs using identical injected inputs.

## Changed-path inventory

Path-set SHA-256: 9ee8554b60e5e580169b65671baf9899d53d46a79e500a1004230ece81c9af5e over sorted UTF-8 paths, one newline each.

- `fixtures/productAssurance/fixtures-root/core-assurance-evidence.json`
- `fixtures/productAssurance/fixtures-root/fault-harness-synthetic.json`
- `fixtures/productAssurance/generated/AGENTIC_DIAGNOSTIC_BOUNDARY.md`
- `fixtures/productAssurance/generated/ASSURANCE_INSERTION_REQUEST.md`
- `fixtures/productAssurance/generated/FAULT_INJECTION_AND_SOAK_REPORT.md`
- `fixtures/productAssurance/generated/OPERATIONAL_FAILURE_ATLAS.md`
- `fixtures/productAssurance/generated/OUT_OF_BAND_RECOVERY_REPORT.md`
- `fixtures/productAssurance/generated/Q_ASSURANCE_COVERAGE_MATRIX.md`
- `fixtures/productAssurance/generated/RELIABILITY_POLICY_REGISTRY.md`
- `fixtures/productAssurance/generated/SAFETY_INVARIANT_CATALOG.md`
- `fixtures/productAssurance/generated/TELEMETRY_COVERAGE_MATRIX.md`
- `fixtures/productAssurance/receipts/IP_ASSURANCE_RECEIPT.md`
- `fixtures/productAssurance/receipts/IP_ASSURANCE_WORKER_STATE.md`
- `server/src/productAssurance/adapters/ownerContracts.ts`
- `server/src/productAssurance/catalog/core.ts`
- `server/src/productAssurance/cockpit/viewModel.ts`
- `server/src/productAssurance/common.ts`
- `server/src/productAssurance/controllers/gate.ts`
- `server/src/productAssurance/diagnostics/boundary.ts`
- `server/src/productAssurance/failureAtlas/atlas.ts`
- `server/src/productAssurance/faults/harness.ts`
- `server/src/productAssurance/index.ts`
- `server/src/productAssurance/invariants/evaluator.ts`
- `server/src/productAssurance/operations/policy.ts`
- `server/src/productAssurance/projections/operationalTruth.ts`
- `server/src/productAssurance/qCoverage/generator.ts`
- `server/src/productAssurance/remediation/campaign.ts`
- `server/test/productAssurance/core-policy-inventory.test.mjs`
- `server/test/productAssurance/helpers.mjs`
- `server/test/productAssurance/operational-remediation.test.mjs`
- `server/test/productAssurance/owner-contract-gate-adversarial.test.mjs`
- `server/test/productAssurance/production-operation-scan-adversarial.test.mjs`
- `server/test/productAssurance/systemic-diagnostics.test.mjs`
- `test/productAssurance/generate-closure.mjs`
- `test/productAssurance/production-operation-scan.mjs`
- `test/productAssurance/scope-purity.mjs`

## Reproduction

~~~sh
node test/productAssurance/generate-closure.mjs --tested-commit f67db03293b184473f7f8e79b8872c6f6697f264 --implementation-commit f67db03293b184473f7f8e79b8872c6f6697f264 --evaluated-at-ms 1783952981020 --director-state-commit c57610cb5f7d56efb61e53ae27057fbe92a6a2f6 --disposition CORE_SCAFFOLD_READY
~~~

Primary-source research used before implementation: SLSA v1.2 artifact verification, in-toto Statement and Release predicate v1.2.0, DSSE v1.0.2, RFC 8785 deterministic JSON, and Sigstore advisory GHSA-whqx-f9j3-ch6m. Those sources informed exact tuple conjunction, substitution resistance, and deterministic serialization.

## Authority and next owner

- This generator performs no push, current-main write, external mutation, private/signed exchange call, order, borrow, repay, transfer, withdrawal, leverage/margin change, deployment, or money-path action.
- LIVE_EXECUTION_NOT_IMPLEMENTED remains binding; its test result is not attested by this generator.
- Synthetic PASS is not live, deployed, integrated, soak, or recovery proof.
- Only the I00 director may perform serial fan-in, shared wiring, root STATE.md update, and the later full-prestage determination.

Terminal: **CORE_SCAFFOLD_READY**
