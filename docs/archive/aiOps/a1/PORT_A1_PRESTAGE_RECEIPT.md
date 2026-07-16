# PORT A1 prestage receipt

Schema: `PORT_A1_PRESTAGE_RECEIPT_V1`
Status: `PORT_A1_PRESTAGE_READY`

## Verdict

The sealed A1 contract lane at `83c1624d4a582eace27321182de35c372babbc1a` and A1X extension at `e65cdca872e4cd6e35a8e18c12b71f16597c80d3` were semantically ported onto the assigned accepted base and fully re-accepted inside the A1 lane. The three shadow receipts remain immutable provenance only. This is a real port receipt bound to the tested implementation commit below.

The result creates no operational authority. Providers are fake or not configured, owner signatures remain absent, shared owners remain unmounted, all controls remain insertion-only, and `LIVE_EXECUTION_NOT_IMPLEMENTED` remains enforced. No credential, money path, deployment, private or signed exchange call, push, merge, or shared-seam edit occurred.

## Immutable identity and lineage

| Object | Identity |
| --- | --- |
| Branch | `port-a1-20260716` |
| Assigned base | `492e3f69b054c85686bcfc4c09dbff4ababeda3f` |
| Assigned base tree | `3adef4d97ab595a8c81a307bac8dce22d037abdb` |
| Tested implementation | `e9d028a9f5022dee1be80ee4f5e1f8ae6490f53c` |
| Implementation tree | `cc56bf472a753f5a0aa65b7e5426d8235b4d4491` |
| Implementation parent | `492e3f69b054c85686bcfc4c09dbff4ababeda3f` |
| Base/implementation merge base | `492e3f69b054c85686bcfc4c09dbff4ababeda3f` |
| Shadow origin | `03857dcdaff8d8b12627d27ddcc97505da1f2f86`, tree `92a2ec21b060eb0da3c98e3d6b16fad9843bbf89` |
| Shadow A1 implementation | `21ac214798bea6402c50ece3e026c00df4d582d8`, tree `eab7eeafac42dd7e7f286e1a7b3e7fe9ec9b0129` |
| Shadow A1 seal | `83c1624d4a582eace27321182de35c372babbc1a`, tree `5764ea9eac3d0681cd3f8d149d9f8488f5fcd226` |
| Shadow A1X implementation | `8c8bcf27c915c12946a7913a9c55351124b8180f`, tree `961804dee346b8667a80c36b7bd168739ae842ea` |
| Shadow A1X seal/tip | `e65cdca872e4cd6e35a8e18c12b71f16597c80d3`, tree `bea3fd8da546b7e3d6e095590d9790d5085c2acc` |
| Insertion-registry authority | `08e0beaa54c4c3ca9c24276785d6a302f751a226`, tree `b2e0b07a145861d984b0048725f030b84127e92d`, collision-map blob `5f76b29a81b6af4eee7a156afc16979fea02635e` |
| Port plan script SHA-256 | `85ff3a21f4e97aef52b934a0ac3975580ca3675d655bd11a8e078b5dea28b0c5` |
| Receipt seal commit | `ENCLOSING_COMMIT_NOT_SELF_REFERENTIAL` |

At receipt creation, local `current-main` and `origin/current-main` were observed at `787b73d108764d628f925ee630bfe2fbef89458e`. This lane remained pinned to its assigned base; it was not rebased, merged, pushed, or compared as an authority substitute.

The donor cumulative change from shadow origin through A1X seal contains 44 additive paths and 45,055 insertions; its sorted path-list SHA-256 is `395d2aed557eb31b45bcc98588fee1d82ece8d346bc13a522fc9ecd54d4de830`. The accepted-base implementation contains exactly 44 additive paths and 46,106 insertions; its sorted path-list SHA-256 is `7cb61bbd71d5905c9a1a031378a8291fde860f2c5ad7fa2789cec1edef19d037`.

## Archived shadow-receipt integrity

| Receipt | Sealed Git blob | SHA-256 |
| --- | --- | --- |
| `A1X_SHADOW_READY_RECEIPT.md` | `df0e652bf54c868b1dfa69ae3c52f7749318b13d` | `16c7797788606e9569caff38df445a25e46e4b45919e6a2708529cc3d172263f` |
| `AI_OPS_REUSE_AND_GAP_RECEIPT.md` | `05844fa0d32322679935bc476e705c3513beefd1` | `d4c29401afab23561daa28932552aec73ae0de242c69c9ccb2cae3d29fbb0753` |
| `SHADOW_ARTIFACT_READY_RECEIPT.md` | `2876d3d6afee3d5c3fffaee8225e618b26e3f4d0` | `22bd861974c4a622e57a247bf581f9f71558d3084560d7c10bdef26abd535a36` |

The A1 receipt names its implementation but not its enclosing A1 seal. The A1X receipt names the A1 seal and A1X implementation but not its enclosing A1X seal. Exact archived bytes plus the Git parent chain establish those seals without impossible self-reference.

## Exact implementation path manifest

### Production contracts: 12

- `server/src/aiOps/contracts/controls.ts`
- `server/src/aiOps/contracts/index.ts`
- `server/src/aiOps/contracts/insertionRequests.ts`
- `server/src/aiOps/contracts/schemas.ts`
- `server/src/aiOps/contracts/shared.ts`
- `server/src/aiOps/identity/identity.ts`
- `server/src/aiOps/manifests/artifacts.ts`
- `server/src/aiOps/manifests/classification.ts`
- `server/src/aiOps/manifests/instances.ts`
- `server/src/aiOps/policy/authority.ts`
- `server/src/aiOps/policy/policy.ts`
- `server/src/aiOps/reliability/runbooks.ts`

### Focused tests: 9

- `server/test/aiOps/a1/_network-denied-env.mjs`
- `server/test/aiOps/a1/artifacts-purity.test.mjs`
- `server/test/aiOps/a1/authority-identity.test.mjs`
- `server/test/aiOps/a1/classification.test.mjs`
- `server/test/aiOps/a1/controls-insertion.test.mjs`
- `server/test/aiOps/a1/instances.test.mjs`
- `server/test/aiOps/a1/receipt.test.mjs`
- `server/test/aiOps/a1/runbook-policy.test.mjs`
- `server/test/aiOps/a1/schema-closure.test.mjs`

### Generated fixtures and generator: 20

- `fixtures/aiOps/a1/action-class-fixture-instances.v1.json`
- `fixtures/aiOps/a1/action-classes.v1.json`
- `fixtures/aiOps/a1/adapted-schemas.v1.json`
- `fixtures/aiOps/a1/capability-graduation-target-instances.v1.json`
- `fixtures/aiOps/a1/capability-matrix.v1.json`
- `fixtures/aiOps/a1/classification-manifest.v1.json`
- `fixtures/aiOps/a1/control-insertion-requests.v1.json`
- `fixtures/aiOps/a1/decision-log-design.synthetic.v1.json`
- `fixtures/aiOps/a1/entry-inventory.v1.json`
- `fixtures/aiOps/a1/generate-artifacts.mjs`
- `fixtures/aiOps/a1/hard-denials.v1.json`
- `fixtures/aiOps/a1/identity-provider-matrix.v1.json`
- `fixtures/aiOps/a1/insertion-requests.v1.json`
- `fixtures/aiOps/a1/mechanical-authority-manifests.v1.json`
- `fixtures/aiOps/a1/policy-bundle.synthetic.v1.json`
- `fixtures/aiOps/a1/reliability-targets.v1.json`
- `fixtures/aiOps/a1/runbook-manifest-instances.v1.json`
- `fixtures/aiOps/a1/runbook-templates.v1.json`
- `fixtures/aiOps/a1/schema-reuse-map.v1.json`
- `fixtures/aiOps/a1/unfinished-interfaces.v1.json`

### Archived donor receipts: 3

- `docs/archive/aiOps/a1/shadow/A1X_SHADOW_READY_RECEIPT.md`
- `docs/archive/aiOps/a1/shadow/AI_OPS_REUSE_AND_GAP_RECEIPT.md`
- `docs/archive/aiOps/a1/shadow/SHADOW_ARTIFACT_READY_RECEIPT.md`

This receipt is the sole additional path in its documentation-only child commit.

## Reconciliation and deduplication

- D-LAUNCH-50 is the accepted base authority. Its core product is integrated-accepted, while I14 production activation remains owner-gated and unperformed. No deployment or external action is inferred.
- The five-root TypeScript fan-out preserves all sealed public exports. An AST parity audit across all 12 donor modules found zero missing exports.
- The sealed decision-log persistence contract survives as an injected, unmounted narrow adapter over the sole canonical Ledger. It creates no store and always returns `SHADOW_SPECULATIVE` with `durable: false`; mounting remains `AIOPS-IR-PERSISTENCE-003`.
- Product Assurance supplies non-executing policy, evidence, and remediation vocabulary. It does not become an AI executor, control owner, or runtime authority.
- The generated diagnostic-boundary snapshot is explicitly stale/reference-only. Current acceptance comes from D-LAUNCH-50 and current owner objects, not the frozen candidate-era I00 state file.
- `foundation.failures` is reference-only because A1 does not import that dialect. Control, command, Ledger, assurance, and remediation owner rows bind their exact insertion requests.
- The inventory remains 79 rows with dispositions `REUSE=8`, `ADAPT=19`, `REFERENCE_ONLY=36`, `REJECT_DUPLICATE=8`, and `MISSING_REQUIRED=8`. Its complete canonical full-row digest is `07d1d5f80ebb711b4a7b615788974df4acbeefb5f698406ddc7810db9b336e72`.
- Seven external-reference rows are validated through full committed receipt/object evidence, so focused acceptance does not read mutable external worktrees.

## Closed lane facts

- 19 generated artifacts match current sources and accepted-base provenance.
- All 12 production sources have closed direct-import classification coverage.
- The base classification manifest has 38 entries: `B=2`, `C=22`, `D=14`, with no unresolved dependency or cycle.
- A1X has 31 unsigned/inactive authority roots over 71 classification entries, with no unresolved dependency or cycle.
- All 14 permanent hard denials remain Class D.
- All 120 `AI_OPS.A01` through `AI_OPS.L10` controls remain `NOT_WIRED`, disabled, null-handler, and insertion-only.
- The five provider states, four identities, 16 identity/provider rows, ten unsigned Class-A runbooks, 17 unmeasured graduation targets, and four A/B/C/D fixtures remain closed and non-authoritative.
- Policy and runbook evaluation fail closed without owner-trusted time, raw cohort/readback, exact signatures, and durable owner evidence.
- No production ambient filesystem, environment, network, timer, socket, child-process, random, or clock effect exists in the A1 source roots.

## Shared seams

The lane owns exactly these 11 rows; every row remains `DRAFT`, `PENDING_BACKEND:<rowId>`, and `authorityCreated=false`:

- `AIOPS-IR-PERSISTENCE-003`
- `AIOPS-IR-AUTH-004`
- `AIOPS-IR-PACKAGE-006`
- `AIOPS-IR-CONTROLS-008`
- `AIOPS-IR-REMEDIATION-010`
- `AIOPS-IR-ASSURANCE-011`
- `AIOPS-IR-INCIDENT-019`
- `AIOPS-IR-AUDIT-021`
- `AIOPS-IR-APPROVAL-023`
- `AIOPS-IR-CONFIG-025`
- `AIOPS-IR-TEST-MOUNT-026`

`AIOPS-IR-DOCS-017` and `AIOPS-IR-BARREL-018` remain external integrator dependencies and were not re-authored as lane-owned rows. No shared package, root test mount, canonical registry, route, owner document, or `STATE.md` file was edited.

## Current-source research

- Node.js 22 permission-model documentation: <https://nodejs.org/docs/latest-v22.x/api/permissions.html>
- Node.js 22 test-runner execution model: <https://nodejs.org/download/release/latest-v22.x/docs/api/test.html#test-runner-execution-model>
- TypeScript NodeNext module rules: <https://www.typescriptlang.org/docs/handbook/modules/reference.html#node16-node18-node20-nodenext>

Applied conclusions: the repository's ESM/NodeNext sources retain explicit `.js` import specifiers; the Node permission model constrains child processes and filesystem access but does not itself provide the required total network denial, so focused acceptance combines Node permissions with a macOS `sandbox-exec` `(deny network*)` policy and an in-process egress tripwire.

## Verification evidence

| Verification | Result |
| --- | --- |
| `npm run typecheck -w server` | exit `0` |
| `npm run build -w server` | exit `0` |
| `node fixtures/aiOps/a1/generate-artifacts.mjs --write` | exit `0`; `WROTE 19 AI Ops A1 artifacts` |
| `node fixtures/aiOps/a1/generate-artifacts.mjs --check` | exit `0`; `MATCHED 19 AI Ops A1 artifacts` |
| Implementation-mode focused suite under OS `deny network*`, Node permissions, one process, concurrency 1 | exit `0`; tests `63`, passed `62`, failed `0`, skipped `1` expected receipt-mode test; egress attempts `0` |
| Receipt-mode focused suite with `AI_OPS_REQUIRE_PORT_RECEIPT=1` and `AI_OPS_EXPECTED_IMPLEMENTATION_SHA=e9d028a9f5022dee1be80ee4f5e1f8ae6490f53c` | exit `0`; tests `63`, passed `63`, failed `0`, skipped `0`; egress attempts `0` |
| `npm test` from the clean implementation commit | exit `1`; single shared `LIVE_OPERATION_POLICY` denominator mismatch described below |
| `npm run test:all` from the clean implementation commit | exit `1`; same single shared `LIVE_OPERATION_POLICY` denominator mismatch |
| Focused `test/i00/product-assurance-live-operation.test.mjs` | exit `1`; expected files `518`, observed `530`, discovered `205`, covered `205`, uncovered `0`; every check except `filesScanned` passed |
| `git diff --check` and staged diff check | exit `0` |
| Exact scope/mode audit | 44/44 implementation paths authorized; no symlink; no executable mode; no out-of-scope drift |
| Secret/money/authority scan | no real credential, endpoint/auth header, private or signed call, money mutation, duplicate concrete owner, or second store/cache/scanner/socket/executor |
| Donor parity audit | 44/44 mapped files; zero missing public exports or sealed capability |

The aggregate mismatch is the exact twelve-file increase caused by the 12 new A1 production TypeScript files. Operation-site coverage is unchanged and complete at 205/205 with zero uncovered. Updating the shared Product Assurance scan denominator and mounting the accepted lane suite belong to the fresh integrator through `AIOPS-IR-ASSURANCE-011` and `AIOPS-IR-TEST-MOUNT-026`; A1 did not alter that shared manifest to manufacture aggregate green.

The focused command used for both lane runs was:

```sh
AI_OPS_OS_NETWORK_DENY=1 sandbox-exec -p '(version 1)(allow default)(deny network*)' node --permission --allow-fs-read=/Users/cosmosgeek/Desktop/port-a1 --experimental-test-isolation=none --test --test-concurrency=1 --test-reporter=spec 'server/test/aiOps/a1/**/*.test.mjs'
```

Seal mode additionally set:

```sh
AI_OPS_REQUIRE_PORT_RECEIPT=1 AI_OPS_EXPECTED_IMPLEMENTATION_SHA=e9d028a9f5022dee1be80ee4f5e1f8ae6490f53c
```

## Adversarial self-review and limitations

- The receipt does not promote shadow receipts into acceptance evidence; it binds the real accepted-base implementation SHA.
- The receipt cannot name its own enclosing commit. The enclosing receipt-only seal is reported by the handoff after commit.
- No runbook, policy, provider, control, approval, audit, persistence, incident, package, barrel, documentation, or test-mount shared owner is silently fabricated.
- Owner signatures, real provider configuration, independent audit delivery, incident ownership, human approval, Ledger mount, control handlers/readback, and runbook effect bindings remain explicitly missing or not configured.
- I14 deployment/activation remains owner-only and was neither authorized nor performed.
- Aggregate acceptance is intentionally not claimed green while the shared 518-file manifest denominator remains unchanged. The lane-scoped port is ready for the fresh integrator to apply the named insertion requests.

## Terminal state

Implementation commit `e9d028a9f5022dee1be80ee4f5e1f8ae6490f53c` is a direct child of exact assigned base `492e3f69b054c85686bcfc4c09dbff4ababeda3f`. The implementation is scope-clean, donor-complete, deterministic, effect-free, and fully green under total network denial. The sole aggregate limitation is an honest shared-manifest insertion request with zero uncovered operation sites.

`PORT_A1_PRESTAGE_READY`
