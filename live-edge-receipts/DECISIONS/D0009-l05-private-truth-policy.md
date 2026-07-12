# D0009 — L05 private truth and separate lifecycle policy

Status: `ACCEPTED_FOR_LANE_L05`

Date: `2026-07-12`

Authority: deterministic normalization, lifecycle reduction and
canonical-owner hand-off of injected private evidence only. This decision
grants no credential, account-read, signer, socket, scheduler, cache, Capital,
Risk, reconciliation, execution, persistence, deployment or external-action
authority.

## Controlling inputs

- Accepted Binance matrix revision: `L02-BINANCE-2026-07-12`
- Accepted matrix SHA-256:
  `7302b7f5f90bb8f08791d07a2718adb1ca77a54d7e01f5a76079380c96cddbac`
- Frozen protocol SHA: `73e1a1ff7daa48df8dac45713fc5f106842edafc`
- D-LAUNCH-2 continuous-run authority:
  `84d2ff65fd8d2b200821126dd17b4ba75f3c131c`
- Accepted L03 signed-kernel and L04 instrument/filter receipts
- `ARCHITECTURE.md` Part II and the accepted L00 reuse map

Current official documentation was checked on 2026-07-12 using public
documentation and the official Spot documentation repository only. No Binance
API endpoint, private account, user stream, credential or signed operation was
called.

## Current official sources

### Spot

The official Spot documentation repository still resolves to commit
`31643ed390e2aa450ce872981556186acf96a195`. Rechecked source hashes match L02:

- `web-socket-api.md`:
  `c09a1f5c7ebfd111fed79f07e98c3cf0d862d0f3c8d6636b57bd2dac83d09a8d`
- `user-data-stream.md`:
  `3e0fcf4952615981bb6e033c9d968904bad779ccafd970256802857d386671a8`
- `rest-api.md`:
  `49ea6809243fc7fb426e07f2fe662097736c7bb405bd2da5eef637d715427999`
- `CHANGELOG.md`:
  `3c87303c7ba632d7240d34a7271652aaa8a4f5aebe8023eec6ab36a13bd10f8a`
- `web-socket-streams.md`:
  `32bf73a0bed3b75e3ca981fdbaf48c53544bbdfb5944ef8ed1c4d7af9aceba0a`

Primary pages:

- `https://github.com/binance/binance-spot-api-docs/blob/31643ed390e2aa450ce872981556186acf96a195/web-socket-api.md`
- `https://github.com/binance/binance-spot-api-docs/blob/31643ed390e2aa450ce872981556186acf96a195/user-data-stream.md`
- `https://developers.binance.com/en/docs/catalog/core-trading-spot-trading/api/rest-api/account`
- `https://developers.binance.com/en/docs/catalog/core-trading-wallet/api/rest-api/account`
- `https://developers.binance.com/en/docs/products/spot/rest-api`

The selected private mechanism remains
`SPOT_WS_API_USER_DATA_SIGNATURE` on the Spot WebSocket API using HMAC and JSON
text. It is distinct from the current but unselected Ed25519 authenticated-
session method. Signature subscription does not imply a logged-on session.

The connection hard lifetime is 24 hours; there is no selected Spot listen-key
TTL or keepalive. One account has at most one active subscription per
connection, with 1,000 simultaneous and 65,535 lifetime subscriptions.
`userDataStream.unsubscribe` may target one subscription or all, and
`eventStreamTerminated` is not guaranteed for transport loss or the 24-hour
boundary. `session.logout` does not terminate signature subscriptions.

Legacy Spot REST `POST|PUT|DELETE /api/v3/userDataStream` and WS API
`userDataStream.start|ping|stop` are removed. Public market-stream hosts and
the market-data-only host cannot substitute for private user data.

### USD-M

Primary pages:

- `https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/account`
- `https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/trade#position-information-v3`
- `https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/trade`
- `https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/user-data-streams`
- `https://developers.binance.com/en/docs/products/derivatives-trading-usds-futures/user-data-streams`
- `https://developers.binance.com/en/docs/products/derivatives-trading-usds-futures/websocket-market-streams/Connect`
- `https://developers.binance.com/en/docs/products/derivatives-trading-usds-futures/websocket-market-streams/Important-WebSocket-Change-Notice`
- `https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/ws-streams/~schemas`

The exact L02-selected private contract remains the routed `/private` family.
The listen key lasts 60 minutes and the WebSocket connection lasts 24 hours;
these lifetimes are independent. Start/keepalive/close remain separate
API-key-only USER_STREAM operations. The reducer never retains or hashes a
listen-key value.

Current documentation also exposes routed query-raw and combined forms. They
remain separately typed documentary modes and are never heuristic fallbacks.
Unrouted private connections and product/realm substitutions are rejected.

Account V3, balance V3, position-risk V3, current position mode and current
multi-assets mode already have exact L02 records. Current official pages also
document a separate current all-algo-open-orders family, account configuration,
commission rate and income history, but L02 does not contain exact contract
records for them. L05 records those required facts as
`UNAVAILABLE_L02_CONTRACT_GAP`; it does not widen or silently amend the
accepted matrix. Standard open orders cannot fill the algo-order gap. The same
applies to ADL and complete funding/income coverage.

USD-M events have ordering rules within the same event type and use event time
across types, but no global gap-free sequence. `ACCOUNT_UPDATE` is a delta;
omitted assets/positions are unchanged or unknown, never zero. `MARGIN_CALL`
and reduced `TRADE_LITE` are not canonical complete account/order truth.

### Margin

Primary pages:

- `https://developers.binance.com/en/docs/catalog/core-trading-margin-trading/api/rest-api/account`
- `https://developers.binance.com/en/docs/catalog/core-trading-margin-trading/api/rest-api/borrow-repay`
- `https://developers.binance.com/en/docs/catalog/core-trading-margin-trading/api/rest-api/market-data`
- `https://developers.binance.com/en/docs/catalog/core-trading-margin-trading/api/rest-api/user-data-stream`
- `https://developers.binance.com/en/docs/products/margin-trading/risk-data-stream`
- `https://developers.binance.com/en/docs/catalog/core-trading-margin-trading/api/ws-streams/~schemas`
- `https://developers.binance.com/en/docs/products/margin-trading/change-log`
- `https://developers.binance.com/en/docs/products/margin-trading/general-info`

All account, liability, maximum-borrowable, rate and permission truth is private
and signed; L05 obtains none. Cross and isolated account shapes remain
separate. `maxBorrowable.amount`, account `borrowLimit`, system inventory and
rate evidence are independent facts and cannot substitute for one another.

The only current selected-capable stream family in L02 is the Cross Margin
risk stream. It uses a 60-minute risk listen key and a 24-hour connection, has
no sequence/replay cursor and does not cover isolated accounts. Risk events
cannot establish balances, orders, trades, complete liabilities, permissions
or account readiness. Margin account/trading stream selection remains null.

Controlling conflicts remain explicit and blocking:

- maximum-borrowable weight is 50 IP in the catalog versus 750 UID in the
  change log;
- current references still expose Cross Margin Pro-shaped facts after the
  reported Pro/leverage-bracket sunset;
- best-practice prose points to retired `/sapi/v1/userDataStream` routes while
  the current risk lifecycle uses `/sapi/v1/margin/listen-key`;
- inventory `updateTime` contains an unresolved seconds-versus-milliseconds
  example;
- best-practice Cross-account sample uses an isolated-pair shape;
- risk DELETE prose and the current endpoint parameter schema disagree.

No conflict is guessed away. They are accepted L02 gaps that force
`UNAVAILABLE`, `OFFICIAL_DOC_CONFLICT` or `BLOCKED` posture.

## Canonical owner and reuse decisions

- Capital Foundation remains account economics, completeness for allocation,
  reservation and position-policy owner. L05 emits only immutable input
  candidates; it never computes allocatable capital.
- Foundation remains permission-sensitive risk, borrow truth, execution and
  reconciliation owner. L05 may emit exact comparison input and named
  mismatches but cannot choose a canonical reconciliation status or clear
  ambiguity.
- Current Foundation reconciliation quantities are binary64 and plan-specific.
  L05 exact decimal strings are not cast into that dialect. Any later bridge
  requires a director-owned explicit conversion/integration patch.
- System Integration remains cached account-truth port, composition,
  supervisor and API owner. L05 creates no cache, refresh, route or runtime.
- Ledger remains durable-history owner. L05 creates no store or mutation
  journal.
- Legacy `BinanceClient`, `UserStream`, `AccountService`, `LoanService` and the
  dormant USD-M client are not imported. Their response shapes may seed
  independent synthetic fixtures only.
- Capital's exact-decimal leaf and Foundation sourced-time/freshness law are
  reused directly. Source time wins; receipt time is a named fallback only;
  freshness boundaries are inclusive and clocks are injected.
- All inputs remain injected. Normalization, replay and revision regeneration
  establish closed structure and content coherence only; they do not prove
  that Binance or an authorized owner produced the evidence. Private
  acquisition, authentication and provenance remain owner/integration
  responsibilities outside L05.

## Projection and lifecycle law

- Every fact is bound to the accepted matrix SHA, exact contract/product/
  environment/realm, non-secret owner profile/account-realm reference, schema,
  source time, receipt time, content revision and evidence revision.
- Only closed, bounded, plain data is accepted. Proxies, accessors, inherited
  values, cycles, aliases, sparse/named arrays, symbol keys, unknown fields,
  unsafe text, secret-shaped keys and unbounded inputs fail before hashing.
- Exact decimals remain canonical strings. Sign rules are per-field: balances,
  capacities, liabilities and rates are non-negative; signed PnL/net values
  remain signed when the official field permits it. Missing never becomes zero.
- Semantic revisions exclude receipt/evaluation time. Separate evidence and
  projection revisions bind temporal truth and prevent timestamp substitution.
- Permission profiles are distinct `READ_KEY` and `EXECUTION_KEY` owner
  references. A combined profile requires a later owner exception.
- Withdrawals or transfer authority enabled, fixed-IP unknown/false, deployed
  egress mismatch, account/realm mismatch, unsupported modes, abnormal status,
  trading lock or missing product permission blocks later entry. L05 still
  grants no entry or action even when evidence is coherent.
- Spot, USD-M and Margin lifecycle reducers are product-specific. Connected,
  authenticated, subscribed, fresh-event and REST-reconciled states remain
  independent. No generic private-connected readiness exists.
- Streams are timely evidence; fresh signed REST is reconciliation. A stream
  can never extend the freshness of a REST cut.
- Events are deduplicated within product, account realm and connection
  generation. Exact duplicates are ignored and counted; same identity with
  different content conflicts; older events do not replace newer truth.
- No product claims a global gap-free sequence. Reconnect, expiry, termination,
  conflict, unknown event or truncated dedupe coverage requires a fresh later
  owner reconciliation cut.
- Margin risk state is literally risk-only and can only reduce readiness.
- Every output is immutable, non-sendable and carries
  `externalActionAuthorization=NONE`, `actionAuthority=NONE_RECORD_ONLY` and no
  account-read, mutation, reconciliation, Capital or Risk authority.

## Adversarially closed interpretation

The L05 adversarial pass made the following parts of this policy explicit:

- A normalized fact is not a bearer assertion. It retains a bounded sanitized
  `injectedValue` witness, and every projection consumer re-runs the exact
  contract, value-schema, availability and freshness normalization at the
  projection cut. Usability and validity are evidence-revision material.
- Account realm, permission profile and account-fingerprint values are opaque
  references only when they carry their closed namespace. Generic key-shaped
  strings are rejected rather than retained or hashed as identities.
- A private fact may declare at most 300,000 milliseconds of freshness. The
  projection derives its validity from its facts; a waiting binding cannot
  author or extend that deadline.
- Permission facts must match the corresponding read/execution decision
  payload, not merely the profile identifier. An execution profile with read
  permission is a combined profile and remains blocked without a later owner
  exception.
- Current non-permission private facts are bound to the exact reviewed
  `READ_KEY` profile. Spot account truth with trading disabled, a non-Spot
  account type or missing Spot account permission is explicit blocking
  evidence; a syntactically valid account payload never implies readiness.
- Every fact retains a closed query-selector tuple: account-wide, all-symbols
  or exact-symbol scope plus nullable symbol, asset, query-type and Margin-mode
  selectors. Symbol-required trade/commission facts and symbol-filtered order
  facts must match the projection's exact L04-form target symbol, including
  empty results; mixed or retagged response rows fail closed. Margin isolated
  orders, rate-asset and inventory-type selectors are independently bound.
  Margin inventory `queryType` is closed to exact `MARGIN` or `ISOLATED`, and
  order/trade fact mode must agree with the reviewed permission-profile mode;
  isolated or unknown mode remains explicitly blocking under current law.
- Null-contract gap/conflict facts remain account-wide documentary blockers
  with no selectors. In particular, the USD-M algo-open-orders and
  symbol-configuration gaps cannot masquerade as standard-order or
  symbol-scoped truth. Scope, selectors and target symbol are content,
  evidence, source-cut and projection-revision material.
- A deterministic private source-cut revision is regenerated from the full
  fact and permission witnesses. A Foundation reconciliation observation must
  cite that exact cut and carries a closed per-product map of the Spot and
  USD-M owner REST-cut revisions it reconciled. The map is evidence supplied by
  the existing Foundation owner; L05 neither mints nor decides reconciliation.
- The current separate USD-M algo-order family is recorded as
  `UNAVAILABLE_L02_CONTRACT_GAP_USDM_ALGO_OPEN_ORDERS`; the accepted L02
  standard `/openOrders` contract cannot prove product-wide conditional-order
  absence. Current USD-M account configuration is recorded separately as
  `UNAVAILABLE_L02_CONTRACT_GAP_USDM_ACCOUNT_CONFIGURATION`, while symbol-level
  leverage/margin-type truth is recorded as
  `UNAVAILABLE_L02_CONTRACT_GAP_USDM_SYMBOL_CONFIGURATION`; current Margin
  borrow/repay history is recorded as
  `OFFICIAL_DOC_CONFLICT_MARGIN_BORROW_REPAY_HISTORY_PARAMETERS`. None of these
  gaps may be omitted or filled from an adjacent contract.
- Spot, USD-M and Margin event identities bind account realm, connection
  generation, event kind, sanitized content revision and applicable exchange,
  transaction and receipt times. Exact identity-plus-content replay is counted
  as a duplicate; the same base identity with different content is a conflict;
  stale-generation evidence is classified separately; retention eviction
  reports coverage loss. Spot and USD-M generation transitions fence old state
  and allow recovery only from fresh current-generation evidence and an exact
  owner cut.
- Every Spot, USD-M and Margin lifecycle state and observation is fenced by a
  validated namespaced account-realm reference. Product validators reconstruct
  the supplied closed immutable state and reject cross-account substitution,
  detached summary fields and supplied commitments that do not match canonical
  content. This proves internal coherence of the presented state, not source
  authorship or historical continuity.
- Product-specific validators also enforce internally coherent lease,
  connection, event-marker and owner-REST timelines. Spot and USD-M connection
  lifetimes are exclusive at the documented hard boundary, planned reconnect
  posture is derived from injected time, and future/detached/cross-generation
  lifecycle evidence cannot produce an owner-comparison-ready witness.
- Waiting consumes full regenerated lifecycle witnesses, not caller-authored
  revision strings. Each witness binds the accepted matrix, product, realm,
  account realm, documentary source identity, complete state-content digest,
  evaluation cut, validity and derived comparison posture; the waiting binding
  retains only the resulting canonical lifecycle revisions.
- USD-M event semantics are mapped from the closed official discriminants:
  `ACCOUNT_UPDATE`, `ORDER_TRADE_UPDATE` plus its execution type, and
  `TRADE_LITE`. Distinct last-account, last-order and last-fill markers remain
  visible; an order update is a fill only when its exact execution type is
  `TRADE`, and no marker implies complete account truth.
- A private projection is accepted by waiting or hand-off only after complete
  canonical regeneration from its witnesses. Summary fields and caller-authored
  revisions alone carry no truth.
- The canonical waiting binding is an immutable content comparison with
  `persistenceProven=false`; only the existing Ledger/integration owners may
  prove durable workflow history. `CURRENT_NON_SENDABLE` never means persisted,
  reconciled, sendable or authorized.
- Query completeness is a first-class, revision-bound witness rather than an
  inference from a successful response. Spot account truth requires exact
  `omitZeroBalances=false`. Trade histories require an explicit closed time
  window, the endpoint's exact maximum limit and a terminal short page;
  default, cursor and full-page responses remain partial. Margin interest
  requires exact Cross/Isolated selectors, page 1, size 100 and total-row
  closure; Margin rate requires its exact asset, explicit time window and no
  alternate VIP selector. The fact source cut must equal the historical
  coverage end, and retained row times must lie inside that cut.
- Current Spot open-order normalization admits only the closed documented
  optional conditional-field vocabulary and validates its relational
  presence. A `PENDING_NEW` order cannot claim working book placement. Margin
  `myTrades` preserves only the current official response fields and neither
  requires nor derives an undocumented `quoteQty`. Margin interest preserves
  `asset` and `rawAsset` independently, closes `type` to the five documented
  values, and treats a missing `rawAsset` as explicit blocking unknown. Margin
  Cross account creation, borrow and trade capability are independent
  operational blockers, and inventory/interest selectors must match the
  reviewed Margin mode.
- USD-M open orders admit only `NEW` or `PARTIALLY_FILLED`; Margin open orders
  admit only `NEW`, `PENDING_NEW` or `PARTIALLY_FILLED`, with `PENDING_NEW`
  forbidden from claiming working-book placement. Their closed order,
  time-in-force, side, trigger, protection and conditional-field relationships
  are validated rather than accepted as arbitrary venue text. The USD-M
  position-mode fact must match both reviewed permission profiles and all
  side-bearing account-position, position, open-order and trade rows: one-way
  mode requires `BOTH`, while dual-side mode forbids `BOTH` and remains
  explicitly unsupported for entry.
- Caller-authored generic revisions are not owner identity. Fact schemas are
  closed per fact kind, receipt references use `private-receipt:<24hex>`,
  Foundation results use
  `foundation-reconciliation-result:<24-64hex>`, foreign evidence uses a
  closed product-kind namespace, and L04/L05 waiting inputs must use their
  exact semantic/evidence/snapshot/projection/permission/lifecycle/source-cut
  namespaces. Bare bearer-shaped alphanumeric values and expanded credential,
  token, password, passphrase, mnemonic and seed fields/text are rejected
  before retention or hashing. Internal graph helpers are not public barrel
  exports.
- Spot owner REST evidence cannot exceed 300,000 milliseconds and planned
  Spot/USD-M reconnect deadlines cap lifecycle witness validity exclusively.
  Waiting decisions re-run the complete lifecycle/projection binding on every
  comparison. Spot and USD-M validators replay retained markers and regenerate
  canonical full-state commitments; Margin replay and the lifecycle binding
  likewise regenerate content-bound identities over the supplied state. These
  checks reject stale, partial or internally incoherent edits, reordered
  presented evidence, cleared degradation and explicit or capacity-reached
  truncation. The commitments are deterministic unkeyed SHA-256 comparison
  identifiers, not keyed signatures, exchange/source attestations, durable
  history or externally persisted previous-state anchors. A caller that
  replaces the entire supplied state with another separately coherent history
  can produce a different valid commitment; only the existing Ledger/System
  Integration owners may anchor lineage and continuity. L05 creates no such
  anchor.
- Receipt causality is independent of source-age freshness. The fixed
  2,000-millisecond tolerance is only a source/receipt and embedded-timestamp
  clock-plausibility rule; it never makes a fact available before
  `receivedAtMs`, or a projection, lifecycle witness, prior binding or decision
  available before its exact local evaluation/observation cut. Current embedded
  response timestamps are checked against source, receipt and evaluation cuts
  when present; receipt fallback remains contract-specific, and Margin
  inventory `updateTime` remains excluded because its accepted
  seconds-versus-milliseconds conflict prevents a truthful unit interpretation.
  Source time remains the age authority; causal impossibility never becomes a
  fresh fact.
- Historical coverage is contract-specific: Spot trades are at most 24 hours,
  USD-M trades at most seven days and within the documented six-calendar-month
  range, Margin trades strictly less than 24 hours, Margin interest at most 30
  days, and the documentary calendar-month Margin rate limit is conservatively
  capped at 30 days. A caller-selected window cannot establish posture
  completeness by itself. Every required history fact must match an injected
  Foundation reconciliation history-coverage requirement bound to exact realm,
  posture, target, fact evidence, source cut and window. Missing, duplicate,
  extra or mismatched requirements block and grant no owner authority to L05.
- Spot open-order truth admits only active official statuses, closed current
  order/TIF/STP/SOR/peg enums, exact conditional field relationships and the
  documented strategy/peg numeric bounds. Terminal-only prevented/expiry
  fields do not appear in the open-order contract. Spot, USD-M and Margin
  client-order identities use the exact 36-character Binance grammar rather
  than arbitrary text and cannot retain AWS access-key-shaped identifiers.
- Spot/USD-M owner REST cuts and Spot retained private-event markers carry the
  exact account realm and must match their enclosing state. A top-level realm
  retag cannot preserve validity; event and owner-cut revision payloads also
  carry deterministic realm tags so a coherent nested retag cannot reuse the
  old evidence identity. Lifecycle witness evaluation cannot precede canonical
  state observation, a reconnect-due state is blocking regardless of skew
  tolerance, and Spot integrity/reconnect posture is reproducible from retained
  continuity evidence rather than caller-authored flags. Untruncated Spot
  markers are replayed in retained order with exact observation accounting.
  A genuine USD-M lease-expiry or connection-generation transition fences and
  resets the old generation so fresh current-generation evidence and owner cut
  can recover without silently carrying old dedupe coverage.
- Required new-exposure open-order truth is account-wide for Spot, USD-M and
  Margin. Symbol-scoped open-order evidence remains an exact comparison input
  but cannot complete a product or hide foreign/manual orders on other symbols.

## Bounded policy

L05 rejects rather than truncates required REST facts. Default outer bounds:

- graph depth 12;
- 250,000 nodes;
- 4 MiB aggregate string units;
- 512 characters per ordinary value and 256 per key;
- 128 keys per object;
- 64 source facts;
- 2,048 assets, positions or liabilities per fact;
- 4,096 orders;
- 8,192 trades, income rows or stream-event identities;
- 256 mismatch reasons.

Smaller product/schema-specific bounds may apply. A bounded dedupe window that
evicts prior coverage must report truncation and cannot preserve completeness
without a later exact owner reconciliation cut.

## Section 7 and external boundary

- The fixed 10-USDT canary remains unchanged. Private evidence may block or
  support later owner review; it cannot increase capital, leverage or size.
- Event-to-private-confirmation latency accepts injected evidence only and
  remains synthetic/unobserved until separately authorized runtime proof.
- Regime posture remains advisory through existing Strategy/Capital/Risk and
  has no private-truth-to-order path.
- Recording remains owned by Intelligence Runtime and independent of private
  reconciliation/recovery.
- No private/account read, credential access, signed/test/live order, Margin
  action, capital change, AWS/Cloudflare/Secrets mutation, deploy, restart or
  push is authorized or performed.

`LIVE_EXECUTION_NOT_IMPLEMENTED` remains mechanically enforced.
