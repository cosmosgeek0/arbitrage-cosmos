# AI-OPS A2X shadow extension receipt

## Receipt identity

- Status: `SHADOW_SPECULATIVE`
- Stop condition: `A2X_SHADOW_READY`
- Generated at: `2026-07-15T10:18:03Z`
- Branch: `aiops-shadow-a2-20260715`
- RUN-14 directive candidate/base reference: `098f7b9449ab3b1c26bda19f51537bfea01d4c48`
- Sealed A2 receipt commit and A2X parent: `ca1fb094e19d0ccc6a8397ee08a65a662d051bd3`
- Sealed A2 implementation commit: `062b533e9ab43ff82ccde7c2728f01deae58eadf`
- Actual merge base with the directive reference: `03857dcdaff8d8b12627d27ddcc97505da1f2f86`
- A2X implementation commit: `8629127fcbc7d017c09399a3fe7a091031af5672`
- A2X implementation delta: 16 files, 3,853 insertions, 2 deletions
- Receipt path: `fixtures/aiOps/caseRuntime/AI_OPS_A2X_SHADOW_RECEIPT.md`

The exact directive reference `098f7b9449ab3b1c26bda19f51537bfea01d4c48`
is not an ancestor of the sealed artifact or the A2X implementation. RUN-14 is
therefore a forward extension of sealed A2 commit
`ca1fb094e19d0ccc6a8397ee08a65a662d051bd3`, whose actual merge base with that
reference is `03857dcdaff8d8b12627d27ddcc97505da1f2f86`. No rebase, reset,
cherry-pick, candidate port, merge, or push was performed.

This receipt records a lane-local speculative shadow artifact only. It grants
no C2, director adjudication, integration, acceptance, deployment, production,
or operational status. Possible porting remains conditional on C2 and director
adjudication under D-LAUNCH-37, order `90dcac299155`.

## Entry gate

The executable entry gate is
`fixtures/aiOps/caseRuntime/entry-gate.a2x.v1.json`. Its 18 exhaustive proposed
rows were classified before implementation:

| Classification | Rows | Build disposition |
| --- | ---: | --- |
| `ADOPT_EXISTING` | 5 | No build; reuse the sealed A2 or canonical owner |
| `ADAPT_EXISTING` | 6 | Build only a bounded A2 lane adapter or focused harness repair |
| `MISSING_BUILD` | 2 | Build only immutable focused fixtures |
| `REFERENCE_ONLY` | 2 | Record an insertion request; create no owner |
| `REJECT_DUPLICATE` | 3 | No build |

Only the six `ADAPT_EXISTING` rows and two `MISSING_BUILD` rows were built.
Existing incident normalization/admission, diagnostics, aggregate budgets,
context handoffs, persistence, Ledger ownership, Foundation replay, provider
routing, dispatch, and supervisor ownership were not rebuilt.

## Scope delivered

1. A pure, closed, provider-neutral CloudEvents-style intake adapter delegates
   to the existing A2 observation normalizer. It binds replay identity to
   source plus event ID, validates bounded occurrence time and W3C trace
   context, preserves delivery classification separately, and quarantines a
   missing provider sequence as `null` instead of inventing order.
2. A case-local escalation intent requires the existing Product Assurance
   `REQUEST_OWNER_HANDOFF` adjudication and an exact, current, signed synthetic
   incident-to-case and target-owner binding. Its output remains an inert
   no-authority projection.
3. Provider-neutral usage depth preserves input, output, cached, cache-write,
   and reasoning token subsets, measured-cost currency and pricing lineage,
   and safe aggregate conversion. Owner facts require exact content digests
   and synthetic-only signatures; unknown cost remains unavailable.
4. Provider rate depth projects request, input-token, output-token,
   total-token, concurrency, cooldown, window, and freshness facts. It is
   explicitly read-only and creates neither a reservation nor operational
   authority.
5. Fresh-session handoff consumption now has bounded immutable state,
   revision checks, idempotent exact replay, conflict evidence, contiguous
   hash-chained receipts, canonical serialization, and hostile cold-restart
   validation. This is a deterministic projection, not a second store.
6. Immutable replay fixtures cover multi-provider intake, missing sequence,
   known and unknown cost, rate projection, and fresh-session cold restart.
7. The existing dirty-worktree scope test was repaired to preserve the leading
   Git porcelain XY status column, closing a false-negative in first-path
   detection without changing package discovery.

All facts, signers, provider events, costs, and sessions used here are
obviously synthetic and deterministic. Production code has no ambient network,
filesystem, subprocess, environment, timer, clock, randomness, provider SDK,
or second-store dependency. No money path or effect authority exists.

## Changed-path inventory for implementation commit

Fixtures and entry evidence:

1. `fixtures/aiOps/caseRuntime/a2x-replay-fixtures.v1.json`
2. `fixtures/aiOps/caseRuntime/entry-gate.a2x.v1.json`
3. `fixtures/aiOps/caseRuntime/insertion-requests.a2x.v1.json`

Production sources:

1. `server/src/aiOps/caseRuntime/budget.ts`
2. `server/src/aiOps/caseRuntime/context.ts`
3. `server/src/aiOps/caseRuntime/diagnostic.ts`
4. `server/src/aiOps/caseRuntime/escalation.ts`
5. `server/src/aiOps/caseRuntime/eventIntake.ts`
6. `server/src/aiOps/caseRuntime/index.ts`

Focused tests:

1. `test/aiOps/caseRuntime/a2x-entry-gate.test.mjs`
2. `test/aiOps/caseRuntime/a2x-replay-fixtures.test.mjs`
3. `test/aiOps/caseRuntime/budget-depth.test.mjs`
4. `test/aiOps/caseRuntime/escalation-intent.test.mjs`
5. `test/aiOps/caseRuntime/event-intake.test.mjs`
6. `test/aiOps/caseRuntime/handoff-consumption.test.mjs`
7. `test/aiOps/caseRuntime/purity-network-deny.test.mjs`

The receipt is a seventeenth exclusive-path artifact committed separately so
the implementation SHA and its exact 16-path delta remain immutable.

## Verification evidence

Static verification:

```text
npm run typecheck -w server
```

Result: exit 0.

```text
npm run build -w server
```

Result: exit 0.

Complete focused caseRuntime verification:

```text
node --import ./test/aiOps/caseRuntime/network-deny.mjs --test --test-concurrency=1 --test-reporter=spec test/aiOps/caseRuntime/*.test.mjs
```

Result: 179 tests, 179 passed, 0 failed, 0 cancelled, 0 skipped, and
zero network attempts. This includes executable success, hostile-input,
boundary, replay, signature, stale-fact, capacity, conflict, restart, scope,
credential, production-purity, and network-denial proofs.

Additional checks:

- `git diff --cached --check`: passed before the implementation commit.
- Exclusive-path audit: 16 implementation paths; zero out-of-scope paths and
  zero symlinks.
- JSON fixture parse: all three new JSON fixtures parsed successfully.
- Credential audit: the focused test found no high-confidence credential
  material.
- Receipt-present purity recheck: 6 tests, 6 passed, 0 failed, including the
  exclusive-path, credential, insertion-request, production-purity, and zero
  network-attempt assertions.
- Read-only peer review: the final review found no remaining concrete issue in
  event reason capacity, handoff prevalidation, signed usage/rate facts, or
  signed escalation owner binding.

Under the same-machine rule, no full repository, browser, performance, or soak
suite was run. An active fix owner retains those heavy-suite responsibilities;
their omission is deliberate and is not represented as shared-repository
verification.

## Limitations and non-claims

1. Intake is a closed CloudEvents-style projection, not a claim of general
   CloudEvents transport or protocol conformance.
2. A2X opens no listener or transport, owns no router or source cursor, applies
   no cursor-gap policy, publishes no incident, and acknowledges no delivery.
3. Missing provider sequence is quarantined. No total order is inferred.
4. Event kinds, usage shapes, reason categories, and identities remain
   lane-local. Provider-native categories require normalization by their
   accepted owner before any future port.
5. Cost and rate inputs are signed `SYNTHETIC_ONLY` facts. A2X owns no
   production trust, price table, currency conversion, provider truth,
   limiter, semaphore, or atomic reservation. Unknown cost remains `null` and
   cannot become a fabricated zero.
6. Escalation is a case-local inert intent with a signed synthetic owner
   binding. It performs no notification, delivery, acknowledgement, attention
   ordering, global severity, remediation, effect, or case transition.
7. Handoff consumption state is serializable evidence only. It is not Ledger
   persistence, a crash-safe or transactional CAS, exactly-once launch,
   production signing, canonical session identity, or launch authority.
8. No package root, shared schema, router, startup, registry, `STATE.md`, Main,
   role4-fix, candidate, or other worktree was modified.
9. No real credential, network mutation, order, deployment, capital, transfer,
   withdrawal, borrow, repay, leverage, or margin behavior was added or used.
10. C2 and director adjudication remain outstanding. Nothing in this artifact
    may be ported or promoted before both occur.

## Typed insertion requests

The six additive A2X requests are sealed in
`fixtures/aiOps/caseRuntime/insertion-requests.a2x.v1.json`:

1. `A2X-I00-INTAKE-001` — accepted incident router, cursor/gap ownership,
   material vocabulary, durable publication, acknowledgement, and readback.
2. `A2X-I00-PERSIST-001` — singleton Ledger atomic event admission and handoff
   consumption CAS with capacity, conflict, restart, and case-transition
   semantics.
3. `A2X-I00-ESCALATION-001` — canonical incident-to-case and target-owner
   readback, supervisor attention insertion, dispatcher delivery,
   acknowledgement, and bounded readback.
4. `A2X-A3-PROVIDER-001` — accepted usage and price facts, registered
   production trust, rate/concurrency/cooldown truth, and atomic aggregate
   reservation bound to the diagnostic run.
5. `A2X-I00-TRUST-001` — production signer registration and rotation,
   canonical session identity, durable one-time consumption, and replay
   adjudication.
6. `A2X-I00-GATES-001` — after C2 and director adjudication only, port approved
   rows into a fresh accepted worktree, bind accepted contracts, update shared
   discovery and state, and rerun the complete acceptance loop.

These requests are additive and do not supersede or close the ten insertion
requests in `fixtures/aiOps/caseRuntime/insertion-requests.v1.json` from sealed
A2. They create no owner or authority in RUN-14.

## Primary-source design basis

Research was completed before implementation and constrained the adapters to
current primary specifications and provider documentation:

- CloudEvents specification 1.0.2:
  `https://github.com/cloudevents/spec/blob/main/cloudevents/spec.md`
- W3C Trace Context Recommendation:
  `https://www.w3.org/TR/trace-context/`
- OpenTelemetry event and session semantic conventions:
  `https://opentelemetry.io/docs/specs/semconv/general/events/`
  and `https://opentelemetry.io/docs/specs/semconv/general/session/`
- OpenAI API reference overview:
  `https://developers.openai.com/api/reference/overview#backwards-compatibility`
- Anthropic Messages usage types and rate-limit documentation:
  `https://platform.claude.com/docs/en/api/typescript/messages` and
  `https://platform.claude.com/docs/en/manage-claude/rate-limits-api`

The portable lesson is limited to neutral event identity, explicit trace and
session correlation, decomposed usage accounting, and owner-supplied rate
facts. No external provider schema is promoted as a canonical repository
contract.

The artifact stops here as `A2X_SHADOW_READY` only.
