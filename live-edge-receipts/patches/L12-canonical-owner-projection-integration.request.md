# L12 canonical owner-projection integration request

Request status: `QUEUED_FOR_I00`

Worker implementation status: `NOT_APPLIED_TO_SHARED_OWNER_FILES`

## Director-owned integration requested

At I00, compose the L12 exposure/recovery adapter from existing canonical
owners without introducing a second cache, position book, reconciliation loop,
recovery planner, persistence path or supervisor:

1. Inject Capital position, account-capacity, economics and supervision
   projections with one exact subject and accounting scope.
2. Inject Foundation Risk evidence bound to the exact mutation identity,
   current truth revision and immediate dispatch cut.
3. Inject Foundation execution/reconciliation evidence for Normal Basis only;
   preserve explicit owner-injected dialects for Reverse Margin and Volume.
4. Inject durable ticket/journal and outstanding/orphan evidence through the
   existing Ledger/System Integration persistence boundary.
5. Feed the resulting snapshot into the existing System Integration supervisor
   through a narrow read-only probe; do not expose it as a second API truth.
6. Keep cold start halted until authorized private streams and signed reads are
   complete. Do not substitute offline fixtures for deployed completeness.

## Required director tests

- all revisions bind to one subject/accounting scope;
- requested quantities cannot enter exposure truth;
- no reservation/open-order/position/liability double counting;
- stale or incomplete private truth cannot clear recovery;
- restart/replay uses stable mutation identities and never repeats a venue
  action;
- missing owner evidence renders `UNKNOWN`, `MISSING` or `BLOCKED`, never zero
  or healthy;
- the canonical supervisor remains the only UI-facing source.

This request grants no private-read, signed-action, deploy, restart, cloud,
money-path, merge or push authority.
