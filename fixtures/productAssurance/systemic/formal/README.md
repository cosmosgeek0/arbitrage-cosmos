# S3 critical-protocol formal packet

This subtree is the collision-free IP-ASSURANCE S3 satellite accepted by
`IP_ASSURANCE.md` section 7 and amendment section 4. It is supporting evidence
only. It does not implement a production evaluator, command authority, risk
gate, exchange hand, remediation controller, ledger, supervisor, or cockpit.

## Evidence boundary

- Seven finite protocol models cover ambiguity, two-leg recovery, execution
  fencing, repair campaigns, borrow liability, halt asymmetry, and cancellation
  boundaries.
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
node --test --test-concurrency=1 --test-reporter=spec test/productAssurance/systemic/formal/*.test.mjs test/productAssurance/systemic/formal/contracts/*.test.mjs
```

The root test scripts do not discover this packet-local test path. Wiring the
focused command into the combined acceptance harness is therefore a director-
owned insertion request, not a package edit by this satellite.

## Truth labels

Packet artifacts may be labelled `BUILT_AND_TESTED` and `SYNTHETIC_ONLY` after
the focused suite passes. They must never be labelled `WIRED`, `LIVE`,
`DEPLOYED_PROVED`, `INTEGRATED`, or `I00_ACCEPTED` by this satellite.
