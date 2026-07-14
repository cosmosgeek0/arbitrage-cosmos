# S4 assurance-case packet repaired-baseline scope blocker receipt

Receipt state: **BLOCKED_DIRECTOR_MERGE_SCOPE_GUARD**

Artifact semantics: **CLEAN**

Authority effect: **NONE**

This sibling receipt preserves the immutable original
`CASE_BLOCKED_RECEIPT.md`. The original System Integration blocker is resolved
upstream and is not waived: the repaired tree passes the full repository gate.
A new, narrower blocker remains because the mandatory S4 path-scope test still
measures the assigned pre-merge base through the director's two-parent repair
merge and therefore attributes director-owned baseline files to S4.
`CASE_PRESTAGE_READY` is not claimed.

## Source identity

| Evidence | Exact value |
| --- | --- |
| Branch | `ip-assur-case-20260713` |
| Assigned base | `c57610cb5f7d56efb61e53ae27057fbe92a6a2f6` |
| S4 implementation commit | `2f20acddcfbaba8db042fab024443924f7dee7d3` |
| S4 implementation tree | `eeea49d412bf886c422cc2f5d79246f6f3320883` |
| Implementation fixture subtree | `ebc068367d9c3bd4ca6436b5dc2f25e5d410246c` |
| Implementation/current test subtree | `6146b350ea7c5930dfef75af7e689c4a0d3006a9` |
| Original blocked seal | `be320e3c8614e237314b9ea39d385347c07924e3` |
| Director repair merge tested | `2d840599c716b5da8f5c42a272fc2232792f868c` |
| Director repair merge tree | `853fe6ca4734bc5cb176f870414861705730287d` |
| Repaired `current-main` merge parent | `f72c531f766d3f8ffa52e0f0e3fc77ef8345913b` |
| Upstream SI ruling A | `c43262af78b43de0ac5ec819e82f04af60f1f255` |
| Accepted S1 input | `ip-assur-hazard-20260713` at `ab33b3712cddd67c3ec91cfa1dd232c75226cd9f` |
| `IP_ASSURANCE.md` SHA-256 | `49dcd690275ff35cb32566af307ad572d2a527e06d7388885f98826560968e84` |
| Dedup matrix SHA-256 | `22686d2cd1c54bbc39af56399298a0ed9563bbc8643ad4f0e498718de83cb2cd` |
| Protected root I00 SHA-256 | `9d7a36da6a2e6e7b3e905c73161b5e998a2f92416dd557e498ade3e73d5e5ef5` |
| `package-lock.json` SHA-256 | `3c97820f912390fcad3dab57b436319b95c15bc7877384dd98032d7751ec2fcf` |
| Seal date | `2026-07-14` (`Asia/Kolkata`) |

The director merge has parents `be320e3c8614e237314b9ea39d385347c07924e3`
and `f72c531f766d3f8ffa52e0f0e3fc77ef8345913b`. The upstream ruling commit
`c43262af78b43de0ac5ec819e82f04af60f1f255` is an ancestor of the repaired
parent. The S4 test subtree is byte-identical at the implementation commit, the
original blocked seal, and the tested repair merge. The accepted S1 branch was
read only. The owner-supplied I00 remained untracked, unstaged, and
byte-identical.

## Verification evidence

The exact repaired commit was cloned into a disposable directory. The existing
sibling dependency tree was linked only in that disposable clone, and the
protected I00 input plus accepted S1 ref were supplied for identity checks.

| Gate | Exact result |
| --- | --- |
| `npm run test:all` | exit `0`; typecheck, build, and every repository family passed; System Integration `180/180` |
| S4 syntax | all `32` packet/test `.mjs` files passed `node --check`, exit `0` |
| S4 focused suite | `233` tests, `232` passed, `1` failed, exit `1` |
| Isolated S4 purity/scope file | `7` tests, `6` passed, `1` failed, exit `1` |
| Correct repaired-baseline path audit | `39` changed paths from `f72c531...` to the tested merge; `0` outside the two S4 roots |

The only focused failure is:

```text
test/productAssurance/systemic/assuranceCase/purity-scope.test.mjs:35
tracked and untracked paths remain inside the two exclusive roots
```

The assertion computes `git diff --name-only c57610c..HEAD`. At the repaired
merge it reports exactly these five paths:

```text
QL_DIRECTOR_STATE.md
QL_PARALLEL_DAG.md
SI_RECON_RECEIPT.md
WORKER_PROMPTS.md
server/test/systemIntegration/verticalSlice/authority.scenarios.test.mjs
```

Those paths are the exact first-parent change supplied by the director's
repaired-baseline parent. None is an S4-authored path. Conversely,
`git diff --name-only f72c531..2d84059` contains only the two authorized S4
roots. The merge changed no S4 byte relative to the original blocked seal.

## Boundary disposition

Path-scope and import-purity scans are mandatory acceptance evidence under
`IP_ASSURANCE.md` section 5. D-LAUNCH merge law assigns merge-triggered
scope-guard accommodation to the director under the documented Q08/Q15
pattern. The S4 builder therefore did not skip, weaken, or rebase the guard;
did not edit any director/shared/System Integration file; and did not issue an
acceptance receipt.

Required resolution: a director-owned baseline-aware scope-guard repair or an
explicit owner widening that preserves the active S4 scope check. A valid
repair can retain assigned-base ancestry while measuring S4-authored changes
against the repaired merge parent. After that lands, rerun the focused suite
and `npm run test:all`, then create the sibling acceptance receipt.

The enclosing documentation-only seal commit is intentionally not
self-recorded. No production, shared, Q/L, package, UI, runtime, other
satellite, S1, I00, external system, merge, push, or `current-main` mutation was
performed by this reseal.
