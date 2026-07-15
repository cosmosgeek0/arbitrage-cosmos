# F1 VenueMesh manifest

## Module identity

- `extensionId`: `frontier.venue-mesh`
- `extensionVersion`: `0.1.0`
- `module`: `F1 VenueMesh`
- `buildState`: `PRESTAGE_READY`
- `disposition`: `ACTIVE`
- `terminalLabel`: `VENUE_MESH_PRESTAGE_READY`
- posture: `READ_ONLY`, `UNWIRED`, `FIXTURE_ONLY`, `NO_CREDENTIALS`, `NO_ORDER_AUTHORITY`, `NO_AUTHORITY`

The module is a deterministic additional-venue evidence and comparison prestage. It is not a live connector, source registry, exchange-truth owner, executor, cockpit projection, or proof of an economic edge.

## Frozen inputs

- immutable accepted Main / `FRONTIER_BASE_SHA`: `f0168cb37bd04d21bc90591ab2256770de3b75bc`
- accepted F0 Dock commit: `e0ace68de5d56bdfe51bb30cf74e44c6f109dfd5`
- prebuild branch HEAD: `e0ace68de5d56bdfe51bb30cf74e44c6f109dfd5`
- directive SHA-256: `4bb325b23c70e56103ee1553f0ea4396774ce0950d7abc9c73faa01f7006e1ad`
- F1 `EVIDENCE` binding: `69979efb8e2f01bee7d84d4e44cfeeb4116a268694112a44770da2b07460822d`
- F1 `DERIVED_FEATURE` binding: `8f2768ad7eac3e2a273c457a05810cff19ac4ca174fd8fb77ddf70b3ec18ce86`
- accepted Q source/evidence owner: `02b4eccc8d2ef53b830cafae06e5175715fa6ebb`
- accepted L executable-semantics owner: `df6b472993ca9659ce09cf5f72004981c6835f0d`

No frozen Dock, Q, L, product, or shared source was copied or edited.

## Artifact map

| Path | Purpose |
|---|---|
| `src/` | Pure deterministic identity, evidence, normalization, source-policy, independence, comparison, health, boundary, facet, and preview contracts |
| `contracts/v1/` | Dock descriptor, canonical-root identity maps, closed local schemas, resource/rate claims, and non-authoritative future insertion request |
| `fixtures/venues/` | Documentation-derived synthetic Coinbase, Kraken, and Deribit identity/quote/trade/depth/derivatives fixtures |
| `fixtures/context/` | Point-in-time context, copy-family, and proved-missing/adaptor-required context matrix |
| `fixtures/source-cards/` | Inputs that deterministically materialize Q-compatible `DataSourceCardV1` review records |
| `fixtures/adapter/` | Lossless evidence and `FeatureValueV1` round-trip vectors |
| `fixtures/transport/` | Contiguous, gap, reconnect, and resnapshot cases |
| `fixtures/license-retention-matrix.v1.json` | Versioned owner/origin/access/terms/sampling/geography/authentication/review matrix |
| `preview/` | Stdout-only isolated fixture preview; no cockpit facet or control surface |
| `tests/` | Module-local contract, honesty, resource, determinism, and isolation proofs |
| `RESEARCH.md` | Current official-documentation research receipt and retrieved hashes |
| `CONTRACT_HASHES.sha256` | SHA-256 seal for the descriptor, maps, schema, claims, research, and honesty/license matrices |
| `STATE.md`, `RECEIPT.md`, `INSERTION.md` | Durable state, proof receipt, limitations, and owner-gated future seam request |

## Public entry points

All runtime exports are re-exported from `src/index.mjs`. The core entry points are:

- venue normalization: `normalizeCoinbaseFixture`, `normalizeKrakenFixture`, `normalizeDeribitFixture`, `normalizeCoinbaseTradeFixture`, `normalizeKrakenBookFixture`;
- identity: `createInstrumentDescriptor`, `mapInstrumentIdentity`, `detectIdentityCollisions`, `compareInstrumentIdentity`;
- quality: `normalizeTimestamp`, `evaluateFreshness`, `evaluateSequence`, `simulateRateBudget`, `compareRestAndStream`, `assessVenueMeshHealth`, `projectSourceHealthCanonicalState`;
- comparison: `compareVenueQuotes`, `evaluateFixtureLeadership`;
- governance: `materializeReviewOnlySourceCard`, `evaluateSourceCard`, `buildSourceIndependenceGraph`, `evaluateContextInformationSet`;
- Dock seams: `materializeEvidenceAdapterFixture`, `materializeDerivedFeatureAdapterFixture`, `createVenueMeshFacetRuntime`, `makeFacetRequest`. Available observations materialize as the exact canonical contract root; unavailable observations remain explicit non-canonical adapter results with `canonicalEvidence: null`;
- isolated description: `buildFixturePreview`.

There is no live connect/subscribe API, persistence API, source-registration API, private endpoint, credential/signing path, canonical writer, effect router, or money-path export.

## Focused verification

```sh
node --test --test-concurrency=1 --test-reporter=spec \
  frontier/venue-mesh/tests/venue-mesh.test.mjs \
  frontier/venue-mesh/tests/isolation.test.mjs
```

The preview is separately inspectable with:

```sh
node frontier/venue-mesh/preview/render-preview.mjs
```

No `npm test`, `test:all`, I00, browser ship, integration battery, or live network check belongs to this prestage receipt.
