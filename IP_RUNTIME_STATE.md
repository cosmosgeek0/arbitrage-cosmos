# IP-RUNTIME state

Status: `PRESTAGE_READY`

This packet is built, tested, committed, and ready for director-controlled fan-in. It is not integrated, running, deployed, trade-ready, or live.

## Immutable identity

| Field | Value |
|---|---|
| Branch | `ip-runtime-20260713` |
| Packet base | `420cc83e5512d54ca1b1c064c1041d89b23914a0` |
| Implementation commit | `8f19db431871ab8a21f82875d65e7777dd6cba9c` |
| D-LAUNCH-6 proof | `c418bbe7026bdec843b1d74424f5de1fb1265866` (`QL_DIRECTOR_STATE.md`) |
| Frozen Q/L protocol | `73e1a1ff7daa48df8dac45713fc5f106842edafc` |
| Protocol document SHA-256 | `951fdbb5f347f900c61e60055f90cf2e1e1e743b75b7dc733652acb8d43353a1` |
| Protocol schema SHA-256 | `229af0ff13d600c7d305c6deb7f57b61bdb6f8a35f6f2349d91f5ab1b4972f1c` |
| L00-L07 state seal | `4c815f5b739ee0e572e5e72e1eeda6698a4d72ba` |
| L07 implementation / receipt | `51be697476f32fbf2e9ae2cf4c5fab359187345f` / `ebd7aa567334e8e6cbd82e3559f2bcebf56a0088` |
| L07 receipt SHA-256 | `9977d9ea6000a5c2980988254b80893090aaa84bde46164495b5c4d50879c62d` |
| L14 state seal | `04e50f43ab18b1a0e4b03effcb70f0d7ea5a0e28` |
| Dashboard donor | `692501587617d4880303fbd747d93e63c376f088` |
| L15 artifact receipt / work | `2cec412927fa2f64f05a0b2774b18e45f8ce4fa5` / `9a82d4715c73ebe4156638c2bf5e8a2c02373bbf` |

The accepted interface audit found no accepted Q16/Q17 runtime transport or generated client. L08 is `READY` but unimplemented; L09-L13 have no accepted implementation. Those seams remain explicitly unavailable.

## Built packet

| Area | Current truth |
|---|---|
| Contracts | Typed, closed, bounded ports for lifecycle, Q, strategies, opportunity, Capital/Risk, execution/reconciliation, position/recovery, outcome, persistence, commands, supervisor, events, accepted L14, and the dashboard donor. Exotic proxy, symbol, hidden-field, and accessor inputs fail closed before property reads. |
| Q adapter | Pins the frozen protocol and consumes a fully validated envelope plus receipt. Q remains advisory; stale, partial, expired, or unavailable authority abstains and cannot authorize money. No Q process, transport, model, or socket is claimed. |
| Owner adapters | Preserve canonical owner references and explicit unavailable/ambiguous states. They do not duplicate Basis, Volume, Capital, Risk, Foundation, ledger, Q, or L domain logic. |
| Supervisor | Pure deterministic projection of liveness, readiness, trade readiness, freshness, queues, dependency blockers, exposure severity, commands, and revisions. Unknown, stale, synthetic, missing, or mismatched evidence cannot become green. |
| Lifecycle | Pure boot, pause, drain, shutdown, restart, reconciliation, and recovery-only plans. Plans emit intended operations only and never mutate components. |
| Commands/events | Pure preview and confirmed-request projection, revision/expiry/idempotency checks, and explicit cursor continuity/gap/truncation results. No command is applied by this packet. |
| Fixtures | Deterministic, bounded, immutable, network-free fixtures for every declared seam. They are test-only and excluded from production barrels. |
| L05/L06 | Typed private-truth and exact mutation-journal/CAS seams are prepared. L06 fixture proof is not canonical database CAS proof; the exact Ledger insertion request remains director-owned. |
| L07 | Accepted deterministic exchange-twin donor is recorded for later direct-barrel fan-in. It remains synthetic calibration/simulator evidence only and intentionally does not satisfy execution, reconciliation, position, recovery, exposure, or trade-readiness ports. |
| L08-L13 | `UNAVAILABLE` until accepted immutable donors exist. No policy, ticket, execution, position, or recovery truth is guessed. |
| L14 | Exact durable-control port shapes and deterministic fixtures preserve action, witness, event, receipt, lookup, and acknowledgement semantics. Canonical Ledger persistence remains a director-owned insertion requirement. |
| Dashboard | Exact donor bridge preserves the accepted snapshot and before/after mutation receipt. It is unwired and does not recompute owner truth. |
| Persistence/routes/startup/packages | Not edited. Exact schema, transaction, route, stream, composition, startup/shutdown, and package changes are recorded in `IP_RUNTIME_SHARED_INSERTION_REQUEST.md`. |
| L15 | Accepted artifact-only deployment satellite is pinned for adaptation, not replacement. No install, deployment, benchmark, AWS, Cloudflare, systemd, secret, or external mutation was performed. |

## Safety posture

- `LIVE_EXECUTION_NOT_IMPLEMENTED` remains a mechanical barrier.
- No order, borrow, repay, transfer, withdrawal, leverage/margin mutation, signed/private exchange call, or external action was added or performed.
- No network, environment, filesystem, timer, random, or import-time side effect exists in the production packet.
- Unknown values remain `null`, `UNKNOWN`, or `UNAVAILABLE`; no operational zero, confidence, probability, health, or authority is fabricated.
- Synthetic L07 venue/fill/recovery axes and L15 artifacts never become canonical runtime or deployment truth.
- The canonical owners remain unchanged; this packet supplies narrow adapters and future insertion requests only.

## Verification

| Evidence | Result |
|---|---|
| Server typecheck and clean build | Pass |
| Focused `server/test/productIntegration/**/*.test.mjs` | `76/76` pass |
| Frozen edge-protocol conformance | `22/22` pass |
| `npm test` | Pass, `377/377` checks/tests |
| `npm run test:all` | Pass; all families completed, final System Integration TAP `180/180` |
| Adversarial contract/fixture/authority review | `ACCEPT` |
| Immutable pin, insertion-plan, and §2 scope review | `ACCEPT` |
| Staged and committed diff checks | Pass; no forbidden path |

One earlier `npm test` attempt was invalidated when a concurrent clean build removed generated `server/dist/config.js` during the run. It was not treated as a product result; the uncontended rerun above passed completely.

## Director resume point

Use `IP_RUNTIME_SHARED_INSERTION_REQUEST.md` as the exact fan-in queue. Merge only accepted donor SHAs, implement canonical persistence and composition inside their existing owners, register the focused tests, and prove runtime/browser truth before changing this state to integrated. External deployment or money activation requires separate owner authorization and is not authorized by this packet.
