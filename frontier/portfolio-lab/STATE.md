# F2 PortfolioLab state

```text
buildState: PRESTAGE_READY
disposition: ACTIVE
terminalLabel: PORTFOLIO_LAB_PRESTAGE_READY
terminalTags: ADVISORY_ONLY, NO_CAPITAL_AUTHORITY, NO_RISK_AUTHORITY
branch: f-lab-0715f
immutableBaseSha: f0168cb37bd04d21bc90591ab2256770de3b75bc
prestageParentHeadSha: e0ace68de5d56bdfe51bb30cf74e44c6f109dfd5
implementationCodeCommitSha: 5684abe4c612cd29b0914afededc9bd4b3d533db
implementationSourceSha: 5cac88062c701800a08c602bd191ce796a175421
dockContractCommitSha: e0ace68de5d56bdfe51bb30cf74e44c6f109dfd5
directiveSha256: 4bb325b23c70e56103ee1553f0ea4396774ce0950d7abc9c73faa01f7006e1ad
moduleLocalTests: 67/67 PASS
acceptanceCorpus: 20/20 exact ordered cases
campaignOutcomes: 19 EVALUATED_COMPARATIVE, 1 ABSTAIN_UNKNOWN
ownerClaimAllowlist: 5 snapshot claims, 27 scenario claims
ownerOutputEvidence: 5 hash-bound UNACCEPTED_SYNTHETIC_OWNER_OUTPUT_STUBS
scenarioDefinitions: UNACCEPTED_SYNTHETIC_F12_REFERENCE_STUB
archivedFixtureEvidence: NOT_OBSERVED_HISTORY
schemaRefResolution: 360/360 across 78 definitions
closedObjectDefinitions: 43/43
resourceAtLimit: 20/20 accepted deterministic fixture steps
resourceBeyondLimit: 21/21 rejected with DEGRADATION_REQUESTED
artifactHashInventory: 14/14 PASS
authorityClass: NO_AUTHORITY
networkMode: FIXTURE_ONLY
canonical: false
mounted: false
integrated: false
acceptedOwnerFieldAdapters: false
acceptedRecordedHistory: false
acceptedF12ScenarioArtifact: false
acceptedPortfolioAdvisoryOutput: false
productSurfaceMountDecision: false
productionIsolationProven: false
runtimeSafetyProven: false
hostPerformanceMeasured: false
```

`implementationSourceSha` is the exact pre-seal source commit referenced by the extension descriptor. The final seal commit contains this state and is resolved and reported externally with `git rev-parse HEAD`; a commit cannot embed its own hash.

The three accepted Dock fixture facets are usable only for their frozen fixture operations. Future canonical insertion remains blocked on:

- `SCENARIO_REFERENCE:ACCEPTED_F12_SCENARIO_ARTIFACT_NOT_AVAILABLE`
- `ADVISORY_ASSESSOR:ACCEPTED_OWNER_FIELD_ADAPTERS_NOT_AVAILABLE`
- `ADVISORY_ASSESSOR:PORTFOLIO_LEVEL_CANONICAL_OUTPUT_ADAPTER_DECISION_REQUIRED`
- `ADVISORY_ASSESSOR:ACCEPTED_HISTORICAL_OWNER_OUTPUT_TABLE_NOT_AVAILABLE`
- `COCKPIT_PROJECTION:PORTFOLIO_LAB_SURFACE_ID_AND_MOUNT_DECISION_REQUIRED`

Those blockers do not widen this fixture-only prestage state or grant Capital, Risk, execution, mounting, or canonical authority.
