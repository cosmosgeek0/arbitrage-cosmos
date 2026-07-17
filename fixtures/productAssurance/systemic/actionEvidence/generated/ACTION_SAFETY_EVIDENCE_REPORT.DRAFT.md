# S2 action-safety evidence report — draft

`SYNTHETIC_ONLY` · `SUPPORTING_EVIDENCE_ONLY` · authority effect `NONE`

This packet is a post-landing donor under D-LAUNCH-22.3. It is not part of the frozen integration candidate and may re-enter only after landing through a director-controlled insertion.

## Immutable inputs

| Input | Commit | Use |
| --- | --- | --- |
| `IP_ASSURANCE.md` amendment §3 and §11 authority object | `c57610cb5f7d56efb61e53ae27057fbe92a6a2f6` | immutable S2 non-authority and path/owner law |
| A-CORE scaffold and S2 dedup row | `08a0a09780727e2b4ba59017b5701998abe29b77` | read-only seam and `MISSING (narrow)` scope |
| S1 hazard contracts | `ab33b3712cddd67c3ec91cfa1dd232c75226cd9f` | read-only tri-state and expiry/invalidation compatibility |
| Frozen L lifecycle contracts | `df6b472993ca9659ce09cf5f72004981c6835f0d` | read-only action identities and lifecycle vocabulary |

## Frozen action denominator

Each envelope covers exactly one action. The five-record bundle is a synthetic fixture denominator only; it has no aggregate status, comparison, score, decision, or rank.

| S2 class | Frozen L owner symbol | Exact discriminant | Class-specific proof |
| --- | --- | --- | --- |
| `ORDER_INTENT` | `L08_EXECUTION_POLICY.PolicyAction` | `kind=PLACE` | content-addressed action identity, exact intent/plan/quantity binding, and ordered signing then acknowledgement |
| `CANCELLATION` | `L08_EXECUTION_POLICY.PolicyAction` plus durable L14 cancel | `kind=CANCEL` | content-addressed target, mutation/command lineage, terminal-outcome coherence, and late-fill truth; `CANCEL_PENDING` is not terminal success |
| `REPAIR_STEP` | `FOUNDATION_CONTROL.SafeRestartComponentAction` | `type=SAFE_RESTART_COMPONENT` | content-bound durable action, complete component reference, receipt, and current reconcile-first postcondition after receipt |
| `HALT` | `FOUNDATION_CONTROL.HaltAction` | `type=HALT` | content-bound durable action, `NEW_RISK` scope, retained supervision, receipt, and current halted readback after receipt |
| `RECOVERY_STEP` | `L08_EXECUTION_POLICY.PolicyAction` plus durable L14 recovery | `kind=RECOVER` | content-addressed actual-fill/precomputed-plan binding, risk-reducing quantity/effect only, and no automatic recommendation |

## Derived record contract

Every record contains:

- an SHA-256 subject binding over the exact class, frozen owner discriminant, and action identity;
- the frozen L content-addressed policy-action identity or durable control-action digest, plus an exact action reference;
- bounded temporal sources with exact class subject, canonical source owner/role, event/receive/available/process times, watermark, skew budget, sequence state, and clock quality;
- fencing epoch, lease, and owner-evidence identity where applicable;
- optional payload-free canonical owner-decision references with exact subject, release, policy, and authority-map binding; the set may legally be empty and never supplies authority;
- a bounded scenario envelope with explicit exposure, liability, recovery-cost, time, and rate-limit knowledge;
- every class-required evidence family with payload-free owner-digest references, evidence IDs, record-local dependency IDs, producer and verifier actors, production/verification times, maximum age, absolute expiry, assertion, and reason codes;
- bounded active assumptions and invariant results, each with record-local evidence dependencies and currentness bounds;
- explicit invalidation events targeting evidence in the same record.

The common required families are action binding, temporal coherence, fencing/idempotency, lifecycle/outcome, exposure/liability bounds, and outcome observability/supervision. Mutation input truth, cancellation/late-result handling, and registered recovery/repair paths are added only where the frozen action class requires them.

## Status semantics

`PASS` means all currently valid required families, assumptions, and invariants are satisfied. `FAIL` means a current family, class-specific action fact, assumption, or invariant contradicts the envelope, or a producer and verifier are the same actor. A shared declared owner or independence domain is `UNKNOWN` because independence is unproven. `UNKNOWN` otherwise means required truth cannot safely be resolved.

Currentness is evaluated before assertion. Not-yet-valid, expired, stale, invalidated, temporally incoherent, missing-verifier, unbounded, or cyclic evidence is therefore `UNKNOWN`, even if its historical assertion was `SATISFIED` or `CONTRADICTED`. Record-local dependency closure is deterministic: `FAIL` dominates unrelated `UNKNOWN` at aggregate status, but an unknown prerequisite masks a dependent contradiction whose current validity cannot be established. `UNKNOWN` otherwise dominates `PASS`.

Every result repeats `SYNTHETIC_ONLY`, `SUPPORTING_EVIDENCE_ONLY`, and authority effect `NONE`; reports zero commands issued; and states canonical risk reduction is unaffected. Complete evaluated results carry the earliest future `nextCurrentnessBoundaryAtMs` when one exists; diagnostic results or results with no future boundary carry `null`. No evaluator reads clocks, environment, files, sockets, timers, randomness, or network state.

The standalone result validator proves closed structural and internal status/reason consistency only; it does not authenticate portable provenance. The sole legal projection accepts the envelope and an injected UTC time, snapshots and validates the envelope, recomputes the result internally, validates that result, and requires supplied canonical owner-reference IDs to be current, exact-bound, and match the envelope exactly. Caller-supplied evaluations are not accepted.

## Mandatory §3 hostile cases

| Counterexample | Expected evidence status |
| --- | --- |
| Individually fresh sources fail mutual coherence | `UNKNOWN` |
| Fee/filter/funding/borrow or owner truth changes after proposal | `UNKNOWN` |
| Partial-fill recovery path is rate-limited | `FAIL` |
| Owner-registered fallback is missing | `FAIL` |
| Stale approval replay has subject/policy mismatch | `UNKNOWN` |
| Lease is lost before acknowledgement | `FAIL` |
| Late fill arrives after timeout/cancel | `FAIL` |
| Backup-path evidence is expired | `UNKNOWN` |
| Liability or recovery cost is unbounded | `UNKNOWN` |
| All evidence families pass with no Capital/Risk/owner decision | `PASS`, still non-authoritative |

Additional hostile fixtures cover stale contradictions, direct and future invalidation, producer/verifier collision, missing verifier, dependency cycles, exact freshness/expiry boundaries, sequence gaps, unbounded clocks, timestamp disorder, invalid evaluation clocks, malformed consumers, and forged authority fields.

## Authority refusal

The reference projection accepts only purpose `SUPPORTING_EVIDENCE_ONLY`. These purposes always throw `ACTION_EVIDENCE_NOT_AUTHORITY`, regardless of whether evidence status is `PASS`, `FAIL`, or `UNKNOWN`:

- `APPROVAL`
- `ACTION_ADMISSION`
- `BLOCKING`
- `RANKING`
- `EXECUTION`
- `COMMAND_DISPATCH`

No S2 output may approve, block, rank, authorize, restore, widen, send, dispatch, or execute an action. Canonical Capital, Risk, Foundation Control, execution-policy, reconciliation, ledger, and lifecycle owners are unchanged.

## Draft verification snapshot

- Focused command: `node --test --test-concurrency=1 --test-reporter=spec "test/productAssurance/systemic/actionEvidence/**/*.test.mjs"`
- Focused result before acceptance sealing: 87 tests, 87 passed, 0 failed.
- Total-network-deny command: `/usr/bin/sandbox-exec -p '(version 1)(allow default)(deny network*)' node --test --test-concurrency=1 --test-reporter=spec "test/productAssurance/systemic/actionEvidence/**/*.test.mjs"`
- Total-network-deny result before acceptance sealing: exit `0`; 87 tests, 87 passed, 0 failed.
- Root `npm test` was attempted under the same network deny and exited `127` at server typecheck because dependencies are not hydrated (`sh: tsc: command not found`). This is not a repository-wide green claim.
- The authoritative total-network-deny result and immutable implementation identities will be sealed in the final packet-local receipt.

This draft is not an integration or acceptance claim.
