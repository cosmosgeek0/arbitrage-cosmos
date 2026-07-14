# Zero-capital game-day common safety law

Status: **DRAFT — OWNER SIGN-OFF REQUIRED — NOT EXECUTED**

Every drill in this directory is a deterministic local-fixture plan with:

```text
capital ceiling: 0
notional ceiling: 0
credentials: none
network: forbidden (literal loopback harness only when already accepted)
external authorization: none
external mutation: none
service/deployment/vendor mutation: none
money/private/signed/Margin action: none
```

These plans do not prove production behavior. They prepare evidence fields and expected fail-closed outcomes for later execution against the independently verified candidate. The director must replace every `BIND_AT_CANDIDATE` marker with an existing repository command; do not invent a conflicting command name.

## Entry gate

- exact candidate SHA/tree and independent-verifier receipt bound;
- clean disposable local checkout pinned to those bytes;
- no `.env`, credential, private account material or external endpoint configured;
- injected deterministic clock and fixture IDs recorded;
- baseline component inventory and canonical supervisor snapshot captured;
- result and reconciliation receipt targets distinct;
- abort handler tested before fault injection.

## Universal abort conditions

Abort without further action on any unexpected network attempt, credential request, money-path call, external process/vendor mutation, unbounded queue/retry, false-green state, missing ledger evidence, or mismatch between expected and observed candidate identity.

## Evidence record

Each completed local drill records candidate SHA/tree, fixture hashes, injected clock, exact command/argv, exit code, assertions, before/fault/recovery snapshots, component-inventory deltas, bounded-resource measurements, result receipt, reconciliation receipt, and unresolved findings. `PASS` is forbidden unless every expected failure was observed and recovery never erased exposure, liability, ambiguity, or incident history.
