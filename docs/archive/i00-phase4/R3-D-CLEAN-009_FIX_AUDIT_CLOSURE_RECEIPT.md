# R3-D-CLEAN-009 independent fix-audit closure receipt

**Finding:** `R3-D-CLEAN-009`

**External audit SHA-256:** `31ef720ed5e031034415b0a1eeb32a509e7c05fbce01ec24c04a76c9b626ee28`

**Tested source:** `9cc41eee782ccb31c99bbffd2ab7dcb99236cdac`

**Tested tree:** `9b966dbd7afb86aa783dd949e89065be4c5491ae`

**Fix-coverage disposition:** `COVERED`

## Exact clean-detached admission

A fresh no-local clone was detached at the full tested source above. Before
dependency hydration or build:

- `git branch --show-current` was empty;
- `HEAD` and `HEAD^{tree}` exactly matched the identities above;
- `git status --porcelain=v1 --untracked-files=all` emitted zero bytes;
- all five protected root paths were physically absent:
  `I00_PRODUCT_ASSEMBLY_CONTROL_ROOM_AND_LIVE_BRINGUP.md`, `IP_CONTROL.md`,
  `IP_OPS.md`, `IP_PROOF.md`, and `IP_RUNTIME.md`.

`npm ci --offline --no-audit --no-fund` installed the lockfile-defined `229`
packages, and `npm run build -w server` exited `0`. No live owner input was
created or copied into the checkout.

## Exact original commands

The independent final battery executed the audit's two original commands at
the same exact detached source:

```sh
bash ops/tests/i00/run-all.sh

npm run test:i00:performance -- \
  --tested-sha=9cc41eee782ccb31c99bbffd2ab7dcb99236cdac
```

Results:

- I00 aggregate: exit `0`; `12` scripts passed, `0` failed, `725` additive
  assertions;
- real default 60-second three-boot performance campaign: exit `0`;
- after measurement, the generated receipt was the sole status entry and all
  five protected root paths remained absent.

## Immutable byte-level readback

Original generated path:

`test/i00/performance/evidence/local-proxy-performance-20260715180523155-55967-9cc41eee.json`

Archived exact-byte path:

`docs/archive/i00-phase4/evidence/R3-D-CLEAN-009/local-proxy-performance-20260715180523155-55967-9cc41eee.json`

Exact identities:

- byte length: `186590`;
- SHA-256: `53ff8e8fa557430ce7d775b0daa22684db555e6483e6e04ffcaa3216e6d32242`;
- Git blob: `b92e759a5d194263168f1a525bdf0e602b804393`;
- schema: `i00.local-proxy-performance.v1`;
- run ID: `20260715180523155-55967-9cc41eee`;
- created at: `2026-07-15T18:05:23.155Z`.

`cmp -s` proved the generated and archived files byte-identical. Independent
readback through `validatePerformanceDocument` passed with `schemaErrors=[]`
and `semanticFailures=[]`; an independent `scanSecretText` found zero secret
findings. The receipt's own immutable artifact scan covered `10` artifacts with
zero findings.

## Semantic result and limitations

The source is exactly:

- resolution mode: `CLEAN_DETACHED_PACKAGED`;
- branch: `DETACHED`;
- worktree state:
  `CLEAN_DETACHED_CANDIDATE_WITH_PACKAGED_OWNER_DIRECTIVES`;
- all five directive rows: `CANDIDATE_COMMITTED_VERIFIER_INPUT`;
- server bundle SHA-256:
  `9d2ad8a3023502c18298b40ae54c2e00d1fbe89baf8a32ea89b0133ee0eb5b96`;
- harness tree SHA-256:
  `340b9f85c80c6020c8ba5113d23973a66c01775486f680a8a771144b10fc77e8`.

Continuity passed with the same data directory, nondecreasing event count,
clean graceful stops, abnormal crash closure, readable-stop database
integrity, boot generations one/two/three, exact tested SHA on every boot,
canonical owner-gate proof, and unclean recovery proof. Invariant failures are
empty. Overall local-proxy SLO is `PASS`; degradation visibility is
`CANONICAL_NON_GREEN_VISIBLE`.

Production capacity remains honestly `UNKNOWN`. Q production inference,
short-window RSS slope, real reconnect storms, private throughput, exchange
weight, concurrent backup, browser rendering, and unexercised production
metrics remain `NOT_CONFIGURED` or `OWNER_GATED`.

## Non-substitution law

The archived artifact is classified exactly as:

```text
FIX_AUDIT_ONLY
NOT_LIVE_CANDIDATE_PERFORMANCE
MUST_NOT_BE_PASSED_TO_COMPLETE_ACCEPTANCE
HISTORICAL_CORRECTION_EVIDENCE
NOT_C2_ACCEPTANCE
NOT_LIVE_OWNER_INPUT
NOT_SEAL_EVIDENCE
PRODUCTION_CAPACITY_UNKNOWN
```

It closes the external audit's missing byte-readback obligation only. Candidate
acceptance still requires a distinct exact-C2 live-provenance browser,
performance, and complete receipt on the authorized integration branch with
the five genuine physical owner directives. No package fallback can satisfy
that law.

No runtime, test, bundle, owner directive, live/test order, private or signed
exchange path, deployment, push, merge, current-main write, or external
mutation is introduced by this historical evidence commit.
