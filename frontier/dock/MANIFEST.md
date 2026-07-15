# F0 Dock manifest

## Identity

- Program organ: `F0 Dock`
- Contract version: `1.0.0`
- Branch: `f-dock-0715f`
- Immutable accepted Main base: `f0168cb37bd04d21bc90591ab2256770de3b75bc`
- Directive SHA-256: `4bb325b23c70e56103ee1553f0ea4396774ce0950d7abc9c73faa01f7006e1ad`
- Directive pin commit: `df9c52cd2a428e3d3675cf0260c0d30052a4bbff`
- Authority: `NO_AUTHORITY`
- Network: `FIXTURE_ONLY`
- Secrets: `NONE`

Dock is a compatibility SDK and conformance lab. It does not mount extensions, open transports, execute scenarios, recompute product truth, or perform canonical writes or external mutations.

## Frozen artifacts

- `contracts/v1/dock-v1.schema.json`: portable V1 record schema.
- `contracts/v1/compatibility-matrix.json`: SemVer and forward-compatibility policy.
- `contracts/v1/canonical-owner-map.json`: one exact binding for each of the eight provider facets.
- `contracts/v1/canonical-shared-owner-references.json`: exact Q, IP, AI-Ops/agent, product-health, and product-incident owner references and blockers.
- `contracts/v1/adapter-rules.json`: lossless, identity-only fixture adapter rules.
- `contracts/v1/module-facet-matrix.json`: exact F1-F13 dependency map.
- `contracts/v1/hard-denials.json`: non-authoritative safety boundary.
- `src/**`: dependency-free Node ESM reference implementation.
- `fixtures/**` and `examples/**`: deterministic portable JSON records.
- `tests/conformance.test.mjs`: the 28 required Dock-local conformance cases.
- `CONTRACT_HASHES.sha256`: content identities for all contracts, fixtures, and examples.

## Canonical-owner status

| Facet | Status | Exact accepted owner commit | Contract/version |
|---|---|---|---|
| `EVIDENCE` | `USABLE` | `f0168cb37bd04d21bc90591ab2256770de3b75bc` | `NormalizedEvidence` / `TruthMetadata`; `MarketEvidenceEnvelopeV1@1`; `DataSourceCardV1@1` |
| `DERIVED_FEATURE` | `USABLE` | `f0168cb37bd04d21bc90591ab2256770de3b75bc` | Main feature tuple; `Q06FeatureRegistryV1@1`; `FeatureValueV1@1` |
| `ADVISORY_ASSESSOR` | `USABLE` | `b3d8cedece8cf3a9f546c60016beae442f85f160` | `EdgeAssessmentEnvelopeV1@1` |
| `REPLAY_ADAPTER` | `USABLE` | `f0168cb37bd04d21bc90591ab2256770de3b75bc` | `cosmos.foundation.replay@1` |
| `COCKPIT_PROJECTION` | `USABLE` | `2c98ae653ba97e6383c29697283288346de28bdb` | `product-supervisor.v1` |
| `EXPERIMENT_PROVIDER` | `USABLE` | `6b18928c282f19128a033ed33910754cbdc2cbe0` | `Q15ExperimentCardV1@1` |
| `SCENARIO_REFERENCE` | `USABLE` | `df6b472993ca9659ce09cf5f72004981c6835f0d` | Dock `ScenarioReferenceV1@1`, consumed by canonical L/assurance owners; future provider `F12` |
| `ANNOTATION_ADAPTER` | `BLOCKED` | `02b4eccc8d2ef53b830cafae06e5175715fa6ebb` | `CANONICAL_Q_ANNOTATION_REVISION_RETRACTION_CONTRACT_UNRESOLVED` |

Only F11 requires `ANNOTATION_ADAPTER`; therefore only F11 is blocked by the unresolved annotation contract. The exact repository-object evidence, blob identities, limitations, and dependent modules are recorded in `contracts/v1/canonical-owner-map.json`.

The shared-owner map records Q evidence, IP expected-inventory/telemetry, the packet-local AI-Ops agent/policy boundary, and product health as usable prestage references. Product incident lifecycle is separately `BLOCKED` by `INCIDENT_OWNER_NOT_CONFIGURED`; it does not block an unrelated provider facet or module.

## Verification entry point

```sh
node --test frontier/dock/tests/conformance.test.mjs
```

This command proves fixture compatibility only. It does not prove production isolation, runtime safety, mounting, transport, or product integration.
