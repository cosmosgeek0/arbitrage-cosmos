# CRITICAL_PROTOCOL_MODEL_CHECK_REPORT — packet-local DRAFT

This is the collision-free S3 source report for director-owned insertion. It is
not the shared generated report and closes no implementation or runtime claim.

## Bound identity

```text
branch: ip-assur-formal-20260713
base_commit: 9785c93102b00389847b77c2f9348c06abc4344b
binding_ip_assurance_sha256: 5f6d4b3b70e384f6123e9ccc01891faf04aef9da7f7cfd1e0c63be5c3ba68803
model_manifest_schema: ip-assurance.s3.model-manifest.v1
explicit_state_checker: NODE_DETERMINISTIC_EXPLICIT_STATE@1.0.0
formal_tooling_status: TLA_TOOLING_NOT_CONFIGURED
authority: SUPPORTING_EVIDENCE_ONLY
source_truth: SYNTHETIC_ONLY
runtime_claim_closure: NOT_PERMITTED
frozen_l_donor_commit: df6b472993ca9659ce09cf5f72004981c6835f0d
frozen_l_donor_tree: 1add5ee43fea623509c20d0990ec9efac2543fc4
packet_checkpoint_status: FORMAL_DEEPENING_BATCH_02_PASS_PENDING_RESEAL
batch_02_content_commit: PENDING
batch_02_content_tree: PENDING
batch_02_receipt: PENDING
```

## Bounded explicit-state result

All counts are reachable graph counts inside the declared finite envelopes and
the recorded fairness/store/lease/exchange/clock assumptions.

| Model | States | Transitions | Depth | Terminals | Deadlocks | Fingerprint | Property checks | Result |
| --- | ---: | ---: | ---: | ---: | ---: | --- | ---: | --- |
| S3-M01 ambiguous mutation | 25 | 31 | 7 | 8 | 0 | `b5d4ea6c282de16a` | 6 | `PASS / EXHAUSTIVE` |
| S3-M02 two-leg recovery | 116 | 119 | 10 | 49 | 0 | `a6733638dcc1cb71` | 6 | `PASS / EXHAUSTIVE` |
| S3-M03 execution fencing | 627 | 858 | 14 | 192 | 0 | `286646548c59eee5` | 5 | `PASS / EXHAUSTIVE` |
| S3-M04 repair campaign | 97 | 98 | 13 | 55 | 0 | `c035d8e45bf877e7` | 8 | `PASS / EXHAUSTIVE` |
| S3-M05 borrow liability | 88 | 105 | 15 | 24 | 0 | `94b4a2d8ea11f8a5` | 7 | `PASS / EXHAUSTIVE` |
| S3-M06 halt/risk reduction | 323 | 373 | 6 | 152 | 0 | `dbc0f41fc1e1ccfe` | 3 | `PASS / EXHAUSTIVE` |
| S3-M07 cancellation boundary | 47 | 47 | 9 | 25 | 0 | `b68929a44adb3466` | 8 | `PASS / EXHAUSTIVE` |
| S3-M08 frozen-L order policy | 13 | 12 | 2 | 6 | 0 | `588b54fbbc1420bf` | 6 | `PASS / EXHAUSTIVE` |
| S3-M09 normal-Basis lifecycle | 69 | 78 | 14 | 28 | 0 | `f49e4d501711b685` | 12 | `PASS / EXHAUSTIVE` |
| S3-M10 Reverse-Basis liability | 198 | 219 | 16 | 87 | 0 | `676f7194331bb8b1` | 12 | `PASS / EXHAUSTIVE` |
| S3-M11 Volume lifecycle | 49 | 55 | 12 | 25 | 0 | `9dde4da6fa0bc321` | 10 | `PASS / EXHAUSTIVE` |
| S3-M12 exchange-twin ambiguity | 27 | 38 | 7 | 13 | 0 | `25d101d585412bf9` | 12 | `PASS / EXHAUSTIVE` |
| S3-M13 durable-control revision | 123 | 161 | 8 | 54 | 0 | `b0e715dbd96bdb25` | 12 | `PASS / EXHAUSTIVE` |
| **Total** | **1,802** | **2,194** |  | **718** | **0** |  | **107** | **13/13 bounded pass** |

The 107 model-property checks cover the complete catalog of fifteen global
safety properties, six global liveness properties, and thirteen model-specific
strengthening properties. The deepening properties make halt exclusion,
repair capital ceilings, UNKNOWN propagation, observed cancellation, two-leg
liability conservation, record-only Volume authority, unproved exchange-race
handling, quantity conservation, exchange placement progress, atomic
control-revision reservation, durable journal phases, inert terminal replay,
and terminal replay progress explicit.
Liveness uses
an obligation monitor, explicit stuttering, weak fairness of continuously
enabled non-stuttering progress, and shortest deterministic counterexample
witnesses. An unexercised liveness antecedent is `UNKNOWN`, never vacuous
`PASS`.

### M01-M07 envelope-growth audit

M01-M07 remain at their sealed envelopes: zero additional states and zero
additional transitions. Retrofitting the frozen-L cases into those models was
not a cheap safe widening because it would change established abstraction
semantics. M08-M13 carry the frozen-L scenarios as new bounded models instead;
no growth is claimed for M01-M07.

### Batch-2 audit corrections

The audit closed five false-green seams without expanding runtime claims. A
flat failed Volume gate now terminates `BLOCKED` with no action; each batch-2
TLA+ module has a one-cut guard matching its finite scenario envelope; M12 has
an explicit placement-dispatch liveness obligation; and M13 represents
post-intent expiry, rejection, and finalization failure as pending ambiguity
instead of synthetic terminal success. M13 journal versions are monotonic
across those failure paths. These remain bounded `SYNTHETIC_ONLY`,
`SUPPORTING_EVIDENCE_ONLY` proofs with
`runtime_claim_closure: NOT_PERMITTED`.

## Frozen-L transition conformance

These are abstraction mappings, not runtime closure. Every row retains
`SYNTHETIC_ONLY`, `SUPPORTING_EVIDENCE_ONLY`, and
`runtime_claim_closure: NOT_PERMITTED`.

| Model transition family | Frozen `df6b472` file / exact symbol |
| --- | --- |
| M08 parse six finite evaluator scenarios | `server/src/liveEdge/adapters/executionPolicy/policy.ts::validateAction`, `validateTransitions`, `validateLegTransitions`, `validateCandidate` (lines 348–690) |
| M08 authorize/reject halt, UNKNOWN, stale, or invalid policy | `server/src/liveEdge/adapters/executionPolicy/policy.ts::evaluateExecutionPolicyCore`, `rejectGlobal`, `rejectedInput`, `finalizeDecision` (lines 832–1194) |
| M08 documentary cancel/replace and recovery graph | `server/src/liveEdge/adapters/executionPolicy/policy.ts::validateAction`, `validateCandidate` (lines 348–690); no runtime reducer exists |
| M09 plan preflight/open/close | `server/src/foundation/contracts/execution.ts::PLAN_LIFECYCLE_TRANSITIONS`; `server/src/foundation/execution/reducer.ts::reduceExecutionEvent` |
| M09 leg submit/fill/cancel/ambiguity | `server/src/foundation/contracts/execution.ts::LEG_LIFECYCLE_TRANSITIONS`; `server/src/foundation/execution/reducer.ts::reduceExecutionEvent` (lines 299–783) |
| M09 twin observation/agreement | `server/src/liveEdge/adapters/normalBasis/twinAdapter.ts::runNormalBasisTwinLeg`; `server/src/liveEdge/adapters/normalBasis/evidence.ts::evaluateNormalBasisOwnerAgreement` |
| M10 borrow/liability/repay evidence | `server/src/liveEdge/adapters/reverseBasisLifecycle/lifecycle.ts::applyEvent` branches `BORROW_OBSERVED`, `LIABILITY_OBSERVED`, `REPAY_OBSERVED` (lines 1465–1913) |
| M10 entry/hedge/exit/cover evidence | `server/src/liveEdge/adapters/reverseBasisLifecycle/lifecycle.ts::applyEvent` branch `ORDER_OBSERVED`, plus `projectOrder` |
| M10 recovery/closure/manual evidence | `server/src/liveEdge/adapters/reverseBasisLifecycle/lifecycle.ts::applyEvent` branches `RECOVERY_EVIDENCE`, `CLOSURE_RECONCILED`, `MANUAL_INTERVENTION` |
| M10 stage projection | `server/src/liveEdge/adapters/reverseBasisLifecycle/lifecycle.ts::deriveLifecycle`, `runReverseBasisLifecycle` |

Batch 2 adds these exact abstraction-to-source mappings:

| Model transition family | Frozen `df6b472` file / exact symbol |
| --- | --- |
| M11 lifecycle state projection | `server/src/liveEdge/adapters/volumeLifecycle/types.ts::VolumeLifecycleState`, `VolumeLifecycleProjection`; `server/src/liveEdge/adapters/volumeLifecycle/lifecycle.ts::evaluateVolumeLifecycle` |
| M11 record-only ENTRY/ADD planning | `server/src/liveEdge/adapters/volumeLifecycle/lifecycle.ts::evaluateVolumeLifecycle`, `entryGateReasons`, `planIncreasingStage`, `actionRequest` |
| M11 protective REDUCE/EXIT planning | `server/src/liveEdge/adapters/volumeLifecycle/lifecycle.ts::exitTriggers`, `planRiskReduction` |
| M11 twin settlement/recovery | `server/src/liveEdge/adapters/volumeLifecycle/lifecycle.ts::twinSettlement`, `settleTwin`, `settledTwinReplayMatches`, `recovery`, and the `evaluateVolumeLifecycle` `recoveryReady` branch |
| M12 single placement | `server/src/liveEdge/adapters/exchangeTwin/twin.ts::executeAggressive`; `reduceCanonical` branches `PLACE_DISPATCH`, `VENUE_ARRIVAL` |
| M12 trade/cancel race and delivery | `server/src/liveEdge/adapters/exchangeTwin/twin.ts::eventOrderingDomains`, `sourceOrderIsProved`; `reduceCanonical` branches `TRADE_EVIDENCE`, `CANCEL_DISPATCH`, `CANCEL_ARRIVAL`, `CANCEL_DELIVERY` |
| M12 crash/restore | `server/src/liveEdge/adapters/exchangeTwin/twin.ts::checkpointExchangeTwin`, `restoreExchangeTwin`; `reduceCanonical` branches `CRASH`, `RESTART` |
| M12 exact/unresolved reconciliation | `server/src/liveEdge/adapters/exchangeTwin/twin.ts::validateCommittedState`, `runExchangeTwinScenario`; `reduceCanonical` branch `RECONCILIATION_OBSERVATION` |
| M13 preview and canonical guards | `server/src/liveEdge/controls/adapter.ts::DurableControlCommandAdapter.preview`, `DurableControlCommandAdapter.submit`, `riskIncreasingByNature`, `recoveryBlocked`, `recheckRisk`; `server/src/liveEdge/controls/validation.ts::validateControlPlaneSnapshot` |
| M13 append intent and reserve global revision | `server/src/liveEdge/controls/integrity.ts::prepareControlEventAppend`, `confirmControlEventAppend`; `server/test/liveEdge/controls/fixtures.mjs::createHarness().deps.persistence.append` `VERSION_CONFLICT` branch |
| M13 publish/finalize | `server/src/liveEdge/controls/adapter.ts::publish`, `lifecycleCommand`, `finalizeRejected`, `DurableControlCommandAdapter.submit` publish-failure, post-publication-expiry, and outcome-append branches |
| M13 reload/replay | `server/src/liveEdge/controls/adapter.ts::lookup`, `replayResult`; `server/src/liveEdge/controls/types.ts::CanonicalControlPersistencePort`, `ControlCommandLookup` |

All M11-M13 rows retain `SYNTHETIC_ONLY`,
`SUPPORTING_EVIDENCE_ONLY`, and
`runtime_claim_closure: NOT_PERMITTED`. M11 is record-only and exposes no
sender, cancellation action, executor lease, borrow liability, durable store,
or runtime recovery scheduler. M12's caller-owned checkpoint and injected
reconciliation do not establish owner queries, persistence atomicity, executor
fencing, or capital authority. M13's atomic global revision reservation exists
only in the synthetic test harness; the production
`CanonicalControlPersistencePort` remains unwired.

M09 and M10 do not expose literal HALT or executor-fencing primitives. Their
models therefore prove terminal-plan/order and closure boundaries, while the
generic halt and revision-fencing obligations remain allocated to the models
whose frozen owners expose those seams. M10 records `BORROWING` as declared but
unreachable: frozen `deriveLifecycle` never assigns it.

## Hostile negative controls

| Mutant | States | Transitions | Required detection |
| --- | ---: | ---: | --- |
| `BLIND_RESEND` | 56 | 76 | `S3-SAF-03`, `S3-SAF-05` |
| `ERASE_FILL_ON_CANCEL` | 117 | 120 | `S3-SAF-06`, `S3-SAF-07` |
| `STALE_CALLBACK_COMMITS` | 755 | 994 | `S3-SAF-01`, `S3-SAF-02` |
| `SELF_REPORT_RECOVERY` | 55 | 56 | `S3-SAF-06`, `S3-SAF-09` |
| `LOST_REPAY_CLEARS_LIABILITY` | 92 | 109 | `S3-SAF-06`, `S3-SAF-07` |
| `HALT_COMMIT_RACE` | 438 | 509 | `S3-SAF-08`, `S3-SAF-10` |
| `LOCAL_EFFECT_AFTER_OBSERVED_CANCEL` | 48 | 48 | `S3-LIV-05` |
| `DROP_KILL_GUARD` | 13 | 12 | `S3-SAF-08`, `S3-SAF-11` |
| `CANCEL_REQUEST_IS_FACT` | 28 | 29 | `S3-SAF-03`, `S3-SAF-14` |
| `REPAY_PRINCIPAL_ONLY` | 174 | 195 | `S3-SAF-15` |
| `HALT_ALLOWS_ADD` | 60 | 77 | `S3-SAF-08`, `S3-SAF-11` |
| `AMBIGUOUS_CANCEL_RACE_ALLOCATES_FILL` | 25 | 32 | `S3-SAF-06`, `S3-SAF-13`, `S3-M12-INV-01` |
| `NON_ATOMIC_CONTROL_REVISION_RESERVATION` | 115 | 150 | `S3-SAF-01`, `S3-M13-INV-01` |

All thirteen negative controls fail. Safety failures carry shortest BFS traces;
liveness failures carry a finite prefix plus a fair non-discharging lasso.

## §4.4 counterexample gate

The deterministic classification fixtures cover exactly the five amendment
dispositions. A separate complete inventory authenticates all 25 currently
failed property traces across the thirteen negative-control profiles. None is
eligible for the runtime failure corpus: each current trace is authenticated as
a packet negative control and is categorically non-promotable. Future
eligibility requires an exact failing `CANONICAL` model report plus an
owner-pinned canonical replay binding, independent manifest, checker, release,
harness, evidence, and reviewer readback. No such registry or canonical failure
exists in this packet.

## §4.5 implementation conformance

| Model | Current verdict | Reason |
| --- | --- | --- |
| S3-M01 | `MISMATCH` | The PAPER coordinator does not enforce durable persistence before its submission effect. |
| S3-M02 | `MISMATCH` | The full cancel-order/automatic compensation/durable recovery protocol is absent. |
| S3-M03 | `UNKNOWN` | No accepted execution lease/fencing protocol exists. |
| S3-M04 | `UNKNOWN` | No accepted durable remediation campaign exists. |
| S3-M05 | `UNKNOWN` | The canonical borrow owner is read-only; no accepted money-mutation protocol exists. |
| S3-M06 | `UNKNOWN` | Validate-only risk checks map partially, but there is no storage transition or operational mutation path. |
| S3-M07 | `UNKNOWN` | No full abort/detach/fenced-reconciliation protocol exists. |
| S3-M08 | `UNKNOWN` | Exact evaluator branches map, but the frozen owner is one-shot, non-sendable, and has no storage/runtime reducer. |
| S3-M09 | `REFERENCE_ONLY` | Foundation lifecycle and adapter evidence map by exact source, but no owner-pinned replay registry closes conformance. |
| S3-M10 | `REFERENCE_ONLY` | The finite event fold and derived stage map by exact source, but no owner-pinned replay registry closes conformance. |
| S3-M11 | `REFERENCE_ONLY` | Volume state, record-only planning, twin settlement, and visible recovery map by exact source, but no owner-pinned replay registry closes conformance. |
| S3-M12 | `REFERENCE_ONLY` | Exchange-twin ordering, reducer, checkpoint, and reconciliation seams map by exact source, but no owner-pinned replay registry closes conformance. |
| S3-M13 | `MISMATCH` | Atomic global control-revision reservation exists only in the synthetic harness; production canonical persistence remains unwired. |

Verdict totals are `MISMATCH 3`, `UNKNOWN 6`, and `REFERENCE_ONLY 4`.

Every mapping records the model version/hash, implementation release and
available source-content versions, all four mapping categories, replay status,
mismatches, unreachable abstractions, omitted environment behavior, and
residual assumptions. Self-declared replay strings or hashes cannot produce
`SUPPORTING_EVIDENCE`. The required owner-pinned implementation evidence
registry is not configured, so that verdict is deliberately unreachable in
this packet. Every result keeps `runtimeClaimClosure: NOT_PERMITTED`.

The packet also carries a machine-checked per-transition manifest for every
reachable M08-M13 canonical action: 144/144 rows, comprising 28 `MAPPED`, 103
`PARTIAL`, and 13 honest `ABSENT` dispositions. Each row binds the frozen donor
commit, exact file/symbol references, and the same three honesty banners; the
focused suite derives action coverage independently and rejects missing,
duplicate, or extra rows.

## Verification state

```text
focused_command: /usr/bin/sandbox-exec -p '(version 1)(allow default)(deny network*)' node --test --test-concurrency=1 --test-reporter=spec test/productAssurance/systemic/formal/*.test.mjs test/productAssurance/systemic/formal/contracts/*.test.mjs
focused_result: PASS 44 / FAIL 0 / SKIP 0 / EXIT 0
canonical_models: PASS 13 / FAIL 0 / UNKNOWN 0
negative_controls_detected: 13 / 13 (25 failed property traces)
tla_sources: 13
tlc_configs: 13
tla_execution: NOT_RUN — TLA_TOOLING_NOT_CONFIGURED
focused_network_policy: TOTAL_NETWORK_DENY
root_npm_test: NOT_RUN_BY_D_LAUNCH_22
root_egress_adjudication: KNOWN_PREEXISTING_TEST_EGRESS
```

D-LAUNCH-22 accepted and adjudicated the prior receipt: root startup egress is
`KNOWN_PREEXISTING_TEST_EGRESS`, and its canonical patch is queued for a
director-controlled post-landing wave. This worker did not rerun the root gate
or touch server startup. Its active gate is only the focused S3 suite under
total network denial.

## Boundary and limitations

- The S3 focused suite contains 44 tests and passed its batch-2 clean-room run
  under total network denial. No root-gate or startup claim is made.
- No production evaluator, command path, risk gate, exchange call, money path,
  secret, timer, socket, filesystem access, package change, or external-system
  mutation exists in the packet runtime modules.
- TLA+/TLC sources are structurally paired and content-hashed, but they are not
  checker-backed evidence until the tooling insertion request is accepted and
  executed.
- Frozen-L implementation evidence came only from read-only
  `git show df6b472:<path>` object reads; no external source or network result
  was used.
- The immutable prior BLOCKED receipt remains historical evidence and is not
  rewritten by the D-LAUNCH-22 adjudication.
- This branch remains NON-CANDIDATE. Its repaired/deepened tip can re-enter only
  in a director-controlled post-landing wave.
- The protected untracked parent I00 input remains outside this packet and must
  not be staged by this satellite.

The shared report, S3 ordinary-harness replays, and checker-backed TLA result
remain director/canonical-owner insertion requests.
