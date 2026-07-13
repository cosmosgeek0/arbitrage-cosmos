# Q16 acceptance receipt — bounded local inference and protocol kit

Acceptance status: `ACCEPTED`

Date: 2026-07-13

Acceptance authority: Q-lane spine under standing director order D-LAUNCH-2/5.

## Accepted implementation commit

- C16: `b3d8cedece8cf3a9f546c60016beae442f85f160`
- Tree: `a35b888041cbdd4ea56accd29a490a8ce043cef0`
- Exact parent (Q16 activation/state generation 34):
  `cff7943845231ef1518dbfb937f986cdf2e247f5`
- Immutable implementation receipt SHA-256:
  `b3b08998bfc3450de2b3502defca482cb6759f6cfe44a4cbb9f2e95d43fea5d6`
- Immutable implementation receipt Git blob:
  `26d1c16390c9d7763969e5abb8eb42d8591af020`

The acceptance commit A16 is the commit that first contains this acceptance
receipt and state generation 36. It is intentionally non-self-referential.

## Exact-commit scope and integrity

- C16 has exactly 32 changed paths. Every path is under `quant/**`; every changed
  entry is a regular `100644` file. `git diff-tree --check` is clean.
- The write set is exactly the Q16 task, decision, design, fixture, inference
  package, focused tests, generated kit, campaign script, implementation receipt
  and durable quant state described by `quant/RECEIPTS/Q16.md`.
- Frozen Q00-Q15, registry, protocol and input-lock bytes are unchanged. No root,
  Main, other-worktree, merge or push path is present.
- The two owner directives remain protected and untracked. Their SHA-256 values are
  `26b1d5ce118982b4b3ba64b44b7fb3e88b0b7ded26a818a775a65bffaa0f2c06`
  and `198f131d4b04c1edab728b85ea6a5e5c5f7f80875866e407a3c93a24aafa5ab4`.

## Documentary erratum discovered by verification

The immutable C16 receipt and generation-35 state record the Q16 decision
SHA-256 as `4a950122a78250f83a05c7e2a6962ee0a44a0926dfa2fcf0c897419c6858acfa`.
Exact committed-byte verification found that value was stale after the final
adversarial correction. The authoritative C16 byte hash for
`quant/DECISIONS/Q16-001-LOCAL-INFERENCE.md` is:

`eac813f4e07c72915e06ee3bd707b0d7a9c71951c1c1c9fb2bad9a387e345d2d`.

The committed decision content, implementation, generated evidence and tests are
unchanged. This acceptance receipt is the immutable correction; the C16 receipt is
not rewritten and its stale field is not used as an acceptance oracle.

## Clean-archive verification

A `git archive` produced from exact C16 had SHA-256
`7c5073166795ee3dd7f88d3f5e71bbe4e4942ebfb18dfd440c7894cc24763621`.
The archive was unpacked into a clean directory and verified using the pinned
CPython 3.13.14 environment while importing code only from the archive.

All checks passed:

- Focused Q16: `172 passed`; 1,374 statements / 514 branches; `95.50%` combined
  branch coverage; required threshold 95% passed.
- Complete quant suite: `2627 passed, 6 skipped in 65.13s`. The skips are the
  documented Q08/Q15 shard-branch scope laws.
- Ruff lint and format-check: clean, 310 files. Strict mypy: clean, 310 files.
- `uv lock --check`: 68 packages resolved; no lock change.
- Actual registry entrypoint: exit 0, 8 families. Frozen protocol: `22/22`.
  Q00 scope guard: `6/6`.
- Root `npm test`: exit 0; typecheck, build and all deterministic server/web checks
  pass. Vite's existing chunk-size warning remains non-failing.
- Generated Q16 artifacts, strict clients, canonical hashes and complete kit
  inventory match the immutable receipt. Regeneration remains byte-identical
  across working directory, timezone and hash-seed changes.

The live-tree focused recheck independently reproduced `172 passed` and `95.50%`
coverage over 1,374 statements / 514 branches.

## Acceptance conditions

- Raw Q04 fixture truth flows through frozen evidence, existing Q06/Q07 features,
  verified Q13/Q15 model availability and Q12 calibration lineage into a canonical
  `EdgeAssessmentEnvelopeV1` with deterministic parent hashes.
- Unavailable, stale, future-ambiguous, expired or lineage-invalid inputs remain
  fail-closed at `ABSTAIN_UNKNOWN`; no score, probability, prediction or economic
  value is fabricated.
- Local service bounds cover request/response bytes, batch, handler count, queue,
  concurrency and deadlines. Late work is quarantined and cannot publish a late
  response or release concurrency early.
- UDS ownership, race and cleanup are identity-safe with `0700`/`0600` permissions.
  Optional TCP accepts literal `127.0.0.1` or `::1` only.
- Generated Python and Node clients preserve raw nanosecond integers and enforce
  strict frozen-schema plus fail-closed semantic validation.
- Independent protocol, transport and final lineage/version reviews found no
  remaining acceptance blocker after their corrections were regression-tested.

## Boundary

Q16 is advisory-only and `SYNTHETIC_ONLY`. It provides no accepted loadable model,
observed-market edge, calibration, capacity, latency, capital, risk or execution
claim. It adds no secret access, external networking, signed/private exchange call
or money path. `LIVE_EXECUTION_NOT_IMPLEMENTED` remains enforced.

Q16 is `ACCEPTED`. The next authorized spine action is a separate Q17 activation,
followed by end-to-end proof, benchmark, final receipt and exact-commit acceptance.
The lane never pushes.
