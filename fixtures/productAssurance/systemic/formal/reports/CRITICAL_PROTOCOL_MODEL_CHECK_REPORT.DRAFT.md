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
| **Total** | **1,323** | **1,631** |  | **505** | **0** |  | **43** | **7/7 bounded pass** |

The 43 model-property checks cover all ten §4.3 safety properties, all six
§4.3 liveness properties, and two model-specific strengthening invariants:
bounded repair attempts and preserved halt-time risk reduction. Liveness uses
an obligation monitor, explicit stuttering, weak fairness of continuously
enabled non-stuttering progress, and shortest deterministic counterexample
witnesses. An unexercised liveness antecedent is `UNKNOWN`, never vacuous
`PASS`.

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

All seven negative controls fail. Safety failures carry shortest BFS traces;
liveness failures carry a finite prefix plus a fair non-discharging lasso.

## §4.4 counterexample gate

The deterministic classification fixtures cover exactly the five amendment
dispositions. A separate complete inventory authenticates all 13 currently
failed property traces across the seven negative-control profiles. None is
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

Every mapping records the model version/hash, implementation release and
available source-content versions, all four mapping categories, replay status,
mismatches, unreachable abstractions, omitted environment behavior, and
residual assumptions. Self-declared replay strings or hashes cannot produce
`SUPPORTING_EVIDENCE`. The required owner-pinned implementation evidence
registry is not configured, so that verdict is deliberately unreachable in
this packet. Every result keeps `runtimeClaimClosure: NOT_PERMITTED`.

## Verification state

```text
focused_command: node --test --test-concurrency=1 --test-reporter=spec test/productAssurance/systemic/formal/*.test.mjs test/productAssurance/systemic/formal/contracts/*.test.mjs
focused_result: PASS 43 / FAIL 0 / SKIP 0
canonical_models: PASS 7 / FAIL 0 / UNKNOWN 0
negative_controls_detected: 7 / 7
tla_sources: 7
tlc_configs: 7
tla_execution: NOT_RUN — TLA_TOOLING_NOT_CONFIGURED
npm_test: BLOCKED exit 127 — sh: tsc: command not found
package_install: NOT_AUTHORIZED_AND_NOT_PERFORMED
```

The root `npm test` failure occurs before this packet is discovered: the server
typecheck cannot start because the worktree has no installed `tsc`. The focused
dependency-free Node suite is green; the director-owned insertion request must
wire it into the combined harness after dependencies/tooling are provisioned by
an authorized owner.

## Boundary and limitations

- No production evaluator, command path, risk gate, exchange call, money path,
  secret, timer, socket, filesystem access, package change, or external-system
  mutation exists in the packet runtime modules.
- TLA+/TLC sources are structurally paired and content-hashed, but they are not
  checker-backed evidence until the tooling insertion request is accepted and
  executed.
- One interrupted read-only research subagent performed a discarded web lookup
  before the no-network boundary was reasserted. No result was written, used,
  or incorporated into packet decisions; all implementation evidence is local.
- The protected untracked parent I00 input remains outside this packet and must
  not be staged by this satellite.

The shared report, ordinary-harness replays, checker-backed TLA result, and
composed-scenario fan-in remain director/canonical-owner insertion requests.
