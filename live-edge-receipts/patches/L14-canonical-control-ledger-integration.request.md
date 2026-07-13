# L14 director integration request — canonical durable control persistence

Status: `LANE_READY_ONLY`

Disposition: `DEFERRED_TO_I00`

L14 defines and tests a pure durable-control adapter against injected
persistence. Canonical database persistence is not proved or wired. This is a
shared System Integration/Ledger need and is outside the shard's exclusive
write scope.

## Why accepted L06 cannot be reused directly

The accepted L06 journal is a closed order-mutation journal. Its records
require real strategy, Capital, plan/leg, product/account, order and preflight
lineage. Encoding a generic control intent as an L06 order mutation would
fabricate identities and create false execution truth.

L14 therefore reuses only L06's accepted exact-decimal comparison helper. It
does not widen the L06 record set, edit `server/src/ledger.ts` or create a
parallel store.

## Required director-owned insertion

System Integration should implement the L14
`CanonicalControlPersistencePort` over the existing canonical Ledger. One
atomic transaction must:

1. validate the closed append request and canonical digest;
2. compare the exact per-command journal version/head;
3. for `CONTROL_INTENT_COMMITTED`, compare config version and atomically
   reserve the global expected control revision;
4. append the dedicated closed control event and canonical audit event;
5. bind idempotency key to append-request digest;
6. return exact committed/replayed/conflict/expired/failure acknowledgement,
   positive Ledger event identity, committed head/version and current global
   config/control versions;
7. reconstruct exact `PENDING`, `COMPLETED` and terminal `REJECTED` lookups
   after restart; and
8. keep pre-intent rejection audits non-reserving while preserving them as
   redacted security evidence.

The canonical owner-consume path must serialize intent reservation and
application, enforce the bound deadline/config/control versions, and never
convert an ambiguous publication into a rejected or applied terminal record.

## Required integration tests

- two process/adapter instances racing one global control revision: exactly
  one reserves and publishes;
- exact replay after restart returns the original terminal success/rejection;
- same command ID with a different digest/actor conflicts without publication;
- config/control CAS conflict appends no intent;
- crash before commit writes nothing; crash after intent leaves `PENDING`;
- post-commit listener/readback failure cannot append or publish twice;
- rejection-audit identity mismatch cannot reserve/poison the authentic ID;
- canonical control and audit records are never split;
- corrupt, stale, secret-bearing or oversized state fails closed; and
- `LIVE_EXECUTION_NOT_IMPLEMENTED` and zero exchange calls remain enforced.

## Non-claims

L14 retains `persistenceProven=false`, `UNWIRED` and
`externalActionAuthorization=NONE` until director integration and I00. This
request authorizes no new database, route, exchange client, private read,
signed/test/live order, Margin action, capital change, deployment, restart,
cloud mutation or push.
