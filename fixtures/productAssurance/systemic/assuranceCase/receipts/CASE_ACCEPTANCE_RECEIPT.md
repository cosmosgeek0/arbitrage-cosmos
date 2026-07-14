# S4 assurance-case prestage acceptance receipt

Receipt state: **CASE_PRESTAGE_READY**

Artifact semantics: **CLEAN**

Authority effect: **NONE**

This sibling receipt accepts only the packet-local S4 assurance-case artifact.
It supersedes the terminal outcome of the two immutable blocked receipts without
rewriting either one. The enclosing documentation-only seal commit makes this
receipt immutable; that commit ID is intentionally not self-recorded.

## Source identity

| Evidence | Exact value |
| --- | --- |
| Branch | `ip-assur-case-20260713` |
| Assigned base | `c57610cb5f7d56efb61e53ae27057fbe92a6a2f6` |
| Original S4 implementation commit | `2f20acddcfbaba8db042fab024443924f7dee7d3` |
| Original S4 implementation tree | `eeea49d412bf886c422cc2f5d79246f6f3320883` |
| Original blocked seal | `be320e3c8614e237314b9ea39d385347c07924e3` |
| Director repair merge and D-LAUNCH-16 scope baseline | `2d840599c716b5da8f5c42a272fc2232792f868c` |
| Director repair merge parents | `be320e3c8614e237314b9ea39d385347c07924e3`, `f72c531f766d3f8ffa52e0f0e3fc77ef8345913b` |
| Director repair merge subject | `director: rebase S4 on current-main with SI-RECON ruling A (baseline repair)` |
| D-LAUNCH-16 ruling commit | `a4a8ebd349e638e047a9ebf20bf6ec170376d08e` |
| Repaired-scope blocked seal | `f8f4d496be9a230bc101282d8988d9524de8e2ea` |
| Accepted source commit | `c2201cf91a60387d2cd6901cb42f1c3532ca9b53` |
| Accepted source tree | `50ed5f8408cd6e575e8d10314ca6c0c5306b48a1` |
| Accepted fixture subtree | `691930c526556bb14b310daa21f2b66aecf1aea3` |
| Accepted test subtree | `69c0f1c60912fb8a71b930cad0027f14d1f38484` |
| Accepted scope-test SHA-256 | `e2db10b6435b76092ef34567dd01d27ae2c848a86c393c944acf2090aa3b4601` |
| Accepted S1 input | `ip-assur-hazard-20260713` at `ab33b3712cddd67c3ec91cfa1dd232c75226cd9f` |
| `IP_ASSURANCE.md` SHA-256 | `49dcd690275ff35cb32566af307ad572d2a527e06d7388885f98826560968e84` |
| Dedup matrix SHA-256 | `22686d2cd1c54bbc39af56399298a0ed9563bbc8643ad4f0e498718de83cb2cd` |
| Protected root I00 SHA-256 | `9d7a36da6a2e6e7b3e905c73161b5e998a2f92416dd557e498ade3e73d5e5ef5` |
| `package.json` SHA-256 | `e49ff499d4612a0141c884a0818663912f1a19c9a61afdb2f6b99a6b1a2b5e8a` |
| `package-lock.json` SHA-256 | `3c97820f912390fcad3dab57b436319b95c15bc7877384dd98032d7751ec2fcf` |
| Server package SHA-256 | `4fcc270fcb046db17b7e581e11bc02216a1b07465ff713b52edfd9a7b17feaf6` |
| Web package SHA-256 | `839d4196aa8dc0d9056796592a7630ab5176d67134a724b521421593438775a8` |
| Runtime | Node.js `v22.23.1`; npm `10.9.8` |
| Seal date | `2026-07-14` (`Asia/Kolkata`) |

The prior receipts remain byte-identical: `CASE_BLOCKED_RECEIPT.md` has
SHA-256 `b4eddadf91eb9bb50f9bbc989c4763a228e4b9f7a2246dc03819d1c0e02a2d13`
and `CASE_REBASE_SCOPE_BLOCKED_RECEIPT.md` has SHA-256
`79a427b28bb9ffe81afd4bb807e6aae56d2d0428ad64b825c600ad9c0824ad59`.

## D-LAUNCH-16 scope disposition

D-LAUNCH-16 classifies a commit whose subject starts `director:` and whose
parent list contains exactly two commits as canonical integrated history. The
S4 gate searches first-parent history for the latest such merge. That merge is
`2d840599...`; it is the scope baseline and is exempt from the worker allowlist.

The repaired gate preserves the assigned-base ancestry and accepted-S1 checks.
It changes only committed-path attribution: it discovers and validates the
latest qualifying director merge, enumerates every first-parent commit after
that baseline, and checks the path set of each commit. Staged, unstaged, and
untracked paths remain checked as before. The two allowed roots were not
widened, and the gate was not skipped or weakened.

Through the accepted source commit, the only post-baseline worker commits are:

| Commit | Disposition |
| --- | --- |
| `f8f4d496be9a230bc101282d8988d9524de8e2ea` | prior sibling blocker receipt and packet state only |
| `c2201cf91a60387d2cd6901cb42f1c3532ca9b53` | D-LAUNCH-16 scope-test repair only |

Their union contains exactly three paths and zero outside the S4 roots:

```text
fixtures/productAssurance/systemic/assuranceCase/receipts/CASE_REBASE_SCOPE_BLOCKED_RECEIPT.md
fixtures/productAssurance/systemic/assuranceCase/state/CASE_STATE.md
test/productAssurance/systemic/assuranceCase/purity-scope.test.mjs
```

This seal adds only this sibling receipt and the sibling packet state update,
both under the existing fixture root. The original evaluator, contracts,
fixtures, accepted-S1 adapter, render-neutral view, DRAFT rows, and semantic
tests are unchanged from the previously reviewed S4 implementation.

## Verification evidence

The assigned checkout intentionally had no `node_modules`. A direct `npm test`
attempt stopped before code evaluation with exit `127` at `tsc: command not
found`; no product test failed. The accepted source commit was therefore cloned
with `--no-local` into a disposable directory. A lock-identical dependency tree
from the sibling IP-ASSURANCE checkout was exposed through an ignored local
`node_modules` directory, the protected I00 input was supplied read-only, and
the exact accepted S1 ref was restored. No install or network access occurred.

| Gate | Exact result |
| --- | --- |
| Isolated S4 scope/import-purity file | `7/7` pass, exit `0` |
| Full focused S4 suite | `233/233` pass, exit `0` |
| Syntax across packet and tests | all `32` `.mjs` files pass `node --check`, exit `0` |
| Repository `npm test` in exact-source mirror | exit `0`; deterministic total `377/377` |
| Repository `npm run test:all` in exact-source mirror | exit `0`; every invoked family passed; System Integration `180/180` |
| `git diff --check` | exit `0` |
| Final exact-source mirror status | only protected untracked I00; no tracked or staged change |

The deterministic total comprises Basis `107/107`, Volume `124/124`, financial
safety `59/59`, storage/config/AWS `29/29`, focused Node tests `50/50`, stream
lifecycle `7/7`, and perimeter `1/1`. The all-family run also reported Borrow
truth `179/179`, Borrow import purity `31/31`, further focused gates including
`105/105`, `25/25`, `226/226`, `78/78`, `130/130`, app `72/72`, and final
System Integration `180/180`. The only build diagnostic was the existing Vite
chunk-size warning.

No test used a secret, private exchange state, signed call, external service,
order, test order, borrow, repay, transfer, withdrawal, leverage mutation, or
money path. The protected owner-supplied I00 remained untracked, unstaged, and
byte-identical.

## Accepted packet boundary

- The S4 graph remains a derived, read-only, `SYNTHETIC_ONLY` assurance
  projection with `authorityEffect=NONE`.
- Producer/verifier separation, common-mode independence, mandatory claim law,
  accepted-S1 provenance, graph-cycle rejection, expiry, transitive
  invalidation, fail-closed UNKNOWN propagation, bounded views, and no-command
  authority remain covered by the `233/233` focused proof.
- No production owner, shared composition, Q/L path, package, UI, runtime,
  persistence, route, supervisor, ledger, exchange adapter, Risk, Capital,
  control, repair, deployment, or external configuration was changed.
- No merge, rebase, push, `current-main` mutation, or external mutation was
  performed by this acceptance seal.
- Integration, live operation, deployment proof, whole-program
  `ASSURANCE_PRESTAGE_READY`, and `I00_ACCEPTED` remain director-owned and are
  not claimed.

The S4 satellite is therefore sealed at **CASE_PRESTAGE_READY**.
