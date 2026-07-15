# R3-D-CRASH-015 correction receipt

**Finding:** `R3-D-CRASH-015`

**Severity:** High

**Outcome:** corrected inside the accepted Product readback boundary

**Correction base:** `68bc44eac17e0196f0a18bbfd14b567860821058`

**Correction-base tree:** `7eaebf41e335749f36097beb4e28be86e5345f8b`

**Governing verifier receipt:** `/Users/cosmosgeek/Desktop/role3-verify/ROLE3_VERIFICATION_RECEIPT.md`

## Reproduction

Current source independently reproduced the accepted cross-boundary loss. The
canonical Ledger-backed boot/release adapter already retained bounded history,
classified the incomplete prior generation `CRASH_PENDING`, and published
`CRASH_PENDING_BOOT_PRESENT`. Product Runtime consumed only the latest active
record for revision identity; its authenticated envelope had no boot/crash
readback, and a read exception collapsed to invisible `null`.

The new focused regression was run before the correction. It used one isolated
`DATA_DIR`, loopback-only ephemeral ports, the private-egress tripwire, and a
real three-process sequence: g1 clean `SIGTERM`, g2 confirmed `SIGKILL`, then g3
against the same Ledger. The authenticated g3 Product response was reached,
but the test failed when `bootReleaseReadback` was absent. The independent
unavailable/malformed case also observed no projection. Exact pre-correction
result: exit `1`, `0/2`.

This is historical crash visibility, not current restart-barrier truth. The
canonical persistence adapter, startup composition, reconciliation owner, and
readiness owner were not changed.

## Smallest-boundary correction

Product Runtime now exposes one required, typed `bootReleaseReadback`
projection sourced only from the canonical System Integration Ledger adapter.
It preserves:

- exact source/state and latest record;
- at most `20` owner-ordered history rows;
- generation, operation, correlation, and Ledger event identities;
- tested/deployed/config/schema/model identity and exact identity issues;
- start/completion timestamps, clean/blocker state, and lifecycle;
- exact crash-pending operation IDs and reason codes; and
- immutable `deploymentMutationAuthority: NONE`.

The Product projection validates rather than reclassifies lifecycle. It
requires exact keys; bounded history, reason, crash-ID, and identity-issue
collections; safe-integer positive schema revision; canonical identity-issue
coherence; exact latest/history equality; descending generation/event/time
order; non-overlapping generations; no historical `ACTIVE` row; exact
terminal timestamp/clean coherence; exact crash-ID/reason derivation; and the
owner's unresolved-revision rejection law. Any absent, throwing, malformed,
unbounded, sentinel-prefixed, contradictory, or forged read becomes an
explicit `UNAVAILABLE` Product subprojection with empty history and an exact
reason. It cannot hide the rest of the authenticated envelope.

Release revision claims are now derived only from this validated Product
projection. Invalid, unavailable, empty, unknown-identity, or non-`ACTIVE`
latest truth withholds tested, deployed, config, and model revisions. A tested
commit still never fabricates an absent deployed commit.

The browser wire type and decoder require the same bounded relational contract.
The client preserves valid canonical history without a second cache or owner
and rejects missing, unbounded, reordered, overlapping, historical-active,
sentinel, unsafe-schema, lifecycle-contradictory, crash-ID-mismatched, or
revision-mismatched input. Synthetic fixtures publish honest `UNAVAILABLE` /
`SYNTHETIC_ONLY` boot truth and null release revisions.

## Focused and family proof

The corrected process test explicitly enables deterministic offline public
sources. In g3 it proves:

- HTTP Product supervisor read `200`, while readiness remains `503`;
- current g3 operation/correlation/generation and all four injected release
  identity values are exact;
- g2 remains exact generation `2`, operation
  `system.application.boot.g2`, correlation `system-boot-g2`, null
  completion/clean, and `CRASH_PENDING`;
- history is exactly g3 `ACTIVE`, g2 `CRASH_PENDING`, g1
  `CLEAN_COMPLETED`;
- crash IDs and reasons are exactly
  `system.application.boot.g2` / `CRASH_PENDING_BOOT_PRESENT`;
- machine readiness remains `NO` and unrelated reconciliation remains
  fail-closed; and
- public/private egress sentinel files remain absent.

Measured post-correction results:

- server build: exit `0`;
- real process plus hostile Product projection: exit `0`, `2/2`;
- web typecheck and production build: exit `0`; Vite transformed `1,883`
  modules with only the existing advisory chunk-size warning;
- focused browser wire contract: exit `0`, `2/2`;
- canonical boot adapter/Product runtime/routes focus: exit `0`, `34/34`;
- complete Product Integration family: exit `0`, `111/111`;
- complete Product Control family: exit `0`, `102/102`;
- `git diff --check`: exit `0`.

Two independent final reviews approved the correction after hostile bounds,
sentinel-prefix, unsafe-schema, historical-active, chronology/overlap, and
failed-start child-cleanup gaps were closed. Final C2-bound crash/restart and
complete acceptance remain separate and pending.

No live/test order, private or signed exchange call, deployment, push, merge,
current-main mutation, or protected-owner-directive mutation was authorized or
performed.
