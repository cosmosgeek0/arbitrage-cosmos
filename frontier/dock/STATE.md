# F0 Dock state

```text
buildState: PRESTAGE_READY
disposition: ACTIVE
terminalLabel: FRONTIER_CONTRACT_READY
dockContractVersion: 1.0.0
immutableBaseSha: f0168cb37bd04d21bc90591ab2256770de3b75bc
directivePinCommitSha: df9c52cd2a428e3d3675cf0260c0d30052a4bbff
directiveSha256: 4bb325b23c70e56103ee1553f0ea4396774ce0950d7abc9c73faa01f7006e1ad
conformance: 28/28 PASS
providerFacets: 7 USABLE, 1 BLOCKED
sharedCanonicalReferences: 4 USABLE, 1 BLOCKED
blockedModules: F11 only
authorityClass: NO_AUTHORITY
networkMode: FIXTURE_ONLY
productionIsolationProven: false
runtimeSafetyProven: false
mounted: false
integrated: false
```

The final sealed Git SHA is the commit containing this state and is reported after commit by `git rev-parse HEAD`; it is intentionally not embedded into its own commit payload. F1-F13 must pin that reported full SHA and treat Dock as read-only.

The single unresolved facet is `ANNOTATION_ADAPTER`, blocked by `CANONICAL_Q_ANNOTATION_REVISION_RETRACTION_CONTRACT_UNRESOLVED`. All other frozen facet bindings are usable for prestage compatibility only.

The separate shared `PRODUCT_INCIDENT` lifecycle reference is blocked by `INCIDENT_OWNER_NOT_CONFIGURED`; Dock does not promote an IP-CONTROL projection, Ledger record, or speculative AI-Ops artifact into incident authority.
