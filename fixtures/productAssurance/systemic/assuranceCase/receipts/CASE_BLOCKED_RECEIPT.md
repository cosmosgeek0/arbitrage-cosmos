# S4 assurance-case packet blocked receipt

Receipt state: **BLOCKED_BASELINE_TEST_ALL_FAILURE**

Artifact semantics: **CLEAN**

Authority effect: **NONE**

This receipt seals the completed packet-local amendment §5 implementation and the exact verification blocker. It is immutable after its containing Git commit; any correction requires a new sibling receipt. `CASE_PRESTAGE_READY` is not claimed.

## Source identity

| Evidence | Exact value |
| --- | --- |
| Branch | `ip-assur-case-20260713` |
| Required base | `c57610cb5f7d56efb61e53ae27057fbe92a6a2f6` |
| Implementation commit | `2f20acddcfbaba8db042fab024443924f7dee7d3` |
| Implementation tree | `eeea49d412bf886c422cc2f5d79246f6f3320883` |
| Implementation fixture subtree | `ebc068367d9c3bd4ca6436b5dc2f25e5d410246c` |
| Implementation test subtree | `6146b350ea7c5930dfef75af7e689c4a0d3006a9` |
| Accepted S1 input | `ip-assur-hazard-20260713` at `ab33b3712cddd67c3ec91cfa1dd232c75226cd9f` |
| `IP_ASSURANCE.md` SHA-256 | `49dcd690275ff35cb32566af307ad572d2a527e06d7388885f98826560968e84` |
| Dedup matrix SHA-256 | `22686d2cd1c54bbc39af56399298a0ed9563bbc8643ad4f0e498718de83cb2cd` |
| Protected root I00 SHA-256 | `9d7a36da6a2e6e7b3e905c73161b5e998a2f92416dd557e498ade3e73d5e5ef5` |
| `package-lock.json` SHA-256 | `3c97820f912390fcad3dab57b436319b95c15bc7877384dd98032d7751ec2fcf` |
| Seal date | `2026-07-14` (`Asia/Kolkata`) |

The owner-supplied I00 input remained untracked and unstaged. The separate accepted S1 branch was read only; no S1 byte or ref was changed.

## Delivered packet

- Thirteen exact amendment §5.3 mandatory claim nodes with locked owner, subclaim, assumption, direct evidence, counterevidence, component, invariant, and cockpit projection contracts.
- Read-only S1 projection pinned to the accepted branch, commit, schema blobs, and SHA-256 identities.
- Producer/verifier inequality, typed failure-domain coverage, reciprocal one-to-one independence-basis certification, graph-wide cross-role common-mode rejection, and globally unique source identities.
- Deterministic evidence expiry, S1 expiry, reverse transitive invalidation, bounded canonical invalidation paths, propagation/assurance deadlines, and conservative `UNKNOWN` handling for missing or indeterminate time authority.
- A closed render-neutral view boundary that revalidates packet semantics, reasons, graph paths, deadlines, diagnostic families, no-authority fields, and canonical declarative evidence statements.
- Packet-local `EXTENDED` DRAFT rows only; no shared insertion or production mount.

## Verification evidence

The exact implementation commit was cloned into a disposable directory. Root, server, web, and lock manifests were hash-identical to the assigned worktree; the existing sibling dependency tree was linked read-only. The protected I00 input and accepted S1 ref were supplied to the disposable clone solely so the packet scope/provenance tests could verify their exact identities.

| Gate | Exact result |
| --- | --- |
| S4 focused suite | `233` tests, `233` passed, `0` failed, exit `0` |
| Syntax | all `32` packet/test `.mjs` files passed `node --check`, exit `0` |
| Whitespace/scope/purity | passed; only the protected I00 input remained untracked |
| `npm test` | exit `0`; typecheck and build passed; Basis `107/107`, Volume `124/124`, financial safety `59/59`, storage/config/AWS `29/29`, Node groups `50/50`, `7/7`, and `1/1` |
| `npm run test:all` | exit `1`; every preceding family passed, then system integration reported `179/180` with one assertion failure |
| Required-base reproduction | exact base `c57610cb5f7d56efb61e53ae27057fbe92a6a2f6`, rebuilt server, isolated failing file: `28/29`, same assertion and exit `1` |

The exact repeatable failure is:

```text
server/test/systemIntegration/verticalSlice/authority.scenarios.test.mjs:521
synthetic helper coverage: partial and ambiguous states remain explicit data-only truth
actual: DIVERGED
expected: PARTIAL
```

There is no diff from the required base through the S4 implementation commit under `server/**`, `web/**`, `package.json`, `package-lock.json`, `server/package.json`, or `web/package.json`. The failing test and its production owner are therefore outside both S4 exclusive write roots.

## Adversarial closure

Independent read-only reviews and direct regression probes closed every reported S4 false-green, including basis/certified source and semantic reuse, cross-role actor/owner/failure-domain aliases across direct and basis records, local-alias masking, free-form instruction text, forged reason codes, forged diagnostic issue bridges, combined edge-bound overflow, future-expiry claims, null-origin assurance certainty, invalidation-path removal/reordering/truncation, UTC overflow, locale-dependent ordering, and forged no-authority fields.

Final rechecks reported the exact hostile repros fail closed, local-only common mode remain valid `UNKNOWN` and unusable, the focused suite at `233/233`, and no edits by reviewers.

## Boundary disposition

The S4 artifact is complete and its own gates are clean, but repository law requires `npm run test:all` before prestage readiness. Repairing or changing `server/test/systemIntegration/**` or its production owners would violate the assigned exclusive-write boundary. The truthful terminal outcome for this run is therefore `BLOCKED_BASELINE_TEST_ALL_FAILURE`.

The implementation commit contains exactly `38` files and `8,727` inserted lines. Every path begins with one of:

```text
fixtures/productAssurance/systemic/assuranceCase/
test/productAssurance/systemic/assuranceCase/
```

This seal adds only this receipt and the sibling packet-local state update. No production, shared, Q/L, other-IP, package, lockfile, root artifact, merge, push, or `current-main` operation occurred.
