# L14-001 — durable control command boundary

Status: `ACCEPTED_FOR_LANE_L14`

Date: `2026-07-13`

## Decision

L14 is one adapter over accepted canonical owners. It owns strict control
request/preview/event/receipt value contracts and orchestration of injected
ports. It owns no command database, Ledger writer, risk/capital/approval/
position/recovery verdict, exchange truth, signer, transport or production
route.

The adapter uses:

- an injected authenticated-operator identity port;
- an injected preview mint/seal/verify port;
- injected canonical control state and exchange-truth snapshots;
- the canonical Foundation Risk decision port;
- an injected System Integration Ledger persistence port;
- canonical owner inspect/apply ports; and
- the accepted Foundation Control Plane contract for its exact existing
  `control-plane-runtime` lifecycle commands.

The source may structurally type those ports but may not import a second
authority or persist locally.

## Integrity and replay law

- Canonical JSON bytes are SHA-256 committed for actions, previews, events,
  append requests and hash-chain heads.
- Preview authorization binds the server-derived operator/session identity,
  action, risk witness, expected config/control versions and deadline.
- The canonical persistence transaction must atomically reserve
  `expectedControlRevision + 1` before any owner publication.
- Same command ID plus same digest/actor replays the exact terminal success or
  rejection. Same ID plus different digest/actor is an idempotency conflict.
- Terminal receipts bind their two positive Ledger event IDs and the exact
  revision reserved by that command, not a later ambient revision.
- Owner publication that throws, returns malformed evidence, crosses expiry or
  cannot be durably finalized remains a pending ambiguous outcome.
- Pre-intent security rejection audits do not reserve the authentic command
  ID. Post-intent rejection produces a terminal bound rejection receipt.

## Risk and recovery law

Risk-bounded action previews bind the Foundation Risk witness to the same
current complete exchange-truth revision, measure revision, exact current
value and declared maximum. Final validation re-reads truth and requires the
projected post-action exact decimal to be no larger than both the current value
and declared maximum.

`ACKNOWLEDGE_RECOVERY` is an awareness record only. It never calls an owner
that can clear recovery and its durable receipt states
`recoveryStateChanged=false`.

Actions requiring a concrete order policy, recovery plan, arming policy or
repayment policy that does not exist at accepted L06 use exact versioned opaque
`WAITING_L08` references. They are validated but never dispatched by L14.

## Current primary-source basis

The following current primary/authoritative sources were reviewed immediately
before implementation on `2026-07-13`:

- IETF HTTPAPI Idempotency-Key draft 07:
  <https://datatracker.ietf.org/doc/html/draft-ietf-httpapi-idempotency-key-header-07>
- RFC 9110 conditional request semantics, including `If-Match`:
  <https://www.rfc-editor.org/rfc/rfc9110.html#section-13.1.1>
- RFC 8785 JSON Canonicalization Scheme:
  <https://www.rfc-editor.org/rfc/rfc8785.html>
- NIST SP 800-63B authentication/session guidance:
  <https://pages.nist.gov/800-63-4/sp800-63b.html>
- OWASP Transaction Authorization guidance:
  <https://cheatsheetseries.owasp.org/cheatsheets/Transaction_Authorization_Cheat_Sheet.html>

The IETF document is an active draft, used only for current idempotency design
direction. The binding project law comes from the repository directive and
accepted canonical contracts.

## Explicit non-effects

No private/exchange/account endpoint was called. No credential, browser
secret, signed request, order, Margin action, capital change, database write,
deployment, restart, cloud mutation or push is authorized or implemented.
