# S1 hazard prestage receipt

Receipt state: **HAZARD_PRESTAGE_READY**

Authority effect: **NONE**

This receipt seals only the packet-local S1 amendment §2 projection. The enclosing seal commit makes it immutable; the seal commit ID is intentionally not self-recorded.

## Source identity

| Evidence | Exact value |
| --- | --- |
| Branch | `ip-assur-hazard-20260713` |
| Required base/tip before work | `9785c93102b00389847b77c2f9348c06abc4344b` |
| Implementation commit | `5de362639638fafcd9563787647200bcbf175df5` |
| Implementation fixture tree | `a093a82a195d8c038f55936ad23322b287871ff2` |
| Implementation test tree | `5e2023274d45e983ec5a8b0228e4b9e21c1568ba` |
| `IP_ASSURANCE.md` SHA-256 | `5f6d4b3b70e384f6123e9ccc01891faf04aef9da7f7cfd1e0c63be5c3ba68803` |
| Protected root I00 SHA-256 | `9d7a36da6a2e6e7b3e905c73161b5e998a2f92416dd557e498ade3e73d5e5ef5` |
| Dedup matrix SHA-256 | `22686d2cd1c54bbc39af56399298a0ed9563bbc8643ad4f0e498718de83cb2cd` |
| Archived amendment provenance SHA-256 | `0f42ded02e9f751b9f6c077579378d83131faa8ef23fc4f3286616008259f86e` |
| `package-lock.json` SHA-256 | `3c97820f912390fcad3dab57b436319b95c15bc7877384dd98032d7751ec2fcf` |

The protected root I00 was read as the parent authority input, remained untracked, and was never staged.

## Delivered packet

| Contract/result | Evidence |
| --- | --- |
| STPA hazard records | 10 stable `PA-S1-HZ-*` records with control/feedback structure, unsafe action kind, triggering context, causal scenario, I00 constraint, finite assumptions, detector/SLO, containment owner, proof-or-gap, cockpit drill-down, residual risk, and owner disposition |
| Unacceptable-loss families | 10 required `PA-S1-UL-*` families; active coverage and boundary overlap are validated |
| Finite assumption projection | 9 `PA-S1-AS-*` records, 6 non-hazard consumer kinds, injected clock, finite evidence/time bounds, bidirectional dependency parity, direct invalidations, failure dominance, and no machine response |
| Expected Failure Atlas check | 6 operation classes × 9 required families = 54 reviewed synthetic decisions and 54 rows; no reporter-derived denominator |
| Review integrity | Exact manifest fingerprint, manifest version, operation-policy revision, and fixture release identity are review-bound; `UNTESTED` cannot prove owner review |
| Fixture resolution | 60 bounded registrations: 6 deterministic hazard projections and 54 Atlas reproductions; dangling/orphaned registrations fail closed |
| Render-neutral view | Closed/bounded nested schema, progressive summary/annunciators/drill-down, synthetic label, no UI implementation, no machine-readiness verdict |
| Shared-artifact requests | 4 invariant-catalog DRAFT rows, 4 autonomy DRAFT rows, and 9 insertion-request DRAFT rows; no shared insertion performed |

## Verification evidence

### Focused packet suite

Command:

```text
node --test --test-concurrency=1 --test-reporter=spec "test/productAssurance/systemic/hazard/**/*.test.mjs"
```

Result on exact implementation commit: `69` tests, `69` passed, `0` failed, exit `0`.

The suite includes malformed schemas, unknown/reverse/cockpit references, dependency drift, empty and orphaned registries, required-loss and boundary coverage, expiry boundaries, contradiction dominance, mutable-input non-mutation, denominator self-shrink, missing decisions/rows, duplicate and foreign rows, release/review binding, fixture resolution, whitespace-only gaps, closed view schema, deterministic permutation, DRAFT-row parsing, and import/capability purity.

### Repository gates

The assigned worktree intentionally had no `node_modules`. A direct initial `npm test` attempt stopped before code evaluation with exit `127` and `tsc: command not found`. No install was performed because writes outside the exclusive paths and network access were forbidden.

The exact implementation commit was therefore exported to a disposable directory and tested against the existing read-only dependency tree in the sibling IP-ASSURANCE worktree. Root, server, web manifests and `package-lock.json` were hash-identical; no network was used and the assigned worktree was not modified.

| Gate | Result |
| --- | --- |
| `npm test` | exit `0`; reported Basis `107/107`, Volume `124 passed, 0 failed`, and Node groups `50/50`, `7/7`, `1/1` |
| `npm run test:all` | exit `0`; included Basis `107/107`, Volume `124/124`, Borrow `179/179`, Borrow import purity `31/31`, further deterministic gates including `105/105`, `25/25`, `226/226`, `78/78`, `130/130`, `72/72`, and final Node `180/180` |
| Focused S1 suite in the same exact-commit mirror | `69/69`, exit `0` |
| `node --check` | all 17 packet/test `.mjs` files, exit `0` |
| `git diff --cached --check` before implementation commit | exit `0` |

No test used network, secrets, private exchange state, signed calls, timers, ambient time, randomness, persistence, or external runtime systems.

## Adversarial review closure

Three independent read-only reviews attacked the implementation before and after hardening. Closed repros include:

- unknown reverse, inactive, or cockpit dependencies producing false `PASS`;
- vacuous/unbound/orphaned assumption registries;
- uncovered or boundary-incoherent unacceptable-loss aggregation;
- invalid primitive clocks and contradiction demotion;
- caller-input freezing;
- self-shrunk operation-class/decision denominators;
- missing decision shown as `100%`;
- unknown-family, foreign-release, duplicate, or whitespace-only Atlas records;
- stale review content not bound to manifest/policy/release identity;
- dangling fixture registrations;
- malformed records throwing through the view builder;
- I08 read projection incorrectly assigned containment/recovery authority.

Final read-only rechecks reported the baseline at zero validation issues with hazard/Atlas/view `PASS`, every former false-green repro non-`PASS`, malformed structures `UNKNOWN` without throws, and the I08/Control authority split clean.

## Artifact hashes

| Artifact | SHA-256 |
| --- | --- |
| `contracts/schema.mjs` | `22998ab4479c57206f43214da70965d9d7896f593340129c73d7ba369728585f` |
| `contracts/validation.mjs` | `5c2156a11f438b4fd5e61b7ecab8a5aa429342babda6ffd8617842b6455049d9` |
| `fixtures/baseline.mjs` | `cd8733bebc8285bd7d4fb03cd486eb777b1b7c7664e3bb65c3bd5dcc97bea726` |
| `reference/hazard-evaluator.mjs` | `b3470b29469da6a1b6b13f70a01b35ba201a6722a7866b99474327ab20a5ce13` |
| `reference/atlas-coverage.mjs` | `5fcca7838ee0af6ad53b050be45189e8d06421d73816b3c650d8e0828c53ee0d` |
| `reference/view-model.mjs` | `a47b71fb81f53e6b9d934eaff50b51ab3bd1d421debbca426d43ac61e567b290` |
| `generated/SAFETY_INVARIANT_CATALOG_ROWS.DRAFT.md` | `13180ff2a62146afda638915a2787fd03e08b081dee2996b126b293b3e1e722e` |
| `generated/AUTONOMY_CLOSURE_REPORT_ROWS.DRAFT.md` | `11ba2da53b10ae7525d2c2e43171002d9f897add4aaa7a5efd3bbe1a1cff9023` |
| `generated/ASSURANCE_INSERTION_REQUEST.DRAFT.md` | `4f8724b997271315de863dbdbc642797743ae9c07f990e56e5b2cdeb1c99fd1d` |
| `RESEARCH_BASIS.md` | `1546d8eb35f237c5470b424a33c0278fc32c6e350ede34f59a53be9c414f90a3` |

These hashes are for implementation commit `5de362639638fafcd9563787647200bcbf175df5`; the receipt/state files are sealed by the following Git commit rather than self-hashed.

## Exact non-claims and remaining owner work

- The 54-pair owner review is a visibly synthetic contract fixture, not an accepted live-release review.
- No `OPERATIONAL_FAILURE_ATLAS.md` exists in this worktree; `PA-S1-IR-001` requests the canonical owner insertion.
- No production evaluator, route, store, page, supervisor mount, shared generated artifact, deployment fence, diagnostic handoff, exact fallback live readback, or external-watchdog live proof was implemented.
- The four exact hazard proof gaps remain `PA-S1-GAP-DEPLOYMENT-FENCING-COMPOSED-PROOF`, `PA-S1-GAP-DIAGNOSTIC-HANDOFF-COMPOSED-PROOF`, `PA-S1-GAP-EXACT-FALLBACK-LIVE-READBACK`, and `PA-S1-GAP-EXTERNAL-WATCHDOG-LIVE-PROOF`.
- No root/shared artifact was edited, no production/Q/L/other-IP path was written, no push occurred, and no external mutation was attempted.

## Scope proof

Implementation commit `5de362639638fafcd9563787647200bcbf175df5` contains exactly 21 files and 4,285 inserted lines. Every path begins with one of:

```text
fixtures/productAssurance/systemic/hazard/
test/productAssurance/systemic/hazard/
```

This seal adds only this receipt and the sibling packet-local state note under the first authorized prefix.
