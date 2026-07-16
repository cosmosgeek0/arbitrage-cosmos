# PORT A4 Receipt — BLOCKED

## Ruling

- Port lane: `A4`.
- Branch: `port-a4-20260716`.
- Result: `BLOCKED`.
- The fixture-driven A4+A4X implementation is committed, focused-test green, build-green, browser-verified, and preserved intact.
- `PORT_A4_READY` is not granted because the mandatory repository-wide gate in `PORT_PLAN.md` exited nonzero.
- No A4 implementation rollback, reset, deletion, push, merge, or out-of-scope repair was performed.

## Immutable binding

- Port base commit: `492e3f69b054c85686bcfc4c09dbff4ababeda3f`.
- Port base tree: `3adef4d97ab595a8c81a307bac8dce22d037abdb`.
- Implementation commit: `a4a0fb5bcf06aaa912d5042311e34c93a9457b13`.
- Implementation tree: `253205ae9d740d772a074c020b6cde0b7cfc2809`.
- Implementation parent: `492e3f69b054c85686bcfc4c09dbff4ababeda3f`.
- Implementation subject: `feat(aiops): port sealed A4 operator surface`.
- Implementation inventory: 25 additive files, 8,103 additions, 0 deletions.
- This receipt is the sole follow-up commit. Resolve its enclosing immutable commit without a circular self-reference using:

```sh
git log -1 --format=%H -- docs/archive/aiOps/a4/PORT_A4_RECEIPT.md
```

## Sealed donor lineage

The exact cumulative donor chain is:

1. Shadow base `03857dcdaff8d8b12627d27ddcc97505da1f2f86`, tree `92a2ec21b060eb0da3c98e3d6b16fad9843bbf89`.
2. A4 implementation `f174610e5e7837d52816e38c98acc3e426ee64f2`, tree `b02ebe3834b51c106683e2b18c47deb6313685ab`.
3. A4 seal `b5f4c478223796cf7f9d73ba8c424a179aaa8551`, tree `3d4f7797ddb9faa841ffc032ee04a4ae5cbb6931`.
4. A4X implementation `39821aa7a17b38fdc500252e24fac64a32ba3afe`, tree `85a385efdfb63183c69ef3a5b51d9dd100e5f42b`.
5. A4X seal `6204667e22d128ceae9eda732340b8f1d39577f2`, tree `dca166ecd399238b6a0d6a31bbb7eec40d413bc8`.

The cumulative donor range contained 25 additive paths, 7,317 additions, and 0 deletions.

The analyzed port script SHA-256 was:

`b5b320100eefb8be47f639532f64e4ea3f228632ed553a0d2e6ec150db6ca4c5`

The following historical donor objects remain byte-identical after relocation:

- A4 shadow receipt blob: `07155022cea7f68f0528330caaa5313f881a6e6a`.
- A4X shadow receipt blob: `120b269ea29b910b6b9413338ca1033a3ae63011`.
- Shadow fixture manifest blob: `0dacefd3db8b8b888db603992290cf118530aed3`.

The historical receipts retain their original shadow rulings as immutable evidence. Their historical `BLOCKED` and `A4X_SHADOW_READY` terminators do not describe this real-phase port.

The donor insertion draft was intentionally replaced by the immutable-registry-bound port projection rather than claimed as byte-preserved. The active port insertion-set blob is `cdf5b26e0afb960a0f7772195fac807614999afc`.

## Exclusive-scope inventory

Implementation paths by ratified namespace:

- `web/src/aiOps/**`: 15 files.
- `web/test/aiOps/**`: 6 files.
- `fixtures/aiOps/a4/**`: 2 files.
- `docs/archive/aiOps/a4/**`: 2 historical receipts.

Exact implementation inventory:

```text
docs/archive/aiOps/a4/shadow/AI_OPS_A4X_SHADOW_RECEIPT.md
docs/archive/aiOps/a4/shadow/AI_OPS_A4_SHADOW_RECEIPT.md
fixtures/aiOps/a4/ai-ops-shadow-fixture.v1.json
fixtures/aiOps/a4/insertion-requests.v1.json
web/src/aiOps/AiOpsWorkspace.tsx
web/src/aiOps/aiOps.css
web/src/aiOps/components.tsx
web/src/aiOps/controlProjection.ts
web/src/aiOps/fixture.ts
web/src/aiOps/index.ts
web/src/aiOps/preview/index.html
web/src/aiOps/preview/main.tsx
web/src/aiOps/preview/preview.css
web/src/aiOps/types.ts
web/src/aiOps/views/GovernanceView.tsx
web/src/aiOps/views/IncidentWorkspace.tsx
web/src/aiOps/views/OverviewView.tsx
web/src/aiOps/views/OwnerChat.tsx
web/src/aiOps/views/PermissionsConsole.tsx
web/test/aiOps/contracts.test.mjs
web/test/aiOps/import-purity.test.mjs
web/test/aiOps/insertion-requests.test.mjs
web/test/aiOps/render.test.mjs
web/test/aiOps/source-boundary.test.mjs
web/test/aiOps/total-network-deny-preload.mjs
```

This receipt is the sole follow-up path.

No `App.tsx`, store, route, navigation, shared UI owner, package, lockfile, backend route, canonical registry, root document, current-main, or other worktree path was edited.

## Delivered port

The committed port provides:

- A fixture-driven AI Ops overview and five-level cockpit.
- Incident suppression, inhibition, actionability, validation, evidence, forensic, and disabled-command projections.
- Local-only owner chat with explicit context/session lineage and no provider, session, persistence, or send path.
- A permission console with 120 bounded control specifications, fail-closed intent projection, emergency-kill separation, and no effective authority fabrication.
- Provider qualification, capability graduation, reasoning-mode, runbook, policy, and identity governance views.
- Bounded historical trends with explicit gaps, hostile-limit normalization, and bounded forensic drill-down.
- Light/dark presentation, reduced/full motion selection, keyboard-operable tabs and category radios, visible focus, internal evidence scrollers, and locked typography.
- An isolated preview entry only; no product route or canonical mount.

The fixture deliberately preserves:

- `SHADOW_SPECULATIVE`
- `SYNTHETIC_ONLY`
- `DIRECTOR_MOUNT_REQUIRED`
- `UNFINISHED_I00_INTERFACES`
- `NOT_WIRED`, `UNKNOWN`, `MISSING`, and other unavailable states

No fixture state is promoted to canonical operational truth.

## Immutable insertion-request binding

The active insertion set is bound to:

- Registry commit: `08e0beaa54c4c3ca9c24276785d6a302f751a226`.
- Registry tree: `b2e0b07a145861d984b0048725f030b84127e92d`.
- Registry blob: `5f76b29a81b6af4eee7a156afc16979fea02635e`.
- Landed `InsertionRequestRowV1` schema blob: `042456c58b1cd5b6eb179c0c9c289f6e69d06034`.
- Base binding: `492e3f69b054c85686bcfc4c09dbff4ababeda3f`.
- Posture: `PORT_A4_PRESTAGE_DRAFT`.
- `directEditAllowed=false`.
- `authorityCreated=false`.

The 17 exact A4 registry rows are:

1. `AIOPS-IR-ROUTES-002`
2. `AIOPS-IR-AUTH-004`
3. `AIOPS-IR-NAVIGATION-005`
4. `AIOPS-IR-PACKAGE-006`
5. `AIOPS-IR-CONTROLS-008`
6. `AIOPS-IR-EVENTS-009`
7. `AIOPS-IR-TELEMETRY-012`
8. `AIOPS-IR-REFRESH-013`
9. `AIOPS-IR-NOTIFY-014`
10. `AIOPS-IR-COCKPIT-015`
11. `AIOPS-IR-INCIDENT-019`
12. `AIOPS-IR-SENTINEL-020`
13. `AIOPS-IR-AUDIT-021`
14. `AIOPS-IR-MANAGED-INVENTORY-022`
15. `AIOPS-IR-APPROVAL-023`
16. `AIOPS-IR-BROWSER-PROBE-024`
17. `AIOPS-IR-TEST-MOUNT-026`

Each row exactly matches the immutable registry extraction, validates against the landed row schema, remains `DRAFT`, and has `PENDING_BACKEND:<rowId>` wiring. No foreign insertion request or shared-edit authority was created.

## Focused network-denied acceptance

Command:

```sh
/usr/bin/sandbox-exec -p '(version 1) (allow default) (deny network*)' \
  node --import ./server/test/private-egress-tripwire.mjs \
  --import ./web/test/aiOps/total-network-deny-preload.mjs \
  --import tsx --test --test-concurrency=1 --test-reporter=spec \
  "web/test/aiOps/**/*.test.mjs"
```

Final result on the committed implementation:

- Exit: 0.
- Tests: 48.
- Passed: 48.
- Failed, skipped, cancelled, todo: 0.
- Duration: 1,260.846583 ms.
- Contract tests: 20.
- Import-purity tests: 3.
- Immutable insertion-request tests: 5.
- Static-render tests: 11.
- Source-boundary tests: 9.

The proof covered deterministic/deep-frozen fixtures, hostile limits and missing selections, derived counts, source provenance, strict insertion-registry equality, import purity, no unreviewed browser or JSX egress channel, process-fatal caught network denials, URL/path/userinfo redaction, no live host or credential, no money-path invocation, and no bulk-enable or diagnostic-resume control.

## Typecheck and builds

- `npm run typecheck -w web`: exit 0.
- `npm run build -w web`: exit 0; 1,883 modules transformed in 1.05 s. The existing greater-than-500-kB chunk warning remained non-fatal.
- `./node_modules/.bin/vite build web/src/aiOps/preview --outDir /tmp/aiops-a4-preview-dist --emptyOutDir`: exit 0; 1,796 modules transformed in 655 ms.
- Isolated preview output: HTML 0.42 kB, CSS 1,255.99 kB, JS 296.47 kB.
- The preview build emitted only non-fatal lucide `use client` directive warnings.
- `git diff --check`: exit 0.
- Exact implementation path audit: all 25 paths were within the four exclusive A4 namespaces.

## Rendered browser verification

The isolated preview was reloaded after the final build and inspected in the in-app browser.

Verified viewport matrix:

- 2,940 × 1,200.
- 1,920 × 1,080.
- 1,440 × 900.
- 1,536 × 864, equivalent to the 1,920-wide 125-percent check.
- 1,152 × 720, equivalent to the 1,440-wide 125-percent check.
- 390 × 844 mobile.
- Final restored viewport: 1,280 × 720.

Results:

- No document-level horizontal overflow at any inspected desktop viewport.
- Final 1,280 document client/scroll widths: 1,265 / 1,265.
- Final desktop local-tab client/scroll heights: 47 / 47.
- Mobile document client/scroll widths: 375 / 375.
- Mobile local-tab client/scroll heights: 32 / 32.
- Mobile local-tab client/scroll widths: 361 / 707, providing intentional internal horizontal scrolling without page overflow.
- The bounded mobile evidence surface similarly retained its internal scroller rather than widening the document.
- Runtime console warning/error query returned exactly `[]`.

Computed typography inspected after final CSS:

- Page title: 22 px / weight 540 / 30 px line height.
- Summary label: 10.5 px / weight 560.
- Summary value: 18 px / weight 510.
- Primary row text: 12.75 px / weight 490 / 18 px line height.
- Secondary row text: 10.5 px / weight 410 / 15 px line height.
- Status text: 9.75 px / weight 500 / 14 px line height.

Interaction checks included:

- Top-level tab click and Arrow/Home/End roving behavior.
- Incident projection with all eight commands disabled and `NOT_WIRED`.
- Owner Chat local draft preparation with disabled send and no form action or method.
- Cockpit L1 through L5 selection and keyboard restoration.
- Permission category A, B, and All selection; search narrowing; unique Inspect actions; and disabled effect controls.
- Absence of the former native select and preservation of radio semantics.
- Light and dark themes.
- Full and reduced motion.
- Final state restored to Overview, light theme, and reduced motion.

In-app screenshots were visually inspected. No screenshot artifact or external resource was added to the repository.

## Repository gates

### Normal repository gate

Command:

```sh
npm test
```

Result: exit 0 on implementation commit `a4a0fb5bcf06aaa912d5042311e34c93a9457b13`.

### Mandatory burst-wide gate

`PORT_PLAN.md` requires every lane in this cross-family burst to run `npm run test:all`; a nonzero result prevents `PORT_A4_READY`.

Command:

```sh
npm run test:all
```

Result: exit 1.

Every layer reached before the I00 proof stage passed, including System Integration 401/401. The I00 proof stage reported:

- Tests: 47.
- Passed: 45.
- Failed: 2.
- Skipped, cancelled, todo: 0.

The exact failures were:

1. `server/test/i00Acceptance/authority-protocol.test.mjs:84`

   `final D-LAUNCH-7 repin accepts exact current-main objects while historical packet pins stay immutable`

2. `server/test/i00Acceptance/closure-evidence.test.mjs:333`

   `current machine evidence is input-driven for both legal candidate phases and historical IP-PROOF evidence stays historical`

Protected-input evidence captured by the failed gate:

| Path | Expected SHA-256 | Observed SHA-256 |
| --- | --- | --- |
| `QL_DIRECTOR_STATE.md` | `77f7c47251e6c9f990352c6ca63408a5a2dbfbbfb87cac0f38d71bf0446258cc` | `57eaf6d10e5a4c3fe9dc60324fb906ebe1385aeb082283930853cbfdf19d0494` |
| `QL_PARALLEL_DAG.md` | `cb4312843160e5f72029ee9f7b169987cfc07b9ef82d952c3feba60476392dec` | `89a13c8a6a6b00a834d3dc586cc45c29eb4f7f32b2106fb5dea10fd2be3742a0` |

The failed run captured accepted-source tip `d78be24f4da14632c857ee250b62e3fec33c2743`. That moving external ref advanced after the run; this receipt preserves the exact gate-time evidence and does not rewrite it against a later ref value.

A direct focused reproduction of the I00 proof stage produced the same 45/47 result in 11,574.986333 ms.

Neither protected file, the living-director acceptance record, nor any I00 proof source was changed by A4. The observed protected-file bytes were already present at port base `492e3f69b054c85686bcfc4c09dbff4ababeda3f`. The failure is therefore pre-existing and outside A4's exclusive authority, but the mandatory gate remains nonzero and cannot be waived by this worker.

Because the script stopped at the I00 proof failure, later fail-fast `test:all` commands were not represented as completed by this invocation.

## Current-source research

Current official sources were reviewed before real-phase adaptation on 2026-07-16:

- React component and hook purity informed deterministic render behavior and the absence of render-side effects: <https://react.dev/reference/rules/components-and-hooks-must-be-pure>
- React static markup rendering informed the isolated structural render proofs: <https://react.dev/reference/react-dom/server/renderToStaticMarkup>
- W3C tab guidance informed Arrow/Home/End behavior and selected/focus semantics: <https://www.w3.org/WAI/ARIA/apg/patterns/tabs/>
- W3C radio guidance informed the permission-category control: <https://www.w3.org/WAI/ARIA/apg/patterns/radio/examples/radio/>
- W3C switch guidance informed the decision to avoid presenting unavailable backend effects as active switches: <https://www.w3.org/WAI/ARIA/apg/patterns/switch/>
- Current Node test-runner guidance informed explicit process exit, serial execution, and hostile failure proof: <https://nodejs.org/api/test.html>

These citations use only hosts admitted by the A4 receipt source-boundary test.

## Safety and permanent non-claims

- All provider, model, case, identity, receipt, and control data is deterministic fixture data.
- The only provider hostname ends in `.invalid`.
- No credential, secret, provider SDK, provider call, subscription session, live endpoint, network client, socket, timer, persistence owner, or browser store was added.
- The focused suite ran under OS-level total network denial and executable channel guards.
- No live or test order, cancellation, borrow, repay, transfer, withdrawal, leverage/margin mutation, signed/private exchange request, or withdrawal/transfer-out UI exists.
- No canonical incident, provider, control, approval, notification, telemetry, audit, sentinel, managed-inventory, browser-probe, or effective/readback owner was created.
- No self-approval, self-verification, self-resume, permission expansion, safety weakening, evidence rewrite, Main/current-main write, push, merge, or deployment occurred.
- The implementation remains unmounted and cannot claim integrated AI-Ops, deployed, live, or production status.

## Additional limitation

The focused A4 suite is invoked explicitly. Canonical root discovery still does not register `web/test/aiOps/**`; that shared-owner change remains represented by `AIOPS-IR-TEST-MOUNT-026`. A4 did not edit a shared package or root test runner to conceal that limitation.

## Precise blocker and resume condition

Blocker:

`MANDATORY_TEST_ALL_PROTECTED_DIRECTIVE_PIN_DRIFT`

`npm run test:all` must exit 0 before this lane can become `PORT_A4_READY`. The two failing protected-directive assertions are outside A4's exclusive namespaces and already fail against the port base bytes. A4 is forbidden from editing those owner-controlled files, their canonical acceptance pins, or current-main.

The implementation commit `a4a0fb5bcf06aaa912d5042311e34c93a9457b13` remains the preserved, sound A4 result.

Resume with the same worker message only after the responsible owner repairs or re-ratifies the protected current-main directive binding and makes the correction available to this worktree without granting A4 shared-path authority. Then:

1. Revalidate the exact base/implementation ancestry and scope.
2. Rerun the 48-test focused suite under total network denial.
3. Rerun web typecheck and both builds.
4. Rerun `npm test`.
5. Rerun `npm run test:all` to exit 0.
6. Repeat rendered checks if any executable or presentation byte changed.
7. Seal a new immutable ready receipt without rewriting this blocked evidence.

`BLOCKED`
