# Q12 acceptance receipt — ensemble, calibration and abstention

Status: `ACCEPTED — PARKED`

Date: 2026-07-13

Acceptance/state commit: A12 is the first commit containing this receipt and generation
32 of `quant/QUANT_EDGE_BUILD_STATE.md`. It is intentionally non-self-referential and
has exact parent C12.

## Accepted implementation boundary

- C12 commit: `7e403d2c24290deda81cae93f58308818144e017`
- C12 tree: `2c8cef3458e4953cd279d7c11ec2939685eda1a4`
- C12 parent: `c070fdaf7dc568448212067dde5e1fb2ecc21356`
- C12 subject: `quant(q12): implement ensemble calibration and abstention`
- C12 inventory: exactly 22 regular `100644` paths under `quant/**`.
- Immutable implementation receipt: `quant/RECEIPTS/Q12.md`
- Implementation receipt blob: `5d8ab521dbd5891b8a3a0dd751c433b569fedb5a`
- Implementation receipt SHA-256:
  `2062adbc0840d2be42a192ef0f470a9508fe53165b98f5eb849e67ffbc6f06bc`
- Generation-31 state SHA-256:
  `25d1bc4ee68d0f59c21a291f5f65c7140c0cc2fb32700d37c1c7136acf43dac4`
- Archive-derived C12 tar SHA-256:
  `eb0968d3d4761e8dda099c91cf8fa26dfe700c52b9ad847c8702620735ba0ee4`

`git diff-tree --check` passed. The receipt inventory equals the exact C12 path set.
No task, lock, protocol, root-state, mission, architecture, accepted receipt, Q13, Q15,
`deep`, `registry_ops`, production owner, UI, route, private client or money path is in
C12.

## Independent exact-C12 verification

C12 was exported with `git archive`, extracted outside the repository, and verified in
a newly created environment from the archived lock and source only.

- `uv sync --all-extras --frozen` -> exit 0; CPython 3.13.14; 65 distributions
  installed from the 68-package resolution.
- `uv lock --check` -> exit 0; 68 packages resolved.
- Ruff lint and format check -> exit 0; 280 files formatted.
- Strict mypy -> exit 0; 280 source files clean.
- Focused Q12 unit/property/contract/safety suite with branch coverage ->
  `147 passed`; 2,518 statements / 1,202 branches; exact `100.00%`.
- Accumulated Q suite under a different timezone/hash seed ->
  `2386 passed, 6 skipped`, exit 0. The skips are the four merged Q08 and two merged
  Q15 shard-scope laws that are executable only on their original shard branches.
- Campaign regeneration from the archive -> exit 0; fixture, campaign JSON and
  Markdown matched the exact C12 bytes.
- Frozen protocol conformance from the archive -> `22/22`, exit 0.

Before C12, the same final staged bytes also passed Q00 scope `6/6`, npm's 377
TypeScript/build/deterministic checks, three hostile CWD/timezone/hash-seed campaign
regenerations, and the staged Q scope guard. No dependency or lock changed.

## Independent boundary and adversarial acceptance

An independent commit-boundary audit verified the full C12 SHA, tree, parent, path
inventory, regular modes, receipt blob/hash, artifact hashes, protected input hashes,
protocol/base ancestry, Q15 ancestry and Q13 non-ancestry.

Independent hostile review then re-ran the repaired authority cases. These all fail
closed through public boundaries:

- altered Platt/isotonic parameters or noncanonical calibration projections;
- raw or altered conformal model adjustments;
- substituted per-row interval bounds, matrix/fitted-stack source or coverage subset;
- pending application outcome leakage and mature update without Q14 truth;
- altered coverage status/counts, Q09 disorder assessment or Q14 stress report;
- altered calibrated/interval projections and constructor-skipped nested evidence;
- object-valued nested evidence or complete advisory context.

`decide_advisory`, direct bound-decision construction, and standalone uncertainty
decomposition rerun the relevant canonical proofs. No reproducible path remained for
manufacturing `WATCH`. The final focused suite contains the corresponding regressions.

## Accepted artifacts and interpretation

- Fixture SHA-256:
  `88382d291f6d0ddb4443888df80ce1d03bc893790ca746d13237b23b58d2bb77`
- Campaign JSON SHA-256:
  `ad9d9b1f6ba9ffe3fc59450075f5221792f6c900403775f6820e2da763c28bb2`
- Campaign Markdown SHA-256:
  `26e9565e8c28f932f19630f1611ad97733d90e315fb9f2274b078070afcaeb38`

The evidence is `SYNTHETIC_ONLY`. Q12 accepts the deterministic implementation,
provenance, chronology, failure handling and abstention behavior. It does not accept a
market edge, live probability semantics, future/conditional coverage, economic value,
model promotion, capital/risk authority or execution safety.

## Acceptance decision and park law

Q12 satisfies its task and acceptance conditions. C12 and
`quant/RECEIPTS/Q12.md` are immutable accepted evidence.

The spine is parked after A12. Q13 acceptance
`06f0a8f0c722ece6c46f56c62156aec291a77317` remains pending director merge. Do not
start Q16 or Q17, do not merge Q13 locally, and do not push. Resume only on a new
director instruction after the Q13 merge posture is established.
