# PORT REPLAY prestage receipt

Status: `PORT_REPLAY_PRESTAGE_READY`

This receipt accepts only the bounded, synthetic Replay corpus/compiler packet for director review and landing. It does not mount a runtime, grant execution authority, certify a candidate, or substitute the sealed shadow receipt for real-port evidence.

## Immutable identity

- Branch: `port-replay-20260716`
- Assigned landed base: `492e3f69b054c85686bcfc4c09dbff4ababeda3f`
- Assigned base tree: `3adef4d97ab595a8c81a307bac8dce22d037abdb`
- Accepted implementation HEAD: `cc1c52feafe35e48436941c4317ba01a63332ea3`
- Accepted implementation tree: `f45228962a1c40479371639497a8d26c88fa79a0`
- Implementation commit subject: `test(replay): port RUN-17 corpus to landed base`
- Receipt topology: this file is added by one receipt-only child commit after the accepted implementation HEAD is known. The receipt child SHA is intentionally not self-named; `git rev-list --parents -n 2 HEAD` proves the topology.

Sealed donor lineage was recomputed from Git objects:

- Shadow packet base: `098f7b9449ab3b1c26bda19f51537bfea01d4c48`
- Shadow implementation: `f70469dbbae810f598892120440f148a4bef5cd6`
- Shadow implementation tree: `001f0d356af5f1df07a9bf609e8aa78e6dd75a37`
- Shadow receipt seal: `7666930d7620c81c6d596343b0a72b1a9ebeb23b`
- Shadow seal tree: `08d20f7e34862889746ce4379d2fe7bccd4fabd6`
- Verified ancestry: `098f7b94… -> f70469db… -> 7666930d…`
- The historical `REPLAY_SHADOW_RECEIPT.md` was inspected through the sealed Git object and deliberately was not ported.

The precomputed planner script was verified but not executed. Its SHA-256 is `3244f99cc110724ef0e32655e4baec874a91a806f9eb8f545c50080f0767a175`; its old `fixtures/aiOps/a5/replay/**`, `test/aiOps/replay/**`, and archive destinations conflict with D-LAUNCH-51's ratified Replay namespaces.

## Exact changed-path manifest

The accepted implementation commit adds exactly these eight paths:

1. `fixtures/replayShadow/RESEARCH_BASIS.md`
2. `fixtures/replayShadow/corpus.v1.json`
3. `fixtures/replayShadow/entry-gate.v1.json`
4. `fixtures/replayShadow/harness.mjs`
5. `fixtures/replayShadow/insertion-requests.v1.json`
6. `test/replayShadow/adversarial.test.mjs`
7. `test/replayShadow/contracts.test.mjs`
8. `test/replayShadow/landed-contracts.test.mjs`

The receipt-only child adds only:

9. `fixtures/replayShadow/PORT_REPLAY_RECEIPT.md`

No other namespace, root document, package file, composition seam, route, persistence owner, auth owner, navigation file, credential file, or current-main worktree was edited.

Accepted implementation SHA-256 manifest:

| Path | SHA-256 |
| --- | --- |
| `fixtures/replayShadow/RESEARCH_BASIS.md` | `2958fa1471cea718f8b4c4b926534dbe69f33662643253d8baf76266d5d4011e` |
| `fixtures/replayShadow/corpus.v1.json` | `fb2c3c3d5c4580d4d66b7f81dcbdbcd83df137f336f69f409e6011c34e12c6ce` |
| `fixtures/replayShadow/entry-gate.v1.json` | `7bc4a227fa00c4ae022cd79c75eec6d199e882ab14a75bc586ee74ef4a644d51` |
| `fixtures/replayShadow/harness.mjs` | `3cfe8262e7d3ebcd6e9af2e571893dab4a5c13d5b109ce2497467677e3265278` |
| `fixtures/replayShadow/insertion-requests.v1.json` | `2bbcca789acef313b69564d490092d603a8a45f2dcde8c5c5026d789aeee5e55` |
| `test/replayShadow/adversarial.test.mjs` | `5ca50d8ff0e04b731f11c141f3829d1a9d8ee8f49215189f0d52157ce76dd014` |
| `test/replayShadow/contracts.test.mjs` | `5594bff1b50d7782dfd40018ea6ebbbbac9dbc47dd6e6d865acc7500e26d8c91` |
| `test/replayShadow/landed-contracts.test.mjs` | `680e379fe1d4b7aae117aabfc82be5a1030355925c94cffb860568d65a0c66c1` |

`entry-gate.v1.json` remains byte-identical to the sealed donor. The other donor-derived artifacts were intentionally rebuilt and must not be described as byte-identical.

## Port reconciliation and deduplication

Live interfaces were checked at the assigned base before the implementation was accepted.

- Foundation already owns generic replay and scenario conversion through `server/src/foundation/replay/**` and `scenarioToReplayInputs`. No replay engine, scenario generator, or adapter was duplicated.
- Product Assurance still owns all fault definitions. All 30 referenced fault IDs resolve as typed entries in the current 103-ID catalog.
- Intelligence Runtime still owns lifecycle, backoff, rate-budget, throttle, and bounded capacity behavior. No policy or runner was added.
- Foundation execution/reconciliation still owns fill truth. The raw report with null trade ID/price and decimal strings remains unresolved fixture evidence; it is never cast to `ObservedFillEvidence` and never fabricates zero or success.
- Foundation time accepts `COMPLETE | PARTIAL | UNAVAILABLE`, bounds UTC milliseconds, and requires positive maximum age. Raw fixture `UNKNOWN` is retained only as an observation and must map fail-closed to `UNAVAILABLE` in any future owner-approved adapter.
- The landed Binance stream policy caps socket construction at eight attempts. The tape's ninth attempt is explicitly an unmounted hostile policy-violation observation, not current retry policy.
- The landed capacity owner caps an executable definition at 300,000 ms. The six-hour soak remains a deferred schedule definition only.
- System Integration remains composition only and Ledger remains the sole durable persistence owner. The packet adds neither composition nor persistence.
- `LIVE_EXECUTION_NOT_IMPLEMENTED` remains exactly defined by `server/src/systemIntegration/contracts/constants.ts`; the port adds no live/test order, borrow/repay, transfer, withdrawal, leverage, margin mutation, signed/private exchange call, endpoint, or credential path.

The eleven legacy `RS-IR-*` shadow drafts were dropped. They duplicated landed owners and did not conform to the ratified schema. The real packet carries only these existing canonical `InsertionRequestRowV1` proposals:

- `AIOPS-IR-DOCS-017` — root state/architecture updates only after actual mounted acceptance.
- `AIOPS-IR-TEST-MOUNT-026` — canonical root discovery only after lane acceptance.

Both remain `DRAFT`, use literal `PENDING_BACKEND:<rowId>`, set `authorityCreated=false`, omit `controlDraft`, and bind the immutable registry object `aiops-prestage-20260714@08e0beaa54c4c3ca9c24276785d6a302f751a226` (`AI_OPS_COLLISION_MAP.md` blob `5f76b29a81b6af4eee7a156afc16979fea02635e`, SHA-256 `92a3a2601d2894a3baacadbfb719b0e0b8ff9a950f71b6a27bc18965b7042c33`). No composition, route, persistence, auth, navigation, package, barrel, or new registry row was invented.

## Rebuilt behavior

- Research was refreshed against current official sources on 2026-07-16 while retaining the corpus's historical `OFFICIAL_DOCS_2026_07_15_SNAPSHOT` only as a sealed tape identity.
- Current primary sources rechecked: [Node.js v22 test runner](https://nodejs.org/download/release/latest-v22.x/docs/api/test.html), [Binance WebSocket streams](https://github.com/binance/binance-spot-api-docs/blob/master/web-socket-streams.md), [Binance changelog](https://github.com/binance/binance-spot-api-docs/blob/master/CHANGELOG.md), [Binance user-data stream](https://github.com/binance/binance-spot-api-docs/blob/master/user-data-stream.md), [Binance REST limits](https://developers.binance.com/en/docs/products/spot/rest-api#limits), [Binance public data](https://github.com/binance/binance-public-data), [RFC 6455](https://datatracker.ietf.org/doc/html/rfc6455), [k6 workload models](https://grafana.com/docs/k6/latest/using-k6/scenarios/concepts/open-vs-closed/), and [AWS chaos planning](https://docs.aws.amazon.com/prescriptive-guidance/latest/chaos-engineering-on-aws/sample-planning.html).
- Decimal comparisons now use bounded fixed-scale `BigInt` units rather than `Number.parseFloat`.
- JSON inspection now rejects symbol keys, named array properties, and array accessors before traversal.
- Restart attempt/generation/delay relations and ping/pong payload relations are validated by the compiler, not merely asserted for the one corpus instance.
- Required limitations now explicitly cover raw fail-closed adaptation, hostile attempt nine, unratified tail/drain semantics, and the definition-only soak.
- Canonical compiled corpus digest: `2fe454ec770c8f69335d07430c7c4853f9c208b29c034e61dfc8ab6fd05a447b`.
- Inventory: 11 datasets, 64 events, 30 fault references, 5 campaigns, 10 phases, and 946,664 declared iterations.

## Acceptance evidence

Runtime: Node `v22.23.1`. Dependencies were hydrated without network using `npm ci --offline --ignore-scripts`; `better-sqlite3` rebuilt from local Node headers.

### Exact lane gate on the committed implementation

Executed in a clean local clone detached at `cc1c52feafe35e48436941c4317ba01a63332ea3`:

```text
/usr/bin/sandbox-exec -p '(version 1)(allow default)(deny network*)' \
  /Users/cosmosgeek/.local/node22/bin/node \
  --test --test-concurrency=1 --test-reporter=spec \
  "test/replayShadow/**/*.test.mjs"
```

Result: exit `0`; tests `73`; pass `73`; fail `0`; cancelled/skipped/todo `0`; duration `244.352292 ms`.

This is OS-level total network denial for the entire suite, including imports and every adversarial case. The existing in-process tripwire also reported zero attempts during harness import and focused compilation. A separate pre-commit deny-network run returned the same `73/73` denominator.

After this receipt was added, the same OS-denied suite was rerun in the port worktree so the all-artifact secret scan included the receipt: exit `0`, `73/73` pass, duration `250.419667 ms`.

The denominator includes:

- The re-earned shadow contracts and hostile corpus/plan cases.
- Seven added hostile cases for execution-authority escalation, named/symbol/accessor shapes, exact-decimal contradiction, restart-delay drift, and ping/pong mismatch.
- Five landed-interface, fault-catalog, safety, executable-purity, and all-artifact secret checks.

Additional focused proof:

- Every final `.mjs` passed `node --check`.
- Every final JSON artifact parsed successfully.
- `git diff --cached --check` returned exit `0` before the implementation commit.
- Exact allowlist audit found no implementation path outside `fixtures/replayShadow/**` and `test/replayShadow/**`; no symlink was present.
- `npm run test:foundation:built` under the repository external-egress tripwire returned exit `0`.
- `npm run test:intelligence:runtime:built` under the same tripwire returned exit `0`: `395/395` pass, duration `5105.741541 ms` on the recorded rerun.
- The root deterministic run also completed the current stream lifecycle suite `14/14`, perimeter suite `2/2`, financial safety `59/59`, storage/config/AWS `29/29`, engine Basis `107/107`, and engine Volume `124/124` before reaching Product Assurance.
- Independent read-only adversarial review found no blocker in the staged implementation.

### Root regression result and external baseline limitation

`npm test` was run offline with the repository external-egress tripwire in a clean local clone detached at the accepted implementation HEAD. Typecheck and both builds completed. The command exited `1` only at:

```text
PRODUCT_ASSURANCE_RUN_FAILED:A_CASE_S4_NINETEEN_NON_CONTEXT_FILES
accepted S1 branch and all pinned contract blobs are recomputed from Git objects
expected 226; passed 225; failed 1
```

This reproduces the clean tracked-only baseline defect already recorded by D-LAUNCH-51 at immutable object `e619ff18ef159c27061cfaf318036e18a4fac131:QL_DIRECTOR_STATE.md`: the S4 inventory is worktree-state-dependent and is assigned to the separate `ci-hotfix-20260716` lane. No Replay path is in that owner scope. This receipt does not relabel the root gate green.

`npm run test:all` was not run: this port changes only its fixture/test family, the required focused gate is green, and the root prerequisite already stops on the documented external S4 harness defect.

## Honest limitations and non-claims

- Corpus disposition remains `SHADOW_SPECULATIVE`; `candidateBinding` remains null; execution authority remains `NONE`.
- Heavy campaigns were not executed. There is no host latency, load, soak, restart, recovery, SLO, threshold, PASS/FAIL verdict, or production-readiness evidence.
- No owner adapter, runner, timer, transport, fault injector, recovery controller, persistence path, socket, cache, queue, evaluator, proposal authority, or UI was mounted.
- Root test discovery and canonical state/architecture updates remain pending typed owner requests; they are not silently changed here.
- Campaign windows schedule frame admission, not complete-tape drain. Tail, cutoff, drain, and late-evidence accounting require later owner ratification.
- `materializePlanWindow` structurally validates a supplied plan and its digest shape, but cannot independently recompute corpus bytes. Safe use compiles directly from the validated corpus or separately binds the exact corpus digest.
- Raw `UNKNOWN`, nullable identifiers/prices, decimal strings, and the hostile ninth restart attempt are fixture observations only and cannot be cast into landed owner contracts.
- The six-hour soak exceeds the current bounded capacity execution duration and is definition-only.
- Current external specifications may change and must be rechecked again before any later adapter or execution phase.
- The known S4 root-harness failure remains outside this lane and is not waived or hidden.

Within the ratified namespaces, the real port acceptance loop is complete.

`PORT_REPLAY_PRESTAGE_READY`
