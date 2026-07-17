# PORT A2 prestage receipt

## Verdict

The A2 case runtime and A2X extension were rebuilt against the assigned landed
tree, kept inside the four ratified namespaces, verified under a total
process-level Node network deny, and committed without shared-seam edits.

`PORT_A2_PRESTAGE_READY`

This is a real port-phase receipt. The two archived `SHADOW_SPECULATIVE`
receipts are source-provenance evidence only and do not substitute for this
acceptance.

## Immutable identity and lineage

| Fact | Exact value |
| --- | --- |
| Directive | `D-LAUNCH-51` post-landing PORT A2 |
| Branch | `port-a2-20260716` |
| Assigned landed base | `492e3f69b054c85686bcfc4c09dbff4ababeda3f` |
| Implementation HEAD | `552d0729f94ea2f73fa2b791cb5e78f8cf3b0037` |
| Implementation parent | `492e3f69b054c85686bcfc4c09dbff4ababeda3f` |
| Merge base of assigned base and implementation HEAD | `492e3f69b054c85686bcfc4c09dbff4ababeda3f` |
| A2 sealed source artifact | `ca1fb094e19d0ccc6a8397ee08a65a662d051bd3` |
| A2X sealed source extension | `9ae6c22012e7c23ebebff827b527d4d64a263884` |
| Shadow merge base | `03857dcdaff8d8b12627d27ddcc97505da1f2f86` |
| Canonical AIOPS-IR registry commit | `08e0beaa54c4c3ca9c24276785d6a302f751a226` |
| Implementation path count | `34` |
| Sorted implementation path-set SHA-256 | `0bf73b89a5aac7d7c218258eec5ba01cac7ebf8d436bc91129ec2305310b143a` |
| Implementation diff size | `34 files changed, 16655 insertions` |

The local `current-main` ref advanced independently to
`e619ff18ef159c27061cfaf318036e18a4fac131` after this lane was assigned. This
worker did not switch, rebase, merge, or modify that worktree/ref; the port
remains directly based on the required `492e3f69...` object.

The precomputed helper
`/Users/cosmosgeek/Desktop/port-plan/portPlan/a2-port.sh` had SHA-256
`9ff9118311fd3c7e9fa9a41f944cf7610ec309a1eea7a99cc8dbd620689506a6`.
Its exact-base check returned `A2_PORT_CHECK_OK`; apply intentionally exited
`42` with `A2_REAL_PHASE_REBUILD_REQUIRED` after relocating all 34 source
paths. Live Git and landed interfaces were then rechecked rather than treating
the helper as authority.

## Exact implementation path manifest

The implementation commit contains 12 runtime files:

- `server/src/aiOps/runtime/budget.ts`
- `server/src/aiOps/runtime/caseState.ts`
- `server/src/aiOps/runtime/context.ts`
- `server/src/aiOps/runtime/diagnostic.ts`
- `server/src/aiOps/runtime/escalation.ts`
- `server/src/aiOps/runtime/eventIntake.ts`
- `server/src/aiOps/runtime/evidence.ts`
- `server/src/aiOps/runtime/incident.ts`
- `server/src/aiOps/runtime/index.ts`
- `server/src/aiOps/runtime/persistence.ts`
- `server/src/aiOps/runtime/support.ts`
- `server/src/aiOps/runtime/types.ts`

It contains 15 focused verification files:

- `server/test/aiOps/a2/a2x-entry-gate.test.mjs`
- `server/test/aiOps/a2/a2x-replay-fixtures.test.mjs`
- `server/test/aiOps/a2/budget-depth.test.mjs`
- `server/test/aiOps/a2/budget-outage.test.mjs`
- `server/test/aiOps/a2/context-handoff.test.mjs`
- `server/test/aiOps/a2/diagnostic-handoff.test.mjs`
- `server/test/aiOps/a2/escalation-intent.test.mjs`
- `server/test/aiOps/a2/event-intake.test.mjs`
- `server/test/aiOps/a2/evidence-quarantine.test.mjs`
- `server/test/aiOps/a2/handoff-consumption.test.mjs`
- `server/test/aiOps/a2/incident-admission.test.mjs`
- `server/test/aiOps/a2/network-deny.mjs`
- `server/test/aiOps/a2/persistence-backpressure.test.mjs`
- `server/test/aiOps/a2/purity-network-deny.test.mjs`
- `server/test/aiOps/a2/workflow-recovery.test.mjs`

It contains five fixtures/adapters:

- `fixtures/aiOps/a2/a2x-replay-fixtures.v1.json`
- `fixtures/aiOps/a2/entry-gate.a2x.v1.json`
- `fixtures/aiOps/a2/insertion-requests.a2x.v1.json`
- `fixtures/aiOps/a2/insertion-requests.v1.json`
- `fixtures/aiOps/a2/synthetic-runtime.mjs`

It contains two byte-identical archived source receipts:

- `docs/archive/aiOps/a2/shadow/AI_OPS_A2_SHADOW_RECEIPT.md`
- `docs/archive/aiOps/a2/shadow/AI_OPS_A2X_SHADOW_RECEIPT.md`

Their current/source Git blob IDs match exactly:

- A2: `8f3abd589a772c92ca78fd1bafdea5979ebc9f3e`
- A2X: `9ce4138144722a33ce6152c06b31992e8bd0060f`

This receipt is the one additional path in its documentation-only receipt
commit. No path outside `server/src/aiOps/runtime/**`,
`server/test/aiOps/a2/**`, `fixtures/aiOps/a2/**`, or
`docs/archive/aiOps/a2/**` was edited.

## Reconciliation against the landed tree

The following imported owner boundaries are byte-identical between shadow base
`03857dc...` and assigned base `492e3f69...`:

| Landed interface | Git blob |
| --- | --- |
| Product Assurance diagnostic boundary | `7b6b92a4fcbcc15d22b90d35f1244427fa1b0eab` |
| Foundation replay guard | `26a0b2dd2644d57ebdf0e09769c1163a64a83fbe` |
| Foundation canonical identity | `4f4aac43a685f9a4f3635e7eabcc0610917ea761` |
| Foundation time validation | `7672fbfc23a286ac856348dbf244dcab2c937672` |

`server/src/systemIntegration/persistence/types.ts` changed from blob
`eeee81d158d0a8f8bc458b3871f27a9b70f6eb63` to
`fa3c0afc87c77ed604fad67216be0cbf54f19b8b`. The two imported contracts,
`LedgerEventInputRecord` and `LedgerConfigCompareAndSetResult`, retained their
required shapes. The landed owner added multi-trace capacity elsewhere; A2
still performs one bounded CAS/event commit. Typecheck, build, restart truth,
SQLite persistence, CAS conflict, corrupt-state, and the complete
SystemIntegration suite passed against the landed implementation.

The landed Product projection still reports the incident owner as
`NOT_CONFIGURED` / `INCIDENT_OWNER_NOT_CONFIGURED`; Ledger owns persistence,
not incident policy. Therefore the runtime symbols and runtime contract status
remain honestly `Shadow*` / `SHADOW_SPECULATIVE`. This port creates no
canonical incident, trust, approval, notification, provider-rate, telemetry,
or effect authority.

## Shared seams and deduplication

No composition, route, persistence-owner, auth, navigation, package, lockfile,
root-test, or canonical state document was edited. The port serializes 17
closed `InsertionRequestRowV1` rows using exact IDs from
`AI_OPS_COLLISION_MAP.md` at registry commit `08e0beaa...`:

`AIOPS-IR-COMPOSITION-001`, `AIOPS-IR-ROUTES-002`,
`AIOPS-IR-PERSISTENCE-003`, `AIOPS-IR-PACKAGE-006`,
`AIOPS-IR-EVENTS-009`, `AIOPS-IR-REMEDIATION-010`,
`AIOPS-IR-ASSURANCE-011`, `AIOPS-IR-TELEMETRY-012`,
`AIOPS-IR-REFRESH-013`, `AIOPS-IR-NOTIFY-014`,
`AIOPS-IR-INCIDENT-019`, `AIOPS-IR-SENTINEL-020`,
`AIOPS-IR-AUDIT-021`, `AIOPS-IR-MANAGED-INVENTORY-022`,
`AIOPS-IR-APPROVAL-023`, `AIOPS-IR-BROWSER-PROBE-024`, and
`AIOPS-IR-TEST-MOUNT-026`.

Every active row has `status=DRAFT`,
`wiringState=PENDING_BACKEND:<literal rowId>`, `authorityCreated=false`, and
`directEditAllowed=false` at the set level. Sixteen legacy A2/A2X shadow rows
are retained only in a typed dedup map. Production signing and trust have no
one-to-one registry owner and remain reference-only through the canonical
persistence, audit, and auth seams. No old `INSERTION_REQUIRED` row is active.

`STATE.md` was not edited because this lane is expressly barred from shared
seams. Canonical state/package/test mounting remains an integrator action via
the registry's documentation, package, managed-inventory, and test-mount rows.

## Current-source research applied before rebuild

The 2026-07-16 research pass used current primary sources:

- CloudEvents specification repository and current release material:
  <https://github.com/cloudevents/spec>
- W3C Trace Context Recommendation:
  <https://www.w3.org/TR/trace-context/>
- OpenTelemetry semantic conventions:
  <https://opentelemetry.io/docs/specs/semconv/>
- Node 22 module documentation for synchronizing patched built-in ESM
  bindings: <https://github.com/nodejs/node/blob/v22.x/doc/api/module.md>

The result was to retain a provider-neutral closed envelope, strict trace
validation, explicit `null`/unknown truth, and no provider-specific canonical
schema. The deny harness calls `syncBuiltinESMExports()` after patching Node
built-ins so named imports cannot bypass the patches.

## Verification evidence

Dependencies were hydrated without network access using
`npm ci --offline --ignore-scripts`: exit `0`, 229 packages added, 232 audited,
zero vulnerabilities reported. The skipped native build was then made explicit
with an offline source rebuild of `better-sqlite3` against the installed Node
22 headers; the binding load probe passed.

| Command / gate | Result |
| --- | --- |
| `npm run typecheck -w server` | exit `0` |
| `npm run build -w server` | exit `0` |
| `node --import ./server/test/aiOps/a2/network-deny.mjs --test --test-concurrency=1 --test-reporter=spec server/test/aiOps/a2/*.test.mjs` | exit `0`; `179/179` passed; `0` failed/skipped/cancelled/todo; network-attempt ledger `[]` |
| Four landed restart/security files (`production-facade`, ops restart truth, security regressions, process restart truth) | exit `0`; `59/59` passed |
| `npm run test:integration:built` | exit `0`; `401/401` passed; `0` failed/skipped/cancelled/todo |
| `npm test` from the clean sealed branch | exit `1`; all S4 groups passed, then `LIVE_OPERATION_POLICY` reported expected `filesScanned=518`, observed `530`, with `205/205` operation sites covered and `0` uncovered |
| `npm run test:all` from the clean sealed branch | exit `1`; stopped in its deterministic gate at the same `LIVE_OPERATION_POLICY` denominator mismatch before later aggregate families |
| `git diff --check` and exact four-prefix path audit | exit `0`; no whitespace or scope violation |
| Symlink, credential, ambient-I/O, second-store, and forbidden-authority scans | no violation |

The first unmodified relocated focused run produced `178/179`; the sole failure
was its stale assertion that only three provisional path families were allowed.
The rebuilt gate names all four ratified families, binds the assigned base and
registry, and the complete lane rerun passed `179/179`. No runtime behavior was
weakened to make the gate green.

The dirty-worktree root runs first stopped one group earlier at the documented
`R3-D-CLEAN-009` protected-input check. This worker did not copy, create, or
fabricate that input. After the implementation and receipt were committed, the
clean reruns passed `A_CASE_S4_SAFE_PURITY` `5/5` and exposed the actual shared
integration request: the Product Assurance manifest still seals 518 scanned
production files, while the 12 new A2 runtime files make the observed count
530. The operation denominator itself remains fully covered: discovered 205,
covered 205, uncovered zero, and an empty uncovered-site set.

Updating `fixtures/i00/product-assurance-manifest.v1.json` and resealing its
global provenance are shared Product Assurance/root-acceptance work. This lane
therefore left them untouched and binds the handoff to
`AIOPS-IR-ASSURANCE-011` and `AIOPS-IR-TEST-MOUNT-026`. The nonzero aggregate
exit is a precise pending insertion, not an uncovered operation site or a
focused A2 behavior failure.

## Adversarial self-review and limitations

- Runtime production files import only `node:crypto`, the four narrow landed
  owner boundaries above, SystemIntegration persistence types, and lane-local
  modules. They contain no ambient clock, environment read, filesystem,
  network, timer, randomness, database constructor, provider SDK, socket, or
  package-root discovery.
- The lane creates no second scanner, cache, case owner, proposal queue, risk
  gate, durable store, event bus, cursor, dispatcher, telemetry owner, rate
  reservation, or socket.
- Synthetic signers, provider behavior, claim validation, and CAS adapters are
  fake, deterministic, fail-closed fixtures. They grant no operational or
  production authority.
- The network deny exhaustively patches the enumerated Node HTTP(S), HTTP/2,
  TCP, TLS, DNS callback/promise/resolver, UDP, agent, server, socket, fetch,
  WebSocket, and EventSource surfaces and proves zero attempts. It is
  process-level interception, not a kernel network namespace.
- A2 is not mounted into composition, routes, canonical persistence, managed
  inventory, or root acceptance. Those remain typed insertion requests for the
  named owners.
- Root deterministic and `test:all` remain nonzero until the shared Product
  Assurance operation-scan manifest is regenerated and provenance-sealed by
  its owner for the 12-file denominator increase; this worker has no authority
  to perform that edit.
- Shadow receipts and old synthetic authority/deployment values remain test
  provenance or arbitrary hostile-test inputs; they are not current acceptance
  claims. The real target-base binding is the port gate and this receipt.
- `LIVE_EXECUTION_NOT_IMPLEMENTED` was not changed. No live/test order,
  borrow/repay, transfer, withdrawal, leverage, margin, credential, private
  exchange, push, or merge path was added or exercised.
- The branch remains local for director landing. No push or merge was
  performed.

## Terminal state

Implementation commit `552d0729f94ea2f73fa2b791cb5e78f8cf3b0037`
is sealed against assigned base
`492e3f69b054c85686bcfc4c09dbff4ababeda3f` with the limitations above.

`PORT_A2_PRESTAGE_READY`
