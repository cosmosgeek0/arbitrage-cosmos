# R3-VAL-001 correction receipt

**Finding:** `R3-VAL-001`

**Severity:** `Critical`

**Disposition:** `FIXED`

**Correction base C:** `098f7b9449ab3b1c26bda19f51537bfea01d4c48`

**Role 3 receipt SHA-256:** `90613c8273e5c866603dbaa74106f2ff436c06e320a95a0cbdbc4c55c0d5ae1d`

## Exact reproduction

From the clean Role 4 checkout temporarily detached at exact C, with locked dependencies hydrated, the verifier's unchanged COMPLETE-01 command exited `1`:

```sh
npm run test:i00:complete -- \
  --validate-only \
  --candidate-sha 098f7b9449ab3b1c26bda19f51537bfea01d4c48 \
  --seal-sha 517bd636d799c983ecddc9bda1985d0619b652d7 \
  --performance-receipt test/i00/performance/evidence/local-proxy-performance-20260715035012040-66611.json \
  --browser-receipt test/i00/performance/evidence/browser/local-browser-acceptance-098f7b9.json \
  --complete-receipt test/i00/performance/evidence/local-complete-acceptance-20260715035012040-66611.json
```

Exact terminal failure:

```text
LOCAL_COMPLETE_ACCEPTANCE_FAILED:SEALED_REPORT_PARITY_CHECKOUT_MISMATCH
```

The checkout returned to `role4-fix-20260715` at exact C with no source mutation from the reproduction.

## Smallest safe correction

`commandOutput()` deliberately returns a bounded object containing `stdout` bytes plus the SHA-256 of stderr. `verifyReportParityAtRevision()` previously stringified that wrapper object and compared `[object Object]` with the required commit. It now decodes only the returned `.stdout` bytes and keeps the exact revision equality check unchanged.

Affected implementation and regression paths:

- `test/i00/performance/local-acceptance.mjs`
- `test/i00/performance/acceptance-contract.test.mjs`

No candidate identity, seal topology, report-parity rule, output bound, secret scan, donor law, disposition, Q ancestry, product authority, network behavior, or money boundary was weakened.

## Focused red/green proof

The new regression creates two clean local clones, checks both out detached at the exact requested revision, and exercises the real revision-output path.

```sh
node --test --test-concurrency=1 --test-reporter=spec \
  test/i00/performance/acceptance-contract.test.mjs
```

- Before source correction: exit `1`; `9/10` passed; failing test reported `SEALED_REPORT_PARITY_CHECKOUT_MISMATCH`.
- After source correction: exit `0`; `10/10` passed.

The complete focused family also passed:

```sh
npm run test:i00:acceptance-contract
```

Result: exit `0`; `42/42` passed; `0` failed, skipped, cancelled, or todo.

The required root gate was also measured:

```sh
npm test
```

It exited `1` after the build, Basis `107/107`, Volume `124/124`, financial safety `59/59`, storage/AWS `29/29`, Node focused `51/51`, stream lifecycle `8/8`, perimeter `2/2`, and the first 11 Product Assurance groups passed. The sole reported failure was `A_CASE_S4_SAFE_PURITY: protected untracked I00 input remains byte-identical`, which is the independently accepted pending finding `R3-D-CLEAN-009`. No protected owner input was copied, created, or fabricated to make this unrelated gate green.

This receipt is committed atomically with the correction. The final Phase 4 closure receipt will bind its exact commit SHA.

## Independent fix-coverage audit closure

The later D-LAUNCH-41 audit correctly found that the first regression asserted
detached checkout shape and successful regeneration, but never asserted the
returned parity bit. Exact rejected seal
`517bd636d799c983ecddc9bda1985d0619b652d7` therefore still returned
`passed:false`: its generated machine evidence could see only
`refs/remotes/origin/current-main`, while the sealed generator resolved the
literal local `current-main` branch.

The validator now resolves the exact current-main commit from the outer
verification repository, accepting only `refs/heads/current-main` or the clean
clone transport `refs/remotes/origin/current-main`. It verifies that exact
commit object inside each private parity clone, installs only the corresponding
temporary local ref, and still requires the requested revision as detached
`HEAD` with zero status bytes. No ref in the owner worktree is written.

The named regression now binds the exact rejected seal, requires
`result.passed === true`, requires all six artifacts, and requires every
`matchesGenerator` bit. Evidence at the audit-closure correction tip:

- pre-fix exact-S result: regeneration passed, five Markdown artifacts matched,
  machine evidence differed, and overall parity was false;
- hostile assertion added before the implementation correction: exit `1`,
  `0/1`;
- corrected named regression: exit `0`, `1/1`;
- exact-S direct result: `passed:true`, regeneration passed, six artifacts,
  and all six byte-identical.

The moving-ref acceptance law is unchanged: an unavailable, invalid, or
non-descendant current-main tip still fails closed. The correction only makes
the already-observed exact ref available to the historical generator inside
the two isolated clones.
