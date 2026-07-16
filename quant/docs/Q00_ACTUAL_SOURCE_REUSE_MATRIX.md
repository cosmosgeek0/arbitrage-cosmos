# Q00 actual-source and reuse matrix

Measured 2026-07-12 in `/Users/cosmosgeek/Desktop/quant-edge-research-20260712`. This is a read map, not a new authority map.

## Git, base, and protocol proof

| Fact | Verified value | Evidence |
| --- | --- | --- |
| Repository origin | `git@github.com:cosmosgeek0/arbitrage-cosmos.git` | `git remote -v`; only `origin` exists |
| Q worktree / branch | current worktree / `quant-edge-research-factory-20260712` | `pwd`; `git branch --show-current` |
| Q HEAD / protocol | `73e1a1ff7daa48df8dac45713fc5f106842edafc` | `git rev-parse HEAD` |
| Canonical base | `7010499170e24b31c9c0be2c9d73a536e680c6fe` | `git merge-base 7010499 HEAD`; direct parent of protocol commit |
| Parent tree / base tree | `165a6fa46ebe124e7ddc5002fb1c5794ff4e2264` / `fc3c95b1e9ef7705c72a3ebe9365a5a838279ac4` | `git rev-parse HEAD^{tree}` and `7010499^{tree}` |
| Required ancestry | audit, organs, convergence, docs freeze, base, protocol all present | `git merge-base --is-ancestor` for `b272049`, `c4ae7a9`, `87af782`, `b58e64e`, `8069f9b`, `7010499`, `73e1a1f` |
| Protocol conformance | `22/22`, exit 0 | `node packages/edge-protocol-tests/protocol.test.mjs` |
| Frozen protocol diff | empty | diff from `73e1a1f` over protocol paths and lock |
| Pre-Q00 baseline dirt | only two preserved owner directives, untracked | `git status --short --branch` before Q00 artifacts were authored |

The director-owned `current-main` has advanced after lane launch. That does not change this frozen lane base and is not an invitation to merge, rebase, or write Main.

## Resolved controlling paths

| Directive concept | Current source | Identity | Disposition |
| --- | --- | --- | --- |
| Mission | `MISSION.md` | blob `239f0f938360e73e5b30d385acbf77b5d1a9a364`; SHA-256 `95e152d76844aa391b7a28bd45548d7fe58f83ed1ced558dbdbeb01797436362` | controlling |
| System Authority Map | `ARCHITECTURE.md` Part II | blob `93d7604599b43109eb67433e85101009c3f82b8e`; SHA-256 `beb8be8baefe2faa78356e2dc44983735b855535c21cd5f0172a8e1e3fa665db` | controlling |
| Live Product Authority Map | `ARCHITECTURE.md` Part II plus canonical source and accepted receipts | same architecture identity | controlling concept; no separate file |
| Product state | `STATE.md` | blob `0f0a8418a3b14f192e916bcbc47ddd86b998d777` | read-only product truth |
| Historical authority/directives | `docs/archive/**` | Git history | evidence only |
| Frozen protocol | `EDGE_PROTOCOL_V1.md` and protocol schema/fixtures | protocol blob `d0dd07ac…`; schema blob `a23c5796…` | director-owned, read-only |
| Q lane state | `quant/QUANT_EDGE_BUILD_STATE.md` | Q-owned generation | lane truth only; never product truth |

Retired names are not recreated: `project_sources/01-MISSION-2-.md`, root `SYSTEM_AUTHORITY_MAP.md`, root `LIVE_PRODUCT_AUTHORITY_MAP.md`, `server/src/liveIntelligence/**`, `server/src/capitalSupervision/**`, and `DIRECTOR_VERDICT_GAP_AUDIT.md`.

## Canonical type and import map

| Concern | Existing owner / concrete contract | Q use and loss behavior | Proving evidence |
| --- | --- | --- | --- |
| Q/L interchange | frozen JSON Schema definitions: `MarketEvidenceEnvelopeV1`, `EdgeAssessmentEnvelopeV1`, `EdgeOutcomeEnvelopeV1`, `EdgeFeedbackEnvelopeV1`, `EdgeBrainHealthV1`, `ProtocolErrorV1`, `EconomicAssumptionContextV1` | generate or validate from the schema; exact version dispatch; decimal strings; unknown economics abstain; never hand-widen | protocol schema, fixtures, 22/22 conformance |
| Time/freshness | `server/src/foundation/contracts/time.ts`: `SourcedTimestamp`, `isValidUtcMillis`, `evaluateFreshness` | retain exchange/source, transaction, receive, normalization, cutoff, and evaluation times separately; absent source time remains null | Foundation contract tests; Architecture II time law |
| Authority/completeness | Foundation `DataAuthority`; MI `SourceAuthority`; Runtime `RuntimeAuthority` | never cross-cast same-looking enums; only conservative directional adapters | Architecture II authority table and integration contract tests |
| Stable identity | Foundation identity helpers; MI `canonicalJson`, `stableId`, `stableSetId`; engine IDs opaque | Q may own dataset/feature/model IDs; retain engine and correlation IDs byte-for-byte; declare hash algorithm | identity and import-purity tests |
| Boundary failures | Foundation `StructuredFailure`/`ContractResult`; frozen `ProtocolErrorV1` | bounded typed translation; retain origin sidecar; no free-form exception crosses the seam | Foundation failure contracts and protocol tests |
| Instrument/universe | physical `MarketEngine`; Runtime `BinancePublicUniverseAdapter`/`RuntimeUniverseSnapshot`; MI `buildUniverseGraph` | current identity/filter source only; Q historical master adds validity intervals and hashes, never infers history from today | runtime universe tests; MI universe tests |
| Public production acquisition | `MarketEngine`, `BasisRuntime`, `VolumeRuntime`; semantic owner `intelligenceRuntime` | consume normalized append-only capture; never open a competing production socket, broad poller, cache, or snapshot loop | Architecture II source registry; runtime source tests |
| Source catalog/semantics | MI `BINANCE_SOURCE_FACTS`/`getBinanceSourceFact`; Runtime `RUNTIME_ENDPOINTS`, `createRuntimeSourceId`, `sourceDefinition`, derivatives source catalog | reuse source IDs, endpoint classes, timestamp/sequence and sampling semantics; Q source cards add research lineage only | source-catalog and derivatives tests |
| Evidence normalization | MI `normalizeTrade`, `normalizeBookTicker`, `normalizeDepth`, `normalizeMarkPrice`, `normalizeFunding`, `normalizeOpenInterest`, `normalizeLiquidation`, `normalizeBorrow`, `normalizeContext` | historical adapters preserve equivalent provenance; Q does not replace operational normalization | MI evidence suites |
| Local books | Runtime `SpotBroadReducer`, `FuturesRuntimeAdapter`, `LocalOrderBookReducer`, depth/slippage metrics | offline/reference reconstruction and parity only; runtime owns live resnapshot; Spot and USD-M algorithms stay distinct | runtime book, Spot, Futures tests |
| Baseline/history seam | Runtime `BaselineBootstrapScheduler`, `parseCompletedKlinePage`, injected `HistoryPort`/`BaselineSink` | reuse completion, rate-budget, listing-state and checkpoint laws; Q archive lake is not a runtime cache | runtime baseline suites |
| Operational evidence/features | MI `MarketFeatureBank`, `FeatureValue`, `buildBaseline`, derived truth | research features/models are versioned second opinions; they do not replace MI evidence or engine features | intelligence suites |
| Attention/focus | MI attention planner and hint ports; Runtime `FocusSubscriptionAllocator` | Q may recommend `WATCH`/`FOCUS`; only owners allocate feeds/resources | attention/focus tests |
| Thesis/forensics | MI thesis classifier/builder and false-positive forensics | retain owner evidence; Q exit-liquidity work remains a calibrated challenger | thesis/forensics tests |
| Pre/post capture | Runtime `LiveOutcomeCaptureCoordinator`, capture records/completeness/checksums, injected storage port | forward Event Atlas consumes owner capture; no parallel production capture manager | runtime capture suites |
| Objective outcomes | MI `freezePreEvent`, `attributeOutcome`, reducers/cohorts; Foundation proposal outcomes | Q labels reference immutable projections; owner annotation is a separate weak-supervision channel | outcome and replay tests |
| Replay | Foundation deterministic clock and pre/post replay capture | reuse no-look-ahead, stable ordering and integrity laws; no operational replay/ledger ownership | Foundation replay suites |
| Basis strategy | `BasisEngine`, scanner, edge, borrow preflight, proposal store, `BasisRuntime.integrationSnapshot()` | consume evidence/proposals read-only; never score or lifecycle a Basis proposal | `server/test/engine-basis.mjs`, 107/107 |
| Volume strategy | `VolumeEngine`, detector, `FocusManager`, proposal store, runtime snapshot | consume hints/proposals read-only; never create wakeup confidence or a proposal queue | `server/test/engine-volume.mjs`, 124/124 |
| Cross-engine read | Foundation `CanonicalOpportunity` and canonicalizers; integration engine capture | preserve source-local ranks and exact source records; never make a universal strategy score | read-model and adapter suites |
| Capital/risk/execution | `capitalFoundation/**`, `evaluateMultiLegRisk`, Foundation execution/reconciliation | assumptions only; final economics, allocation, approval, risk, execution and reconciliation remain outside Q | capital/foundation/integration suites |
| Operational durability | `Ledger` and `systemIntegration/persistence/**` | Q lake holds high-rate research evidence; operational decisions, controls, fills and outcomes stay in SQLite | storage/persistence/restart suites |
| Supervisor/health | integration source registry, probes and supervisor projection | Q emits bounded health envelope only; no runtime supervisor or producer authority | supervisor and security suites |

Protocol caveat: JSON Schema alone does not enforce every semantic law. Payload-like opaque objects remain intentionally open, and the conformance harness separately enforces byte limits, forbidden keys, exact schema dispatch, canonicalization, advisory actions, and unknown-economics abstention. Q boundary tests must keep those laws; schema changes require a director request.

## Current evidence availability

| Evidence | State | Truthful use |
| --- | --- | --- |
| Historical quant lake / manifests | `MISSING` | Q02–Q03 additive work |
| Point-in-time historical instrument master | `MISSING` | Q02 additive work; current universe is not a substitute |
| Retained Parquet/CSV/JSONL research dataset in checkout | `MISSING` | no model or label claim possible yet |
| Frozen protocol fixtures | `SYNTHETIC_ONLY` | contract tests, not market research |
| Runtime/MI/engine/integration fixtures | `SYNTHETIC_ONLY` | deterministic adapter and failure proofs |
| 2026-07-11 15-second public smoke receipt | historical evidence only | source feasibility/semantics; not a retained dataset or throughput benchmark |
| Current canonical forward capture bridge to Q | `MISSING` | integration seam required before forward atlas ingestion |
| Public archive | `NOT_CONFIGURED` | Q03 may fetch public files with checksum, revision, license, schema and coverage manifests |
| Historical full L2 with local receive clocks | `MISSING` | algorithms requiring it remain `BLOCKED_DATA` or optional paid-source work |
| Reverse-basis account borrow truth | `UNAVAILABLE` to Q | only sanitized owner projection may inform research; never use private clients |
| External announcements/on-chain/cross-venue evidence | `NOT_CONFIGURED` | source-card gate before any narrow experiment |

## Exact gap/reuse matrix and phase routing

| Additive gap | Reuse boundary | Planned phase | Duplicate explicitly forbidden |
| --- | --- | --- | --- |
| Deterministic pinned quant package | frozen protocol/schema; no shared manifest edits | Q01 | protocol semantic copy; product package mutation |
| Edge/Hypothesis portfolio and registry | mission hypotheses and engine owners as references | Q01 | declaration that edge exists; strategy owner |
| Immutable lake/manifests/source cards | canonical normalized evidence and source IDs | Q02 | runtime cache, ledger, public producer |
| Point-in-time instrument master | current universe owner as forward input only | Q02 | second current universe authority |
| Two-tier Event Atlas | public checksum archives plus canonical forward capture | Q03–Q05 | capture manager, detector, objective-label overwrite |
| Local book research replay | Runtime product-specific sequence laws | Q04 | live resnapshot/poller/socket owner |
| Objective labels and matched controls | MI freeze/outcome semantics and immutable owner projections | Q05 | operational outcome authority |
| Separate owner annotations | objective label IDs only, with visibility/blinding facts | Q02/Q05 | label mutation or order authority |
| Research features/models/calibration | MI evidence/features read-only; protocol assessment output | Q06–Q15 | engine scoring, proposal, capital or risk owner |
| Local bounded inference/generated kit | frozen protocol and later director integration | Q16 | public listener, shared schema edit, direct engine wiring |
| End-to-end evidence proof | all above, still advisory | Q17 | execution or profitability claim from fixtures |

## Adversarial duplication traps

1. Never treat UI `BookStreamHub` as broad depth authority.
2. Never treat archive `bookDepth` directory presence as a documented full-L2 contract.
3. Never convert missing source time, liquidation silence, missing files, or borrow truth to zero.
4. Never compare Spot and USD-M sequence, aggregation, RPI, or timestamp semantics through one generic decoder.
5. Never reuse engine `newCorrelationId` as a deterministic dataset identity.
6. Never mix SHA-256 capture checksums, Foundation replay hashes, and protocol content hashes without naming the algorithm.
7. Never call a heuristic `P(bait)` or similar until target and calibration tests justify probability semantics.
8. Never let owner annotations overwrite objective labels or leak later outcomes into the visible-at-tag evidence.
9. Never import signed/private account, loan, order, transfer, withdrawal, or dormant test-order boundaries.
10. Never use archived authority docs as current law.
