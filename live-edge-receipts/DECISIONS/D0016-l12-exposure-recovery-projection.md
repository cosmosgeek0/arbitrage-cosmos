# D0016 — L12 is an owner-projection adapter, not a recovery authority

Decision: `ACCEPTED_FOR_IMPLEMENTATION`

Date: `2026-07-14`

## Ruling and scope

`D-LAUNCH-16` was verified in the canonical director state at commit
`a4a8ebd349e638e047a9ebf20bf6ec170376d08e`. The current worker scope baseline
is the latest qualifying director merge,
`3a8e17be71d21df14f6b236a563cb0595f9eb824`. Imported director history is not
re-audited against the lane allowlist.

L12 adds a data-only adapter under `server/src/liveEdge/adapters/**`. Capital
Foundation remains the position, capacity and economics owner. Foundation
remains the Risk, execution and reconciliation owner. Existing L09/L10/L11
families retain strategy/lifecycle proof. System Integration remains the
canonical supervisor and machine read-model owner.

The adapter therefore accepts structural injected projections. It neither
imports forbidden owners nor derives risk, PnL, capacity, exposure notional,
recovery actions or exchange/local set differences. It validates exact
identity and revision agreement, preserves unknowns, and emits an inert
snapshot with:

```text
projectionAuthority=OWNER_EVIDENCE_ADAPTER_ONLY
simulationAuthority=SYNTHETIC_FIXTURE
truthClass=SYNTHETIC_ONLY
sendEligible=false
canAuthorizeEntry=false
actionAuthority=NONE_RECORD_ONLY
externalActionAuthorization=NONE
```

Reverse Basis and Volume reconciliation remain explicitly
`OWNER_INJECTED_RECONCILIATION_EVIDENCE`; Foundation Spot/Perp reconciliation
is not stretched over those distinct owner dialects.

## Current primary-source check

Official Binance documentation was checked before implementation on
`2026-07-14`:

- Spot REST documents ambiguous timeout/5xx status, User Data Stream recovery,
  429 backoff and 418 bans:
  `https://developers.binance.com/en/docs/products/spot/rest-api`.
- Spot User Data Stream documents real-time account/order events:
  `https://developers.binance.com/en/docs/products/spot/user-data-stream`.
- USD-M User Data Streams document ordered private events, partial order
  updates and account/funding updates:
  `https://developers.binance.com/en/docs/products/derivatives-trading-usds-futures/user-data-streams`.
- Margin change history records the current token/subscription migration:
  `https://developers.binance.com/en/docs/products/margin-trading/change-log`.

The accepted L02 documentary matrix already contains the current Margin token
methods. No source-drift blocker or authorization expansion was found. No
exchange endpoint was called.

## False-green corrections

Independent adversarial review rejected the first draft because blocked chain
stages, divergent owner revisions, null complete economics and caller-asserted
campaign booleans could false-green. The corrected contract:

- enforces stage-specific canonical owners and prerequisite ordering;
- binds one truth/revision scope across Capital, reservation, execution,
  outstanding, reconciliation and recovery;
- ties the Risk verdict to the exact truth, dispatch revision, mutation ID and
  dispatch timestamp;
- makes incomplete truth, outstanding ambiguity and manual state require
  recovery/operator attention;
- requires closed schemas and bounded decimal strings;
- validates campaign envelopes against owner trace/state revisions, unique
  mutation identities, replay identity subsets and explicit terminal residual
  truth without claiming that structural validation authenticates an owner;
- executes the accepted L10/L07 owner reconstruction after every one of its
  nine valid durable event-state cuts, with exact checkpoint restoration and
  terminal liability/outstanding checks;
- behavior-tests the canonical Foundation plan/leg lifecycle vocabularies
  directly through their public execution-owner checkpoint and restore APIs,
  rather than copying those state machines into L12.

## Non-claim

L12 proves deterministic adapter behavior using injected synthetic owner
evidence. It does not prove live private acquisition, signed cold-start
clearance, deployed recovery, real exchange fills, or canary readiness. Those
remain owner-gated and are classified later by L16/L17.
