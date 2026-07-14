# Zero-capital game-day — canary loss cap

Status: **DRAFT — OWNER SIGN-OFF REQUIRED — NOT EXECUTED**

Inherits `00-zero-capital-common-safety.md`.

## Objective

Exercise the inherited 10-USDT canary envelope as pure policy evidence without an order, credential, private read, or capital allocation.

## Frozen synthetic envelope

```text
maximum aggregate allocated capital: 10 USDT equivalent
maximum active strategy tickets: 1
maximum automatic repeats after closure: 0 until owner re-arm
maximum aggregate canary loss: 2 USDT
unknown/stale/mismatch: no new entry
withdrawal/transfer: impossible
```

## Candidate-bound plan

1. Bind `BIND_AT_CANDIDATE_CANARY_ENVELOPE_SCENARIO` and assert the fixture is persistently labelled `SYNTHETIC_ONLY` with execution authority false.
2. Prove 10 USDT is aggregate—not per leg, stage or strategy—and separately display Spot, Futures, Margin liability, gross notional, net/unhedged exposure and recovery reserve.
3. Inject deterministic loss components: realized loss, negative unrealized PnL, fees, funding, borrow interest and conservative recovery cost.
4. At `1.999...` USDT, assert the remaining allowance is conservative and no automatic size increase occurs.
5. At exactly `2 USDT`, assert effective `HALTED`, no new entry/addition, zero automatic repeats and explicit new-owner-authorization requirement.
6. Inject exchange-minimum math that cannot fit the 10-USDT structure. Assert exact `BLOCKED_BY_MIN_NOTIONAL`; never raise capital or leverage.
7. Restart and assert the loss epoch, halt and re-arm requirement persist unchanged.

## Required pass evidence

No ordinary cockpit toggle can change a hard ceiling. Any later ceiling revision requires reviewed configuration/deployment identity and a new separate authorization. This drill itself keeps actual capital/notional/external effects at zero.
