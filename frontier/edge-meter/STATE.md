# F8 EdgeMeter state

```text
buildState: PRESTAGE_READY
disposition: ACTIVE
terminalLabel: EDGE_METER_PRESTAGE_READY
moduleId: F8
extensionId: frontier.edge-meter
extensionVersion: 0.1.0
branch: f-edge-0715f
immutableBaseSha: f0168cb37bd04d21bc90591ab2256770de3b75bc
dockContractSha: e0ace68de5d56bdfe51bb30cf74e44c6f109dfd5
directiveSha256: 4bb325b23c70e56103ee1553f0ea4396774ce0950d7abc9c73faa01f7006e1ad
sourceSha: 110f185e34c2d5cabbde033de84a4d0464c399c9de2bca55f7079a9828cbcfc0
descriptorHash: bdc6f1d0b448d5e63943a738a358861b042d4d9cf058d094334d737247a23f96
focusedTests: 62/62 PASS
authorityClass: NO_AUTHORITY
networkMode: FIXTURE_ONLY
secretMode: NONE
measurementOnly: true
profitClaim: false
edgeProven: false
mounted: false
integrated: false
canonical: false
productionIsolationProven: false
productionRuntimeProven: false
```

The final sealed Git SHA is the commit containing this state and is reported after commit by `git rev-parse HEAD`; a commit cannot embed its own hash. Its parent must remain the exact F0 Dock commit above, and every changed path in that commit must remain under `frontier/edge-meter/**`.

## Health boundary

No production health contract exists. Fixture validation is healthy only when the dependency-free parser, report verifier, Dock facet pins, descriptor seal, source hashes, resource envelope, saved projections, and all 62 focused tests pass. CPU, memory, disk throughput, production latency, isolation, transport, and product behavior remain `UNAVAILABLE`.

## Current boundary

- The complete REAL fixture deterministically projects `ATTRIBUTABLE`; missing, abstained, historical-fit, premature, conflicting, tampered, and divergent evidence fail closed into explicit non-green states.
- Capital and Q values are projection-bound to selected immutable reference metadata but are not production-signed or canonically read back.
- The accepted fixture ceiling is 32 records and 1 MiB per report. Beyond the declared rate, the module rejects or requests degradation without silent loss.
- The cockpit preview is synthetic, inert, unmounted, and noncanonical.
- All future read-only Capital, Q, L, Ledger, and Product seams remain owner-gated in `INSERTION.md`.
