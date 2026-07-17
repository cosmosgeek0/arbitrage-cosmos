# PORT A5 prestage receipt

## Verdict

The sealed A5 adversarial campaign and A5X gap classification were rebuilt
against the assigned landed tree, reconciled to accepted owners, kept inside
the four ratified A5 namespaces, and re-accepted under an operating-system
deny of all network access.

`PORT_A5_READY`

This is the real port-phase receipt. The archived `SHADOW_SPECULATIVE`
receipts preserve source lineage only; they do not substitute for the landed
owner conformance and post-port verification recorded here.

## Immutable identity and lineage

| Fact | Exact value |
| --- | --- |
| Branch | `port-a5-20260716` |
| Assigned landed base | `492e3f69b054c85686bcfc4c09dbff4ababeda3f` |
| Implementation commit | `3d84e48b49c27fa0c906f7645bdc527a39e09f3e` |
| Implementation tree | `08044f5d155546850a3401db2517b0256a1d27b7` |
| Implementation parent | `492e3f69b054c85686bcfc4c09dbff4ababeda3f` |
| A5 shadow base | `03857dcdaff8d8b12627d27ddcc97505da1f2f86` |
| A5 shadow implementation | `0adb10adb9870a76a4dc45b39d2c288c960576f0` |
| Sealed A5 source receipt commit | `e0411ea0ffca947d2879baf2dc7eb0b834e515c1` |
| Sealed A5X extension commit | `e8e005edff82dd752e949a275a0aff571fc19ef8` |
| Canonical AIOPS-IR registry commit | `08e0beaa54c4c3ca9c24276785d6a302f751a226` |
| Collision-map Git blob | `5f76b29a81b6af4eee7a156afc16979fea02635e` |
| Insertion-row schema Git blob | `042456c58b1cd5b6eb179c0c9c289f6e69d06034` |
| Implementation path count | `27` |
| Sorted implementation path-set SHA-256 | `fb9e5ba4e38d262bd1c19cf7ee95867f790bdd336c7f90cf09e77b4e1034ed27` |
| Implementation diff size | `27 files changed, 6428 insertions` |
| Receipt authored | `2026-07-16T08:43:38Z` |

The implementation commit is a direct child of the assigned base. No rebase,
merge, push, ref update, or other-worktree mutation was performed.

The archived source receipts remain byte-identical to the sealed objects:

| Archived receipt | Git blob | SHA-256 |
| --- | --- | --- |
| `shadow/A5_SHADOW_ARTIFACT_RECEIPT.md` | `059160d4e936401a592748b35ccdb513058f4cbd` | `a5a2dbf0946f81eb018d1ab95537741cb23a1fee800af6065c235cade85411ec` |
| `shadow/A5X_SHADOW_GAP_RECEIPT.md` | `b9dc9d81117a3df6002d2af07aad3e89a9dd29ca` | `e5074022182681a56e670268ea5a31a8a8564120a9da750a2400b9939018ffce` |

## Exact implementation path manifest

The implementation commit contains 13 deterministic fixture and evidence
paths:

- `fixtures/aiOps/a5/INSERTION_REQUEST_ROWS.DRAFT.v1.json`
- `fixtures/aiOps/a5/RESEARCH_BASIS.md`
- `fixtures/aiOps/a5/campaign-catalog.mjs`
- `fixtures/aiOps/a5/campaign.mjs`
- `fixtures/aiOps/a5/exact-record.mjs`
- `fixtures/aiOps/a5/fixture-factory.mjs`
- `fixtures/aiOps/a5/hard-denial-categories.mjs`
- `fixtures/aiOps/a5/interface-assumptions.v1.json`
- `fixtures/aiOps/a5/oracles.mjs`
- `fixtures/aiOps/a5/reference-harness.mjs`
- `fixtures/aiOps/a5/scenario-expectations.mjs`
- `fixtures/aiOps/a5/scenario-programs.mjs`
- `fixtures/aiOps/a5/scripted-subject.mjs`

It contains five landed-owner conformance and fault tests:

- `server/test/aiOps/a5/ai-off-survival.test.mjs`
- `server/test/aiOps/a5/contract-shapes.test.mjs`
- `server/test/aiOps/a5/fault-families.test.mjs`
- `server/test/aiOps/a5/hard-denial-boundary.test.mjs`
- `server/test/aiOps/a5/restart-replay-fencing.test.mjs`

It contains seven portable campaign and boundary tests:

- `test/aiOps/a5/campaign.test.mjs`
- `test/aiOps/a5/catalog-coverage.test.mjs`
- `test/aiOps/a5/network-deny.mjs`
- `test/aiOps/a5/network-deny.test.mjs`
- `test/aiOps/a5/oracle-mutation.test.mjs`
- `test/aiOps/a5/purity-scope.test.mjs`
- `test/aiOps/a5/scripted-subject.test.mjs`

It contains the two byte-identical source receipts named above. This receipt
is the one additional path in a documentation-only seal commit. No path outside
`server/test/aiOps/a5/**`, `test/aiOps/a5/**`, `fixtures/aiOps/a5/**`, or
`docs/archive/aiOps/a5/**` was edited.

## Reconciliation against landed owners

The shadow harness's provisional owner shapes were not copied forward as a
second authority:

- The provisional `canonical.mjs` was retired. A5 consumes the accepted
  Product Assurance canonical utilities and adds only a lane-local,
  descriptor-safe exact-record validator for hostile fixture inputs.
- The provisional `contract-shapes.mjs` was retired. Its 29 shape tests were
  rebuilt as 29 direct conformance tests against the accepted Product
  Assurance, Ledger, Foundation, System Integration, and Product Integration
  owners.
- Product Assurance remains the fault, diagnostic-boundary, remediation, and
  failure-record owner. The landed canonical fault denominator is exactly 103
  and remains distinct from A5's 120 synthetic scenarios.
- Ledger remains the sole durable-history owner. A5 creates no store, queue,
  WAL, cursor, or persistence authority.
- System Integration remains control and canonical trace-kind authority.
  Product Integration remains projection and adapter authority; A5 does not
  invert those dependencies.
- The landed inventory remains exactly 33 roles over 14 components, and the
  incident owner remains honestly `NOT_CONFIGURED`.
- The healthy no-model scenario no longer claims a counterfactual physical
  removal. Physical-removal equivalence is asserted only where the synthetic
  program actually performs that transition.
- Determinism, stale fencing, delivery denial, child limits, context binding,
  and scenario-specialized oracles now compare independently derived evidence
  and reject internally rehashed false greens.
- Programs, traces, evidence, generic hash inputs, and untrusted remote text
  are iteratively bounded. Accessors are rejected without invocation; hidden
  keys, symbols, cycles, sparse arrays, unsafe numbers, and oversized
  containers cannot enter canonical evidence.
- The network tripwire covers browser fetch/WebSocket/EventSource plus Node
  HTTP, HTTP/2, TLS, TCP, Unix sockets, callback and promise DNS families,
  resolver mutation, UDP, and listener surfaces. The authoritative focused run
  additionally used macOS `sandbox-exec` with `deny network*`.

The result remains a deterministic synthetic evidence harness. It creates no
production module, provider, socket, executor, canonical schema, material
event, control, risk gate, scanner, cache, proposal queue, case owner, or live
effect path.

## Shared seams and insertion requests

The packet contains exactly 21 unique `InsertionRequestRowV1` rows. Every row
has `status=DRAFT`, `authorityCreated=false`, and
`wiringState=PENDING_BACKEND:<literal rowId>`. The packet is non-authoritative
and direct shared edits remain forbidden.

The rows preserve the required composition, persistence, auth, package,
deployment, controls, events, remediation, assurance, telemetry, refresh,
notification, egress, incident, sentinel, audit, managed-inventory, approval,
browser-probe, configuration, and test-mount seams. In particular:

- `AIOPS-IR-COMPOSITION-001` requests composition of the complete ratified
  owner graph rather than granting A5 composition authority.
- `AIOPS-IR-PERSISTENCE-003` requests only a narrow Ledger adapter; the
  Product memory fixture is not durable authority.
- `AIOPS-IR-CONTROLS-008` keeps System Integration as control owner and Product
  as its projection adapter.
- `AIOPS-IR-EVENTS-009` keeps System Integration as canonical trace-kind owner
  and Product as the material projection.
- `AIOPS-IR-MANAGED-INVENTORY-022` requests an owner-versioned denominator
  extension or a proven non-widening mapping; A5 does not change the inventory.
- `AIOPS-IR-TEST-MOUNT-026` remains DRAFT because root scripts do not discover
  the A5 focused lane.

`STATE.md`, package scripts, canonical registries, routes, production
composition, and every other shared seam were left untouched for their owners.

## Current-source research applied

The sealed research was refreshed on `2026-07-16` from primary or
project-authoritative sources before implementation:

- OWASP Prompt Injection Prevention Cheat Sheet and 2025 LLM05 Improper Output
  Handling guidance informed instruction/data separation and strict output
  validation.
- OWASP LLM06 Excessive Agency informed the least-authority and no-effect
  boundary.
- OpenTelemetry Collector resiliency informed explicit queue, WAL,
  backpressure, and delivery-loss evidence.
- OPA bundle management informed signature and activation checks; retaining
  last-known-good after failed activation is explicitly project policy, not an
  OPA guarantee.
- Argo Rollouts analysis behavior informed distinct inconclusive, measurement
  error, and non-finite canary outcomes.
- etcd v3.6 API guarantees informed revision/CAS fencing.
- NIST SP 800-207A informed identity- and policy-bound access checks.
- Temporal workflow determinism informed replay and incompatible-history
  rejection.
- Node.js v22.17 test-runner documentation informed explicit lane discovery
  and process isolation.

Exact links and adoption notes are preserved in
`fixtures/aiOps/a5/RESEARCH_BASIS.md`. No dependency or production design was
adopted from those sources.

## Verification evidence

Dependencies were hydrated without network access using
`npm ci --offline --ignore-scripts --no-audit --no-fund` (exit `0`, 229
packages), followed by an offline source rebuild of `better-sqlite3` (exit
`0`). No package or lockfile was edited.

| Command or gate | Result |
| --- | --- |
| `npm run typecheck -w server` | exit `0` |
| `npm run build -w server` | exit `0` |
| Full focused A5 suite under `/usr/bin/sandbox-exec ... (deny network*)` | exit `0`; `88/88` passed; `0` failed/skipped/cancelled/todo |
| Direct landed-owner conformance file under the same OS deny | exit `0`; `29/29` passed |
| Two independent campaign processes under the same OS deny | both exit `0`; byte-identical; validation issues `[]` |
| Campaign scenarios | `120/120` passed across `17` families and `21` oracles |
| Campaign effects | network attempts `0`; product effects `0` |
| Campaign serialized bytes | `130051` |
| Campaign serialized SHA-256 | `1b1c93b0abb4b306cc0e6a4cc073131b8dda8b69550cc9b552174488edc8598f` |
| Campaign embedded report hash | `730e95be1cc6342a921f77642a7fd08de17ab812c33d424bd2aff94fa0d16791` |
| `npm run test:integration:built` | exit `0`; `401/401` passed |
| Clean committed-tree `npm test` | exit `0`; Product Assurance `802` behavior checks passed; operation scan `518` files, `205` discovered, `205` covered, `0` uncovered; I00 acceptance contract `43/43` |
| Clean committed-tree `npm run test:all` | exit `1` at the shared I00 proof gate after preceding suites passed; proof gate `45/47` |
| Syntax and JSON parsing | all 22 `.mjs` files and both JSON files valid |
| `git diff --check`, exact path audit, credential scan | no violation |

The two `test:all` failures are outside every A5 namespace:

1. `final D-LAUNCH-7 repin accepts exact current-main objects while historical packet pins stay immutable`
2. `current machine evidence is input-driven for both legal candidate phases and historical IP-PROOF evidence stays historical`

Both report shared-root repin drift for `QL_DIRECTOR_STATE.md` and
`QL_PARALLEL_DAG.md`. The assigned base and A5 implementation contain
byte-identical versions of those two files:

| Shared file | Assigned-base and implementation SHA-256 | Proof expected SHA-256 |
| --- | --- | --- |
| `QL_DIRECTOR_STATE.md` | `57eaf6d10e5a4c3fe9dc60324fb906ebe1385aeb082283930853cbfdf19d0494` | `77f7c47251e6c9f990352c6ca63408a5a2dbfbbfb87cac0f38d71bf0446258cc` |
| `QL_PARALLEL_DAG.md` | `89a13c8a6a6b00a834d3dc586cc45c29eb4f7f32b2106fb5dea10fd2be3742a0` | `cb4312843160e5f72029ee9f7b169987cfc07b9ef82d952c3feba60476392dec` |

`git diff 492e3f69..3d84e48b` is empty for both files. Repairing or repinning
those moving shared/root inputs belongs to their owner and would violate this
lane's exclusive namespace. They were not edited, copied, reset, or otherwise
mutated. The nonzero all-suite exit is therefore retained as exact shared-seam
evidence and does not downgrade the green A5 lane or the green required
`npm test` gate.

The earlier root attempt made while A5 was still untracked stopped at a clean-
candidate fallback guard. After the implementation commit, the protected I00
owner helper resolved the absent live file from the exact sealed candidate and
the complete clean-tree `npm test` passed. Only the clean committed-tree
results above are the final acceptance evidence.

## Adversarial self-review and limitations

- All providers, identities, signatures, endpoints, credentials, and effects
  are synthetic. No environment credential was read or retained.
- `LIVE_EXECUTION_NOT_IMPLEMENTED` remains unchanged. A5 has no live or test
  order, borrow/repay, transfer, withdrawal, leverage, margin, signed/private
  exchange, deployment, merge, or push path.
- The harness proves deterministic contract, fault, replay, security, and
  evidence behavior. It does not prove a mounted production AI runtime.
- Incident authority remains `NOT_CONFIGURED`; a Ledger AI adapter, external
  sentinel, notification delivery, WORM audit readback, credential proxy,
  release canary/rollback, and browser probe remain DRAFT insertion requests.
- The focused suite is not root-mounted; `AIOPS-IR-TEST-MOUNT-026` remains the
  explicit owner handoff.
- No UI source changed, so no new browser interaction or screenshot claim is
  made. Browser requirements in the synthetic scenario catalog remain
  post-port evidence obligations for the named owner.
- The branch remains local for director landing. No push or merge was
  performed.

## Terminal state

Implementation commit `3d84e48b49c27fa0c906f7645bdc527a39e09f3e`
is sealed against assigned base
`492e3f69b054c85686bcfc4c09dbff4ababeda3f` with the exact limitations above.

PORT_A5_READY
