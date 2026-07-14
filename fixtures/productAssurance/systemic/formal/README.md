# S3 critical-protocol formal packet

This subtree is the collision-free IP-ASSURANCE S3 satellite accepted by
`IP_ASSURANCE.md` section 7 and amendment section 4. It is supporting evidence
only. It does not implement a production evaluator, command authority, risk
gate, exchange hand, remediation controller, ledger, supervisor, or cockpit.

## Evidence boundary

- Thirteen finite protocol models cover the original ambiguity, recovery,
  fencing, repair, liability, halt, and cancellation set plus frozen-L order
  policy, Foundation-owned normal-Basis lifecycle, Reverse-Basis liability
  recovery, Volume lifecycle, exchange-twin ambiguity/reconciliation, and
  durable-control revision transitions.
- The executable bounded-check path is a deterministic, dependency-free explicit-state
  explorer running on the repository's existing Node.js runtime.
- TLA+ modules and TLC configurations are source artifacts only. No independent
  TLA/TLC-compatible checker is configured in this worktree.
- Exhaustive results mean exhaustive only inside each declared finite envelope
  and its stated observability, fairness, store, lease, exchange, and clock
  assumptions.
- A passed model cannot close an implementation or runtime claim. That requires
  the section 4.5 mapping and ordinary implementation-harness replay owned by
  IP-PROOF.

## Local proof command

```text
/usr/bin/sandbox-exec -p '(version 1)(allow default)(deny network*)' node --test --test-concurrency=1 --test-reporter=spec test/productAssurance/systemic/formal/*.test.mjs test/productAssurance/systemic/formal/contracts/*.test.mjs
```

The root test scripts do not discover this packet-local test path. Wiring the
focused command into the combined acceptance harness is therefore a director-
owned insertion request, not a package edit by this satellite.

Under D-LAUNCH-22, the prior root-egress result is adjudicated
`KNOWN_PREEXISTING_TEST_EGRESS`; this non-candidate worker must not rerun the
root gate or touch server startup. The active gate is only the focused command
under total network denial.

The focused S3 gate passes 44/44 tests under total network denial, including
exact coverage of all 144 reachable M08-M13 transition-conformance rows.

The M01-M07 finite envelopes are unchanged in this deepening batch: growth is
zero states and zero transitions. Safe retrofitting was not cheap because it
would alter already-sealed abstraction semantics. The frozen-L scenarios are
represented explicitly by M08-M13 instead. Batch 2 content, receipt, and exact
commit identities remain pending until the reseal commit is created.

The batch-2 audit also made the finite envelopes stricter: a flat failed Volume
gate is `BLOCKED` with an absent action, each TLA+ module has a one-cut guard,
exchange-twin placement has an explicit liveness obligation, and durable
controls retain post-intent expiry, rejection, or finalization failure as
visible pending ambiguity with monotonic journal versions. The focused-suite
transition-conformance test is landed and green.

## Truth labels

Packet artifacts may be labelled `BUILT_AND_TESTED` and `SYNTHETIC_ONLY` after
the focused suite passes. They must never be labelled `WIRED`, `LIVE`,
`DEPLOYED_PROVED`, `INTEGRATED`, or `I00_ACCEPTED` by this satellite.
