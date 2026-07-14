# D0010 — L06 durable journal and idempotency policy

Status: `ACCEPTED_FOR_LANE_L06`

Date: `2026-07-12`

Authority: deterministic construction, validation, reduction and replay of
injected mutation-journal evidence only. This decision grants no Ledger write,
database, outbox, ticket, execution, reconciliation, signer, private-read,
transport, send, retry or external-action authority.

## Controlling inputs

- Accepted L05 implementation:
  `24f4e43eeca0f5d137edb95882c3a900871e2a70`
- Accepted L05 receipt:
  `live-edge-receipts/RECEIPTS/L05.md`
- Accepted matrix revision: `L02-BINANCE-2026-07-12`
- Accepted matrix SHA-256:
  `7302b7f5f90bb8f08791d07a2718adb1ca77a54d7e01f5a76079380c96cddbac`
- Frozen protocol SHA: `73e1a1ff7daa48df8dac45713fc5f106842edafc`
- D-LAUNCH-2 continuous-run authority:
  `84d2ff65fd8d2b200821126dd17b4ba75f3c131c`
- `ARCHITECTURE.md` Part II canonical Ledger, Foundation execution/
  reconciliation and System Integration persistence map

Current public documentation was rechecked on 2026-07-13. The pinned official
Binance source commit `31643ed390e2aa450ce872981556186acf96a195`
matched the upstream `master` tip at verification time. No Binance endpoint,
private account, credential, signed operation, listen key, socket, database
mutation, deployment or process was called.

## Current official source findings

### Binance

- Spot general REST information:
  `https://developers.binance.com/en/docs/products/spot/rest-api`
- Spot order query:
  `https://developers.binance.com/en/docs/catalog/core-trading-spot-trading/api/rest-api/account#query-order-user_data`
- USD-M order query:
  `https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/trade#query-order-user_data`
- Margin order query:
  `https://developers.binance.com/en/docs/catalog/core-trading-margin-trading/api/rest-api/trade#query-margin-accounts-order-user_data`

The current Spot general page explicitly says a matching-engine timeout means
send and execution status are unknown, not failed. When no user-stream status
appears, the documented next step is an order-status query. Spot 5xx responses
also retain unknown execution status. Spot 409 can mean cancel-replace only
partially succeeded, so a single response cannot be collapsed to success or
failure.

Spot query order requires `symbol` and either `orderId` or
`origClientOrderId`. If both IDs are supplied, the venue checks their
relationship rather than treating them as interchangeable. USD-M and Margin
also expose exact signed per-order query contracts accepting an exchange order
ID or original client order ID. These are read/reconciliation contracts, not
permission to query.

USD-M documents bounded order-query retention: an unfilled canceled/expired
order may disappear after three days and any order after 90 days. Therefore
query-not-found alone is not universal proof that a mutation never existed.
Margin query truth additionally binds Cross/Isolated mode and symbol; a Cross
query cannot reconcile an Isolated action or vice versa.

The accepted L02 matrix remains controlling for exact routes, realms and
conflicts. L06 neither restores obsolete routes nor constructs a signed query.

### SQLite and canonical Ledger

- SQLite transactions:
  `https://www.sqlite.org/lang_transaction.html`
- SQLite WAL:
  `https://www.sqlite.org/wal.html`
- SQLite atomic commit:
  `https://www.sqlite.org/atomiccommit.html`
- SQLite transactional guarantee:
  `https://www.sqlite.org/transactional.html`

SQLite supplies atomic transactions; WAL commits become visible through a
commit record and there is one writer at a time. These guarantees do not by
themselves create application-level expected-version compare-and-append.

The existing `Ledger.setConfigValueAndLogEvent` atomically commits a config
value and audit event. `SystemLedgerPersistenceAdapter.applyIdempotentTransition`
adds restart-stable idempotency receipts, request-digest conflict rejection,
bounded canonical data, checkpoint revision validation and post-commit
readback. This is the strongest existing seam and remains canonical.

It does not provide database-level stale-writer compare-and-swap across two
independently loaded persistence adapters: each can prepare the same next
checkpoint revision and the underlying config write is an unconditional
upsert. L06 cannot claim a production persist-before-send gate until the
director supplies the narrow CAS insertion requested in
`live-edge-receipts/patches/L06-canonical-ledger-cas.request.md` and I00 proves
it. The isolated lane therefore uses only injected exact acknowledgements and
remains `UNWIRED`.

## Owner and adapter law

- Existing `Ledger` remains the only database/event owner. L06 creates no
  filesystem, SQLite connection, table, migration, config key, writer,
  singleton or outbox daemon.
- System Integration remains persistence/composition owner. L06 defines a
  closed request/acknowledgement protocol that a later director-owned adapter
  may implement; it never imports or calls the canonical adapter.
- Foundation remains mechanical execution and reconciliation owner. L06
  references its plan/leg/client-order identities and consumes injected owner
  observations; it does not mint a plan, decide a fill or clear ambiguity.
- Capital remains mandate/reservation/capital-evidence owner. Strategy engines
  remain decision/proposal owners. Ledger aliases preserve these owner IDs;
  L06 cannot recompute or replace them.
- L03 remains signed-request identity and ambiguity owner; L04 remains exact
  non-sendable preflight owner; L05 remains private evidence/lifecycle
  comparison owner. L06 binds their exact revisions and does not copy their
  logic.

## Journal and identity law

- One mutation journal is an append-only value projection for a single exact
  Foundation plan/leg/client-order attempt. It is not a trade ticket or owner
  state machine.
- Its identity graph binds correlation, assessment/decision, proposal,
  Capital mandate/reservation, ticket/plan, leg, request and deterministic
  client-order identities plus optional exchange order and trade/fill IDs.
- Product, environment, account realm, contract, symbol, operation, attempt,
  L04 revisions, L05 source/lifecycle/reconciliation revisions, occurrence/
  receipt cuts and sanitized content hashes are immutable binding material.
- Missing exchange IDs remain null/unknown. Cross-product, cross-account,
  Cross/Isolated, plan/leg, client-order and attempt substitution fails closed.
- Exact duplicate observation identity and content is idempotent. Reuse of an
  identity for different content is a conflict. Compatible observations are
  reduced from a canonical content set so event/HTTP arrival order cannot
  regress outcome truth.
- Journal sequence/lineage remains append-order specific. A separate semantic
  outcome revision is order-independent for the same compatible evidence set.
  Neither is an exchange signature or durable proof until the canonical owner
  returns the exact persistence acknowledgement.

## Persist-before-send and replay law

- The prepared `SUBMITTING` intent must be committed by the canonical Ledger
  owner before the synthetic dispatch boundary can be observed.
- An acknowledgement binds owner/schema, mutation and entry identity,
  idempotency key, append/request digest, expected and committed journal
  versions, previous and next lineage/state digests, positive Ledger event ID
  and injected commit time.
- Failed, missing, malformed, partial, stale, conflicting, capacity-exhausted
  or lineage-mismatched acknowledgement grants no synthetic dispatch permit.
- A new exact commit makes the pure synthetic-boundary projection eligible.
  Re-evaluation is deterministic and repeatable; it is not a one-use send
  permit. The compare-and-append request for the one exact
  `SUBMISSION_OBSERVED` record can commit only once, while idempotent replay or
  restart cannot create another record. Any future real dispatcher requires a
  separate director-owned atomic consume/lease contract and authorization.
- Every boundary projection has `sendAuthorized=false` and
  `externalActionAuthorization=NONE`. It is test-only evidence and cannot
  contain a request, endpoint, payload, signer, credential or transport
  callback. L06 performs no send.

## Outcome, ambiguity and reconciliation law

- Requested, persisted, synthetic-dispatch-observed, acknowledged, working,
  partially filled, terminal and reconciled truth remain distinct.
- HTTP success is not a fill. Acknowledgement is not working. Requested
  quantity is not actual fill. A terminal order is not automatically
  reconciled.
- Timeout, disconnect, 408, 5xx, malformed/incomplete post-dispatch response,
  cancel/replace mixed result or persistence degradation after possible effect
  remains `UNKNOWN` or `PARTIAL_MIXED` and requires exact owner reconciliation.
- A non-408 4xx response alone does not let L06 invent exchange no-effect
  proof. `REJECTED_NO_EFFECT_PROVEN` requires an exact injected Foundation
  reconciliation observation bound to the journal and source cut.
- Query-by-deterministic-client-order-ID is a sanitized owner hand-off only.
  Query not-found is not universal absence proof, particularly beyond USD-M
  retention windows.
- Duplicate/out-of-order private events may advance actual observed effect;
  later HTTP evidence cannot regress it. Contradictory venue/order/fill truth
  becomes named conflict/manual recovery, never last-write-wins.
- The L06 adapter consumes a bounded full-result content commitment plus
  the closed canonical fields of an injected Foundation
  `ReconciliationResult` and the exact L05 Foundation reconciliation
  observation. It selects exactly one matching plan/correlation/client-order
  leg and derives the L06 journal projection; callers cannot author an effect.
- The post-action L05 source/product cut is distinct from the immutable
  pre-action cut retained in the journal root. Result evaluation cannot
  predate the prior durable head. Reused result revisions, later weaker owner
  results and same-cut contradictions remain named conflicts.
- Foundation binary64 quantities never replace exact journal money. Only the
  exact non-negative safe-integer intersection may compare locally;
  fractional or non-round-tripping values remain `UNKNOWN` pending
  `patches/L06-foundation-quantity-bridge.request.md`.
- Reconciliation may mark the adapter view `RECONCILED` only from an exact
  current Foundation result binding journal revision, product/account realm,
  client/exchange IDs, current L05 source/product cuts and a complete derived
  effect. L06 still owns no reconciliation verdict and accepts no arbitrary
  external-truth reference list.

## Bounds and provenance

- All inputs are injected closed plain data with bounded depth, nodes, strings,
  fields, observations, fills and journal entries. Proxies, accessors,
  inherited values, symbol keys, cycles, aliases, sparse arrays, unknown fields
  and secret-shaped material fail before hashing.
- Canonical revisions are deterministic comparison identities, not signatures,
  source attestations or external provenance. The canonical Ledger ACK is
  injected in L06 tests; production persistence remains unproven until the
  director integration and I00.
- Journal/telemetry/recording health are distinct. Telemetry or Intelligence
  Runtime recording degradation remains visible but cannot erase money-
  critical ambiguity, reconciliation or recovery evidence.
- L05 Spot/USD-M event revisions are regenerated with the accepted owner
  helpers from realm, generation, event kind, content revision and exact event/
  receipt semantics. The commitments are still injected, deterministic and
  unkeyed: they prove internal comparison integrity, not source authorship or
  a historical anchor.
- Entry and append-request canonical UTF-8 are each bounded to 128 KiB and the
  reconstructed checkpoint is bounded to the canonical System Integration
  512 KiB limit. The final eight entry slots are reserved from telemetry for
  money-critical recovery evidence.

## Section 7 and external boundary

- The unchanged 10-USDT canary is a hard ceiling. L06 may emit a versioned
  evidence candidate for later owner review but cannot promote a rung or alter
  Capital/Risk policy.
- Source exchange/local receive, features, decision, approval, durable intent,
  synthetic submission, acknowledgement and private confirmation milestones
  bind their exact accepted owner/journal cuts. A complete injected chain is
  testable, but no AWS region, account or empirical benchmark is claimed.
- Regime remains advisory through existing owners and cannot authorize a
  mutation.
- Canonical Intelligence Runtime remains recording owner; no duplicate feed or
  store is created.
- No private/account read, credential access, signed/test/live order, query,
  real send, socket, Margin action, capital change, AWS/Cloudflare/Secrets
  mutation, deploy, restart or push is authorized or performed.

`LIVE_EXECUTION_NOT_IMPLEMENTED` remains mechanically enforced.
