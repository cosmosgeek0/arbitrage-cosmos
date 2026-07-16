# AI-OPS A2 shadow artifact receipt

## Receipt identity

- Status: `SHADOW_SPECULATIVE`
- Stop condition: `SHADOW_ARTIFACT_READY`
- Generated at: `2026-07-15T01:24:02Z`
- Branch: `aiops-shadow-a2-20260715`
- Exact base SHA: `03857dcdaff8d8b12627d27ddcc97505da1f2f86`
- Implementation commit SHA: `062b533e9ab43ff82ccde7c2728f01deae58eadf`
- Implementation delta: 21 files, 11,847 insertions
- Receipt path: `fixtures/aiOps/caseRuntime/AI_OPS_A2_SHADOW_RECEIPT.md`

This receipt records a lane-local speculative artifact only. It grants no
`PRESTAGE_READY`, integration, acceptance, deployment, or operational status.
No push or merge was performed.

Under D-LAUNCH-29 and owner amendment `46549feced32`, an
`INTEGRATED_ACCEPTED` decision does not promote this artifact in place. The
implementation diff must be ported into a fresh worktree from the accepted
SHA, rebound to the then-accepted interfaces, rechecked, and the entire lane
acceptance loop rerun before any real receipt may be issued.

## Scope delivered

- Incident admission with independent severity and model-depth projections,
  canonical normalization/template mining/fingerprinting, replay-safe dedup,
  inhibition, cooldown, and stable storm parenting.
- Bounded evidence bundles with deterministic redaction, hostile-input
  investigation quarantine, effect-zone fencing, and exact owner pointer
  validation.
- Durable case lifecycle with revision/generation fencing, restart,
  backpressure, bounded compaction/resume, attempt lineage, DLQ/redrive, and
  global-effect intent/readback accounting.
- Signed bounded context manifests and fresh-session handoffs with exact
  lineage, expiry, trust-root, budget, evidence, and one-time-consumption
  verification seams.
- Inbox/outbox/DLQ/global-effect and attempt-ledger adapters over the existing
  canonical Ledger CAS contract. No database, event bus, queue, or second
  ledger was created.
- Provider usage budgets, measured-usage lineage, deterministic fake provider
  routing, and honest `DIAGNOSTIC_PLANE_UNAVAILABLE` outage behavior.
- Typed diagnostic claim adjudication and bounded model-run handoffs whose
  facts remain evidence-backed and whose hypotheses remain explicitly
  uncertain.

All issuers and providers exercised by this packet are deterministic fakes
with `SYNTHETIC_ONLY` posture and obviously synthetic test material. There are
no real credentials, subscriptions, private API calls, deployment paths,
money paths, or effect-dispatch authority.

## Changed-path inventory for the implementation commit

Production sources:

1. `server/src/aiOps/caseRuntime/budget.ts`
2. `server/src/aiOps/caseRuntime/caseState.ts`
3. `server/src/aiOps/caseRuntime/context.ts`
4. `server/src/aiOps/caseRuntime/diagnostic.ts`
5. `server/src/aiOps/caseRuntime/evidence.ts`
6. `server/src/aiOps/caseRuntime/incident.ts`
7. `server/src/aiOps/caseRuntime/index.ts`
8. `server/src/aiOps/caseRuntime/persistence.ts`
9. `server/src/aiOps/caseRuntime/support.ts`
10. `server/src/aiOps/caseRuntime/types.ts`

Fixtures and insertion requests:

1. `fixtures/aiOps/caseRuntime/insertion-requests.v1.json`
2. `fixtures/aiOps/caseRuntime/synthetic-runtime.mjs`

Focused tests and network-deny harness:

1. `test/aiOps/caseRuntime/budget-outage.test.mjs`
2. `test/aiOps/caseRuntime/context-handoff.test.mjs`
3. `test/aiOps/caseRuntime/diagnostic-handoff.test.mjs`
4. `test/aiOps/caseRuntime/evidence-quarantine.test.mjs`
5. `test/aiOps/caseRuntime/incident-admission.test.mjs`
6. `test/aiOps/caseRuntime/network-deny.mjs`
7. `test/aiOps/caseRuntime/persistence-backpressure.test.mjs`
8. `test/aiOps/caseRuntime/purity-network-deny.test.mjs`
9. `test/aiOps/caseRuntime/workflow-recovery.test.mjs`

The receipt itself is the twenty-second lane path and is committed separately
from the implementation so the implementation SHA above remains exact.

## Verification evidence

### Lane gate

Command:

```text
npm run build -w server && node --import ./test/aiOps/caseRuntime/network-deny.mjs --test --test-concurrency=1 --test-reporter=spec test/aiOps/caseRuntime/*.test.mjs
```

Result: PASS, 138 tests, 138 passed, 0 failed, 0 skipped. The preload denied
HTTP, HTTPS, HTTP/2, TCP, TLS, DNS, DNS promises, UDP, direct socket/server,
agent, and resolver paths. Its self-test passed and the process recorded zero
network attempts.

Additional checks:

- `git diff --cached --check`: PASS before the implementation commit.
- Exclusive-path audit: PASS; 21 implementation files, zero out-of-scope
  paths, zero symlinks, and no tracked modifications from another owner.
- Production-purity audit: PASS; no ambient filesystem, network, subprocess,
  environment, clock, timer, or randomness access and no second-store
  dependency.
- Credential scan: PASS; no high-confidence credential material.
- `npm run test:integration:built`: PASS, exit 0.

### Shared repository gates and honest non-green boundaries

- `npm test`: typecheck, server/web builds, engine tests, focused safety tests,
  and the preceding Product Assurance packets passed. It stopped on the sole
  `LIVE_OPERATION_POLICY` failure. The canonical manifest expected 515 scanned
  production files and observed 525; discovered/covered/uncovered operation
  sites remained exactly 207/207/0. Updating that shared denominator is
  prohibited in this lane and is insertion request `A2-I00-GATES-001`.
- `npm run test:all`: reached the same sole deterministic Product Assurance
  failure and therefore did not execute the later chained suites. It is not
  reported green.
- Direct `test/i00/product-assurance-live-operation.test.mjs`: 1 test, 0 pass,
  1 fail, solely `filesScanned` 515 expected versus 525 observed; all operation
  coverage checks remained true.
- `npm run test:i00:proof:built`: 46 tests, 45 pass, 1 fail. The current-machine
  evidence comparison detects the new lane-local persistence helper candidates
  and unfinished live-owner evidence (`LIVE_OWNER_FILE` versus the sealed
  candidate expectation), together with living `current-main` tip drift from
  expected `a900348dc6b9fddb781e96643202d0b8cd8826bf` to observed
  `d78be24f4da14632c857ee250b62e3fec33c2743`. A2 did not edit the protected I00
  inputs or machine evidence. Re-accepting those shared inputs is outside the
  exclusive paths and remains an I00 integration dependency.

The protected I00 owner input is absent from this shadow worktree at steady
state. Its clean-candidate sealed-hash fallback passed in Product Assurance;
A2 neither supplied nor modified that input.

## Assumptions and non-claims

1. Every A2 schema, identity, projection, and signature is lane-local and
   `SHADOW_SPECULATIVE`; none is canonical or accepted.
2. Time, policies, budgets, capacities, and freshness limits are injected and
   validated. Unknown values remain `null`, `UNKNOWN`, `UNAVAILABLE`, or an
   explicit refusal rather than becoming fabricated confidence or zero.
3. Owner ports are structural seams only. Malformed, stale, unavailable,
   asynchronous, throwing, or unverifiable owner responses fail closed.
4. Persistence is an immutable, bounded envelope and exact-CAS adapter for the
   existing Ledger contract. The only concrete binding is a deterministic
   fixture; no production durability, delivery, or exactly-once claim is made.
5. Evidence pointers remain opaque and require independent owner readback. A2
   owns neither another evidence store nor a semantic-claim store.
6. Provider budget admission is a read-only projection from one inert snapshot,
   not an atomic production reservation; it cannot prevent concurrent double
   admission until the A3/I00 owner binding exists.
7. Global-effect artifacts are intent and readback accounting only. A2 has no
   dispatch, execution, live-order, transfer, withdrawal, or applied-effect
   authority.
8. Fixed bounds are safety limits. Exhaustion produces explicit backpressure or
   refusal rather than eviction, forgotten replay identity, or false success.
9. Shared package scripts, routes, navigation, auth, persistence owners,
   registries, canonical docs, composition, deployment files, and `STATE.md`
   were deliberately untouched.
10. Missing accepted provider facts remain
    `DIAGNOSTIC_PLANE_UNAVAILABLE` and never change deterministic safety truth.

## Typed insertion requests

The authoritative lane-local rows are in
`fixtures/aiOps/caseRuntime/insertion-requests.v1.json`:

1. `A2-I00-CONTRACT-001` — bind the lane projections to accepted A1/I00
   AgentCase, evidence, claim, provider-usage, context-manifest, and handoff
   public interfaces.
2. `A2-I00-PERSIST-001` — bind canonical keys/events and exact checkpoint CAS
   to the singleton Ledger, including bounded resume, owner proof, atomic
   lineage, compaction, and an exact command-receipt archive.
3. `A2-I00-QUEUE-001` — bind inbox/outbox/DLQ/attempt/global-effect records to
   one canonical transaction with capacity refusal, redrive, recovery proof,
   and compaction watermarks.
4. `A2-I00-INCIDENT-001` — supply incident read-by-ID/fingerprint, resumable
   scan, acknowledgement, and ProductRuntime projection owners.
5. `A2-I00-EVIDENCE-001` — supply intelligenceFoundation pointer readback and
   durable semantic-claim adjudication issuance/verification.
6. `A2-I00-MATERIAL-001` — accept the CASE/INCIDENT material-event vocabulary,
   cursor-gap semantics, publication, and readback.
7. `A2-I00-EFFECT-001` — supply canonical effect dispatch and exact fenced
   `APPLIED`, `NOT_APPLIED`, or `UNKNOWN` readback.
8. `A2-I00-PROVIDER-001` — supply A3/intelligenceRuntime provider facts and one
   atomic aggregate rate/concurrency/cooldown reservation, then durably bind
   its admission and usage digests to diagnostics, handoffs, and usage receipts.
9. `A2-I00-SIGNING-001` — supply owner-managed signing, trust registration,
   rotation, and durable one-time handoff consumption.
10. `A2-I00-GATES-001` — add shared test discovery, re-accept Product Assurance
    totals and any adapter-operation classifications, update component registry
    and `STATE`, compose the shared receipt, and rerun the complete lane loop in
    the future accepted worktree.

## Explicit unfinished-interface dependences

- Accepted A1/I00 public case, evidence, semantic-claim, provider-usage,
  manifest, and handoff contracts are unfinished. A2's shapes must be adapted,
  not promoted as their replacement.
- I00 has not supplied canonical case keys, event kinds, atomic CAS/resume,
  artifact-owner proof verification, command-receipt archival, or compaction
  ownership.
- I00 has not supplied owner-proven queue backpressure recovery, incident
  read/acknowledgement, CASE/INCIDENT material publication, or canonical effect
  dispatch/readback.
- intelligenceFoundation has not supplied the accepted evidence-pointer and
  semantic-claim readback interface.
- A3/intelligenceRuntime has not supplied accepted provider health, workload
  identity, aggregate reservation, or the atomic admission-to-diagnostic,
  handoff, and measured-usage binding.
- I00 trust has not supplied production key registration, rotation, signature
  verification, or durable one-time fresh-session consumption.
- I00 assembly and Product Assurance have not accepted the ten added production
  files, the lane test discovery, the static owner-candidate evidence, the
  current living-input cut, component registry, `STATE`, or shared receipt.

These dependencies are deliberate insertion seams, not hidden completion
claims. The artifact stops here as `SHADOW_ARTIFACT_READY` only.
