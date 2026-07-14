# L06 director integration request — canonical Ledger compare-and-append

Status: `LANE_READY_ONLY`

L06 proves a pure append/reducer protocol with injected persistence
acknowledgements. It does not write the canonical Ledger. Production
persist-before-send requires a director-owned System Integration insertion and
I00 acceptance.

## Existing seam and exact gap

The existing `Ledger.setConfigValueAndLogEvent` atomically writes one config
value and one event. `SystemLedgerPersistenceAdapter.applyIdempotentTransition`
adds bounded restart-stable idempotency receipts and post-commit readback.

The config write is an unconditional upsert. Two independently loaded adapter
instances can both prepare checkpoint revision `N+1`; SQLite serializes their
writes but does not compare the persisted previous value for the application.
A single-adapter fake therefore cannot prove database-level stale-writer
exclusion.

`logEventsAtomically` and trace append are not substitutes: neither supplies
expected-version CAS, trace indexes are bounded/evictable, and a replay may
return no Ledger event ID.

## Required canonical insertion

The director should add one narrow primitive to the existing Ledger structural
port and one System Integration adapter method. Equivalent naming is allowed,
but semantics must be exact:

```ts
compareAndSetConfigValueAndLogEvents(
  key: string,
  expectedValue: string | null,
  nextValue: string,
  records: readonly LedgerEventInput[],
):
  | { committed: true; events: readonly LedgerEvent[] }
  | { committed: false; reason: 'VERSION_CONFLICT'; currentValue: string | null };
```

Inside one existing-Ledger SQLite transaction it must:

1. read and compare the exact persisted value/version;
2. reject stale expected state without writing any event;
3. write the next checkpoint/config value;
4. append the dedicated mutation-journal record and canonical audit record;
5. commit all or none;
6. publish listeners only after commit;
7. recover a post-commit listener throw by exact config/event readback without
   returning a false failure that could trigger a second mutation.

System Integration then implements exactly one
`LiveEdgeMutationJournalPersistenceAdapter` that:

- consumes the closed L06 append request;
- calls L06's pure `validateMutationAppendRequest` and
  `applyMutationAppendRequest` against the exact prior checkpoint rather than
  duplicating the reducer;
- validates canonical/bounded/secret-free data using sorted-key canonical JSON
  encoded as UTF-8: entry and append request at most 131,072 bytes, resulting
  checkpoint at most 524,288 bytes;
- binds idempotency key and request digest;
- uses the database-level compare-and-append primitive;
- returns the exact L06 acknowledgement with committed/replayed/conflict/failure
  disposition, positive Ledger event ID, versions and lineage digests;
- retains append-only recovery records inside the canonical Ledger boundary;
- refuses unsafe idempotency/journal eviction and blocks when capacity is
  exhausted;
- never calls an exchange, signer, private reader, execution port or retry.

The acknowledgement's single `ledgerEventId` must identify the dedicated
mutation-journal Ledger event returned by the atomic transaction. The second
canonical audit event remains in the same transaction and is verified by the
adapter readback, but its ID is not substituted into the L06 acknowledgement.
The persisted checkpoint key must be the one exact mutation-journal key chosen
by System Integration; no alternate cache/config key may participate in
version comparison.

The L06 boundary decision is a repeatable pure eligibility projection with
`sendAuthorized=false`, not a one-use send permit. A future authorized
dispatcher would additionally require a separate atomic consume/lease design;
this CAS request alone must never be interpreted as dispatch authority.

## Required director tests

- two independently loaded adapters racing from revision `N`: exactly one
  commits and the loser returns version conflict with zero audit/journal rows;
- process crash/power-loss fixture before commit: no state or event;
- post-commit listener failure: readback returns the one committed receipt and
  does not append again;
- restart replay: exact request returns `IDEMPOTENT_REPLAY`, different digest
  returns conflict, and neither grants another L06 synthetic permit;
- config/checkpoint and both events are never split;
- full/corrupt/stale/secret-bearing state fails closed;
- money-critical journal remains reconstructable when noncritical trace or
  Intelligence Runtime recording is degraded;
- `LIVE_EXECUTION_NOT_IMPLEMENTED` and zero exchange calls remain enforced.

## Non-effects

- No new database, table, file store, outbox daemon, ticket owner, execution
  coordinator or reconciliation engine.
- No production wiring, private query, signed/test/live order, deployment,
  restart, cloud mutation or capital change is authorized by this request.
- The lane remains `BUILT_AND_TESTED` / `UNWIRED`; only director integration and
  I00 may claim canonical persistence.
