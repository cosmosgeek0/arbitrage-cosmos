# System Convergence Receipt

Status: **ACCEPTED FOR DIRECTOR HANDOFF — NOT PUSHED, MERGED, OR DEPLOYED**

This receipt is the measured audit trail for
`SYSTEM_CONVERGENCE_VERTICAL_SLICE_MAX_POWER_SPRINT.md`. The user correction
supersedes the directive's stale integration assumptions: all five organ
families were already integrated at the accepted base. No branch was merged,
no worktree was created, and neither defunct Desktop clone was accessed.

## Integration identity

- Repository: `/Users/cosmosgeek/Desktop/Main`
- Integration checkout/worktree: the existing primary checkout at
  `/Users/cosmosgeek/Desktop/Main`; no new worktree was created
- Branch: `system-convergence-vertical-slice-20260711`
- Accepted base and starting HEAD:
  `87af78285a4b11bc8ca98c4cc9b3bb4a551d2537`
- Code/UI acceptance tip:
  `b62225254ef5f2087f4044183723a4918dfbbe08`; the final documentation seal is
  reported by the Git handoff because a commit cannot contain its own SHA
- `current-main` and `origin/current-main` at start: exact same SHA
- Push authorization: none; this branch will not be pushed
- Default-branch action: none; this branch will not be merged into
  `current-main`

## Protected untracked inputs

The first status check found exactly these six untracked inputs and no tracked
or staged change. They are read-only sprint inputs and must never be staged or
committed.

| File | SHA-256 |
| --- | --- |
| `ENGINE_SPRINT_5H.md` | `5749b585b5f0f19fff964bc191df802c1461a6ae9614fc1547c8c8a668a403a0` |
| `LIVE_INTELLIGENCE_RUNTIME_MAX_POWER_SPRINT.md` | `4ae6fcab355a4ac6e75c1fe04275ad59ca27498e68c642519a293265ab76d0bb` |
| `MARKET_INTELLIGENCE_MAX_POWER_SPRINT.md` | `8b57083ae0ad5646ba47f89c043a0aa822478b68c4599c637527f35ea236c653` |
| `PARALLEL_BACKEND_MAX_POWER_SPRINT.md` | `7c302981955dc883ee55848147ec9515a3005a02c63eacf6acdc95106ea1bac6` |
| `SYSTEM_CONVERGENCE_VERTICAL_SLICE_MAX_POWER_SPRINT.md` | `a68927b3ac3b5b39e8032a6002eac14b85aa0afcb32a4e6c4ea4e494894b7b84` |
| `What-i-want.txt` | `2be43babcad82690096365c58a806dad0978921ef0f441bc38e0c06153de7b23` |

## Read-only source verification

| Family | Recorded source path / recovery repository | Branch | Declared base | Tip / recovery tag | Receipt evidence | State at accepted base |
| --- | --- | --- | --- | --- | --- | --- |
| Audited Main | `/Users/cosmosgeek/Desktop/Main` | `current-main` | audited product `b272049b1e482ff75de27fbdaece7be5a7bbcc5d` | integrated audited tip `87af78285a4b11bc8ca98c4cc9b3bb4a551d2537` | `PRODUCTION_AUDIT.md` | accepted integration base; audited files preserved |
| Market Intelligence | `/Users/cosmosgeek/Desktop/Main` | `market-intelligence-main-20260711` | `b272049b1e482ff75de27fbdaece7be5a7bbcc5d` | `3340f75270049de96846d153672b91f065844eef` / `sprint-intelligence-final` | `MARKET_INTELLIGENCE_COMPONENTS.md`, `MARKET_INTELLIGENCE_RECEIPT.md` | ancestor and byte-identical receipt pair |
| Backend Foundation donor | receipt-recorded `/Users/cosmosgeek/Desktop/Main-backend-foundation-20260711-070056`; recovery ref verified from `/Users/cosmosgeek/Desktop/Main` | `backend-foundation-parallel-20260711-070056` | `75c55ec2f9bb8f8a96fe6d788e877dd6fe4a8240` | `db30569b116f5d9282b186da2ab4727e04a7f244` / `sprint-foundation-final` | `BACKEND_COMPONENTS.md`, `PARALLEL_BACKEND_RECEIPT.md` | donor branch preserved; adapted content is byte-identical at `c4ae7a9` |
| Adapted Backend Foundation | `/Users/cosmosgeek/Desktop/Main` | audited Main ancestry | `3340f75270049de96846d153672b91f065844eef` | `c4ae7a9aee51050da2076bf4a454988b1d372bc4` | same manifest/receipt | exact adapted commits `20eba6e`, `ad3327d`, `c7a851b`, `bb6f804`, `c4ae7a9`; no clone import or wholesale merge |
| Live Intelligence Runtime | `/Users/cosmosgeek/Desktop/Main` | `live-intelligence-runtime-main-20260711` | `c4ae7a9aee51050da2076bf4a454988b1d372bc4` | `e28b4c13c2f57f181cc6ea61508089719c7ff59c` / `sprint-runtime-final` | `LIVE_INTELLIGENCE_RUNTIME_COMPONENTS.md`, `LIVE_INTELLIGENCE_RUNTIME_RECEIPT.md` | merged ancestor and byte-identical receipt pair |
| Capital Supervision | receipt-recorded `/Users/cosmosgeek/Desktop/Main-capital-supervision-20260711`; recovery ref verified from `/Users/cosmosgeek/Desktop/Main` | `capital-supervision-main-20260711` | `c4ae7a9aee51050da2076bf4a454988b1d372bc4` | `963538d3cc9da74b51b70347a70a017b6eab2910` / `sprint-capital-final` | `CAPITAL_SUPERVISION_COMPONENTS.md`, `CAPITAL_SUPERVISION_RECEIPT.md` | merged ancestor and byte-identical receipt pair |

The two receipt-recorded isolated clone paths above are historical identity
only. Neither defunct folder was accessed during this sprint; branch, tag,
ancestry, and byte identity were verified from the active repository.

| Source ref compared with `87af782` | Merge base | Source-only commits |
| --- | --- | ---: |
| Market Intelligence | `3340f75270049de96846d153672b91f065844eef` | 0 |
| Live Intelligence Runtime | `e28b4c13c2f57f181cc6ea61508089719c7ff59c` | 0 |
| Capital Supervision | `963538d3cc9da74b51b70347a70a017b6eab2910` | 0 |
| Foundation donor | `75c55ec2f9bb8f8a96fe6d788e877dd6fe4a8240` | 6 donor-only commits; the adapted audited equivalents are already ancestors through `c4ae7a9` |

The exact declared-base deltas, in ancestry order, are:

- Market Intelligence (`b272049..3340f75`, 8):
  `3d23dbdd78d765fe48546a5caa61b7fe1cddeba6`,
  `aad08343ece3fe3ec7de964f2158c9fd9fa1986b`,
  `ae93f89d8668db872aa562d0823b6b4a006286b9`,
  `ba6f65ff69556a757109508937ed35a893a35716`,
  `1e23d4fa7b55563c3a07a47b9246c97b5ba43ea4`,
  `00db1dac5011f373046faf8a6db94c9ee206c624`,
  `45e4bbdc6d7c3cd8b36560d53e0a8f078f52eae4`,
  `3340f75270049de96846d153672b91f065844eef`.
- Live Intelligence Runtime (`c4ae7a9..e28b4c1`, 12):
  `bcd4373d4e998e2b511eb433e8a170dd2adebe8f`,
  `c40c7b986129fcceb4e1e88c177b0d7a248b51d4`,
  `223f9c6a11fa4265b6ccde9f42ae35e0997093fc`,
  `ecfd06b390e39bee9d831d8f418af2150855f4db`,
  `b5088e98c3562e2b673bbbe324b461f89cf0a21d`,
  `772b6629a240ab74db6b337663087fec1c7ac09d`,
  `f4ba5f9ce9ae591dfc719de30522f10bb8f31962`,
  `5c6259de5f86d210f2f5366e97976abbf75dcf6c`,
  `b5f45947f097a06c79581c55f68a77fef897a8cd`,
  `4cd6e9575e54c804095fe74c760e5d131f613261`,
  `6233aece19aaf342c83caa9519e4f2ee0b5e05d5`,
  `e28b4c13c2f57f181cc6ea61508089719c7ff59c`.
- Capital Supervision (`c4ae7a9..963538d`, 7):
  `3fd4b0c13f8441b801170a19160edd9586c9d5dd`,
  `823b28ae2406e2fcd5a749be9dd8db4c3ba063c9`,
  `a837f9db04ed2bca9cce5d26a735a85040c31e5a`,
  `e2eeea05ee3e27b2f9f97cd4cb748f2ec2411b69`,
  `c16e961b74e8176f692012bf149267004b531763`,
  `debbb68145f414597f3d3d0328d95982bd65b512`,
  `963538d3cc9da74b51b70347a70a017b6eab2910`.
- Backend Foundation donor (`75c55ec..db30569`, 6):
  `99fb3e90f31e066b2eb766d80a7ccf55fe86b6cd`,
  `503b96a6984c16a6014c1077219967de356a5c14`,
  `4d874bd3326df190efd84f837ad278fce32ed9b6`,
  `87543518103c8e2f82855254e8a3aa254f77891a`,
  `ece1478a1066aaaab175b08d5f93376d0fe984b4`,
  `db30569b116f5d9282b186da2ab4727e04a7f244`.

The source graph measured at the start is:

```text
75c55ec -> db30569 (separate Foundation donor recovery line)

b272049 (audited product)
  -> 3340f75 (Market Intelligence)
    -> 20eba6e/ad3327d/c7a851b/bb6f804/c4ae7a9 (adapted Foundation)
      |-> e28b4c1 (Live Runtime) --\
      |-> 963538d (Capital) -----+-> 87af782 (accepted integrated Main)
```

All source branches match their origin refs and recovery tags. The original
Foundation donor commit is intentionally not an ancestor; its component paths,
tests, manifest, and receipt are byte-identical to the adapted audited line.

## Pre-edit baseline

This section was the first authored repository change. The commands ran before
any production or test source edit.

| Command / suite | Result |
| --- | --- |
| `npm test` | PASS, exit 0, 377/377 effective checks |
| `npm run test:app:built` | PASS, exit 0, 72/72 app/public-market gates |
| Intelligence Foundation corpus | PASS, 152/152 |
| Live Intelligence Runtime corpus | PASS, 394/394 |
| Capital Supervision corpus | PASS, 433/433 |
| Required Foundation subset | PASS, 871/871 |

The 871 Foundation lane is contracts 304, USD-M boundary 310,
reconciliation 98, and compatibility 159. The current full Foundation corpus
is larger: 2,860 checks across 24 modules. Final acceptance retained the
required subset evidence and ran the full corpus through `test:foundation`; no
suite disappeared.

## Current-source research recorded before implementation

The implementation is constrained by current primary references reviewed on
2026-07-12:

- Binance's current developer portal and product-specific public-stream docs:
  public sources require bounded connection/message handling, explicit
  freshness/reconnection truth, and current documented endpoints. Private and
  signed interfaces remain outside the convergence runtime.
  <https://developers.binance.com/en/docs/introduction>
- OWASP REST, CSRF, WebSocket, and business-logic guidance: authorization is
  enforced at every endpoint; unsafe browser mutations preserve same-origin
  checks, strict input bounds, workflow state validation, and transactional
  idempotency. <https://cheatsheetseries.owasp.org/cheatsheets/REST_Security_Cheat_Sheet.html>
  <https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html>
- SQLite transaction and WAL documentation: state plus its audit event must be
  committed together; restart truth must retain the WAL as part of durable
  database state and avoid a second store.
  <https://www.sqlite.org/lang_transaction.html> <https://sqlite.org/wal.html>
- Node's current process, timer, global, and test-runner contracts informed the
  injected scheduler/clock and deterministic zero-egress harness.
  <https://nodejs.org/api/process.html> <https://nodejs.org/api/timers.html>
  <https://nodejs.org/api/test.html>

## Shared-file change ledger

Only the lead edited these shared or lead-owned files. Every entry records the
minimal reason and accepted behavior.

| Shared or lead-owned file | Reason | Expected behavior |
| --- | --- | --- |
| `server/src/index.ts` | Register the single managed composition root and authenticated integration router; replace only the existing direct public/Basis/Volume startup and shutdown seam | Dependency-ordered managed startup/reverse shutdown, read routes with no refresh side effect, no signed/private integration dependency |
| `server/src/engine/marketData.ts` | Make the existing public-universe initialization atomically generation-owned after adversarial review proved a timed-out fetch could otherwise commit after managed stop/restart | A stopped or superseded init may settle but cannot mutate universe/filter state or race the admitted generation; no transport or strategy behavior changes |
| `server/src/services/basisRuntime.ts` | Add one bounded defensive read-only integration capture because the cockpit snapshot omits proposal correlation/timestamps/evidence | Existing Basis engine remains sole owner; adapter receives full current decisions/open proposals/config without a second cache or mutation |
| `server/src/services/volumeRuntime.ts` | Add the matching bounded defensive integration capture | Existing Volume engine remains sole owner; adapter receives current decisions/proposals/config without fabricating proposal identity from row state |
| `package.json` | Add explicit organ, full-Foundation, integration, scenario, and unified scripts while preserving all existing script names | Existing 377 and 72 lanes remain; `test:all` runs every organ plus convergence once per build |
| `web/src/lib/systemIntegration.ts` | Add one typed polling/mutation client for canonical supervisor truth | UI consumes server projection and sends bounded revisioned controls only |
| `web/src/components/SystemIntegrationSurface.tsx` and `.css` | Add the one unavoidable shared Group/GRow-based convergence renderer | Five pages reuse one canonical read surface; no client-side strategy/risk recomputation |
| `web/src/pages/Dashboard.tsx` | Replace integration posture inference with supervisor facts | Dashboard shows posture, chain, ages, attention, and first blocker truthfully |
| `web/src/pages/SystemHealth.tsx` | Add canonical dependency/readiness section | Health shows desired/observed, freshness, completeness, generation, dependencies, and root cause |
| `web/src/pages/Opportunities.tsx` | Add canonical proposal/capital/trace facts and disambiguate the pre-existing Scanner queue | No strategy recomputation; canonical owner truth is separate from the explicitly labeled Legacy Scanner queue |
| `web/src/pages/Risk.tsx` | Expose convergence safe mode, revision, dry-run plan/reconciliation, and barrier | No convergence LIVE option; controls call the revisioned integration mutation API |
| `web/src/pages/LedgerPage.tsx` | Add canonical integration event metadata and correlation | Existing tape remains unchanged; recent integration traces render without client-invented severity |
| `web/src/components/Header.tsx` | Rebind the rendered Execution Control sheet to canonical mode/intake/kill posture | Existing 398x486 family remains; no decorative or live-enabling convergence control |
| `ENGINE.md` | Concise accepted current-truth header after all gates | Documents composed validate-only authority without rewriting historical blueprint |
| `PROJECT_MEMORY.md` | Concise current-state/run-log update after all gates | Fresh agent can find the convergence state and exact remaining money gaps |

No listed entry was skipped, and no opportunistic cleanup or formatting was
performed.

## Checkpoint SHAs and acceptance evidence

Inherited organ commits are source evidence, not replayed/no-op integration
commits. Every authored checkpoint below was committed only by the lead.

| Checkpoint | SHA | Verification |
| --- | --- | --- |
| Verified sources and authority map | `fa820e5e168c24e9f6db0f9f5944eb54afc6183f` | Branch/tag/receipt graph verified; pre-edit baseline green |
| Canonical dialects and engine read seams | `f232ac02ab5a085849dcf41529552ac82790ae96` | Contract/adversarial tests green; generation-owned Market init and read-only Basis/Volume captures |
| Managed runtime and persistence | `dc998bfdf5b8c5460121772a43ec2951435dd1d5` | Dependency-order composition, reverse drain, SQLite checkpoint/replay, fail-closed restart tests green |
| Supervisor API and validate-only slice | `450f5b007c6867ef486726e558a3795b5abd0d40` | Server/web build; production/application/route/vertical focused suites; integration corpus green |
| Truthful cockpit wiring | `87b29bd3b63cfa31d2d2cd8bef8e2f8d95279cd2` | Web typecheck/build and 72/72 built app gates |
| Integration/restart/security proof | `6891c65ff8f11cc5efe2b90d19864e3f4edaaf3b` | Exact SC-01..SC-30, zero-egress fixtures, static security, unified scripts |
| Recovered-failure truth correction | `29d42216e3ceb40081dbb9d69677954be888d915` | Historical failure remains visible without becoming a current blocker; application 7/7, integration 180/180 |
| Legacy/canonical UI authority correction | `b62225254ef5f2087f4044183723a4918dfbbe08` | Existing scanner queue visibly labeled legacy; rendered Opportunities readback verified |
| Final components/receipt/current truth | `DOCS_CHECKPOINT_PENDING_COMMIT` | This row is sealed with the docs checkpoint SHA after the commit is created; the final self-referential handoff SHA is reported in the Section 22 response |

## Safety scope

`server/src/systemIntegration/**` contains no import of the signed Binance
client, Foundation USD-M signed/test-order boundary, OrderService, LoanService,
environment/configured network target, child process, or money-action method.
The new vertical slice uses public observations already owned by the audited
runtime and sealed dry-run venue ports only. Existing audited legacy manual
account/order/loan capabilities are outside this new slice and remain unchanged;
this receipt does not mislabel those pre-existing capabilities as absent.

## Authority conflicts discovered after the first checkpoint

- Capital allocation intentionally rejects a `VALIDATE_ONLY` consideration
  (`MODE_VALIDATE_ONLY_CANNOT_RESERVE`), while its approval lane does support a
  scoped `VALIDATE_ONLY` external-risk disposition with
  `executionReady=false`. Increasing stage transition separately requires a
  `MANUAL_ARMED` approval. Integration will not weaken or forge either owner
  guard. Production reports Capital reservation/staging unavailable unless the
  owner supplies a valid staged mandate. The deterministic full-chain proof may
  construct a clearly `SYNTHETIC_ONLY` Capital-local reservation fixture, then
  uses an exact `VALIDATE_ONLY` approval and sealed dry-run execution. This
  dialect loss is recorded in `SYSTEM_AUTHORITY_MAP.md` and in every trace.
- Foundation retains the last structured runtime failure after recovery. The
  supervisor preserves it as `lastFailure` history but removes it from the
  current blocker set once the owner is RUNNING/READY; this was found in the
  real public smoke and locked by regression.
- Existing audited `AppConfig.killSwitch` and convergence control state are not
  bidirectionally rewritten. Effective convergence posture is the strict OR of
  those gates. An outer legacy kill blocks convergence release/intake; releasing
  convergence never releases the legacy guard. The UI names them separately.
- The pre-existing Scanner queue on Opportunities is outside the canonical
  Basis/Volume convergence proposal read. It remains available but is labeled
  **Legacy Scanner** everywhere it appears beside canonical proposal truth.

## Exact changed-file inventory

This is the path inventory from accepted base `87af782` through the final docs
checkpoint; the six protected sprint inputs are deliberately absent.

```text
ENGINE.md
PROJECT_MEMORY.md
SYSTEM_AUTHORITY_MAP.md
SYSTEM_CONVERGENCE_COMPONENTS.md
SYSTEM_CONVERGENCE_RECEIPT.md
package.json
server/src/engine/marketData.ts
server/src/index.ts
server/src/services/basisRuntime.ts
server/src/services/volumeRuntime.ts
server/src/systemIntegration/adapters/accountTruth.ts
server/src/systemIntegration/adapters/engineCapture.ts
server/src/systemIntegration/adapters/index.ts
server/src/systemIntegration/adapters/probes.ts
server/src/systemIntegration/adapters/sourceRegistry.ts
server/src/systemIntegration/application/facade.ts
server/src/systemIntegration/application/index.ts
server/src/systemIntegration/application/projection.ts
server/src/systemIntegration/application/types.ts
server/src/systemIntegration/composition/graph.ts
server/src/systemIntegration/composition/index.ts
server/src/systemIntegration/composition/managedComposition.ts
server/src/systemIntegration/composition/promisePollAdapter.ts
server/src/systemIntegration/composition/scheduler.ts
server/src/systemIntegration/composition/types.ts
server/src/systemIntegration/contracts/constants.ts
server/src/systemIntegration/contracts/dialects.ts
server/src/systemIntegration/contracts/index.ts
server/src/systemIntegration/contracts/types.ts
server/src/systemIntegration/contracts/validation.ts
server/src/systemIntegration/controls/index.ts
server/src/systemIntegration/controls/service.ts
server/src/systemIntegration/controls/types.ts
server/src/systemIntegration/controls/validation.ts
server/src/systemIntegration/index.ts
server/src/systemIntegration/persistence/codec.ts
server/src/systemIntegration/persistence/index.ts
server/src/systemIntegration/persistence/ledgerAdapter.ts
server/src/systemIntegration/persistence/restart.ts
server/src/systemIntegration/persistence/types.ts
server/src/systemIntegration/production/factory.ts
server/src/systemIntegration/production/index.ts
server/src/systemIntegration/production/temporal.ts
server/src/systemIntegration/production/types.ts
server/src/systemIntegration/routes/index.ts
server/src/systemIntegration/routes/router.ts
server/src/systemIntegration/routes/types.ts
server/src/systemIntegration/routes/validation.ts
server/src/systemIntegration/supervisor/index.ts
server/src/systemIntegration/supervisor/projection.ts
server/src/systemIntegration/supervisor/rootCause.ts
server/src/systemIntegration/supervisor/serialization.ts
server/src/systemIntegration/supervisor/topology.ts
server/src/systemIntegration/supervisor/traceIndex.ts
server/src/systemIntegration/supervisor/truth.ts
server/src/systemIntegration/supervisor/types.ts
server/src/systemIntegration/verticalSlice/dryRunVenue.ts
server/src/systemIntegration/verticalSlice/index.ts
server/src/systemIntegration/verticalSlice/orchestrator.ts
server/src/systemIntegration/verticalSlice/types.ts
server/test/systemIntegration/adapters/directional-adapters.test.mjs
server/test/systemIntegration/adapters/source-and-engine.scenarios.test.mjs
server/test/systemIntegration/application/production-facade.test.mjs
server/test/systemIntegration/composition/composition.test.mjs
server/test/systemIntegration/contracts/contracts.test.mjs
server/test/systemIntegration/contracts/import-purity.test.mjs
server/test/systemIntegration/controls/mutations.test.mjs
server/test/systemIntegration/fixtures/assertions.mjs
server/test/systemIntegration/fixtures/dry-run-venue.mjs
server/test/systemIntegration/fixtures/egress-tripwire.mjs
server/test/systemIntegration/fixtures/fixtures.test.mjs
server/test/systemIntegration/fixtures/index.mjs
server/test/systemIntegration/fixtures/manual-clock.mjs
server/test/systemIntegration/fixtures/memory-ledger.mjs
server/test/systemIntegration/fixtures/memory-persistence.mjs
server/test/systemIntegration/fixtures/values.mjs
server/test/systemIntegration/persistence/codec.test.mjs
server/test/systemIntegration/persistence/import-purity.test.mjs
server/test/systemIntegration/persistence/ledger-adapter.test.mjs
server/test/systemIntegration/persistence/restart-and-controls.test.mjs
server/test/systemIntegration/persistence/validate-only-adapter.test.mjs
server/test/systemIntegration/production/production-ports.test.mjs
server/test/systemIntegration/routes/control-routes.test.mjs
server/test/systemIntegration/scenarios/acceptance.scenarios.test.mjs
server/test/systemIntegration/scenarios/world.mjs
server/test/systemIntegration/security/security-regressions.test.mjs
server/test/systemIntegration/supervisor/fixtures.mjs
server/test/systemIntegration/supervisor/projection.test.mjs
server/test/systemIntegration/supervisor/truth.scenarios.test.mjs
server/test/systemIntegration/verticalSlice/authority.scenarios.test.mjs
server/test/systemIntegration/verticalSlice/fixtures.mjs
web/src/components/Header.tsx
web/src/components/SystemIntegrationSurface.css
web/src/components/SystemIntegrationSurface.tsx
web/src/lib/systemIntegration.ts
web/src/pages/Dashboard.tsx
web/src/pages/LedgerPage.tsx
web/src/pages/Opportunities.tsx
web/src/pages/Risk.tsx
web/src/pages/SystemHealth.tsx
```

## Final build and test evidence

Final acceptance ran from code/UI tip `b622252` after both browser-discovered
truth corrections. Documentation-only edits followed the green gate.

| Command / suite | Accepted result |
| --- | --- |
| `npm run build` | PASS; server TypeScript build and 1,848-module Vite production build completed; Vite emitted its non-failing large-chunk advisory |
| `npm test` | PASS, 377/377 existing deterministic checks |
| `npm run test:app:built` | PASS, 72/72 built keyless/public-market gates, 447 rows |
| `npm run test:engine:basis:built` | PASS, 107/107 |
| `npm run test:engine:volume:built` | PASS, 124/124 |
| `npm run test:intelligence:built` | PASS, 152/152 |
| `npm run test:intelligence:runtime:built` | PASS, 394/394 |
| `npm run test:capital:built` | PASS, 433/433 |
| `npm run test:foundation:built` | PASS, 2,860/2,860 across 24 modules |
| `npm run test:integration:scenarios:built` | PASS, exact SC-01..SC-30, 30/30 |
| `npm run test:integration:built` | PASS, 180/180 |
| Integration security tripwire | PASS, 5/5; zero fetch/WebSocket/EventSource/http/https/net/tls and zero venue-action attempts |
| Existing focused security/perimeter lane | PASS, 146/146 within `npm test` |
| First final-tree `npm run test:all` | PASS, all 4,468 effective checks/gates |
| Second final-tree `npm run test:all` | PASS, identical 4,468 effective checks/gates |
| `npm audit --omit=dev` | PASS, 0 vulnerabilities |
| `git diff --check` | PASS |
| SQLite `PRAGMA quick_check; PRAGMA foreign_key_check;` | PASS, `ok`, no foreign-key rows |

The two final unified logs were captured outside the repository at
`/tmp/system-convergence-test-all-final-{1,2}.log`. They are runtime evidence,
not tracked artifacts.

## Runtime, API, restart, and persistence evidence

- Built server started on loopback in a fresh isolated data directory with
  `SKIP_DOTENV=1`; keys were absent and no `.env` value was read.
- Public smoke observed a 447-symbol universe. Spot/USD-M public sources,
  Market, Basis, and Volume reached `LIVE_PUBLIC`/READY. The whole graph stayed
  truthfully DEGRADED at 6/13 READY because Intelligence Runtime, continuous MI,
  Capital/account truth, risk invocation, execution, and reconciliation were
  absent/not configured.
- Read routes returned the supervisor, 22-edge graph, bounded event page,
  controls, and exact correlation trace. `?refresh=1` returned
  `REFRESH_REQUIRES_POST`; `limit=201` returned `INVALID_SYSTEM_QUERY`.
- A safe-mode mutation committed once and replayed the same receipt/event ID for
  the same idempotency key. A LIVE mode request returned HTTP 409 with exact
  `LIVE_EXECUTION_NOT_IMPLEMENTED` and did not change revision.
- After the independent isolated legacy kill was cleared, convergence kill
  release committed; intake resume remained rejected with
  `RESTART_BARRIER_BLOCKED`. READ_ONLY -> ADVISORY -> VALIDATE_ONLY was tested,
  and the browser repeated ADVISORY -> VALIDATE_ONLY through the rendered radio
  controls.
- Compatibility refresh restarted the whole managed dependency root. Runtime
  generation advanced 1 -> 2; Market/Basis/Volume returned to RUNNING, READY,
  LIVE_PUBLIC with restart count 1. Historical startup freshness failures
  remained in `lastFailure` but the recovered current blocker arrays were empty.
- SIGINT produced `received SIGINT; draining control-room services` followed by
  `control-room shutdown complete`. The final isolated SQLite checkpoint was
  schema v1, checksum-protected, revision 9, control revision 5,
  `VALIDATE_ONLY`, intake paused, clean shutdown true, 9 trace entries, 5
  idempotency receipts, and 2 bounded control rejections. The checkpoint was
  written before Ledger close and `PRAGMA quick_check` returned `ok`.

## Browser evidence

- In-app browser viewport: 1280x720, current built bundle, no console warnings
  or errors.
- Bottom-up page audit passed with no crash boundary and no document/main
  horizontal overflow: Calendar -> News -> Health -> Logs -> Risk ->
  Opportunities -> Volume -> Basis -> Markets -> Token -> Borrow -> Account ->
  Dashboard.
- Canonical panels rendered on Dashboard, Health, Opportunities, Risk, and Logs.
  Risk visibly separated `Legacy Live Off` from convergence control. The
  Opportunities legacy Scanner queue was explicitly labeled outside convergence
  authority.
- All ten topbar sheets opened and closed left-to-right. Every shell measured
  400px outer / 398x486px content, including Execution Control. The new surface
  measured 54px rows, 20px horizontal padding, 11px labels, and hairline-family
  layout. Light and dark rendered correctly; the original light preference was
  restored.

## Dormant, blocked, and live capability matrix

| Capability | Accepted state |
| --- | --- |
| Public Spot/USD-M observation | `LIVE_PUBLIC` when connected and fresh; observed live in keyless smoke |
| Market universe, Basis, Volume | `WIRED`; observed `LIVE_PUBLIC`; strategy authority stays in each existing engine |
| Intelligence Runtime | `BUILT_AND_TESTED`, `IMPORTED`, `NOT_CONFIGURED`, runtime `UNAVAILABLE` |
| Market Intelligence | `BUILT_AND_TESTED`, `IMPORTED`, `NOT_CONFIGURED`, runtime `UNAVAILABLE` |
| Capital Supervision production input | `BUILT_AND_TESTED`, `IMPORTED`, `BLOCKED`; account/mandate truth unavailable |
| Foundation risk/execution/reconciliation | Deterministic `WIRED` + `SYNTHETIC_ONLY`; production snapshot `NOT_CONFIGURED` until exact internal input |
| Ledger/control/supervisor | `WIRED`, durable, authenticated, bounded, replay-safe |
| Signed validation / test order | `BLOCKED`, no adapter mounted |
| Live convergence execution | `BLOCKED`; exact barrier `LIVE_EXECUTION_NOT_IMPLEMENTED` |
| Existing manual account/order/loan services | Preserved outside convergence; not invoked in keyless acceptance |

## Exact remaining signed-validation and live-money path

1. Supply complete authenticated Spot, USD-M, Margin, permission, balance,
   liability, fee, funding, borrow-capacity/cost, freshness, and user-data
   reconciliation truth through read-only owner ports.
2. Mount the existing effectful Intelligence Runtime and continuous Market
   Intelligence owner ports without creating duplicate sockets/caches.
3. Supply a valid Capital-owned reservation/staged mandate under its real local
   authority; do not cast VALIDATE_ONLY into MANUAL_ARMED.
4. Build separately audited signed Spot/USD-M/Margin validation adapters with
   clock sync, exchange filters, idempotency, rate limits, and zero matching
   exposure. The current dormant test-order code is not mounted.
5. Prove two-leg partial/ambiguous/one-leg recovery against authoritative
   exchange truth, including hedge/reduce-only/unwind behavior and restart.
6. Collect and calibrate real outcomes without look-ahead, then pass explicit
   strategy promotion/retirement gates.
7. Complete deployment/watchdog/backups/retention/alerts/rollback verification.
8. Only after all prior gates, request separate owner approval for the smallest
   manually supervised capital trial.

## Final acceptance matrix

- All claimed source branches/receipts: **verified**.
- Integration base/current-main: **verified at `87af782`; unchanged**.
- Authority map/adapters/managed composition/persistence/restart: **accepted**.
- Deterministic public-to-dry-run slice: **30/30 accepted**.
- Real public prefix: **accepted; no fabricated downstream proposal**.
- Safe authenticated APIs and cockpit: **accepted**.
- LIVE/signed/private convergence authority: **mechanically absent/blocked**.
- Build, focused suites, `test:all` twice, security, runtime, browser, restart,
  checkpoint, dependency audit, and SQLite integrity: **accepted**.
- Secrets touched: **none**.
- Private/signed calls made by convergence: **zero**.
- Push/merge/deployment: **none**.
- Final tree condition after docs commit: **exactly the six protected untracked
  sprint inputs; no tracked or staged change**.
