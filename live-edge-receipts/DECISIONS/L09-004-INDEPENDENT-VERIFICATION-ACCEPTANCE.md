# L09-004 — independent verification acceptance after F-BRIDGE

Decision status: `L09_ACCEPTED`

Decision date: `2026-07-13`

Implementation reviewed:
`a7a0f7c8f154539b05b7fb9845f1a4a3dec60eb8`

## Decision

Accept L09 at the lane boundary as
`LANE_READY_BUILT_AND_TESTED_UNWIRED`.

The director rebase contains accepted F-BRIDGE cut `c900907`, which supplies
the canonical opening-remainder and cold-restart hydration/reconciliation
seams required by the first two L09-003 findings. D-LAUNCH-11 assigned the
remaining shard correction to exact L09-003 items 3 and 4. Those items are
closed by implementation `a7a0f7c` without changing Foundation, shared source,
package, route, service, UI, reverse-Basis or Volume paths.

## Item 3 disposition — accepted owner lifecycle truth

- Positive fixtures obtain proposal identity from the real Basis engine and
  canonical read model, and obtain allocation, reservation, staged-plan and
  mandate identities from the existing Capital owners.
- Foundation Risk evaluates the actual bound intent and owner identities.
- State is admitted only from canonical checkpoint bytes restored by the
  injected Foundation hydration seam. Envelope, checksum, plan, revision,
  state revision, event stream, leg definitions and replayed state must agree.
- The exact owner `LEG_SUBMISSION_STARTED` cut proves each leg request.
  Entry hedge sizing requires terminal Spot truth; close/recovery sizing uses
  checkpoint residual truth.
- Agreement invokes the injected canonical Foundation reconciler with the
  hydrated owner state and validates its complete result. The local fill-ratio
  reducer and caller-shaped `rev_*` owner-state shortcut are removed.
- Every retained observation checkpoint must be an event-stream ancestor of
  final owner truth, and exactly one observation is required for every
  submitted owner leg.
- Recovery recommendations retain plan ID, correlation ID, checkpoint,
  owner revision, state revision, reconciliation revision, evaluation time,
  action, risk effect, reason, phase, leg key, leg ID, client-order ID and a
  deterministic recommendation revision.
- Partial-fill proof uses Foundation terminal lookup before hedge sizing.
  Cold-restart proof uses fresh ports and actual Foundation restore, then
  lookup, canonical reconciliation and hedge. No pre-crash in-memory
  observation authorizes progression.

## Item 4 disposition — exact mutation identity

Every order attempt retains and cross-binds the exact six-field lineage:

1. positive safe request sequence;
2. request ID;
3. intent fingerprint;
4. sanitized-request-content hash;
5. private-projection revision;
6. Foundation reconciliation-result revision.

The four semantic legs use distinct sequences `1`, `2`, `3`, `4` and distinct
derived transport identities. Tests reject every one-field substitution and a
coherently reconstructed sequence-zero L06 request. Plan attempt and order
attempt remain separate canonical concepts.

## Verification finding

Three fresh read-only independent verification passes returned `ACCEPT`. They
confirmed the owner chain, exact checkpoint ancestry, canonical reconciliation,
complete recovery lineage, six-field mutation binding, deep immutability,
bounded evidence, import purity, fresh-port cold restart and no external-action
surface.

Measured gates:

- normal Basis `23/23`;
- exchange twin `78/78`;
- execution policy `49/49`;
- Foundation execution `173/173`;
- accumulated LiveEdge `1,246/1,246`;
- frozen protocol `22/22`;
- standard deterministic battery `377/377`;
- import purity `4/4`;
- build, typecheck and diff-whitespace checks pass.

## Full-suite baseline exception

`npm run test:all` was run and is not represented as green. It passes every
stage before the unchanged System Integration suite, where the result is
`179/180`: `authority.scenarios.test.mjs:521` expects `PARTIAL` and receives
canonical `DIVERGED`.

The exact isolated failure is `28/29` both in the current tree and in a clean,
successfully built archive of pre-correction commit `ecd8006`. The failing
scenario does not import normalBasis, and its test plus relevant Foundation
source blobs are identical to `ecd8006`. This is an evidenced shared baseline
exception, not a regression from `a7a0f7c`; widening the L09 shard to alter it
is not authorized.

## Preserved boundary

No runtime/test network call or exchange/private-account action occurred. No
signer, credential, signed/test/live order, real send/query/cancel, Margin,
capital, cloud, deployment, process restart, withdrawal, transfer, merge or
push occurred. The implementation remains PAPER, synthetic, non-sendable,
`NONE_RECORD_ONLY`, and external authorization `NONE`.

`LIVE_EXECUTION_NOT_IMPLEMENTED` remains enforced. Integration and wiring stay
director-owned.
