# F1 VenueMesh state

## Durable state

| Field | Value |
|---|---|
| `buildState` | `PRESTAGE_READY` |
| `disposition` | `ACTIVE` |
| `terminalLabel` | `VENUE_MESH_PRESTAGE_READY` |
| posture | `READ_ONLY`, `UNWIRED`, `FIXTURE_ONLY`, `NO_CREDENTIALS`, `NO_ORDER_AUTHORITY` |
| branch | `f-venue-0715f` |
| immutable accepted Main / `FRONTIER_BASE_SHA` | `f0168cb37bd04d21bc90591ab2256770de3b75bc` |
| accepted F0 Dock SHA | `e0ace68de5d56bdfe51bb30cf74e44c6f109dfd5` |
| prebuild HEAD SHA | `e0ace68de5d56bdfe51bb30cf74e44c6f109dfd5` |
| Dock ancestor check | exact merge base `e0ace68de5d56bdfe51bb30cf74e44c6f109dfd5`; `merge-base --is-ancestor` passed |
| directive SHA-256 | `4bb325b23c70e56103ee1553f0ea4396774ce0950d7abc9c73faa01f7006e1ad` |
| descriptor hash | `e77a215486fc559f65261f24ab3138a48757d10fcbe4629eae54d02d36e2a1cd` |
| focused verification | `50/50 PASS`, zero skipped/todo |
| full-repository/integration verification | intentionally not run |

The descriptor’s `immutableBaseSha` records accepted Main, while `sourceSha` records the prebuild Dock/branch HEAD. The exact final seal commit is the Git commit containing this state and is resolved with `git rev-parse HEAD` in the post-commit handoff; a file cannot embed the SHA of its own containing commit.

## Ownership adjudication

Disposition is `ACTIVE`, not `ALREADY_OWNED` and not `BLOCKED_OWNER_MOVING`.

- canonical F1 scout: commit `86b41ea0877e4c803854cfbc1a17eddf8e91f04f`, blob `99a250ed68d05fd8db2280a3e94d8bc2e84b3c8a`, raw SHA-256 `39ef993dbde3e79bea6c9983ff5237afdb055b0c2e47925a9ec7f2dddeba670d`, verdict `APPROVED_REAL_DELTA`;
- coordinator release evidence: `887221418345ad54d7b98881b359fab85a6188e6`;
- Q owns `DataSourceCardV1`, evidence admission, point-in-time source governance, and feature values;
- `intelligenceFoundation` owns canonical evidence/features and identity foundations;
- `intelligenceRuntime` owns public acquisition lifecycle, gap/rate/health state;
- `systemIntegration` owns semantic producer uniqueness;
- L owns executable venue/instrument/contract semantics;
- `newsContext` already owns official venue/news/status collectors and must be adapted later, not duplicated.

The implemented delta is limited to additional-venue fixture normalization, explicit venue identity/collision evidence, REST/stream and cross-venue shadow comparison, source-card/terms review materialization, copy-family independence, and point-in-time context fixtures.

## Implemented truth

- Exact local instrument identity describes spot, perpetual, dated-future, and option capabilities without coercing unsupported products into the canonical product enum.
- The BTC-settled Deribit inverse perpetual remains `PARTIAL` with `SETTLEMENT_SEMANTICS_UNSUPPORTED`; it is not coerced to `USDM_PERP` or emitted as canonical-aligned evidence.
- Coinbase/Kraken public fixture adapters produce synthetic `MarketEvidenceEnvelopeV1`; Deribit capability, mark/index/funding/open-interest availability is described while unsupported canonical settlement fails closed.
- Coinbase trade and Kraken depth/checksum fixtures preserve exact decimal strings, event/receive clocks, source lineage, and missing numeric sequence semantics.
- Deribit mark/index/funding/open-interest inventory is never silently dropped: the inherited inverse-settlement mismatch produces four explicit unavailable observations.
- Freshness is recomputed at each health/comparison evaluation from an injected as-of clock and explicit per-venue bounds; stored freshness labels cannot stay green indefinitely.
- Sequence gap, overlap, reconnect, and resnapshot states are explicit. No numeric sequence is invented for stateless fixtures.
- REST/stream disagreement requires explicit REST and STREAM fixture path classes, preserves both path/source provenances, selects no winner, and fabricates no average.
- Cross-venue comparison binds each evidence leg to its identity and requires same canonical asset/product/quote semantics, per-venue freshness, complete/gap-free evidence, source eligibility, explicit costs, and executable-depth fixture inputs.
- Leadership requires distinct venues, one instrument identity, same move direction, fresh/eligible sources, and makes no causal or profitability claim.
- All three researched source cards are `REFERENCE_ONLY`; retention and redistribution remain `REVIEW_REQUIRED` and terms revision/expiry invalidates fixture eligibility.
- Licensed context can be evaluated only from a full source-card envelope re-reviewed at the information cutoff and bound to the graph source/origin. Two-field review assertions cannot admit evidence.
- Mirrors/copies/shared origins collapse into one evidence family; non-primary sources require a real copy edge and unknown origin contributes zero confirmation weight.
- Proved-missing context classes stay `UNAVAILABLE_NOT_ADMITTED`, `REFERENCE_ONLY`, or `ALREADY_OWNED_ADAPTER_REQUIRED`.
- Evidence, context, derived output, and preview boundaries reject effect-shaped or authority-widening fields.
- Dock maps are identity-only maps from exact `MarketEvidenceEnvelopeV1` and Q `FeatureValueV1` roots to those same canonical contracts. They cover real runtime materializations, preserve exact units/times/unknowns, and leave `unsupportedFields: []`; explanatory wrappers are not mislabeled as canonical types.
- Missing bid/ask becomes an explicit unavailable observation with null value; missing depth remains a partial envelope and comparison output stays `UNKNOWN`.
- Source-health projection preserves extension evidence ID, availability, sequence, freshness, completeness, state, and reasons while mapping every unwired fixture to canonical `STOPPED/UNKNOWN` without writing canonical health.
- The deterministic resource proof accepts 50 events per 1000 ms fixture window at queue depth 8 with zero network/model use and fails closed beyond the envelope.

## Verification state

Focused command:

```sh
node --test --test-concurrency=1 --test-reporter=spec \
  frontier/venue-mesh/tests/venue-mesh.test.mjs \
  frontier/venue-mesh/tests/isolation.test.mjs
```

Latest result before seal: `50 tests`, `50 pass`, `0 fail`, `0 skipped`, `0 todo`.

The hostile corpus names the exact 17 Section 4.4 cases and binds each label to an executed test. Additional defenses cover stale-label aging, path-class provenance, evidence/identity leg mismatch, inverse-settlement coercion, exact payload inventories, effect-shaped evidence/context/derived output, canonical-root adapter materialization, unavailable adaptation, source-card cutoff/origin binding, sequence corpus/provenance, leadership identity/direction/eligibility, schema change, exact decimals, source-copy cycles/orphans, Dock facet crossing, closed transport, and resource-envelope breach.

## Honest limitations

- No live network, WebSocket, REST call, subscription, reconnect loop, key, signature, private endpoint, or credential path exists.
- No source is admitted, registered, retained, redistributed, cached, or persisted.
- No canonical source, evidence, feature registry, health, checkpoint, cockpit, or product state is written.
- No deposit, withdrawal, transfer, borrow/repay, order, leverage, margin, execution, or money-path capability exists.
- No F1 `COCKPIT_PROJECTION` facet exists; the preview is isolated JSON only.
- No production isolation, mounted lifecycle, restart, removal, deployment, latency, capacity, executability, edge, trade-readiness, or profitability proof is claimed.
- Dated futures/options and inverse/unsupported perpetual settlement can be described locally but cannot enter the inherited canonical product contract without an owner-approved insertion.

Future shared work is requested only in `INSERTION.md` and `contracts/v1/insertion-request.v1.json`.
