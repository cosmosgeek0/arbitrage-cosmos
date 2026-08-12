# CODEX BLOCK AUDIT REPORT

Issued: 2026-08-10
Target: /Users/cosmosgeek/Desktop/cosmos-live-20260809
Branch / inspected HEAD: deploy/live-20260809 / …5e83
Governing order: /Users/cosmosgeek/Desktop/CODEX_BLOCK_AUDIT_ORDER.md

> **Owner verdict:** the code audit reconciles exactly and is valid. The deployed server contains two running public-market scanners, but it is **not currently a money-executing Basis/Volume system**: both live paths stop at decisions/proposals, their position lifecycles are unmounted, and the small Spot canary has no executor.

## Evidence boundary

- **PRODUCT SOURCE:** fully inventoried under the order's six code extensions; 157 visible Codex audit tasks were dispatched and the authoritative split reports are merged below.
- **RUNNING PROCESS:** Node process ending 0941 runs server/dist/index.js from the target and listens on 127.0.0.1:8080. Vite process ending 6083 runs from target/web and listens on port 5173.
- **CURRENT APPLICATION STATE:** UNKNOWN. The audit made no API call and no database read, so current feeds, persisted controls, balances, proposals, private truth, and component health were not sampled.
- **VISIBLE BROWSER RESULT:** UNKNOWN. No page was opened. The Watchdog page was not opened, clicked, screenshotted, or otherwise touched.
- **TEST RESULT:** UNKNOWN. The order prohibited running tests; runner reachability was inspected statically.
- **DEPLOYMENT:** no deployment, build, restart, order, exchange call, database mutation, or target-tree write occurred.

# 0. Reconciliation gate

**VALID — exact match, zero gap.**

| Measure | Lines |
|---|---:|
| Phase-0 measured code total | 1,041,817 |
| Authoritative exclusive block rows | 1,041,817 |
| Difference | 0 |
| Difference percentage | 0.000% |

Code path count: 2,211 files. Code-path manifest SHA-256 ends …7a74.

| Exclusive code zone | Lines |
|---|---:|
| server/src | 308,007 |
| server/test | 203,249 |
| quant source/research/scripts | 117,946 |
| quant/tests | 77,775 |
| web/src | 139,840 |
| web/test | 16,319 |
| web root config | 59 |
| ops | 79,455 |
| test | 48,584 |
| fixtures | 44,792 |
| verification | 5,651 |
| packages | 140 |
| **TOTAL** | **1,041,817** |

Two shard corrections close the ledger: the operational-web shard's 9,103 physical lines contain a 43-line Markdown note, so its code row is 9,060; web/vite.config.ts supplies the separately routed 59 code lines. Web AI Ops is 5,584 code/style lines plus 12 preview HTML lines. Quant q08/q09 is 10,004 lines, not the shard's off-by-one 10,005 claim. The Capital-B test row is the 5,598-line remainder, not the overlapping 12,269-line whole directory.

## Non-code ledger — kept outside the code denominator

| Exclusive zone | Files | Text lines | Binary files | Bytes |
|---|---:|---:|---:|---:|
| test evidence/assets | 205 | 37,631 | 146 | 25,464,906 |
| web assets/data/docs | 370 | 49,888 | 24 | 5,279,429 |
| root/docs/receipts/logs/server metadata | 264 | 67,335 | 0 | 4,249,084 |
| quant + verification non-code | 342 | 58,374 | 0 | 5,143,950 |
| fixtures + ops + integration + packages non-code | 246 | 113,036 | 0 | 4,485,385 |
| **TOTAL** | **1,427** | **326,264** | **170** | **44,622,754** |

The 146 PNG files in the I00 acceptance packet contain 82,649 newline-like bytes; those bytes are not source lines and are not counted as text or code.

# 1. Front-page strike sheet

RUNNING means mounted or loaded, not proven healthy. MIXED means a row contains both mounted and dormant pieces. DEAD means not mounted, switched off, or test-only. Tests can be selected while still DEAD in the deployed application.

| Path | Lines | Runs now | Money | Removable |
|---|---:|---|---|---|
| web/src/styles.css | 49,809 | RUNNING | NO | YES-BUT |
| server/src/engine/basis/** + v0/** + decay/** + engine root files | 12,000 | RUNNING | DIRECT | NO |
| fixtures/productAssurance/systemic/formal/** + fixtures/productAssurance/systemic/agentBoundary/** | 11,977 | DEAD | NO | YES-BUT |
| server/src/liveEdge/ | 11,933 | RUNNING | NO | YES-BUT |
| fixtures/productAssurance/systemic/stability/** + fixtures/productAssurance/systemic/assuranceCase/** | 11,878 | DEAD | NO | YES-BUT |
| test/i00/performance/** | 11,622 | DEAD | NO | YES-BUT |
| web/src/lib/** | 11,392 | RUNNING | NO | NO |
| fixtures/productAssurance/systemic/actionEvidence/** + observability/** + cockpit/** | 11,382 | DEAD | NO | YES-BUT |
| server/test/foundation/execution/** | 11,375 | DEAD | NO | YES-BUT |
| quant/src/quant_edge/labels/** + quant/src/quant_edge/micro/** + quant/scripts/** + quant/generated/** | 11,328 | DEAD | DIRECT | YES-BUT |
| server/test/liveEdge/{signedKernel,instrumentSpecs,mutationJournal}/** | 11,250 | DEAD | NO | YES-BUT |
| server/test/systemIntegration/persistence/** | 11,212 | DEAD | NO | YES-BUT |
| server/src/liveEdge/adapters/binancePrivateTruth/** | 11,168 | DEAD | NO | YES-BUT |
| quant/research/dq12/** + quant/research/dq13/** + quant/research/dq14/** + quant/research/vg4/** | 11,125 | DEAD | NO | YES-BUT |
| server/src/intelligenceRuntime/{baseline,books,bridge,capacity,capture,contracts} | 11,083 | RUNNING | NEEDED-BY-MONEY | NO |
| ops/i00 root code + ops/i00/bin remainder | 11,068 | DEAD | NO | YES-BUT |
| server/src/aiOps/{adapters,contracts,identity,manifests,policy,reliability}/** | 11,045 | DEAD | NO | YES-BUT |
| server/src/systemIntegration/production/** + server/src/systemIntegration/evidence/** | 11,024 | RUNNING | NEEDED-BY-MONEY | NO |
| ops/i00/bin (four approval-and-action files) | 10,783 | DEAD | NO | YES-BUT |
| test/productAssurance/systemic/{stability,assuranceCase,agentBoundary}/** | 10,674 | DEAD | NO | YES-BUT |
| quant/tests/contract/** + quant/tests/property/** | 10,581 | DEAD | NO | YES-BUT |
| ops/live/** + ops/release-package/** | 10,407 | DEAD | NO | YES-BUT |
| server/test/systemIntegration/{adapters, application, composition, contracts, controls} | 10,276 | DEAD | NO | YES-BUT |
| web/test/productControlRoom positions 32–61 + web/test/aiOps | 10,191 | DEAD | NO | YES-BUT |
| test/productAssurance/** remainder | 10,138 | DEAD | NO | YES-BUT |
| server/src/intelligenceRuntime/{routing,smoke,snapshot,spot,universe}/** | 10,040 | RUNNING | NEEDED-BY-MONEY | NO |
| quant/tests/{q08,q09}/** | 10,004 | DEAD | NO | YES-BUT |
| web/src/pages/research-lab/** | 9,999 | RUNNING | NO | YES-BUT |
| server/test/liveEdge/volumeLifecycle/** + reverseBasisLifecycle/** + executionPolicy/** + exposureRecoveryProjection/** | 9,874 | DEAD | NO | YES-BUT |
| quant/research/dq7/**, quant/research/dq8/**, quant/research/dq10/**, quant/research/dq11/** | 9,809 | DEAD | NO | YES-BUT |
| quant/tests/q11/** + quant/tests/q13/** + quant/tests/q14/** | 9,594 | DEAD | NO | YES-BUT |
| server/src/productIntegration/runtime/** + server/src/productIntegration/incidents/** | 9,594 | RUNNING | NO | NO |
| fixtures/productAssurance/systemic/hazard/** + fixtures/aiOps/** + fixtures/replayShadow/** + fixtures/obsShadow/** | 9,555 | DEAD | NO | YES-BUT |
| quant/src/quant_edge/ensemble/** + quant/src/quant_edge/models/** | 9,503 | DEAD | NO | YES-BUT |
| quant/src/quant_edge/final_proof/** + direct root files | 9,477 | DEAD | NO | YES-BUT |
| web/src/pages/{Strategies*,VolumeScanner*,Opportunities*,opportunities/**,TokenDetail*,BasisScanner.css} | 9,407 | RUNNING | NO | YES-BUT |
| quant/src/quant_edge/bootstrap/** + quant/src/quant_edge/lake/** | 9,395 | DEAD | NO | YES-BUT |
| ops/i00/bin/{inspect-app-unit.mjs,install-ops-bundle.sh,assemble-release.mjs,preflight.mjs,publish-install-tree.mjs,publish-install-receipt.mjs,validate-release.mjs,app-entrypoint.mjs,assembly-output-policy.mjs,inspect-executable.mjs,verify-donor-root.mjs,verify-donor.mjs,sanitize-donor-env.mjs} | 9,382 | DEAD | NO | YES-BUT |
| quant/src/quant_edge/derivatives/** + quant/src/quant_edge/survival/** | 9,382 | DEAD | DIRECT | YES-BUT |
| server/test/liveEdge/exchangeTwin/** + server/test/liveEdge/normalBasis/** | 9,294 | DEAD | NO | YES-BUT |
| server/src/foundation/execution/{spot*,m0Spot*}.ts (11 files) | 9,200 | DEAD | NO | YES-BUT |
| server/src/foundation/{observability,readModel,reconciliation,replay,scenarios}/** and Foundation root files | 9,193 | RUNNING | NEEDED-BY-MONEY | NO |
| server/test/{stream-lifecycle.mjs, financial-safety.mjs, gates.mjs} | 9,191 | DEAD | NO | YES-BUT |
| quant/research/dq1/** + dq3/** + dq4/** + dq5/** + dq6/** | 9,109 | DEAD | NO | YES-BUT |
| web/src/pages operational group (code only) | 9,060 | RUNNING | NO | YES-BUT |
| server/test/systemIntegration/{production,evidence,ops,routes} | 9,002 | DEAD | NO | YES-BUT |
| quant/tests/{fee_truth,n3_intake,maker_fee_grid,smeta1,q00} | 8,998 | DEAD | NO | YES-BUT |
| server/src/aiOps/runtime/** | 8,970 | DEAD | NO | YES-BUT |
| server/src/systemIntegration/persistence/* except m0SpotLifecyclePersistenceAdapter.ts | 8,932 | RUNNING | NEEDED-BY-MONEY | NO |
| server/src/systemIntegration/{adapters/**,contracts/**,controls/**} | 8,905 | RUNNING | NEEDED-BY-MONEY | NO |
| server/src/capitalFoundation/{checkpoint,economics,opportunities,positions,scenarios,stages,supervision,topology}/** | 8,858 | DEAD | DIRECT | YES-BUT |
| ops/i00/bin/{produce-deployment-risk-version.mjs,record-release-switch-receipt.mjs,release-switch.sh,rollback-switch.sh,produce-deployment-action-preview.mjs,verify-readback.mjs,verify-cloudflare-readback.mjs,inspect-effect-identity.mjs,verify-app-unit-action-binding.mjs,first-host-readback.mjs} | 8,604 | DEAD | NO | YES-BUT |
| server/src/foundation/execution/** excluding spot* and m0* | 8,549 | RUNNING | NEEDED-BY-MONEY | YES-BUT |
| server/test/intelligenceRuntime/{focus,futures,integration,lifecycle,routing,smoke,snapshot,spot,universe}/** | 8,501 | DEAD | NO | YES-BUT |
| quant/src/quant_edge/registry_ops/** | 8,401 | DEAD | NO | YES-BUT |
| quant/src/quant_edge/regime/** + quant/src/quant_edge/smeta1/** | 8,379 | DEAD | NO | YES-BUT |
| server/src/intelligenceFoundation/{attention,contracts,evidence,features,universe}/** | 8,338 | RUNNING | NEEDED-BY-MONEY | NO |
| ops/tests/i00 | 8,129 | DEAD | NO | YES-BUT |
| server/src/intelligenceRuntime/{derivatives,focus,futures,lifecycle}/** | 8,114 | RUNNING | NEEDED-BY-MONEY | YES-BUT |
| server/test/liveEdge/privateTruth/{projection-waiting,usdm-lifecycle,spot-lifecycle,margin-lifecycle,query-scope}.test.mjs | 8,013 | DEAD | NO | YES-BUT |
| server/test/productIntegration/** | 8,008 | DEAD | NO | YES-BUT |
| web/src/features/** | 8,008 | RUNNING | NO | NO |
| server/src/foundation/exchange/** | 7,928 | RUNNING | NEEDED-BY-MONEY | NO |
| web/src/pages/Watchdog.tsx + web/src/pages/watchdog/** (Block 27 remainder) | 7,920 | RUNNING | NO | NO |
| server/test/foundation/{exchange,risk,borrow,calibration}/** | 7,914 | DEAD | NO | YES-BUT |
| quant/tests/q15/** + quant/tests/q16/** | 7,852 | DEAD | NO | YES-BUT |
| server/test/ direct-root remainder | 7,817 | DEAD | NO | YES-BUT |
| web/src/pages/watchdog/{watchdogEvidence,RecoveryConsole,ObserverEvidence,OwnerLedger}* | 7,737 | RUNNING | NO | NO |
| server/src/services/{basisRuntime.ts,volumeRuntime.ts,orders.ts,risk.ts,account.ts,privateRead.ts,loans.ts} | 7,718 | RUNNING | DIRECT | NO |
| server/src/foundation/risk/** + server/src/foundation/borrow/** + server/src/foundation/calibration/** | 7,712 | RUNNING | NEEDED-BY-MONEY | NO |
| server/src/productAssurance/** | 7,611 | DEAD | NO | YES-BUT |
| server/test/liveEdge/{basisTicker,binanceSpotExecution,contract,controls,externalProofEvidence,finalLaneEvidence,fixtures}/ | 7,588 | DEAD | NO | YES-BUT |
| server/src entry shell (index.ts, bootstrap/**, ops/**, config.ts, security/**, types.ts) | 7,245 | RUNNING | NEEDED-BY-MONEY | NO |
| ops/tests/i00 files 33–47 | 7,214 | DEAD | NO | YES-BUT |
| server/test/foundation/** excluding execution, exchange, risk, borrow, calibration | 7,213 | DEAD | NO | YES-BUT |
| server/test/{binance,productAssurance,i00Acceptance,m1,ops,bootstrap} | 7,081 | DEAD | NO | YES-BUT |
| server/src/capitalFoundation/accountTruth/** + actions/** + allocation/** + approvals/** + budgets/** + contracts/** + root files | 7,053 | RUNNING | NEEDED-BY-MONEY | NO |
| ops/tests/** excluding ops/tests/i00/**, but including ops/tests/i00/fixtures/** | 7,009 | DEAD | NO | YES-BUT |
| quant/tests/unit/test_q12* | 7,001 | DEAD | NO | YES-BUT |
| server/src/binance/** | 6,920 | RUNNING | NEEDED-BY-MONEY | NO |
| server/src/systemIntegration/{routes,supervisor,ops,verticalSlice} + root index.ts | 6,872 | RUNNING | NEEDED-BY-MONEY | NO |
| ops/tests/i00 top-level test files 17–32 | 6,859 | DEAD | NO | YES-BUT |
| web/src/components/** | 6,836 | RUNNING | NO | NO |
| server/test/systemIntegration/{supervisor,verticalSlice,scenarios,security,fixtures} + root file | 6,826 | DEAD | NO | YES-BUT |
| server/test engine-volume*, engine-basis*, engine-decay*, volume-forward-measurement*, legacy-scanner.mjs | 6,821 | DEAD | NO | YES-BUT |
| server/src/ledger.ts | 6,748 | RUNNING | NEEDED-BY-MONEY | NO |
| server/test/capitalFoundation/{accountTruth,actions,allocation,approvals,budgets,checkpoint,compatibility,contracts,economics}/** | 6,671 | DEAD | NO | YES-BUT |
| quant/tests/unit/{test_q02*, test_q03*, non-qNN test_*} | 6,591 | DEAD | NO | YES-BUT |
| server/test/aiOps/{a1,a3,a5} | 6,383 | DEAD | NO | YES-BUT |
| test/i00 excluding performance/** | 6,359 | DEAD | NO | YES-BUT |
| server/src/liveEdge/adapters/normalBasis/** + server/src/liveEdge/adapters/reverseBasisLifecycle/** | 6,248 | DEAD | DIRECT | YES-BUT |
| quant/tests/q17/** | 6,240 | DEAD | NO | YES-BUT |
| server/src/systemIntegration/persistence/m0SpotLifecyclePersistenceAdapter.ts | 6,176 | DEAD | NO | YES-BUT |
| server/test/aiOps/a2/** | 6,155 | DEAD | NO | YES-BUT |
| server/src/intelligenceFoundation/{forensics,outcomes,thesis,topology}/** | 6,141 | RUNNING | DIRECT | YES-BUT |
| web/test/productControlRoom positions 1–31 | 6,128 | DEAD | NO | YES-BUT |
| quant/src/quant_edge/features/**, n3_intake/**, deep/** | 6,089 | DEAD | NO | YES-BUT |
| server/test/intelligenceRuntime/{baseline,books,bridge,capacity,capture,contracts,derivatives,fixtures}/** | 6,084 | DEAD | NO | YES-BUT |
| server/src/engine/volume/forwardMeasurement*.ts | 6,077 | DEAD | NEEDED-BY-MONEY | YES-BUT |
| server/test/intelligenceFoundation/** | 6,061 | DEAD | NO | YES-BUT |
| quant/src/quant_edge/validation/** | 5,940 | DEAD | NO | YES-BUT |
| quant/tests/unit/test_q04*.py + test_q05*.py | 5,869 | DEAD | NO | YES-BUT |
| verification/** + packages/** | 5,791 | DEAD | NO | YES-BUT |
| server/src/services/*.ts (excluding Split 23A) | 5,718 | RUNNING | NEEDED-BY-MONEY | NO |
| server/src/liveEdge/adapters/volumeLifecycle/** | 5,659 | DEAD | DIRECT | YES-BUT |
| server/test/capitalFoundation/{opportunities,positions,scenarios,stages,supervision,topology}/** | 5,598 | DEAD | NO | YES-BUT |
| web/src/aiOps/** (code/style only) | 5,584 | DEAD | NO | YES-BUT |
| quant/src/quant_edge/{fee_truth,maker_fee_grid,book}/ | 5,385 | DEAD | DIRECT | YES-BUT |
| server/src/systemIntegration/application/** + server/src/systemIntegration/composition/** | 5,129 | RUNNING | NEEDED-BY-MONEY | NO |
| server/src/engine/volume/** excluding forwardMeasurement* | 5,075 | RUNNING | DIRECT | NO |
| quant/tests/unit/test_q06*, test_q07*, test_q10* | 5,045 | DEAD | NO | YES-BUT |
| server/src/liveEdge/adapters/durableMutationJournal/** | 4,869 | RUNNING | NEEDED-BY-MONEY | NO |
| quant/src/quant_edge/inference/** | 4,624 | DEAD | NO | YES-BUT |
| server/test/liveEdge/integration/**, machineGraphEvidence/**, security/**, sourceContracts/** | 4,614 | DEAD | NO | YES-BUT |
| server/src/liveEdge/adapters/binanceSpotExecution/** + executionPolicy/** + exposureRecoveryProjection/** | 4,512 | DEAD | NO | YES-BUT |
| server/src/foundation/contracts/** + server/src/foundation/control/** | 4,497 | RUNNING | NEEDED-BY-MONEY | NO |
| web/src/pages | 4,443 | RUNNING | NO | YES-BUT |
| server/test/liveEdge/privateTruth/** remaining after Split 44A | 4,427 | DEAD | NO | YES-BUT |
| web/src/pages/watchdog/{OwnerEvidence,ControlLedger,WatchdogSurface}* | 4,391 | RUNNING | NO | NO |
| server/src/liveEdge/adapters/binanceContracts/** | 4,109 | RUNNING | NO | NO |
| server/src/liveEdge/adapters/binanceSignedKernel/** | 4,096 | RUNNING | NEEDED-BY-MONEY | NO |
| server/src/productIntegration/** excluding runtime/** and incidents/** | 3,706 | DEAD | NO | YES-BUT |
| server/src/liveEdge/adapters/binanceInstrumentSpecs/** | 3,242 | DEAD | NO | YES-BUT |
| web/src/store.tsx + web/src/App.tsx + web/src/types.ts + web/src/format.ts + web/src/main.tsx | 2,963 | RUNNING | NO | NO |
| web/src/pages/ResearchLab.tsx + web/src/pages/ResearchLab.css + web/src/data/researchLab* | 2,291 | RUNNING | NO | YES-BUT |
| test/opsShadow/** | 2,188 | DEAD | NO | YES-BUT |
| test/runbookShadow/** | 2,057 | DEAD | NO | YES-BUT |
| test/aiOps/a5/** | 1,380 | DEAD | NO | YES-BUT |
| test/replayShadow/** | 1,217 | DEAD | NO | YES-BUT |
| test/*.mjs root control files | 1,088 | DEAD | NO | YES-BUT |
| test/obsShadow/** | 1,041 | DEAD | NO | YES-BUT |
| test/realGaps/** | 820 | DEAD | NO | YES-BUT |
| web/vite.config.ts | 59 | RUNNING | NO | YES-BUT |
| **TOTAL CODE** | **1,041,817** |  |  |  |

# 2. Project-audit findings

## Critical

### C1 — The owner’s two money ideas do not currently execute money

- **Evidence:** BasisRuntime and VolumeRuntime are mounted from server/src/index.ts:271-275. Basis has a disabled handoff and no called order bridge; Volume proposals explicitly deny automatic buy/sell. Normal Basis, Reverse Basis, and Volume position-lifecycle packages are unmounted/test-only. The M0 boundary is constructed without an executor and returns M0_RUNTIME_NOT_CONFIGURED with zero effects.
- **Impact:** the process can measure and publish Basis/Volume proposals, but it cannot capture the spot-perpetual gap, scale a position while the gap widens, close it while it narrows, or buy a token before a pump.
- **Confidence:** high; source, built entry, import closure, and live process metadata agree.
- **Next:** the rebuild commanders should start from the 117-file extraction manifest, then explicitly design and separately authorize execution, private truth, risk, recovery, and flat/disarm proof. Do not treat the dormant lifecycle islands as already wired.

### C2 — Current verification cannot honestly be called clean

- **Evidence:** the server aggregate statically names an absent market-first-load-split.test.mjs; the Quant full gate pins 163 tracked Python tests while the tree contains 178; q-116 separately expects 3,063 where the current Quant runner declares 3,243. No suite was executed, so every current pass/fail is UNKNOWN.
- **Impact:** source coverage is extensive, but the current top-level gates contain known census/selector drift and cannot support a fresh release claim without repair and an authorized run.
- **Confidence:** high for the static discrepancies; UNKNOWN for runtime test outcomes.
- **Next:** reconcile the selectors and pinned censuses, then run the approved network-free/full matrices in a separately authorized validation task.

## Watch

### W1 — Mounted does not mean healthy

- **Evidence:** listener and import evidence proves both runtimes start, but the order forbade API/database reads.
- **Impact:** feed freshness, kill state, allowlist, proposals, private-account coverage, saved controls, and current recovery posture remain UNKNOWN.
- **Confidence:** high.
- **Next:** use an explicitly authorized read-only runtime acceptance pass; do not infer health from process presence.

### W2 — Owner page policy and live routing disagree

- **Evidence:** News and Calendar are owner-designated isolate/park, yet App.tsx still mounts them and Header.tsx still exposes them. Notifications also remains live. Rules.tsx is the genuinely unmounted contextual page.
- **Impact:** attention and maintenance remain spent on surfaces the owner does not value.
- **Confidence:** high from source routing; visible rendering is UNKNOWN.
- **Next:** a later owner-approved trim can remove routes/imports while retaining shared LiveIntelligence.css and MetricTiles.css consumers.

### W3 — Current dependency closure is much broader than the strategy cores

- **Evidence:** Basis live value closure is 46 files / 11,023 lines and full source/type closure is 97 files / 35,861 lines. Volume's evaluated closure is 54 local files / 19,082 lines. Shared export barrels pull in unrelated contracts.
- **Impact:** copying whole current blocks would carry machinery unrelated to the two bots and preserve avoidable coupling.
- **Confidence:** high.
- **Next:** use narrow local interfaces in the rebuild; the extraction manifest deliberately excludes the giant startup shell and asks commanders to write a narrow boot.

### W4 — Disabled and orphaned weight is material

- **Evidence:** Volume carries 6,077 disabled forward-measurement lines and 368 unreachable lines. styles.css is 49,809 lines with 148 orphan-only prefixes and many mixed historical families.
- **Impact:** the tree is harder to reason about and easier to misread as capability.
- **Confidence:** high from static ownership/import analysis; browser-visible effects are UNKNOWN.
- **Next:** trim only after replacing imports and retaining the live selector families identified in the style shard.

### W5 — AI Ops is an operations scaffold, not trading automation

- **Evidence:** Shadow A2 is an unmounted, test-only incident/evidence/case engine. The separate web preview identifies itself as A4, uses fixed synthetic data, and is not a product route. The non-runtime AI safety block is outside A2's import graph.
- **Impact:** it can later help diagnose service failures and prepare owner-reviewed work, but it cannot be connected to money as though it already understands strategy, capital, risk, or execution.
- **Confidence:** high.
- **Next:** keep it separate until real event feeds, durable audit, provider/tool owners, signatures, approvals, and independent state confirmation exist.

### W6 — Frozen evidence is large but behaviorally inert

- **Evidence:** the July 16 acceptance packet records candidate ending 98f3, a 60-second performance/restart campaign, six light/dark browser passes across 21 pages, and 146 screenshots. No live process reads it; explicit acceptance/release validators do.
- **Impact:** deletion does not change running bots, but breaks reproducible custody, named validation, and release assembly.
- **Confidence:** high.
- **Next:** archive or replace the validator contract before removal; do not count PNG newline bytes as code.

## Info

- Research Lab is a live read-only route over 84 frozen experiment families, 72 stories, and 330 preserved public files. It performs no experiment and reads no live trading state.
- Watchdog is source-mounted and owner-designated KEEP. It monitors verdicts, owners, dependency paths, controls, recovery, browser delivery, and evidence quality; visible behavior remains UNKNOWN because the page was untouched.
- Quant is 195,721 code lines including tests and is not mounted into the Node money path. Its H1/H2/H5 work is Volume-related, H3/H4/H7 is Basis-related, H6/H8 is dead, and large portions are generic research/proof custody.
- Product Assurance production source is unmounted; its very large test/fixture/evidence estate is offline verification, not live safety enforcement.

## Audit checklist

| Area | Result |
|---|---|
| Entrypoints and composition | Inspected source and built mount; live PIDs/CWD/listeners bound |
| Money closures | Basis and Volume transitive closures traced |
| Persistence and configuration | Source wiring inspected; DB contents deliberately unmeasured |
| Private/exchange boundaries | No calls made; send authority proven absent from ordinary boot |
| Web routes and controls | Static mount/command wiring inspected; no browser action |
| Tests | Runner selection and imports inspected; no tests executed |
| Build/deploy/ops | Source and commands inspected; no build, deploy, restart, or ops script run |
| Docs/assets/evidence | Exhaustively inventoried outside code denominator |
| Repository custody | Target untouched; pre-existing untracked ROLLBACK.md and logs/ preserved |

# 3. Owner-ordered deep questions

## AI Ops

Shadow A2 accepts externally supplied operational events, normalizes incidents, builds evidence and diagnoses, enforces budgets/retries, and prepares an owner handoff. It watches nothing by itself and can issue no live command. The safety/manifests/policy half is also unmounted and not imported by A2. The web AI screen is an A4 synthetic preview, not A2 and not a product route. Sober judgment: useful later for incident response around a working trading system; structurally not a Basis/Volume decision or execution layer.

## Research Lab

The live page displays a frozen, searchable evidence library: family index, recorded outcomes, stories, comparisons, failed rules, timestamp coverage, and exact artifact bytes after size/fingerprint checks. Its data is bundled JSON plus 330 files under web/public/research-lab. It is useful as human research memory and custody; it does not run research or update itself.

## Watchdog

The mounted source shows the server verdict, posture, owner census and details, browser-to-runner dependency chain, guarded controls, unresolved command locks, incidents, refresh receipts, process/build/delivery evidence, probes, and request history. The page itself was not touched; this is source and process evidence only.

## Control room

Genuinely wired non-money commands: Set Read Only; Engage Kill Switch; Pause Global Intake; Restart Managed Root; Isolate/Restart Spot public source; Isolate/Restart USD-M public source; Pause/Resume Basis intake; Pause/Resume Volume intake; Acknowledge Incident. They use preview, confirmation, state revision, result receipt, and readback. Current per-command enablement is UNKNOWN.

Display-only or unavailable: Focus pin/unpin is server-owned but rejected by the browser allowlist; the embedded System Dashboard safe modes, kill release, intake reopen, arbitrary/attention restarts use synthetic preview state; Watchman recovery actions are disabled; cloud-runner/execution rows are displays; optional-surface toggles are removed; strategy symbol/size/threshold controls are not routed through this Product screen.

## Frozen evidence

The one-off event was the July 16, 2026 local acceptance for candidate ending 98f3: performance/restart/recovery plus six browser runs. Explicit I00 validation and release assembly read its receipts and artifact manifest; the running product does not. Deleting only the evidence leaves live behavior unchanged but destroys the ability to revalidate that historical claim.

# 4. Dependency closures and rebuild handoff

The next three dossiers overlap the exclusive ledger and are therefore **not added again** to 1,041,817.

## Basis dependency closure

## server/src/engine/basis/** + server/src/services/basisRuntime.ts — 7,812 lines

WHAT IT IS: This is the running Basis strategy: it compares public spot and USD-margined perpetual bid/ask books, subtracts fees, funding, liquidity, and borrow costs, then publishes named decisions and proposals. `BasisRuntime` supplies public data, timers, configuration, audit events, and the browser snapshot; it does not place orders. “Transitive closure” means every repository file reached by following imports; LOAD-BEARING means removal breaks current behavior, while SEVERABLE means it can be removed outright or after replacing a broad import with a narrow interface.

SUB-PIECES:

- Recount and routing — `engine/basis/**` is 7,058 lines and `basisRuntime.ts` is 754, totaling 7,812 owned lines. The governing row estimates `engine/basis + engine/v0` at about 12,000; measured reality is 7,058 + 421 = 7,479, short by 4,521 lines or 37.7%. That exceeds the ordered 20% correction threshold. `basisRuntime.ts` belongs to Task 48 but was routed under the separate services row.

- `services/basisRuntime.ts — 754 — LOAD-BEARING` — owns the 1.5-second public-book cycle, 15-minute universe refresh, mark/funding ingestion, engine tick, audit writes, decay calls, controls, and published snapshot.

- `engine/basis/lifecycle.ts — 725 — LOAD-BEARING` — owns watching, focus, proposal, expiry, cooldown, acceptance, and the handoff record; the handoff portion is permanently constructed disabled today.

- `engine/basis/marketState.ts — 667 — LOAD-BEARING` — keeps bounded spot, perpetual, mark/funding, depth, borrow, freshness, and universe state.

- `engine/basis/engine.ts — 525 — LOAD-BEARING` — composes the feature builder, scanner, lifecycle, proposals, and event stream. Its only execution-shaped output is uncalled intent metadata; it never sends an order.

- `engine/basis/proposals.ts — 509 — LOAD-BEARING` — owns proposal identity, updates, acceptance, invalidation, and bounded history.

- `engine/basis/gapTracker.ts — 462 — LOAD-BEARING` — measures persistence, slope, stability, and causal movement of both executable gap directions.

- `engine/basis/types.ts — 362 — LOAD-BEARING FOR BUILD ONLY` — contains compile-time contracts erased before the server runs.

- `engine/basis/scanner.ts — 335 — LOAD-BEARING` — applies the ordered go/no-go guards for source quality, spread, depth, fees, funding, borrow, stability, net edge, persistence, allowlist, and kill switch.

- Smaller LOAD-BEARING files — `borrow.ts 113` borrow preflight; `config.ts 241` thresholds and validation; `edge.ts 38` edge delegation; `events.ts 58` event adapter; `features.ts 152` feature assembly; `funding.ts 125` carry and flip risk; `liquidity.ts 161` depth/slippage; `math.ts 256` gap and spread arithmetic; `priority.ts 73` ranking; `rejectVocabulary.ts 175` fixed rejection language.

- Dormant owned files — `publicOpportunityObservation.ts 941`, `publicOpportunityObservationStore.ts 248`, and `rolling24hEdgeStatistic.ts 668` form an unused public-observation/statistics branch; `replay.ts 86` and `snapshots.ts 99` are harness helpers; `index.ts 39` is a type-export file. All 2,081 lines are SEVERABLE from deployed BasisRuntime: no production caller outside their own dormant chain was found.

- Live value-import closure — 46 files / 11,023 lines. Besides the 16 live Basis files and `basisRuntime.ts`, it loads `binance/publicSourceMode.ts 37`, `binance/rest.ts 1,079`, `engine/v0/clock.ts 29`, and `engine/v0/config.ts 79`; these are LOAD-BEARING for public books, clock, and shared defaults. Basis only needs the all-book-ticker slice of `rest.ts`; its other exchange reads are SEVERABLE behind a narrow book-source interface.

- Foundation export barrel — `foundation/contracts/{authority 135, diagnostics 329, exchange 98, execution 212, failures 211, identity 298, index 36, opportunity 181, reconciliation 108, risk 263, runtime 269, time 216}` = 2,356 lines. Only `identity.ts` supplies the semantic dependency that derives the Basis configuration version. The rest are LOAD-BEARING in the current unbundled loader because `config.ts` imports one export file that re-exports every sibling, but SEVERABLE after changing that to a direct identity import.

- Capital export barrel — `capitalFoundation/contracts/{actions 143, approvals 73, capital 258, conservativeEconomics 384, decimal 188, economics 144, identity 134, index 25, lifecycle 235, opportunity 124, ports 160, positions 101, truth 105}` = 2,074 lines. Only `decimal.ts` supplies the exact threshold/size comparison used by BasisRuntime. The other 1,886 lines are likewise SEVERABLE after a direct decimal import.

- Full source/type closure — 97 files / 35,861 lines. “Type-only” means required for broad source checking but removed before execution. The additional 51 files / 24,838 lines are: the seven dormant/type Basis files already named, `engine/v0/types.ts 313`; `engine/decay/{coordinator 320, governance 1,033, index 5, ledger 422, measurement 892, types 203}` = 2,875; `capitalFoundation/economics/{compose 537, index 3, segmentation 714, types 140}` = 1,394; `foundation/borrow/{decimal 33, derive 782, index 41, types 197, validate 622}` = 1,675; `foundation/calibration/{aggregate 469, index 10, record 423, types 216}` = 1,118; `intelligenceFoundation/contracts/{constants 106, ids 84, index 4, types 486, validation 994}` = 1,674; `intelligenceRuntime/contracts/{boundedJson 150, index 4, sourceCatalog 154, sourceLifecycle 459, types 211}` = 978; `ledger.ts 6,748`; `liveEdge/adapters/durableMutationJournal/exact.ts 53` plus `liveEdge/controls/{adapter 831, index 4, integrity 180, types 613, validation 720}` = 2,401; `systemIntegration/contracts/{constants 187, types 414, validation 723}` = 1,324; `systemIntegration/persistence/{codec 666, liveEdgeControlCheckpoint 288, types 773}` = 1,727; and `server/src/types.ts 168`. Except for the separately mounted decay, configuration, and Ledger seams below, this fan-out is SEVERABLE from a clean Basis extraction by using narrow local interfaces instead of concrete shared-owner types.

- Runtime inputs — `engine/marketData.ts 1,223` and `binance/ws.ts 398` are LOAD-BEARING upstream owners for universe and mark/funding facts; Basis uses only `allRows()` and `markEventTimestamp()`. Spot and perpetual best bid/ask are fetched separately through `binance/rest.ts`. The rest of MarketEngine is SEVERABLE from Basis once those facts are exposed through a narrow public-market port.

- Configuration — `config.ts 245` and `types.ts 168` are LOAD-BEARING current owners. Defaults are kill switch on and allowlist empty; saved live values are UNKNOWN because database and application-interface reads were forbidden. Boot forcibly sets live trading off, funds locked, new borrowing paused, repay-only, and money controls blocked at `index.ts:227-243`.

- Database — `ledger.ts 6,748` is LOAD-BEARING through narrow methods only. BasisRuntime appends `basis.*` and error events; decay reads and atomically replaces values in `config` while appending decay events. The relevant tables are `events` and `config`; there is no Basis-specific table. The `signals` table at `ledger.ts:2509-2519` belongs to the retired legacy scanner and is not written by this runtime. Most of Ledger is SEVERABLE from a Basis extraction if `logEvent`, configuration read, and compare-and-replace are retained as a port.

- Decay governance — `engine/decay/** 2,875` is mounted through `StrategyDecayCoordinator` and its Ledger adapter. It is LOAD-BEARING for the current governed measurement/audit behavior, although the scanner supports a null decay port and can run without it if that behavior is intentionally dropped.

- Live mount — `index.ts 5,460` constructs BasisRuntime at `271-274`, passes it into production composition at `311-319`, and starts the application at `461-464`. The basis-specific slices of `systemIntegration/production/factory.ts 3,083`, `systemIntegration/application/facade.ts 2,286`, `systemIntegration/composition/{graph 102, promisePollAdapter 446, managedComposition 586, types 148, scheduler 33, runtimeEffectReadback 57, index 6}` = 1,378, and `systemIntegration/adapters/opportunityOwners.ts 112` launch, health-check, restore controls, and passively publish Basis decisions/proposals. These slices are LOAD-BEARING for the existing mount; their large shared files and unrelated components are SEVERABLE from a clean Basis rebuild. Following the shared application entry point as if it were owned by Basis would incorrectly absorb 234 files / 103,826 lines whose import direction is shell-to-Basis, not Basis-to-shell.

- Route and browser fetch — authenticated `GET /api/engine/basis` returns `basisRuntime.snapshot()` at `index.ts:3358-3360`. `Strategies.tsx 1,331` at `714-732`, `Opportunities.tsx 922` at `632-648`, `Loans.tsx 271` at `45-63`, and `TokenDetail.tsx 1,953` at `1596-1625` poll it every two seconds. `web/src/lib/basisRuntime.ts 419` validates the response and freshness; `http.ts 135` owns bounded reads; `polling.ts 129` prevents overlapping polls; `App.tsx 242` mounts the four pages. All browser files and the route are SEVERABLE from money computation, but removing them erases owner visibility.

- Large blocks not depended on by this Basis closure — `engine/volume/** 11,152`, `server/src/aiOps/** 20,015`, `server/src/productAssurance/** 7,611`, `quant/** 195,721`, `ops/** 79,455`, `server/test/** 203,249`, and `web/test/** 16,319`. The Watchdog page remained explicitly UNMEASURED and untouched as ordered.

RUNS NOW?: RUNNING — read-only process evidence shows process …0941 executing `node server/dist/index.js` from the exact target tree and listening on port 8080; the compiled artifact constructs BasisRuntime and mounts its route. System Integration calls `runtime.start()` at `production/factory.ts:2720-2731` and registers it at `2917-2921`. Current Basis freshness, kill state, allowlist, and persisted component desire remain UNKNOWN because no application-interface or database read was permitted. Vite process …6083 is listening on 5173, but the visible browser result is UNKNOWN because no page was opened. Final Git status is unchanged.

MONEY?: DIRECT — this is the Basis strategy’s edge and proposal logic, but it currently has no order authority: the only intent bridge has no production caller, the handoff is constructed disabled, and the legacy approve route is retired.

REMOVABLE?: NO — removing the capability deletes the running Basis strategy, its System Integration facts, route, and four browser consumers; the 2,081 dormant owned lines, broad export-barrel fan-out, and unrelated shared-owner remainders are separately removable.

EVIDENCE: [server/src/engine/basis/engine.ts:1](/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/engine/basis/engine.ts:1), [server/src/services/basisRuntime.ts:342](/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/services/basisRuntime.ts:342), [server/src/index.ts:271](/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/index.ts:271), [server/src/ledger.ts:579](/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/ledger.ts:579), [web/src/pages/Strategies.tsx:714](/Users/cosmosgeek/Desktop/cosmos-live-20260809/web/src/pages/Strategies.tsx:714)

## Volume dependency closure

## `server/src/engine/volume/**` + `server/src/engine/v0/**` + `server/src/services/volumeRuntime.ts` + mount — 13,173 owned lines

WHAT IT IS: This is the public-market Volume strategy: it watches quiet Spot symbols, detects sudden volume, depth, price, and taker-buy changes, then records an advisory proposal. Its current path does not place an order or call a private exchange. Here, LOAD-BEARING means removal breaks the current behavior; SEVERABLE means it can be removed with its import or caller without losing the core scanner. The scoped source is clean in Git; no files were changed or created during this audit.

SUB-PIECES:

- Recount and routing:

  - `server/src/engine/volume/**` — 11,152 lines. Routing estimate was about 11,200, a 0.4% difference.
  - `server/src/engine/v0/**` — 421 lines.
  - `server/src/services/volumeRuntime.ts` — 1,600 lines.
  - Exact Task 49 ownership — 13,173 lines. The 5,460-line `server/src/index.ts` mount is shared wiring and is not counted again.
  - Routing discrepancy: the governing row estimates `engine/basis + engine/v0` at about 12,000 lines; actual is 7,479, a 37.7% shortfall. That exceeds the required 20% flag. Task 49’s closure crosses rows 21, 22, 23, and 25; those cross-read lines must not be counted as new exclusive ownership.

- Active Volume scanner — 4,707 lines — LOAD-BEARING:

  - `adapters.ts` — 153 — converts Binance aggregate trades.
  - `baseline.ts` — 77 — maintains the quiet-volume baseline.
  - `config.ts` — 171 — scanner thresholds and derived configuration identity.
  - `depth.ts` — 68 — validates executable order-book depth.
  - `detector.ts` — 271 — fail-closed wakeup decision gate.
  - `engine.ts` — 665 — owns symbols, ticks, decisions, and proposals.
  - `events.ts` — 103 — bounded audit events.
  - `features.ts` — 226 — volume, price, and taker-side features.
  - `focus.ts` — 559 — symbol focus policy.
  - `observedOrderFocus.ts` — 249 — operator-observed symbol blocking.
  - `priority.ts` — 46 — candidate ordering.
  - `proposals.ts` — 1,159 — proposal, invalidation, and risk attachment lifecycle.
  - `rejectVocabulary.ts` — 152 — rejection reasons.
  - `rolling.ts` — 286 — bounded rolling windows.
  - `tape.ts` — 110 — recent trade tape.
  - `types.ts` — 271 — runtime data shapes.
  - `validation.ts` — 141 — numeric and symbol bounds.

- Shadow forward measurement — 6,077 lines — SEVERABLE:

  - `forwardMeasurementDetectorSource.ts` — 375.
  - `forwardMeasurementEvidence.ts` — 3,628.
  - `forwardMeasurementRunner.ts` — 1,123.
  - `forwardMeasurementScheduler.ts` — 951.
  - These files are currently loaded through `volumeRuntime.ts`, but activation defaults off and the mount supplies no enabling option. They measure detector performance; they do not create the live Volume decision. Removing them requires removing the scheduler imports, snapshot fields, and calls first.

- Owned but not reached by the deployed runtime — 368 lines — SEVERABLE:

  - `focusVocabulary.ts` — 28.
  - `index.ts` — 82.
  - `runner.ts` — 185.
  - `snapshots.ts` — 73.

- V0 chassis — 421 lines — LOAD-BEARING:

  - `clock.ts` — 29 — injected clock and correlation identifiers.
  - `config.ts` — 79 — frozen engine defaults.
  - `types.ts` — 313 — decisions, events, and intent-stub contracts.

- Runtime owner — `services/volumeRuntime.ts` — 1,600 lines — LOAD-BEARING. It refreshes the eligible Spot universe from `MarketEngine`, opens public `@aggTrade` streams, refreshes public book tickers, warms 1-minute candle baselines, applies operator configuration, logs events, and exposes the snapshot. It does not import an exchange client capable of signing an order.

- Exact evaluated import closure — 54 local files, 19,082 source lines:

  - Binance public data — LOAD-BEARING: `binance/publicSourceMode.ts` 37, `binance/rest.ts` 1,079, `binance/ws.ts` 398.
  - Durable observed focus — LOAD-BEARING for current operator behavior: `services/observedOrderFocus.ts` 333.
  - Capital contracts — 2,074 lines:
    - LOAD-BEARING: `contracts/index.ts` 25 and `decimal.ts` 188, used for exact size comparisons and normalization.
    - SEVERABLE barrel-only exports: `actions.ts` 143, `approvals.ts` 73, `capital.ts` 258, `conservativeEconomics.ts` 384, `economics.ts` 144, `identity.ts` 134, `lifecycle.ts` 235, `opportunity.ts` 124, `ports.ts` 160, `positions.ts` 101, `truth.ts` 105.
  - Foundation contracts — 2,356 lines:
    - LOAD-BEARING: `index.ts` 36, `identity.ts` 298, `time.ts` 216, `risk.ts` 263, and `authority.ts` 135. They provide deterministic proposal/configuration identities, time validation, and fail-closed risk validation.
    - SEVERABLE barrel-only exports: `diagnostics.ts` 329, `exchange.ts` 98, `execution.ts` 212, `failures.ts` 211, `opportunity.ts` 181, `reconciliation.ts` 108, `runtime.ts` 269.
  - External runtime dependencies: built-in `node:crypto` and `node:util`, plus public WebSocket package `ws`, declared by the 28-line `server/package.json`. No private-exchange package enters this closure.
  - “Barrel-only” means an `index.ts` re-export currently makes the module load even though Volume does not use its behavior. Narrowing those imports makes the listed exports severable.

- Runtime-provided owners:

  - `engine/marketData.ts` — 1,223 — LOAD-BEARING now; supplies `allRows()` for the symbol universe. A clean bot could replace it with a smaller public-universe owner.
  - `config.ts` — 245 and `types.ts` — 168 — LOAD-BEARING. They supply kill state, allowed/blocked symbols, size ceiling, and minimum quote volume.
  - `ledger.ts` — 6,748 — LOAD-BEARING for faithful persistence. The traced path uses the generic `events` table at lines 580–594 and `config` table at lines 2520–2523; no Volume-specific table is required.
  - `services/observedOrderFocus.ts` — 333 — reads and compare-and-sets a named config record and writes audit events.
  - System-integration controls also commit their checkpoint through the same generic config-and-events transaction at `systemIntegration/persistence/ledgerAdapter.ts:1662`.
  - `bootstrap/environment.ts` — 771 — LOAD-BEARING for the deployed database location and lease, but replaceable in a standalone bot.
  - `engine/decay/**` — 2,875 — LOAD-BEARING for current safety: `coordinator.ts` 320, `governance.ts` 1,033, `index.ts` 5, `ledger.ts` 422, `measurement.ts` 892, `types.ts` 203. The detector can technically run without it, but removing it changes current strategy-decay protection.
  - Persisted kill, allowlist, and blocked-symbol values are UNKNOWN because querying the database was prohibited. Source defaults are kill on, live trading off, and an empty allowlist.

- Mount, controls, and routes:

  - `server/src/index.ts` — 5,460 — LOAD-BEARING for this deployment; constructs Volume with Ledger, AppConfig, MarketEngine universe, and decay coordination at line 275. It mounts `GET /api/engine/volume` at lines 3354–3356.
  - `systemIntegration/composition/**` — 1,378 — LOAD-BEARING for the present managed launch, replaceable by a small standalone supervisor: `managedComposition.ts` 586, `promisePollAdapter.ts` 446, `types.ts` 148, `graph.ts` 102, `runtimeEffectReadback.ts` 57, `scheduler.ts` 33, `index.ts` 6.
  - `systemIntegration/application/**` — 3,751 — LOAD-BEARING for the current application shell, SEVERABLE from a standalone scanner: `facade.ts` 2,286, `projection.ts` 878, `types.ts` 266, `health.ts` 215, `shutdownAdmission.ts` 102, `index.ts` 4.
  - Current production bridge — 4,748 lines — SEVERABLE from the detector, but required for the shared system read model: `factory.ts` 3,083, `types.ts` 537, `volumeRisk.ts` 475, `capitalEconomics.ts` 262, `temporal.ts` 158, `observedOrderFocus.ts` 139, `sourceAdmission.ts` 88, `index.ts` 6. The Volume-risk and observed-focus evidence ports are currently constructed with no external owner and their returned ports are not consumed by the mount.
  - Routes — 830 lines: `router.ts` 500, `validation.ts` 157, `health.ts` 92, `types.ts` 77, `index.ts` 4. The direct Volume snapshot is public; durable control mutations use the operator-guarded `/api/system-integration/controls` route.
  - Controls — 1,081 lines: `service.ts` 554, `validation.ts` 208, `types.ts` 184, `alarmHalt.ts` 131, `index.ts` 4. LOAD-BEARING for faithful operator control, SEVERABLE from detector mathematics.
  - Shared persistence barrel path — 7,966 lines — SEVERABLE from a stripped scanner but used by current durable controls: `ledgerAdapter.ts` 2,901, `liveEdgeControlPersistenceAdapter.ts` 1,171, `liveEdgeMutationJournalAdapter.ts` 1,120, `types.ts` 773, `codec.ts` 666, `bootReleasePersistenceAdapter.ts` 598, `restart.ts` 315, `liveEdgeControlCheckpoint.ts` 288, `liveEdgeControlProductionBinding.ts` 126, `index.ts` 8.

- Downstream evidence consumers — SEVERABLE from Volume detection:

  - `intelligenceRuntime/bridge/**` — 2,396 and `routing/**` — 1,883. They normalize and route Volume’s public trade evidence into the system intelligence read model.
  - `intelligenceFoundation/contracts/**` — 1,674, `evidence/**` — 1,884, `universe/**` — 1,942.
  - `foundation/readModel/**` — 1,814.
  - `intelligenceRuntime/universe/**` — 2,176.
  - `systemIntegration/adapters/engineCapture.ts` — 1,073 and `opportunityOwners.ts` — 112.
  - These consume snapshots/evidence; none feeds the core detector or supplies an order executor.

- Page fetch — SEVERABLE from the bot:

  - `web/src/pages/VolumeScanner.tsx` — 1,263 and `VolumeScanner.css` — 697. The page polls `/api/engine/volume` every two seconds.
  - `web/src/App.tsx` — 242 and `web/src/store.tsx` — 2,122 mount and route the page.
  - `web/src/lib/http.ts` — 135, `polling.ts` — 129, and `volumeWorkspaceTruth.ts` — 197 decode the response.
  - `web/src/pages/Opportunities.tsx` — 922 also polls the same Volume snapshot.
  - `web/src/lib/tokenIntelligence.ts` — 867 supports an optional expanded-symbol secondary fetch and is not needed by the Volume scanner.
  - The live Vite process exists, but browser rendering and fetch success remain UNKNOWN because no page or endpoint was opened.

- Large blocks not required by the core Volume closure:

  - `server/src/liveEdge/**` — 55,836 — SEVERABLE from Volume; separate execution/control edge.
  - `server/src/aiOps/**` — 20,015 — SEVERABLE.
  - `server/src/engine/basis/**` — 7,058 — SEVERABLE; separate strategy.
  - `server/src/foundation/execution/**` — 17,749 — SEVERABLE; no execution module is called by Volume.
  - `server/src/foundation/reconciliation/**` — 2,527 — SEVERABLE.
  - `server/src/productIntegration/**` — 13,300 — SEVERABLE.
  - `server/src/productAssurance/**` — 7,611 — SEVERABLE.
  - Other services — 11,503 lines after excluding Volume runtime and observed-focus persistence — SEVERABLE.
  - `quant/**` — 195,721, `ops/**` — 79,455, `server/test/**` — 203,249, and `web/test/**` — 16,319 — not runtime dependencies.
  - The Watchdog surface was deliberately not inspected; its source and visible state remain UNKNOWN.

RUNS NOW?: RUNNING as a mounted lifecycle, not proven healthy. The live server process identifier ends `0941`, runs `node server/dist/index.js` from the exact target, and listens on `127.0.0.1:8080`; the Vite identifier ends `6083` and listens on port 5173 from the target’s `web` directory. The compiled Volume mount is newer than its source, and `systemIntegration/composition/graph.ts:81` launches it after market intelligence. Once launched, `volumeRuntime.ts:460-486` schedules universe, tick, and book work; `volumeRuntime.ts:805-895`, `968-988`, `1259-1345` wire public universe, aggregate trades, books, and candle baselines. Current feed freshness, WebSocket health, persisted controls, proposals, and page rendering are UNKNOWN because no API, database, or browser inspection was performed.

MONEY?: DIRECT. This is one of the money-edge strategies, but its current output stops at a proposal and an unused intent stub. `proposals.ts:1-7` explicitly denies automatic buy/sell, and the only “toward execution” method has no caller outside the Volume engine. The kill gate rejects proposal creation when enabled. No private read, signed mutation, database call, or order action was made during this audit.

REMOVABLE?: NO as a whole: removing it deletes the Volume money edge. The 6,077-line disabled shadow measurement subsystem, 368 unreachable owned lines, barrel-only contract modules, browser UI, and downstream intelligence bridge are individually SEVERABLE. A faithful reduced bot must retain the 4,707-line scanner core, V0 chassis, a runtime owner, public Binance feed adapters, exact-decimal and identity/time/risk contracts, universe/config owners, durable control or equivalent fail-closed state, and current decay protection or an explicitly approved replacement.

EVIDENCE:

- [logs/server.log:1](/Users/cosmosgeek/Desktop/cosmos-live-20260809/logs/server.log:1) — deployed server boot and listener evidence.
- [server/src/index.ts:275](/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/index.ts:275) — Volume construction and injected owners.
- [server/src/systemIntegration/composition/graph.ts:81](/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/systemIntegration/composition/graph.ts:81) — managed Volume lifecycle launch.
- [server/src/engine/volume/proposals.ts:1](/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/engine/volume/proposals.ts:1) — advisory-only proposal boundary.
- [web/src/pages/VolumeScanner.tsx:731](/Users/cosmosgeek/Desktop/cosmos-live-20260809/web/src/pages/VolumeScanner.tsx:731) — browser polling path.

## Exact extraction manifest

## /Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src — 48,363 lines

WHAT IT IS: This is the duplicate-free source carry for the current Basis and Volume bots: every local file imported by their two runtimes, shared market-data owner, and configuration owner. “Shared” supports both bots; the other groups belong only to Basis or Volume. It excludes the giant startup file, web pages, Quant research, tests, operations, and AI code; a clean rebuild should create a narrow startup file and needs only `better-sqlite3` and `ws` beyond Node’s built-ins. Recount: 117 files and 48,363 lines; routing discrepancy: full `engine/basis` plus `engine/v0` measures 7,479 lines, not the routed estimate of about 12,000—a 37.7% shortfall—and these Task 50 lines overlap other shards, so they must not be added again to the whole-tree total.

SUB-PIECES:

Shared — 76 files — 29,915 lines

- `/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/binance/publicSourceMode.ts` — 37 — Controls whether public exchange reads are allowed.
- `/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/binance/rest.ts` — 1,079 — Fetches public books, candles, and market snapshots.
- `/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/binance/ws.ts` — 398 — Owns reconnecting live exchange streams.
- `/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/capitalFoundation/contracts/actions.ts` — 143 — Defines bounded capital-action records used by shared imports.
- `/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/capitalFoundation/contracts/approvals.ts` — 73 — Defines capital approval records.
- `/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/capitalFoundation/contracts/capital.ts` — 258 — Defines account and capital truth.
- `/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/capitalFoundation/contracts/conservativeEconomics.ts` — 384 — Defines conservative cost and value evidence.
- `/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/capitalFoundation/contracts/decimal.ts` — 188 — Parses and compares money values without rounding.
- `/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/capitalFoundation/contracts/economics.ts` — 144 — Defines expected and realized money reports.
- `/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/capitalFoundation/contracts/identity.ts` — 134 — Creates stable Capital record identities.
- `/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/capitalFoundation/contracts/index.ts` — 25 — Exposes the Capital contracts through one import.
- `/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/capitalFoundation/contracts/lifecycle.ts` — 235 — Defines capital lifecycle states.
- `/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/capitalFoundation/contracts/opportunity.ts` — 124 — Defines Capital’s view of strategy proposals.
- `/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/capitalFoundation/contracts/ports.ts` — 160 — Defines boundaries to storage and outside owners.
- `/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/capitalFoundation/contracts/positions.ts` — 101 — Defines capital position snapshots.
- `/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/capitalFoundation/contracts/truth.ts` — 105 — Defines availability and completeness states.
- `/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/capitalFoundation/economics/compose.ts` — 537 — Assembles exact economic reports used by decay measurement.
- `/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/capitalFoundation/economics/index.ts` — 3 — Exposes the economics modules.
- `/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/capitalFoundation/economics/segmentation.ts` — 714 — Groups realized results for decay evidence.
- `/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/capitalFoundation/economics/types.ts` — 140 — Defines economic report shapes.
- `/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/config.ts` — 245 — Loads and saves bot limits, symbol policy, and kill state.
- `/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/engine/decay/coordinator.ts` — 320 — Runs shared strategy-decay governance after engine ticks.
- `/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/engine/decay/governance.ts` — 1,033 — Converts performance evidence into hold, reduce, disable, or retire decisions.
- `/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/engine/decay/index.ts` — 5 — Exposes all decay modules through the current shared import.
- `/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/engine/decay/ledger.ts` — 422 — Persists decay decisions and history.
- `/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/engine/decay/measurement.ts` — 892 — Defines future multi-axis decay evidence; its live producer is absent, but the current index imports it.
- `/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/engine/decay/types.ts` — 203 — Defines decay policies, measurements, and history.
- `/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/engine/marketData.ts` — 1,223 — Owns the shared public universe plus mark and funding truth.
- `/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/engine/v0/clock.ts` — 29 — Supplies clocks and correlation identities to both engines.
- `/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/engine/v0/config.ts` — 79 — Holds shared scanner limits and defaults.
- `/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/engine/v0/types.ts` — 313 — Defines shared observations, decisions, events, and focus states.
- `/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/foundation/borrow/decimal.ts` — 33 — Handles exact borrow-number parsing.
- `/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/foundation/borrow/derive.ts` — 782 — Derives borrow truth from validated evidence.
- `/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/foundation/borrow/index.ts` — 41 — Exposes borrow modules through the current import chain.
- `/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/foundation/borrow/types.ts` — 197 — Defines borrow availability and cost records.
- `/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/foundation/borrow/validate.ts` — 622 — Rejects incomplete or unsafe borrow evidence.
- `/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/foundation/calibration/aggregate.ts` — 469 — Aggregates prediction reliability evidence.
- `/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/foundation/calibration/index.ts` — 10 — Exposes calibration modules.
- `/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/foundation/calibration/record.ts` — 423 — Validates individual prediction and outcome records.
- `/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/foundation/calibration/types.ts` — 216 — Defines calibration records and reports.
- `/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/foundation/contracts/authority.ts` — 135 — Defines the accepted evidence-authority states.
- `/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/foundation/contracts/diagnostics.ts` — 329 — Defines bounded diagnostic evidence.
- `/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/foundation/contracts/exchange.ts` — 98 — Defines exchange instrument and filter truth.
- `/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/foundation/contracts/execution.ts` — 212 — Defines execution-plan contracts without granting execution.
- `/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/foundation/contracts/failures.ts` — 211 — Defines shared fail-closed error records.
- `/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/foundation/contracts/identity.ts` — 298 — Creates stable shared identities and content hashes.
- `/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/foundation/contracts/index.ts` — 36 — Exposes Foundation contracts through the engines’ current imports.
- `/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/foundation/contracts/opportunity.ts` — 181 — Defines the shared opportunity projection.
- `/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/foundation/contracts/reconciliation.ts` — 108 — Defines local-versus-exchange truth states.
- `/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/foundation/contracts/risk.ts` — 263 — Defines complete risk verdicts used by Volume proposal records.
- `/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/foundation/contracts/runtime.ts` — 269 — Defines managed runtime states.
- `/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/foundation/contracts/time.ts` — 216 — Defines freshness and source-time rules.
- `/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/intelligenceFoundation/contracts/constants.ts` — 106 — Holds shared evidence bounds.
- `/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/intelligenceFoundation/contracts/ids.ts` — 84 — Creates stable evidence identities.
- `/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/intelligenceFoundation/contracts/index.ts` — 4 — Exposes intelligence evidence contracts.
- `/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/intelligenceFoundation/contracts/types.ts` — 486 — Defines normalized market evidence records.
- `/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/intelligenceFoundation/contracts/validation.ts` — 994 — Rejects malformed or contradictory evidence.
- `/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/intelligenceRuntime/contracts/boundedJson.ts` — 150 — Bounds stored structured evidence.
- `/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/intelligenceRuntime/contracts/index.ts` — 4 — Exposes public-source runtime contracts.
- `/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/intelligenceRuntime/contracts/sourceCatalog.ts` — 154 — Defines approved public market sources.
- `/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/intelligenceRuntime/contracts/sourceLifecycle.ts` — 459 — Defines source start, stop, freshness, and failure truth.
- `/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/intelligenceRuntime/contracts/types.ts` — 211 — Defines shared source records.
- `/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/ledger.ts` — 6,748 — Owns the sole local database, bot events, and durable configuration.
- `/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/liveEdge/adapters/durableMutationJournal/exact.ts` — 53 — Supplies exact-number checks reached through Ledger validation.
- `/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/liveEdge/controls/adapter.ts` — 831 — Adapts persisted control records reached through the Ledger import chain.
- `/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/liveEdge/controls/index.ts` — 4 — Exposes shared control validation.
- `/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/liveEdge/controls/integrity.ts` — 180 — Checks control-record integrity.
- `/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/liveEdge/controls/types.ts` — 613 — Defines persisted control records.
- `/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/liveEdge/controls/validation.ts` — 720 — Rejects unsafe control records.
- `/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/systemIntegration/contracts/constants.ts` — 187 — Holds shared integration bounds and labels.
- `/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/systemIntegration/contracts/types.ts` — 414 — Defines trace and component records required by Ledger.
- `/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/systemIntegration/contracts/validation.ts` — 723 — Validates the trace records Ledger accepts.
- `/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/systemIntegration/persistence/codec.ts` — 666 — Encodes and validates persisted integration records.
- `/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/systemIntegration/persistence/liveEdgeControlCheckpoint.ts` — 288 — Defines durable control checkpoints imported by persistence.
- `/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/systemIntegration/persistence/types.ts` — 773 — Defines the records stored by the shared Ledger.
- `/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/types.ts` — 168 — Defines application configuration supplied to both runtimes.

Basis-only — 18 files — 5,731 lines

- `/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/engine/basis/borrow.ts` — 113 — Rejects reverse Basis when borrow truth or cost is unavailable.
- `/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/engine/basis/config.ts` — 241 — Defines Basis thresholds, limits, and configuration identity.
- `/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/engine/basis/edge.ts` — 38 — Calculates conservative net Basis edge after costs.
- `/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/engine/basis/engine.ts` — 525 — Runs the complete Basis observation-to-proposal loop.
- `/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/engine/basis/events.ts` — 58 — Emits bounded Basis decisions and lifecycle events.
- `/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/engine/basis/features.ts` — 152 — Builds the Basis evidence used by the scanner.
- `/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/engine/basis/funding.ts` — 125 — Measures funding cost, timing, and reversal danger.
- `/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/engine/basis/gapTracker.ts` — 462 — Tracks gap direction, persistence, widening, and narrowing.
- `/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/engine/basis/lifecycle.ts` — 725 — Owns candidate, focus, proposal, cooldown, and disabled order-bridge state.
- `/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/engine/basis/liquidity.ts` — 161 — Checks spread, available size, and expected slippage.
- `/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/engine/basis/marketState.ts` — 667 — Holds the bounded Spot, perpetual, funding, and universe state.
- `/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/engine/basis/math.ts` — 256 — Implements executable gap, fees, funding, and cost arithmetic.
- `/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/engine/basis/priority.ts` — 73 — Ranks Basis candidates.
- `/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/engine/basis/proposals.ts` — 509 — Creates, updates, expires, and invalidates Basis proposals.
- `/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/engine/basis/rejectVocabulary.ts` — 175 — Preserves every named Basis refusal reason.
- `/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/engine/basis/scanner.ts` — 335 — Decides ignore, watch, focus, reject, or propose.
- `/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/engine/basis/types.ts` — 362 — Defines Basis observations, evidence, proposals, and lifecycle records.
- `/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/services/basisRuntime.ts` — 754 — Polls live books, joins shared funding truth, ticks Basis, and records events.

Volume-only — 23 files — 12,717 lines

- `/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/engine/volume/adapters.ts` — 153 — Converts raw live trades into Volume-engine observations.
- `/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/engine/volume/baseline.ts` — 77 — Measures each token against its own quiet history.
- `/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/engine/volume/config.ts` — 171 — Defines wake-up thresholds, limits, and configuration identity.
- `/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/engine/volume/depth.ts` — 68 — Measures current book quality.
- `/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/engine/volume/detector.ts` — 271 — Detects quiet-to-active transitions and named refusals.
- `/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/engine/volume/engine.ts` — 665 — Runs the complete Volume observation-to-proposal loop.
- `/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/engine/volume/events.ts` — 103 — Emits bounded Volume decisions and lifecycle events.
- `/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/engine/volume/features.ts` — 226 — Builds rolling Volume, trade-count, flow, and book evidence.
- `/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/engine/volume/focus.ts` — 559 — Owns focused-token admission, eviction, protection, and closure.
- `/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/engine/volume/forwardMeasurementDetectorSource.ts` — 375 — Builds optional forward-study cuts; the deployed activation is OFF.
- `/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/engine/volume/forwardMeasurementEvidence.ts` — 3,628 — Validates optional forward-study evidence; no deployed capture port uses it.
- `/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/engine/volume/forwardMeasurementRunner.ts` — 1,123 — Runs the optional forward-study evaluator when explicitly armed.
- `/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/engine/volume/forwardMeasurementScheduler.ts` — 951 — Schedules optional forward-study cuts; current construction leaves it OFF.
- `/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/engine/volume/observedOrderFocus.ts` — 249 — Protects tokens that durable order truth says still have open exposure.
- `/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/engine/volume/priority.ts` — 46 — Ranks Volume candidates.
- `/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/engine/volume/proposals.ts` — 1,159 — Creates and safely attaches evidence and risk truth to Volume proposals.
- `/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/engine/volume/rejectVocabulary.ts` — 152 — Preserves every named Volume refusal reason.
- `/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/engine/volume/rolling.ts` — 286 — Maintains bounded rolling trade windows.
- `/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/engine/volume/tape.ts` — 110 — Measures burst shape, imbalance, and wash-like churn.
- `/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/engine/volume/types.ts` — 271 — Defines Volume observations, evidence, proposals, and risk attachments.
- `/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/engine/volume/validation.ts` — 141 — Rejects malformed symbols, trades, books, and baselines.
- `/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/services/observedOrderFocus.ts` — 333 — Persists and restores Volume’s open-order focus protection.
- `/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/services/volumeRuntime.ts` — 1,600 — Opens aggregate-trade streams, warms baselines, refreshes books, ticks Volume, and records events.

RUNS NOW?: RUNNING — the target’s deployed Node process is listening on loopback port 8080, all 117 selected files have compiled counterparts, and the mounted composition starts both runtimes. Current feed freshness and current proposal counts remain UNKNOWN because application calls and page interaction were forbidden.

MONEY?: DIRECT — these files calculate executable Basis opportunities and dormant-token Volume proposals. They place no orders today: the Basis bridge from proposal to execution is constructed OFF, Volume’s forward-study capture is OFF, and live execution is outside this manifest.

REMOVABLE?: NO — removing any listed file breaks the present compile/import chain or an injected market, configuration, or persistence owner. The four Volume `forwardMeasurement*` files are inactive import baggage and may be removed only after the clean rebuild removes their imports and cut-building branch; they cannot be deleted from the current tree as-is.

EVIDENCE:

- [server/src/index.ts:271](/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/index.ts:271) — constructs both runtimes from the shared market universe and decay coordinator.
- [server/src/systemIntegration/production/factory.ts:2917](/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/systemIntegration/production/factory.ts:2917) — mounts the Basis and Volume lifecycle starts.
- [server/src/services/basisRuntime.ts:531](/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/services/basisRuntime.ts:531) — ticks Basis after live books and funding are joined.
- [server/src/services/volumeRuntime.ts:556](/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/services/volumeRuntime.ts:556) — ticks Volume on its deployed cadence.
- [server/src/services/volumeRuntime.ts:246](/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/services/volumeRuntime.ts:246) — proves forward-study capture defaults to the explicitly validated OFF state.

# 5. Disagreements and coordinator rulings

| Conflict | Shard claims | Coordinator ruling |
|---|---|---|
| News/Calendar owner policy | Owner says isolate/park; web shard finds both mounted and navigable | **LIVE ROUTE DRIFT** — source is live; owner policy is unmet |
| AI Ops lane name | Server runtime is Shadow A2; web preview calls itself A4 and contains no A2 reference | **BOTH TRUE, DIFFERENT ISLANDS** — do not describe the web preview as A2 |
| Private truth | Binance private-truth adapter is not mounted as a producer; separate PrivateReadService is live | **NOT A CONFLICT** — passive adapter and live read service are different owners |
| System persistence | Parent row said persistence is live while M0 is dormant | **SPLIT RULING** — 8,932-line core is RUNNING; 6,176-line M0 adapter is DEAD/not mounted |
| Research Lab routing | Code shard pattern missed uppercase RESEARCH_LAB_INDEX.json and the 330-file public archive | **NON-CODE LEDGER OWNS THEM** — no code gap; they remain live page data |
| Operational web count | Shard headline 9,103 included Markets.rebuild-notes.md | **CODE ROW 9,060; DOC ROW 43** |
| Web AI Ops count | Shard headline 5,596 combined code and preview markup | **CODE ROW 5,584; NON-CODE HTML 12** |
| Capital tests B | Shard audited all 12,269 lines and overlapped Split 46H | **AUTHORITATIVE REMAINDER 5,598** after excluding the 6,671-line A split |
| Quant q08/q09 | Shard reported 10,005 | **AUTHORITATIVE WC COUNT 10,004**; full Quant tests reconcile at 77,775 |
| Watchdog A size | Parent slice measured 12,128, above the 12,000 ceiling | **REPLACED** by exclusive 7,737 and 4,391 line splits |
| Running versus healthy | Several shards proved mounts/listeners but could not read current application state | **RUNNING IS NOT HEALTHY** — freshness, controls and proposals remain UNKNOWN |
| Operations “running” wording | Three Ops splits meant “used during an authorized release/maintenance command”; process evidence shows none mounted now | **DEAD UNDER THIS ORDER** — manual/deploy reachability is not current deployed-process execution |
| Basis/Volume versus lifecycle islands | Live scanners run; Normal/Reverse Basis and Volume lifecycle packages are dead | **SCANNER ONLY** — do not infer position execution from similarly named source |
| Test reachability versus result | Runners select most suites, but no test was run | **RESULT UNKNOWN** everywhere; static selector defects are findings, not executed failures |

# 6. Exclusive block dossiers

The dossiers below are the authoritative exclusive source/test rows used by the reconciliation gate. Oversized parent summaries are omitted where narrower split reports replaced them. A few multi-path tasks contain more than one contract-shaped block, but their paths remain exclusive.

## Server source

<!-- visible task 1 -->
## /Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/liveEdge/adapters/binancePrivateTruth/** — 11,168 lines

WHAT IT IS: This block checks Binance account evidence supplied by another component: Spot, stablecoin-margined futures, and Margin balances, orders, fills, positions, fees, permissions, and continuous-feed health. It standardizes values, blocks when evidence is missing or stale, records continuity, and creates content fingerprints for later owner comparison; it has no credentials, network transport, database ownership, risk decision, or order authority. Spot evidence can theoretically become complete; futures and Margin cannot under the current recorded exchange interfaces because required facts are unavailable, while Margin’s feed is risk-only. Recount: 15 TypeScript files and 11,168 lines versus the routed estimate of about 11,200; no routing discrepancy—32 lines, or 0.3%.

SUB-PIECES:

- [spotLifecycle.ts](/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/liveEdge/adapters/binancePrivateTruth/spotLifecycle.ts) — 2,233 — Turns supplied Spot feed observations into connection, enrollment, duplicate, conflict, ordering, expiry, and fresh owner-cross-check state; it opens no connection.
- [normalize.ts](/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/liveEdge/adapters/binancePrivateTruth/normalize.ts) — 2,106 — Rejects malformed input and converts supplied account, balance, order, trade, position, fee, interest, and permission evidence into one exact safe shape.
- [usdmLifecycle.ts](/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/liveEdge/adapters/binancePrivateTruth/usdmLifecycle.ts) — 2,032 — Tracks supplied stablecoin-futures feed access lifetime, connection health, event meaning, duplicates, conflicts, ordering, expiry, and owner-cross-check coverage.
- [marginLifecycle.ts](/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/liveEdge/adapters/binancePrivateTruth/marginLifecycle.ts) — 1,198 — Tracks cross-Margin risk-feed health while explicitly refusing to call its two risk events complete account, order, trade, liability, or sequence truth.
- [projection.ts](/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/liveEdge/adapters/binancePrivateTruth/projection.ts) — 1,023 — Requires every product fact, two separate key reviews, exact trade-history windows, and a fresh owner cross-check before marking entry evidence complete.
- [waiting.ts](/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/liveEdge/adapters/binancePrivateTruth/waiting.ts) — 560 — Locks a complete evidence cut to current symbol rules, feed state, and owner cross-check; it can only return unchanged-but-non-sendable, recheck, or blocked.
- [lifecycleBinding.ts](/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/liveEdge/adapters/binancePrivateTruth/lifecycleBinding.ts) — 372 — Rechecks Spot and futures feed health for owner comparison and always blocks Margin because its risk feed is not account truth.
- [types.ts](/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/liveEdge/adapters/binancePrivateTruth/types.ts) — 344 — Defines the allowed products, facts, evidence shapes, and an all-false authority record that forbids reads, orders, money changes, and owner reconciliation.
- [permissions.ts](/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/liveEdge/adapters/binancePrivateTruth/permissions.ts) — 311 — Compares separate read and trading key descriptions against minimum-power rules; passing means reviewable evidence, never permission to act.

RUNS NOW?: DEAD (not mounted as an account-truth producer) — the deployed process mounts an order-record component that loads some of these checkers, but no live producer feeds this block account facts or lifecycle observations. The live owner report marks private projection “not invoked” and account truth “owner-gated”; the actual account-read service is the separate `PrivateReadService`.

MONEY?: NO — neither Basis nor Volume imports or calls this block; it is passive safety evidence for dormant order-recovery, normal-basis, and small Spot test-trade paths.

REMOVABLE?: YES-BUT deleting it alone breaks the next build or restart because the mounted order-record checker and dormant normal-basis and small Spot test-trade files import it; remove or replace those imports first, while the separate live account reader would remain.

EVIDENCE: [projection.ts:911](/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/liveEdge/adapters/binancePrivateTruth/projection.ts:911); [journal.js:5](/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/dist/liveEdge/adapters/durableMutationJournal/journal.js:5); [index.js:182](/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/dist/index.js:182); [canonicalOwnerEvidence.js:257](/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/dist/systemIntegration/adapters/canonicalOwnerEvidence.js:257); [index.js:445](/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/dist/index.js:445)

<!-- visible task 2 -->
## server/src/liveEdge/adapters/durableMutationJournal — 4,869 lines
WHAT IT IS: This is the safety record for an attempted order change, covering preparation, send intent, exchange replies, fills, and comparison with exchange truth. Linked records expose replays, conflicting observations, and uncertain outcomes without granting send permission. The routed estimate was ~4.9k; no routing discrepancy.
SUB-PIECES: `journal.ts — 3,737 — Builds and validates the linked order history, rejects conflicts and unsafe repeats, and prepares exchange-truth comparison`; `types.ts — 595 — Defines the allowed record stages, evidence, limits, and zero-authority boundaries`; `section7.ts — 480 — Produces blocked capital-readiness and full-path timing evidence without automatic promotion`.
RUNS NOW?: RUNNING — the live entrypoint constructs its Ledger-backed adapter (`server/src/index.ts:326`), and the live evidence report reads its inventory while keeping send permission off (`server/src/systemIntegration/adapters/canonicalOwnerEvidence.ts:351`, `server/src/systemIntegration/adapters/canonicalOwnerEvidence.ts:355`, `server/src/systemIntegration/adapters/canonicalOwnerEvidence.ts:365`). Actual journal contents remain unmeasured because database calls were forbidden.
MONEY?: NEEDED-BY-MONEY — execution safety after a Basis or Volume proposal, not strategy-choice logic.
REMOVABLE?: NO — current live evidence wiring would break, and enabled money execution would lose persist-before-send, duplicate prevention, and uncertain-outcome recovery safeguards.
EVIDENCE: `server/src/liveEdge/adapters/durableMutationJournal/types.ts:39`; `server/src/liveEdge/adapters/durableMutationJournal/journal.ts:2327`; `server/src/liveEdge/adapters/durableMutationJournal/journal.ts:2500`; `server/src/index.ts:326`; `server/src/systemIntegration/adapters/canonicalOwnerEvidence.ts:355`.

## server/src/liveEdge/adapters/binanceSignedKernel — 4,096 lines
WHAT IT IS: This is a safety kit for constructing Binance private requests. It checks exchange time and traffic caps, creates stable request identities, builds the mathematical proof made with a private key, removes secret-like diagnostic data, and prevents automatic repeat sends after uncertain outcomes. It contains no network sender. The routed estimate was ~4.1k; combined Task 02 ownership is 8,965 lines with no routing discrepancy.
SUB-PIECES: `rateBudget.ts — 1,423 — Source-only today; calculates exchange traffic usage and blocks unknown, exhausted, or cooling-down request capacity`; `clock.ts — 758 — Source-only today; rejects stale or inconsistent exchange-time samples before producing a signing timestamp`; `safety.ts — 622 — Source-only today; turns failures and diagnostics into bounded public data with secret-like material removed`; `ambiguity.ts — 527 — Loaded today by the journal; records one send attempt, blocks duplicates, and directs uncertain results to checking rather than resending`; `request.ts — 453 — Source-only today; constructs checked unsigned or signed parameters but never dispatches them`.
RUNS NOW?: RUNNING — limited to the contract, identity, and uncertain-outcome helpers imported by the live journal (`server/src/liveEdge/adapters/durableMutationJournal/journal.ts:39`, `server/src/liveEdge/adapters/durableMutationJournal/journal.ts:40`). The actual signing path is not mounted: production supplies only a clock to the small Spot runtime boundary (`server/src/index.ts:280`), and omitting its executor is explicitly unable to fire (`server/src/systemIntegration/production/m0SpotRuntimeBoundary.ts:1334`).
MONEY?: NEEDED-BY-MONEY — private-request execution safety, not Basis or Volume signal logic.
REMOVABLE?: NO — the running journal already depends on its identity and uncertain-outcome rules; guarded private execution would also lose clock, traffic-cap, duplicate-send, and secret-removal protections.
EVIDENCE: `server/src/liveEdge/adapters/binanceSignedKernel/rateBudget.ts:917`; `server/src/liveEdge/adapters/binanceSignedKernel/request.ts:394`; `server/src/liveEdge/adapters/binanceSignedKernel/ambiguity.ts:409`; `server/src/liveEdge/adapters/durableMutationJournal/journal.ts:39`; `server/src/systemIntegration/production/m0SpotRuntimeBoundary.ts:1334`.

<!-- visible task 3 -->
## server/src/liveEdge/adapters/binanceContracts — 4,109 lines

WHAT IT IS: This is a locked, dated catalog of Binance exchange routes: web addresses, signing rules, limits, retired routes, and known unknowns. It verifies that the catalog has not changed unexpectedly and accepts only exact documented routes; it cannot contact Binance or authorize orders. The directory has no uncommitted version-control changes. The routed estimate was ~4,100 lines: actual is +9 (+0.2%), with no material routing discrepancy.

SUB-PIECES:

- `manifest.ts — 1,794 — The reviewed source facts, exchange routes, permitted addresses, and retired-route list.`
- `types.ts — 439 — The exact permitted labels and fields for catalog entries and validation results.`
- `validate.ts — 1,472 — Rejects changed, obsolete, wrong-product, wrong-environment, or unauthorized route records.`

RUNS NOW?: RUNNING — The live server runs `server/dist/index.js` from this target, and its code-loading chain reaches all 6 contract files. The entry constructs the live journal at `server/src/index.ts:326-343`; the chain continues through `server/src/systemIntegration/persistence/liveEdgeMutationJournalAdapter.ts:8-20`, `server/src/liveEdge/adapters/durableMutationJournal/journal.ts:20-32`, and `server/src/liveEdge/adapters/binancePrivateTruth/contracts.ts:1-13`.

MONEY?: NO — The running basis and volume scanners load 0 files from this directory. It is live shared-journal and private-account safety machinery, not basis-gap or volume-pump logic.

REMOVABLE?: NO — Removing it breaks the next live build/start through the journal and private-account chain and removes exact route and signing safeguards.

EVIDENCE:

- `server/src/index.ts:326-343`
- `server/src/systemIntegration/persistence/liveEdgeMutationJournalAdapter.ts:8-20`
- `server/src/liveEdge/adapters/durableMutationJournal/journal.ts:20-32`
- `server/src/liveEdge/adapters/binancePrivateTruth/contracts.ts:1-13`
- `server/src/liveEdge/adapters/binanceContracts/validate.ts:1395-1433`

## server/src/liveEdge/adapters/binanceInstrumentSpecs — 3,242 lines

WHAT IT IS: This converts Binance’s symbol details into checked price and quantity rules, rejecting stale or incomplete inputs. A tick is the smallest price step; a lot is the smallest quantity step. Calculated orders are capped at the $10 test level and always marked unable to send. The directory has no uncommitted version-control changes; actual count is +42 over ~3,200 (+1.3%), making the combined task 7,351 versus ~7,300 (+51, +0.7%), with no material routing discrepancy.

SUB-PIECES:

- `normalize.ts — 672 — Converts exchange symbol details into freshness-checked rules and blocks incomplete or contradictory data.`
- `sizing.ts — 836 — Checks price and quantity rules, only reduces size, and enforces the $10 test ceiling.`
- `snapshot.ts — 465 — Rechecks every symbol and filter record plus its change-detection fingerprints.`
- `spotOrderTifCapability.ts — 328 — Pins how long Spot limit orders may remain active and binds that choice to a checked, non-sendable size result.`

RUNS NOW?: DEAD (not mounted) — A read-only walk of the running built entry reaches 0 of 11 instrument-rule files. The live entry creates the basis and volume scanners plus a Spot boundary with no executor at `server/src/index.ts:271-282`; direct consumers remain in unmounted adapter islands such as `server/src/liveEdge/adapters/normalBasis/binding.ts:1-6` and `server/src/liveEdge/adapters/executionPolicy/policy.ts:4-12`.

MONEY?: NO — Neither running scanner loads this directory. Its money-side callers are dormant basis and shared-execution adapters.

REMOVABLE?: YES-BUT the project stops compiling until the journal’s data definitions and dormant execution callers are removed or replaced, and future orders lose exact price and size checking.

EVIDENCE:

- `server/src/index.ts:271-282`
- `server/src/liveEdge/adapters/normalBasis/binding.ts:1-6`
- `server/src/liveEdge/adapters/binanceInstrumentSpecs/normalize.ts:617-670`
- `server/src/liveEdge/adapters/binanceInstrumentSpecs/sizing.ts:614-628`
- `server/src/liveEdge/adapters/binanceInstrumentSpecs/sizing.ts:668-695`

<!-- visible task 4 -->
## server/src/liveEdge/adapters/binanceSpotExecution/** + executionPolicy/** + exposureRecoveryProjection/** — 4,512 lines

WHAT IT IS: These are three guarded execution-support packages, not strategy engines. They cover M0—the capped first Spot-order canary—paired Spot/perpetual order planning, and test-made exposure/recovery evidence. None selects a Basis or Volume trade. Routing discrepancy: NONE—nine assigned files total 4,512 lines, only 12 lines above the order’s ~4,500 estimate (0.27%).

SUB-PIECES:

- `binanceSpotExecution/ — 1,671 lines —` Capped Spot-order adapter and authenticated request sender.
- `binanceSpotExecution/adapter.ts — 884 lines —` Builds test, buy, query, fill, cancel, and flatten requests after one durable permit.
- `binanceSpotExecution/productionTransport.ts — 787 lines —` May send one permitted, signed request for one symbol under the 10 USDT ceiling.
- `executionPolicy/ — 1,659 lines —` Unmounted planner for paired Spot/perpetual order sequences.
- `executionPolicy/policy.ts — 1,218 lines —` Checks approvals, limits, modeled fills and losses, then selects a non-sendable plan.
- `executionPolicy/types.ts — 357 lines —` Defines the planner’s closed input, outcome, and refusal shapes.
- `exposureRecoveryProjection/ — 1,182 lines —` Proof-only exposure and restart-recovery checker.
- `exposureRecoveryProjection/projection.ts — 844 lines —` Rejects mismatched owner evidence and reports blocked, recovery-needed, or owner-review state.
- `exposureRecoveryProjection/types.ts — 336 lines —` Defines recovery stages, controls, crash cases, and test-only output.

RUNS NOW?: DEAD (not mounted). Live process …0941 runs this tree’s built server entry; its files predate the process start. That entry creates only the disarmed M0 boundary with a clock and no sender, so execution returns `M0_RUNTIME_NOT_CONFIGURED` with zero effects. The policy evaluator has no caller in the live Basis or Volume engines—only unmounted Normal/Reverse Basis source and tests. The recovery package is present in the evidence chain, but its actual projector is explicitly not invoked because there is no canonical live subject.

MONEY?: NO. This is neither Basis/Volume decision logic nor part of either running engine’s dependency path. M0 Spot is a separate canary.

REMOVABLE?: YES-BUT removing these directories alone breaks the next build and tests for the unmounted M0 sender, Normal/Reverse Basis adapters, and recovery evidence chain; remove those callers together. The running Basis and Volume scanners do not depend on them.

EVIDENCE:

- [server/src/liveEdge/adapters/binanceSpotExecution/adapter.ts:523](/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/liveEdge/adapters/binanceSpotExecution/adapter.ts:523)
- [server/src/liveEdge/adapters/executionPolicy/policy.ts:145](/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/liveEdge/adapters/executionPolicy/policy.ts:145)
- [server/src/liveEdge/adapters/exposureRecoveryProjection/projection.ts:809](/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/liveEdge/adapters/exposureRecoveryProjection/projection.ts:809)
- [server/dist/index.js:135](/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/dist/index.js:135)
- [server/src/systemIntegration/adapters/canonicalOwnerEvidence.ts:435](/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/systemIntegration/adapters/canonicalOwnerEvidence.ts:435)

<!-- visible task 5 -->
## server/src/liveEdge/adapters/normalBasis/** + server/src/liveEdge/adapters/reverseBasisLifecycle/** — 6,248 lines

WHAT IT IS: Normal basis checks a buy-coin/sell-perpetual-futures plan, each simulated order leg, fills, fees, remaining exposure, and recovery evidence. Reverse basis models borrowing the coin, selling it, buying perpetual futures, closing both positions, repaying the debt, and proving nothing remains. Both are no-send checking models, not live order executors. Recount: 6,248 lines across all 11 owned source files—2,886 + 3,362—which is 48 above the rounded ~6.2k estimate; no routing discrepancy and no owned-path Git changes.

SUB-PIECES:

- `normalBasis/ — 2,886 lines` — Directory total for the normal-basis plan, simulated-order, and reconciliation checks.
- `normalBasis/binding.ts — 426 lines` — Accepts only an exact buy-spot/sell-futures paper plan and binds it to the owner plan.
- `normalBasis/evidence.ts — 760 lines` — Compares saved owner state, fills, fees, remaining exposure, and recovery advice, then returns pass, manual action, or blocked.
- `normalBasis/twinAdapter.ts — 931 lines` — Runs and rechecks one made-up but repeatable exchange scenario for each entry, exit, or recovery leg.
- `normalBasis/types.ts — 546 lines` — Defines the permitted fields, lifecycle states, evidence records, and no-send flags.
- `reverseBasisLifecycle/ — 3,362 lines` — Directory total for the reverse-basis borrow, position, repayment, recovery, and closure model.
- `reverseBasisLifecycle/lifecycle.ts — 2,844 lines` — Reads evidence events in order, tracks debt and both positions, enforces safety limits, and saves or restores verified state.
- `reverseBasisLifecycle/types.ts — 424 lines` — Defines required checks, lifecycle stages, order roles, debt evidence, and hard no-read/no-mutation authority.

RUNS NOW?: DEAD (not mounted; test-only) — live process ·0941 runs `node server/dist/index.js` from this tree. The file Node actually runs imports and constructs the separate `BasisRuntime` (`server/dist/index.js:30`, `server/dist/index.js:126`); searches found zero callers outside these folders in both production source and compiled code. These exports are instead imported by tests (`server/test/liveEdge/normalBasis/chain.test.mjs:27`, `server/test/liveEdge/reverseBasisLifecycle/fixtures.mjs:9`).

MONEY?: DIRECT — this is basis entry, hedge, exit, debt-repayment, and recovery logic, although its current outputs cannot send orders.

REMOVABLE?: YES-BUT removing it leaves the deployed process unchanged while breaking the normal/reverse-basis tests and frozen proof checks, and discarding lifecycle safety rules a rebuild could reuse.

EVIDENCE: `server/dist/index.js:30`; `server/test/liveEdge/normalBasis/chain.test.mjs:27`; `server/src/liveEdge/adapters/normalBasis/twinAdapter.ts:825`; `server/src/liveEdge/adapters/reverseBasisLifecycle/types.ts:57`; `server/src/liveEdge/adapters/reverseBasisLifecycle/lifecycle.ts:1919`.

<!-- visible task 6 -->
## server/src/liveEdge/adapters/volumeLifecycle/** — 5,659 lines

WHAT IT IS: These are rules for moving a VOLUME trade idea from a small opening position through confirmation, adding, holding, reducing, exiting, or recovery. It checks market, sizing, capital, risk, and position facts, then replays an exchange twin—a fake exchange outcome—to maintain an internal what-if position. Every result is hard-coded as advice-only, fake-data, record-only, and impossible to send externally. Advisory-only is **CONFIRMED** as its permission boundary, but **REFUTED** if it means a live advisory service: production never calls this block.

SUB-PIECES: `lifecycle.ts — 2,820 — plans staged entries, adds, protection exits, fake fills, and uncertain-outcome recovery`; `validation.ts — 1,810 — rejects malformed, stale, mismatched, secret-shaped, or self-contradicting records`; `types.ts — 561 — defines every state, input, planned action, recovery handoff, and hard no-send label`.

RUNS NOW?: DEAD (not mounted: not connected to the running server). At inspection, the `:8080` listener, process ending `0941`, ran `node server/dist/index.js` from the target tree. That entry creates the separate live `VolumeRuntime`, while the factory’s similarly named `VolumeLifecyclePort` only starts, stops, and health-checks that scanner. Import search found this owned adapter called only by tests. Routing count is 5,659 versus the order’s approximately 5,700—0.7% lower, so no ownership/size discrepancy; the same-name production wrapper is a material runtime-routing name trap.

MONEY?: DIRECT — this is VOLUME entry, add, protection, reduction, exit, and recovery decision logic, although currently unwired.

REMOVABLE?: YES-BUT live behavior stays unchanged today; removal breaks its tests and automated rule checks and discards the staged protection/recovery design needed by a rebuild.

EVIDENCE: [lifecycle.ts:52](/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/liveEdge/adapters/volumeLifecycle/lifecycle.ts:52); [lifecycle.ts:1824](/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/liveEdge/adapters/volumeLifecycle/lifecycle.ts:1824); [lifecycle.ts:2064](/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/liveEdge/adapters/volumeLifecycle/lifecycle.ts:2064); [server/dist/index.js:130](/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/dist/index.js:130); [server/dist/systemIntegration/production/factory.js:2312](/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/dist/systemIntegration/production/factory.js:2312)

<!-- visible task 7 -->
## server/src/liveEdge/ — Task 07 owned paths only — 11,933 lines

WHAT IT IS: This block is Live Edge’s safety-and-evidence toolbox, not either trading strategy. It defines locked operator commands, fixed data-shape checks for the local Quant link, a repeatable fake exchange, and read-only evidence snapshots. The deployed server loads only the locked controls, machine-map module, and two Quant-link identity constants; this block cannot call an exchange, place an order, or choose a trade. Routing discrepancy: the route names about 10,000 lines and omits `integration` plus the 6-line root; named groups measure 10,758, the delegated additions contribute 1,175, and the total is 11,933—19.3% over the estimate, below the order’s over-20% correction trigger.

SUB-PIECES:

- `controls/ — 2,348 — All control code; loaded now, but locked because its named decision owners and permanent storage are absent.`
- `controls/adapter.ts — 831 — Previews and submits commands, checks operator, exchange, risk, kill, and recovery state, records intent before asking the sole action owner to act, and records the result.`
- `controls/types.ts — 613 — Defines accepted commands, actions, event records, receipts, and required owner services.`
- `controls/validation.ts — 720 — Rejects malformed, oversized, secret-like, remote-address, and shell-like values before accepting a command.`
- `integration/ — 1,169 — Contains the Quant advice bridge and repeat/revision registry; none is loaded now.`
- `integration/assessmentBridge.ts — 936 — Checks identity, duplicates, age, completeness, costs, funding, borrow data, and model-change alarms, then can forward only a market observation.`
- `adapters/exchangeTwin/ — 3,659 — Models a repeatable fake exchange for tests and comparison; it is not loaded now.`
- `adapters/exchangeTwin/ownerEvidence.ts — 364 — Reuses local rule and record-book owners to validate an unsigned request, but cannot sign or send it.`
- `adapters/exchangeTwin/twin.ts — 2,725 — Plays fixed fake market and order events, handles stop/restart and saved checkpoints, and compares results with recorded outcomes.`
- `adapters/exchangeTwin/types.ts — 505 — Defines fake inputs, events, saved state, outcomes, and comparison records.`
- `adapters/edgeProtocol/ — 1,350 — Defines fixed local Quant-message rules; only 576 lines of rule and identity constants are loaded, while its client and connection guards are not.`
- `adapters/edgeProtocol/client.ts — 382 — Decodes caller-supplied messages with strict size, forbidden-field, and exact-form checks without opening a connection.`
- `adapters/edgeProtocol/schemaValidator.ts — 527 — Checks exact expected data-shape text and calculates its fixed identity without reading files or networks; only its constants are used now.`
- `adapters/externalProofEvidence/ — 990 — Classifies supplied external-proof records for tests; it is not loaded now.`
- `adapters/externalProofEvidence/projection.ts — 702 — Classifies 17 proof subjects while refusing deployment, readiness, or trading-authority claims.`
- `adapters/finalLaneEvidence/ — 1,034 — Holds test-only final-lane acceptance evidence; it is not loaded now.`
- `adapters/finalLaneEvidence/projection.ts — 681 — Checks supplied proof records and command results while preserving fake, unconnected, and no-action status.`
- `adapters/finalLaneEvidence/types.ts — 351 — Defines final-lane inputs, commands, subjects, and pinned historic content identities.`
- `adapters/machineGraphEvidence/ — 1,377 — Defines the machine map and its read-only snapshot builder; the module loads, but the accepted builder is not called.`
- `adapters/machineGraphEvidence/projection.ts — 903 — Requires a complete role, control, measurement, and alarm map, then produces a record-only result with no action authority.`
- `adapters/machineGraphEvidence/types.ts — 472 — Names 27 roles, 13 components, 18 controls, 36 measurements, and 13 alarms.`

RUNS NOW?: RUNNING — Process `…0941` is `node server/dist/index.js` from this target and listens on local port 8080. Following every file loaded by that server reaches 4,301 owned lines: all controls (2,348), all machine-graph evidence (1,377), and two edge-protocol files (576); the remaining 7,632 lines are not loaded. Source leaves Quant advice absent and creates the control connection at [server/src/index.ts:321](/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/index.ts:321); that connection reports locked and cannot send actions at [liveEdgeControlProductionBinding.ts:39](/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/systemIntegration/persistence/liveEdgeControlProductionBinding.ts:39), while the machine-map result is explicitly not invoked at [canonicalOwnerEvidence.ts:695](/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/systemIntegration/adapters/canonicalOwnerEvidence.ts:695). I did not open Watchdog or send requests to the server, database, or exchange.

MONEY?: NO — Following every file loaded from both Basis and Volume engines and their two server services reaches none of this block; `exchangeTwin` records fake fills only and explicitly has no external-action authority.

REMOVABLE?: YES-BUT removing the whole block now breaks the next server build or restart because current source imports controls, machine-map definitions, and two edge-protocol constants; replace those 4,301 loaded lines first, while the 7,632 unconnected lines can be retired with their dormant callers and tests.

EVIDENCE: [server/src/index.ts:321](/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/index.ts:321) · [qAdvisory.ts:7](/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/systemIntegration/adapters/qAdvisory.ts:7) · [liveEdgeControlProductionBinding.ts:39](/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/systemIntegration/persistence/liveEdgeControlProductionBinding.ts:39) · [canonicalOwnerEvidence.ts:695](/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/systemIntegration/adapters/canonicalOwnerEvidence.ts:695) · [exchangeTwin/twin.ts:1203](/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/liveEdge/adapters/exchangeTwin/twin.ts:1203)

<!-- visible task 151 -->
## server/src/systemIntegration/persistence/m0SpotLifecyclePersistenceAdapter.ts — 6,176 lines

WHAT IT IS: This is the durable safety lock for one owner-approved Binance Spot buy and its sell-back-to-flat cleanup. It stores one-use permissions, order and fill truth, recovery state, and audit records using writes that succeed only when the prior stored value is unchanged. It releases the lock only after independently proving the account returned to its starting balance or allowed tiny remainder.

SUB-PIECES: `m0SpotLifecyclePersistenceAdapter.ts — 6,176 — validates and stores the entire one-trade lifecycle, from permission through recovery and final disarm.` Recount: 6,176 lines. Routing discrepancy: NONE; assigned and measured counts match exactly.

RUNS NOW?: DEAD (not mounted) — the live server runs `node server/dist/index.js` from this tree, but ordinary boot supplies only a clock to the M0 boundary; no executor is supplied, so it returns `M0_RUNTIME_NOT_CONFIGURED` with zero work. The adapter is imported only by the dormant executor. Built-file and test-source imports prove reachability only; no tests were executed and no test result is claimed.

MONEY?: NO — it is neither basis nor volume logic and is outside both running engines’ import/runtime paths.

REMOVABLE?: YES-BUT removing this file alone breaks the server build plus the dormant M0 executor and its direct-import tests; ordinary live basis/volume behavior does not use it.

EVIDENCE: [server/src/systemIntegration/persistence/m0SpotLifecyclePersistenceAdapter.ts:3784](/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/systemIntegration/persistence/m0SpotLifecyclePersistenceAdapter.ts:3784) · [server/src/systemIntegration/persistence/m0SpotLifecyclePersistenceAdapter.ts:6001](/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/systemIntegration/persistence/m0SpotLifecyclePersistenceAdapter.ts:6001) · [server/src/systemIntegration/production/m0SpotExecutor.ts:72](/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/systemIntegration/production/m0SpotExecutor.ts:72) · [server/dist/index.js:135](/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/dist/index.js:135) · [server/dist/systemIntegration/production/m0SpotRuntimeBoundary.js:948](/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/dist/systemIntegration/production/m0SpotRuntimeBoundary.js:948)

<!-- visible task 152 -->
## server/src/systemIntegration/persistence/ excluding m0SpotLifecyclePersistenceAdapter.ts — 8,932 lines

WHAT IT IS: This is the live server’s saved-state and data-folder safety block. It prevents a second process from sharing the live data folder, checks the restart snapshot, and records boots, shutdowns, controls, and audit history in the permanent ledger. It does not calculate basis or volume signals, but their managed startup decision and the web listener pass through it. The recount is exactly 8,932 lines across 11 files, matching the task route; routing discrepancy: NONE.

SUB-PIECES:

- `ledgerAdapter.ts — 2,901 lines` — The main ledger bridge loads saved state and makes all-or-nothing writes for startup, shutdown, controls, incidents, approvals, risk decisions, and audit history.
- `liveEdgeControlPersistenceAdapter.ts — 1,171 lines` — This would store and rebuild live-control command history, but current startup never creates it because three required state owners are absent.
- `liveEdgeMutationJournalAdapter.ts — 1,120 lines` — This holds bounded mutation history and reconstruction checks; the current process wires it only for inventory reading, with no sending authority.
- `dataDirLease.ts — 966 lines` — This creates and periodically refreshes exclusive lock files, detecting another live writer or replacement of the data folder.
- `types.ts — 773 lines` — This defines the allowed saved records, limits, failures, and ledger operations used throughout the block.
- `codec.ts — 666 lines` — This creates stable saved text, rejects malformed or secret-bearing values, and verifies tamper-check codes.
- `bootReleasePersistenceAdapter.ts — 598 lines` — This records which build and configuration booted and later marks the shutdown clean or failed.
- `restart.ts — 315 lines` — This updates the restart snapshot and decides whether opening or increasing exposure is allowed after restart.

RUNS NOW?: RUNNING — The observed process on port 8080 is `node server/dist/index.js` from the exact deployed tree; it has the live database open and its lease files are being refreshed. The executed build creates the boot recorder and mutation-inventory reader, calls saved-state startup, and opens the listener only after that succeeds (`server/dist/index.js:138-197,323-333,4762-4767`). The separate live-control bridge is inactive: current wiring supplies only the ledger and clock, so the missing owners trigger the owner gate instead of constructing it (`server/src/systemIntegration/persistence/liveEdgeControlProductionBinding.ts:66-78`).

MONEY?: NEEDED-BY-MONEY — It contains no basis or volume calculation, but both services sit behind its saved-state restore and startup gate.

REMOVABLE?: NO — Removing it breaks exclusive data-folder ownership, saved money-service controls and thresholds, restart safety, boot records, and the current listener gate.

EVIDENCE:

- `server/dist/index.js:138-197,323-333` — The executed build creates and starts the active persistence pieces.
- `server/src/systemIntegration/application/facade.ts:574-620` — Startup loads saved state, then records startup and restart truth before managed services start.
- `server/src/systemIntegration/persistence/liveEdgeControlProductionBinding.ts:66-78` — Missing owners return the inactive owner-gated binding.
- `server/dist/index.js:4762-4767` — The live listener is conditional on successful saved-state startup.
- `package.json:76` — The declared integration test command can reach the matching persistence tests; no tests were executed, so test result is UNKNOWN.

The Watchdog page was not touched, and no route, database query, exchange call, or test was executed.

<!-- visible task 9 -->
## server/src/systemIntegration/production/** + server/src/systemIntegration/evidence/** — 11,024 lines

WHAT IT IS: This is the live wiring that connects public-market collection, the Basis bot, the Volume bot, supervision, and owner controls without replacing their decisions. It also contains M0—the tiny, bounded Spot trial for the ordinary buy/sell market—including its safety checklist, closed route guard, dormant exchange caller, and after-the-fact evidence checker. Today the general wiring runs, while M0 order execution remains disarmed.

SUB-PIECES:

- `production/ — 8,505 — Live composition and safety adapters; its M0 exchange caller is present but not called by boot.`
- `production/factory.ts — 3,083 — Starts and monitors market, Basis, Volume, and public-evidence owners, then exposes their truth and controls.`
- `production/m0SpotExecutor.ts — 2,308 — Dormant caller that could sign requests, place one bounded Spot order, query or cancel it, read fills, flatten leftovers, and recover after restart.`
- `production/m0SpotRuntimeBoundary.ts — 1,449 — Live route guard that returns a closed, zero-effect result when no private-proof provider or executor is supplied.`
- `production/types.ts — 537 — Defines the exact data shapes and narrow connections allowed between production modules.`
- `production/volumeRisk.ts — 475 — Connects a Volume proposal to Foundation risk only when a trusted evidence provider exists; that provider is absent now.`
- `evidence/ — 2,519 — Holds the M0 source-readiness checklist and after-the-fact validation logic.`
- `evidence/m0AutomaticReceipt.ts — 1,723 — Validates claimed M0 evidence without placing orders; only tests call it now.`
- `evidence/m0SpotReadinessCard.ts — 796 — Produces the current source-only checklist with owner action `NO`, an empty symbol allowlist, and no verified private evidence.`

Count check: 8,505 + 2,519 = 11,024 lines across 12 TypeScript files. No owned file is uncommitted or untracked. Parent `systemIntegration` measures 47,038 lines against the order’s approximately 47,000, so ROUTING DISCREPANCY: NONE.

RUNS NOW?: RUNNING — process `…0941` is listening on `127.0.0.1:8080` from the target tree. Boot constructs the production factory at `server/src/index.ts:311`, injects its runtimes into the application at `server/src/index.ts:399`, and admits the listener only after successful System Integration startup at `server/src/index.ts:474` and `server/src/index.ts:5249`. M0 order execution is DEAD — not mounted: boot supplies only a clock at `server/src/index.ts:280`, so the boundary returns `M0_RUNTIME_NOT_CONFIGURED` with zero effects at `server/src/systemIntegration/production/m0SpotRuntimeBoundary.ts:1438`. The automatic receipt is DEAD — test-only.

MONEY?: NEEDED-BY-MONEY — the running factory is required to start and supervise Basis and Volume, but it does not decide either edge. The separate M0 executor could move money only after future private-proof and executor wiring; neither exists in today’s boot.

REMOVABLE?: NO — removing the factory or M0 boundary breaks current server boot and Basis/Volume wiring. The dormant executor and automatic receipt could be judged separately, but removing them deletes the reviewed M0 recovery design and its tests.

EVIDENCE: `server/src/index.ts:280` · `server/src/index.ts:311` · `server/src/index.ts:399` · `server/src/index.ts:1625` · `server/src/systemIntegration/production/m0SpotRuntimeBoundary.ts:1438`

<!-- visible task 51 -->
## server/src/systemIntegration/{adapters/**,contracts/**,controls/**} — 8,905 lines

WHAT IT IS: This is the safety layer around the running basis and volume bots. It turns their decisions plus account, capital, source, and ledger facts into one conservative owner view, defines allowed controls, and records a control before changing the running system. It is not the strategy math and does not place orders; missing or stale facts block action instead of being guessed.

SUB-PIECES:

- `adapters/** — 5,926 — Reads facts owned by the basis, volume, account, capital, source, and evidence parts, then makes safe summaries without private calls or order placement.`
- `adapters/engineCapture.ts — 1,073 — Copies and checks basis and volume decisions and candidate trades, then builds one advice-only combined view used in production.`
- `adapters/canonicalOwnerEvidence.ts — 772 — Combines ledger state, component health, and control availability for the main system-health summary; missing private facts remain blocked.`
- `adapters/capitalEconomics.ts — 757 — Lets a candidate pass its cost check only when funding, borrowing, and capital-use costs are current, complete, and tied to that candidate.`
- `adapters/probes.ts — 714 — Converts read-only snapshots into freshness, waiting-work counts, health, and blocking reasons; no production caller was found.`
- `adapters/qAdvisory.ts — 638 — Represents the optional external prediction adviser; production supplies no connection, so it reports “not configured” and “do nothing because truth is unknown.”`
- `adapters/liveEdgeEvidenceProbe.ts — 488 — Converts validated test-made, not-live exposure and machine-health evidence into audit-history records; no production import or call was found.`
- `adapters/passiveOwnerEvidence.ts — 460 — Supplies explicit unavailable or unknown entries for unconnected recovery, health metrics, alarms, and product checks; the running owner summary uses it.`
- `adapters/foundationQuantityBridge.ts — 403 — Checks whether an exact ledger quantity and the ordinary computer-number quantity agree within the instrument’s allowed step; no production caller was found.`
- `contracts/** — 1,898 — Defines the accepted names and data shapes for component health, truth, controls, history, and sources, rejecting claims that overstate what is live.`
- `contracts/validation.ts — 723 — Checks source, component, control, and history records field by field, including contradictions between live status, freshness, and permission to trust a fact.`
- `contracts/dialects.ts — 564 — Translates lifecycle, coverage, time, and errors from other server parts into shared words; unknown or stale facts become unavailable.`
- `contracts/types.ts — 414 — Defines the shared shapes for components and their dependency links, sources, controls, receipts, and audit history.`
- `controls/** — 1,081 — Owns the single recorded path for operator and alarm changes: check, compare the current version number, write once, then apply the proven result.`
- `controls/service.ts — 554 — Validates identity and requests, prevents duplicate or stale changes, records them before changing the running bot, and blocks risk increases under the kill switch.`

RUNS NOW?: RUNNING — the server builds this layer with both basis and volume runtimes, combines both engines’ records, constructs its recorded control service, and calls the application start path.

MONEY?: NEEDED-BY-MONEY — it does not find either money edge, but both bots’ running read view, capital-cost safety check, source checks, and kill, pause, threshold, and size controls depend on it.

REMOVABLE?: NO — removing the whole block breaks the running basis/volume view, capital safety check, shared truth rules, and recorded controls; the no-caller files named above are only separate trim candidates.

EVIDENCE: `server/src/index.ts:311` · `server/src/systemIntegration/production/factory.ts:1051` · `server/src/systemIntegration/production/capitalEconomics.ts:182` · `server/src/systemIntegration/application/facade.ts:408` · `server/src/index.ts:461`

<!-- visible task 52 -->
## server/src/systemIntegration/application/** + server/src/systemIntegration/composition/** — 5,129 lines

WHAT IT IS: This is the live server’s startup, control, status, restart, and shutdown conductor for market data, intelligence, Basis, and Volume. It restores saved safety settings before starting services, checks their health, and refuses unsafe controls or shutdowns. It also builds the owner-facing status picture and runs validate-only checks—dry rehearsals that cannot place live orders.

SUB-PIECES:

- `application/ — 3,751 lines` — Owns saved state, controls, status reporting, safe restart and shutdown, and validate-only rehearsals.
- `application/facade.ts — 2,286 lines` — Starts the shell, restores settings, applies operator controls, builds readbacks, and drains safely.
- `application/projection.ts — 878 lines` — Turns service health, saved state, and rehearsal results into one owner-facing status picture.
- `composition/ — 1,378 lines` — Owns ordered startup, health checking, restart, and reverse-order stopping of running services.
- `composition/managedComposition.ts — 586 lines` — Drives services on a repeating timer, handles full or partial restarts, and proves clean shutdown.
- `composition/promisePollAdapter.ts — 446 lines` — Watches starts that finish later, requires current source data, and stops half-started services after failures.

RUNS NOW?: RUNNING — the deployed entrypoint supplies the real Basis and Volume services, constructs this block, calls its start path, and mounts its read/control routes.

MONEY?: NEEDED-BY-MONEY — it contains no Basis or Volume edge formula and places no orders, but it is the current managed start, control, health, restart, and stop path for both engines.

REMOVABLE?: NO — removing it breaks the server’s import/start path and removes the only managed start, control, and safe-stop path for both money engines.

EVIDENCE:

- `server/src/index.ts:311-325`
- `server/src/index.ts:394-464`
- `server/src/index.ts:1618-1628`
- `server/src/systemIntegration/application/facade.ts:737-760`
- `server/src/systemIntegration/composition/graph.ts:69-92`

<!-- visible task 11 -->
## /Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/systemIntegration/{routes,supervisor,ops,verticalSlice} + root index.ts — 6,872 lines

WHAT IT IS: This is the live server’s operator-control, safety-summary, and validation layer around Basis and Volume. It combines market, capital, risk, execution, database, and deployment-freeze facts; exposes server addresses for reads and commands; and blocks new entries when operational truth is uncertain. It also rehearses a Basis two-leg plan in validate-only mode—checks and records it but cannot send an order—and forwards the separately approved M0 first spot-order lifecycle to its running owner.

SUB-PIECES:

- `routes/ — 830 —` Owns authenticated supervisor, operations, dependency-map, event, control, focus, trace, validation and M0 addresses, plus three public health checks.
- `routes/router.ts — 500 —` Checks operator identity and exact request shape before handing reads or commands to their owners.
- `supervisor/ — 3,030 —` Builds one ordered status picture with dependencies, root blockers, linked event history and readiness.
- `supervisor/projection.ts — 859 —` Combines every component and Basis/Volume summary, rejects malformed or secret-like data, and computes overall posture.
- `supervisor/truth.ts — 313 —` Downgrades stale, incomplete or unavailable owner facts and never upgrades weak evidence.
- `supervisor/operatingMetrics.ts — 803 —` Defines and checks 17 performance measurements; its snapshot builder has no production caller.
- `ops/ — 1,282 —` Reads deployment freeze, exposure, ambiguity, recovery, restart and database-version truth, blocking new entries when uncertain.
- `ops/readback.ts — 396 —` Produces a short-lived operations summary from supervisor state, unresolved records, the freeze marker and database compatibility.
- `verticalSlice/ — 1,725 —` Runs the Basis-only validation rehearsal through approval, capital, two-leg risk, planning and reconciliation.
- `verticalSlice/orchestrator.ts — 1,223 —` Validates the exact Basis proposal, uses a sealed exchange stand-in, saves the result and rejects every live/manual/autonomous mode.

Recount: root 5 + routes 830 + supervisor 3,030 + ops 1,282 + verticalSlice 1,725 = 6,872. ROUTING DISCREPANCY: NONE—the full System Integration tree measures 47,038 lines, matching the order’s approximately 47,000; the remaining 40,166 lines are outside Task 11. No owned file differs from Git and no extra owned file sits outside Git.

RUNS NOW?: RUNNING — the current listener on port 8080 runs the built JavaScript entry from this exact tree, and that entry mounts this block. No server address was called. The freeze-clear action remains configuration-dependent; its present availability is UNKNOWN because private process settings were not inspected. The operating-measurement builder and small formatting/recovery-proof helpers have no production caller.

MONEY?: NEEDED-BY-MONEY — it does not calculate Basis gaps or Volume pump signals, but the current server injects both bot runtimes into this surrounding owner, which starts/stops them and carries their pause, symbol-block, size-limit and threshold controls.

REMOVABLE?: NO — deleting this block as-is breaks live-server startup and removes the current money-control, readiness, health and entry-safety path. Individually unused helpers remain separate trim candidates.

EVIDENCE: [server/dist/index.js:1336](/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/dist/index.js:1336); [server/src/index.ts:311](/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/index.ts:311); [routes/health.ts:85](/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/systemIntegration/routes/health.ts:85); [ops/intakeGate.ts:73](/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/systemIntegration/ops/intakeGate.ts:73); [verticalSlice/dryRunVenue.ts:51](/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/systemIntegration/verticalSlice/dryRunVenue.ts:51).

<!-- visible task 12 -->
## server/src/intelligenceRuntime/{baseline,books,bridge,capacity,capture,contracts} — 11,083 lines

WHAT IT IS: These folders contain public-market support machinery: loading older candles, rebuilding an order book (current buy/sell levels), joining live evidence, stress-testing load with made-up events, recording evidence around signals, and defining shared source-state rules. Only `bridge/**` and used parts of `contracts/**` are in today’s live startup path; the other four directories are not mounted. The bridge supplies evidence and attention before Basis and Volume start, but creates no proposal, risk decision, order, or money action. Recount: this scope is 11,083 lines of the 29,237-line `intelligenceRuntime`; the remaining 18,154 lines exceed the order’s 12,000-line block ceiling by 6,154, so the companion block must be split.

SUB-PIECES:

- `baseline — 2,278 — DEAD; plans and resumes completed-candle history downloads, respects request limits, and delivers accepted batches to a supplied destination.`
- `baseline/scheduler.ts — 1,493 — Runs history plans, deadlines, retries, request-capacity accounting, saved restart state, and batch delivery.`
- `baseline/types.ts — 339 — Defines history plans, fetch results, request budgets, saved state, and status readouts.`
- `books — 1,652 — DEAD; rebuilds local buy/sell levels from a full snapshot plus updates and calculates depth, flow, and size-caused price movement.`
- `books/localBook.ts — 1,126 — Buffers updates, joins them to a full snapshot, requests a fresh copy after sequence gaps, and exposes depth, flow, and slippage.`
- `bridge — 2,396 — RUNNING; joins current public facts into features, attention, thesis, false-positive checks, and per-symbol readouts without trade authority.`
- `bridge/boundedIndex.ts — 486 — Maintains hard-limited evidence/link lookups and reports when old material is dropped or history becomes incomplete.`
- `bridge/projection.ts — 301 — Checks configuration and turns internal market-list and attention facts into public readouts.`
- `bridge/bridge.ts — 1,311 — Owns live evidence intake, attention planning, focus pins, evidence-only analysis, and read-only snapshots.`
- `capacity — 1,495 — DEAD, test-only; uses made-up 452-symbol traffic to test queues, overload handling, focus protection, and memory limits.`
- `capacity/workload.ts — 970 — Builds and runs the repeatable made-up workload and produces its capacity report.`
- `capture — 2,284 — DEAD, not mounted; retains public evidence before and after a trigger, evaluates later time windows, and can save or restore state.`
- `capture/coordinator.ts — 1,863 — Owns rolling evidence memory, triggers, later-window completion, truncation records, checksums, and saved-state recovery.`
- `contracts — 978 — RUNNING in the import path; defines source identities, credential-free public addresses, running/stale/retry states, transport and storage shapes, and size limits.`
- `contracts/sourceLifecycle.ts — 459 — Loaded through the live shared-rule module but not instantiated here; defines start, connected, live, stale, retry, rate-limit, failure, and stop tracking.`

RUNS NOW?: RUNNING — Current Node process `…0941` has the target as its working directory, runs built `server/dist/index.js`, and listens on `127.0.0.1:8080`. The production factory constructs the bridge, and successful managed startup is required before that listener opens. `baseline/**`, `books/**`, `capacity/**`, and `capture/**` are DEAD: test-only or compile-time shapes, meaning they describe data but execute no production code. No uncommitted files exist in the six owned source folders. Rebuilding was forbidden, so exact byte-for-byte agreement between today’s TypeScript and the existing built JavaScript remains UNKNOWN. No application interface, database, browser, or Watchdog page was touched.

MONEY?: NEEDED-BY-MONEY — The live bridge and shared rules are startup prerequisites for market intelligence, and both Basis and Volume wait for that stage. They do not calculate strategy or control money; the other four directories are outside the live engine path.

REMOVABLE?: NO — Removing the assigned block wholesale breaks live bridge/shared-rule imports and prevents Basis and Volume startup; `baseline`, `books`, `capacity`, and `capture` are individually removable only after their tests and compile-time snapshot references are removed or rewritten.

EVIDENCE: `server/src/intelligenceRuntime/snapshot/types.ts:18`; `server/src/intelligenceRuntime/bridge/bridge.ts:312`; `server/src/systemIntegration/production/factory.ts:1838`; `server/src/systemIntegration/composition/graph.ts:69`; `server/src/systemIntegration/composition/graph.ts:81`

<!-- visible task 53 -->
## server/src/intelligenceRuntime/{derivatives,focus,futures,lifecycle}/** — 8,114 lines

WHAT IT IS: This is public-market-data support around the Basis and Volume money engines. It checks dollar-margined futures facts, chooses extra feeds for closely watched symbols, safely handles incoming messages, and lets the operator stop or restart one public feed. In the live server, only the lifecycle stop/restart owner is created and connected; the larger derivatives, focus, futures, and generic connection workers are present source, not the active feed path.

SUB-PIECES:

- `derivatives/ — 1,895 — Defines and refreshes open interest, funding, trader positioning, and sampled liquidation facts.`
- `derivatives/enricher.ts — 1,102 — Plans public requests within exchange limits, keeps time-limited facts, and labels missing, old, or conflicting data.`
- `derivatives/parsers.ts — 331 — Checks exchange replies for open interest, funding, buyer-versus-seller volume, and long-versus-short positioning.`
- `derivatives/types.ts — 322 — Defines every allowed fact, status, error, request, and report shape for derivatives data.`
- `focus/ — 1,790 — Turns the list of closely watched symbols into a bounded set of extra public feeds.`
- `focus/allocator.ts — 1,079 — Assigns available connection slots, limits subscribe or unsubscribe instructions, and preserves feeds for protected symbols.`
- `focus/catalog.ts — 312 — Maps requested facts to existing feeds, new public connections, one-off public requests, or an honest unavailable state.`
- `futures/ — 1,904 — Holds strict public futures message readers and snapshots for prices, funding, contract changes, and sampled liquidations.`
- `futures/adapter.ts — 968 — Tracks four futures feeds, drops repeated or out-of-order records, and converts accepted data into common evidence.`
- `futures/decode.ts — 687 — Reads raw exchange messages within fixed limits and separates accepted, ignored, malformed, and excess records.`
- `lifecycle/ — 2,525 — Provides reconnect delays, fixed-memory queues, command limits, request limits, delay measurements, connection health, and one-feed control.`
- `lifecycle/queue.ts — 381 — Holds messages within count and byte limits and demands a fresh snapshot after losing order-sensitive data.`
- `lifecycle/sourceIsolation.ts — 510 — Records each feed stop or restart in the Ledger, refuses stale changes, and safely resumes interrupted requests.`
- `lifecycle/websocketRunner.ts — 878 — Runs an explicitly started persistent market connection with reconnects, planned rotation, buffering, delivery, and honest health states.`

RUNS NOW?: RUNNING — only `lifecycle/sourceIsolation.ts` is proved live: the server creates it with Ledger persistence and connects it to the current market engine’s Spot and futures feed controls.

MONEY?: NEEDED-BY-MONEY — that market engine supplies the rows read by both Basis and Volume, although this block does not decide trades.

REMOVABLE?: YES-BUT the server will not build until its references are changed, and the live public-feed stop/restart controls will disappear.

EVIDENCE: `server/src/intelligenceRuntime/derivatives/sources.ts:63-117`; `server/src/intelligenceRuntime/focus/catalog.ts:271-304`; `server/src/intelligenceRuntime/lifecycle/sourceIsolation.ts:372-496`; `server/src/index.ts:271-275`; `server/src/index.ts:481-488`

<!-- visible task 54 -->
## server/src/intelligenceRuntime/{routing,smoke,snapshot,spot,universe}/** — 10,040 lines

WHAT IT IS: This is the public-market fact layer in front of the Basis and Volume money engines. It checks which Binance Spot and Perpetual markets exist, turns raw public updates into bounded facts, rejects stale or broken sequences, and can build a read-only health map. It also contains a separate manual public-feed check; it holds no credentials, decides no trade, and can place no order.

SUB-PIECES:

- `routing/ — 1,883 — Live fact checker and sorter for Volume; it refuses stale, duplicate, out-of-order, or incomplete evidence.`
- `routing/volumeEvidenceRouter.ts — 1,737 — Tracks source restarts, missing message ranges, freshness, and nine evidence categories before passing facts onward.`
- `smoke/ — 1,567 — Manual no-key public-feed check; normal server startup does not run it.`
- `smoke/harness.ts — 875 — Runs listing, broad-market, one-symbol, fact-conversion, health, and clean-shutdown checks.`
- `smoke/nodeTransport.ts — 322 — Public-only request and live-stream clients restricted to a fixed list of permitted addresses.`
- `snapshot/ — 2,627 — Manual health-map builder covering sources, market coverage, blockers, warnings, and component relationships.`
- `snapshot/aggregate.ts — 1,884 — Checks and combines source state into one read-only point-in-time report.`
- `snapshot/types.ts — 508 — Defines that report’s fields and hard size limits.`
- `spot/ — 1,787 — Manual/test Spot collector that safely bounds ticker, price-book, and trade traffic.`
- `spot/reducer.ts — 1,268 — Converts public Spot updates into standard per-symbol facts and counts missing, stale, or disordered data.`
- `universe/ — 2,176 — Checks public listings and pairs Spot with Perpetual markets; its freshness and coverage checker is live.`
- `universe/adapter.ts — 998 — Public listing fetcher that respects request limits; used by the manual check, not normal startup.`
- `universe/parsers.ts — 610 — Strictly checks listing rows, trading rules, identities, permissions, duplicates, and missing data.`

RUNS NOW?: RUNNING — normal server startup constructs this block’s Volume fact sorter, then starts public intelligence as a prerequisite of both Basis and Volume. The manual smoke check, standalone Spot collector, and combined health-map builder are not started by normal boot.

MONEY?: NEEDED-BY-MONEY — public intelligence is a required prerequisite of both money engines; this block supplies evidence only and has zero authority to place an order.

REMOVABLE?: NO — removing it as one block breaks the live Volume evidence route and prevents the required public-intelligence layer from starting; manual/test pieces can be split out separately.

EVIDENCE: `server/src/intelligenceRuntime/routing/volumeEvidenceRouter.ts:819` · `server/src/systemIntegration/production/factory.ts:1844` · `server/src/systemIntegration/composition/graph.ts:72` · `server/src/systemIntegration/composition/graph.ts:84` · `server/src/index.ts:461`

<!-- visible task 55 -->
## server/src/intelligenceFoundation/{attention,contracts,evidence,features,universe}/** — 8,338 lines
WHAT IT IS: This block prepares market facts for the two money bots. It checks and timestamps raw Binance observations, builds the eligible market list, calculates recent behavior against quiet-state baselines, and decides which symbols deserve deeper watching. It neither places orders nor makes the final Basis or Volume decision.

SUB-PIECES:

- `attention/ — 1,358 — Moves symbols through the attention ladder and requests deeper data where justified.`
- `attention/planner.ts — 1,004 — Applies freshness, safety and capacity rules to move symbols up or down that ladder.`
- `contracts/ — 1,674 — Supplies the shared labels, identities, record shapes and validation rules.`
- `contracts/types.ts — 486 — Defines records for market facts, measurements, candidates, focus plans, trade explanations, outcomes and health.`
- `contracts/validation.ts — 994 — Rejects malformed, secret-bearing, future-dated, incomplete or contradictory inputs.`
- `evidence/ — 1,884 — Converts raw exchange records into checked facts carrying source, time, freshness and missing-data truth.`
- `evidence/borrowContext.ts — 318 — Converts borrow and background facts; no live supplier currently feeds these converters.`
- `evidence/common.ts — 399 — Provides shared parsing, source binding, time ordering, stable identity and freshness logic.`
- `evidence/derivatives.ts — 409 — Converts perpetual-futures mark price, funding, open-interest and liquidation records.`
- `evidence/market.ts — 341 — Converts trades, best buy/sell quotes and order-book depth.`
- `features/ — 1,480 — Retains bounded recent evidence and calculates time-window measurements and quiet-state baselines.`
- `features/bank.ts — 773 — Calculates volume, trade arrival, flow, spread, depth, spot-versus-perpetual movement, funding, open-interest and liquidation measurements.`
- `universe/ — 1,942 — Joins Spot, perpetual, margin, borrow and data-coverage facts into one eligible market map.`
- `universe/graph.ts — 1,703 — Validates and joins those facts, resolves aliases, decides focus eligibility and reports market-map changes.`

RUNS NOW?: RUNNING — ordinary server boot creates and starts this market-fact layer. Live Spot trades and perpetual-futures facts feed its market map, feature bank and attention plan; only the borrow/background converters remain unfed.

MONEY?: NEEDED-BY-MONEY — it does not decide or place trades, but both Basis and Volume explicitly depend on this market-intelligence layer before starting.

REMOVABLE?: NO — deleting it breaks the required market-intelligence component and therefore the startup path for both money bots.

EVIDENCE: `server/src/intelligenceFoundation/attention/planner.ts:787-956`; `server/src/intelligenceFoundation/features/bank.ts:188-320,456-771`; `server/src/systemIntegration/production/factory.ts:1814-1846,2075-2139,2246-2593`; `server/src/systemIntegration/composition/graph.ts:43-100`; `server/src/index.ts:311-325,394-464`

<!-- visible task 56 -->
## server/src/intelligenceFoundation/{forensics,outcomes,thesis,topology}/** — 6,141 lines

WHAT IT IS: This block explains why a previously quiet token may be waking up and checks whether the signal is a false alarm. It combines market activity, price, available buying and selling depth, funding payments, outstanding futures positions, and forced position closures into a thesis—a reasoned explanation—then contains unused code for measuring what happened later. It also contains topology, meaning a dependency map of the intelligence parts.

SUB-PIECES:

- `forensics/ — 1,352 — RUNNING: checks flagged tokens for manipulation-like churn, exhausted moves, market-wide moves, weak depth, and bad data.`
- `forensics/checks.ts — 703 — Runs ten checks and returns pass, fail, or unknown for each.`
- `outcomes/ — 1,384 — DEAD: preserves what was known when a token was flagged, later scores what happened, and groups comparable results.`
- `outcomes/attribution.ts — 340 — Measures later price movement, best and worst movement, fading, liquidity survival, depth survival, and theoretical fill feasibility.`
- `thesis/ — 1,719 — RUNNING: turns market facts into a stage and explanation, including the dead-volume-wakeup case.`
- `thesis/builder.ts — 1,104 — Builds the complete explanation packet, separating supporting, conflicting, missing, and neutral evidence.`
- `topology/ — 1,686 — DEAD: builds a bounded dependency map and reports connections, cycles, and blockers.`
- `topology/catalog.ts — 314 — Lists the intelligence components and explicitly marks them as library code that is not wired live.`
- `topology/registry.ts — 1,110 — Validates the dependency map and provides read-only searches for dependencies, cycles, and blockers.`

RUNS NOW?: RUNNING — but only partly. The running server constructs the intelligence connector and can call the thesis and false-alarm logic while evaluating a flagged token; those directories total 3,071 lines. `outcomes/` and `topology/` total 3,070 lines and are DEAD—not connected to the deployed production flow: the production caller keeps only the attention result, while the topology catalog declares itself not wired.

MONEY?: DIRECT — thesis, forensics, and outcomes implement judgement and later scoring for the dead-volume-wakeup edge. Today they are evidence-only, cannot place orders, and the current basis and volume order engines do not use their result; topology is not money logic.

REMOVABLE?: YES-BUT removing the whole block as-is breaks the server build and removes current token explanations and false-alarm screens; after its connector and dormant references are removed, current basis and volume order execution does not use it.

EVIDENCE:

- `server/src/systemIntegration/production/factory.ts:1838-1845`
- `server/src/intelligenceRuntime/bridge/bridge.ts:1185-1207`
- `server/src/systemIntegration/production/factory.ts:2643-2647`
- `server/src/intelligenceFoundation/thesis/classification.ts:206-210`
- `server/src/intelligenceFoundation/topology/catalog.ts:259-269`

<!-- visible task 15 -->
## server/src/aiOps/{adapters,contracts,identity,manifests,policy,reliability}/** — 11,045 lines

WHAT IT IS: This is the safety and future-wiring block for artificial-intelligence (AI) operations: separated worker identities, external model-service connectors, exact data formats, permitted tools, callbacks, policies, evidence records, inactive repair recipes, and isolated patch plans. The sibling Shadow A2 design—“shadow” means record and propose only, with no live effect—would take provider-neutral operational reports through normalization, incident/evidence/case handling, diagnosis, and owner handoff; it targets failures in services, streams, caches, workers, and evidence, not basis, volume, balances, or markets. Routing discrepancy: Task 15 owns none of that A2 runtime code, the separate 8,970-line `runtime/**` shard imports none of these six directories, and the order’s approximate 20,000 lines reconcile only as 11,045 + 8,970 = 20,015; this block is outside A2’s current import graph, meaning files reachable through imports. Later it could be valuable as a bounded diagnosis and repair-proposal supervisor around a working money system, after real event feeds, owners, model services, audit storage, signatures, and tool runners are connected, but it is structurally aimed away from strategy, capital, risk, and order execution.

SUB-PIECES:

- `adapters/` — 5,393 lines — Defines model-service, tool, callback, redaction, and isolated-patch boundaries that refuse work whenever required proof or wiring is missing.
- `adapters/providerGateway.ts` — 311 lines — Defines pre-stage model-service requests but returns unavailable and forbids activation.
- `adapters/strictSchema.ts` — 462 lines — Copies untrusted values into plain callback-free data and validates exact bounded shapes.
- `adapters/patchWorker.ts` — 516 lines — Builds an isolated patch proposal while denying live-tree writes, merge, push, deployment, money, credentials, and network access.
- `adapters/syntheticProviderAdapters.ts` — 561 lines — Simulates four model-service routes with no credentials, network, process starts, cost, activation, or authority.
- `adapters/syntheticToolAdapters.ts` — 569 lines — Simulates bounded web/repository results and patch proposals without filesystem writes or patch application.
- `adapters/callbacks.ts` — 663 lines — Checks test-only signed jobs and callbacks and can ask an injected duplicate guard to reserve them, but mounts no transport or live queue.
- `adapters/toolGateway.ts` — 1,178 lines — Registers 15 bounded observation, proposal, patch, test, and approval tools and only decides whether a future separate runner may receive a call.
- `contracts/` — 1,605 lines — Defines exact data formats that reject extra or missing fields, insertion requests, 120 unwired controls, and safe copying/fingerprinting helpers.
- `contracts/shared.ts` — 363 lines — Provides exact-key checks, bounded text, secret-shaped-text rejection, immutable copying, and content fingerprints.
- `contracts/schemas.ts` — 749 lines — Publishes and checks formats for identities, provider states, policies, runbooks, manifests, controls, and denial-only decisions.
- `identity/` — 526 lines — Defines four separated worker roles and their model-service access and billing matrix without credentials or inherited authority.
- `identity/identity.ts` — 526 lines — Evaluates a proposed provider or billing change for later recheck but always refuses to perform the switch.
- `manifests/` — 1,664 lines — Inventories source and missing owners, classifies risk through every dependency, and materializes unsigned inactive review fixtures.
- `manifests/artifacts.ts` — 322 lines — Records the capability map and every missing or unconnected owner required before activation.
- `manifests/classification.ts` — 379 lines — Walks dependency links and raises unknown, cyclic, sensitive, or forbidden paths into a stricter action class.
- `manifests/instances.ts` — 963 lines — Builds unsigned reliability targets, runbooks, test examples, and authority maps while every effect and network flag remains false.
- `policy/` — 1,214 lines — Defines permanent trading and safety denials, signed-policy verification, and append-only decision-record designs.
- `policy/policy.ts` — 1,070 lines — Checks exact policy contents, signatures, behavior tests, prior good state, and denial records, then still refuses activation or durable-storage claims.
- `reliability/` — 643 lines — Defines measurable evidence thresholds and owner-signature gates for future reversible, non-capital repairs.
- `reliability/runbooks.ts` — 643 lines — Proposes but cannot run reconnect, resubscribe, resnapshot, cache, worker, diagnostic, reconciliation, and observation-repair recipes; every recipe remains unsigned and inactive.

RUNS NOW?: DEAD (not mounted) — A read-only host check found the live target running `node server/dist/index.js`, while static scans of `server/src` and `server/dist` outside `aiOps/**` found zero AI-Ops references; repository truth also says not configured/not mounted at `STATE.md:29`. Compiled files exist, but build presence is not live reachability. It watches nothing live and today can send no alert, call no external model, execute no tool, append no durable audit record, apply no patch, change no control, or issue any trading command. The owned directories contain no uncommitted or untracked files.

MONEY?: NO — No basis/volume module or live money path imports this block; money and production authority are explicitly absent, and order/funds actions are permanently denied.

REMOVABLE?: YES-BUT — Removing it would not change today’s live basis/volume process because it is unreachable, but it would break AI-Ops source verification and remove the staged safety boundary intended for future operations automation.

EVIDENCE: `STATE.md:29`; `server/src/aiOps/runtime/eventIntake.ts:5`; `server/src/aiOps/manifests/artifacts.ts:192`; `server/src/aiOps/policy/authority.ts:54`; `server/src/aiOps/reliability/runbooks.ts:615`

<!-- visible task 16 -->
## server/src/aiOps/runtime/** — 8,970 lines

WHAT IT IS: This is a test-only “shadow” artificial-intelligence operations case engine: it turns externally supplied service events into bounded incident cases, evidence bundles, diagnoses, retries, budgets, and owner-handoff records. It watches nothing by itself; if another owner feeds it data, it can classify component, resource, and incident events and re-check supplied logs, market records, news, exchange records, issues, page text, or documents—the page label is not a page reader. Today it cannot command anything live: its closed instructions only collect evidence, diagnose, record, quarantine, retry, review, run a synthetic test, do nothing, or prepare owner handoff; its sole outside write seam is an unmounted test-only adapter to the existing durable event store. Later, it is fit as an incident-response assistant around trading, but it is structurally aimed at diagnosing software trouble and preparing owner-reviewed work—not deciding Basis/Volume trades or moving money.

SUB-PIECES:

- `caseState.ts — 1,824 — Holds the allowed case-step sequence, duplicate-command protection, proof gates, retry and planned-action receipts, recovery, and serialization.`
- `persistence.ts — 1,174 — Packages cases for long-lived storage, bounds queues, records retries, parks failed records, and offers the optional existing-ledger adapter.`
- `budget.ts — 1,061 — Caps model calls, tools, searches, tokens, cost, latency, and time while calculating model-service and rate availability without calling or reserving a provider.`
- `context.ts — 935 — Creates and verifies test-only signed context, fresh-worker handoffs, and one-use consumption receipts with explicit no-money denials.`
- `diagnostic.ts — 893 — Converts owner-validated evidence into facts, hypotheses, diagnosis records, and evidence-bound next-worker handoffs.`
- `incident.ts — 822 — Redacts and normalizes events, grades urgency and required analysis depth, and collapses duplicates and alert floods.`
- `evidence.ts — 615 — Builds bounded secret-redacted evidence bundles, re-checks them through owner callbacks, and permits proposals only—not actions.`
- `types.ts — 570 — Defines every shadow event, case, proof, budget, storage, context, and handoff record shape.`
- `escalation.ts — 461 — Checks whether an owner handoff is ready but never sends, queues, approves, or executes it.`
- `eventIntake.ts — 414 — Converts one vendor-independent event into a normalized observation or quarantine receipt while owning no transport. `

Recount: 8,769 listed lines plus `support.ts` 191 and `index.ts` 10 equals 8,970 lines across 12 files. Routing discrepancy: the parent order names two AI-Ops chats but does not state their boundary; this delegation assigns 8,970 runtime lines here and leaves 11,045 non-runtime lines from the measured 20,015-line AI-Ops total to the other chat. No owned file overlaps or escapes this boundary.

RUNS NOW?: DEAD — not mounted. Read-only process evidence showed the live `:8080` listener is `node server/dist/index.js`; the source entry, built entry, and all server source outside this directory contain zero Shadow A2 references. The actual boot composes the System Integration runtime map without AI-Ops. The owned path has no uncommitted files. No tests, routes, databases, private services, exchanges, or pages were called; Watchdog was untouched.

MONEY?: NO. It contains neither Basis nor Volume strategy logic, and neither running engine imports or calls it. Generic market/exchange evidence labels do not acquire market data or grant trading authority.

REMOVABLE?: YES-BUT the Shadow A2 tests, proof lane, and future incident-automation scaffold would break or disappear; deployed Basis and Volume behavior would not change.

EVIDENCE: [server/src/aiOps/runtime/types.ts:37-57](/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/aiOps/runtime/types.ts:37); [server/src/aiOps/runtime/eventIntake.ts:1-6](/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/aiOps/runtime/eventIntake.ts:1); [server/src/aiOps/runtime/support.ts:33-48](/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/aiOps/runtime/support.ts:33); [server/src/aiOps/runtime/escalation.ts:55-88](/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/aiOps/runtime/escalation.ts:55); [server/src/index.ts:394-403](/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/index.ts:394)

<!-- visible task 105 -->
## server/src/foundation/execution/{spot*,m0Spot*}.ts (11 files) — 9,200 lines

WHAT IT IS: This is the safety and bookkeeping layer for M0, the small owner-approved Binance Spot trial order; it is not Basis or Volume strategy logic. It creates stable order identities, checks exchange rules, risk and one-use owner permission, tracks buying/filling/cancelling, and sells any exact remainder to return to zero position. Unclear order results must be read back before any further action.

SUB-PIECES:

- `spotTransportCoordinator.ts — 3,707 lines — Defines the bounded trial sequence: no-order test, buy, read/cancel, remainder sale, saved evidence and zero-position proof, without blindly repeating an uncertain money action.`
- `spotCore.ts — 1,332 lines — Checks exchange rules, risk limits, readiness, test evidence and owner permission before returning an order instruction.`
- `m0SpotLifecycleCard.ts — 1,003 lines — Locks one owner, account, symbol, 10 USDT ceiling, time window and action limits into a verifiable card with one-use permissions.`
- `spotValidateOnly.ts — 801 lines — Performs local rules and risk validation from public evidence but cannot sign, send, query or cancel an order.`
- `spotLifecycle.ts — 784 lines — Replays preparation, submission, fill, cancellation and remainder-sale facts, rejecting missing or conflicting history.`
- `m0SpotTestOrderAuthority.ts — 518 lines — Validates an expiring one-use permission and its saved consumption receipt for a Binance test request that creates no order.`
- `spotTicket.ts — 305 lines — Builds an immutable order description that reproduces the same identity after restart and rejects altered copies.`

RUNS NOW?: DEAD — only an inspection/readiness shell is mounted; execution reports source disabled, kill switch on, no allowed symbols, no order-sending component and zero effects.

MONEY?: NO — it is neither Basis nor Volume decision logic, and neither current bot calls it; this is a separate dormant Spot trial-order path.

REMOVABLE?: YES-BUT the M0 route and dormant exchange connector, order sender and saved-recording code that import these contracts must be removed with it or the server build breaks; Basis and Volume remain intact.

EVIDENCE: `package.json:16` · `server/src/index.ts:271-282` · `server/src/index.ts:1618-1626` · `server/src/foundation/execution/m0SpotSourceMount.ts:203-217` · `server/src/systemIntegration/production/m0SpotRuntimeBoundary.ts:1435-1445`

<!-- visible task 106 -->
## server/src/foundation/execution/** excluding spot* and m0* — 8,549 lines

WHAT IT IS: This is the safety controller for a two-leg Basis trade. It builds a fixed spot/perpetual plan, checks approval and freshness, records every state change, restores saved state, and recommends recovery when an outcome is uncertain. Production uses it only in `VALIDATE_ONLY` (check-only) mode; it cannot place orders.

SUB-PIECES:

- `basisValidateOnly/ — 3,130 lines` — Unmounted, test-only proof tools for binding a synthetic Basis handoff and proving both legs returned to their starting positions.
- `basisValidateOnly/planBinding.ts — 1,740 lines` — Rebuilds Capital’s decision from frozen synthetic evidence and binds it to a fixed, non-fireable four-step plan.
- `basisValidateOnly/basisFlatness.ts — 1,390 lines` — Reports flat only when complete order and position evidence proves spot and perpetual returned to the bound starting balances.
- `coordinator.ts — 2,252 lines` — Runs approval, freshness checks, leg validation, deadlines, strict leg order, lost-response lookup, closing, restart recovery, and final matching.
- `reducer.ts — 1,301 lines` — Converts ordered events into plan and leg state while rejecting gaps, duplicates with changed content, and impossible transitions.
- `types.ts — 597 lines` — Defines the plan, event, saved-state, recovery, and normal-Basis safety contracts.
- `checkpoint.ts — 485 lines` — Saves state with a tamper check and restores it only after replay reproduces the same result.
- `plan.ts — 470 lines` — Deterministically creates plan, leg, close-attempt, and order identities from exact proposal terms.

RUNS NOW?: RUNNING — the deployed server source mounts an authenticated check-only route that creates this coordinator on demand. It stops after validation; reaching an order-submission path is explicitly blocked. The `basisValidateOnly/` subdirectory is test-only. No tests were run now.

MONEY?: NEEDED-BY-MONEY — it is not the Basis signal engine, but it is the guarded planning and recovery layer between an accepted Basis decision and any future two-leg executor.

REMOVABLE?: YES-BUT removing it as-is breaks the server build and mounted check-only route; after deliberate unwiring, Basis and Volume scanning can continue, but two-leg validation, saved-state recovery, and execution safety evidence disappear.

EVIDENCE: `server/src/index.ts:1618`; `server/src/systemIntegration/verticalSlice/orchestrator.ts:1050`; `server/src/foundation/execution/coordinator.ts:672`; `server/src/foundation/execution/basisValidateOnly/planBinding.ts:4`; `server/src/foundation/execution/basisValidateOnly/basisFlatness.ts:992`

<!-- visible task 107 -->
## server/src/foundation/exchange/** — 7,928 lines

WHAT IT IS: This block is the exchange rulebook between Cosmos and Binance Spot plus Binance dollar-margined futures. Its live 1,615-line Spot part performs exact money arithmetic, checks price, quantity, and total-order-value rules, and creates the same order identity after an uncertain retry. The other 6,313 lines are default-off or explicitly dormant futures readers and check-without-sending basis helpers; they have no live-order power themselves.

SUB-PIECES:

- `binanceUsdM/` — 3,253 — Dormant futures reader and test-order boundary requiring a caller-supplied clock, signer, and network connection.
- `binanceUsdM/validation.ts` — 1,348 — Checks futures orders against exchange rules and validates supplied public filter and funding records.
- `binanceUsdM/client.ts` — 754 — Prepares public reads, signed account/order reads, and no-fill test-order requests with rate-limit handling.
- `binanceUsdM/parsers.ts` — 508 — Rejects malformed exchange replies and converts supported market, funding, account, position, order, and trade fields.
- `binanceUsdM/types.ts` — 420 — Defines the allowed endpoints and data shapes used by the dormant futures client.
- `binanceSpotValidateOnlyAdapter/` — 1,318 — Default-off Spot basis checker that turns supplied public facts into order and lookup descriptions without sending.
- `binanceSpotValidateOnlyAdapter/index.ts` — 1,318 — Checks freshness, symbols, exchange rules, and repeat-stable order identity while retaining no send power.
- `binanceUsdMAdapter/` — 1,742 — Default-off futures half of basis preparation that checks supplied evidence and emits descriptions only.
- `binanceUsdMAdapter/adapter.ts` — 1,401 — Checks freshness, position mode, exchange limits, and supplied order-lookup results.
- `binanceUsdMAdapter/types.ts` — 339 — Defines futures basis inputs, outputs, and blocking reasons.
- `binanceSpot/` — 1,615 — Live exact-decimal, Spot-order-rule, and repeat-stable order-identity utilities.
- `binanceSpot/filters.ts` — 1,571 — Checks prices, quantities, increments, total values, and reference-price limits without floating-point arithmetic.

RUNS NOW?: RUNNING — the deployed built entry mounts the Spot runtime, which imports and calls this block’s Spot arithmetic. Only `binanceSpot/` is in that live path; the other 6,313 lines are DEAD because no current runner imports them and their own posture is dormant or default-off.

MONEY?: NEEDED-BY-MONEY — the live Spot rules guard the Spot half of money execution; this block checks whether an order fits exchange rules, not whether a basis or volume opportunity is attractive.

REMOVABLE?: NO — deleting the whole block breaks the mounted Spot runtime; the 6,313 dormant lines are separable trim candidates.

EVIDENCE:

- `server/dist/index.js:1343`
- `server/dist/systemIntegration/production/m0SpotRuntimeBoundary.js:11`
- `server/src/foundation/exchange/binanceSpotValidateOnlyAdapter/index.ts:32`
- `server/src/foundation/exchange/binanceUsdM/index.ts:2`
- `server/src/foundation/exchange/binanceUsdMAdapter/adapter.ts:143`

<!-- visible task 57 -->
## server/src/foundation/risk/** + server/src/foundation/borrow/** + server/src/foundation/calibration/** — 7,712 lines

WHAT IT IS: This is the safety-and-evidence layer around the Basis and Volume money engines. Risk decides whether linked orders may proceed; borrow turns already-read margin-account facts into a current answer for reverse Basis—the version that borrows and sells spot while buying a no-expiry futures contract; calibration checks whether stated odds matched later results. It finds no trade, contacts no exchange, and places no order.

SUB-PIECES:

- `risk/ — 4,919 lines` — Owns the final trade-safety contracts and decisions for linked orders and the tiny Spot trial.
- `risk/checks.ts — 2,762 lines` — Checks the kill switch, approval, fresh prices, size, hedge, liquidity, margin, borrow, loss limits, duplicate orders, and cooldown.
- `risk/types.ts — 806 lines` — Defines the complete unchangeable input snapshot and rejects malformed plans or limit policies.
- `risk/spotRiskPolicy.ts — 651 lines` — Enforces the tiny Spot lifecycle and its ceiling of 10 units of the currency pricing the order.
- `risk/evaluator.ts — 639 lines` — Combines all checks into one allow-or-block verdict and binds an approved normal-Basis entry to its exact evidence.
- `borrow/ — 1,675 lines` — Converts private margin-account facts into an expiring borrow answer and rechecks it before capital use.
- `borrow/derive.ts — 782 lines` — Decides AVAILABLE or a named blocker from account mode, permissions, maximum borrow, interest rate, existing debt, freshness, and identity.
- `borrow/validate.ts — 622 lines` — Rechecks the borrow record, private source, completeness, expiry, and tamper-check code so a fabricated AVAILABLE answer cannot pass.
- `calibration/ — 1,118 lines` — Records whether old Basis or Volume proposals were right and profitable, without power to alter either strategy.
- `calibration/aggregate.ts — 469 lines` — Groups only matching outcomes and calculates success, missed odds, costs, and fills.
- `calibration/record.ts — 423 lines` — Creates tamper-checked outcome records and requires net result to equal gross result minus every supplied cost.

RUNS NOW?: RUNNING — the mounted `/api/system-integration/validate-only` route calls `evaluateMultiLegRisk`; this checks without placing orders. Private borrow is explicitly not mounted in this build, and calibration is not live because boot supplies an unavailable performance-measurement reader.

MONEY?: NEEDED-BY-MONEY — it does not generate Basis or Volume trades, but their capital path needs its final safety decision and reverse-Basis borrow proof; calibration supplies later performance truth.

REMOVABLE?: NO — the mounted risk files are required by validation and Spot limits; `borrow/` and `calibration/` are dormant today but must be assessed as separate trims.

EVIDENCE: `server/src/foundation/risk/evaluator.ts:223`; `server/src/systemIntegration/verticalSlice/orchestrator.ts:948`; `server/src/index.ts:1618`; `server/src/index.ts:3787`; `server/src/index.ts:267`

<!-- visible task 58 -->
## server/src/foundation/contracts/** + server/src/foundation/control/** — 4,497 lines

WHAT IT IS: The contracts folder is the shared rulebook for identifiers, timestamps, failures, opportunities, risk decisions, order states, and safe troubleshooting records. The control folder coordinates validation, startup, pausing, restarting, stopping, and health checks, with prerequisites started first. It does not choose trades or directly place orders.

SUB-PIECES:

- `server/src/foundation/contracts/ — 2,356 — Shared names and checks used across execution, risk, basis, volume, reconciliation, and monitoring.`
- `server/src/foundation/contracts/diagnostics.ts — 329 — Rejects secrets or malformed data before making an unchangeable troubleshooting record.`
- `server/src/foundation/control/ — 2,141 — Coordinates server components through safety checks and owner commands.`
- `server/src/foundation/control/supervisor.ts — 1,753 — Runs each command step, reverses failed starts, checks health, and keeps capped failure and state-change histories.`

RUNS NOW?: RUNNING — The server creates this coordinator and issues START during server startup; basis and volume also call the shared contract rules. Comments inside `control/` calling it dormant are outdated.

MONEY?: NEEDED-BY-MONEY — It supplies shared safety rules and controls the running basis and volume engines, but contains neither strategy’s trade-selection logic.

REMOVABLE?: NO — Removing the whole block breaks server coordination and both money engines.

EVIDENCE: `server/src/foundation/contracts/index.ts:10` · `server/src/engine/basis/config.ts:240` · `server/src/engine/volume/config.ts:170` · `server/src/systemIntegration/composition/managedComposition.ts:110` · `server/src/index.ts:463`

<!-- visible task 19 -->
## /Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/foundation/{observability,readModel,reconciliation,replay,scenarios}/** and Foundation root files — 9,193 lines

WHAT IT IS: This block turns Basis and Volume output into one shared read record, compares intended execution with observed facts, and contains diagnostics, recorded-event replay, and test-scenario machinery. It produces views, warnings, and recommendations; it cannot place orders or write private exchange/account data. The current-disk recount is 9,193 TypeScript lines including comments and blanks, with zero Foundation-root files and no owned Git changes or untracked files. **Routing discrepancy:** the governing order assigns Foundation “rest” to the third task, but this delegation excludes `borrow/`, `calibration/`, `contracts/`, `control/`, and `risk/`—another **12,209 lines** that are unassigned unless Tasks 17–18 explicitly took them.

SUB-PIECES:

- `foundation root files` — 0 lines — No directly owned files exist at the Foundation root.
- `observability/` — 1,460 lines — Mixed: live code imports some status types, but the diagnostic calculator is not called.
- `observability/derive.ts` — 1,191 lines — DEAD; converts supplied evidence into freshness, rates, and health labels without registering background work.
- `readModel/` — 1,814 lines — RUNNING; supplies the live Basis-and-Volume opportunity readout.
- `readModel/canonicalize.ts` — 741 lines — Converts decisions and proposals into stable plain records and rejects invalid values.
- `readModel/ports.ts` — 472 lines — Validates bounded, read-only snapshot inputs.
- `readModel/readModel.ts` — 580 lines — Merges both strategy sources, removes duplicates, and rejects missing or inconsistent records.
- `reconciliation/` — 2,527 lines — RUNNING in validation and recovery paths only; it has no exchange-action authority.
- `reconciliation/engine.ts` — 898 lines — Compares expected orders, fills, and positions with observations and returns data-only recovery advice.
- `reconciliation/normalize.ts` — 518 lines — Safely copies, deduplicates, orders, and validates observed facts.
- `reconciliation/spotLedgerBridge.ts` — 590 lines — Loaded by Spot core; builds proposed ledger records and discrepancy reports but writes nothing itself.
- `replay/` — 2,499 lines — DEAD in the current process; reruns recorded events for offline analysis and tests.
- `replay/envelope.ts` — 662 lines — Serializes and checks recorded-event bundles; its checksum detects corruption but is not identity proof.
- `replay/guard.ts` — 451 lines — Rejects secret-looking or private values and enforces size limits.
- `replay/capture.ts` — 356 lines — Buffers bounded events and packages them after a trigger.
- `scenarios/` — 893 lines — DEAD; contains synthetic test facts with no live authority.
- `scenarios/generator.ts` — 633 lines — Produces 14 repeatable test stories and checks that they are safe for replay.

RUNS NOW?: **RUNNING** — process identifier `…0941` is listening on `127.0.0.1:8080` from this deployed tree. The live opportunity read is mounted at `server/src/index.ts:1615`, builds the shared record at `server/src/systemIntegration/adapters/engineCapture.ts:822`, and the validation path calls reconciliation at `server/src/systemIntegration/verticalSlice/orchestrator.ts:1144`. Static tracing from the compiled server entry reached 10 owned modules; diagnostic derivation, restart recovery, replay, and scenarios were not reached. No endpoint or Watchdog page was touched.

MONEY?: **NEEDED-BY-MONEY** — it does not create profit or place orders, but the running read model presents strategy-owner truth and reconciliation blocks mismatched state before validation or recovery.

REMOVABLE?: **NO** — deleting the block would break the live opportunity read and validation/recovery wiring. The dead diagnostic, replay, and scenario pieces could leave the running process only if their source and test consumers were retired together.

EVIDENCE:

- [CODEX_BLOCK_AUDIT_ORDER.md:48](/Users/cosmosgeek/Desktop/CODEX_BLOCK_AUDIT_ORDER.md:48)
- [server/src/index.ts:1615](/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/index.ts:1615)
- [server/src/systemIntegration/adapters/engineCapture.ts:822](/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/systemIntegration/adapters/engineCapture.ts:822)
- [server/src/systemIntegration/verticalSlice/orchestrator.ts:1144](/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/systemIntegration/verticalSlice/orchestrator.ts:1144)
- [server/src/foundation/observability/index.ts:2](/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/foundation/observability/index.ts:2)

<!-- visible task 59 -->
## server/src/capitalFoundation/accountTruth/** + actions/** + allocation/** + approvals/** + budgets/** + contracts/** + root files — 7,053 lines

WHAT IT IS: This is the capital-safety layer between account facts and a possible trade. It turns stored balances, debts, reserved money, and open positions into a cautious spendable amount; applies whole-account limits; checks operator approvals; and produces economic next-step instructions. It never places an order: separate risk and execution code must approve and carry out anything that moves money.

SUB-PIECES:

- `accountTruth/ — 1,090 — Turns balances, debts, holds, commitments, valuations, and borrowing limits into a cautious usable-capital answer.`
- `accountTruth/project.ts — 788 — Performs that calculation and blocks new exposure when facts are stale, missing, contradictory, or cannot be valued.`
- `actions/ — 538 — Defines economic next moves for an existing position without turning them into exchange orders.`
- `actions/planner.ts — 408 — Produces hold, add, reduce, hedge, exit, freeze, or unknown instructions and requires current authority for an increase.`
- `allocation/ — 1,906 — Decides how much money an unopened opportunity may receive and tracks the resulting reservation.`
- `allocation/allocator.ts — 681 — Caps requests against account, strategy, symbol, collateral, margin, borrowing, liquidity, plan-count, and position-count limits; it currently rejects VOLUME capital authority.`
- `allocation/reservations.ts — 740 — Tracks reserve, consume, renew, release, expiry, and final closed-position release without exchange calls.`
- `allocation/strategyDecay.ts — 309 — Uses worsening strategy-measurement quality to allow, halve, block, or retire new allocation.`
- `approvals/ — 665 — Records an operator approval and checks its time, scope, maximum size, use history, and revocation.`
- `approvals/validation.ts — 419 — Rejects expired, revoked, out-of-scope, over-limit, or control-blocked approvals and never declares them ready to execute.`
- `budgets/ — 765 — Builds and checks the whole-account limit snapshot that allocation must obey.`
- `budgets/validate.ts — 364 — Refuses stale account facts, incomplete commitment coverage, double-counted claims, malformed limits, or current limit breaches.`
- `contracts/ — 2,074 — Supplies shared rules for money numbers stored as base-10 text so rounding cannot silently change them, plus names, freshness, approvals, and allowed state changes.`
- `contracts/conservativeEconomics.ts — 384 — Ensures funding, borrowing, and cost-of-tied-up-money facts match the named owner, exact trade scope, and fresh evidence.`

RUNS NOW?: RUNNING — the deployed entry imports this shard’s money-number helpers and uses them in the live system-size control. The wider shard is supporting safety logic; its approval result is explicitly never ready to execute.

MONEY?: NEEDED-BY-MONEY — both the BASIS gap bot and VOLUME pump-prediction bot import the exact-money helpers. This shard protects their limits; it does not find the price gap or pump signal.

REMOVABLE?: NO — removing it breaks the live server’s size control and both money runtimes at build or start, while also removing capital and approval checks.

EVIDENCE:

- `server/src/index.ts:196`
- `server/src/services/basisRuntime.ts:20`
- `server/src/services/volumeRuntime.ts:37`
- `server/src/capitalFoundation/allocation/allocator.ts:331`
- `server/src/capitalFoundation/approvals/validation.ts:414`

<!-- visible task 60 -->
## server/src/capitalFoundation/{checkpoint,economics,opportunities,positions,scenarios,stages,supervision,topology}/** — 8,858 lines

WHAT IT IS: This is a dormant capital-control design for the two money strategies, spread across 29 code files. It turns basis and volume proposals into candidates, checks whether they deserve capital, adds money in controlled steps, watches open positions, totals profit or loss without double-counting, and defines a saved restart snapshot. It also builds a linked map showing which missing or conflicting fact blocks an exposed position.

SUB-PIECES:

- `checkpoint/ — 1,406 — Defines the saved restart snapshot and the rules for rebuilding it from an ordered history.`
- `checkpoint/projector.ts — 1,094 — Replays records, verifies the snapshot, and marks exposed positions unsafe when restart facts disagree.`
- `economics/ — 1,394 — Defines how trading returns and costs are combined and divided into owner-readable views.`
- `economics/compose.ts — 537 — Combines price movement, funding, borrowing, fees, spread, slippage, recovery costs, and unexplained remainder without double-counting.`
- `economics/segmentation.ts — 714 — Groups closed results by nine views including strategy, market condition, symbol class, confidence, entry step, holding period, reason, execution path, and model version.`
- `opportunities/ — 844 — Defines the eligible, blocked, or advisory gate for basis and volume candidates.`
- `opportunities/eligibility.ts — 758 — Checks proposal freshness, evidence, costs, configuration, and competing claims; basis can qualify while volume remains advisory or validation-only.`
- `positions/ — 509 — Defines one current position from its legs—the separate holdings or orders making it up—and exchange-matching facts.`
- `positions/projection.ts — 428 — Totals long and short exposure, checks internal records against exchange records, and marks uncertain positions for recovery.`
- `scenarios/ — 1,080 — Defines safe translations from engine proposals and market facts into capital inputs.`
- `scenarios/proposalCompatibility.ts — 687 — Copies basis and volume proposals into the capital format, rejects identity mismatches, and deliberately omits untrusted financial numbers.`
- `stages/ — 1,047 — Defines plans that add or remove money in steps and the authorization record governing each plan.`
- `stages/policy.ts — 865 — Builds and revises plans, checks exposure and evidence limits, validates approval, and decides whether the next step is allowed.`
- `supervision/ — 1,597 — Defines common, basis, and volume watches that recommend hold, add, hedge, reduce, exit, or emergency close.`
- `supervision/common.ts — 805 — Checks source freshness, hedge balance, one-sided exposure, market depth, exit capacity, and costs before producing an action recommendation.`
- `topology/ — 981 — Defines the linked map from proposal through capital approval, position, supervision, accounting, and restart record.`
- `topology/projector.ts — 822 — Builds that map, carries blocking causes forward, and identifies exposed positions requiring owner attention.`

RUNS NOW?: DEAD (not mounted; two partial links are switched off) — No owned decision function is called by the live server. The production opportunity path starts without its required economics suppliers and returns `NOT_CONFIGURED` (not set up), while the profit-and-loss link sits behind an explicitly unavailable worsening-results measurement supplier.

MONEY?: DIRECT — It contains basis and volume selection, staged-exposure, and position-supervision rules, although they are off today.

REMOVABLE?: YES-BUT remove the outside source files that still name this block in the same change, or the server will fail to build or start; current trading behavior would remain unchanged.

EVIDENCE: `server/src/capitalFoundation/index.ts:1-15`; `server/src/index.ts:267-275`; `server/src/index.ts:311-325`; `server/src/systemIntegration/production/factory.ts:3061-3064`; `server/src/systemIntegration/production/capitalEconomics.ts:221-228`.

<!-- visible task 21 -->
## server/src/engine/basis/** + v0/** + decay/** + engine root files — 12,000 lines

WHAT IT IS: This is the running public-market brain for basis: the price gap between spot and perpetual futures. Every 1.5 seconds it compares executable buy/sell prices in both directions, checks fees, funding, borrowing, liquidity, freshness, and slippage—price loss caused by order size—and ranks surviving signals. It tracks whether the gap is widening or closing, but trend only affects ranking and proposal evidence; it does not scale in, book a close, or place orders. The shared market feed, common data shapes, and strategy-worsening guard also support volume; that guard runs daily but has no production performance reader, so it records UNKNOWN/hold.

SUB-PIECES:

- `basis/ — 7,058 —` Live basis measurement, ranking, lifecycle, and proposal logic, plus dormant public-evidence helpers.
- `basis/engine.ts — 525 —` Live conductor joining market state, calculations, scanning, lifecycle, and proposals; its furthest output is suggested two-leg order details.
- `basis/gapTracker.ts — 462 —` Tracks gap age, persistence, widening or closing, and which market initiated the move.
- `basis/lifecycle.ts — 725 —` Manages watching, focus, proposals, rejection, and cooldown; its accepted-proposal handoff is explicitly off.
- `basis/marketState.ts — 667 —` Holds bounded market observations and rejects stale, malformed, replayed, or out-of-order prices.
- `basis/proposals.ts — 509 —` Creates, refreshes, accepts, and expires proposals; staged sizes are descriptions, not actions.
- `basis/publicOpportunityObservation.ts — 941 —` Dormant NOT_CONFIGURED record format for public-only opportunity estimates, explicitly not executed profit.
- `basis/rolling24hEdgeStatistic.ts — 668 —` Dormant 24-hour estimate reader over those public records; no live source caller exists.
- `basis/scanner.ts — 335 —` Live filter requiring fresh books, funding, sufficient size, stable persistence, and positive net edge.
- `basis/types.ts — 362 —` Defines the basis data shapes shared by the live components.
- `v0/ — 421 —` Shared clock, defaults, events, decisions, proposals, and scanner data shapes used by basis and volume.
- `v0/types.ts — 313 —` Defines that shared engine vocabulary; it is support code rather than an independent scanner.
- `decay/ — 2,875 —` Shared daily guard intended to reduce or retire strategies whose measured performance worsens.
- `decay/coordinator.ts — 320 —` Runs the daily check from existing engine ticks; production injects an unavailable performance reader.
- `decay/governance.ts — 1,033 —` Converts UNKNOWN, stable, degraded, or dead measurements into hold, reduce, disable, or retire decisions; UNKNOWN preserves the current posture.
- `decay/ledger.ts — 422 —` Saves version-checked decay history so competing writers cannot silently overwrite each other.
- `decay/measurement.ts — 892 —` Can compare prediction error, closed profit, and rival crowding across time windows, but its calculation function has no live caller.
- `engine root files — 1,646 —` Contains the live shared market feed and market-row projection plus the retired old scanner.
- `marketData.ts — 1,223 —` Runs public market streams and maintains the universe, spot prices, perpetual marks, funding, open interest, and liquidation observations.
- `scanner.ts — 323 —` Old basis proposal scanner; the deployed entrypoint labels its compatibility state RETIRED and nothing imports the class.

Routing discrepancy: governing row 21 names only `basis + v0`, which measure 7,479 lines—not approximately 12,000. This task’s added `decay + engine root` ownership contributes 4,521 lines and brings the total to exactly 12,000; the written row is therefore 37.7% short without the delegated additions. No owned path showed uncommitted status.

RUNS NOW?: RUNNING — safe process evidence showed `node server/dist/index.js` rooted in this tree listening on `127.0.0.1:8080`; the deployed bundle constructs this market engine, decay coordinator, and basis runtime, and the managed graph calls its start function. Current feed freshness and the database-backed allowed-symbol list remain UNKNOWN because API and database reads were forbidden, so this audit proves the measurement loop is mounted—not that it presently emits eligible proposals.

MONEY?: DIRECT — `basis/` is the actual basis signal logic; the root market feed, `v0` shared shapes, and decay guard are NEEDED-BY-MONEY support. This block measures and proposes but does not move money.

REMOVABLE?: NO — removing the whole block stops basis measurement and removes shared market support used by volume; only the explicitly dormant public-observation/24-hour helpers and retired root scanner are trim candidates.

EVIDENCE: `server/dist/index.js:90-130` · `server/dist/systemIntegration/composition/graph.js:62-69` · `server/src/services/basisRuntime.ts:342-347,434-534` · `server/src/engine/basis/engine.ts:305-470` · `server/src/engine/basis/lifecycle.ts:542-577`

<!-- visible task 22 -->
## server/src/engine/volume/** (live scanner, excluding forwardMeasurement*) — 5,075 lines

WHAT IT IS: This is the running volume wake-up brain. It consumes public combined-trade messages and current best buy/sell prices, learns each token’s normal activity, detects unusual rises, focuses attention, and produces candidates. It does not place orders; its manual order request still needs separate safety approval. Routing recount: 5,075 scanner lines plus 6,077 forward-measurement lines equals 11,152 owned lines, matching the order’s approximate 11.2k route with no discrepancy.

SUB-PIECES: `proposals.ts — 1,159 — Keeps fixed-size candidate records, expires stale ones, attaches separate safety decisions, and can form the manual order request.` · `engine.ts — 665 — Coordinates market measurements, detection, focused watching, proposals, controls, and event records during each scheduled scan.` · `focus.ts — 559 — Chooses which tokens receive close attention, protecting pinned tokens and tokens with open positions or orders while managing temporary ignore periods.`

RUNS NOW?: RUNNING — the live Node process runs `server/dist/index.js` from this deployed tree on local-only port 8080. The built startup map launches the volume service, which owns public trade streams and repeatedly calls the detector.

MONEY?: DIRECT — this is the owner’s quiet-token volume detection and proposal logic.

REMOVABLE?: NO — removing it removes the volume edge and breaks the mounted volume service.

EVIDENCE: [`server/dist/index.js:130`](/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/dist/index.js:130) · [`server/dist/systemIntegration/composition/graph.js:81`](/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/dist/systemIntegration/composition/graph.js:81) · [`server/src/services/volumeRuntime.ts:968`](/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/services/volumeRuntime.ts:968) · [`server/src/engine/volume/engine.ts:455`](/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/engine/volume/engine.ts:455) · [`server/src/engine/volume/engine.ts:495`](/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/engine/volume/engine.ts:495)

## server/src/engine/volume/forwardMeasurement*.ts — 6,077 lines

WHAT IT IS: This is a dormant measurement recorder, not the live scanner. If deliberately armed, it would take timestamped copies of detector results and public market data, connect them with digital fingerprints that expose later changes, run a scheduled measurement window, and finalize and verify the record. “Shadow-only” means it may observe and record but has no authority to act on money.

SUB-PIECES: `forwardMeasurementEvidence.ts — 3,628 — Defines how the public-data record is started, extended, finalized, converted to text, read back, and checked for alteration.` · `forwardMeasurementRunner.ts — 1,123 — Turns accepted detector copies into scheduled records and resumable progress checkpoints.` · `forwardMeasurementScheduler.ts — 951 — Controls timers and recording states only when an explicit activation and recorder are supplied; otherwise it stays OFF.` · `forwardMeasurementDetectorSource.ts — 375 — Converts live detector evaluations into an account-free record of decisions and candidate proposals.`

RUNS NOW?: DEAD (switched off) — the four built modules are loaded because running files refer to them, but the deployed constructor supplies neither an activation nor a recorder. Missing activation becomes `captureEnabled: false`, so no scheduler is created; the recorder also hard-codes shadow-only, record-only, zero-order authority.

MONEY?: NEEDED-BY-MONEY — only because the current live server loads these files while starting; their behavior is inactive measurement support, not active money logic.

REMOVABLE?: YES-BUT remove their imports and dormant calls from `engine.ts` and `volumeRuntime.ts` at the same time; deleting only the four files breaks build and startup.

EVIDENCE: [`server/dist/index.js:130`](/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/dist/index.js:130) · [`server/src/services/volumeRuntime.ts:103`](/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/services/volumeRuntime.ts:103) · [`server/src/engine/volume/forwardMeasurementScheduler.ts:143`](/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/engine/volume/forwardMeasurementScheduler.ts:143) · [`server/src/services/volumeRuntime.ts:341`](/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/services/volumeRuntime.ts:341) · [`server/src/engine/volume/forwardMeasurementRunner.ts:24`](/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/engine/volume/forwardMeasurementRunner.ts:24)

<!-- visible task 61 -->
## server/src/services/{basisRuntime.ts,volumeRuntime.ts,orders.ts,risk.ts,account.ts,privateRead.ts,loans.ts} — 7,718 lines

WHAT IT IS: This block feeds the Basis scanner with current spot and perpetual-futures prices and feeds the Volume scanner with live spot trades, price books, and one-minute history; both produce ranked trade suggestions, not orders. It also contains older account, order, risk, and loan machinery plus the separate read-only account reader.

SUB-PIECES:

- `basisRuntime.ts — 754 lines — Runs the Basis worker: selects liquid pairs, refreshes both price books, supplies funding facts, records decisions, and publishes gap suggestions.`
- `volumeRuntime.ts — 1,600 lines — Runs the Volume worker: watches completed spot trades, builds one-minute baselines, evaluates volume changes, and publishes ranked suggestions; forward-profit measurement is off by default.`
- `orders.ts — 1,280 lines — Holds legacy spot order preview, send, cancel, and recovery safeguards; currently only unresolved-order history is exposed.`
- `account.ts — 1,661 lines — Holds legacy balances, fill reconciliation, equity, and profit-and-loss calculations; it receives no exchange connection at startup.`
- `privateRead.ts — 1,065 lines — Builds read-only spot, margin, and dollar-futures account snapshots, but reads account rows only after proving the key cannot trade, transfer, or withdraw.`
- `loans.ts — 1,059 lines — Holds flexible-loan and cross-margin reads plus borrow, repay, and collateral-change guards; it is not connected to server startup.`

RUNS NOW?: RUNNING — Basis and Volume are created at boot and started by the production control graph. The private-account reader is mounted, with timed exchange reads conditional on a configured read-only key. Account, Risk, and Orders are loaded only for local status, history, and unresolved-order readback; they receive no exchange connection and their money-changing routes refuse. Loans is DEAD: `LoanService` is not mounted, and the visible loan routes return refusal messages.

MONEY?: DIRECT — Basis and Volume are the two money-edge scanners; the remaining files are observation or retired legacy money support. Nothing here is currently wired to send an order.

REMOVABLE?: NO — removing this block stops both scanners and their live data feeds; the legacy account, order, risk, and loan pieces must be separated before safe removal.

EVIDENCE: `server/src/index.ts:271-275` · `server/src/systemIntegration/composition/graph.ts:69-100` · `server/src/services/privateRead.ts:926-960` · `server/src/index.ts:622-665` · `server/src/index.ts:3240-3292`

<!-- visible task 62 -->
## server/src/services/*.ts (excluding Split 23A) — 5,718 lines

WHAT IT IS: These are the non-account support services. They power public news and token-detail data, control optional screens, fetch source logos, record deployment and public-source controls, and preserve the Volume bot’s open-order focus across restarts. A separate Amazon remote-runner controller exists but is not configured.

SUB-PIECES:

- `newsContext.ts — 3,303 lines — Collects public headlines from publishers, exchanges, crypto projects, and media; labels them, keeps an eight-day archive, and publishes refreshed News data.`
- `awsRunnerControl.ts — 759 lines — Can inspect, replace, validate, or restart a script on another machine through Amazon Web Services, but the deployed catalog marks it not configured.`
- `bookStream.ts — 534 lines — Opens public Binance live-data connections on demand and shares the top buy/sell price levels and recent trades with Token viewers.`
- `observedOrderFocus.ts — 333 lines — Saves the latest complete set of symbols with observed open orders, restores it for Volume at startup, and rejects stale, conflicting, or corrupt state.`

RUNS NOW?: RUNNING — when the deployed server begins listening, it turns on every optional surface; News and Token work are registered there. Volume also constructs and restores this block’s saved open-order focus. Only the Amazon remote-runner piece is not configured.

MONEY?: NEEDED-BY-MONEY — `observedOrderFocus.ts` is in Volume’s startup path and preserves which symbols already have observed open orders; the rest supports screens, news, and operations.

REMOVABLE?: NO — removing the whole block breaks Volume’s import and startup restore; News, token detail, and several owner-control operations also lose their server support.

EVIDENCE: `server/src/services/newsContext.ts:1294-1354`; `server/src/services/bookStream.ts:4-9`; `server/src/services/volumeRuntime.ts:325-375`; `server/src/index.ts:4682-4717,5233-5253`; `server/src/productAssurance/catalog/core.ts:417-423`

<!-- visible task 63 -->
## server/src/productIntegration/runtime/** + server/src/productIntegration/incidents/** — 9,594 lines

WHAT IT IS: This is the server side of the Control Room: it turns official system, owner, event, trace, and incident state into one browser readout and accepts a narrow set of non-money commands. It groups repeated connection failures into Ledger incidents and records acknowledgement without pretending the cause is fixed. Genuinely wired when the owning component returns current state: Set Read Only; engage the kill switch; pause all intake; restart the managed root; isolate or restart Spot and USD-margined futures public feeds; pause or resume Basis; pause or resume Volume; pin or unpin symbol focus; acknowledge an open incident. Display-only or rejected here: execute a recovery plan, request a live canary, release the kill switch, resume global intake, or run an arbitrary component or process command; stale or missing owner proof disables a real control.

SUB-PIECES:

- `runtime/ — 7,470 lines — Builds the official Control Room readout and its bounded command path.`
- `incidents/ — 2,124 lines — Groups, acknowledges, recovers, and verifies saved connection incidents.`
- `runtime/controls.ts — 572 lines — Defines the safe controls, their current wiring state, previews, and request checks.`
- `runtime/ownerTruth.ts — 1,387 lines — Validates Dashboard, Account, Markets, and Opportunities data without inventing missing values.`
- `runtime/projection.ts — 1,642 lines — Converts official system state into component, surface, health, incident, and control-room views.`
- `runtime/service.ts — 655 lines — Builds and caches the readout and exposes event, trace, preview, submit, and result methods.`
- `runtime/systemControlCommandOwner.ts — 1,299 lines — Checks versions and previews, delegates each allowed command, and verifies its saved receipt.`
- `runtime/types.ts — 875 lines — Defines the complete server-to-browser records, states, command allowlist, and safety bounds.`
- `incidents/owner.ts — 650 lines — Records exact incident acknowledgement while preserving severity, cause, and recovery truth.`
- `incidents/router.ts — 1,472 lines — Groups alert floods into bounded episodes, closes them only on proven recovery, and rebuilds state after restart.`

RUNS NOW?: RUNNING — production boot subscribes the incident router to Ledger events, supplies every command owner, constructs the Product runtime, and mounts its authenticated browser address. Advertised commands reach the System control service, public-feed lifecycle owner, attention owner, or incident owner; they do not stop at a display record.

MONEY?: NO — it neither calculates Basis or Volume decisions nor belongs to either engine’s import chain; it observes and safely controls the composed system.

REMOVABLE?: NO — the owner explicitly keeps the Control Room, and this is its live command and incident-truth server; removal would erase those controls and readouts and break server boot until outside wiring was rewritten.

EVIDENCE: `server/src/index.ts:553-620`; `server/src/index.ts:1629`; `server/src/productIntegration/runtime/controls.ts:314-376`; `server/src/productIntegration/runtime/systemControlCommandOwner.ts:963-1102`; `web/src/lib/productIntegration/model.ts:1633-1662`.

<!-- visible task 64 -->
## server/src/productIntegration/** excluding runtime/** and incidents/** — 3,706 lines

WHAT IT IS: This is a control-room contract and test kit. A contract means a fixed data shape: it describes health snapshots, owner evidence, command previews, lifecycle plans, and fake stand-ins used by tests. It does not run either bot or change the live machine; the real route and command owner are in excluded `runtime/**`.

SUB-PIECES:

- `contracts/ — 1,235 — defines and checks the read-only health, command, ledger, risk, execution, and dashboard data shapes.`
- `contracts/validation.ts — 404 — rejects malformed, secret-like, or oversized health snapshots.`
- `contracts/types.ts — 304 — names component state, readiness, strategy, risk, and execution-reference fields.`
- `contracts/ports.ts — 524 — lists promised connections to owners; a promised connection is not proof that a live connection exists.`
- `fixtures/ — 1,187 — holds synthetic data and in-memory fakes for tests.`
- `fixtures/ports.ts — 1,023 — implements fake command, ledger, control, event, and dashboard connections that return preloaded test results.`
- `supervisor/ — 511 — turns supplied component evidence into a health view and pages already-saved events.`
- `supervisor/project.ts — 367 — calculates readiness, dependency blockers, severity, and operator attention without changing owner state.`

RUNS NOW?: DEAD — test-only and switched off. The supervisor, lifecycle planner, command projector, dashboard bridge, and fixtures are not connected to the deployed route; the only outside source link is the Q model-advice compatibility helper, and that host is explicitly switched off.

- DISPLAY/CONTRACT ONLY HERE: `SET_SAFE_MODE`, `SET_KILL_SWITCH`, `SET_INTAKE_PAUSED`, and `RESTART_COMPONENT` appear in an old dashboard-copy contract, but this block does not perform them. The guarded-control contract also names `SET_COMPONENT_DESIRED_STATE`, `PAUSE_INTAKE`, `RESUME_INTAKE`, `UPDATE_BOUNDED_CONFIGURATION`, `APPROVE`, `ARM`, `DISARM`, `REARM`, `REVOKE`, `HALT`, `RECONCILE`, `CANCEL`, `CLOSE`, `REDUCE`, `EXECUTE_PRECOMPUTED_RECOVERY_PLAN`, `REPAY_LIABILITY`, `SAFE_RESTART_COMPONENT`, and `ACKNOWLEDGE_RECOVERY`; all are contract/test-only here. Lifecycle start, pause, drain, stop, restart, reconcile, checkpoint, and release entries are plans only.
- WIRED LIVE OUTSIDE THIS BLOCK: Set Read Only (`SET_SAFE_MODE`, read-only only); Engage Kill Switch (`SET_KILL_SWITCH`, engage only); Pause All Intake (`SET_INTAKE_PAUSED`, pause only); Restart Managed Root (`RESTART_COMPONENT`, one managed root only); Isolate/Restart either public market source (`SET_PUBLIC_SOURCE_LIFECYCLE`); Pause/Resume Basis Intake (`SET_BASIS_INTAKE`); Pause/Resume Volume Intake (`SET_VOLUME_INTAKE`); Pin/Unpin symbol attention (`PIN_FOCUS`); Acknowledge Incident (`ACK_INCIDENT`). Each has a real preview, submit, saved receipt, and readback—a check of what actually changed. If its required state check is missing, it is marked unavailable and refuses submission rather than acting as a fake button.

MONEY?: NO — it mentions Basis and Volume and describes ways to pause their intake, but this owned block neither decides nor executes trades and is outside both engines’ live path.

REMOVABLE?: YES-BUT remove the disabled Q source link and the product-integration tests/fakes with it, or compilation and tests break; the genuinely wired controls remain in excluded `runtime/**`.

EVIDENCE:

- `server/src/productIntegration/contracts/ports.ts:95-114`
- `server/src/productIntegration/commands/projection.ts:123-127`
- `server/src/productIntegration/runtime/controls.ts:26-59,313-376`
- `server/src/productIntegration/runtime/systemControlCommandOwner.ts:609-681,1025-1074`
- `server/src/index.ts:321-324,394-426,605-620,1629`

<!-- visible task 65 -->
## server/src/productAssurance/** — 7,611 lines

WHAT IT IS: This is the product’s safety-assurance library: it lists expected operations and safety rules, checks whether supporting proof is exact and current, and shapes owner-facing status. It also contains non-executing models for failures, automated-controller proposals, diagnostics, repair campaigns, and quantitative-research proof coverage. It does not scan markets or place trades.

SUB-PIECES:

- `adapters/ownerContracts.ts` — 331 lines — Verifies outside-owner proof against the expected owner, release, subject, and fingerprint; it never grants authority.
- `catalog/core.ts` — 1,220 lines — Holds accepted interfaces, operation policies, 17 capital-safety rules, and the owner’s coverage questions.
- `cockpit/viewModel.ts` — 716 lines — Builds a read-only owner status record and refuses to show missing, stale, synthetic, or failed facts as green.
- `controllers/gate.ts` — 333 lines — Checks proposals from automated decision-makers and falls back to zero new exposure; it grants no execution or money authority.
- `diagnostics/boundary.ts` — 442 lines — Restricts artificial-intelligence diagnostics to isolated, redacted, budgeted capabilities and blocks order or money tools.
- `failureAtlas/atlas.ts` — 711 lines — Defines failure families and checks proof for detection, containment, diagnosis, recovery, and prevention.
- `faults/harness.ts` — 1,096 lines — Contains deterministic synthetic failure simulations and grades their safety proof; it performs no live work.
- `operations/policy.ts` — 571 lines — Defines deadlines, retry limits, duplicate protection, failure cutoffs, run-at-once limits, and operation-coverage checks.
- `projections/operationalTruth.ts` — 349 lines — Checks event timing, a timed single-executor lock, independent health checks, operational measurements, and alert delivery.
- `qCoverage/generator.ts` — 735 lines — Checks quantitative-research assessments remain current, independently proved, advisory-only, and unable to grant money authority.
- `remediation/campaign.ts` — 524 lines — Models repair states, timed resource locks, attempt and cost limits, independent verification, rollback, and repair conflicts; it executes no repair.

RUNS NOW?: DEAD — not mounted. The deployed server publishes only a passive `NOT_CONFIGURED` and `UNKNOWN` placeholder; none of these evaluators, simulations, controller gates, or repair campaigns is connected to live inputs or actions.

MONEY?: NO — it contains no Basis or Volume decision logic, and neither money engine loads it as a dependency.

REMOVABLE?: YES-BUT removing it alone breaks the server build because the composition layer imports its status-section list, while the unmounted artificial-intelligence operations code imports its diagnostic boundary.

EVIDENCE: `server/src/productAssurance/catalog/core.ts:251`; `server/src/productAssurance/catalog/core.ts:725`; `server/src/systemIntegration/adapters/passiveOwnerEvidence.ts:309`; `server/src/systemIntegration/adapters/canonicalOwnerEvidence.ts:729`; `server/src/index.ts:339`

<!-- visible task 66 -->
## server/src/binance/** — 6,920 lines
WHAT IT IS: This folder is the server’s Binance connection layer. It collects public spot and futures prices, best buy/sell quotes, candles, trades, and live market messages; reads limited private account data; and supplies the basis and volume engines. It also keeps liquidation history, token facts and logos, plus early safety-proof code for test orders; live trading is currently blocked.

SUB-PIECES:

- `profile.ts` — 1,197 — Fetches and stores CoinGecko token identity, supply, market value, history, and project facts.
- `rest.ts` — 1,079 — Fetches and checks Binance public prices, quotes, candles, volume, funding payments, outstanding futures positions, and basis history.
- `client.ts` — 766 — Contains exchange-key account reads plus spot order, margin, and flexible-loan actions.
- `m0SpotPermissionTruth.ts` — 637 — Checks whether separate read and execution keys meet the early spot-trading safety rules without granting action authority.
- `m0SpotSignedTransport.ts` — 616 — Builds a proof that cannot be sent as an order for one Binance test-order request; it is explicitly unmounted.
- `userStream.ts` — 522 — Defines an optional private live-message connection for fills and balance changes; repeated account reads remain official truth.
- `ws.ts` — 398 — Runs the reconnecting public live-message connection used by market data and the volume engine.
- `icons.ts` — 377 — Resolves exact-match token logos from CoinGecko and stores them for display.
- `privateReadClient.ts` — 366 — Uses a read key for a fixed list of spot, margin, and futures account reads and rejects every non-read request.
- `liquidations.ts` — 360 — Keeps bounded local history of forced futures-position closures and serves five-minute or hourly totals.
- `moneyflow.ts` — 340 — Totals buyer-started and seller-started public trades by trade size for the token page.

RUNS NOW?: RUNNING — production startup launches the basis and volume components, which directly import this folder’s public price and live-message readers. Live-order controls remain blocked; some helper and test-proof files are not active execution paths.

MONEY?: NEEDED-BY-MONEY — basis directly uses the public quote reader, while volume uses that reader plus the live market connection.

REMOVABLE?: NO — removing the whole folder breaks both money engines’ market input; cosmetic, private-only, and unmounted files must be judged separately.

EVIDENCE: `server/src/services/basisRuntime.ts:1` · `server/src/services/volumeRuntime.ts:1-2` · `server/src/systemIntegration/composition/graph.ts:69-90` · `server/src/index.ts:461-474` · `server/src/index.ts:227-243`

<!-- visible task 67 -->
## server/src/ledger.ts — 6,748 lines
WHAT IT IS: This is the server’s durable record keeper, meaning its records survive a restart. It opens and safely upgrades the on-disk database, then stores events, exact trade fills, signals, settings, owner commands, incidents, and release history. It does not choose basis or volume trades; it preserves the operating and money truth those decision-making parts need.

SUB-PIECES:
- `Lines 1–488: shared rules and record contracts — 488 lines — Defines accepted records, limits, financial outcomes, and checks for safely opening older data.`
- `Lines 489–1,201: stored event and fill format — 713 lines — Defines database columns, search helpers, protections against changing history, and safe event display fields.`
- `Lines 1,202–2,074: event search and database upgrades — 873 lines — Builds bounded searches and verifies or upgrades older event and fill storage without silently losing truth.`
- `Lines 2,075–2,742: database records and startup — 668 lines — Defines stored row shapes, opens the database, creates all ledger tables, and performs startup safety checks.`
- `Lines 2,743–3,388: events and unresolved money actions — 646 lines — Writes and reads events and determines whether order or loan requests still lack a proven result.`
- `Lines 3,389–3,738: fills, signals, sessions, and retention — 350 lines — Stores exact fills and basis signals, tracks browser sessions, trims disposable history, and publishes persistence results.`
- `Lines 3,739–4,303: settings, commands, and ownership links — 565 lines — Stores settings, requested component states, owner commands, configuration revisions, and links between records and their owners.`
- `Lines 4,304–5,113: incident history and routing — 810 lines — Creates and updates incidents, acknowledgements, resolutions, and the saved progress marker used while routing them.`
- `Lines 5,114–5,810: release evidence and database health — 697 lines — Stores boot and release evidence, feeds important events to operators, commits settings with their audit events, and handles health checks and safe shutdown.`
- `Lines 5,811–6,748: validation and record conversion — 938 lines — Rejects malformed product and money records and converts stored events, orders, incidents, and fills into trusted server records.`

RUNS NOW?: RUNNING — the live server entry creates this ledger during startup and passes it directly to both the basis and volume runners.

MONEY?: NEEDED-BY-MONEY — it is not the basis-gap or volume-pump decision logic, but both money runners depend on it for events, fills, settings, and unresolved financial-action truth.

REMOVABLE?: NO — removing it breaks server startup and removes the durable money-safety evidence required by the basis and volume runners.

EVIDENCE: `server/src/ledger.ts:2481`; `server/src/ledger.ts:3033`; `server/src/ledger.ts:3397`; `server/src/index.ts:219`; `server/src/index.ts:271`

<!-- visible task 68 -->
## server/src entry shell (index.ts, bootstrap/**, ops/**, config.ts, security/**, types.ts) — 7,245 lines

WHAT IT IS: This is the live server shell: the one process that joins the product pieces and answers the website. It locks the data folder, loads settings that refuse money action when proof is missing, starts Basis and Volume, checks owner access, serves the web-address groups below, sends live browser updates, and shuts down safely. It does not contain either strategy’s trade decisions; old or private-money routes remain visible but answer retired, unavailable, or blocked. The remaining 669 lines are smaller settings, access, shared-shape, and network-bind files below the 300-line reporting threshold.

SUB-PIECES:

- `server/src/index.ts — 5,460 — The live entry file that joins the server, strategies, controls, website routes, and process lifecycle.`
  - `index.ts lines 1–1412, boot and shared request guards — 1,412 — Joins the durable event record, Basis, Volume, system controls, read-only account boundary, and common response safety.`
  - `index.ts lines 1413–1935, owner access, integration, sessions, health, and state — 523 — Protects every server-data route and connects the main system, product, browser-session, health, state, and account readouts.`
  - `index.ts lines 1936–2589, events, news, calendar, and currency — 654 — Reads durable events and supplies optional announcements, market context, calendar events, and display-currency rates.`
  - `index.ts lines 2590–3368, fills, accounts, markets, loans, profit-and-loss, and strategies — 779 — Serves market and strategy readouts while private account, loan, and proposal actions remain unavailable or retired.`
  - `index.ts lines 3369–3814, coin and market detail — 446 — Supplies price, order-book, trade, funding, open-contract, liquidation, profile, icon, and evidence views for one symbol.`
  - `index.ts lines 3815–4653, system status, refresh, keys, settings, and money controls — 839 — Reports connections, accepts bounded public refreshes and display settings, and refuses legacy live-order, borrow, cancel, and recovery actions.`
  - `index.ts lines 4654–5460, optional pages, website serving, live browser connection, start, and shutdown — 807 — Starts optional data workers, serves the built website, pushes live updates, opens the server, and drains it safely.`
- `server/src/bootstrap/ — 809 — Prepares environment and network binding before server work begins.`
  - `server/src/bootstrap/environment.ts — 771 — Loads local environment settings, pins the data folder, and prevents two server copies from writing it simultaneously.`
- `server/src/ops/ — 345 — Owns production console-output safety.`
  - `server/src/ops/productionLogging.ts — 345 — Labels important records and limits repeated routine messages without suppressing warnings or errors.`

RUNS NOW?: RUNNING — the production service starts the built `index` file; that file creates both strategy processes and opens the browser-request server only after stored-state checks pass.

MONEY?: NEEDED-BY-MONEY — it does not decide Basis or Volume trades, but it starts both strategy processes and supplies their settings, durable records, controls, market services, and owner readouts.

REMOVABLE?: NO — removing it stops the deployed server, both money-strategy processes, the control room, and orderly recovery and shutdown.

EVIDENCE: `ops/live/systemd/cosmos-app.service:37` · `server/src/index.ts:228` · `server/src/index.ts:271` · `server/src/index.ts:275` · `server/src/index.ts:5249`

## Web source

<!-- visible task 156 -->
## web/src/pages/watchdog — Task 156 seven-file slice — 7,737 lines

WHAT IT IS: These seven files are the data and display core of the live `/watchdog` page. They repeatedly read system summaries, process delay, browser delivery, request timing, and component-owner evidence; missing or old facts are shown as unknown rather than healthy. They group every owner, show recovery results, and let the operator change timed repeat-read intervals stored in this browser. They place no trades; network writes are limited to a browser-is-alive report and an allowed data refresh.

SUB-PIECES:

- `watchdogEvidence.ts — 2,265 lines — Performs timed evidence reads, rejects missing or stale facts, builds the owner census, records request outcomes, and keeps browser timing preferences.`
- `RecoveryConsole.tsx — 1,554 lines — Checks whether a refresh is allowed, blocks overlapping runs, and shows every returned step, issue, and connection result.`
- `RecoveryConsole.css — 498 lines — Lays out the recovery controls, receipts, issue list, connection results, and timing controls.`
- `ObserverEvidence.tsx — 1,412 lines — Shows server delay, summary-building health, delivery continuity, current-snapshot identity, eight request paths, read-only probes, and settled-request history.`
- `ObserverEvidence.css — 374 lines — Styles the evidence band and request tables for narrow screens, scrolling, reduced motion, and high-contrast colors.`
- `OwnerLedger.tsx — 1,202 lines — Groups every reported or missing owner, counts proven, withheld, failing, and unknown entries, and opens each owner’s details.`
- `OwnerLedger.css — 432 lines — Styles the fixed-column owner table, sticky heading, group counts, evidence ages, summaries, and narrow-screen layout.`

RUNS NOW?: RUNNING — process metadata confirms the target tree’s web server is listening on port 5173. `web/src/store.tsx:691` maps `/watchdog`; `web/src/App.tsx:167` renders it; `web/src/pages/watchdog/WatchdogSurface.tsx:316-318` calls the evidence reader; and lines `916-1005` mount the three displays.

MONEY?: NO — it watches basis and volume systems, but contains no trading decision or order path, and the money engines do not import these files.

REMOVABLE?: NO — the owner order marks Watchdog KEEP; removing these statically imported files breaks the live web build and removes its monitoring and recovery surface.

EVIDENCE:

- `web/src/store.tsx:691`
- `web/src/App.tsx:167`
- `web/src/pages/watchdog/WatchdogSurface.tsx:12-36`
- `web/src/pages/watchdog/WatchdogSurface.tsx:316-318`
- `web/src/pages/watchdog/WatchdogSurface.tsx:916-1005`

<!-- visible task 157 -->
## web/src/pages/watchdog — six owned files — 4,391 lines

WHAT IT IS: These files build the main watchdog page, each monitored owner’s detailed evidence view, and the operational-control and incident ledger. The page divides shared evidence into posture, owners, dependency paths, controls, recovery, and proof that monitoring itself is current. Owner details expose instructions, blame, freshness, queues, retries, readiness, and an optional event trail; the control ledger shows available authority, refusal reasons, incidents, and unresolved command results.

SUB-PIECES:

- `OwnerEvidence.tsx — 1,109 lines — Expands an owner into guidance, blame, dependencies, measurements, readiness, and an operator-requested event trail.`
- `OwnerEvidence.css — 533 lines — Lays out owner evidence, absence reasons, dependency wires, measurements, and event stages.`
- `ControlLedger.tsx — 1,040 lines — Lists controls and incidents, blocks unsafe actions, preserves unresolved-command locks, and hands allowed commands to the shared confirmation flow.`
- `WatchdogSurface.tsx — 1,030 lines — Reads watchdog evidence once, assembles the six page sections, and coordinates focus, refresh, probes, announcements, and command-result state.`
- `WatchdogSurface.css — 421 lines — Defines the page frame, section counters, responsive layout, single fixed heading allowance, and motion shutdown rules.`

RUNS NOW?: RUNNING — web process …6083 listens on port 5173 from this target’s `web` directory; `web/src/App.tsx:167` mounts watchdog, and `web/src/pages/Watchdog.tsx:127-130` returns this surface. Established from source and process metadata without touching the page.

MONEY?: NO — it monitors the basis and volume engines and offers guarded intake or safety controls, but contains no basis/volume decision logic or order-placement path and is not imported by either engine.

REMOVABLE?: NO — the governing order marks watchdog KEEP; removal breaks the live monitoring, owner drill-down, operational-control, and incident-evidence surface.

EVIDENCE:

- `web/src/App.tsx:167`
- `web/src/pages/Watchdog.tsx:127-130`
- `web/src/pages/watchdog/WatchdogSurface.tsx:316-318`
- `web/src/pages/watchdog/OwnerEvidence.tsx:589-1005`
- `web/src/pages/watchdog/ControlLedger.tsx:113-162`

<!-- visible task 27 -->
## web/src/pages/Watchdog.tsx + web/src/pages/watchdog/** (Block 27 remainder) — 7,920 lines

WHAT IT IS: `Watchdog.tsx` is the `/watchdog` route wrapper; it displays the composed Watchdog surface and performs no polling itself. `VerdictHeader` shows the server-owned verdict, rule, event continuity, revision, digest, owner census, evidence age, and re-read result; `PostureBand` shows four readiness summaries, the operations-intake gate, readiness policy, waiver, and named blockers; `ConnectionPathChain` shows the browser-to-runner path, every connection state, and the first break. `OwnerRow` shows each owner’s state, reason, allowed action, lag, proof age, and expanded evidence; `ControlCommit` shows refusal or preview → confirmation → submission → server proof; `MachineValue` shows aligned values, ages, shortened copyable identifiers, and tiny trends; `StatusChip` shows Ready, Degraded, Blocked, Unavailable, Unknown, Not configured, Owner gated, stale evidence, and explicit missing-reason defects. Recount: 17 owned files / 7,920 lines; Block 26’s concrete list is 13 files / 12,128 lines; together they exactly cover 30 files / 20,048 lines—routing discrepancy: Block 26 says eight TypeScript files but names seven, while the order’s approximately 19.9k count covers only the 19,917-line subdirectory and omits this task’s 131-line route wrapper.

SUB-PIECES:

- `ConnectionPathChain.css — 444 —` Lays the dependency chain out as a vertical rail or six-column path, with connection and first-break cues.
- `ConnectionPathChain.tsx — 550 —` Shows the six-hop browser-to-runner route, each hop and connection state, required versus optional links, reasons, and assessed age.
- `ControlCommit.tsx — 981 —` Shows one guarded action’s availability, previewed effect, target, payload, safety bounds, confirmation, result, server proof, and saved readback.
- `MachineValue.css — 309 —` Aligns numbers and ages while styling shortened identifiers, copy feedback, absence states, and tiny trend charts.
- `MachineValue.tsx — 733 —` Shows numbers and ages without invented zeroes, copyable shortened identifiers, and trends against published limits.
- `OwnerRow.css — 343 —` Defines the dense seven-column owner row, wedge mark, expansion, action, refusal, and focus layout.
- `OwnerRow.tsx — 587 —` Shows one owner’s identity, server state and reason, root cause, capital relevance, action or refusal, lag, proof age, and expanded evidence.
- `PostureBand.tsx — 972 —` Shows machine readiness, browser round-trip state, binding continuity, recovery state, operations gate, readiness policy, waiver, and blockers.
- `StatusChip.css — 318 —` Gives each state and absence treatment a distinct shape and fill while preserving row geometry.
- `StatusChip.tsx — 586 —` Owns the seven state words, stale modifier, server-to-display mappings, mandatory reasons, and slot/column/panel absence displays.
- `VerdictHeader.css — 345 —` Lays out the page identity, verdict, re-read controls, evidence explanation, receipt, and unproved-fact notes.
- `VerdictHeader.tsx — 541 —` Shows the server verdict and rule, continuity explanation, re-read outcome, revision, digest, owner census, and assessed age.
- `patterns.css — 546 —` Supplies shared button, field, information-row, table, metric, bounded-region, and empty-state styling.

RUNS NOW?: RUNNING — [App.tsx:17](/Users/cosmosgeek/Desktop/cosmos-live-20260809/web/src/App.tsx:17) imports the route, [App.tsx:167](/Users/cosmosgeek/Desktop/cosmos-live-20260809/web/src/App.tsx:167) mounts it for the Watchdog page, and [store.tsx:691](/Users/cosmosgeek/Desktop/cosmos-live-20260809/web/src/store.tsx:691) maps it to `/watchdog`. Safe process evidence found the target’s web asset server listening on port 5173 from the target `web` directory and its API process listening on 8080 from the target root. Browser appearance remains UNKNOWN because the governing order prohibited opening or touching the page.

MONEY?: NO — This is a monitoring and guarded-operations web block. It neither computes Basis or Volume decisions nor appears in either money engine’s import/runtime chain.

REMOVABLE?: NO — Watchdog is owner-designated KEEP. Removing these files breaks the mounted route or removes its verdict, posture, topology, owner, control, state, and value displays; the shared token layer also has live consumers outside Watchdog.

EVIDENCE:

- [WatchdogSurface.tsx:856](/Users/cosmosgeek/Desktop/cosmos-live-20260809/web/src/pages/watchdog/WatchdogSurface.tsx:856) — mounts the server verdict header.
- [WatchdogSurface.tsx:893](/Users/cosmosgeek/Desktop/cosmos-live-20260809/web/src/pages/watchdog/WatchdogSurface.tsx:893) — mounts posture, browser, continuity, gate, policy, and blocker facts.
- [WatchdogSurface.tsx:943](/Users/cosmosgeek/Desktop/cosmos-live-20260809/web/src/pages/watchdog/WatchdogSurface.tsx:943) — mounts the owner-and-connection topology.
- [OwnerLedger.tsx:691](/Users/cosmosgeek/Desktop/cosmos-live-20260809/web/src/pages/watchdog/OwnerLedger.tsx:691) — renders every owner through `OwnerRow`.
- [ControlLedger.tsx:840](/Users/cosmosgeek/Desktop/cosmos-live-20260809/web/src/pages/watchdog/ControlLedger.tsx:840) — renders guarded controls through `ControlCommit`.

<!-- visible task 69 -->
## `web/src/pages/research-lab/**` — 9,999 lines

WHAT IT IS: This is the visual core of a read-only library covering 84 preserved research families. It lets the owner search exact outcomes, inspect one family, compare two families, and study overall patterns. Its saved evidence files are checked by byte count and SHA-256—a file fingerprint—before display. The 19 owned source files recount to exactly 9,999 physical lines; they do not run experiments, control trading programs, or move money.

SUB-PIECES:

- `ResearchLabAnalytics.css` — 885 lines — Lays out the three pattern views, their tables, bars, tabs, status messages, and small-screen behavior.
- `ResearchLabAnalytics.tsx` — 509 lines — Shows outcomes by derived family group, failed pass/fail checks, and recorded evidence hours without pretending they are experiment chronology.
- `ResearchLabArtifactWorkbench.css` — 1,096 lines — Styles the evidence-file list, integrity states, field tables, exact-file view, and narrow-screen layout.
- `ResearchLabArtifactWorkbench.tsx` — 898 lines — Opens an approved family file and presents its verified contents field-by-field or as exact text.
- `ResearchLabCatalog.css` — 694 lines — Styles the sortable family table, outcome states, comparison picker, paging, and loading or empty states.
- `ResearchLabCatalog.tsx` — 399 lines — Renders searchable families in sortable 24-row pages and lets the owner open one or select two for comparison.
- `ResearchLabCompareModal.css` — 778 lines — Styles the full comparison window, two evidence columns, differences, source notices, and responsive layout.
- `ResearchLabCompareModal.tsx` — 799 lines — Compares two families across locked catalog facts, test settings, failed checks, and saved evidence while keeping keyboard focus inside the window.
- `ResearchLabDetailSheet.css` — 453 lines — Styles the family drawer containing explanation, audit facts, saved-copy identity, and evidence-file viewer.
- `ResearchLabNarrative.css` — 526 lines — Styles locked-record facts separately from authored context, incomplete-work notices, prose, and source lists.
- `ResearchLabNarrative.tsx` — 334 lines — Keeps the frozen catalog record separate from later explanation and clearly labels insufficient or unfinished evidence.
- `ResearchLabOverview.css` — 782 lines — Styles the title, dataset state, search, outcome filters, and record-integrity summary.
- `ResearchLabProvenance.css` — 338 lines — Styles disclosure of where evidence came from and which exact saved dataset, story collection, and approved file list are shown.
- `researchLabArtifactClient.ts` — 315 lines — Restricts reads to approved files shipped under the website’s Research Lab path and verifies size and fingerprint before decoding them.

RUNS NOW?: RUNNING — a visible Research Lab item exists in the Utility sidebar, and the current web shell renders the page when `research-lab` is selected. This is current-source proof only; the UI was not opened.

MONEY?: NO — this displays saved basis/volume research evidence, but neither trading program imports it or needs it to operate.

REMOVABLE?: YES-BUT — deleting only this directory breaks the mounted Research Lab page’s build because its wrapper imports these files. Removing those wrapper and route references too would leave the trading programs running, but the in-app historical evidence library would disappear.

EVIDENCE: `web/src/components/Header.tsx:464-472`; `web/src/App.tsx:179-187`; `web/src/pages/ResearchLab.tsx:191-220`; `web/src/pages/ResearchLab.tsx:438-513`; `web/src/pages/research-lab/researchLabArtifactClient.ts:253-303`.

<!-- visible task 70 -->
## web/src/pages/ResearchLab.tsx + web/src/pages/ResearchLab.css + web/src/data/researchLab* — 2,291 lines

WHAT IT IS: Research Lab is a read-only browser for 84 preserved research families. It shows what each family tested, its verdict and reason, comparison and pattern views, copied evidence files, and custody—the record of where preserved source came from. Its purpose is to help the owner decide which ideas to retire, revisit, or retest; it runs no research and trades nothing.

SUB-PIECES:

- `web/src/pages/ResearchLab.tsx — 517 — loads the fixed research index and manages search, filters, family details, two-family comparison, patterns, and custody views.`
- `web/src/data/researchLabArtifacts.ts — 407 — catalogs 330 copied evidence files with sizes and fingerprints used to detect changed files.`
- `web/src/data/researchLabEvidence.ts — 479 — validates the readable summaries and extracts trials, pass/fail checks, parameters, and recorded fingerprints.`
- `web/src/data/researchLabStories.json — 827 data lines, outside the 2,291 code-line total — stores 72 sourced summaries of what covered families tested and why they ended.`

RUNS NOW?: RUNNING — the deployed app mounts the page and exposes it as a visible Utility-sidebar destination.

MONEY?: NO — it neither calculates basis or volume signals nor allocates capital, accesses accounts, or places orders.

REMOVABLE?: YES-BUT the mounted Research Lab page, its sidebar destination, and access to historical research evidence disappear; the basis and volume engines continue running.

EVIDENCE: `web/src/pages/ResearchLab.tsx:191`; `web/src/pages/ResearchLab.tsx:438`; `web/src/data/researchLab.ts:204`; `web/src/App.tsx:179`; `web/src/components/Header.tsx:467`

<!-- visible task 29 -->
## web/src/pages/{Strategies*,VolumeScanner*,Opportunities*,opportunities/**,TokenDetail*,BasisScanner.css} — 9,407 lines

WHAT IT IS: These are the live browser screens for Basis, dead-volume wakeups, the combined opportunity queue, and one-token investigation. They repeatedly read server-owned results, reject stale or malformed records, and display proposals, economics, market evidence, balances, and observed open orders. They sit beside money but do not drive it: no engine loads these browser files, and their only product write is the display watchlist star. Routing discrepancy: the roughly 7,000-line estimate matches the 6,980 TypeScript lines, but this delegation also owns 2,427 visual-styling lines; the measured 9,407 is about 34% higher, beyond the order’s 20% correction trigger, and the governing Task 29 row did not name the added 123-line `BasisScanner.css`.

SUB-PIECES:

- `Strategies.tsx — 1,331 — Despite its legacy filename, this is the Basis screen: it reads the Basis engine, checks freshness and displayed cost arithmetic, and shows candidates, rejections, proposals, account context, and navigation without trading.`
- `VolumeScanner.tsx — 1,263 — Reads and validates dead-volume engine rows, showing quiet baselines, sudden volume and trade changes, market quality, proposals, frozen research status, and optional token evidence; Opportunities also loads its validation helpers.`
- `VolumeScanner.css — 697 — Visual styling for Volume and much of Basis, because Strategies loads this file directly.`
- `Opportunities.tsx — 922 — Reads Basis, Volume, and the official merged opportunity view every two seconds, preserves Basis-then-Volume order, and never ranks, approves, reserves money, or executes.`
- `Opportunities.css — 687 — Visual styling for proposal facts, raw market rows, and diagnostic tables.`
- `opportunities/ — 1,511 — Directory subtotal, already counted in its two files, for strict official-record checking and diagnostics.`
- `opportunities/model.ts — 1,186 — Rejects malformed or inconsistent opportunity records, checks identity, age, source order, and count balance, and enforces suggest-only authority with no money or execution authority.`
- `opportunities/OpportunityDiagnosticsLedger.tsx — 325 — Displays rejected records, source count balance, identity links, and fields lost when owners use different record shapes.`
- `TokenDetail.tsx — 1,953 — Shows one symbol’s charts, money flow, positioning, funding, liquidations, Basis history and current row, public intelligence, observed balances and orders, and optional news; it can only navigate or star the symbol.`
- `TokenDetail.css — 920 — Visual styling for token identity, charts, flow, evidence, account context, and the full-screen chart.`
- `BasisScanner.css — 123 — Basis-only table, quality, cost, and expanded-row styling; included because this delegation names it despite being below 300 lines.`

RUNS NOW?: RUNNING — the live web process is listening from this tree on port 5173 and the server process is listening from this tree on port 8080. The app mounts all four screens at `web/src/App.tsx:37-40,146-159`; the executed server artifact exposes the Volume and Basis reads at `server/dist/index.js:2921-2925`. Token history feeds and Volume’s expanded token evidence are behind an optional token switch; its present state is UNKNOWN because live requests and database reads were forbidden. No file was changed and no browser, exchange, database, or Watchdog-page interaction occurred.

MONEY?: NO — the engines feed these screens, never the reverse; this block is neither an engine nor inside either engine’s running dependency chain. Strategies performs display-only arithmetic checks. Opportunities accepts only “suggest, cannot act” authority and explicitly requires no capital reservation and no execution at `web/src/pages/opportunities/model.ts:217-241`; watchlist changes are accepted only as display configuration while operational changes are rejected at `server/src/index.ts:4492-4534`.

REMOVABLE?: YES-BUT remove the matching `App.tsx` and sidebar loads and routes first or the web build breaks. The Basis and Volume engines continue running, but the owner loses these monitoring screens, record checks, opportunity queue, and token investigation; removing `VolumeScanner.tsx` alone also breaks Opportunities, and removing `VolumeScanner.css` alone damages Basis styling.

EVIDENCE:

- `web/src/App.tsx:37-40,146-159` — Token Detail is loaded and all four screens are mounted.
- `web/src/pages/Strategies.tsx:475-555,689-732` — screen-only Basis arithmetic checks and repeated Basis-engine reads.
- `web/src/pages/VolumeScanner.tsx:698-784` — repeated Volume-engine reads and separately switched token evidence.
- `web/src/pages/Opportunities.tsx:24-40,632-691` — dependency on Volume validation, explicit no-action boundary, and all three repeated reads.
- `web/src/pages/TokenDetail.tsx:1534-1653,1748-1760` — server-owned market/Basis/intelligence reads and the watchlist-only write.

<!-- visible task 30 -->
## `web/src/pages/{Dashboard*,Account*,accountTruth.ts,LedgerPage*,Risk*,Loans*,borrowPreflightTruth.ts,Pnl*,Fills*,Markets*}` — 9,060 code lines + 43 non-code documentation lines

WHAT IT IS: This is the owner-facing, read-only block for the main dashboard, account facts, fills, profit and loss, markets, before-action borrow checks, risk posture, and ledger event logs. It turns server facts into tables, charts, warnings, and navigation; it does not move money. Recount: 9,060 code lines, 29.4% above the routed estimate of about 7,000, plus 43 documentation lines; this crosses the order’s 20% correction gate. Routing discrepancy: the live profit-and-loss address renders the Account page, while the standalone `Pnl.tsx` is dead.

SUB-PIECES:

- `Dashboard.tsx — 961 — Shows authoritative Basis and Volume run-state, market and account health, recent decisions, and a separate local profit-and-loss read.`
- `Dashboard.css — 694 — Styles the dashboard summary, account chart, engine rows, attention queue, decisions, and small-screen layout.`
- `Account.tsx — 441 — Presents shared read-only balances, orders, positions, fills, freshness, and thin Execution and profit-and-loss views with no account actions.`
- `Account.css — 893 — Styles the Account workspace, truth notices, wallet rows, account tables, and small-screen layout.`
- `accountTruth.ts — 465 — Combines Spot, Margin, and USD-M dollar-settled futures records, marks partial or stale data, and never turns missing facts into zero.`
- `LedgerPage.tsx — 1,623 — Validates, counts, filters, pages, and explains event-log records, including whether displayed fields came from current or older stored data.`
- `Risk.tsx — 510 — Shows advisory limits, private-account coverage, rejected decisions, and symbol rules while hard-blocking execution and money actions.`
- `Risk.css — 791 — Styles the current read-only risk gate, limits, and symbol policy, while retaining unused styles for old switches and dry-run forms.`
- `Loans.css — 609 — Styles the before-action borrow view, liability tables, source state, and small-screen layout.`
- `Pnl.tsx — 319 — Defines a fuller standalone profit-and-loss and fills viewer, but no live source imports it.`
- `Markets.tsx — 637 — Shows current Spot and perpetual markets, executable gaps, funding, liquidity, watchlists, and freshness while withholding unproven numbers.`
- `Markets.css — 485 — Styles the sortable Markets table; Loans and the out-of-scope Token Detail page also import it, creating shared ownership.`

RUNS NOW?: RUNNING — web process `*6083` serves this exact target on port 5173, and built server process `*0941` runs on port 8080. Dashboard, Account, Markets, Borrow, Risk, and Logs have live web addresses; Fills runs inside Account. Exceptions: `Pnl.tsx` is DEAD because it is not imported, and `Markets.rebuild-notes.md` is documentation only. No web page, server route, exchange, or database was called, so visible rendering remains unmeasured.

MONEY?: NO — These files display Basis and Volume outputs, but neither bot imports them. Their gap sorting and risk checks shape the screen only; they cannot decide, sign, borrow, transfer, or place orders.

REMOVABLE?: YES-BUT remove the matching App imports and web addresses together or the web build breaks. The bots keep running, but the owner loses the dashboard, account, fills, profit-and-loss, markets, borrow, risk, and log views; Token Detail also loses shared Markets styling unless that stylesheet is retained or split.

EVIDENCE: [App.tsx:137-164](/Users/cosmosgeek/Desktop/cosmos-live-20260809/web/src/App.tsx:137); [surfaceMounts.ts:20-28](/Users/cosmosgeek/Desktop/cosmos-live-20260809/web/src/features/productControlRoom/surfaceMounts.ts:20); [Dashboard.tsx:479-516](/Users/cosmosgeek/Desktop/cosmos-live-20260809/web/src/pages/Dashboard.tsx:479); [Loans.tsx:45-80](/Users/cosmosgeek/Desktop/cosmos-live-20260809/web/src/pages/Loans.tsx:45); [LedgerPage.tsx:1149-1185](/Users/cosmosgeek/Desktop/cosmos-live-20260809/web/src/pages/LedgerPage.tsx:1149).

<!-- visible task 31 -->
## web/src/pages — Task 31 residual root files — 4,443 lines

WHAT IT IS: This is the cockpit’s context and operator-support remainder. News collects headlines, Calendar shows economic events, Notifications shows server-owned incidents, and Health monitors components and offers a preview-before-confirmation restart for the manager process. News and Calendar provide context only; neither decides nor places trades. `Rules.tsx` is an old read-only fragment with no page address.

SUB-PIECES:

- `LiveIntelligence.css — 916 lines — shared News, Calendar, Notifications, and Logs layout.`
- `News.tsx — 790 lines — combines a live headline feed, repeated server reads, local cache, and filters.`
- `Health.css — 600 lines — styles health summaries, recovery controls, and component rows.`
- `CalendarPage.tsx — 517 lines — validates and displays repeatedly refreshed economic events.`
- `NotificationsPage.css — 459 lines — styles the incident inbox, delivery status, and local filters.`
- `NotificationsPage.tsx — 427 lines — shows incidents, delivery capability, acknowledgement, and browser-only visibility controls.`
- `SystemHealth.tsx — 230 lines — shows system condition and guards the manager restart command.`
- `MetricTiles.css — 135 lines — globally styles summary bands across Health and several money-adjacent pages.`
- `News.css — 135 lines — styles News freshness and source-owner status.`
- `ComponentOperationalHealthTable.tsx — 116 lines — lists heartbeat, delay, data quality, restart, and dependency facts.`
- `Rules.tsx — 68 lines — DEAD read-only governance fragment with no consumer.`
- `CalendarPage.css — 50 lines — styles stale-calendar warnings.`
- Orphan check: `Rules.tsx` is the dead owned orphan. `BasisScanner.css` belongs to Block 29 because `Strategies.tsx:30` imports it.

RUNS NOW?: RUNNING — a live web process is listening on `:5173` from this deployed tree. Health, Notifications, News, and Calendar are mounted at `web/src/App.tsx:166-177` and exposed in navigation at `web/src/components/Header.tsx:460-471`; only `Rules.tsx` is DEAD because it is not imported or mounted. ROUTING DISCREPANCY: News and Calendar are ordered isolate/park, but both remain selectable live page addresses. The measured 4,443 lines are 11.1% above the rough 4,000-line routing estimate, below the order’s 20% correction trigger. No browser page, server request, database, or exchange was touched.

MONEY?: NO — these files display context and operator state. Their live commands restart the manager process or acknowledge incidents; they do not calculate basis/volume decisions or place orders.

REMOVABLE?: YES-BUT removing them loses Health monitoring/restart and Notifications acknowledgement. Their page links must be removed, `LiveIntelligence.css` must be retained or moved because Logs imports it at `web/src/pages/LedgerPage.tsx:19`, and `MetricTiles.css` must remain because it is globally loaded at `web/src/App.tsx:30`.

EVIDENCE:

- `web/src/App.tsx:47-55,137-188` — page loading and complete page-selection branches; no Rules branch.
- `web/src/pages/News.tsx:630-663` — live news feed and repeated-read fallbacks.
- `web/src/pages/CalendarPage.tsx:335-361` — calendar refresh and failure handling.
- `web/src/pages/NotificationsPage.tsx:144-181,349-366` — delivery readback, incidents, and acknowledgement.
- `web/src/pages/SystemHealth.tsx:78-96,167-205` — restart preview, submission, result readback, and component health.

<!-- visible task 71 -->
## web/src/features/** — 8,008 lines

WHAT IT IS: This block supplies the mounted browser Control Room and the shared data connection that gives other pages the server-owned picture of what is running. It shows machine, engine, public-feed, risk, incident, and step-by-step event evidence while offering narrowly limited non-money owner commands. It also contains synthetic preview data (fake data used only for demonstrations and tests), an embedded display-only System Dashboard, and an unmounted account profit/loss chart.

SUB-PIECES:

- `productControlRoom/ — 2,696 —` Mounted Control Room, shared server-state connection, command registry, incident acknowledgement, evidence panels, and fake preview support.
- `productControlRoom/components/ — 1,276 —` Displays owner evidence and performs the real preview, confirmation, submission, and saved-result checks.
- `productControlRoom/styles/ — 583 —` Visual layout for the Control Room; it performs no command.
- `productControlRoom/ProductControlRoom.tsx — 309 —` Disables commands unless server truth is fresh and gap-free, then embeds the older dashboard as display-only.
- `productControlRoom/components/ControlRegistryPanel.tsx — 527 —` Filters server-declared controls and runs the allowed preview-confirm-submit flow.
- `productControlRoom/fixtureBinding.ts — 349 —` Converts fake scenarios into explicitly fake Control Room snapshots with no live authority.
- `productControlRoom/styles/productControlRoom.css — 583 —` Styles command, evidence, warning, and result rows.
- `strategyDashboard/ — 1,039 —` Unmounted account-wide realized profit/loss chart, data checks, styles, and tests; it is not attributed to Basis or Volume.
- `strategyDashboard/model.ts — 315 —` Checks passed-in account profit/loss data and withholds misleading totals or charts.
- `systemDashboard/ — 4,273 —` Embedded display-only machine, engine, source, capital, risk, and transition dashboard plus a separate fake preview.
- `systemDashboard/components/ — 1,325 —` Renders the dashboard panels; its mutation panel is omitted from the mounted Control Room.
- `systemDashboard/fixtures/ — 958 —` Fake supervisor conditions and in-memory changes for previews only.
- `systemDashboard/lib/ — 362 —` Owns plain labels, age formatting, tabs, and descriptions of what a control would do.
- `systemDashboard/styles/ — 1,188 —` Visual layout for the embedded dashboard.
- `systemDashboard/fixtures/builders.ts — 360 —` Builds bounded fake supervisor snapshots.
- `systemDashboard/fixtures/index.ts — 507 —` Defines the fake healthy, stale, blocked, recovery, and failure scenarios.
- `systemDashboard/lib/presentation.ts — 336 —` Converts machine states and proposed controls into owner-readable text without causing effects.
- `systemDashboard/styles/systemDashboard.css — 1,188 —` Styles dashboard evidence, tabs, and preview-only controls.

RUNS NOW?: RUNNING — The app mounts the Control Room route, wraps the web app in its five-second server-state reader, and connects it to mounted server read, preview, submit, and saved-result routes. Source-wired commands—enabled only when the running server reports that it owns and can save the change, freshness checks pass, and event history is gap-free—are: Set Read Only; Engage Kill Switch only, never release it; Pause Global Intake only, never resume it; Restart the single Managed Root supervising the whole graph, also exposed on Health; isolate or restart the Spot public feed; isolate or restart the Binance USD-M dollar-margined perpetual-futures public feed; pause or resume Basis proposal intake; pause or resume Volume proposal intake; and acknowledge an open incident without clearing its cause or health state. Every live command requires a server preview (the exact effect tied to the current state version), explicit confirmation, and a saved-result check. Display-only or unmounted: symbol focus pin/unpin is rejected by the browser’s permitted-command list; the embedded dashboard’s three-mode selector, kill release, intake resume, and arbitrary component restart are omitted from the live mount and work only with fake preview data; recovery-plan execution is fake-preview only; the tiny live canary remains owner-gated with no preview; the topbar Execution Control only displays state and opens the room; and `strategyDashboard` has no mounted consumer.

MONEY?: NO — The Basis and Volume engines do not load this browser code, and it contains no market-edge decisions or order execution. It only observes and changes surrounding control state.

REMOVABLE?: NO — The order explicitly keeps Control Room. Removing this block breaks the mounted route, shared server-truth connection used by multiple pages, incident acknowledgement, and the web build, although the server money engines themselves would remain.

EVIDENCE:

- `web/src/App.tsx:62-73,138,236-238`
- `web/src/features/productControlRoom/ProductControlRoom.tsx:154-167,221-237`
- `web/src/features/productControlRoom/components/ControlRegistryPanel.tsx:439-497`
- `server/src/productIntegration/runtime/systemControlCommandOwner.ts:179-307`
- `server/src/index.ts:605-620,1629`

<!-- visible task 72 -->
## web/src/components/** — 6,836 lines

WHAT IT IS: This is the shared browser shell and visual toolkit: navigation, search, status panels, Connection Watchman, charts, icons, selectors, modals, and error handling. It does not calculate Basis or Volume trades and cannot place orders. The topbar’s Execution Control is a status window and doorway; the actual Control Room is mounted outside this block. “Live-wired” means the browser previews a command, binds it to the exact current state version, sends it to the server code that owns the change, and reads a stored result receipt.

SUB-PIECES:

- `Header.tsx — 3,222 lines —` Mounted sidebar, topbar, search, status panels, navigation, notifications, display preferences, and Connection Watchman.
- `AccountCockpitRailView.tsx — 395 lines —` Read-only private-account facts with all money actions disabled; its wrapper has no current caller, so this rail is not mounted.
- `TradingViewChart.tsx — 355 lines —` Token-page fallback price chart with working view-only zoom, fit, live-edge, logarithmic-scale, volume, and moving-average controls.
- `Icons.tsx — 315 lines —` Reusable static vector icons used throughout the live browser.
- `PerfChart.tsx — 315 lines —` Dashboard profit-and-loss, equity, and win/loss charts rendered from supplied ledger facts.

There are no owned subdirectories.

RUNS NOW?: RUNNING — the app mounts this shell and the Control Room route. Nine server command types exist. Live-wired when current authoritative state and owner readback are proven: Set Read Only only; Engage Kill Switch only, with no release here; Pause Global Intake only, with no resume here; Restart the single supervised process group; isolate or restart the Spot public feed; isolate or restart the dollar-margined-futures public feed; pause or resume Basis proposal intake; pause or resume Volume proposal intake; and durably acknowledge an incident without changing its cause or recovery state. Focus Pin/Unpin, meaning extra market attention, is server-wired, but the browser’s permitted-command list omits it; if that row appears, the main Control Room displays it disabled and cannot send it. Every live command fails closed unless the state is current, continuity is proven, the server reports live wiring, and the prior stored result is reconciled. Outside the Control Room, Execution Control and Trust Advisor only display facts or navigate; exchange permissions, account, and cloud-runner panels are read-only; Mark Read saves only a browser seen-position and is not durable incident acknowledgement; clock, currency, Basis units, theme, accent, scale, motion, and refresh timing change presentation only. Connection Watchman live-polls health, submits browser latency/connection observations, and can refresh only news, calendar, and currency-rate sources; whole-system, market, and process recovery buttons remain disabled pending the Control Room preview path. Optional-page state is live-read and gates content, but its visible switches were removed. Current button state was not queried because live requests were forbidden; this verdict is source-wiring proof.

MONEY?: NO — this browser block is neither Basis/Volume decision logic nor imported by the money engines.

REMOVABLE?: NO — removing it breaks the mounted browser cockpit, monitoring, navigation, Control Room doorway, and charts, although the server engines are separate.

EVIDENCE:

- [web/src/App.tsx:113](/Users/cosmosgeek/Desktop/cosmos-live-20260809/web/src/App.tsx:113)
- [web/src/components/Header.tsx:2137](/Users/cosmosgeek/Desktop/cosmos-live-20260809/web/src/components/Header.tsx:2137)
- [web/src/lib/productIntegration/model.ts:7](/Users/cosmosgeek/Desktop/cosmos-live-20260809/web/src/lib/productIntegration/model.ts:7)
- [server/src/productIntegration/runtime/controls.ts:320](/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/productIntegration/runtime/controls.ts:320)
- [server/src/index.ts:605](/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/index.ts:605)

<!-- visible task 73 -->
## web/src/lib/** — 11,392 lines

WHAT IT IS: These 35 files are the web app’s shared support layer. They repeatedly fetch server data, reject malformed or stale replies, and manage preferences, notifications, token logos, pop-up panels, clocks, and reconnection timing. They turn basis (the spot-versus-perpetual price gap), volume, private-account, system-health, and control-room replies into safe screen states and preserve control-action results across refreshes. They do not place trades; trading decisions and orders stay on the server.

SUB-PIECES:

- `productIntegration/` — 5,146 lines — Connects the browser to the server control summary, checks replies, sends allowed control actions, and remembers missed events and unfinished results across reloads.
- `productIntegration/model.ts` — 3,677 lines — Defines and deeply checks every control-room field and includes a large set of sample states for previews and tests.
- `privateRead.ts` — 2,253 lines — Checks private Binance account reads for read-only permissions, freshness, balances, orders, fills, positions, and whether records agree, then prepares safe display states.
- `tokenIntelligence.ts` — 867 lines — Checks the volume screen’s token evidence, including activity, buy/sell depth, funding, open contracts, forced closes, hypotheses, false-positive checks, and news.
- `productIntegration/useProductControlRoomBinding.ts` — 491 lines — Keeps the open control room current, catches up missed events from a saved point, and prevents late replies from replacing newer truth.
- `basisRuntime.ts` — 419 lines — Checks the live spot-versus-perpetual gap reply, costs, proposals, and timing before the basis screen trusts it.
- `productIntegration/commandResultState.ts` — 361 lines — Remembers an unfinished control action in browser storage and asks the server for its final result after a refresh.
- `systemIntegration.ts` — 348 lines — Reads system health every five seconds and sends system control changes while reporting loading and errors.
- `notifications.ts` — 325 lines — Turns selected raw event-log entries into owner notices, applies notification choices, and combines repeats.
- `iconManifest.ts` — 313 lines — Batches and retries token-logo requests, keeps returned links for reuse, and pauses when the owning screen is off.

RUNS NOW?: RUNNING — the mounted app creates the control client and exposes live Strategies and Volume routes that ask the server for checked data every two seconds.

MONEY?: NO — the live Basis and Volume screens depend on it, but the engines do not import browser code; it does not decide or place trades.

REMOVABLE?: NO — deleting this block stops the web app from building and removes live basis/volume monitoring plus system and safety controls.

EVIDENCE: `web/src/main.tsx:68-72`; `web/src/App.tsx:62-74`; `web/src/App.tsx:157-158`; `web/src/pages/Strategies.tsx:715-720`; `web/src/pages/VolumeScanner.tsx:756-764`

<!-- visible task 74 -->
## web/src/store.tsx + web/src/App.tsx + web/src/types.ts + web/src/format.ts + web/src/main.tsx — 2,963 lines

WHAT IT IS: This is the browser control room’s central wiring. It starts the visible app, turns screen addresses and sidebar choices into pages, keeps shared facts about markets, account access, preferences, and live updates, and formats prices, basis gaps, money, and time. When facts are missing or stale, it shows them as unavailable or halted instead of guessing.

SUB-PIECES:

- `web/src/store.tsx — 2,122 — Owns page routing, shared market and account facts, server refreshes, the live server link, preferences, and guarded configuration changes.`
- `web/src/types.ts — 350 — Lists the fields and allowed values for configuration, markets, accounts, orders, fills, proposals, and server-state records.`

RUNS NOW?: RUNNING — `web/index.html:11` loads the browser entry, `web/src/main.tsx:68-73` attaches the app to the visible page, and `web/src/App.tsx:232-240` mounts the shared store and screen shell.

MONEY?: NO — It displays and controls the basis and volume screens, but it does not calculate their signals or execute their trades.

REMOVABLE?: NO — Removing this block stops the entire visible control room, including the basis and volume screens, from starting and receiving shared data.

EVIDENCE: `web/index.html:11`; `web/src/main.tsx:68-73`; `web/src/App.tsx:116-188`; `web/src/App.tsx:232-240`; `web/src/store.tsx:1358-1425`.

<!-- visible task 34 -->
## web/src/styles.css — 49,809 lines

WHAT IT IS: This is the global style sheet for colors, spacing, layout, navigation, top-bar operator panels, and older page skins. A selector is the label used to match a screen element; this file mixes current selectors with many superseded versions. It changes presentation, not basis or volume calculations.

SUB-PIECES: `styles.css — 49,809 — owns the global visual system and accumulated historical overrides.`

Counting method: each style-rule span belongs to the rightmost hyphenated class prefix; for example, `.smenu .cb-row` belongs to `cb`. `LIVE-SOURCE` means every class is emitted by code reachable from the live entry point; `MIXED` is `total(live + orphaned)` lines; `ORPHANED` means no matching class is emitted. These are source findings, not browser-visible proof.

Reconciliation: 44,692 prefixed rule lines + 845 shared/unprefixed rule lines + 4,272 comments, blanks, variables, and wrapper lines = 49,809. Rules serving several families create 1,979 overlapping family-span lines, so the individual family figures must not be summed again.

LIVE-SOURCE — 58 prefixes:

```text
watchman=398, ssr=360, mode=274, smenu=151, shared=131, preview=92, app=91,
state=86, tv=81, notification=74, menu=70, page=67, bottom=63, operator=60,
stat=58, grade=43, s=42, popup=41, cadence=36, table=34, trust=34, theme=33,
wm=30, ov=29, rule=29, crash=23, global=23, quote=17, tape=17, optional=16,
chip=15, cloudflare=15, accent=14, cc=12, live=11, volume=11, cmd=10, cur=10,
result=10, zp=9, perf=8, cgx=7, ftr=7, tradingview=7, wl=7, hcb=6, warn=6,
status=5, tvx=5, dot=4, opens=4, c=3, flash=3, e=2, dense=1, empty=1, num=1,
zone=1
```

MIXED — 50 prefixes:

```text
clock=2136(521+1615), ops=2018(1483+535), keyx=1493(33+1460),
shell=1293(39+1254), dash=1276(100+1176), settings=1075(132+943),
snav=915(854+61), curfx=865(18+847), top=862(54+808), rdock=854(644+210),
advisor=751(61+690), hp=637(583+54), account=620(114+506),
ledger=539(22+517), api=512(66+446), data=454(56+398), lg=453(380+73),
rail=402(62+340), aws=392(86+306), tdx=371(224+147), basis=354(347+7),
notif=330(73+257), currency=318(300+18), hdr=312(242+70),
appearance=301(291+10), power=271(51+220), topbar=270(251+19),
search=268(238+30), brand=166(144+22), apikey=162(50+112),
cal=147(107+40), mkx=117(84+33), risk=108(4+104), news=103(66+37),
sr=99(81+18), m=82(64+18), tb=71(28+43), pc=69(66+3), exec=64(34+30),
icon=57(54+3), tint=50(37+13), t=48(24+24), tok=44(23+21), ic=39(38+1),
np=29(20+9), zoom=29(27+2), execution=28(9+19), control=21(16+5),
snn=20(1+19), alert=8(5+3)
```

ORPHANED — 148 prefixes:

```text
cb=2853, ntfx=1973, nwx=1798, ntf=1396, advx=1348, mrefx=1317, datax=1202,
apx=901, basisx=842, bwx=815, modex=708, market=660, ntc=614, acct=485,
token=477, sys=466, loan=457, topux=450, cs=414, wallet=391, refresh=366,
ob=327, acb=324, hlx=307, acd=304, cr=271, ux=270, rsx=262, mref=259,
basx=243, key=234, curx=222, dhx=214, bsx=206, trade=202, strip=159,
tbp=130, opp=125, markets=119, depth=115, asset=111, pnl=103, qs=97,
chart=96, cta=95, runtime=92, vsx=92, micro=85, tele=84, mini=80, ak=67,
density=67, dashboard=64, detail=61, price=52, setup=49, preflight=48,
feed=46, headline=46, profile=45, clx=44, td=42, funding=41, sec=39,
mrefresh=38, cap=37, side=37, gate=32, hero=31, acc=28, adv=28, conn=28,
hb=28, net=28, nav=27, collateral=26, qsize=25, health=24, active=22,
fills=22, akx=21, posture=21, prefs=21, pulse=21, rf=20, cell=19, opx=19,
sort=19, wifi=19, ltv=18, center=16, donut=15, telemetry=15, lb=14, book=13,
cost=12, dh=11, orders=11, sig=11, rkx=9, row=9, ticket=9, ladder=8,
manual=8, route=8, change=7, halt=7, head=7, back=6, confirm=6, mcard=6,
arm=5, card=5, equity=5, futures=5, ghost=5, metric=5, quick=5, rules=5,
tl=5, a=4, loans=4, tone=4, wallets=4, alerts=3, gt=3, polling=3, system=3,
z=3, ch=2, col=2, connect=2, dialog=2, form=2, logs=2, star=2, two=2,
hl=1, in=1, kv=1, muted=1, opportunities=1, pad=1, positions=1, safety=1,
strategies=1, val=1, w=1
```

The route distinction matters: Basis and Volume are live screens, but this file’s `basisx`, `basx`, `bsx`, and `vsx` families are old skins superseded by page-owned style sheets. Conversely, `rules=5` belongs to the genuinely unmounted old `Rules.tsx` page. Routing discrepancy: NONE — 49,809 is nine lines above the order’s rounded 49.8k estimate, a 0.02% difference, and this shard owns exactly the intended one file.

RUNS NOW?: RUNNING — [`web/src/main.tsx:21`](/Users/cosmosgeek/Desktop/cosmos-live-20260809/web/src/main.tsx:21) loads it globally, and the target tree’s web process is listening on port 5173. No page was opened or requested.

MONEY?: NO — it contains no market measurement, prediction, position, or order logic.

REMOVABLE?: YES-BUT the live web shell, navigation, top-bar controls, and shared page presentation would lose or break their layout; the server-side Basis and Volume engines would remain untouched.

EVIDENCE: [`web/src/main.tsx:21`](/Users/cosmosgeek/Desktop/cosmos-live-20260809/web/src/main.tsx:21); [`web/src/App.tsx:157`](/Users/cosmosgeek/Desktop/cosmos-live-20260809/web/src/App.tsx:157); [`web/src/store.tsx:632`](/Users/cosmosgeek/Desktop/cosmos-live-20260809/web/src/store.tsx:632); [`web/src/pages/Strategies.tsx:29`](/Users/cosmosgeek/Desktop/cosmos-live-20260809/web/src/pages/Strategies.tsx:29); [`web/src/styles.css:10712`](/Users/cosmosgeek/Desktop/cosmos-live-20260809/web/src/styles.css:10712).

<!-- visible task 35 -->
## web/src/aiOps/** — 5,584 code/style lines + 12 non-code preview HTML lines
WHAT IT IS: This is an artificial-intelligence operations cockpit prototype, not a live trading screen. Its separate preview uses fixed, made-up data to show system safety, component inventory, operational trends, one staged provider incident, evidence, owner chat, permissions, model suppliers, and checks required before allowing more automation. Working controls only navigate, expand, search, filter, inspect, and prepare local drafts; sending, incident commands, emergency kill, bulk disable, permission changes, probes, persistence, and money actions are disabled or absent. Later, it is a credible read-only supervision and incident-automation shell if connected to authenticated live facts and independent confirmation of actual state, but it is aimed at operations and governance—not basis/volume decisions or trade execution.

SUB-PIECES:

- `views/ — 1,417 — five panels covering overview, incidents, chat, permissions, and governance.`
- `fixture.ts — 1,462 — builds and freezes one exact made-up provider-degradation scenario.`
- `aiOps.css — 1,081 — supplies the complete responsive appearance for the cockpit and its panels.`
- `types.ts — 679 — defines the required shapes for facts, incidents, evidence, controls, providers, and future automation context.`
- `controlProjection.ts — 480 — creates 120 proposed control rows across lifecycle, incidents, model routing, budgets, retention, research, investigation, repair, verification, remediation, paging, and learning; it performs no action.`
- `views/PermissionsConsole.tsx — 362 — provides local search, filtering, and inspection while disabling every operational control.`
- `views/IncidentWorkspace.tsx — 356 — shows the staged case, hypotheses, evidence trail, validation, and disabled commands.`

Line recount: 5,584 code/style lines plus 12 preview-markup lines = 5,596, matching the order’s approximately 5.6k; no size discrepancy. Routing discrepancy: the task says Shadow A2, but this owned directory consistently identifies itself as the A4 web-preview lane and contains no A2 reference, so it cannot establish A2 server behavior.

RUNS NOW?: DEAD (not mounted) — read-only process evidence confirms the target web process is listening on port 5173, but its entry renders the main application and the complete page selection has no AI Ops branch. The only owned entry is a separate preview explicitly labeled “Not a Product Route”; therefore the deployed product shows and controls nothing from this block today.

MONEY?: NO — the block contains one made-up, read-only money-lifecycle display and expressly excludes order authority. It implements neither basis nor volume logic and is outside their live runtime path.

REMOVABLE?: YES-BUT the standalone A4 preview, its screen specification, and its AI Ops tests would disappear; deployed product pages and live trading behavior would remain unchanged.

EVIDENCE:

- [web/src/main.tsx:68-72](/Users/cosmosgeek/Desktop/cosmos-live-20260809/web/src/main.tsx:68)
- [web/src/App.tsx:136-188](/Users/cosmosgeek/Desktop/cosmos-live-20260809/web/src/App.tsx:136)
- [web/src/aiOps/preview/main.tsx:17-27](/Users/cosmosgeek/Desktop/cosmos-live-20260809/web/src/aiOps/preview/main.tsx:17)
- [web/src/aiOps/fixture.ts:1293-1326](/Users/cosmosgeek/Desktop/cosmos-live-20260809/web/src/aiOps/fixture.ts:1293)
- [web/src/aiOps/views/PermissionsConsole.tsx:82-128](/Users/cosmosgeek/Desktop/cosmos-live-20260809/web/src/aiOps/views/PermissionsConsole.tsx:82)

## web/vite.config.ts — 59 lines

WHAT IT IS: This is the web development-server and build configuration. It chooses the React plugin, aliases, local server behavior, and bounded proxy/build settings; it does not contain product or trading decisions.

SUB-PIECES: No file or subdirectory is at least 300 lines; the owned file is `vite.config.ts — 59 — configures the web toolchain and local server.`

RUNS NOW?: RUNNING — process …6083 is the Vite server whose working directory is this target’s web directory; this file is the root Vite configuration.

MONEY?: NO — neither Basis nor Volume imports it.

REMOVABLE?: YES-BUT the current web development/build command loses its configuration and may fail or change behavior; the server-side bots remain independent.

EVIDENCE: `web/vite.config.ts:1`; `web/package.json:6`.

## Quant source

<!-- visible task 75 -->
## quant/src/quant_edge/final_proof/** + direct root files — 9,477 lines

WHAT IT IS: This is the shared base for the isolated Quant research lane plus Q17, its final proof stage. The 753 root lines define exact data formats, repeatable test inputs, command-line checks, and the hypothesis registry: H1/H2/H5 map to Volume, H3/H4/H7 to Basis, and H6/H8 are parked/dead. The 8,724 proof lines audit earlier research using made-up test data, performance checks, and safety scans; they create no market signal, risk approval, or order.

SUB-PIECES: No direct root file reaches 300 lines; the ten root files total 753.

- `final_proof/` — 8,724 — Directory total for the final Quant proof stage; the file rows below explain this total and are not extra lines.
- `final_proof/security.py` — 1,961 — Reads code without running it and flags network, secret, order, money, unsafe-process, and out-of-scope behavior.
- `final_proof/components.py` — 1,777 — Checks the identities and acceptance state of the numbered Quant research stages Q00–Q17.
- `final_proof/benchmark.py` — 1,659 — Measures local speed and memory with repeated made-up test data and labels the result non-production.
- `final_proof/replay.py` — 1,314 — Replays fixed market snapshots and deliberately damaged inputs to prove missing or unsafe evidence causes abstention.
- `final_proof/evidence.py` — 1,023 — Checks a fixed set of research evidence files and preserves made-up-test, data-missing, rejected, or unknown verdicts.
- `final_proof/generation.py` — 989 — Builds, writes, and rechecks eight Q17 evidence files whose required outcome is abstention with no money authority.

RUNS NOW?: DEAD (not mounted). Production start launches only the Node server (`package.json:16`); Quant is reachable only through separate manual research and test commands.

MONEY?: NO — it audits Basis and Volume hypotheses, but it is outside both deployed engines and owns no proposal, risk, account, exchange, or order step.

REMOVABLE?: YES-BUT the shared Quant research code, its commands, Q17 evidence checks, and the full Quant test gate break; deployed Basis and Volume behavior does not.

EVIDENCE:

- `quant/registry/edge_hypotheses.v1.json:1`
- `package.json:16`
- `quant/src/quant_edge/final_proof/components.py:1637`
- `quant/src/quant_edge/final_proof/generation.py:214`
- `quant/src/quant_edge/final_proof/evidence.py:922`

<!-- visible task 76 -->
## quant/src/quant_edge/registry_ops/** — 8,401 lines

WHAT IT IS: This is a local research filing cabinet and rulebook for machine-learning models: it records evidence, experiments, the current model, alternatives tested without control, data-change alarms, later outcomes, and whether predicted chances match those outcomes. Its only directly named hypothesis is H5, the volume-side filter meant to reject misleading bursts; the remaining machinery is generic research custody, with no basis logic. “Champion” means the current research artifact, not a bot allowed to act.

SUB-PIECES:

- `store.py — 4,166 — Keeps a local research database whose history is added rather than silently rewritten, covering models, comparisons, later results, rollback, and integrity checks.`
- `recorded_outcomes.py — 1,398 — Defines predictions, later outcomes, and score comparisons while requiring verified real evidence for any production-grade result.`
- `contracts.py — 1,132 — Defines accepted evidence and model records, rejecting malformed inputs and granting no product, money, risk, or order authority.`
- `bundle.py — 666 — Combines fixed earlier-research files into a made-up-data registry proof and assigns that experiment to H5.`

RUNS NOW?: DEAD (not mounted) — the deployed server starts basis and volume but explicitly gives the quant-advice slot no connection. Separate manual research consumers exist, but they are not mounted in the production process.

MONEY?: NO — this is research record-keeping and an H5 test-data example; neither live basis nor live volume calls it, and it cannot place orders.

REMOVABLE?: YES-BUT removing it breaks the offline research registry/campaign and saved-file checks imported by separate advisory-inference code; live basis and volume remain intact.

EVIDENCE: `quant/src/quant_edge/registry_ops/store.py:1-7`; `quant/src/quant_edge/registry_ops/contracts.py:3-5`; `quant/src/quant_edge/registry_ops/bundle.py:550-554`; `quant/src/quant_edge/inference/artifacts.py:18-19`; `server/src/index.ts:311-324`

<!-- visible task 77 -->
## quant/src/quant_edge/validation/** — 5,940 lines

WHAT IT IS: Shared research machinery that tests model claims using supplied historical samples and predictions; no registry hypothesis is hard-wired. It supports H1/H2/H5 volume research through time-ordered testing, rare-event scoring, false-burst controls, and future-information checks; it supports H3/H4/H7 basis research through model comparison and fee, slippage, funding, borrow, delay, and recovery stress. H6/H8 are dead under this order, and nothing here activates them. The five files below 300 lines total exactly 1,113 lines and provide resampling, negative controls, risk-adjusted-return correction, number maths, and cost stress.

SUB-PIECES: No child subdirectory exists; every file at or above 300 lines is listed.

- `feature_diagnostics.py — 2,136 lines — Tests whether an input signal adds stable value, shows which inputs drove results, shuffles inputs as a safety check, and compares models with groups of inputs removed.`
- `samples.py — 464 lines — Defines tamper-evident sample and prediction records, including time cutoffs and exact data/model history needed to catch future information.`
- `comparison.py — 443 lines — Compares a candidate model with the baseline (the model to beat) across later time windows and refuses a verdict when evidence is invalid.`
- `multiplicity.py — 440 lines — Records every attempted model and discounts results that may look good merely because many models were tried.`
- `metrics.py — 380 lines — Measures rare-event ranking, top-list accuracy, probability error, and whether stated chances match later outcomes; missing support stays unknown.`
- `leakage.py — 330 lines — Rejects results when future information entered the test, skill looks implausibly perfect, or a shuffled-label safety check fails.`
- `splits.py — 323 lines — Trains on earlier periods and tests on later ones, keeps related events together, adds a time gap, and locks the final untouched test set behind an explicit grant.`
- `__init__.py — 311 lines — Publishes the validation-only interface and states that made-up test evidence has no authority to act.`

RUNS NOW?: DEAD — not mounted. The deployed service launches only `server/dist/index.js`; that server explicitly sets the quant advisory input to `null` (absent), so no Python quant validation code enters the live process. Research campaigns and tests import it only when separately started.

MONEY?: NO. It judges money ideas but is outside the running basis and volume engines’ import closure. Across all 13 owned files there are no exchange, credential, network, database, ticket, order, or execution calls, and its test report cannot approve a model for use.

REMOVABLE?: YES-BUT removing it breaks quant research campaigns, model-combination research, larger-model evaluation, and related tests; deployed basis and volume operation is unaffected.

EVIDENCE: `/Users/cosmosgeek/Desktop/cosmos-live-20260809/quant/src/quant_edge/validation/__init__.py:1` · `/Users/cosmosgeek/Desktop/cosmos-live-20260809/quant/src/quant_edge/validation/feature_diagnostics.py:2116` · `/Users/cosmosgeek/Desktop/cosmos-live-20260809/quant/scripts/q12_ensemble_campaign.py:65` · `/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/index.ts:324` · `/Users/cosmosgeek/Desktop/cosmos-live-20260809/ops/live/systemd/cosmos-app.service:37`

<!-- visible task 78 -->
## quant/src/quant_edge/ensemble/** + quant/src/quant_edge/models/** — 9,503 lines
WHAT IT IS: An offline research toolbox that trains and compares models, combines their scores, checks whether confidence matches later outcomes, builds prediction ranges, and refuses weak conclusions. It is generic: it could test H1/H2/H5 for Volume and H3/H4/H7 for Basis after real labeled history exists, but implements none of them; H6/H8 have no code here. Today it proves only controlled fake-data machinery and can issue WATCH (keep observing) or ABSTAIN_UNKNOWN (do not decide).

SUB-PIECES:
- `ensemble/ — 5,532 — Combines model outputs, checks confidence, builds prediction ranges, separates uncertainty, or refuses to decide.`
- `ensemble/abstention.py — 451 — Chooses only WATCH or ABSTAIN_UNKNOWN after hard evidence checks.`
- `ensemble/adapters.py — 589 — Links model and validation records without copying their algorithms.`
- `ensemble/calibration.py — 1,387 — Checks and corrects whether confidence numbers match observed frequencies.`
- `ensemble/conformal.py — 1,707 — Builds and monitors prediction ranges from earlier errors without using future outcomes.`
- `ensemble/stacking.py — 618 — Combines several model scores using time-ordered validation data.`
- `ensemble/uncertainty.py — 410 — Separates doubt into data quality, unusual inputs, model disagreement, outcome spread, cost, and timing causes.`
- `models/ — 3,971 — Trains, compares, tunes, rounds, and scores generic models on controlled data.`
- `models/battery.py — 978 — Runs baseline models and models made from many small decision trees on controlled fake data, preserving every loss.`
- `models/contracts.py — 301 — Defines exact result records and rules that stop losing models from disappearing.`
- `models/engine.py — 888 — Fits and scores linear and decision-tree models and produces in-memory diagnostic results.`
- `models/focus_budget.py — 314 — Measures how well a fixed number of attention slots finds useful candidates.`
- `models/metrics.py — 339 — Calculates prediction, ranking, confidence, and error measurements.`
- `models/studies.py — 309 — Runs a fixed number of model-setting trials and logs every success or failure.`
- `models/synthetic.py — 313 — Creates repeatable fake datasets with known patterns to prove the machinery behaves correctly.`

RUNS NOW?: DEAD — not mounted. Production sets the Quant advisory hookup to `null` (nothing connected), so no owned model or ensemble process starts; only offline research, proof, and test callers use these files.

MONEY?: NO — these files calculate research records from supplied data; neither directory can reach an exchange, account, network, durable store, risk gate, capital gate, or order sender.

REMOVABLE?: YES-BUT offline model and ensemble campaigns, validation diagnostics, inference-proof verification, and their tests break; deployed Basis and Volume behavior does not.

EVIDENCE: quant/src/quant_edge/models/__init__.py:1-9 · quant/src/quant_edge/models/battery.py:795-805 · quant/src/quant_edge/models/engine.py:6-9 · quant/src/quant_edge/ensemble/abstention.py:1-6 · server/src/index.ts:321-324

<!-- visible task 79 -->
## quant/src/quant_edge/inference/** — 4,624 lines
WHAT IT IS: This is generic research assessment machinery, not a bot: it verifies fixed files, replays one synthetic cash-market order book, derives five market-shape measures, and can serve a same-machine advisory report. Official H1 is dormant-to-active Volume and H3 is normal Basis; the fixed report says H1 Basis convergence, so classify this block as generic machinery and its demo as H3-shaped with the wrong H1 label. With no usable model score and missing costs, it always says `ABSTAIN_UNKNOWN`, meaning do nothing because truth is insufficient.

SUB-PIECES:
- `generation.py — 1,289 — Builds the fixed synthetic evidence pack and strict same-machine Python and Node clients.`
- `service.py — 887 — Queues local assessment and status requests, confining each assessment to one timed throwaway child process.`
- `artifacts.py — 704 — Verifies digital fingerprints for the exact research files and preserves unavailable model and probability-trust truth.`
- `pipeline.py — 561 — Turns a recorded order-book replay into evidence, five book-shape measures, model state, and forced abstention.`
- `protocol.py — 461 — Rejects malformed messages, secrets, order authority, unsafe numbers, and actionable answers built from unknown truth.`
- `contracts.py — 360 — Defines request limits, readiness, lineage, and counters while explicitly granting no strategy, capital, risk, account, promotion, or order power.`
- `transport.py — 317 — Offers an optional same-machine socket with local-only addresses, strict permissions, connection caps, and safe shutdown.`

RUNS NOW?: DEAD (not mounted) — production boot supplies no Q advisory binding, so the deployed process starts no Q client, transport, or inference worker.

MONEY?: NO — neither live Basis nor Volume imports or starts it; its sole current result is research-only abstention.

REMOVABLE?: YES-BUT removing it breaks Q16/Q17 research checks, generated evidence/client rebuilding, and final-proof imports; deployed Basis and Volume behavior does not change.

EVIDENCE:
- `quant/DECISIONS/Q01-001-LOCKED-RESEARCH-WORKSPACE.md:13`
- `quant/src/quant_edge/inference/pipeline.py:441-481`
- `quant/src/quant_edge/inference/contracts.py:1-5`
- `server/src/index.ts:321-324`
- `quant/src/quant_edge/final_proof/replay.py:29-32`

<!-- visible task 80 -->
## quant/src/quant_edge/derivatives/** + quant/src/quant_edge/survival/** — 9,382 lines
WHAT IT IS: `derivatives/` is offline research math for basis—the gap between spot and a perpetual futures contract, which has no expiry—plus funding, open interest, liquidations, and across-exchange evidence. It maps to H3 normal basis, H4 reverse basis, and H7 funding changes; some measures inform volume H1/H2/H5, while H6 is research-only and H8 is absent. `survival/` estimates time until wake-up, continuation, fade, convergence, invalidation, or a waiting order fill, supporting H1/H2/H5 and H3/H4. Both directories calculate from supplied records or made-up test data; neither connects to an exchange nor sends orders.
SUB-PIECES:

- `derivatives/ — 5,468 lines — Offline basis and derivatives research: H3/H4/H7 directly, H1/H2/H5 context, and dead H6 research.`
- `derivatives/bar_features.py — 337 lines — Measures gap speed, acceleration, persistence, and how often the gap shrinks for H3.`
- `derivatives/basis_path.py — 443 lines — Aligns spot and perpetual observations into time-bucketed gap paths and identifies which leg changed.`
- `derivatives/campaign.py — 600 lines — Manually generates fixed, made-up derivatives examples and research evidence files.`
- `derivatives/cross_market.py — 1,337 lines — Separates broad-market movement from asset-specific movement and tests dead H6 leadership across exchanges, research-only.`
- `derivatives/executable.py — 444 lines — Calculates normal and reverse basis at a supplied size after costs and borrow constraints; it returns data only.`
- `derivatives/funding.py — 300 lines — Measures funding-payment level, change, time remaining, and schedule changes for H7 and H3.`
- `derivatives/leadlag.py — 323 lines — Compares spot and perpetual timing to identify which market moved first and whether that result is stable.`
- `derivatives/openinterest.py — 321 lines — Measures open interest, meaning outstanding futures positions, and its change, acceleration, and price relationship for H1/H2/H5 context.`
- `survival/ — 3,914 lines — Generic time-to-event research for H1/H2/H5 wake-up outcomes and H3/H4 convergence outcomes.`
- `survival/campaign.py — 786 lines — Builds only made-up training and test groups plus evidence files for the time-to-event machinery.`
- `survival/contracts.py — 445 lines — Defines bounded groups, event targets, time buckets, and event tables without supplying market data.`
- `survival/hazard_model.py — 409 lines — Estimates each event’s chance in each time bucket and projects how long cases remain unresolved.`
- `survival/metrics.py — 973 lines — Scores probability accuracy, ranking, and calibration—whether predicted percentages match observed frequency—and fails on missing evidence.`
- `survival/passive_fill.py — 609 lines — Estimates whether and when a waiting limit order fills by queue position, while forbidding direct promotion from an in-memory result.`

RUNS NOW?: DEAD — not mounted. The deployed service starts only the Node server; these Python libraries run only when separate research or test code calls them.
MONEY?: DIRECT — offline basis and volume hypothesis logic, but not imported by either live strategy engine and unable to trade.
REMOVABLE?: YES-BUT the deployed server remains unchanged; Quant’s cost projection, survival adapter, passive-fill registry, evidence generators, tests, and imports break.
EVIDENCE: `ops/live/systemd/cosmos-app.service:37` · `quant/src/quant_edge/derivatives/executable.py:258` · `quant/src/quant_edge/derivatives/cross_market.py:1323` · `quant/src/quant_edge/survival/targets.py:80` · `quant/src/quant_edge/survival/passive_fill.py:336`

<!-- visible task 81 -->
## quant/src/quant_edge/{fee_truth,maker_fee_grid,book}/ — 5,385 lines

WHAT IT IS: Offline research code that converts supplied fee records into exact costs, verifies a blocked maker-fee study, and rebuilds an order book—a list of buy and sell prices—from synthetic or recorded events. Fee truth supports basis hypotheses H3/H4/H7 and volume hypotheses H1/H2/H5; the maker-fee grid targets H3, while the book is shared evidence machinery (`H` means hypothesis). H6/H8 receive no external-source logic here, and nothing sends orders, contacts an exchange, or controls money.

SUB-PIECES:

- `fee_truth/ — 2,959 lines — Validates supplied fee records and produces basis and volume cost scenarios while leaving unknown costs unknown.`
- `fee_truth/conversion.py — 546 lines — Combines standard fees, discounts and taxes into exact current, public, adverse and sensitivity cases.`
- `fee_truth/contracts.py — 624 lines — Defines the permitted fee records, timestamps and source evidence and rejects inconsistent claims.`
- `fee_truth/projections.py — 1,406 lines — Calculates four-leg basis fees and two-leg volume entry-and-exit fees without executing anything.`
- `book/ — 2,212 lines — Rebuilds and checks local buy-and-sell levels from supplied synthetic or recorded events.`
- `book/events.py — 335 lines — Defines depth changes and full-book copies with injected times and forbids live evidence.`
- `book/engine.py — 1,136 lines — Detects gaps, crossed prices and capacity failures and emits only read-only requests for a fresh book copy.`
- `book/replay.py — 451 lines — Replays a fixed event script and returns a deterministic final book view.`

RUNS NOW?: DEAD — not mounted. The production entrypoint explicitly supplies no quant advisory connection; these paths run only through manual offline tools, research replay or tests.

MONEY?: DIRECT — it measures fees and market depth for the basis and volume hypotheses, but has no live money or execution authority.

REMOVABLE?: YES-BUT offline fee conversion, maker-fee verification, book replay, synthetic advisory research and quant tests break; the live bots remain unchanged because production does not mount this code.

EVIDENCE: `quant/src/quant_edge/fee_truth/projections.py:1102` · `quant/src/quant_edge/fee_truth/projections.py:1313` · `quant/src/quant_edge/maker_fee_grid/verify.py:152` · `quant/src/quant_edge/book/events.py:47` · `server/src/index.ts:324`

<!-- visible task 82 -->
## quant/src/quant_edge/bootstrap/** + quant/src/quant_edge/lake/** — 9,395 lines

WHAT IT IS: This is an offline market-data intake and research-evidence warehouse, not a trading bot. `bootstrap` mainly serves volume H1 (early wake-up), H2 (continuation versus fade), and H5 (false-burst filtering); H6 (cross-source leadership) is recorded only as missing and blocked. `lake` provides shared storage and proof for volume research plus partial inputs for basis H3 (normal convergence) and H4 (reverse basis); it contains no H7 funding-rule logic or H8 external-context path. It has no proposal, capital, risk, ledger, private-exchange, or order authority.

SUB-PIECES:

- `bootstrap/ — 4,877 — Offline source review, archive intake, fake-test bridge, and event-window building, mainly for volume H1/H2/H5; H6 remains blocked.`
- `bootstrap/bridge.py — 1,210 — Defines fake-test-data handoff shapes for public Spot and no-expiry futures events; real delivery is missing.`
- `bootstrap/atlas.py — 1,064 — Groups historical rows into five-minute periods and separates unusually busy or moving candidates from ordinary comparison periods for H1/H2/H5.`
- `bootstrap/archive.py — 908 — Checks one caller-supplied official Binance daily Spot-trade archive and its file fingerprint, then converts it into replay-only research rows.`
- `bootstrap/coverage.py — 624 — Records observed, unknown, or unavailable archive coverage, counts, file fingerprints, and permission gaps for volume research.`
- `bootstrap/sources.py — 440 — Builds review records for the Binance archive, blocked internal bridge, and unimplemented Tardis reference, explicitly mapping H1/H2/H5 and blocked H6.`
- `lake/ — 4,518 — Shared write-once research storage covering exact rows, local files, limited queries, retention plans, and instrument history; it has no bot or exchange path.`
- `lake/instruments.py — 1,053 — Keeps historical listing, filter, and borrow-eligibility facts needed by volume H1/H2/H5 and as inputs to basis H3/H4; it does not implement H7.`
- `lake/parquet.py — 751 — Turns validated market rows into a fixed compact byte format and checks identity, ordering, counts, times, and data quality when reading them back.`
- `lake/manifest.py — 612 — Builds and verifies the inventory record for one write-once research-data revision, including parent history, file fingerprints, counts, and expiry class.`
- `lake/governance.py — 560 — Checks research-source evidence and records owner notes and later outcomes, but cannot admit a source or create an action.`
- `lake/store.py — 560 — Publishes and reads write-once files on local disk with safe paths and fingerprint checks; it has no exchange connection.`
- `lake/contracts.py — 538 — Defines exact numbers, timestamps, data-quality states, market rows, and storage keys used by much of offline quant research.`

RUNS NOW?: DEAD (not mounted) — the deployed start command launches the Node server, not this Python package; its forward-data bridge also declares real delivery missing and integration blocked.

MONEY?: NO — it researches and stores possible inputs, but the running basis and volume engines do not load it and it cannot trade.

REMOVABLE?: YES-BUT removing it breaks large parts of offline quant research and its tests, including shared evidence types, archive and event-window builders, instrument history, and local research storage; the live server/web path remains intact.

EVIDENCE: `quant/src/quant_edge/bootstrap/sources.py:1-5` · `quant/src/quant_edge/bootstrap/sources.py:247-260` · `quant/src/quant_edge/lake/instruments.py:196-215` · `quant/src/quant_edge/lake/governance.py:1-6` · `package.json:9-17`

<!-- visible task 83 -->
## quant/src/quant_edge/features/**, n3_intake/**, deep/** — 6,089 lines

WHAT IT IS: This is an offline research toolbox, not a bot: it turns dated market observations into measurements, checks old experiment results, and blocks deep-learning models—programs trained on long event sequences—when real data is missing. H1–H8 are the official labels for eight research ideas; “basis” means the spot-versus-perpetual price gap. `features` supplies shared math for volume H1/H2/H5 and basis H3/H4/H7; `n3_intake` keeps older evidence whose subjects line up with H1/H2/H5, H3 and H7; `deep` is generic sequence-model research most relevant to H1/H2/H5. H6, outside-market leadership, and H8, external events, have no admitted source here.

SUB-PIECES:

- `features/ — 2,191 lines — Generic research math for grouping observations, measuring change, tracking normal behavior and exposing missing data honestly.`
- `features/baselines.py — 337 lines — Maintains bounded rolling medians, variation, averages, percentiles and symbol-specific history checks.`
- `features/domains.py — 492 lines — Validates dated observations and groups them into time, event-count, trade-count or volume buckets without treating missing volume as zero.`
- `features/primitives.py — 367 lines — Calculates activity, price return, robust distance from normal and changing variance, both in batches and one observation at a time.`
- `n3_intake/ — 2,829 lines — Research custody that validates and grades locked result files for older basis, volume, exit and funding experiments.`
- `n3_intake/adapters.py — 448 lines — Converts tightly checked result documents into internal evidence records.`
- `n3_intake/bridge.py — 788 lines — Pins the accepted older experiment families and forces the current overall result to UNKNOWN, with no recommendation or authority.`
- `n3_intake/contracts.py — 741 lines — Defines the allowed document, evidence, metric and verdict shapes and their size limits.`
- `n3_intake/decision.py — 358 lines — Applies evidence, cost, holdout and capacity gates to produce a research verdict only.`
- `deep/ — 1,069 lines — Holds model references, synthetic test data and a fail-closed “not enough real data” gate; it contains no trained model or market score.`

RUNS NOW?: DEAD — not mounted. None of these Python files is connected to the deployed app; the server starts only a do-nothing observation row for `q-inference`, explicitly not a Python program or network connection.

MONEY?: NO — it computes and grades research evidence only; the deployed Basis and Volume engines do not call it, and it has no order, account, capital, risk or execution interface.

REMOVABLE?: YES-BUT removing it breaks much of the offline Quant research, the older-evidence scoreboard, deep-data proof generation and their tests; deployed Basis/Volume behavior and money paths remain unchanged.

EVIDENCE: `quant/EDGE_HYPOTHESIS_MAP.md:100-142` · `quant/src/quant_edge/features/primitives.py:299-367` · `quant/src/quant_edge/n3_intake/bridge.py:147-156` · `quant/src/quant_edge/deep/references.py:68-77` · `server/src/systemIntegration/adapters/qAdvisory.ts:351-355`

<!-- visible task 84 -->
## quant/src/quant_edge/regime/** + quant/src/quant_edge/smeta1/** — 8,379 lines

WHAT IT IS: This is offline quantitative research and evidence checking, not either trading bot. `regime` detects changes, groups conditions, finds earlier similar periods, and measures made-up test data; it is generic machinery usable across H1–H8 but owns no hypothesis. `smeta1` judges seven frozen research families using previously unseen test periods, costs, tradeable size, and loss limits. Closest map: F01→H3 normal Basis; F02→H1/H2 volume; F05/F07→H2 continuation or reversal; F04/F06 are funding-adjacent but not the exact H7 rule-change test; F03 has no clean H1–H8 match, and H4/H5/H6/H8 have no direct family here.

SUB-PIECES:

- `regime/` — 4,468 — Generic change, market-state, anomaly, and historical-similarity research shared across hypotheses.
- `regime/anomaly.py` — 328 — Flags values unlike their recent baseline and combines that with change and market-state uncertainty.
- `regime/matrix_profile.py` — 354 — Compares each time window only with valid earlier windows to find unusual or repeated shapes.
- `regime/analog.py` — 404 — Finds earlier similar periods without looking forward into the answer.
- `regime/metrics.py` — 450 — Measures detection delay, misses, false alarms, segment boundaries, and anomaly flags.
- `regime/ood_challengers.py` — 538 — Benchmarks eight methods for finding data unlike training history, all marked uncalibrated research only.
- `regime/campaign.py` — 731 — Produces reproducible made-up fixtures and score reports only when manually invoked.
- `smeta1/` — 3,911 — Cross-family research custody and verdict machinery; it does not implement a strategy.
- `smeta1/registry.py` — 3,854 — Checks file fingerprints, trial counts, unseen-test chronology, costs, tradeable size, loss limits, and correction for trying many variants.

RUNS NOW?: DEAD — not mounted. The deployed server explicitly supplies no Quant transport or owner and passes a null binding, so this Python is absent from the live process; its remaining callers are offline research and test modules.

MONEY?: NO — it studies possible Basis and Volume edges, but it is outside both live engine import chains and cannot create a proposal or order.

REMOVABLE?: YES-BUT offline Quant anomaly research, abstention, drift checks, research custody, and their tests and proof reports break; live Basis and Volume keep running.

EVIDENCE: `quant/src/quant_edge/regime/__init__.py:1-10`; `quant/src/quant_edge/regime/contracts.py:105-120`; `quant/src/quant_edge/smeta1/registry.py:1-68`; `quant/src/quant_edge/smeta1/registry.py:1668-1684`; `server/src/index.ts:311-324`

<!-- visible task 85 -->
## quant/src/quant_edge/labels/** + quant/src/quant_edge/micro/** + quant/scripts/** + quant/generated/** — 11,328 code lines

WHAT IT IS: This is the offline research factory: it turns supplied market records into repeatable labels—answers about what happened after a chosen cutoff—market measurements, scripted experiments, and preserved evidence. It serves Volume H1 dormant-to-active, H2 continuation versus exhaustion, and H5 false-burst filtering; it serves Basis H3 normal convergence, H4 reverse convergence requiring spot borrowing, and H7 funding-rule changes. H6 cross-source leadership and H8 outside-event context are dead product paths because no approved outside source is admitted. It does not approve, size, place, or send trades.

SUB-PIECES:

- `quant/src/quant_edge/labels/ — 3,367 — Records outcomes and fair comparison groups for H1–H5/H7; it never decides a live trade.
- `quant/src/quant_edge/labels/basis.py — 524 — Records whether normal or reverse Basis gaps later closed after costs, borrowing, and funding; tradeable results stay unavailable without executable prices.
- `quant/src/quant_edge/labels/controls.py — 308 — Matches candidate periods with comparable quiet or non-event periods without using future information.
- `quant/src/quant_edge/labels/manifest.py — 319 — Locks exact evidence members and comparison groups so identical inputs reproduce identical records.
- `quant/src/quant_edge/labels/outcomes.py — 982 — Records later returns, best and worst moves, threshold-crossing times, spreads, and cost-adjusted outcomes while preserving missing or broken data.
- `quant/src/quant_edge/micro/ — 3,117 — Builds public buy/sell-queue and trade measurements mainly for Volume H1/H2/H5.
- `quant/src/quant_edge/micro/activity.py — 448 — Classifies quiet, wake, persistent, and fading activity using only earlier public observations.
- `quant/src/quant_edge/micro/bookfeat.py — 387 — Measures depth, imbalance, refill behavior, book shape, and spread at the intended size.
- `quant/src/quant_edge/micro/flow.py — 545 — Measures buyer/seller imbalance, trade arrival, concentration, spread, price impact, absorption, and thin liquidity.
- `quant/src/quant_edge/micro/inputs.py — 331 — Validates public quotes, trades, and depth ladders, joining each trade only to an earlier quote.
- `quant/src/quant_edge/micro/point_process.py — 674 — Measures public add/cancel arrival rates only under complete evidence and explicitly grants no production or execution authority.
- `quant/scripts/ — 3,790 — Contains manual evidence generators for H1–H5/H7 and generic model research; it contains no working H6/H8 source.
- `quant/scripts/q03_real_sample.py — 574 — Reads caller-supplied local Binance public-archive bytes for H1/H2/H5 research and never downloads them.
- `quant/scripts/q04_replay_campaign.py — 506 — Reruns made-up Spot and perpetual order-book events to prove shared research machinery behaves consistently.
- `quant/scripts/q05_label_campaign.py — 518 — Builds made-up label and comparison evidence for H1–H5/H7 without claiming real market results.
- `quant/scripts/q07_micro_campaign.py — 637 — Builds made-up H1/H2/H5 market-measurement evidence and checks whole-history calculations match one-event-at-a-time calculations.
- `quant/scripts/q12_ensemble_campaign.py — 980 — Tests combining models, checking whether stated likelihoods match outcomes, and abstaining when evidence is weak, using made-up data only.
- `quant/generated/ — 1,054 — Preserves research outputs; its counted code consists only of two local assessment clients.
- `quant/generated/q16/ — 1,054 — Holds the two future-facing local assessment clients; current product integration is absent.
- `quant/generated/q16/node_client_v1.mjs — 554 — JavaScript validator and local-process client for research assessments, with no exchange-order interface.
- `quant/generated/q16/python_client_v1.py — 500 — Python validator and local-process client for the same research assessments, with no exchange-order interface.

RUNS NOW?: DEAD — not mounted. Production starts only the Node server; quant scripts require manual invocation, and current quant product integration is `NOT_CONFIGURED`, meaning not connected.

MONEY?: DIRECT — this is direct research logic for the Basis and Volume money ideas, but it is not a live money path.

REMOVABLE?: YES-BUT the deployed server still starts; quant research, verification checks, preserved evidence, and any later advice-only model handoff break.

EVIDENCE: quant/src/quant_edge/labels/basis.py:405; quant/src/quant_edge/micro/point_process.py:7; quant/EDGE_HYPOTHESIS_MAP.md:6; package.json:16; quant/generated/q17/integration_instructions.md:5

<!-- visible task 86 -->
## quant/research/dq1/** + dq3/** + dq4/** + dq5/** + dq6/** — 9,109 lines

WHAT IT IS: Offline research gatekeepers, not market scanners: they check data files, study setup, saved-history origin, unseen-test reuse, and public profit arithmetic. Custody means proving files and history are exactly what they claim; a holdout is final test data kept unseen until the end. DQ-1 chiefly supports volume H1/H2/H5; DQ-3/4/5 protect research generally; DQ-6 is closest to basis H3/H4/H7 because it checks both-side costs and funding, but supplies no borrow or account truth. Nothing supplies the outside feeds needed by H6/H8, and nothing decides or sends a trade.

SUB-PIECES:

- `dq1 — 1,907 —` Checks downloaded daily Spot price-and-volume archives and records excluded bad rows.
- `dq1/boundary.py — 1,145 —` Validates local archive, checksum, timestamps, rows, and output receipts.
- `dq1/test_boundary.py — 574 —` Tests corrupt archives, duplicates, shortened days, timestamp errors, and stale output cleanup.
- `dq3 — 2,067 —` Locks trial lists, data-row order, repeated-test plans, and unseen-test boundaries.
- `dq3/validator.py — 1,290 —` Builds and checks deterministic statistical trial plans without scoring profit.
- `dq3/test_validator.py — 537 —` Tests reordered, incomplete, forged, tied, or already-opened studies.
- `dq4 — 1,530 —` Proves a sealed research packet came from the claimed saved code history.
- `dq4/origin_validator.py — 922 —` Uses network-free, read-only Git history checks to verify files and ancestry.
- `dq4/test_origin_validator.py — 603 —` Tests moved refs, missing objects, altered files, unsafe paths, and hostile repository layouts.
- `dq5 — 2,463 —` Blocks reused study periods, reused files, shared final-test data, and previously opened final tests.
- `dq5/contracts.py — 627 —` Defines and validates the study registry, time windows, final-test records, and candidates.
- `dq5/validator.py — 695 —` Compares a proposed study with recorded history and returns eligibility with authority `NONE`.
- `dq5/tests — 996 —` Proves valid intake plus malformed, reused, incomplete, and unsafe cases.
- `dq5/tests/test_validator_hostile.py — 431 —` Attacks every reuse and false-freshness rule.
- `dq6 — 1,142 —` Checks public research economics while preserving unknown real fees, capacity, and dollar conversion.
- `dq6/validator.py — 697 —` Recomputes capital, fee, slippage, funding, and per-1,000 scenario arithmetic without capital authority.

RUNS NOW?: DEAD — not mounted: the live server does not load these packages. They run only through manual local commands or tests; Research Lab shows copied reading material, not executing validators.

MONEY?: NO — outside the Basis and Volume engines’ live dependency chain.

REMOVABLE?: YES-BUT future research loses archive validation, trial locking, origin proof, holdout-reuse protection, and economics-truth checks; current live Basis/Volume behavior does not change.

EVIDENCE: [quant/research/dq1/README.md:3-10](/Users/cosmosgeek/Desktop/cosmos-live-20260809/quant/research/dq1/README.md:3); [quant/research/dq3/README.md:97-113](/Users/cosmosgeek/Desktop/cosmos-live-20260809/quant/research/dq3/README.md:97); [quant/research/dq4/README.md:3-6](/Users/cosmosgeek/Desktop/cosmos-live-20260809/quant/research/dq4/README.md:3); [quant/research/dq5/README.md:3-14](/Users/cosmosgeek/Desktop/cosmos-live-20260809/quant/research/dq5/README.md:3); [quant/research/dq6/README.md:3-6](/Users/cosmosgeek/Desktop/cosmos-live-20260809/quant/research/dq6/README.md:3)

<!-- visible task 87 -->
## quant/research/dq7/**, quant/research/dq8/**, quant/research/dq10/**, quant/research/dq11/** — 9,809 code lines

WHAT IT IS: This is offline research custody: rules that keep research records complete and honest before a result is considered. DQ7 catches renamed copies of ideas and checks the correction plan required when many ideas are tried; DQ8 verifies supplied trades, costs, net asset value (what the research account is worth), and drawdown (its fall from a peak). DQ10 separates unknown, measured-zero, failed, and credible-looking results while denying capital or order authority; DQ11 proves where every sample went from available to scored. None names an H1–H8 family: this is shared custody, not direct basis logic for H3/H4/H7, direct volume logic for H1/H2/H5, or special code for parked H6/H8.

SUB-PIECES: Directory totals include their files; documentation and data lines are outside the 9,809-code-line total.

- `quant/research/dq7/ — 3,747 code lines — Checks duplicate idea families and whether all attempted ideas share one correction plan.`
- `quant/research/dq7/validator.py — 2,226 lines — Performs the actual duplicate, overlap, and many-ideas checks.`
- `quant/research/dq7/test_validator.py — 958 lines — Tests renames, overlaps, freezes, malformed input, and same-input/same-result behavior.`
- `quant/research/dq7/README.md — 351 documentation lines — Explains the checker, its limits, and manual proof commands.`
- `quant/research/dq7/fixture_harness.py — 325 lines — Builds local variations of checked example programs for tests.`
- `quant/research/dq7/fixtures/ — 949 data lines — Holds accepted, deliberately bad, and frozen expected examples.`
- `quant/research/dq7/fixtures/valid_program.v1.json — 392 data lines — Supplies one complete example research program.`
- `quant/research/dq8/ — 2,516 code lines — Replays a supplied research account path and verifies its arithmetic and timestamps.`
- `quant/research/dq8/validator.py — 1,808 lines — Recomputes cash, positions, value, return, cash duration, and peak-to-trough loss.`
- `quant/research/dq8/test_validator.py — 457 lines — Tests fees, clocks, prices, returns, and peak-to-trough calculations.`
- `quant/research/dq8/fixtures/ — 554 data lines — Holds synthetic historical paths and deliberately bad variants.`
- `quant/research/dq10/ — 2,026 code lines — Checks whether a declared research result truthfully matches supplied rules.`
- `quant/research/dq10/validator.py — 1,237 lines — Separates unknown, zero, failed, and positive declarations while denying money authority.`
- `quant/research/dq10/test_validator.py — 789 lines — Tests result meanings, supplied-rule binding, file safety, and command-line output.`
- `quant/research/dq10/fixtures/ — 710 data lines — Holds valid and deliberately bad result declarations.`
- `quant/research/dq11/ — 1,520 code lines — Accounts for every sample through eligibility, admission, signal, fill, and scoring stages.`
- `quant/research/dq11/validator.py — 806 lines — Proves sample identities, exclusions, stage counts, and the final analysis count.`
- `quant/research/dq11/test_validator.py — 566 lines — Tests missing, duplicated, substituted, excluded, and zero-sample cases.`

RUNS NOW?: DEAD — not mounted/test-only. The live start command launches only the server, nothing in live source calls these modules, and they run only when a person launches a checker or its tests.

MONEY?: NO — they check research records; they contain no basis/volume decision logic and nothing the live basis or volume engines call.

REMOVABLE?: YES-BUT the four offline research checks, their tests, and checked examples disappear; live basis and volume behavior does not break.

EVIDENCE:

- `package.json:9-16`
- `quant/research/dq7/README.md:338-349`
- `quant/research/dq8/README.md:72-81`
- `quant/research/dq10/validator.py:1-8`
- `quant/research/dq11/validator.py:173-180`

<!-- visible task 88 -->
## quant/research/dq12/** + quant/research/dq13/** + quant/research/dq14/** + quant/research/vg4/** — 11,125 lines
WHAT IT IS: Four local research checkers: DQ-12 matches a spot coin—the actual coin—to its dollar-margined no-expiry future; DQ-13 checks whether market facts were known before a research decision; DQ-14 checks which research files were opened; V-G4 validates daily archives for a quiet-volume bounce study. Hypothesis map: DQ-12 mainly supports H3/H4/H7—normal spot-versus-future gap, reverse gap, and funding-change research; DQ-13 supplies timing checks across H1/H2/H3/H4/H5/H7; DQ-14 supplies research custody for any hypothesis; V-G4 is closest to H2, bounce versus continued fall, but is not registered to an H-number. V-G4 stopped before scoring because one source file repeated a day, so profit stayed unmeasured. None reads a private account, contacts an exchange, or places an order.
SUB-PIECES:
- `dq12/ — 3,478 — checks current spot-versus-future instrument identity from supplied files.`
- `dq12/validator.py — 1,586 — rejects stale, malformed, ambiguous, or mismatched instrument descriptions.`
- `dq12/test_validator.py — 1,538 — attacks the identity checker with bad times, renamed symbols, malformed files, and command inputs.`
- `dq13/ — 3,670 — checks whether price, funding, and market-information facts arrived in time.`
- `dq13/validator.py — 1,842 — orders event, arrival, decision, and claimed-fill times without fetching data.`
- `dq13/test_validator.py — 1,205 — tests ambiguous clocks, stale facts, conflicting records, and malformed inputs.`
- `dq14/ — 3,219 — replays file-access history and checks claims about final untouched test data.`
- `dq14/validator.py — 1,547 — rebuilds open, unpack, and read states and compares them with the claimed summary.`
- `dq14/test_validator.py — 1,332 — tests missing, reordered, altered, duplicated, and falsely reported access events.`
- `vg4/ — 758 — validates stored public daily-price archives; it contains no signal scorer or order path.`
- `vg4/test_experiment.py — 413 — tests archive boundaries, checksums, timestamps, prices, volumes, and duplicate days.`
RUNS NOW?: DEAD — not mounted; its checks and tests run only when launched manually. The production start loads the built server, not these Python folders.
MONEY?: NO — research support only; none is imported by the live basis or volume bots.
REMOVABLE?: YES-BUT offline identity, timing, file-custody, and V-G4 archive verification would disappear; live trading would keep running.
EVIDENCE: `quant/research/dq12/README.md:7` · `quant/research/dq13/README.md:13` · `quant/research/dq14/README.md:5` · `web/public/research-lab/vg4/README.md:44` · `package.json:16`

## Operations and top-level test/evidence source

**Coordinator status correction:** all Ops code rows are DEAD under the order’s strict “live in the deployed process” meaning. Some shard prose uses RUNNING to mean “invoked during an authorized release or maintenance command”; no such command was active, and the observed service directly ran server/dist/index.js.

<!-- visible task 89 -->
## ops/live/** + ops/release-package/** — 10,407 lines
WHAT IT IS: This is the factory and safety kit around the live service. For each new release, it builds Linux output from one exact clean code version, checks every packaged file, installs the release locked against editing, tests it, and changes `current` in one all-or-nothing switch. It can also make a consistent database backup, rebuild an isolated copy from that backup, or return to a compatible earlier release. Packaging and deploy are the new-release path; backup, restore, and manual rollback are separate one-off actions, while automatic rollback is only a guarded response to a failed deploy.
SUB-PIECES:
- `ops/live/ — 7,783 — Host-side commands for release switching, backups, isolated recovery, service startup, and timing checks.`
- `ops/live/bin/ — 7,783 — The executable deploy, backup, restore, rollback, timing, and shared-safety commands.`
- `ops/live/bin/common.sh — 3,546 — Checks one-use permission, paths, locks, state records, health, and the all-or-nothing current-release switch.`
- `ops/live/bin/restore.sh — 1,600 — Checks a backup byte-for-byte and rebuilds it only into an explicit isolated directory, never the live data directory.`
- `ops/live/bin/deploy.sh — 756 — Installs one locked release, tests it before and after switching, restarts the app, and freezes or conditionally rolls back on failure.`
- `ops/live/bin/backup.sh — 599 — Makes one consistent live-database copy, verifies it, and publishes it only after every check passes.`
- `ops/live/bin/latency-bench.mjs — 400 — Plans or, with explicit network permission, measures connection timing to candidate locations.`
- `ops/live/bin/rollback.sh — 373 — Returns to a compatible earlier release, restarts, checks health, and refuses unsafe automatic rollback.`
- `ops/release-package/ — 2,624 — Off-host tools that build and check a repeatable release package without installing or deploying it.`
- `ops/release-package/bin/ — 1,543 — Commands that build Linux release inputs, wrap guarded archives, and recheck them before handoff.`
- `ops/release-package/bin/preflight-i00-release-package.mjs — 389 — Checks an I00 package—the repository’s guarded release format—by privately rebuilding it and matching every byte, file, and permission.`
- `ops/release-package/bin/build-i00-release-package.mjs — 320 — Creates that guarded release package and explicitly gives it no install or deploy permission.`
- `ops/release-package/lib/ — 1,081 — Shared package checking, file-listing, archive, checksum, and Linux-binary inspection code.`
- `ops/release-package/lib/release-package.mjs — 1,081 — Proves clean source identity, exact package contents, safe permissions, repeatable archives, and trusted release checks.`
RUNS NOW?: DEAD (not mounted in the currently deployed process) — these are release and recovery commands invoked only during separately authorized operations. No deploy, backup, restore, or rollback command was active or executed in this audit.
MONEY?: NO — the basis and volume engines do not load these files; this block only prepares and protects the service around them.
REMOVABLE?: YES-BUT the next verified package/deploy and all built-in backup, isolated-restore, and rollback controls break.
EVIDENCE: ops/release-package/README.md:3-32 · ops/i00/bin/release-switch.sh:1388-1395 · ops/live/bin/deploy.sh:678-732 · ops/live/README.md:70-75 · ops/i00/bin/backup-verify.sh:554-560

<!-- visible task 90 -->
## ops/i00/bin (four approval-and-action files) — 10,783 lines

WHAT IT IS: These files guard sensitive maintenance: installing operations code, switching or rolling back a release, backing up the database, checking an isolated restore, and preparing a secret file. They spend an exact owner approval once, launch only the approved program with approved tools and folders, and record what happened. They neither choose trades nor send exchange orders.

SUB-PIECES:

- `record-authorized-action-outcome.mjs — 4,408 lines — Verifies the completed action and writes the final result plus a second record proving it matches observed state; it also manages rollback proof.`
- `run-bound-effect.mjs — 3,333 lines — Launches the approved maintenance action under exact identity, tool, folder, and time limits, then records its start and finish.`
- `verify-authorized-effect-handoff.mjs — 2,348 lines — Runs inside the launched action, rechecks its parent process and permitted resources, and acknowledges that the safety handoff is valid.`
- `validate-authorization.mjs — 694 lines — Matches owner approval against the independently prepared risk and action plan, then consumes that approval so it cannot be reused.`

RUNS NOW?: DEAD (not mounted in the currently deployed process) — these files run only inside an approved production-maintenance command. No such command was active or executed in this audit.

MONEY?: NO — Basis and Volume do not import these files, and their permitted actions are maintenance operations rather than exchange orders.

REMOVABLE?: YES-BUT authorized release switching, rollback, operations installation, backup, isolated restore, and secret-file preparation would stop or lose trustworthy completion records.

EVIDENCE: `ops/i00/bin/release-switch.sh:1366-1395`; `ops/live/bin/common.sh:225-229`; `ops/i00/bin/backup-verify.sh:527-545`; `ops/i00/bin/validate-authorization.mjs:615-639`; `ops/i00/bin/record-authorized-action-outcome.mjs:4341-4397`

<!-- visible task 91 -->
## ops/i00/bin/{produce-deployment-risk-version.mjs,record-release-switch-receipt.mjs,release-switch.sh,rollback-switch.sh,produce-deployment-action-preview.mjs,verify-readback.mjs,verify-cloudflare-readback.mjs,inspect-effect-identity.mjs,verify-app-unit-action-binding.mjs,first-host-readback.mjs} — 8,604 lines

WHAT IT IS: This block is the guarded maintenance door for deployment, meaning putting a version on the server, and rollback, meaning switching to an earlier version. It turns an owner-approved request into exact risk and action records, checks the real host and programs, spends the approval once, invokes the fixed installer or rollback tool, and records what happened. It also proves a clean first host; it never scans markets or trades.

SUB-PIECES:

- `produce-deployment-risk-version.mjs` — 2,591 lines — Checks the release package, host, service-start instructions, command programs, storage paths, and approval limits before writing an action-specific risk record.
- `record-release-switch-receipt.mjs` — 1,595 lines — After a release attempt, it rechecks the active version, service, and health pages before writing the result and matching-proof records.
- `release-switch.sh` — 1,490 lines — Prepares a new or existing host, verifies a one-use approval, runs the fixed installer, and records the outcome.
- `first-host-readback.mjs` — 1,005 lines — Proves a host has no earlier Cosmos release or dirty deployment state and writes four locked evidence files.
- `rollback-switch.sh` — 907 lines — Stages a switch back, spends the one-use approval only after checks pass, runs the fixed rollback tool, and requires a later final check.
- `produce-deployment-action-preview.mjs` — 425 lines — Rereads the risk record and real service-start binding, then writes the exact permitted-action preview tied to the one-use approval.

RUNS NOW?: DEAD — not mounted. The deployed service starts the built server program; these files run only during an owner-started release, rollback, or first-host proof and exit afterward.

MONEY?: NO — they install and prove software; they do not decide, size, or send Basis or Volume trades.

REMOVABLE?: YES-BUT the current app can keep running, while the authorized release, rollback, first-host, backup/restore approval, and proof paths break.

EVIDENCE: ops/i00/bin/produce-deployment-risk-version.mjs:2502; ops/i00/bin/release-switch.sh:1363; ops/i00/bin/rollback-switch.sh:784; ops/i00/bin/first-host-readback.mjs:930; ops/live/systemd/cosmos-app.service:37.

<!-- visible task 92 -->
## ops/i00/bin/{inspect-app-unit.mjs,install-ops-bundle.sh,assemble-release.mjs,preflight.mjs,publish-install-tree.mjs,publish-install-receipt.mjs,validate-release.mjs,app-entrypoint.mjs,assembly-output-policy.mjs,inspect-executable.mjs,verify-donor-root.mjs,verify-donor.mjs,sanitize-donor-env.mjs} — 9,382 lines

WHAT IT IS: This is the guarded release-and-startup machinery: it checks approved source and host evidence, builds a locked release, installs a locked copy of the operations scripts, and records what was installed. Its startup wrapper verifies the active release, optionally loads the server-only Binance secret file, and then starts the application server. It contains no basis calculation, volume signal, or order decision.

SUB-PIECES:

- `inspect-app-unit.mjs — 2,384 — Checks the live or staged Linux service-manager setup, including its startup command, working directory, settings files, secret handoff, permissions, and three added service-setting files.`
- `install-ops-bundle.sh — 1,107 — Installs one fingerprinted, read-only copy of deployment helpers after an owner-authorized zero-money check, without installing or restarting a service.`
- `assemble-release.mjs — 1,052 — Combines tested server and website builds, dependencies, proof records, and operations files into one locked release explicitly marked not deployed.`
- `preflight.mjs — 1,005 — Before deploy or rollback, checks release integrity, fresh host evidence, disk space, database-version safety, and that no exposure or recovery work is open.`
- `publish-install-tree.mjs — 961 — Claims a private staging folder, checks its identity and command files, then moves the frozen helper tree into place without overwriting an existing install.`
- `sanitize-donor-env.mjs — 734 — Keeps only approved deploy or backup settings, fixes required paths and command identities, removes free-form action commands, and emits a private settings file.`
- `verify-donor.mjs — 665 — Checks that the accepted earlier operations source, called the donor, and every approved correction match the exact checked-in files and history.`
- `publish-install-receipt.mjs — 499 — Creates and re-reads a durable install record binding the staged helper tree to its validated release and stating that no service was changed.`
- `validate-release.mjs — 366 — Rechecks release identity, file fingerprints and permissions, signed build proof, acceptance records, database-version compatibility, and locked installed state.`

RUNS NOW?: DEAD (not mounted from this repository path in the observed process) — the live process directly runs `server/dist/index.js`; these assembly, install, and entry-wrapper files act only during separately authorized release or host setup work.

MONEY?: NO — Basis and Volume do not import these files; they are release and host-startup machinery, not an engine runtime dependency.

REMOVABLE?: YES-BUT the current already-running server can continue, while configured wrapper-based startup, guarded release, install, and rollback work would break.

EVIDENCE: `ops/templates/i00/systemd/cosmos-app-runtime.conf.template:11`; `ops/i00/bin/inspect-app-unit.mjs:1923`; `ops/i00/bin/app-entrypoint.mjs:225`; `ops/i00/bin/app-entrypoint.mjs:264`; `ops/i00/bin/install-ops-bundle.sh:1027`.

<!-- visible task 93 -->
## ops/i00 root code + ops/i00/bin remainder — 11,068 lines

WHAT IT IS: This is I00’s guarded production-operations layer for startup credentials, release proof, backups, isolated restores, and safe simulations. It limits operational actions to exact files, identities, single-use approvals, and recorded outcomes. It does not calculate Basis, detect Volume wakeups, or place trades. The 27 files owned by Splits 41B, 41C, and 41D are excluded.

SUB-PIECES:

- `ops/i00/deployment-authorization-contract.mjs — 2,162 — Defines the six permitted operational actions, their exact boundaries, and zero-capital limit.`
- `ops/i00/bin/secrets-provider.mjs — 1,186 — Verifies one machine identity and secret version, then writes only required credential fields without printing their values.`
- `ops/i00/bin/validate-receipt.mjs — 994 — Rejects release or rollback results unless their identities, timing, and evidence agree.`
- `ops/i00/bin/restore-drill-verify.sh — 819 — Restores one approved backup into a separate folder, checks the embedded database, and reports no production change.`
- `ops/i00/bin/backup-verify.sh — 577 — Runs one authorized backup through the accepted operations package and records its outcome.`
- `ops/i00/complete-acceptance-receipt.mjs — 567 — Validates an exact ten-check release record covering source, tests, browser proof, performance, and clean changes.`
- `ops/i00/l15-amendment.mjs — 564 — Verifies L15, the accepted older operations package, plus only its approved corrections.`
- `ops/i00/bin/secret-materialization.mjs — 485 — Consumes one approval, runs the fixed secret provider, and records success or failure without exposing credentials.`
- `ops/i00/simulation-safety.mjs — 433 — Creates private fake-service folders and refuses any test path that intersects production.`
- `ops/i00/bin/verify-build-attestation.mjs — 391 — Verifies the build’s digitally signed proof, source identity, required commands, and file fingerprints.`
- `ops/i00/bin/inspect-backup-source.mjs — 379 — Checks a backup’s contents list, database fingerprint, optional evidence archives, and read-time stability.`
- `ops/i00/ files below 300 lines — 1,188 — authorized-effect-evidence.mjs 242; bound-json-input.mjs 112; canonical-acceptance-validation.mjs 101; cohort-compatibility.mjs 110; json-schema.mjs 197; ledger-compatibility.mjs 62; lib.mjs 226; ops-helper-root.mjs 138.`
- `ops/i00/bin/ files below 300 lines — 1,323 — create-private-temp.mjs 180; create-simulation-root.mjs 11; exposure-from-app.mjs 132; generate-l15-amendment-contract.mjs 238; probe.mjs 63; run-fixed-node-gate.sh 243; seal-simulation-root.mjs 12; validate-config.mjs 238; validate-simulation-env.mjs 149; validate-simulation-path.mjs 12; validate-simulation-root.mjs 11; verify-simulation-command.mjs 11; verify-sqlite-version.mjs 23.`

RUNS NOW?: DEAD — not mounted in the live server. The live service starts `server/dist/index.js` directly; a separate installation template can run credential materialization once before startup, while the remaining files run only during operator or release work.

MONEY?: NO — operational authorization hard-codes capital to zero and contains no Basis or Volume decision logic.

REMOVABLE?: YES-BUT secure credential startup, release acceptance, backup, isolated restore, and guarded deployment operations would break.

EVIDENCE: `ops/live/systemd/cosmos-app.service:37`; `ops/templates/i00/systemd/cosmos-secrets-provider.service.template:19`; `ops/i00/deployment-authorization-contract.mjs:1443`; `ops/i00/bin/secrets-provider.mjs:1098`; `ops/i00/bin/restore-drill-verify.sh:819`

<!-- visible task 101 -->
## `ops/tests/**` excluding `ops/tests/i00/**`, but including `ops/tests/i00/fixtures/**` — 7,009 lines

WHAT IT IS: This is the local and automated safety proof for deployment, rollback, backup/restore, release packaging, service configuration, secret hygiene, and worker-scope controls. It also owns hostile, made-up inputs used by the I00 acceptance tests. It is guard and test code—not live service or trading code.

SUB-PIECES:

- [ops/tests/i00/fixtures/](/Users/cosmosgeek/Desktop/cosmos-live-20260809/ops/tests/i00/fixtures) — 2,361 lines — Test-only stand-ins and evidence makers for authorization, readback, backup, release switching, browser checks, and performance checks. Not a suite; current I00 runner selects suites that call these fixtures. Not run now.
  - [make-complete-acceptance.mjs](/Users/cosmosgeek/Desktop/cosmos-live-20260809/ops/tests/i00/fixtures/make-complete-acceptance.mjs) — 888 lines — Creates made-up acceptance, browser, and performance records so validators can be attacked; it does not perform the recorded checks. Called by a currently selected I00 suite. Not run now.
  - [make-release-switch-authorization-chain.mjs](/Users/cosmosgeek/Desktop/cosmos-live-20260809/ops/tests/i00/fixtures/make-release-switch-authorization-chain.mjs) — 879 lines — Builds a test chain from risk and owner approval through one-use authorization and start/finish receipts. Called by a currently selected release-switch suite. Not run now.
- [test-deploy.sh](/Users/cosmosgeek/Desktop/cosmos-live-20260809/ops/tests/test-deploy.sh) — 1,141 lines — Suite proving local release installation and switching, preflight refusal, rollback/freeze behavior, database barriers, hostile journals, occupied-host safety, and fix-forward handling. Current runner selects it. Not run now.
- [release-package-hostile.mjs](/Users/cosmosgeek/Desktop/cosmos-live-20260809/ops/tests/release-package-hostile.mjs) — 644 lines — Suite body proving reproducible packages and refusal of dirty, aliased, tampered, unsafe-permission, path-escape, checksum-mismatched, and invalid native-file inputs. Current runner selects its wrapper. Not run now.
- [test-rollback.sh](/Users/cosmosgeek/Desktop/cosmos-live-20260809/ops/tests/test-rollback.sh) — 572 lines — Suite proving database barriers are absolute, exposed-money states block automation, forced rollback is explicit, and unsafe or changing evidence causes refusal without mutation. Current runner selects it. Not run now.
- [test-lane-worker-scope-gate.sh](/Users/cosmosgeek/Desktop/cosmos-live-20260809/ops/tests/test-lane-worker-scope-gate.sh) — 501 lines — Suite proving workers cannot hide or import forbidden changes through hostile Git histories, merges, renames, alternate indexes, replaced history, dirty files, or protected-input changes. Current runner selects it. Not run now.
- [lane-worker-scope-gate.sh](/Users/cosmosgeek/Desktop/cosmos-live-20260809/ops/tests/lane-worker-scope-gate.sh) — 330 lines — Gate program checking the exact branch and baseline, allowed paths, protected inputs, and final clean state. Not itself a suite; the currently selected 501-line suite exercises it. Not run now.
- [test-backup-restore.sh](/Users/cosmosgeek/Desktop/cosmos-live-20260809/ops/tests/test-backup-restore.sh) — 306 lines — Suite proving live SQLite backup including pending side-log changes, manifests, checksums, retention, freshness, isolated restore, corruption refusal, and production-path refusal. Current runner selects it. Not run now.

RUNS NOW?: DEAD in the deployed process. The checked-in service starts the built server entry, while this block is reached only by test runners. This audit inspected source and runner wiring only; no current PASS is claimed.

MONEY?: NO. It neither computes the price gap nor decides trade size.

REMOVABLE?: YES-BUT. Live behavior would remain unchanged, but the current automated build would lose or fail its operations checks, and I00 suites outside this block would lose required fixtures.

EVIDENCE:

- [/Users/cosmosgeek/Desktop/cosmos-live-20260809/ops/tests/run-all.sh:2-20](/Users/cosmosgeek/Desktop/cosmos-live-20260809/ops/tests/run-all.sh:2)
- [/Users/cosmosgeek/Desktop/cosmos-live-20260809/.github/workflows/ci.yml:112-116](/Users/cosmosgeek/Desktop/cosmos-live-20260809/.github/workflows/ci.yml:112)
- [/Users/cosmosgeek/Desktop/cosmos-live-20260809/ops/tests/i00/run-all.sh:12-47](/Users/cosmosgeek/Desktop/cosmos-live-20260809/ops/tests/i00/run-all.sh:12)
- [/Users/cosmosgeek/Desktop/cosmos-live-20260809/ops/tests/test-release-package.sh:1-4](/Users/cosmosgeek/Desktop/cosmos-live-20260809/ops/tests/test-release-package.sh:1)
- [/Users/cosmosgeek/Desktop/cosmos-live-20260809/ops/live/systemd/cosmos-app.service:22-37](/Users/cosmosgeek/Desktop/cosmos-live-20260809/ops/live/systemd/cosmos-app.service:22)

<!-- visible task 102 -->
## ops/tests/i00 — alphabetical code files 1–16 — 8,129 lines

WHAT IT IS: These are automated safety checks for deployment, backup, restore, and rollback (returning to the previous release). They use disposable files and fake machine commands to check approvals, service settings, failure records, and recovery behavior. They contain no basis or volume trading logic and are not loaded by the live app.

SUB-PIECES:

- `df32-r3-backup-successor.sh — 664 lines — Proves tampered or hostile backups are rejected and failed restores preserve existing data; current runner: YES, indirectly through test-deploy-portability-008-l15-bytes.sh.`
- `df32-r3-watchdog-successor.sh — 573 lines — Proves the monitor handles dead, stale, or malformed deployment ownership markers while continuing checks and containing failed alert commands; current runner: YES, indirectly through test-deploy-portability-008-l15-bytes.sh.`
- `helpers.sh — 210 lines — Shared disposable-fixture, command-binding, and assertion support; support file, not a suite.`
- `run-all.sh — 70 lines — Selects every test-*.sh suite and routes the historical checks; runner file, not a suite, and CI (automatic checks) calls it.`
- `test-authorized-rollback-lifecycle.sh — 1,866 lines — Proves rollback needs exact approval and evidence, then records success, refusal, frozen, and uncertain outcomes without inventing success; current runner: YES, directly.`
- `test-backup-and-restore-adapters.sh — 812 lines — Proves backup and isolated-restore commands retain one approval chain; current runner: YES, directly, but its real local-effect section requires an explicit Linux administrator-mode opt-in.`
- `test-backup-source-inspector.sh — 433 lines — Proves the backup inventory file binds versions, counts, hashes, and the exact archive list consistently across publisher and readers; current runner: YES, directly.`
- `test-bound-effect-identity.sh — 869 lines — Proves the state-changing command runner receives only its selected program, arguments, files, and evidence; current runner: YES, directly, with its focused producer section conditional.`
- `test-composed-execstart.sh — 45 lines — Proves the provider setting cannot replace the app’s start command or settings file; current runner: YES, directly.`
- `test-cs-03-public-source-admission.sh — 79 lines — Proves live public market-data startup is admitted and conflicting offline mode is refused; current runner: YES, directly.`
- `test-delegation-gates.sh — 1,044 lines — Proves first-machine installation, later deployment, and rollback use prechecked evidence and exact commands while preserving releases and data on refusal; current runner: YES, directly, with privileged actions conditional.`
- `test-deploy-defects-007-backup-access.sh — 76 lines — Proves only the backup service receives read access to exactly two non-secret settings files; current runner: YES, directly.`
- `test-deploy-defects-007-first-host-order.sh — 34 lines — Proves first-machine evidence is prepared before approval and reused unchanged during the switch; current runner: YES, directly.`
- `test-deploy-defects-007-release-switch-receipt.sh — 670 lines — Proves the post-switch proof record binds the exact release and service state while rejecting races, changed commands, and failed health; current runner: YES, directly.`
- `test-deploy-defects-007-watchdog-rotation.sh — 96 lines — Proves monitor logs retain the system-administrator writer and rotate with matching ownership and private file modes; current runner: YES, directly.`
- `test-deploy-portability-008-app-unit-binding.sh — 588 lines — Proves the loaded app-service definition, start command, settings, permissions, and source bytes remain exact; current runner: YES, directly, with the private offline service-manager check limited to administrator-mode Linux.`

RUNS NOW?: DEAD — test-only. The deployed service starts `server/dist/index.js`; automatic checks separately invoke this block’s runner. The runner selects all 12 owned `test-*.sh` suites directly and the two successor suites indirectly. No suite was run during this audit.

MONEY?: NO — the basis and volume processes do not load these files.

REMOVABLE?: YES-BUT deleting this block breaks the currently configured automatic-check command and removes deployment, backup, restore, and rollback safety proof; the live money process itself does not load it.

EVIDENCE:

- `.github/workflows/ci.yml:112-116`
- `ops/tests/i00/run-all.sh:11-24`
- `ops/tests/i00/test-deploy-portability-008-l15-bytes.sh:45-83`
- `ops/live/systemd/cosmos-app.service:22-37`
- `ops/tests/i00/test-authorized-rollback-lifecycle.sh:1204-1269`

<!-- visible task 103 -->
## ops/tests/i00 top-level test files 17–32 — 6,859 lines

WHAT IT IS: These 16 files are deployment-safety tests for installation, authorization, release switching, backup, restore, and first-host setup. They do not run inside the live product or trade money. The exact recount is 6,859 lines; no suite was run now, so no current pass is claimed.

SUB-PIECES:

- `test-deploy-portability-008-bash-canonicality.sh` — 37 lines — proof target: the default Bash path resolves correctly across Linux layouts while unsafe supplied paths remain rejected; runner selection: YES.
- `test-deploy-portability-008-install-wrapper.sh` — 83 lines — proof target: installation uses the exact owner-permission document chain, inherited safe program references, and rejects forged direct calls; runner selection: YES.
- `test-deploy-portability-008-l15-bytes.sh` — 423 lines — proof target: protected historical bytes, safe file references, rollback handoff, backup publication, restore programs, and frozen-marker handling remain exact; runner selection: YES.
- `test-deploy-portability-008-release-validation.sh` — 235 lines — proof target: signed build evidence uses an explicitly trusted key and rejects shortcut links, replaced paths, and changed files; runner selection: YES.
- `test-deploy-portability-008-simulation-paths.sh` — 248 lines — proof target: simulated operations cannot escape their marked directory through relative paths, parent traversal, shortcut links, or directory replacement; runner selection: YES.
- `test-deploy-portability-008-validator-api.sh` — 696 lines — proof target: the permission validator accepts exact system, isolated pre-live, and test documents while rejecting replay, stale evidence, moved files, changed roots, and mixed modes; runner selection: YES.
- `test-deploy-portability-008-validator-bridge.sh` — 145 lines — proof target: validation admits only the current format or one pinned older rollback format, never a caller-selected compatibility shortcut; runner selection: YES.
- `test-deploy-readiness-001-l15-bytes.sh` — 128 lines — proof target: Linux service time limits, installed paths, required programs, backup guards, first-deploy probes, and failure readbacks remain present; runner selection: YES.
- `test-deployment-authorization-producers.sh` — 3,271 lines — proof target: permission and preview documents for installation, release, rollback, backup, isolated restore, and secret setup bind exact programs and files, reject forgery or replay, and have a guarded Linux proof branch; runner selection: YES.
- `test-donor-contract.sh` — 300 lines — proof target: the accepted operations source and corrected inventory remain exact and reject hidden changes, unsafe nodes, missing files, extra files, or altered Git behavior; runner selection: YES.
- `test-effect-identity-binding.sh` — 154 lines — proof target: an operation runs as the exact Linux service user and group and rejects changed service files, altered identity tools, or shortcut aliases; runner selection: YES.
- `test-executable-map-seam.sh` — 82 lines — proof target: the live shell and permission handoff agree on safe program references for every operation type they share; runner selection: YES.
- `test-first-host-001-l15-bytes.sh` — 43 lines — proof target: the first-host refusal guard sits inside the operation lock, checks both release links through safe authority, and retains its race-condition cases; runner selection: YES.
- `test-first-host-readback.sh` — 796 lines — proof target: a genuinely clean first host produces four exact evidence files and rejects residue, unsafe SQLite database programs, ambiguous service states, false absence, and caller-forged clocks; runner selection: YES.
- `test-fix-031-cs-06-l15-bytes.sh` — 30 lines — proof target: data-folder authority and cache rules remain documented and bound in the service file, while an unused notification token remains absent; runner selection: YES.
- `test-install-receipt-publication.sh` — 188 lines — proof target: installation receipts are private, durable, create-only files and cannot overwrite existing data or follow replaced or shortcut-linked directories; runner selection: YES.

RUNS NOW?: DEAD (test-only). The local runner selects every owned `test-*.sh` file, and the repository’s remote check job invokes that runner; this audit executed none of them.

MONEY?: NO. These tests contain no basis or volume trading decisions and are not part of either live money engine.

REMOVABLE?: YES-BUT live trading would continue while deployment, rollback, backup, restore, and first-host safety evidence became incomplete.

EVIDENCE: `ops/tests/i00/run-all.sh:11-24`; `.github/workflows/ci.yml:112-116`; `ops/tests/i00/test-deployment-authorization-producers.sh:43-56`; `ops/tests/i00/test-first-host-readback.sh:240-250`; `ops/tests/i00/test-donor-contract.sh:71-82`

<!-- visible task 104 -->
## ops/tests/i00 files 33–47 — 7,214 lines

WHAT IT IS: These 15 shell-test suites challenge deployment and recovery safety rails in disposable simulations: release installation, go/no-go checks, operator readback, backup/restore, credential fetching, and Linux service wiring. They contain no basis or volume trading logic and are not part of the deployed process. This was source inspection only; no suite was run and no present-day pass is claimed.

SUB-PIECES:

- `test-ops-helper-system-authorization.sh — 385 — checks exact install, release, and rollback permission lists and the derived privileged-helper location; current launcher selects: YES.`
- `test-r3-d-backup-008.sh — 602 — checks tampered or malformed backups, safe restore publication, and preservation after failed restores; current launcher selects: NO, historical file only.`
- `test-r3-d-watchdog-007.sh — 567 — checks deployment-lock ownership, stale or crashed claims, bounded alerts, and continued monitoring; current launcher selects: NO, historical file only.`
- `test-release-and-preflight.sh — 1,233 — checks signed release assembly, file integrity, clean first-host state, deployment blockers, and allowed database versions; current launcher selects: YES.`
- `test-sanitizer-hardening.sh — 521 — checks that deployment environments use fixed roots, commands, health addresses, time limits, and write paths while rejecting aliases and substitutions; current launcher selects: YES.`
- `test-secrets-provider.sh — 1,705 — checks exact cloud identity and authorization, one-use permission, safe credential publication, non-disclosure, and fixed failure reports; current launcher selects: YES.`
- `test-templates-and-schemas.sh — 541 — checks deployment templates, service definitions, configuration rules, and receipt evidence against malformed or forged input; current launcher selects: YES.`
- `test-unit-contract1-provider-binding.sh — 720 — checks Linux service ordering, credential-provider wiring, narrow write authority, independent inspection, and shared rollback verification; current launcher selects: YES.`

RUNS NOW?: DEAD — test-only and not mounted in the deployed processes. The current test launcher would select 13 files; it skips the two historical suites above, verifies their sealed bytes, and runs replacement suites through a current driver. Nothing was executed now.

MONEY?: NO — operations assurance tests, not basis/volume logic or a runtime dependency.

REMOVABLE?: YES-BUT deleting them would break the current operations test launcher and remove release, credential, backup/restore, and service-wiring regression proof; the already-running trading process would not directly change.

EVIDENCE: `ops/tests/i00/run-all.sh:12-24`; `ops/tests/i00/test-deploy-portability-008-l15-bytes.sh:65-83`; `ops/tests/i00/test-r3-d-backup-008.sh:2-5`; `ops/tests/i00/test-release-and-preflight.sh:748-876`; `ops/tests/i00/test-secrets-provider.sh:1087-1179`

## Top-level test and evidence code

<!-- visible task 94 -->
## test/i00/performance/** — 11,622 code lines

WHAT IT IS: This is the manual final-check system for an exact locked software version. It runs repository checks, starts a local-only copy without exchange keys, applies load across three starts, tests restart and forced-crash recovery, checks browser captures, and writes proof records. The frozen pile came from one July 2026 release-candidate acceptance for source ending `198f`: 197 files and 118,998 newline records—36,349 in data files and 82,649 accidental newline bytes inside 146 PNG images, not code. Normal startup does not read it; explicit acceptance and release checks do.

SUB-PIECES:

- `local-acceptance.mjs — 4,475 — Runs the serial final-check chain and binds the exact source, browser proof, load proof, and final locked proof set.`
- `performance.test.mjs — 2,429 — Requires rejection of corrupt, misleading-success, blank, duplicate, malformed, or secret-bearing evidence.`
- `local-proxy-soak.mjs — 2,392 — Starts the app locally without exchange keys and measures load, memory, delay, restart, forced-crash recovery, and database continuity.`
- `acceptance-contract.test.mjs — 1,160 — Tests exact source identity, step order, environment, proof-file binding, and the required proof-only successor version.`
- `contract.mjs — 570 — Holds shared limits, required component and control names, hashes, secret checks, data-shape checks, and write-once proof helpers.`
- `campaign-evidence-contract.test.mjs — 390 — Checks a later exact-candidate campaign’s locked inputs and generated proof files without trusting a changing branch.`

RUNS NOW?: DEAD (test-only; explicit release checks also import it). Normal deployed startup launches only the server application.

MONEY?: NO.

REMOVABLE?: YES-BUT live Basis and Volume behavior stays unchanged; local final acceptance, historical-proof verification, and release packaging or validation that imports these helpers break.

EVIDENCE: `test/i00/performance/README.md:3`; `test/i00/performance/local-acceptance.mjs:361-371`; `docs/archive/i00-phase2/INTEGRATION_CANDIDATE_READY_RECEIPT.md:2024-2111`; `package.json:16`; `ops/i00/bin/assemble-release.mjs:950-963`.

<!-- visible task 95 -->
## `test/i00` excluding `performance/**` — 6,359 lines

WHAT IT IS: This is the acceptance, release-proof, and safety-command layer; it is not a trading engine. It checks exact source history, scans production code for unreviewed network, database, work-queue, or other-program actions, runs Product Assurance, and supplies blocked-until-owner-approval and local operations checks. The excluded frozen pile came from the 2026-07-16 acceptance of candidate `…98f3` and locking record `…239b`: six browser runs, a restart check, a performance load run, and an 11-step full acceptance produced 197 files occupying 59 megabytes—36,349 lines in 51 JSON (text) records plus 82,649 newline bytes in 146 PNG (image) files, or 118,998 counted lines; PNG “lines” are binary data, not code. Only explicit acceptance validation reads those records and images; live server and web code do not, so deleting the pile changes no running behavior but destroys that historical proof and makes its validation fail.

SUB-PIECES:

- `donor-equality.mjs — 1,689 lines — Checks that all 16 earlier approved source versions, their approval records, combination order, and named exclusions still match the locked source history.`
- `git-provenance.mjs — 1,229 lines — Uses Git, the source-history system, to prove exact file origins, owner instructions, approval records, and Product Assurance inventories.`
- `commands/ — 756 lines — Tests visible owner commands, safe paths, release records, the full-acceptance entry point, and approved-source equality while rejecting unsafe or incomplete requests.`
- `product-assurance-operation-overlay.mjs — 585 lines — Maps scanned production network, database, work-queue, and other-program actions to approved owners and rejects anything without one.`
- `product-assurance-provenance.test.mjs — 308 lines — Feeds damaged inventories and false source-history claims into Product Assurance to prove they are rejected.`

RUNS NOW?: DEAD (not mounted; test/command-only) — The deployed start path is `server/dist/index.js`; this block is reached only by explicit owner, local-operations, acceptance, or Product Assurance commands. Current process inspection found no `test/i00` process.

MONEY?: NO — It neither calculates Basis or Volume decisions nor sits in their live imports. The private-read and signed-test wrappers only report that owner approval is required and perform no action.

REMOVABLE?: YES-BUT live product behavior stays unchanged; source-history checks, report generation, Product Assurance, acceptance, private/signed status commands, and local backup, restore, release, deploy, and rollback checks break.

EVIDENCE: package.json:16-26 · test/i00/owner-gated-command.mjs:3-30 · test/i00/performance/local-acceptance.mjs:3284-3301 · verification/product-truth-20260716/ROLE3_C2_RECEIPT.md:22-35 · verification/product-truth-20260716/ROLE3_C2_RECEIPT.md:96-107

<!-- visible task 153 -->
## test/productAssurance/systemic/{stability,assuranceCase,agentBoundary}/ — 10,674 lines

WHAT IT IS: These are offline safety tests for automated repair, evidence-backed safety claims, and a tightly boxed-in diagnostic agent. They ensure missing, stale, contradictory, forged, or self-certified evidence becomes unknown or failed instead of healthy. They also ensure displays, draft connections, fake providers, and repair helpers cannot issue commands, reach the network, use money, or grant themselves authority. They do not implement Basis or Volume trading and are absent from the deployed application.

SUB-PIECES:

- `stability/` — 4,357 — Tests cancellation, restart, resource pressure, and automatic-repair safeguards.
- `stability/repair-loop.test.mjs` — 1,126 — Attacks repair with stale ownership, no progress, oscillation, competing controllers, bad restart proof, exhausted budgets, and forged success.
- `stability/view-model.test.mjs` — 1,065 — Ensures the display version repeats source evidence faithfully and invents neither healthy state nor effects.
- `stability/contracts.test.mjs` — 709 — Locks record shapes, owner links, timing, hard limits, and unknown-value rules for cancellation, repair, and resources.
- `stability/resource-evidence.test.mjs` — 473 — Checks eight resource families, burn and budget facts, forecasts, top consumers, safety-shutoff evidence, and command-free recommendations.
- `stability/cancellation.test.mjs` — 369 — Checks deadlines, late results, exclusive ownership, observed-result checking, detached recovery, and restart binding.
- `assuranceCase/` — 3,672 — Tests whether thirteen required safety claims are supported by fresh, independent evidence and displayed without command authority.
- `assuranceCase/view-model.test.mjs` — 360 — Ensures the display preserves evidence, expiry, dependencies, failures, and unknowns without recomputation.
- `assuranceCase/closure-redteam.test.mjs` — 339 — Attacks malformed nested input, shared producer/checker identities, invalid timing, and shortened failure paths.
- `assuranceCase/view-boundary-redteam.test.mjs` — 339 — Attacks the display boundary with dependency cycles, stale claims, shared evidence, forged healthy state, missing paths, and enlarged deadlines.
- `assuranceCase/final-law-closure.test.mjs` — 336 — Closes loopholes involving reason labels, identity reuse, deadlines, evidence ownership, and stable ordering.
- `assuranceCase/contracts.test.mjs` — 307 — Locks the thirteen-claim dependency map, accepted upstream evidence, independent checking rules, limits, and safe recommendations.
- `agentBoundary/` — 2,645 — Tests diagnostic-agent identity, its sealed test box, fake provider, retained trace, repair evidence, stored history, promotion rules, and display.
- `agentBoundary/promotion-repair-corpus.test.mjs` — 810 — Requires independent repair and sanitized-history proof before promotion, automatically demotes drift, and bars capital or external privileges.
- `agentBoundary/workload-view-insertion.test.mjs` — 651 — Ensures the diagnostic display and proposed connections show owner, age, blockers, and missing wiring without inventing healthy state.
- `agentBoundary/workload-sandbox.test.mjs` — 385 — Checks identity rotation and revocation, kill state, permitted tools, denied network access, budgets, expiry, and fake-provider binding.

RUNS NOW?: DEAD (test-only) — the deployed server starts at `server/dist/index.js`, not under `test/**` (`package.json:16`), and these files import only Node test/file tools plus checked-in example helpers. Repository test commands do select them through a file-list-driven runner (`test/i00/run-product-assurance.mjs:153`): 551 declared selections—211 stability, 231 assurance-case, and 109 agent-boundary. This audit ran no tests, so current results are UNKNOWN. Line routing matches exactly: 10,674 measured versus 10,674 expected. One deliberate file-level exception exists: `agentBoundary/receipt-state.test.mjs` is listed for custody but not executed; its single checkout-sensitive assertion is replaced by two saved-version proofs. Four other checkout-sensitive assertions inside selected scope/purity files are likewise replaced. `schema-validator.mjs` remains reachable as a helper imported by selected tests.

MONEY?: NO — these files test assurance examples, not Basis or Volume logic, and neither money engine imports them. “Basis” in `basis-certified-separation-redteam.test.mjs` means the evidence used for certification, not the Basis trading strategy.

REMOVABLE?: YES-BUT removing them under the current file lists breaks `npm test`, `npm run test:all`, and Product Assurance inventory/import gates, while deleting safeguards against false healthy repair and agent evidence; deployed runtime behavior itself would not change.

EVIDENCE:

- `package.json:16`
- `test/i00/run-product-assurance.mjs:153`
- `fixtures/i00/product-assurance-manifest.v1.json:469`
- `test/productAssurance/systemic/stability/repair-loop.test.mjs:157`
- `test/productAssurance/systemic/assuranceCase/contracts.test.mjs:75`

<!-- visible task 154 -->
## test/productAssurance/** excluding systemic/stability/**, systemic/assuranceCase/**, and systemic/agentBoundary/** — 10,138 lines

WHAT IT IS: This is the product’s safety proof kit, not trading logic: it finds network, stream, queue, database, deployment, command, and money-changing server sites, then checks that proof records cannot create false authority or false health. Its suites cover action evidence, operator-panel truth, finite safety models, hazard coverage, operating history, and service targets; separate utilities check change scope and secret-like text or generate historical evidence. Static wiring reaches all 35 tests, both cockpit helpers, and the operation scanner; current runners do not execute `generate-closure.mjs` or `scope-purity.mjs`. The live-tree recount is exactly 40 files and 10,138 lines; the original routing list covers `server/src/productAssurance`, not this test subtree, so Task 154 fills that routing gap while the three named exclusions remain outside this block.

SUB-PIECES: Recursive directory totals overlap their child rows and must not be added together.

- `systemic/ — 8,304 — The owned portion collects five proof families covering evidence, panels, finite models, hazards, and operating measurements.`
- `systemic/actionEvidence/ — 1,650 — Checks five evidence classes for freshness, independence, exact ownership, and zero approval or execution authority.`
- `systemic/cockpit/ — 1,994 — Checks 18 operator surfaces so missing, stale, synthetic, or contradictory facts cannot appear healthy.`
- `systemic/cockpit/support/ — 523 — Supplies synthetic panel observations and strict test-only data-shape checking.`
- `systemic/formal/ — 1,484 — Checks thirteen finite models for basis, volume, cancellation, recovery, fencing, and durable control without claiming live proof.`
- `systemic/hazard/ — 925 — Checks hazard, loss, assumption, expiry, dependency, and exact coverage rules using non-authoritative fixtures.`
- `systemic/observability/ — 2,251 — Checks release inventory, 25 service targets, 23 historical measurements, and complete event accounting.`
- `generate-closure.mjs — 708 — When manually invoked, verifies pinned inputs and writes twelve historical reports, evidence outputs, and a receipt.`
- `production-operation-scan.mjs — 927 — Reads server source as text, classifies potentially effectful sites, and reports every site lacking a reviewed mapping.`
- `systemic/actionEvidence/authority-refusal.test.mjs — 311 — Proves assurance evidence cannot approve, admit, block, rank, execute, or dispatch.`
- `systemic/actionEvidence/false-green-regressions.test.mjs — 739 — Attacks stale, forged, cyclic, partial-fill, cancellation, halt, repair, and recovery evidence.`
- `systemic/cockpit/contract-and-projection.test.mjs — 766 — Checks panel contracts, freshness, release identity, denominators, controls, and healthy-state rules.`
- `systemic/cockpit/support/json-schema-2020-12-subset.mjs — 389 — Implements the allowed test-only data-shape rules and rejects unrecognized rules.`
- `systemic/formal/contracts.test.mjs — 674 — Checks model binding, hostile counterexamples, report separation, and closed evidence shapes.`
- `systemic/formal/explicit-state.test.mjs — 537 — Explores thirteen finite models and checks deterministic failures, progress, truncation, and hostile inputs.`
- `systemic/observability/conservation.test.mjs — 470 — Accounts for expected work through intake, processing, completion, duplication, gaps, incidents, and sampling.`
- `systemic/observability/historical-series.test.mjs — 468 — Checks measurement identity, units, exact decimals, release binding, freshness, and denominators.`
- `systemic/observability/release-manifest.test.mjs — 600 — Prevents omissions, extras, dependency drift, stale evidence, or self-reported readiness from appearing healthy.`
- `systemic/observability/slo-trend.test.mjs — 344 — Checks service-target windows, percentiles, error budgets, expiry, incidents, and safe risk reduction.`

RUNS NOW?: DEAD — test-only. The deployed process starts `server/dist/index.js`, and server compilation includes `server/src`, not `test/**`; package runners separately select 35 tests plus three imported helpers (`package.json:16`; `server/tsconfig.json:6`; `package.json:88-95`). This proves source and runner reachability only: no test result was measured or claimed.

MONEY?: NO. It is neither Basis/Volume logic nor loaded by their live server chain; its formal tests model money-failure cases only through fixtures.

REMOVABLE?: YES-BUT removing it breaks Product Assurance, the root and full test gates, source-history inventory, static operation coverage, and historical evidence regeneration; it does not remove live Basis/Volume behavior.

EVIDENCE:

- `package.json:88-95`
- `test/i00/run-product-assurance.mjs:138-160`
- `fixtures/i00/product-assurance-manifest.v1.json:323-419`
- `test/productAssurance/production-operation-scan.mjs:825-875`
- `test/productAssurance/systemic/actionEvidence/authority-refusal.test.mjs:41-75`

<!-- visible task 155 -->
## test/aiOps/a5 — 1,380 lines

WHAT IT IS: These files exercise the fifth automation-safety group with 120 scripted failure cases and independent checks designed to catch false passes. They verify fixed fake inputs, exact source-control identity, no outbound network use, and zero product effects; they cannot command the live service.

SUB-PIECES:

- `oracle-mutation.test.mjs` — 326 lines — Alters accepted evidence in hostile ways to ensure each checker rejects a false pass.
- `scripted-subject.test.mjs` — 304 lines — Runs generic fake-event handlers for all 120 cases without using scenario labels as answers.

RUNS NOW?: DEAD — test-only. The automation runner discovers this directory, and the main test command can reach it through gate coverage ([server/test/run-ai-ops.mjs:266](/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/test/run-ai-ops.mjs:266)); the deployed server starts only `server/dist/index.js` ([package.json:16](/Users/cosmosgeek/Desktop/cosmos-live-20260809/package.json:16)). TEST RESULTS: UNKNOWN — no tests were run.

MONEY?: NO — it checks future automation behavior and is not imported by either live money engine.

REMOVABLE?: YES-BUT the main test command loses this automation-safety group and the shared source-control identity helper used by server tests.

EVIDENCE: [test/aiOps/a5/catalog-coverage.test.mjs:33](/Users/cosmosgeek/Desktop/cosmos-live-20260809/test/aiOps/a5/catalog-coverage.test.mjs:33); [test/aiOps/a5/catalog-coverage.test.mjs:40](/Users/cosmosgeek/Desktop/cosmos-live-20260809/test/aiOps/a5/catalog-coverage.test.mjs:40); [test/aiOps/a5/campaign.test.mjs:7](/Users/cosmosgeek/Desktop/cosmos-live-20260809/test/aiOps/a5/campaign.test.mjs:7); [test/aiOps/a5/campaign.test.mjs:19](/Users/cosmosgeek/Desktop/cosmos-live-20260809/test/aiOps/a5/campaign.test.mjs:19).

## test/obsShadow — 1,041 lines

WHAT IT IS: These tests describe six monitoring views: history, release inventory, missing telemetry, capacity forecasts, paging evidence, and synthetic incident drills. They preserve `UNKNOWN` when evidence is missing and cannot issue commands; only the paging and drill adapters exist, and both remain prepared but unconnected.

SUB-PIECES:

- `view-contracts.test.mjs` — 633 lines — Checks the six proposed monitoring views, their source evidence, hostile inputs, and no-command boundary.

RUNS NOW?: DEAD — not mounted. Its own contract labels every view as not mounted ([test/obsShadow/view-contracts.test.mjs:206](/Users/cosmosgeek/Desktop/cosmos-live-20260809/test/obsShadow/view-contracts.test.mjs:206)), and the main test list does not select this family ([test/run-test-all-built.mjs:7](/Users/cosmosgeek/Desktop/cosmos-live-20260809/test/run-test-all-built.mjs:7)). TEST RESULTS: UNKNOWN — no tests were run.

MONEY?: NO — these are unconnected monitoring checks, not basis or volume logic.

REMOVABLE?: YES-BUT the proposed monitoring-view checks and sealed evidence records disappear; live behavior does not change.

EVIDENCE: [test/obsShadow/view-contracts.test.mjs:206](/Users/cosmosgeek/Desktop/cosmos-live-20260809/test/obsShadow/view-contracts.test.mjs:206); [test/obsShadow/view-contracts.test.mjs:277](/Users/cosmosgeek/Desktop/cosmos-live-20260809/test/obsShadow/view-contracts.test.mjs:277); [test/obsShadow/view-contracts.test.mjs:344](/Users/cosmosgeek/Desktop/cosmos-live-20260809/test/obsShadow/view-contracts.test.mjs:344); [test/obsShadow/view-contracts.test.mjs:454](/Users/cosmosgeek/Desktop/cosmos-live-20260809/test/obsShadow/view-contracts.test.mjs:454).

## test/opsShadow — 2,188 lines

WHAT IT IS: These files check the operational shell around the app: Linux services, backups, restores, rollback, private tunnel boundaries, secret loading, lock ownership, and evidence records. The large contract rejects weakened safety rules or changed history; its standalone runner is designed around fake local services with outbound network access blocked.

SUB-PIECES:

- `contract.mjs` — 1,263 lines — Defines the operational safety rules, exact evidence shape, focused command list, and historical bindings.

RUNS NOW?: DEAD — test-only and not selected by the main test command. A separate focused runner names four local proof groups ([test/opsShadow/contract.mjs:151](/Users/cosmosgeek/Desktop/cosmos-live-20260809/test/opsShadow/contract.mjs:151)), but the approved root list does not invoke it ([test/run-test-all-built.mjs:7](/Users/cosmosgeek/Desktop/cosmos-live-20260809/test/run-test-all-built.mjs:7)). TEST RESULTS: UNKNOWN — no tests were run.

MONEY?: NO — this protects operational safety but is not money logic or a live engine dependency.

REMOVABLE?: YES-BUT the live operations files remain while their focused conformance checks and evidence-record verifier disappear.

EVIDENCE: [test/opsShadow/contract.mjs:151](/Users/cosmosgeek/Desktop/cosmos-live-20260809/test/opsShadow/contract.mjs:151); [test/opsShadow/contract.mjs:648](/Users/cosmosgeek/Desktop/cosmos-live-20260809/test/opsShadow/contract.mjs:648); [test/opsShadow/contract.mjs:749](/Users/cosmosgeek/Desktop/cosmos-live-20260809/test/opsShadow/contract.mjs:749); [test/opsShadow/run-focused.mjs:125](/Users/cosmosgeek/Desktop/cosmos-live-20260809/test/opsShadow/run-focused.mjs:125); [test/opsShadow/validate-receipt.mjs:31](/Users/cosmosgeek/Desktop/cosmos-live-20260809/test/opsShadow/validate-receipt.mjs:31).

## test/realGaps — 820 lines

WHAT IT IS: These are five focused regressions for earlier gaps: a two-step data-lock and basis-path check, a locked research-model setup, exact historical-evidence reconstruction, and the continuous-integration workflow contract. Three executable scripts have separate package commands; the two `.test.mjs` contracts are selected by neither those commands nor the main test command.

SUB-PIECES:

- `camp-091-exact-evidence.mjs` — 470 lines — Builds temporary source-control histories and tries hostile evidence changes against the historical verifier.

RUNS NOW?: DEAD — test-only. Three of five files have separate manual package commands ([package.json:60](/Users/cosmosgeek/Desktop/cosmos-live-20260809/package.json:60)); none is in the main test list. Source drift exists: `q-116` expects a pinned count of 3,063 ([test/realGaps/q-116-quant-bootstrap.mjs:87](/Users/cosmosgeek/Desktop/cosmos-live-20260809/test/realGaps/q-116-quant-bootstrap.mjs:87)), while the current Quant runner says 3,243 ([test/run-quant-gates.mjs:30](/Users/cosmosgeek/Desktop/cosmos-live-20260809/test/run-quant-gates.mjs:30)). That is a source-level mismatch, not an executed test result; TEST RESULTS remain UNKNOWN.

MONEY?: NO — one script checks a basis regression, but this directory contains verification launchers rather than live basis or volume logic.

REMOVABLE?: YES-BUT the three named manual commands and their historical regression coverage disappear.

EVIDENCE: [package.json:60](/Users/cosmosgeek/Desktop/cosmos-live-20260809/package.json:60); [test/realGaps/run-fix-005-merged-regression.mjs:8](/Users/cosmosgeek/Desktop/cosmos-live-20260809/test/realGaps/run-fix-005-merged-regression.mjs:8); [test/realGaps/q-116-quant-bootstrap.mjs:75](/Users/cosmosgeek/Desktop/cosmos-live-20260809/test/realGaps/q-116-quant-bootstrap.mjs:75); [test/realGaps/camp-091-exact-evidence.mjs:225](/Users/cosmosgeek/Desktop/cosmos-live-20260809/test/realGaps/camp-091-exact-evidence.mjs:225); [test/realGaps/fix-170-ci-workflow.test.mjs:18](/Users/cosmosgeek/Desktop/cosmos-live-20260809/test/realGaps/fix-170-ci-workflow.test.mjs:18).

## test/replayShadow — 1,217 lines

WHAT IT IS: These tests validate fixed fake event sequences and plans for restarts, stale data, partial fills, clock or rate errors, recovery, latency, load, and long-run load. They forbid candidate identities, live execution authority, and heavy execution; every proposed connection remains unmounted.

SUB-PIECES:

- `contracts.test.mjs` — 631 lines — Checks the replay corpus, bounded plans, proposed connections, source purity, and no-network boundary.
- `adversarial.test.mjs` — 446 lines — Corrupts corpus and plan shapes to ensure unsafe or misleading inputs are rejected.

RUNS NOW?: DEAD — not mounted and test-only. The files explicitly keep insertion requests unmounted ([test/replayShadow/contracts.test.mjs:537](/Users/cosmosgeek/Desktop/cosmos-live-20260809/test/replayShadow/contracts.test.mjs:537)); one server test merely accepts the replay path as a valid reference and does not execute it ([server/test/intelligenceFoundation/contracts/contracts.test.mjs:246](/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/test/intelligenceFoundation/contracts/contracts.test.mjs:246)). TEST RESULTS: UNKNOWN — no tests were run.

MONEY?: NO — the fake sequences cover money-adjacent failures but are not imported by the live engines.

REMOVABLE?: YES-BUT the replay corpus and hostile-input verification disappear; live trading behavior does not change.

EVIDENCE: [test/replayShadow/contracts.test.mjs:133](/Users/cosmosgeek/Desktop/cosmos-live-20260809/test/replayShadow/contracts.test.mjs:133); [test/replayShadow/contracts.test.mjs:325](/Users/cosmosgeek/Desktop/cosmos-live-20260809/test/replayShadow/contracts.test.mjs:325); [test/replayShadow/contracts.test.mjs:537](/Users/cosmosgeek/Desktop/cosmos-live-20260809/test/replayShadow/contracts.test.mjs:537); [test/replayShadow/adversarial.test.mjs:31](/Users/cosmosgeek/Desktop/cosmos-live-20260809/test/replayShadow/adversarial.test.mjs:31); [test/replayShadow/landed-contracts.test.mjs:110](/Users/cosmosgeek/Desktop/cosmos-live-20260809/test/replayShadow/landed-contracts.test.mjs:110).

## test/runbookShadow — 2,057 lines

WHAT IT IS: These files provide eight deterministic emergency drills for source loss, stale truth, ambiguous restart, monitor failure, rollback, restore, reconciliation failure, and emergency stop. Each drill imports real owner logic into a synthetic run, blocks network use, records zero effects, and emits a pass/fail evidence record.

SUB-PIECES:

- `lib/` — 1,198 lines — Contains the shared drill runtime, import loader, network guard, evidence-record builder, and command wrapper.
- `lib/runner.mjs` — 798 lines — Implements all eight drills and compares reproduced evidence against the claimed record.

RUNS NOW?: DEAD — not mounted and test-only. The proposed product connection explicitly requires a later owner mount ([test/runbookShadow/projection-contract.test.mjs:99](/Users/cosmosgeek/Desktop/cosmos-live-20260809/test/runbookShadow/projection-contract.test.mjs:99)); `run-all.mjs` is manually executable, but no package or main runner selects this family. TEST RESULTS: UNKNOWN — no tests were run.

MONEY?: NO — the drills read money-adjacent safety logic, but production does not import this test runtime.

REMOVABLE?: YES-BUT the eight emergency-drill commands and their reproducible evidence records disappear; the live product remains unchanged.

EVIDENCE: [test/runbookShadow/lib/constants.mjs:40](/Users/cosmosgeek/Desktop/cosmos-live-20260809/test/runbookShadow/lib/constants.mjs:40); [test/runbookShadow/lib/runner.mjs:732](/Users/cosmosgeek/Desktop/cosmos-live-20260809/test/runbookShadow/lib/runner.mjs:732); [test/runbookShadow/projection-contract.test.mjs:82](/Users/cosmosgeek/Desktop/cosmos-live-20260809/test/runbookShadow/projection-contract.test.mjs:82); [test/runbookShadow/lib/cli.mjs:4](/Users/cosmosgeek/Desktop/cosmos-live-20260809/test/runbookShadow/lib/cli.mjs:4); [test/runbookShadow/import-purity.test.mjs:4](/Users/cosmosgeek/Desktop/cosmos-live-20260809/test/runbookShadow/import-purity.test.mjs:4).

## test/*.mjs — 1,088 lines

WHAT IT IS: These seven root files are the test control tower: they run the approved full list, add automation and research-model checks, choose research-model modes, account for results, and supervise launched programs and timeouts. The environment bootstrap is separate and installs pinned Python dependencies only when explicitly invoked. Across all seven blocks, the actual working tree contains 59 owned files and exactly 9,791 lines, with no owned uncommitted file and no line-routing discrepancy. There is a runner-selection discrepancy: the main test command reaches this root chain and `aiOps/a5`, but not the other five child families; only three `realGaps` launchers have separate commands.

SUB-PIECES:

- `run-quant-gates.mjs` — 527 lines — Selects research-model checks, validates exact result totals, verifies registries and protocols, and controls temporary outputs.

RUNS NOW?: DEAD — test-only in the deployed process. Safe process inspection found only the Vite web server and `server/dist/index.js` on the two live ports, matching the server start command ([package.json:16](/Users/cosmosgeek/Desktop/cosmos-live-20260809/package.json:16)); six root files are reachable from the main test command, while the bootstrap has only its separate command ([package.json:44](/Users/cosmosgeek/Desktop/cosmos-live-20260809/package.json:44)). TEST RESULTS: UNKNOWN — no tests were run.

MONEY?: NO — these files launch checks against research and engine code, but neither live money engine imports them.

REMOVABLE?: YES-BUT the main test command, continuous-integration full run, research-model commands, timeout handling, and result accounting break.

EVIDENCE: [package.json:93](/Users/cosmosgeek/Desktop/cosmos-live-20260809/package.json:93); [test/run-test-all-built.mjs:7](/Users/cosmosgeek/Desktop/cosmos-live-20260809/test/run-test-all-built.mjs:7); [test/run-gate-coverage.mjs:7](/Users/cosmosgeek/Desktop/cosmos-live-20260809/test/run-gate-coverage.mjs:7); [test/run-quant-gates.mjs:483](/Users/cosmosgeek/Desktop/cosmos-live-20260809/test/run-quant-gates.mjs:483); [test/runner-process-tree.mjs:59](/Users/cosmosgeek/Desktop/cosmos-live-20260809/test/runner-process-tree.mjs:59).

## Fixtures, verification, and packages code

<!-- visible task 96 -->
## fixtures/productAssurance/systemic/formal/** + fixtures/productAssurance/systemic/agentBoundary/** — 11,977 code lines
WHAT IT IS: This is offline proof and test code, not a trading bot. `formal/**` walks every allowed step in small, fixed simulations of order, recovery, basis, volume, and control failures; `agentBoundary/**` checks rules for a future automated fault-diagnosis helper. Its record-shape rules and canned test data make those checks repeatable, but it cannot contact an exchange, place orders, or issue live commands.

SUB-PIECES:

- `formal/ — 7,180 lines — Holds the offline simulations, evidence checks, and canned proof records.`
- `formal/contracts/ — 1,734 lines — Validates failed-simulation reports and whether model claims match implementation evidence.`
- `formal/contracts/conformance.mjs — 540 lines — Checks that every promised model item has matching source and rerun evidence.`
- `formal/contracts/triage.mjs — 511 lines — Validates and classifies failed simulation paths using stable fingerprints.`
- `formal/contracts/report.mjs — 322 lines — Rejects malformed or internally inconsistent simulation reports.`
- `formal/explicitState/ — 4,072 lines — Defines thirteen bounded simulations and deliberately broken versions that prove the checks can catch faults.`
- `formal/explicitState/kernel.mjs — 766 lines — Walks every reachable situation within fixed limits and reports broken safety or completion rules.`
- `formal/fixtures/ — 1,374 lines — Supplies canned evidence and expected mappings for the formal tests.`
- `formal/fixtures/conformance-fixtures.mjs — 615 lines — Supplies expected matches between models, source, and rerun evidence.`
- `formal/fixtures/transition-conformance-fixtures.mjs — 542 lines — Maps later order, basis, volume, exchange-copy, and control steps to named source evidence.`
- `agentBoundary/ — 4,797 lines — Defines offline rules and test records for a tightly restricted diagnostic helper.`
- `agentBoundary/evaluators.mjs — 2,852 lines — Calculates pass, fail, or unknown decisions for identity, isolation, privacy, self-correction, repair proof, and learning-data release without changing outside state.`
- `agentBoundary/agent-boundary-v1.fixtures.mjs — 875 lines — Supplies canned identity, diagnostic, repair, provider, and data-release cases.`
- `agentBoundary/view-models.mjs — 605 lines — Turns already-decided results into display-ready worker, run, and stop-control summaries.`
- `agentBoundary/provider-stub.mjs — 332 lines — Implements a fake one-call provider that returns a prewritten proposal and cannot execute tools or affect operations.`

RUNS NOW?: DEAD (test-only; production starts from `server/dist/index.js`, test suites import these modules, and the automation module merely catalogs agent-boundary files as donor/reference material).

MONEY?: NO — some simulations describe basis and volume lifecycles, but neither running money engine loads this block and it has no exchange or order authority.

REMOVABLE?: YES-BUT product-assurance tests, formal proof records, agent-boundary tests, and automation donor-catalog checks break; deployed basis and volume behavior does not.

EVIDENCE: `fixtures/productAssurance/systemic/formal/README.md:3-24`; `package.json:16`; `package.json:88-91`; `fixtures/i00/product-assurance-manifest.v1.json:422-448`; `server/src/aiOps/manifests/artifacts.ts:86-90`

<!-- visible task 97 -->
## fixtures/productAssurance/systemic/stability/** + fixtures/productAssurance/systemic/assuranceCase/** — 11,878 lines

WHAT IT IS: This is a test-only safety proof kit built from fixed fake examples; it is not a live service. Stability checks cancellation deadlines, leases (time-limited ownership), repair attempts, restarts, resource limits, and late results. Assurance Case builds a linked record of safety claims and evidence, checks freshness and reviewer independence, carries `FAIL` or `UNKNOWN` through dependent claims, and prepares read-only display data.

SUB-PIECES:

- `stability/ — 6,904 — Complete fixed-example kit for cancellation, repair-loop, restart, and resource-safety rules.`
- `stability/drafts/ — 416 — Proposed future handoffs that remain unconfigured and powerless.`
- `stability/contracts.mjs — 1,824 — Defines allowed evidence shapes and rejects malformed cancellation, repair, and resource records.`
- `stability/drafts/rows.mjs — 416 — Lists proposed insertion points without registering or enabling them.`
- `stability/fixtures.mjs — 1,205 — Supplies fixed good and bad cancellation, repair, and resource examples.`
- `stability/integrity.mjs — 319 — Safely copies evidence and creates stable digital fingerprints.`
- `stability/reference-evaluator.mjs — 1,308 — Grades cancellation, repair progress, restart protection, and resource-budget evidence.`
- `stability/view-model.mjs — 1,832 — Converts grades into display-ready status while issuing no controls.`
- `assuranceCase/ — 4,974 — Complete fixed-example safety-claim and evidence checker.`
- `assuranceCase/contracts/ — 1,581 — Defines the allowed case, claim, evidence, and upstream-assumption records.`
- `assuranceCase/fixtures/ — 611 — Creates complete good cases and deliberately hostile variants.`
- `assuranceCase/reference/ — 2,779 — Contains the case grader and read-only display formatter.`
- `assuranceCase/contracts/schema.mjs — 481 — Names thirteen required safety claims, their owners, evidence types, and limits.`
- `assuranceCase/contracts/validation.mjs — 946 — Rejects broken links, missing claims, cycles, forged identities, and unsafe evidence.`
- `assuranceCase/fixtures/adversarial.mjs — 343 — Builds expired, self-verified, shared-failure, contradictory, and forged test cases.`
- `assuranceCase/reference/evaluator.mjs — 884 — Grades evidence and carries failures or uncertainty through every dependent claim.`
- `assuranceCase/reference/view-model.mjs — 1,893 — Rechecks graded cases and produces summaries, drill-down records, and no controls.`

RUNS NOW?: DEAD — test-only and not mounted in the deployed process. Production source records these paths only as catalog text; executable imports are under tests, and the checked-in test list mounts both suites only for Product Assurance checks.

MONEY?: NO — it contains no Basis or Volume decision logic and is not loaded by either running engine.

REMOVABLE?: YES-BUT removing it breaks Product Assurance safety tests, stored identity/history checks, and catalog references; live Basis and Volume behavior does not change.

EVIDENCE: `fixtures/productAssurance/systemic/stability/contracts.mjs:1`; `fixtures/productAssurance/systemic/stability/reference-evaluator.mjs:468`; `fixtures/productAssurance/systemic/assuranceCase/contracts/schema.mjs:231`; `fixtures/productAssurance/systemic/assuranceCase/reference/evaluator.mjs:824`; `fixtures/i00/product-assurance-manifest.v1.json:490-568`

<!-- visible task 98 -->
## fixtures/productAssurance/systemic/actionEvidence/** + observability/** + cockpit/** — 11,382 code lines

WHAT IT IS: This is a test-only safety kit, not a trading engine. It creates made-up action examples, checks monitoring and release evidence for missing, stale, or contradictory facts, and calculates the cockpit state a truthful panel should show. It catches “false green”: a healthy-looking result that the evidence does not justify.

SUB-PIECES:

- `actionEvidence/ — 4,150 — Checks supporting evidence for order intents, cancellations, repairs, halts, and recovery steps.`
- `actionEvidence/contracts/ — 2,542 — Defines allowed data shapes and strict refusal rules.`
- `actionEvidence/contracts/validation.mjs — 1,461 — Rejects malformed, stale, altered, secret-bearing, or inconsistent evidence.`
- `actionEvidence/contracts/schema.mjs — 964 — Lists allowed action types, evidence families, owners, limits, and the no-authority rule.`
- `actionEvidence/fixtures/ — 771 — Builds fixed pass, fail, and unknown test examples.`
- `actionEvidence/fixtures/baseline.mjs — 509 — Builds the complete known-good example for each action type.`
- `actionEvidence/reference/ — 834 — Holds the independent test judge.`
- `actionEvidence/reference/evaluator.mjs — 833 — Judges evidence and prevents supporting material from becoming permission to act.`
- `observability/ — 3,773 — Checks release claims, measurements over time, reliability targets, and important-event accounting.`
- `observability/release-manifest-evaluator.mjs — 1,195 — Compares expected components, sources, commands, capital paths, recovery paths, and panels with observed release facts.`
- `observability/historical-series-evaluator.mjs — 913 — Validates measurement history, freshness, units, exact values, and summaries.`
- `observability/slo-trend-evaluator.mjs — 544 — Judges whether reliability targets are passing, worsening, or unknown.`
- `observability/conservation-evaluator.mjs — 452 — Checks that important events reach one valid final outcome without being lost or counted twice.`
- `observability/slo-catalog-contract.mjs — 310 — Defines and validates the approved reliability-target list and its measurement sources.`
- `cockpit/ — 3,459 — Defines test-only truth rules for cockpit screens.`
- `cockpit/reference/ — 3,459 — Contains the two pure cockpit judges used by tests.`
- `cockpit/reference/cockpit-view-model.mjs — 2,788 — Validates panel inputs and produces the view state tests expect.`
- `cockpit/reference/release-bound-panel-evaluator.mjs — 671 — Refuses healthy panel states unless release inventory and dependency evidence agree.`

RUNS NOW?: DEAD — test-only; Product Assurance tests load these files, but the deployed server does not.

MONEY?: NO — it does not decide Basis or Volume trades, and its action records explicitly provide no permission to act.

REMOVABLE?: YES-BUT live trading behavior stays unchanged while Product Assurance tests and their false-green, release, and cockpit safeguards break.

EVIDENCE: `fixtures/productAssurance/systemic/actionEvidence/contracts/schema.mjs:9-16`; `fixtures/productAssurance/systemic/observability/release-manifest-evaluator.mjs:23-45`; `fixtures/productAssurance/systemic/cockpit/reference/cockpit-view-model.mjs:1-6`; `fixtures/i00/product-assurance-manifest.v1.json:353-415`; `package.json:88-90`

<!-- visible task 99 -->
## fixtures/productAssurance/systemic/hazard/** + fixtures/aiOps/** + fixtures/replayShadow/** + fixtures/obsShadow/** — 9,555 code lines
WHAT IT IS: This is made-up test data (“fixtures”) and offline rehearsal code (“shadow”) for system hazards, a future artificial-intelligence helper, replaying old event sequences, and monitoring views. It checks record shapes, simulates failures and permission limits, builds repeatable replay schedules, and turns fake alert and drill records into display-ready data. It does not read markets, choose basis or volume trades, or command the product.

SUB-PIECES: Directory totals include their listed files; every source directory or file at 300+ code lines follows.

- `fixtures/aiOps — 4,157 — The complete offline artificial-intelligence safety lab, with fake connectors, test records, and failure campaigns.`
- `fixtures/aiOps/a5 — 3,428 — The main 120-case rehearsal for bad evidence, outages, duplicate work, permissions, releases, alerts, and attempted money actions.`
- `fixtures/aiOps/a5/campaign-catalog.mjs — 308 — Names the 120 cases and the checks each case must pass.`
- `fixtures/aiOps/a5/oracles.mjs — 916 — Holds the pass/fail checkers for safety, replay, approval, outside artificial-intelligence services, releases, and no-effect rules.`
- `fixtures/aiOps/a5/scripted-subject.mjs — 1,129 — Walks each fake scenario step and records the expected safe response without acting on the product.`
- `fixtures/productAssurance/systemic/hazard — 3,305 — The complete made-up hazard packet, including its rules, samples, checks, and display data.`
- `fixtures/productAssurance/systemic/hazard/contracts — 1,436 — Defines permitted fields and checks record contents and links between records.`
- `fixtures/productAssurance/systemic/hazard/contracts/schema.mjs — 979 — Lists allowed hazard, assumption, loss, coverage, and display fields with size limits.`
- `fixtures/productAssurance/systemic/hazard/contracts/validation.mjs — 455 — Rejects malformed records, broken links, duplicate identities, and secret-like fields.`
- `fixtures/productAssurance/systemic/hazard/fixtures — 1,052 — Supplies one complete packet and deliberately damaged cases for the checkers.`
- `fixtures/productAssurance/systemic/hazard/fixtures/baseline.mjs — 906 — Provides ten loss families, ten hazards, nine assumptions, and the expected failure-coverage grid as made-up data.`
- `fixtures/productAssurance/systemic/hazard/reference — 814 — Scores assumption freshness and failure coverage, then builds display-ready summaries.`
- `fixtures/productAssurance/systemic/hazard/reference/hazard-evaluator.mjs — 309 — Turns assumptions and dependent hazards into PASS, FAIL, or UNKNOWN without commanding anything.`
- `fixtures/replayShadow — 1,290 — Checks offline replay plans covering stale data, fill ambiguity, connection loss, rate limits, clocks, load, and recovery drills.`
- `fixtures/replayShadow/harness.mjs — 1,290 — Checks the made-up event collection and creates repeatable scheduled steps; it has no runner, connection, storage, or fault injector.`
- `fixtures/obsShadow — 803 — Holds an unconnected monitoring-view rehearsal for alert-delivery receipts and recorded incident drills.`
- `fixtures/obsShadow/view-adapter.mjs — 803 — Turns fake alert and drill records into display-ready objects and checks that they remain unconnected and unable to command anything.`

RUNS NOW?: DEAD — test-only and not mounted, meaning not connected to the live app. Live startup launches `server/dist/index.js`; these packets explicitly declare no live execution, no runner, or `NOT_MOUNTED`, and live source contains no loader for them.

MONEY?: NO. Attempted orders and fills appear only as made-up safety cases; neither the basis nor volume engine loads this block.

REMOVABLE?: YES-BUT deleting it breaks offline artificial-intelligence, hazard, replay, monitoring-view tests and their evidence records; live basis and volume behavior remains unchanged.

EVIDENCE: `package.json:16` · `fixtures/aiOps/a5/fixture-factory.mjs:99-114` · `fixtures/productAssurance/systemic/hazard/state/HAZARD_STATE.md:28-34` · `fixtures/replayShadow/harness.mjs:1-6` · `fixtures/obsShadow/view-adapter.mjs:3-6`

<!-- visible task 100 -->
## verification/** + packages/** — 5,791 lines

WHAT IT IS: These are offline proof tools and saved campaign records, plus one standalone test for a frozen message format. The tools rebuild or check one fixed source version, copied owner instructions, file origins, and separate Git working copies—meaning separate source folders. None watches markets, chooses basis or volume trades, or sends orders. The heading counts code only; 31,699 non-code lines are excluded and listed below.

SUB-PIECES:

- `verification/product-truth-20260716/` — 5,651 code lines + 31,295 non-code lines — This is the complete offline historical-proof folder.
- `packages/edge-protocol-tests/protocol.test.mjs` — 140 code lines — This checks allowed and forbidden sample messages, field limits, secret-like field bans, and unknown-version rejection.
- `verify-exact-candidate-evidence.mjs` — 1,832 code lines — This rejects a proof package unless its source version, inputs, file origins, stored copy census, and digital fingerprints all agree.
- `generate-worktree-census.mjs` — 1,396 code lines — This scans separate Git source folders, classifies each as kept, replaced, abandoned, blocked, or removed, and writes a census.
- `generate-exact-candidate-evidence.mjs` — 1,218 code lines — This rebuilds 21 proof reports from one fixed source version and frozen input copies.
- `campaign-input-registry.mjs` — 494 code lines — This fixed list names the permitted source version, inputs, expected digital fingerprints, and outputs.
- `generate-manifest.mjs` — 419 code lines — This creates or checks the complete file list and digital fingerprints for the proof folder.
- `locked-input-payloads/` — 15,173 non-code lines — These are frozen copies of 23 owner inputs and two authority records.
- `WORKTREE_CENSUS.json` — 7,658 non-code lines — This is a stored snapshot of 96 then-registered source folders and five removed-folder records.
- `locked-input-payloads/08-I00.md` — 2,546 non-code lines — This is the owner order for product assembly, the control room, and live bring-up.
- `wave1-inputs/` — 2,049 non-code lines — These are four archived preparation reports covering file origins, clean-copy checks, activation steps, and a small live-trade precheck.
- `locked-input-payloads/07-L_DIRECTIVE.md` — 2,080 non-code lines — This is the owner order for realistic live execution, controls, and proof.
- `locked-input-payloads/13-POST_I00.md` — 1,980 non-code lines — This is the owner order for later automated-operations activation.
- `locked-input-payloads/06-Q_DIRECTIVE.md` — 1,930 non-code lines — This is the owner order for the market-research factory.
- `INPUTS.lock` — 1,677 non-code lines — This lists 61 admitted, reference-only, superseded, or absent campaign inputs and their fingerprints.
- `locked-input-payloads/19-PARALLEL_CAPABILITY_FOUNDRY_AND_SENSE_PACKS_md.md` — 1,594 non-code lines — This is an archived optional-capability and data-source build plan.
- `MERGE_PROVENANCE.json` — 1,421 non-code lines — This records where accepted files came from and which later changes were made.
- `locked-input-payloads/15-FRONTIER.md` — 1,419 non-code lines — This is an archived optional-expansion plan.
- `locked-input-payloads/01-CAMPAIGN.md` — 780 non-code lines — This is the umbrella independent product-truth and readiness audit order.
- `wave1-inputs/PROV_FINDINGS.json` — 743 non-code lines — This stores archived findings about file origins and instruction coverage.
- `LOCKED_INPUT_PAYLOADS.json` — 682 non-code lines — This indexes the 25 frozen inputs and stores historical source bytes used for rechecking.
- `wave1-inputs/CLEAN_CLONE_FINDINGS.json` — 583 non-code lines — This stores archived checks from a freshly copied source tree.
- `EVIDENCE_SELECTION.json` — 461 non-code lines — This records the exact acceptable proof source and permitted output files.
- `wave1-inputs/ACTIVATION_RUNBOOK_DRAFT.md` — 450 non-code lines — This is a draft procedure for a small live-trade trial.
- `MANIFEST.json` — 447 non-code lines — This lists every proof-folder file with its size and digital fingerprint.
- `locked-input-payloads/05-Q_L_LAUNCH.md` — 417 non-code lines — This is the owner order launching separate research and live-execution lanes.
- `packages/edge-protocol/` — 404 non-code lines — These are the frozen message rulebook and its sample messages.
- `packages/edge-protocol/schema/` — 383 non-code lines — This directory contains the message-field rulebook.
- `packages/edge-protocol/schema/edge-protocol-v1.schema.json` — 383 non-code lines — This defines the allowed fields and limits for each frozen message.

RUNS NOW?: DEAD — not mounted in the deployed service; its declared hooks are test commands. The declared production start is `server/dist/index.js`, and the only declared workspaces are `server` and `web`.

MONEY?: NO.

REMOVABLE?: YES-BUT removing it breaks the message-format test and historical proof rebuilding and checking; live basis and volume trading do not depend on it.

EVIDENCE: `package.json:9-16`; `package.json:40-41`; `packages/edge-protocol-tests/protocol.test.mjs:3-7`; `test/realGaps/camp-091-exact-evidence.mjs:23-33`; `verification/product-truth-20260716/generate-exact-candidate-evidence.mjs:110-112`.

## Server tests

<!-- visible task 108 -->
## server/test/liveEdge/privateTruth/{projection-waiting,usdm-lifecycle,spot-lifecycle,margin-lifecycle,query-scope}.test.mjs — 8,013 lines

WHAT IT IS: Five test-only suites for Binance Spot, futures, and Margin private-account facts. They check that connection state, account snapshots, permissions, query scope, and freshness agree before facts are treated as current. Wrong, stale, forged, or incomplete evidence is blocked; these files neither trade nor contact the exchange.

SUB-PIECES:

- `projection-waiting.test.mjs — 2,025 — Proves an order decision remains unable to send unless facts, permissions, account comparisons, connection evidence, market pair, and version markers agree; current runner selects it: YES, through the live-edge and full all-tests launchers, but not run now.`
- `usdm-lifecycle.test.mjs — 2,005 — Proves the futures private-feed connection lease, authentication, subscription, event ordering, reconnect, and fresh account-snapshot rules at exact limits; current runner selects it: YES, through the live-edge and full all-tests launchers, but not run now.`
- `spot-lifecycle.test.mjs — 1,734 — Proves the Spot private-feed connection and subscription flow, reconnect and subscription limits, account/order/fill tracking, fresh account comparisons, and rejection of forged state; current runner selects it: YES, through the live-edge and full all-tests launchers, but not run now.`
- `margin-lifecycle.test.mjs — 1,283 — Proves the Cross Margin risk-only feed’s 60-minute lease, 24-hour connection, risk events, reconnect, and bad-event handling without treating it as full trading truth; current runner selects it: YES, through the live-edge and full all-tests launchers, but not run now.`
- `query-scope.test.mjs — 966 — Proves every private query is tied to the correct account, market pair, asset, Margin mode, history window, and returned rows; current runner selects it: YES, through the live-edge and full all-tests launchers, but not run now.`

RUNS NOW?: DEAD (test-only) — the configured live start launches `server/dist/index.js`; these suites run only when a test launcher is invoked. No suite was executed now, so there is no current pass claim.

MONEY?: NO — these are safety checks, not basis or volume logic, and the live server does not load them.

REMOVABLE?: YES-BUT automated checks for private-data scope, freshness, reconnection, account separation, and forged evidence disappear.

EVIDENCE:

- `package.json:16`
- `package.json:92`
- `test/run-test-all-built.mjs:20`
- `server/test/liveEdge/privateTruth/projection-waiting.test.mjs:1545`
- `server/test/liveEdge/privateTruth/query-scope.test.mjs:625`

<!-- visible task 109 -->
## server/test/liveEdge/privateTruth/** remaining after Split 44A — 4,427 lines

WHAT IT IS: Seven test-only suites check private account truth for Spot, dollar-margined futures (USD-M), and Margin. They verify exact values, time limits, permissions, connection history, and evidence handoffs without granting order authority. No tests were run during this audit.

SUB-PIECES:

- `account-products.test.mjs — 836 lines` — Checks exact futures and Margin balances, positions, orders, trades, interest, missing data, duplicates, and size limits. Current runner: YES, live-edge and all-tests; default test: NO.
- `freshness.test.mjs — 795 lines` — Checks expiry, clock mismatch, receipt timing, unavailable facts, and separation between Spot, futures, and Margin truth. Current runner: YES, live-edge and all-tests; default test: NO.
- `lifecycle-binding.test.mjs — 481 lines` — Checks that Spot and futures connection evidence blocks on reconnect deadlines, lost history, degraded events, expiry, or forged records; Margin remains risk-only. Current runner: YES, live-edge and all-tests; default test: NO.
- `normalization.test.mjs — 592 lines` — Checks exact Spot values and timestamps while rejecting unknown fields, duplicates, oversized collections, hostile objects, and secret-looking input. Current runner: YES, live-edge and all-tests; default test: NO.
- `permissions-handoff.test.mjs — 825 lines` — Checks separate read and execution profiles, forbidden withdrawal or transfer powers, exact product permissions, reconciliation binding, and evidence handoff without an owner verdict. Current runner: YES, live-edge and all-tests; default test: NO.
- `purity.test.mjs — 606 lines` — Checks that the private-truth source does not quietly use network, files, environment, clocks, randomness, signing, or order actions. Current runner: YES, live-edge and all-tests; default test: NO.
- `secret-boundary.test.mjs — 292 lines` — Checks that key-, token-, password-, and credential-shaped fields or values are rejected while ordinary documentary identifiers remain allowed. Current runner: YES, live-edge and all-tests; default test: NO.

RUNS NOW?: DEAD — test-only. The deployed server build includes `server/src` only. Current pass state is UNKNOWN because no suite was executed now.

MONEY?: NO — these tests protect money-adjacent account truth but are not imported into either running money engine.

REMOVABLE?: YES-BUT live behavior would remain unchanged immediately, while repeat-check protection against stale, forged, secret-bearing, or authority-escalating private truth would be lost.

EVIDENCE: `package.json:92-95`; `test/run-test-all-built.mjs:7-21`; `server/tsconfig.json:7-13`; `server/test/liveEdge/privateTruth/permissions-handoff.test.mjs:672-693`; `server/test/liveEdge/privateTruth/purity.test.mjs:454-460`

<!-- visible task 110 -->
## server/test/liveEdge/exchangeTwin/** + server/test/liveEdge/normalBasis/** — 9,294 lines

WHAT IT IS: This is test code, not part of the deployed trading process. Exchange Twin is a fixed fake exchange that checks fills, fees, timing, cancellations, crashes, and recovery without contacting Binance. Normal Basis tests buying spot, selling no-expiry futures, then closing both sides while preserving exact records and exposure truth.

SUB-PIECES:

- `exchangeTwin/ — 4,546 lines` — fake-exchange proof area containing ten test suites and one helper.
- `exchangeTwin/lifecycle.test.mjs — 961 lines` — proves order status, cancellations, races, partial fills, crashes, recovery, fees, and timing; current runner: SELECTED.
- `exchangeTwin/purity.test.mjs — 577 lines` — proves the fake exchange has no network, environment, storage, or order authority; current runner: SELECTED.
- `exchangeTwin/fixtures.mjs — 566 lines` — builds fixed instruments, orders, books, fees, and owner evidence; current runner: indirect helper.
- `exchangeTwin/conservation.test.mjs — 407 lines` — proves liquidity and fills cannot be reused or exceed available quantity; current runner: SELECTED.
- `exchangeTwin/spot-order-tif-bridge.test.mjs — 407 lines` — proves spot limit-order timing choices and owner evidence cross the fake-exchange boundary safely; current runner: SELECTED.
- `exchangeTwin/adversarial.test.mjs — 405 lines` — proves malformed, oversized, duplicate, hostile, and tampered inputs stop safely; current runner: SELECTED.
- `exchangeTwin/owner-seams.test.mjs — 394 lines` — proves owner evidence, time, request meaning, and identities cannot be substituted; current runner: SELECTED.
- `exchangeTwin/passive.test.mjs — 348 lines` — proves resting orders fill only from explicit trades while queue and depth remain conserved; current runner: SELECTED.
- `exchangeTwin/scenario.test.mjs — 219 lines` — proves buy/sell, fill-or-kill, immediate-or-cancel, good-until-cancelled, market, and event-order behavior; current runner: SELECTED.
- `exchangeTwin/crash-matrix.test.mjs — 214 lines` — proves every stored order state survives checkpoint, crash, restart, and record matching; current runner: SELECTED.
- `exchangeTwin/exact.test.mjs — 48 lines` — proves decimal calculations stay exact and unsafe values are rejected; current runner: SELECTED.
- `normalBasis/ — 4,748 lines` — normal-basis proof area containing three test suites and two helpers.
- `normalBasis/lifecycle.test.mjs — 1,272 lines` — proves staged opening, offsetting trades, closing, fees, partial or rejected fills, emergency recovery, and cold restart; current runner: SELECTED.
- `normalBasis/guards.test.mjs — 1,151 lines` — proves current risk, private-account, position, order, record-matching, and recovery evidence is required; current runner: SELECTED.
- `normalBasis/fixtures.mjs — 1,013 lines` — builds the complete fixed basis plan, risk, capital, exchange, observation, and clock inputs; current runner: indirect helper.
- `normalBasis/chain.test.mjs — 708 lines` — proves an accepted plan reaches all four fake exchange legs with distinct identities and blocks forged observations or network access; current runner: SELECTED.
- `normalBasis/l05-fixture.mjs — 604 lines` — builds fixed no-expiry-futures account, permission, position, order, and unavailable-data evidence; current runner: indirect helper.

RUNS NOW?: DEAD — test-only. Production starts compiled server code; the current canonical all-tests runner selects all 13 suites, but this audit executed none and claims no current pass.

MONEY?: NO — these files verify money-facing behavior but are not imported by the deployed engines and cannot place orders or produce profit.

REMOVABLE?: YES-BUT the deployed process can start without them; removal destroys regression proof for fill conservation, four-leg basis state, partial exposure, crash recovery, and the no-network/no-authority boundary.

EVIDENCE: [package.json:16](/Users/cosmosgeek/Desktop/cosmos-live-20260809/package.json:16); [package.json:92](/Users/cosmosgeek/Desktop/cosmos-live-20260809/package.json:92); [test/run-test-all-built.mjs:20](/Users/cosmosgeek/Desktop/cosmos-live-20260809/test/run-test-all-built.mjs:20); [server/test/liveEdge/exchangeTwin/lifecycle.test.mjs:763](/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/test/liveEdge/exchangeTwin/lifecycle.test.mjs:763); [server/test/liveEdge/normalBasis/lifecycle.test.mjs:452](/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/test/liveEdge/normalBasis/lifecycle.test.mjs:452).

<!-- visible task 111 -->
## server/test/liveEdge/{signedKernel,instrumentSpecs,mutationJournal}/** — 11,250 lines

WHAT IT IS: Offline safety tests and shared sample-data builders for three private-order foundations. They check exchange-rule sizing, private-request proof and retry safety, and durable order history across crashes or conflicting exchange reports. They place no trades and are excluded from the deployed server.

SUB-PIECES:

- `instrumentSpecs/ — 4,255 lines — exchange rules, sizing and freshness checks.`
  - `normalization.test.mjs — 1,201 — proves exchange metadata becomes an exact locked snapshot and malformed or stale rules block action; runner: YES.`
  - `purity.test.mjs — 448 — proves this code cannot silently use files, network, clocks or other outside state while loading; runner: YES.`
  - `sizing.test.mjs — 1,391 — proves prices, quantities and order-value ceilings use exact arithmetic, only reduce size and block unsafe orders; runner: YES.`
  - `spot-order-tif-capability.test.mjs — 217 — proves Spot time-in-force, meaning how long an order may stay active, accepts only the current tightly bound rule set; runner: YES.`
  - `waiting.test.mjs — 998 — proves changed, stale, forged or wrong-symbol snapshots require fresh checking and never grant send authority alone; runner: YES.`

- `mutationJournal/ — 3,554 lines — durable order-history, crash recovery and exchange-truth matching checks.`
  - `adversarial.test.mjs — 889 — proves crash recovery preserves money-critical truth and hostile or contradictory reports cannot invent fills or raise the canary ceiling; runner: YES.`
  - `fixtures.mjs — 463 — shared sample order histories for every mutation-journal suite; runner: INDIRECT through the selected suites.`
  - `journal.test.mjs — 341 — proves every record extends one exact earlier state and restart replay rejects gaps, forks, reordering and unsafe resubmission; runner: YES.`
  - `l05-owner-fixture.mjs — 345 — builds the private Spot account-truth samples used by the journal suites; runner: INDIRECT through `fixtures.mjs`.`
  - `races.test.mjs — 683 — proves delayed or reversed exchange reports converge where compatible and remain named conflicts where contradictory; runner: YES.`
  - `reconciliation.test.mjs — 408 — proves only exact complete account truth can settle uncertainty without erasing or inventing fills; runner: YES.`
  - `section7.test.mjs — 425 — proves capital, timing and recording evidence cannot fabricate milestones or grant trading authority; runner: YES.`

- `signedKernel/ — 3,441 lines — private-request construction, proof, timing and repeat-prevention checks.`
  - `ambiguity.test.mjs — 359 — proves an unclear post-send result becomes unknown and cannot be automatically submitted again; runner: YES.`
  - `clock.test.mjs — 514 — proves exchange-time evidence must be fresh, bounded and tied to the correct product; runner: YES.`
  - `contract.test.mjs — 102 — proves only the approved current private request types may reach signing; runner: YES.`
  - `identity.test.mjs — 168 — proves request and client-order identities are deterministic and hostile inputs fail closed; runner: YES.`
  - `purity.test.mjs — 380 — proves this code owns no credentials, endpoint or hidden outside-state access and loads without side effects; runner: YES.`
  - `rate-budget.test.mjs — 624 — proves request-count reservations, exchange limit reports and retry blocks cannot be bypassed or moved backward; runner: YES.`
  - `request.test.mjs — 848 — proves exact request construction, one-time signing, decimal preservation, cancel identity and safe public diagnostics; runner: YES.`
  - `safety.test.mjs — 446 — proves errors expose only bounded safe details and remove credentials, signatures and request contents; runner: YES.`

RUNS NOW?: DEAD — test-only. All 18 suites are selected by the current live-edge runner, which the all-tests runner also includes; none was executed in this audit, so present pass or fail is UNKNOWN.

MONEY?: NO — these files test money-critical machinery, but the deployed server neither builds nor loads them.

REMOVABLE?: YES-BUT the deployed server keeps running while losing these private-order regression checks; removing only the support files also breaks the selected mutation-journal suites.

EVIDENCE: [server/tsconfig.json:13](/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/tsconfig.json:13) · [package.json:92](/Users/cosmosgeek/Desktop/cosmos-live-20260809/package.json:92) · [instrumentSpecs/sizing.test.mjs:595](/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/test/liveEdge/instrumentSpecs/sizing.test.mjs:595) · [signedKernel/request.test.mjs:201](/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/test/liveEdge/signedKernel/request.test.mjs:201) · [mutationJournal/adversarial.test.mjs:482](/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/test/liveEdge/mutationJournal/adversarial.test.mjs:482)

<!-- visible task 112 -->
## server/test/liveEdge/volumeLifecycle/** + reverseBasisLifecycle/** + executionPolicy/** + exposureRecoveryProjection/** — 9,874 lines

WHAT IT IS: These are 21 test suites plus four shared sets of made-up records for Volume positions, reverse-Basis positions—borrow the coin, sell it, hedge with a futures contract, then buy back and repay—order-policy choice, and the final exposure/recovery summary. They challenge partial fills, crashes, stale or hostile data, debt, stop rules, and two-leg sequencing so those conditions cannot become duplicate actions, hidden exposure, or a false “closed” state. They are test code only; this audit ran none of them.

SUB-PIECES:

- `volumeLifecycle/ — 4,117 lines — Five selected suites test staged Volume positions, protection, exchange-truth recovery, and hostile inputs.`
- `volumeLifecycle/adversarial.test.mjs — 1,906 lines — Proves malformed, replayed, or mismatched evidence cannot widen an action, duplicate it, or hide exposure; selected now: YES.`
- `volumeLifecycle/protection.test.mjs — 802 lines — Proves loss, trailing, time, reversal, exhaustion, and degraded-source protections use exact boundaries and retain position truth; selected now: YES.`
- `volumeLifecycle/twin-recovery.test.mjs — 521 lines — Proves timeouts, partial fills, fees, crashes, and exchange/local mismatches reconstruct exposure without blindly resending; selected now: YES.`
- `volumeLifecycle/fixtures.mjs — 517 lines — Supplies shared made-up lifecycle, action, market, and recovery records; selected now: INDIRECT, because selected suites import it.`
- `reverseBasisLifecycle/ — 2,522 lines — Nine selected suites test the complete borrow, sell, hedge, cover, repay, closure, and restart chain.`
- `reverseBasisLifecycle/fixtures.mjs — 736 lines — Builds shared made-up borrow, liability, order, hedge, repayment, and closed-state records; selected now: INDIRECT.`
- `reverseBasisLifecycle/safety.test.mjs — 430 lines — Proves expired gates, wrong event order, stale fills, hidden debt, early repayment, and later evidence cannot forge safety or closure; selected now: YES.`
- `executionPolicy/ — 1,713 lines — Four selected suites test exact order choice, two-leg sequencing, cost limits, cancellation, and recovery without send authority.`
- `executionPolicy/math.test.mjs — 444 lines — Proves costs, latency, fill uncertainty, worst-loss limits, recovery budgets, and ranking boundaries are calculated exactly; selected now: YES.`
- `executionPolicy/sequence-purity.test.mjs — 438 lines — Proves ordered and parallel legs, cancellation, replacement, ambiguity, and recovery remain bounded and non-sendable; selected now: YES.`
- `executionPolicy/fixtures.mjs — 386 lines — Supplies shared made-up orders, fill scenarios, owner evidence, and policy inputs; selected now: INDIRECT.`
- `exposureRecoveryProjection/ — 1,522 lines — Three selected suites test the final owner-readable exposure summary and crash-safe restoration.`
- `exposureRecoveryProjection/canonical-state-crash.test.mjs — 645 lines — Proves every official plan and leg state can be saved, restored, queried, and recovered without resubmitting an existing action; selected now: YES.`
- `exposureRecoveryProjection/projection.test.mjs — 477 lines — Proves Normal Basis, Reverse Basis, and Volume exposure, debt, mismatch, and operator-attention truth cannot be hidden or falsely shown as zero; selected now: YES.`

RUNS NOW?: DEAD (test-only) — the current `test:live-edge:built` command selects every owned `.test.mjs` suite, but none is mounted in the deployed server. Nothing was run during this audit, so current pass/fail is UNKNOWN.

MONEY?: NO — these files prove money behavior but contain no deployed Basis/Volume decision path and cannot place, change, or cancel an order.

REMOVABLE?: YES-BUT removing them strips the current test command of its protection against duplicate actions, hidden debt or exposure, unsafe crash recovery, and false closure.

EVIDENCE: `package.json:92`; `server/test/liveEdge/volumeLifecycle/adversarial.test.mjs:180`; `server/test/liveEdge/reverseBasisLifecycle/safety.test.mjs:224`; `server/test/liveEdge/executionPolicy/sequence-purity.test.mjs:392`; `server/test/liveEdge/exposureRecoveryProjection/projection.test.mjs:92`

<!-- visible task 113 -->
## server/test/liveEdge/{basisTicker,binanceSpotExecution,contract,controls,externalProofEvidence,finalLaneEvidence,fixtures}/ — 7,588 lines

WHAT IT IS: Fresh recount: 25 test and helper files totaling exactly 7,588 lines. They check public spot-versus-perpetual observations, the guarded Binance Spot order seam, message rules, owner controls, and evidence chains. Fixtures are canned test inputs; hostile cases check that forged, stale, duplicated, retried, or incomplete facts are rejected safely. Nothing was run during this audit.

SUB-PIECES:

- `basisTicker/ — 1,977` — Three suites: Ledger readout 832, purity 566, public observation 579. Runner: YES through the live-edge/full runner, not the default root test command.
- `basisTicker/ledger-projection.test.mjs — 832` — Proves all-or-nothing Ledger writes, restart readback, 24-hour statistics, exact arithmetic, duplicate handling, and safe rejection of corrupt history. Runner: YES.
- `basisTicker/purity.test.mjs — 566` — Proves three Basis files load without hidden network, signing, timer, or storage authority and remain unmounted. Runner: YES.
- `basisTicker/public-opportunity-observation.test.mjs — 579` — Proves stable public-basis records, honest `UNKNOWN` economics when cost or borrow truth is missing, and tamper/size rejection. Runner: YES.
- `binanceSpotExecution/ — 1,364` — Two suites: adapter 689 and production transport 675. Runner: YES through live-edge/full and the default focused test chain.
- `binanceSpotExecution/adapter.test.mjs — 689` — Proves exact test/order/query/cancel/fill/flatten routing, one-use durable permission, query-before-retry, and no blind retry. Runner: YES.
- `binanceSpotExecution/production-transport.test.mjs — 675` — Proves exact signed Spot routes, the $10 entry ceiling, separate read/execution identities, takeover protection, response limits, and one-request-only behavior. Runner: YES.
- `contract/ — 1,023` — Two suites: local transport 529 and message client 494. Runner: YES through live-edge/full.
- `contract/projection-transport.test.mjs — 529` — Proves message direction, version ordering, local-machine endpoints, connection states, timeouts, and event chronology. Runner: YES.
- `contract/protocol-client.test.mjs — 494` — Proves frozen message rules and valid/invalid canned-input parity, exact text bytes, field limits, secret-key rejection, and detached accepted data. Runner: YES.
- `controls/ — 1,365` — Contracts 84 prove closed action shapes; adapter 214 proves durable apply/replay; journal 77 proves event chaining; risk 153 proves current risk truth; adversarial 345 proves forgery/race resistance; helper 492 supplies canned owner and persistence behavior. All five suites: Runner YES through live-edge/full; helper indirect.
- `controls/adversarial.test.mjs — 345` — Proves actor, digest, expiry, version, concurrency, safe replay, and uncertain-owner-result handling. Runner: YES.
- `controls/fixtures.mjs — 492` — Canned harness for all 18 controls, owner calls, durable receipts, and risk facts. Runner: INDIRECT through selected suites.
- `externalProofEvidence/ — 625` — Owner boundary 132, purity 74, readout 90, adversarial 123, helper 206; proves copied arithmetic or infrastructure health cannot be promoted into live truth. Four suites: Runner YES through live-edge/full; helper indirect.
- `finalLaneEvidence/ — 742` — Lineage 196, purity 89, readout 146, adversarial 127, helper 184; proves accepted evidence ancestry, command/scope counts, and operational facts remain non-authorizing. Four suites: Runner YES through live-edge/full; helper indirect.
- `fixtures/ — 492` — Message helper 388 and Spot-order-rule helper 104; neither is selected directly, but selected suites import them.
- `fixtures/protocol-fixtures.mjs — 388` — Reads frozen message rules and canned bytes, builds stable frames, and supplies controlled mutations. Runner: INDIRECT.

RUNS NOW?: DEAD — test-only. The deployed process does not run these suites. The current live-edge runner selects every owned `.test.mjs`, and the full runner includes that runner; no suite passed or failed now because execution was forbidden.

MONEY?: NO — none of these files enters the deployed engine’s import or runtime closure. Several protect Basis and Spot-order money code, but they are assurance, not trading logic.

REMOVABLE?: YES-BUT the deployed runtime should remain unchanged; Basis, Spot-order, control, message, and evidence regression protection disappears, and shared helper consumers elsewhere in the test tree break unless moved or retired together.

EVIDENCE:

- `package.json:92`
- `ARCHITECTURE.md:79`
- `server/test/liveEdge/basisTicker/purity.test.mjs:510-537`
- `server/test/liveEdge/integration/assessment-bridge.test.mjs:13`
- `server/test/liveEdge/instrumentSpecs/spot-order-tif-capability.test.mjs:21`

<!-- visible task 114 -->
## server/test/liveEdge/integration/**, machineGraphEvidence/**, security/**, sourceContracts/** — 4,614 lines

WHAT IT IS: These are seven safety-test suites and two support files. They check the suggestion handoff, machine-health evidence, Binance exchange facts, and the boundaries around loading live-edge code. They do not run either bot or place orders.

SUB-PIECES:

- `integration/ — 958 lines` — Holds the suggestion-handoff checks.
  - `assessment-bridge.test.mjs — 958 lines` — Proves only a healthy, current, economically valid basis suggestion reaches its owner once; stale, conflicting, unsupported, overloaded, disconnected, and expired suggestions are blocked. Current runner selects it: YES; not run now.
- `machineGraphEvidence/ — 1,374 lines` — Holds the read-only whole-machine evidence checks.
  - `owner-boundary.test.mjs — 264 lines` — Proves system jobs, measurements, alarms, and controls match the official lists and do not quietly acquire outside authority. Current runner selects it: YES; not run now.
  - `projection.test.mjs — 190 lines` — Proves owner evidence becomes a frozen read-only report, missing facts remain missing, and the report cannot control systems or decide readiness. Current runner selects it: YES; not run now.
  - `adversarial.test.mjs — 561 lines` — Rejects forged mappings, false health, bad arithmetic, secret-shaped data, and claims of automatic trading or money control. Current runner selects it: YES; not run now.
  - `fixtures.mjs — 359 lines` — Supplies made-up roles, measurements, alarms, and unavailable controls for those suites. Runner selects it directly: NO; the projection and adversarial suites load it.
- `security/ — 1,203 lines` — Holds the live-edge loading-boundary checks.
  - `import-purity.test.mjs — 1,203 lines` — Checks that the one approved spot-execution rail stays narrowly mounted, other live-edge code cannot gain hidden network, file, clock, environment, or money authority, and live mode remains blocked. Current runner selects it: YES; not run now.
- `sourceContracts/ — 1,079 lines` — Holds the locked Binance exchange-fact checks.
  - `binance-contracts.test.mjs — 792 lines` — Proves spot, dollar-settled futures, and margin interface facts remain exact and read-only while outdated, altered, or hostile replacements are rejected. Current runner selects it: YES; not run now.
  - `private-truth-extension.test.mjs — 191 lines` — Proves the special dollar-futures algorithm-order query remains a separate read-only fact and cannot be replaced by a standard or altered route. Current runner selects it: YES; not run now.
  - `fixtures.mjs — 96 lines` — Supplies independent exchange-route examples. Runner selects it directly: NO; the Binance-contract suite loads it.

RUNS NOW?: DEAD — test-only and not mounted in the deployed process. The dedicated live-edge runner selects all seven suites when invoked; selection does not mean they passed now.

MONEY?: NO — These files test money-adjacent rails but are outside the basis and volume bots’ loaded runtime code.

REMOVABLE?: YES-BUT live behavior stays unchanged, while seven repeat-check suites and their exchange, evidence, and safety-boundary protection disappear.

EVIDENCE:

- `package.json:16`
- `package.json:92`
- `server/test/liveEdge/machineGraphEvidence/projection.test.mjs:28`
- `server/test/liveEdge/security/import-purity.test.mjs:1147`
- `server/test/liveEdge/sourceContracts/binance-contracts.test.mjs:168`

<!-- visible task 115 -->
## server/test/systemIntegration/persistence/** — 11,212 lines

WHAT IT IS: This block is the automated safety proof for stored restart truth, operator commands, audit history, release state, and the M0 spot-order lifecycle. It attacks races, crashes, damaged records, duplicate commands, and unsafe recovery. These are tests only, not deployed server code.

SUB-PIECES:

- `boot-failure-exit.process.test.mjs — 120 lines` — proves a rejected boot exits as failed instead of appearing live. Current runner: YES, integration runner; not run now.
- `boot-release-persistence-adapter.test.mjs — 397 lines` — proves boot identity and clean or unclean shutdown history remain truthful through restarts and write failures. Current runner: YES, integration runner; not run now.
- `codec.test.mjs — 89 lines` — proves stored checkpoints are stable and bounded, while damaged, extra, or secret-shaped data is rejected. Current runner: YES, integration runner; not run now.
- `data-dir-lease.process.test.mjs — 1,892 lines` — proves only one process owns the data folder across aliases, links, crashes, and takeovers, with unsafe paths refused before writes. Current runner: YES, integration runner; not run now.
- `import-purity.test.mjs — 29 lines` — proves loading persistence code performs no clock, timer, network, environment, or file action. Current runner: YES, integration runner; not run now.
- `ledger-adapter.test.mjs — 477 lines` — proves checkpoints and audit history commit together, while stale writers, duplicates, corruption, and oversized queries fail safely. Current runner: YES, integration runner; not run now.
- `ledger-cas.test.mjs — 474 lines` — proves competing writers cannot split a settings update from its audit events during crashes or failures. Current runner: YES, integration runner; not run now.
- `ledger-schema-compatibility.test.mjs — 298 lines` — proves old database layouts retain their rows and newer, malformed, or unsafe rollback state is withheld. Current runner: YES, integration runner; not run now.
- `ledger-v3-events.test.mjs — 1,122 lines` — proves event-history upgrades preserve old records, reject damaged layouts, enforce bounds, and keep durable events append-only. Current runner: YES, integration runner; not run now.
- `live-edge-control-persistence.test.mjs — 1,039 lines` — proves operator-command intent and results survive restart without races, deadlines, or partial failures forging success or money authority. Current runner: YES, integration runner; not run now.
- `live-edge-mutation-journal-adapter.test.mjs — 1,114 lines` — proves action-journal records replay exactly, competing workers cannot double-write, damaged history blocks progress, and the adapter gains no network or money authority. Current runner: YES, integration runner; not run now.
- `m0-spot-lifecycle-persistence.test.mjs — 2,103 lines` — proves one spot-order lifecycle gets one durable action spend, survives restart, handles missing or late orders, and cannot disarm before flat exposure is proven. Current runner: YES, integration runner and focused runner; not run now.
- `product-operator-events.test.mjs — 381 lines` — proves operator-facing events commit with their audit record, retain a bounded history, and expose missing or damaged history. Current runner: YES, integration runner; not run now.
- `product-persistence-schema.test.mjs — 685 lines` — proves seven product-state tables migrate safely and store commands, settings, identity, incidents, and boot state without private-exchange authority. Current runner: YES, integration runner; not run now.
- `restart-and-controls.test.mjs — 551 lines` — proves restart stays blocked until truth is reconciled and shutdown or control records cannot be duplicated, leaked, or falsely published. Current runner: YES, integration runner; not run now.
- `validate-only-adapter.test.mjs — 441 lines` — proves dry-run validation and risk records replay exactly while forged live-action, recovery, or changed-risk claims are rejected. Current runner: YES, integration runner; not run now.

RUNS NOW?: DEAD — test-only. The live command launches `server/dist/index.js`, not this directory. The integration runner selects all 16 suites, and the canonical all-tests runner includes that integration runner; none was executed in this audit.

MONEY?: NO — these test files are neither basis/volume logic nor part of either live engine’s runtime imports. The M0 suite checks a separate spot-order safety rail.

REMOVABLE?: YES-BUT the deployed server can still start; removing this block destroys the canonical regression proof for database, control, restart, journal, and M0 execution safety.

EVIDENCE: [package.json:16](/Users/cosmosgeek/Desktop/cosmos-live-20260809/package.json:16) · [package.json:76](/Users/cosmosgeek/Desktop/cosmos-live-20260809/package.json:76) · [test/run-test-all-built.mjs:14](/Users/cosmosgeek/Desktop/cosmos-live-20260809/test/run-test-all-built.mjs:14) · [server/test/systemIntegration/persistence/m0-spot-lifecycle-persistence.test.mjs:1129](/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/test/systemIntegration/persistence/m0-spot-lifecycle-persistence.test.mjs:1129) · [server/test/systemIntegration/persistence/data-dir-lease.process.test.mjs:1844](/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/test/systemIntegration/persistence/data-dir-lease.process.test.mjs:1844)

<!-- visible task 116 -->
## server/test/systemIntegration/{adapters, application, composition, contracts, controls} — 10,276 lines

WHAT IT IS: These 21 test suites check how market facts, account facts, the Basis and Volume engines, startup, shutdown, saved state, and owner controls fit together. They use prepared test values against built server code; they do not monitor markets, trade, or run inside the deployed server.

SUB-PIECES:

- `adapters/ — 4,827 lines` — ten suites checking the connectors between sources, engines, account truth, risk, and capital.
  - `directional-adapters.test.mjs — 380 lines` — proves translations retain timestamps, failure details, proposal identities, source ownership, and honest account gaps. Runner: SELECTED; result UNKNOWN because it was not run now.
  - `foundation-quantity-bridge.test.mjs — 340 lines` — proves recorded order quantities compare exactly with shared-core quantities and rejects ambiguous or unsafe numbers. Runner: SELECTED; result UNKNOWN.
  - `observed-order-focus.test.mjs — 771 lines` — proves Volume focuses only active orders backed by current account evidence, saves progress across restart, and rejects stale or corrupt state. Runner: SELECTED; result UNKNOWN.
  - `live-edge-evidence-probe.test.mjs — 321 lines` — proves recovery and monitoring evidence remains read-only and cannot invent private truth, permissions, measurements, or alarms. Runner: SELECTED; result UNKNOWN.
  - `source-and-engine.scenarios.test.mjs — 832 lines` — proves Spot and Futures source failures stay separate, stale data is blocked, quiet-volume signals remain honest, Basis identity survives, and Volume remains advice-only. Runner: SELECTED; result UNKNOWN.
  - `volume-risk.test.mjs — 567 lines` — proves a Volume proposal receives only its exact current risk decision and cannot be changed after mismatched, stale, or failed evidence. Runner: SELECTED; result UNKNOWN.
  - `canonical-owner-evidence.test.mjs — 346 lines` — proves production maps official component and saved-journal evidence without inventing topology or control authority. Runner: SELECTED; result UNKNOWN.
  - `capital-economics.test.mjs — 762 lines` — proves Basis capital and borrowing eligibility requires complete, current owner facts and rejects forged or replayed evidence. Runner: SELECTED; result UNKNOWN.
- `application/ — 3,248 lines` — four suites checking the public server shell, health, startup, shutdown, saved settings, and restart recovery.
  - `production-facade.test.mjs — 2,572 lines` — proves the server shell restores Basis and Volume settings before startup, keeps reads passive, and fails closed when health, storage, restart, or owner evidence is missing. Runner: SELECTED; result UNKNOWN.
  - `component-operational-health.test.mjs — 358 lines` — proves health reports expose lag, retry, quality, checkpoint, and restart truth without awarding a good label when evidence is absent. Runner: SELECTED; result UNKNOWN.
- `composition/ — 875 lines` — two suites checking ordered startup, bounded restart, failure containment, and reverse shutdown.
  - `composition.test.mjs — 722 lines` — proves market data starts before Basis and Volume, required failures stop both, optional failures remain contained, and shutdown retains exact ownership truth. Runner: SELECTED; result UNKNOWN.
- `contracts/ — 585 lines` — two suites checking the allowed system words, modes, identities, source truth, and import boundaries.
  - `contracts.test.mjs — 525 lines` — proves safe modes cannot become live trading, source authority cannot be invented, and malformed component, control, or trace records are rejected. Runner: SELECTED; result UNKNOWN.
- `controls/ — 741 lines` — three suites checking durable owner commands and separate Basis and Volume intake pauses.
  - `mutations.test.mjs — 499 lines` — proves a repeated command is not applied twice, stale versions and storage failures cannot change control state, and the kill switch blocks resumed or increased risk. Runner: SELECTED; result UNKNOWN.

RUNS NOW?: DEAD — test-only. Deployment starts the built server entrypoint, not these suites. The current integration runner selects every owned `.test.mjs` suite, and the full runner includes that integration runner; nothing was executed during this audit.

MONEY?: NO. These suites check Basis, Volume, capital, and risk behavior, but test files are neither trading logic nor part of either engine’s live import chain.

REMOVABLE?: YES-BUT deployed behavior remains unchanged while the named safety guarantees stop being checked during integration testing.

EVIDENCE: [package.json:16](/Users/cosmosgeek/Desktop/cosmos-live-20260809/package.json:16); [package.json:76](/Users/cosmosgeek/Desktop/cosmos-live-20260809/package.json:76); [test/run-test-all-built.mjs:14](/Users/cosmosgeek/Desktop/cosmos-live-20260809/test/run-test-all-built.mjs:14); [source-and-engine.scenarios.test.mjs:285](/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/test/systemIntegration/adapters/source-and-engine.scenarios.test.mjs:285); [production-facade.test.mjs:1094](/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/test/systemIntegration/application/production-facade.test.mjs:1094)

<!-- visible task 117 -->
## server/test/systemIntegration/{production,evidence,ops,routes} — 9,002 lines

WHAT IT IS: These 13 automated suites check the server layer joining market data, strategies, capital, safety, storage, and operator routes; they are not deployed product code. They challenge the M0 small Spot-order trial, Basis/Volume wiring, restart and deployment-freeze truth, and operator controls so unsafe evidence stops action. No suite was run during this audit.

SUB-PIECES: “Runner: YES” means selected by the current command, not passed now.

- `production/ — 5,037 lines — Four suites check real production assembly and the guarded Spot-trial boundary.`
  - `m0-spot-executor.test.mjs — 1,440 lines — Checks that hostile input and plain YES cannot reach the exchange, failures disarm safely, ambiguous entry is queried rather than resent, and restart closes residual exposure; runner: YES — integration and focused.`
  - `m0-spot-runtime-boundary.test.mjs — 1,235 lines — Checks that default boot is inert and only an exact current server-held readiness card can reach the executor; runner: YES — integration and focused.`
  - `production-ports.test.mjs — 2,071 lines — Checks fresh connected public sources, intelligence routing, Basis/Volume owner summaries, capital counts, and Opportunities without invented scores or zeros; runner: YES — integration.`
  - `restart-truth-process.test.mjs — 291 lines — Checks that clean process restarts preserve stored restart truth while exposing only minimal fail-safe health information; runner: YES — integration.`

- `evidence/ — 1,875 lines — Three suites check that source and completion records cannot manufacture money authority.`
  - `m0-automatic-receipt.test.mjs — 1,185 lines — Checks that only complete, conflict-free, exactly flat and disarmed evidence can produce a safe-finish receipt, while malformed or reusable authority fails; runner: YES — integration.`
  - `m0-spot-canary-source-boundary.test.mjs — 323 lines — Checks frozen defaults, zero effects, and a source-inspection mount that remains disarmed without an executor; runner: YES — integration and focused.`
  - `m0-spot-readiness-card.test.mjs — 367 lines — Checks the readiness card’s stable fingerprint, fixed action list, bounded lifecycle, zero-effect default, and rejection of invalid times; runner: YES — integration and focused.`

- `ops/ — 1,002 lines — Three suites check deployment-freeze and restart information used to block unsafe operation.`
  - `deployment-freeze-clear.test.mjs — 182 lines — Checks that a freeze marker clears only after current safe recovery truth and a stored operator record, with failures stopping removal; runner: YES — integration.`
  - `hostile-readback.test.mjs — 556 lines — Checks redirected files, malformed markers, stale supervisor data, identity failures, exposure ordering, stored-data versions, and the operations intake block; runner: YES — integration.`
  - `restart-truth.test.mjs — 264 lines — Checks that one exact supervisor snapshot produces restart truth and that stale, synthetic, duplicated, malformed, or contradictory evidence never becomes safe; runner: YES — integration.`

- `routes/ — 1,088 lines — Three suites check authenticated operator and read-only server routes.`
  - `control-routes.test.mjs — 489 lines — Checks operator access, bounded requests, safe repeat handling, expected-version conflicts, and the no-money barrier; runner: YES — integration.`
  - `m0-spot-canary-route.test.mjs — 475 lines — Checks that plain owner YES can inspect source posture but cannot provide order authority, and that the default web route remains disarmed; runner: YES — integration and focused.`
  - `router-read-failure-observability.test.mjs — 124 lines — Checks all nine read routes return a safe generic error while recording the true failure for operators; runner: YES — integration.`

RUNS NOW?: DEAD — test-only, not mounted in the deployed process. The deployed start command runs compiled product source; the current integration test command separately selects all 13 suites.

MONEY?: NO — these test files are neither Basis/Volume strategy logic nor part of their deployed import closure, although `production-ports.test.mjs` checks their wiring.

REMOVABLE?: YES-BUT the deployed server would keep running while current safety coverage disappears for the Spot trial, production composition, restart/freeze truth, and operator routes.

EVIDENCE: [package.json:16](/Users/cosmosgeek/Desktop/cosmos-live-20260809/package.json:16) · [package.json:76](/Users/cosmosgeek/Desktop/cosmos-live-20260809/package.json:76) · [m0-spot-canary-source-boundary.test.mjs:177](/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/test/systemIntegration/evidence/m0-spot-canary-source-boundary.test.mjs:177) · [production-ports.test.mjs:430](/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/test/systemIntegration/production/production-ports.test.mjs:430) · [hostile-readback.test.mjs:300](/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/test/systemIntegration/ops/hostile-readback.test.mjs:300)

<!-- visible task 118 -->
## server/test/systemIntegration/{supervisor,verticalSlice,scenarios,security,fixtures} + root file — 6,826 lines

WHAT IT IS: This is the test-only safety net around system assembly, monitoring truth, approval and risk boundaries, persistence, restart recovery, and forced shutdown. It uses fixed fake data (“fixtures”) to exercise Basis and Volume handoffs without live exchange authority, and it scans source for private-key, signed-request, money-moving, or hidden-network seams. It does not run the bots or calculate an edge.

SUB-PIECES:

- `fixtures/ — 1,631 — Fixed fake clocks, event records, persistence, dry-run venue, assertions, and outbound-network tripwires shared by the tests.`
  - `fixtures.test.mjs — 274 — Proves those helpers are inert until called, deterministic, bounded, and unable to submit live actions unnoticed; runner YES, selected by the current integration runner.`
- `scenarios/ — 1,152 — Thirty synthetic whole-system situations covering startup, market-source loss, Basis and Volume handoff, capital, risk, recovery, restart, monitoring, and shutdown.`
  - `acceptance.scenarios.test.mjs — 616 — Proves all 30 situations and checks that none attempts outbound network access; runner YES, selected by both current integration runners.`
  - `world.mjs — 536 — Builds the fixed fake market, engine, capital, persistence, execution, and monitoring worlds used by the acceptance suite.`
- `security/ — 665 — Source scans and sealed-runtime checks intended to expose private, signed, money-moving, credential, or hidden-network paths.`
  - `security-regressions.test.mjs — 665 — Proves live modes remain blocked, read-only ports stay passive, allowed spot exceptions stay narrowly pinned, and client wiring carries no credentials; runner YES, selected by the current integration runner.`
- `supervisor/ — 1,844 — Checks that the monitoring picture reports real readiness, root blockers, engine independence, stored-event truth, and unknown values honestly.`
  - `operating-metrics.test.mjs — 433 — Proves the 17 measures preserve owner facts, keep missing values empty, reject hostile or contradictory input, and produce repeatable revisions; runner YES.`
  - `projection.test.mjs — 777 — Proves the component map, dependency blockers, freshness, stored events, and summaries fail closed without inventing readiness; runner YES.`
  - `truth.scenarios.test.mjs — 338 — Proves real blockers and exposed capital receive priority while synthetic, dry-run, and unknown states cannot masquerade as live truth; runner YES.`
- `verticalSlice/ — 1,504 — Checks the approval-to-risk-to-dry-run chain, including rejection, persistence, kill-switch, reconciliation, and recovery behavior.`
  - `authority.scenarios.test.mjs — 588 — Proves approval binding, one-time risk use, live-mode refusal, kill-switch behavior, recovery visibility, and zero live submissions; runner YES.`
  - `fixtures.mjs — 568 — Builds a synthetic Basis proposal, capital mandate, approval, risk evidence, execution terms, and memory persistence for those checks.`
  - `real-gap-recovery.test.mjs — 348 — Proves database failure before send has zero exchange effect and an alarm-triggered kill switch persists exactly once across restart; runner YES.`
- `shutdown-refusal-exit.contract.test.mjs — 30 — Proves completed, failed, and refused shutdowns map to explicit process exits so restart cannot leave a lease-holding process stuck; runner YES.`

RUNS NOW?: DEAD — test-only. The deployed command starts compiled product source, while the server build includes only `server/src`; these files enter only test commands. The current integration runner and all-tests runner select all nine suites, but none was run during this audit, so present pass/fail is UNKNOWN.

MONEY?: NO — these files test money-adjacent handoffs, but they are outside the engines’ deployed import path and neither calculate Basis or Volume opportunities nor submit orders.

REMOVABLE?: YES-BUT the deployed process keeps working; the dedicated scenario command would break and the all-tests matrix would lose nine suites guarding source truth, Basis and Volume handoff, approval, risk, persistence, recovery, shutdown, and no-live-execution boundaries.

EVIDENCE: `package.json:16` · `server/tsconfig.json:6-13` · `package.json:74-76` · `test/run-test-all-built.mjs:7-15` · `server/test/systemIntegration/security/security-regressions.test.mjs:457-467`

<!-- visible task 119 -->
## server/test/foundation/execution/** — 11,375 lines

WHAT IT IS: Offline safety proofs for the Basis Spot-plus-perpetual rehearsal and M0, the smallest owner-gated Spot path. They check plan identity, risk limits, exchange rules, one-use permission, uncertain order replies, recovery, and flatness—zero remaining exposure. They are tests, not trading code, and were not run during this audit.

SUB-PIECES:

- `basis-validate-only-flatness.mjs — 1,362 lines — proof target: only fresh, coherent orders and positions can establish zero exposure; current runner: YES.`
- `basis-validate-only-plan-binding.mjs — 1,333 lines — proof target: owner-issued Basis, Capital, and risk evidence becomes four fixed, non-sendable steps; current runner: YES.`
- `execution.mjs — 1,171 lines — proof target: the simulated two-leg coordinator handles partial fills, timeouts, uncertain replies, recovery, and restart safely; current runner: YES.`
- `import-purity.mjs — 304 lines — proof target: loading execution code performs no hidden clock, network, file, randomness, or environment work and exposes no direct Spot send path through the shared import; current runner: YES.`
- `m0-spot-lifecycle-card.test.mjs — 567 lines — proof target: the $10 lifecycle card, fingerprints, one-use permissions, expiry, and recovery-until-flat limits remain exactly bound; current runner: YES.`
- `m0-spot-source-mount.mjs — 130 lines — proof target: plain YES only inspects blocked source, cannot inject an order or permission, and causes zero effects; current runner: YES.`
- `normal-basis-plan-risk.mjs — 964 lines — proof target: the four-step Basis rehearsal sizes from actual fills, looks up uncertain orders before retrying, survives restart, and requires account-baseline flatness; current runner: YES.`
- `spot-core.mjs — 517 lines — proof target: each Spot order binds exact risk, exchange rules, market evidence, signed-test evidence, owner permission, and final kill-switch state; current runner: YES.`
- `spot-filter-unsupported.mjs — 178 lines — proof target: unknown, unsupported, or malformed exchange constraints stop locally instead of being ignored; current runner: YES.`
- `spot-lifecycle.mjs — 527 lines — proof target: exact fills survive uncertain replies, cancellation, flattening, replay, and restart without blind resend; current runner: YES.`
- `spot-ticket-risk-filter-client-id.mjs — 1,442 lines — proof target: exact decimal arithmetic, deterministic client-order identity, exchange price/quantity/value rules, the $10 ceiling, and flatten-order derivation; current runner: YES.`
- `spot-transport-coordinator.mjs — 2,085 lines — proof target: durable permission is consumed before a fake send, concurrent calls submit at most once, uncertain results are looked up first, and recovery must match local and exchange records; current runner: YES.`
- `spot-validate-only.mjs — 795 lines — proof target: validation mode defaults off with kill on, checks symbol policy and fresh evidence, and exposes no send or money capability; current runner: YES.`

RUNS NOW?: DEAD — test-only. The deployed process does not load these files; the current Foundation test command selects every suite. None was run now, so current pass state is UNKNOWN.

MONEY?: NO — these test files are outside the deployed Basis and Volume import/runtime closure, although they guard money-adjacent source.

REMOVABLE?: YES-BUT removing them leaves deployed behavior unchanged while deleting the main regression alarms for default-off operation, one-use permission, lookup-before-retry, and exact flatness.

EVIDENCE: `package.json:16`; `package.json:72`; `ARCHITECTURE.md:21`; `server/src/systemIntegration/production/m0SpotRuntimeBoundary.ts:1438`; `server/test/foundation/execution/spot-transport-coordinator.mjs:550`.

<!-- visible task 120 -->
## server/test/foundation/{exchange,risk,borrow,calibration}/** — 7,914 lines

WHAT IT IS: This is the Foundation safety-test pack: 11 scripts covering borrow truth, outcome measurement, non-sending exchange-order preparation, and final trade-risk decisions. The scripts use fixed or fake evidence and are absent from the deployed server. Exact recount: exchange 3,769 + risk 2,386 + borrow 1,183 + calibration 576 = 7,914.

SUB-PIECES:

- `exchange/ — 3,769` — Contains the three exchange suites below; the current Foundation runner selects every script, but none ran now.
- `exchange/binanceSpotValidateOnlyAdapter/adapter.mjs — 855` — Checks that Spot orders can be validated and queried without send power, while stale, mismatched, or ambiguous evidence stays blocked; runner YES, not run now.
- `exchange/binanceUsdM/ — 1,675` — Large files are `binance-usdm.mjs — 777` and `public-groundwork.mjs — 483`; with 415 smaller lines, they check the futures read/non-matching test-order boundary, public funding and filter facts, fake transport, retries, rate limits, and zero live-network authority; runner YES, not run now.
- `exchange/binanceUsdMAdapter/binance-usdm-basis-adapter.mjs — 1,239` — Checks default-off, no-authority futures descriptors for Basis orders and query-first recovery without sending anything; runner YES, not run now.
- `risk/risk.mjs — 2,386` — Checks the final safety decision across kill state, approval, market freshness, costs, margin, liquidation, borrow, daily limits, duplicate plans, open orders, cooldown, and risk-reducing exits; runner YES, not run now.
- `borrow/ — 1,183` — `borrow.mjs — 1,075` plus 108 purity lines check exact borrow availability, liability, collateral, permissions, freshness, identity, and absence of borrow/repay actions; runner YES, not run now.
- `calibration/ — 576` — `calibration.mjs — 477` plus 99 purity lines check immutable outcome records, exact cost/result aggregation, separated strategy groups, and no automatic strategy change; runner YES, not run now.

RUNS NOW?: DEAD — test-only. The current Foundation runner selects all 11 scripts whenever invoked, but the deployed process imports none. No test ran during this audit, so there is no fresh pass claim.

MONEY?: NO — these are not Basis/Volume logic and are outside the deployed engine’s runtime imports; they only test money-critical rules.

REMOVABLE?: YES-BUT deployed behavior would remain unchanged while current borrow, exchange, calibration, and risk regression coverage would disappear.

EVIDENCE: [package.json:72](/Users/cosmosgeek/Desktop/cosmos-live-20260809/package.json:72) · [borrow.mjs:175](/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/test/foundation/borrow/borrow.mjs:175) · [calibration.mjs:448](/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/test/foundation/calibration/calibration.mjs:448) · [binance-usdm.mjs:750](/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/test/foundation/exchange/binanceUsdM/binance-usdm.mjs:750) · [risk.mjs:1977](/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/test/foundation/risk/risk.mjs:1977)

<!-- visible task 121 -->
## server/test/foundation/** excluding execution, exchange, risk, borrow, calibration — 7,213 lines

WHAT IT IS: This is the safety-test bed for shared server foundations: truth timestamps, stable references, control states, one clean data view, reconciliation, diagnostics, saved-event replay, and synthetic market situations. It uses fixed clocks, fake connections, and made-up evidence against built server code; it does not contact Binance, move money, or mount a live route. Two files provide test data or helpers; the others perform checks.

SUB-PIECES:

- `contracts/ — 871` — `contracts.mjs — 629` proves time, identity, failure, lifecycle, risk, reconciliation, opportunity, and diagnostic rules; `import-purity.mjs — 242` proves loading it performs no hidden network, clock, timer, randomness, or settings access. Selected: YES.
- `control/ — 848` — `control.mjs — 848` proves ordered start/stop, rollback, command revision protection, kill-switch behavior, dependency loss, bounded failure history, and the live-execution block. Selected: YES.
- `fixtures/ — 796` — `compatibility-fixtures.mjs — 796` supplies synthetic inputs for the compatibility suite; alone it makes no assertions. Selected: YES as a standalone file and imported by the real suite.
- `integration/ — 834` — `compatibility.mjs — 700` proves the foundation pieces agree across happy, degraded, blocked, restart, and malformed-evidence paths; `import-purity.mjs — 134` checks hidden actions across public foundation entry points. Selected: YES.
- `observability/ — 782` — `observability.mjs — 678` proves diagnostics report freshness, rates, clock skew, unknown evidence, health, and failures truthfully; `import-purity.mjs — 104` checks clean loading. Selected: YES.
- `readModel/ — 787` — `read-model.mjs — 787` proves decisions and proposals become one stable view without inventing facts, merging distinct records, hiding missing sources, or accepting hostile oversized input. Selected: YES.
- `reconciliation/ — 935` — `reconciliation.mjs — 593` proves exact, partial, duplicate, ambiguous, close, and restart evidence remains honest; `spot-restart-reconciliation.mjs — 239` proves stable spot-ledger keys and query-before-retry without sending; `import-purity.mjs — 103` checks clean loading and no order authority. Selected: YES.
- `replay/ — 832` — `replay.mjs — 720` proves bounded capture, checksums, storage round-trips, deterministic ordering, virtual time, truncation, corruption, privacy, and size limits; `import-purity.mjs — 112` checks clean loading. Selected: YES.
- `scenarios/ — 446` — `scenarios.mjs — 337` proves deterministic synthetic basis, volume, freshness, control, execution-failure, and replay situations with no trading authority; `import-purity.mjs — 109` checks clean loading and no live authority. Selected: YES.
- Root helpers — `import-purity-network-denial.mjs — 32` supplies the network-denial trap; `import-purity-network-denial.test.mjs — 50` proves every foundation loading-check installs it and that an attempted request is blocked. Selected: YES.

RUNS NOW?: DEAD — test-only. The deployed server starts from the built index; a current dedicated runner selects every owned `.mjs`, and the main all-tests runner includes that runner. Nothing was executed during this audit, so no current pass is claimed.

MONEY?: NO — basis and volume examples here are synthetic test data, not live engine logic or runtime dependencies.

REMOVABLE?: YES-BUT live behavior remains unchanged while foundation regression protection and rebuild-confidence evidence disappear.

EVIDENCE: `package.json:16`; `package.json:72`; `test/run-test-all-built.mjs:13`; `server/test/foundation/integration/compatibility.mjs:2`; `server/test/foundation/scenarios/scenarios.mjs:65`

<!-- visible task 122 -->
## server/test/{stream-lifecycle.mjs, financial-safety.mjs, gates.mjs} — 9,191 lines

WHAT IT IS: These are three test-only safety suites. They challenge live-feed recovery, financial bookkeeping, and the built server’s refusal to gain private or money-moving power from keys present in its environment. They provide no live trading logic and are not loaded by the deployed process.

SUB-PIECES:

- `stream-lifecycle.mjs — 5,009 lines — Checks safe feed retry, shutdown, stale market readings, and duplicate-free volume-scanner feed ownership; current test command selects it: YES; not run now.`
- `financial-safety.mjs — 2,797 lines — Checks serialized orders, spending limits, unknown exchange outcomes, profit/loss accuracy, account freshness, clock rollback, recovery, and corrupt financial records; current test command selects it: YES; not run now.`
- `gates.mjs — 1,385 lines — Checks the built server with isolated data and fake keys for secret leakage, withdrawal features, private access, outside network attempts, and unsafe control routes; current test command selects it: YES; not run now.`

RUNS NOW?: DEAD — test-only. Current test commands select all three, but the live deployed server does not mount them. This audit ran none of them, so no current pass is claimed.

MONEY?: NO — they inspect money safety and volume-feed behavior, but neither money engine loads them.

REMOVABLE?: YES-BUT removing them leaves live behavior unchanged while breaking current test commands until rewired and deleting important feed, account, order, and private-power safety checks.

EVIDENCE: `server/test/stream-lifecycle.mjs:9-15`; `server/test/stream-lifecycle.mjs:1722`; `server/test/financial-safety.mjs:2-5`; `server/test/gates.mjs:2-6`; `package.json:27-38`

<!-- visible task 123 -->
## server/test engine-volume*, engine-basis*, engine-decay*, volume-forward-measurement*, legacy-scanner.mjs — 6,821 lines

WHAT IT IS: Nine local test suites for the basis engine, dead-volume wakeup engine, shared strategy-decay rules, optional forward-measurement capture, and the older scanner. They feed controlled data into built server code to check calculations, safety stops, cleanup, persistence, and scheduling. Seven have current runners; two forward-measurement suites do not.

SUB-PIECES:

- `engine-basis.mjs — 873 lines` — Proves gap returns, costs, funding, borrowing, proposals, rejection rules, safety boundaries, restarts, and decay timing. Current runner: YES — `test:engine:basis:built`.
- `engine-basis-causal-gap.test.mjs — 649 lines` — Proves which market moved first for normal and reverse gaps, rejects stale ordering, and tracks widening and closing correctly. Current runner: YES — `test:engine:basis:built`.
- `engine-basis-runtime-causality.test.mjs — 416 lines` — Proves the live basis service preserves exchange event order, recovers from stuck polling, and refuses missing, stale, or untimed price legs. Current runner: YES — `test:engine:basis:built`.
- `engine-volume.mjs — 2,182 lines` — Proves quiet-volume baselines, wakeup proposals, fake-spike rejection, price follow-through, liquidity, stale data, lifecycle cleanup, persistence, safety policy, restart behavior, and decay timing. Current runner: YES — `test:engine:volume:built`.
- `engine-decay.mjs — 830 lines` — Proves hold, reduce, disable, and retire decisions plus tamper-resistant history, direction isolation, stale-writer rejection, and coordinator persistence. Current runner: YES — `test:engine:decay:built`.
- `engine-decay-measurement.mjs — 423 lines` — Proves calibration, closed-trade results, and crowding evidence become stable, degraded, dead, or unknown findings without accepting weak or hostile input. Current runner: YES — `test:engine:decay:built`.
- `volume-forward-measurement-runner.test.mjs — 832 lines` — Proves optional capture stays off by default, binds detector results to scheduled recording, resumes from a saved position, obeys the kill switch, and fails closed. Current runner: NO — no package runner selects it.
- `volume-forward-measurement-scheduler.test.mjs — 471 lines` — Proves schedule validation, exact timed cuts, overlap suppression, and safe failure, stop, and resume behavior. Current runner: NO — no package runner selects it.
- `legacy-scanner.mjs — 145 lines` — Proves the older scanner closes and removes proposals when symbols disappear, evidence becomes stale, or liquidity becomes ineligible. Current runner: YES — `test:focused:built`.

RUNS NOW?: DEAD — test-only; the deployed process does not load these files. This audit ran none, so there is no fresh pass result.

MONEY?: NO — these suites check basis and volume money logic but contain no deployed trading calculation or order action.

REMOVABLE?: YES-BUT removing the block leaves the live server running while breaking seven named test commands and deleting this layer of regression protection.

EVIDENCE: `server/test/engine-basis-causal-gap.test.mjs:120`; `server/test/engine-volume.mjs:191`; `server/test/engine-decay-measurement.mjs:240`; `server/test/volume-forward-measurement-scheduler.test.mjs:132`; `package.json:29-38`

<!-- visible task 124 -->
## server/test/ direct-root remainder — 7,817 lines

WHAT IT IS: This is the top-level server test layer left after Splits 46A–B. It checks access, Binance request safety, loans, temporary data, private account reads, stored records, cloud controls, optional surfaces, and network blocking. Current commands select 13 files; five are present but unselected. None was run during this audit.

SUB-PIECES:

- `optional-surface-load-control.test.mjs — 1,049 lines — proves optional surfaces start off, reject work while off, drain on stop, and shut down in order; current runner: YES, focused.`
- `private-read.mjs — 821 lines — proves private account reads check permissions first, expose uncertainty honestly, and cannot feed money-changing services; current runner: NO.`
- `storage-aws-hardening.mjs — 791 lines — proves bad configuration and stored data halt safely, money decimals survive migration, and cloud controls have deadlines and durable gates; current runner: YES, focused.`
- `private-egress-tripwire.mjs — 757 lines — blocks and records nonlocal network attempts across requests, sockets, name lookup, live connections, and child workers; current runner: YES, loaded before other tests.`
- `perimeter.mjs — 715 lines — proves that network blocking resists redirects, custom connectors, caught failures, and stuck children while permitting controlled same-computer checks; current runner: YES, negative controls.`
- `loans.mjs — 617 lines — proves loan actions reject unsafe inputs, serialize collateral reductions, retain stale truth, and block repeats after uncertain money effects; current runner: YES, focused.`
- `network-cache.mjs — 602 lines — proves Binance, money-flow, profile, and news work is shared, bounded, timed out, sanitized, and never mislabeled fresh; current runner: YES, focused.`
- `news-context-runtime-recovery.test.mjs — 496 lines — proves late or rejected news work cannot leak into a later publication and retained news ages honestly; current runner: NO.`
- `run-ai-ops.mjs — 445 lines — runs five automation test lanes with fixed file counts, network denial, child deadlines, and failure accounting; current runner: YES, automation command and main test command.`
- `access.mjs — 335 lines — proves same-computer admission, foreign-site refusal, owner-token verification, and safe signing-key source selection; current runner: YES, focused.`
- `binance-client.mjs — 320 lines — proves authenticated Binance requests are signed safely, bounded, redacted, rate-limited, clock-corrected, and fully paginated; current runner: YES, focused.`
- `market-source-published-snapshot.process.test.mjs — 250 lines — would prove Markets and Product reads return stale or unavailable truth promptly when source refreshes hang; current runner: NO.`
- `run-deterministic-network-free.mjs — 217 lines — runs the selected engine, focused, assurance, and acceptance suites under the network blocker and preserves child failures; current runner: YES, main and all-tests commands.`
- `risk-gates.mjs — 176 lines — proves each of sixteen money-admission gates can refuse independently and the clean path requires them all; current runner: YES, focused.`
- `ledger-count-load-shedding.test.mjs — 85 lines — proves event counts stay inside one indexed database count instead of loading every matching row; current runner: NO.`
- `market-source-snapshot-fetch.preload.mjs — 62 lines — supplies delayed and permanently stuck feeds to the unselected market process suite; current runner: NO.`
- `news-context-identity.test.mjs — 42 lines — proves reused feed identifiers preserve distinct stories while exact duplicates collapse consistently; current runner: YES, focused.`
- `bind-host.test.mjs — 37 lines — proves the server accepts only same-computer bind addresses and rejects unsafe or accidental ports; current runner: YES, focused.`

RUNS NOW?: DEAD — test-only. The deployed process starts `server/dist/index.js`; it does not execute these files. Current commands select 6,103 lines, while the five unselected files total 1,714 lines.

MONEY?: NO — these files test money and safety behavior but contain no Basis or Volume strategy logic and are absent from their deployed runtime chain.

REMOVABLE?: YES-BUT removing selected files breaks current verification commands or their network guard; removing the five unselected files leaves the deployed server unchanged but discards dormant safety proof.

EVIDENCE: `package.json:16`; `package.json:37-43`; `package.json:93-95`; `server/test/run-deterministic-network-free.mjs:20-31`; `server/test/market-source-published-snapshot.process.test.mjs:102-116`

<!-- visible task 125 -->
## server/test/intelligenceRuntime/{baseline,books,bridge,capacity,capture,contracts,derivatives,fixtures}/** — 6,084 lines

WHAT IT IS: These are exchange-network-free checks for historical candles, live bid-and-ask books, public futures facts, workload limits, evidence handoff, and later outcome capture. They check repeatability, hard size limits, saved-state recovery, honest missing or old data, and harmless code loading. They neither collect live data nor trade.

SUB-PIECES: “Runner: YES” means the current dedicated and canonical full test launchers select the suite; none was run now.

- `baseline/baseline.test.mjs — 894 lines` — checks candle-history loading, completed-candle rules, request limits, saved restart points, retries, failures, time handling, and repeatable output; runner: YES.
- `baseline/import-purity.test.mjs — 33 lines` — checks that loading baseline code starts no clock, randomness, timer, socket, or web request; runner: YES.
- `books/books.test.mjs — 745 lines` — checks Spot and dollar-settled futures bid-and-ask reconstruction, recovery after missing updates, spread, depth, slippage, flow, freshness, and memory limits; runner: YES.
- `books/import-purity.test.mjs — 33 lines` — checks that loading book code starts no clock, randomness, timer, socket, or web request; runner: YES.
- `bridge/bridge.test.mjs — 1,071 lines` — checks public facts moving through universe, feature, focus, thesis, and frozen-evidence stages without gaining private authority, losing traceability, changing inputs, or exceeding limits; runner: YES.
- `bridge/event-loop-starvation.process.test.mjs — 361 lines` — checks removal of old trace records against a simple reference and checks that full-size overflow does not starve health replies or leave processor use high; runner: YES.
- `bridge/import-purity.test.mjs — 35 lines` — checks that loading bridge code starts no clock, randomness, timer, socket, or web request; runner: YES.
- `capacity/capacity.test.mjs — 415 lines` — checks the fixed 452-symbol workload, replacement-update limits, optional-source shedding under pressure, staged recovery, processing delay, and memory accounting; runner: YES.
- `capacity/import-purity.test.mjs — 32 lines` — checks that loading capacity code starts no clock, randomness, timer, socket, or web request; runner: YES.
- `capture/capture.test.mjs — 963 lines` — checks evidence before and after a trigger, exact later outcome windows, public-only authority, overflow honesty, duplicate handling, saved-state restore, and file fingerprints; runner: YES.
- `capture/import-purity.test.mjs — 32 lines` — checks that loading capture code starts no clock, randomness, timer, socket, or web request; runner: YES.
- `contracts/contracts.test.mjs — 360 lines` — checks source start, connection, message, processing and stop states, freshness, reconnect generations, retry limits, stable stored text, and data-size limits; runner: YES.
- `contracts/import-purity.test.mjs — 32 lines` — checks that loading contract code performs no background input, output, clock, timer, socket, or web work; runner: YES.
- `derivatives/derivatives.test.mjs — 792 lines` — checks public futures refreshes for open interest, funding, crowd positioning and liquidations, plus request cost, rate denial, partial results, old data, retained facts, source time, and response limits; runner: YES.
- `derivatives/import-purity.test.mjs — 35 lines` — checks that loading derivatives code starts no clock, randomness, timer, socket, or web request; runner: YES.
- `fixtures/binance-public-fixtures.mjs — 251 lines` — provides a manual clock, fake request and stream connections, and Binance-shaped public replies; runner: NOT A SUITE, but a selected integration suite loads it.

RUNS NOW?: DEAD — test-only. The deployed start command runs `server/dist/index.js`; test launchers select these files only during testing, and this audit ran none.

MONEY?: NO. These files check money-adjacent market data and evidence, but no Basis or Volume engine imports test code while running.

REMOVABLE?: YES-BUT live behavior would not change, while these safety checks would disappear and the current runtime-compatibility suite would break because it imports the owned fixture file.

EVIDENCE: `package.json:16`; `package.json:68`; `test/run-test-all-built.mjs:11`; `server/test/intelligenceRuntime/bridge/event-loop-starvation.process.test.mjs:265`; `server/test/intelligenceRuntime/integration/runtime-compatibility.test.mjs:36`.

<!-- visible task 126 -->
## `server/test/intelligenceRuntime/{focus,futures,integration,lifecycle,routing,smoke,snapshot,spot,universe}/**` — 8,501 lines

WHAT IT IS: Test-only checks for the public-market-data machinery that Basis and Volume depend on: finding eligible markets, reading Spot and perpetual-futures feeds, preserving freshness and order, assigning deeper feeds, routing evidence, and reporting health. They challenge it with stale, missing, duplicated, out-of-order, oversized, rate-limited, and restarted inputs so missing truth never becomes invented data or false green. They place no orders and are not part of the deployed process.

SUB-PIECES:

- `routing/ — 1,630 lines` (`routing.test.mjs` 1,595; import-purity 35) — proves exact-symbol trades, prices, order-book changes, and derivatives context reach the shared evidence store without cross-symbol mixing; gaps and restarts remain missing until re-proved. Runner: YES, dedicated runner and canonical `test:all`; not run now.
- `integration/ — 1,149 lines` (`runtime-compatibility.test.mjs` 1,102; import-purity 47) — proves the complete public-data chain across healthy flow, dormant and waking tokens, Spot/perpetual leadership, stale feeds, sequence gaps, focus pressure, rate limits, history gaps, capture freeze, and shutdown. Runner: YES; not run now.
- `universe/ — 1,134 lines` (`universe.test.mjs` 1,102; import-purity 32) — proves Spot and perpetual market listings and trading rules join correctly while partial replies, listing changes, rate limits, stale data, and capacity limits stay honest. Runner: YES; not run now.
- `spot/ — 1,038 lines` (`spot.test.mjs` 1,006; import-purity 32) — proves Spot price summaries, best prices, and trades preserve quiet symbols, freshness, order, reconnect state, bounded memory, and repeatable output. Runner: YES; not run now.
- `lifecycle/ — 1,035 lines` (`lifecycle.test.mjs` 823; `source-isolation.test.mjs` 179; import-purity 33) — proves live-feed connection, retry, stop, queues, gap recovery, request budgets, processing delay, and durable source-by-source isolation/restart behavior. Runner: YES; not run now.
- `futures/ — 759 lines` (`futures.test.mjs` 730; import-purity 29) — proves public perpetual-futures prices, mark/funding, contract, and sampled-liquidation records keep exact identity and time, reject stale or regressed data, and remain bounded. Runner: YES; not run now.
- `snapshot/ — 657 lines` (`snapshot.test.mjs` 624; import-purity 33) — proves the official runtime summary never labels stopped, silent, stale, gapped, or truncated public inputs green and emits stable bounded state. Runner: YES; not run now.
- `focus/ — 623 lines` (`focus.test.mjs` 588; import-purity 35) — proves limited deep-feed slots are assigned, retried, and removed predictably; protected money-linked symbols win capacity and missing/private evidence remains unfilled. Runner: YES; not run now.
- `smoke/ — 476 lines` (`smoke.test.mjs` 431; import-purity 45) — proves the keyless manual public check covers market discovery, broad/deep feeds, health, and shutdown while refusing private or signed destinations and false-green outcomes. Runner: YES; not run now.

RUNS NOW?: DEAD — test-only. The deployed command starts `server/dist/index.js`; the dedicated Intelligence Runtime runner and canonical `test:all` select these files, but ordinary `npm test` does not. No test was executed now.

MONEY?: NO — these test files are outside the Basis and Volume import/runtime closure; they verify public-data dependencies used by those engines but do not make strategy decisions or trade.

REMOVABLE?: YES-BUT removing them leaves live behavior unchanged while stripping current regression proof for public-input correctness, false-green refusal, ordering, capacity, routing, and source recovery used around both money engines.

EVIDENCE: `package.json:16` · `package.json:68-69` · `package.json:93-95` · `test/run-test-all-built.mjs:7-12` · `server/test/intelligenceRuntime/integration/runtime-compatibility.test.mjs:607-731`

<!-- visible task 127 -->
## server/test/aiOps/a2/** — 6,155 lines

WHAT IT IS: This is the test packet for Shadow A2, a proposed layer for receiving operational incidents, finding likely causes, and preparing an owner handoff. Its 14 suites define 179 checks covering evidence, model-use budgets, provider switching, durable recovery, and strict no-network/no-authority rules. No suite was run during this read-only audit, so there is no current pass claim.

SUB-PIECES:

- `a2x-entry-gate.test.mjs` — 144 lines — Proves the imported A2 packet stays tied to approved paths and old requests cannot create authority. Current runner selects: YES.
- `a2x-replay-fixtures.test.mjs` — 251 lines — Proves saved synthetic examples replay identically and reject damaged or altered restart data. Current runner selects: YES.
- `budget-depth.test.mjs` — 326 lines — Proves model usage, price origin, rate limits, and unknown costs remain exact without reserving capacity. Current runner selects: YES.
- `budget-outage.test.mjs` — 425 lines — Proves spending limits and provider switching cannot be bypassed during outages; the synthetic provider has no authority. Current runner selects: YES.
- `context-handoff.test.mjs` — 301 lines — Proves bounded, signed context handoffs reject missing facts, expiry, replay, altered content, and stale ownership. Current runner selects: YES.
- `diagnostic-handoff.test.mjs` — 614 lines — Proves diagnoses separate validated facts from guesses and create bounded, expiring model handoffs backed by owner-checked evidence. Current runner selects: YES.
- `escalation-intent.test.mjs` — 548 lines — Proves an owner handoff requires matching case, diagnosis, proposal, Product Assurance decision, and signed owner binding without claiming delivery or authority. Current runner selects: YES.
- `event-intake.test.mjs` — 255 lines — Proves outside event envelopes become stable neutral records while missing order, hostile input, and oversized data are quarantined. Current runner selects: YES.
- `evidence-quarantine.test.mjs` — 381 lines — Proves evidence is redacted, size-limited, freshness-checked, and unable to authorize action when stale, hostile, missing, or unreadable. Current runner selects: YES.
- `handoff-consumption.test.mjs` — 257 lines — Proves a valid handoff is consumed once, leaves linked receipts, survives restart, and rejects replay or tampering. Current runner selects: YES.
- `incident-admission.test.mjs` — 794 lines — Proves signals are normalized, redacted, deduplicated, grouped into storms, cooled down, and safely restored from bounded records. Current runner selects: YES.
- `persistence-backpressure.test.mjs` — 937 lines — Proves bounded durable records, retries, failed-work holding, overload refusal, exact-version saving, and restart history; effects remain intent-only. Current runner selects: YES.
- `purity-network-deny.test.mjs` — 205 lines — Proves A2 stays inside approved paths, avoids likely credentials and hidden outside input/output, and cannot bypass the test network block. Current runner selects: YES.
- `workflow-recovery.test.mjs` — 621 lines — Proves the full case path from evidence through budget, verification, handoff, effect readback, restart, and quiet-period recovery. Current runner selects: YES.
- `network-deny.mjs` — 96 lines — Loaded before the suites; immediately refuses common network routes and records any attempt. Current runner loads it: YES; it is not a suite.

RUNS NOW?: DEAD — test-only. Production starts `server/dist/index.js`; these files are selected only by the AI operations test runner.

MONEY?: NO — this block tests shadow incident automation, not basis or volume trading logic, and grants no live trading authority.

REMOVABLE?: YES-BUT live behavior stays unchanged, while the current AI operations test lane breaks and loses all 179 A2 safety checks.

EVIDENCE: `package.json:16` · `package.json:43` · `server/test/run-ai-ops.mjs:308` · `server/test/run-ai-ops.mjs:309` · `server/test/run-ai-ops.mjs:313`

<!-- visible task 128 -->
## `server/test/aiOps/{a1,a3,a5}` — 6,383 lines

WHAT IT IS: These are artificial-intelligence operations safety tests. A1 checks authority and policy rules; A3 checks provider, tool, repair-plan, and return-message boundaries; A5 checks failure scenarios and proves the artificial-intelligence layer remains advisory. No suite was run during this audit, so this is not a current pass claim.

SUB-PIECES:

- `a1/ — 2,560 lines` — Eight suites plus a 23-line network-blocking helper.
  - `artifacts-purity.test.mjs — 359 lines` — Checks fixed test data against source, archived proof, exact file membership, and credential-free contents; runner selects: YES, not run now.
  - `authority-identity.test.mjs — 339 lines` — Checks permanent denials, separated worker identities, provider states, and account-substitution blocking; runner selects: YES, not run now.
  - `classification.test.mjs — 264 lines` — Checks deterministic safety classification and rejects unknown, cyclic, or dangerous inputs; runner selects: YES, not run now.
  - `controls-insertion.test.mjs — 123 lines` — Checks proposed controls remain no-effect drafts and unfinished links gain no authority; runner selects: YES, not run now.
  - `instances.test.mjs — 182 lines` — Checks concrete runbooks and controls are bounded, unsigned, effect-free, and hostile-input resistant; runner selects: YES, not run now.
  - `receipt.test.mjs — 83 lines` — Checks old shadow receipts remain history rather than acceptance; runner selects: YES, not run now.
  - `runbook-policy.test.mjs — 880 lines` — Checks owner runbooks, numerical targets, signed-policy failure handling, retained safe policy, and exact stored decision readback; runner selects: YES, not run now.
  - `schema-closure.test.mjs — 307 lines` — Checks every public data shape rejects extra, malformed, oversized, or hostile fields; runner selects: YES, not run now.
- `a3/ — 2,882 lines` — Five suites plus a 13-line network-blocking loader.
  - `callbacks.test.mjs — 605 lines` — Checks signed jobs and return messages bind the correct worker, provider, and model while blocking duplicates, tampering, and stale messages; runner selects: YES, not run now.
  - `fixturesPurity.test.mjs — 159 lines` — Checks provider states, identities, draft requests, archived receipts, and absence of live provider or credential access; runner selects: YES, not run now.
  - `patchWorker.test.mjs — 367 lines` — Checks the repair worker can only propose an exact-version isolated plan and never execute it; runner selects: YES, not run now.
  - `providerCliMatrix.test.mjs — 555 lines` — Checks paid-service and owner-subscription routes stay separate, unconfigured adapters remain inert, and billing never silently switches; runner selects: YES, not run now.
  - `toolEgress.test.mjs — 1,183 lines` — Checks the single gate for tool calls ships disabled, reveals no credentials, validates all inputs and outputs, and returns only canned repository evidence without effects; runner selects: YES, not run now.
- `a5/ — 941 lines` — Five synthetic failure and removal suites.
  - `ai-off-survival.test.mjs — 92 lines` — Checks losing or removing artificial intelligence leaves deterministic safety unchanged and cannot promote or alter live state; runner selects: YES, not run now.
  - `contract-shapes.test.mjs — 595 lines` — Checks diagnostic limits, owner approval, budgets, privacy, locks, monitoring data, safe controls, and absence of a live owner, store, connection, or executor; runner selects: YES, not run now.
  - `fault-families.test.mjs — 62 lines` — Checks stale, missing, hostile, or failed evidence cannot fabricate success or promotion; runner selects: YES, not run now.
  - `hard-denial-boundary.test.mjs — 119 lines` — Checks forbidden capabilities, including orders and capital, stop before any provider, network, or product effect; runner selects: YES, not run now.
  - `restart-replay-fencing.test.mjs — 73 lines` — Checks stored restart, duplicate delivery, approval binding, budgets, and single-winner worker locking; runner selects: YES, not run now.

RUNS NOW?: DEAD — test-only. The deployed service starts `server/dist/index.js`, while the current test runner separately discovers every owned suite. No present pass result was measured.

MONEY?: NO — these tests contain neither basis nor volume trading logic and are not imported by the live money engines.

REMOVABLE?: YES-BUT removing them breaks the current artificial-intelligence test runner and its expected-file gate, deleting safety evidence and blocking the canonical check chain; the live process itself does not import them.

EVIDENCE:

- [`server/test/aiOps/a1/runbook-policy.test.mjs:208`](/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/test/aiOps/a1/runbook-policy.test.mjs:208)
- [`server/test/aiOps/a3/toolEgress.test.mjs:179`](/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/test/aiOps/a3/toolEgress.test.mjs:179)
- [`server/test/aiOps/a5/contract-shapes.test.mjs:535`](/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/test/aiOps/a5/contract-shapes.test.mjs:535)
- [`server/test/run-ai-ops.mjs:266-342`](/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/test/run-ai-ops.mjs:266)
- [`ops/live/systemd/cosmos-app.service:37`](/Users/cosmosgeek/Desktop/cosmos-live-20260809/ops/live/systemd/cosmos-app.service:37)

<!-- visible task 129 -->
## server/test/capitalFoundation/{accountTruth,actions,allocation,approvals,budgets,checkpoint,compatibility,contracts,economics}/** — 6,671 lines

WHAT IT IS: These are 12 suites—groups of automated checks—plus one helper, not live bot code. They challenge the capital safety layer that turns account facts into budgets, approvals, capital reservations, safe position targets, restart records, and profit/cost reports. Basis and Volume inputs appear in the checks, but nothing here scans markets or sends orders. Exact recount: 13 files and 6,671 lines.

SUB-PIECES:

- `accountTruth/accountTruth.test.mjs — 734` — Proves wallet, margin, debt, reserve, exposure, and spendable-capital calculations stay conservative when facts are missing, stale, conflicting, duplicated, or changed unexpectedly. Runner: YES, selected by `test:capital:built`; not run now.
- `actions/actions.test.mjs — 462` — Proves hold, add, reduce, hedge, exit, and emergency targets require exact fresh permission; pause or unknown state blocks increases while preserving reductions. Runner: YES; not run now.
- `allocation/allocation.test.mjs — 1,284` — Proves scarce capital is ranked and capped, reservations cannot duplicate claims, release happens once, and Basis or Volume proposals cannot grant themselves more authority. Runner: YES; not run now.
- `allocation/reservation-closure.test.mjs — 301` — Proves used capital is released only after the matching mandate, closed position, execution, and exact account match agree. Runner: YES; not run now.
- `approvals/approvals.test.mjs — 476` — Proves read-only, advisory, validation-only, and manual approval states cannot silently become execution permission; scope, expiry, revocation, limits, and repeated use remain enforced. Runner: YES; not run now.
- `budgets/budgets.test.mjs — 421` — Proves exact account facts become an allocation budget without double-counting commitments, spending the reduction reserve, or exceeding exposure, position, and plan limits. Runner: YES; not run now.
- `checkpoint/checkpoint.test.mjs — 563` — Proves saved capital events restore consistently, reject gaps or forged authority, and keep exposed positions reducible after a stale restart. Runner: YES; not run now.
- `checkpoint/officialMandateFixture.mjs — 106` — Helper, not a suite; builds the official mandate input used by the checkpoint checks. Runner: INDIRECT, loaded by the checkpoint suite; not run now.
- `compatibility/compatibility.test.mjs — 769` — Proves Basis, Volume, and Market Intelligence inputs enter the official capital format without inventing money values, permission, or caller-changeable state. Runner: YES; not run now.
- `contracts/contracts.test.mjs — 508` — Proves exact money text, identities, truth states, position stages, accounting fields, action risk, and controls reject illegal or ambiguous forms. Runner: YES; not run now.
- `contracts/vocabulary.test.mjs — 36` — Proves the permitted action, stage, and lifecycle lists cannot be widened while the process is running. Runner: YES; not run now.
- `economics/economics.test.mjs — 403` — Proves profit and costs add exactly, unknown never becomes zero, duplicates do not double-count, and very large values remain exact. Runner: YES; not run now.
- `economics/segmentation.test.mjs — 608` — Proves closed profit/loss can be split across nine labels without inventing production truth, while oversized, hostile, or forged evidence is rejected. Runner: YES; not run now.

RUNS NOW?: DEAD — test-only and not loaded by the deployed process. Live start runs `server/dist/index.js`, while the server build includes only `server/src`. A current capital test command selects every owned `.test.mjs` suite, but no test was run now, so current pass/fail is UNKNOWN.

MONEY?: NO — these files test capital rules used around both bots, but they are outside the engines’ live import and build path.

REMOVABLE?: YES-BUT live execution would not change directly; removing them erases automated proof for account truth, budgets, approvals, allocation, restart safety, action limits, and economics.

EVIDENCE: `package.json:16`; `server/tsconfig.json:13`; `package.json:70`; `server/test/capitalFoundation/compatibility/compatibility.test.mjs:435`; `server/test/capitalFoundation/compatibility/compatibility.test.mjs:510`

<!-- visible task 130, coordinator-corrected exclusive remainder -->
## server/test/capitalFoundation/{opportunities,positions,scenarios,stages,supervision,topology}/** — 5,598 lines

WHAT IT IS: This is the exclusive remainder of the Capital Foundation test tree after the 6,671-line intake/contract split. It tests opportunity conversion, position projection, complete scenarios, staged mandates, position supervision, and the operator dependency graph. It is proof code and does not run in the deployed server.

SUB-PIECES:

- `opportunities/opportunities.test.mjs — 805 — checks how opportunities become conservative capital candidates.`
- `positions/projection.test.mjs — 448 — checks position projections and truthful absence handling.`
- `scenarios/ — 2,047 — supplies 30 end-to-end capital scenarios through a 1,002-line fixture builder, 1,033-line harness, and 12-line registration file.`
- `stages/stages.test.mjs — 842 — checks staged plans, reservations, approvals, revisions, risk, and reduction access.`
- `supervision/supervision.test.mjs — 978 — checks Basis/Volume position supervision, additions, reductions, exits, and emergency recovery.`
- `topology/topology.test.mjs — 478 — checks the capital dependency graph, blockers, recovery paths, and exposed capital.`

RUNS NOW?: DEAD — test-only. The capital runner selects these suites and the full test launcher includes that runner, but no test was executed and current results are UNKNOWN.

MONEY?: NO — these files test money-support policy; neither live engine imports them.

REMOVABLE?: YES-BUT deployed behavior stays unchanged while the capital and full test gates lose this proof.

EVIDENCE: `package.json:70`; `test/run-test-all-built.mjs:12`; `server/test/capitalFoundation/scenarios/harness.mjs:350`.

<!-- visible task 131 -->
## server/test/productIntegration/** — 8,008 lines

WHAT IT IS: This is the automated proof pack for the server glue that combines owner facts into one truthful system view, safe controls, durable incidents, browser routes, and live-browser delivery. It contains 20 test suites totaling 7,726 lines plus one 282-line shared helper. These tests were not run during this read-only audit.

SUB-PIECES: Runner YES means the current focused runner and required all-tests runner both select the suite; it does not mean the suite passed now.

- `adapters/adapters.test.mjs — 85 lines — proves research, strategy, capital, risk, and execution handoffs cannot turn missing or contradictory evidence into approval — runner YES.`
- `commands/commands-events.test.mjs — 102 lines — proves command previews, duplicate handling, event paging, gaps, and secret rejection — runner YES.`
- `contracts/config-documentation.test.mjs — 48 lines — proves operator documentation remains keyless, excludes unapproved notification intake, and names the intended deployment path — runner YES.`
- `contracts/contracts.test.mjs — 130 lines — proves data shapes, stable serialization, size limits, and hostile-input rejection — runner YES.`
- `fixtures/ports.test.mjs — 342 lines — proves fixed test examples preserve owner truth, database-ledger identity, repeat safety, and bounded command results — runner YES.`
- `incidents/incident-events.test.mjs — 192 lines — proves acknowledgement creates one immutable history row without deleting source or recovery evidence — runner YES.`
- `incidents/incident-owner.test.mjs — 324 lines — proves acknowledgement happens once at the exact database-ledger version and rejects competing, malformed, or partly written state — runner YES.`
- `incidents/incident-router.test.mjs — 598 lines — proves alert floods become bounded durable episodes with preserved acknowledgement, recovery, restart, and rotation truth — runner YES.`
- `lifecycle/lifecycle.test.mjs — 180 lines — proves boot, pause, drain, restart, and shutdown plans preserve persistence, reconciliation, and recovery — runner YES.`
- `purity/purity.test.mjs — 60 lines — proves pure modules do not secretly use networks, files, timers, environment values, randomness, or test fixtures — runner YES.`
- `runtime/component-health-projection.test.mjs — 190 lines — proves health output preserves every owner field and shows unknown or contradictory evidence instead of false green — runner YES.`
- `runtime/crash-readback.process.test.mjs — 372 lines — proves a forced process death and restart preserve crash-pending truth, while corrupt history remains unavailable — runner YES.`
- `runtime/incident-command.test.mjs — 442 lines — proves incident preview, submission, and result lookup delegate to the incident owner without creating a separate system mutation — runner YES.`
- `runtime/owner-truth-adapter.test.mjs — 961 lines — proves market and account facts become exact owner-backed rows while partial, stale, malformed, or unavailable inputs stay non-green — runner YES.`
- `runtime/owner-truth.test.mjs — 643 lines — proves one immutable owner snapshot consistently feeds Dashboard, Account, and Markets without inventing missing facts — runner YES.`
- `runtime/routes.test.mjs — 476 lines — proves shared supervisor reads, cache timing, fixed browser paths, query bounds, and command-result states — runner YES.`
- `runtime/runtime.test.mjs — 1,139 lines — proves the complete Product supervisor output: readiness, incidents, managed roles, release identity, public-source freshness, event pages, traces, and control availability — runner YES.`
- `runtime/system-control-command-owner.test.mjs — 1,008 lines — proves durable safe controls, exact replay, Basis and Volume intake, focus pinning, and source isolation or restart — runner YES.`
- `runtime/websocket-delivery.test.mjs — 277 lines — proves bounded live-browser event delivery, resume cursors, explicit gaps, and change notices without a duplicate state timer — runner YES.`
- `supervisor/supervisor.test.mjs — 157 lines — proves dependency failures, capital exposure, queue pressure, and stale sources prevent false readiness — runner YES.`
- `runtime/testSupport.mjs — 282 lines — shared fixed inputs for runtime suites; not a suite and not selected directly.`

RUNS NOW?: DEAD — test-only. The deployed start command loads the built server, not these files; all 20 suites are selected only when the focused or required all-tests runner is invoked.

MONEY?: NO — several suites guard money-adjacent truth and controls, but these files contain neither Basis nor Volume trading logic and the deployed server does not load them.

REMOVABLE?: YES-BUT removing them leaves deployed behavior unchanged while deleting the required Product Integration regression proof from both current runners.

EVIDENCE: `package.json:16`; `package.json:78`; `test/run-test-all-built.mjs:16`; `server/test/productIntegration/runtime/runtime.test.mjs:76`; `server/test/productIntegration/incidents/incident-router.test.mjs:105`

<!-- visible task 132 -->
## server/test/intelligenceFoundation/** — 6,061 lines

WHAT IT IS: Ten automated suites plus shared made-up market records test the market-intelligence evidence layer. They cover the path from public exchange facts through token selection, measurements, attention, explanations, false-alarm screening, and later outcomes without inventing certainty or using future information. They test an evidence-only handoff to Basis and Volume inputs; they make no trading decision or action.

SUB-PIECES: “Runner YES” means the configured focused command and full test gate select the suite; none was run now.

- `integration/compatibility.test.mjs — 764 lines — Proves twelve whole-path scenarios including genuine wakeups, fake spikes, missing borrow, stale facts, disappearing depth, late detection, and outcome tracking; runner YES.`
- `universe/universe.test.mjs — 675 lines — Proves stable joining of spot, futures, margin, borrow, and market-coverage truth without dropping quiet tokens; runner YES.`
- `outcomes/outcomes.test.mjs — 649 lines — Proves future-blind outcome measurement, returns, price excursions, fade, depth feasibility, and accepted-versus-rejected groups; runner YES.`
- `features/features.test.mjs — 580 lines — Proves volume, trade-flow, spread, depth, absorption, market leadership, funding, open-interest, and liquidation measurements; runner YES.`
- `topology/topology.test.mjs — 567 lines — Proves the component map, dependencies, cycles, blocking paths, freshness, bounds, and library-only status; runner YES.`
- `attention/attention.test.mjs — 544 lines — Proves scarce deep monitoring is assigned deterministically while protecting active capital and retaining cheap coverage of quiet tokens; runner YES.`
- `evidence/evidence.test.mjs — 520 lines — Proves consistent public-record shapes, timestamps, sequence handling, missingness, staleness, borrow facts, and secret rejection; runner YES.`
- `contracts/contracts.test.mjs — 492 lines — Proves stable identifiers, exact record shapes, truth rules, proposal-description rules, future-data rejection, and bounded inputs; runner YES.`
- `thesis/thesis.test.mjs — 491 lines — Proves market-stage and hypothesis explanations, evidence alignment, missing-data behavior, and absence of prescriptive trade fields; runner YES.`
- `forensics/forensics.test.mjs — 410 lines — Proves ten false-alarm checks and keeps incomplete, sampled, stale, future, or oversized evidence blocked or unknown; runner YES.`
- `fixtures/ — 369 lines — Supplies made-up market records and a test-only engine handoff; loaded indirectly by the compatibility suite, with no standalone runner selection.`

RUNS NOW?: DEAD (test-only) — the server build includes `src` only. The focused test command selects all ten suites on demand, and the full test gate includes that command.

MONEY?: NO — these files are not loaded by the live program and cannot trade; they only test evidence that Basis and Volume may read.

REMOVABLE?: YES-BUT the configured full test gate loses this intelligence suite, removing regression proof for evidence truth, false-alarm rejection, and the Basis/Volume handoff.

EVIDENCE: [server/tsconfig.json:13](/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/tsconfig.json:13) · [package.json:66](/Users/cosmosgeek/Desktop/cosmos-live-20260809/package.json:66) · [test/run-test-all-built.mjs:10](/Users/cosmosgeek/Desktop/cosmos-live-20260809/test/run-test-all-built.mjs:10) · [server/test/intelligenceFoundation/integration/compatibility.test.mjs:358](/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/test/intelligenceFoundation/integration/compatibility.test.mjs:358) · [server/test/intelligenceFoundation/fixtures/engine-compatibility.mjs:15](/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/test/intelligenceFoundation/fixtures/engine-compatibility.mjs:15)

<!-- visible task 133 -->
## server/test/{binance,productAssurance,i00Acceptance,m1,ops,bootstrap} — 7,081 lines

WHAT IT IS: Six test suites checking Binance permission and signing safety, product-wide safeguards, whole-product acceptance, the first Basis handoff, production logging, and startup configuration. They are not loaded by the deployed server and cannot trade. No tests were run during this audit.

SUB-PIECES:

- `binance/ — 2,054 lines` — Checks read-only account permissions and the one-use guarded Spot test-order request. CURRENT RUNNER: PARTIAL; 1,819 lines selected, 235-line private-read decoder unselected.
  - `m0-spot-signed-transport.test.mjs — 1,268 lines` — Checks that one approval permits one exact signed test request and that expiry, replay, malformed input, or clock disagreement stops before signing. CURRENT RUNNER: YES.
  - `m0-spot-permission-truth.test.mjs — 551 lines` — Checks separate read and execution profiles and forbids withdrawals, transfers, Margin, Futures, Options, and unsafe permissions. CURRENT RUNNER: YES.
- `productAssurance/ — 1,670 lines` — Checks operation ownership, evidence binding, failure handling, repair limits, and safe diagnostics. CURRENT RUNNER: YES; one obsolete fixed-count case is excluded and replaced by a current source scan.
  - `systemic-diagnostics.test.mjs — 520 lines` — Checks uncertainty remains visible and diagnostics cannot grant authority. CURRENT RUNNER: YES.
  - `core-policy-inventory.test.mjs — 329 lines` — Checks operation policies, owner records, retry limits, and critical safety facts. CURRENT RUNNER: PARTIAL; six named cases selected.
- `i00Acceptance/ — 2,361 lines` — Checks the whole-product evidence chain, owner authority, route retirement, report fidelity, sealed evidence, path limits, and secret/network prohibitions. CURRENT RUNNER: YES.
  - `harness.mjs — 1,017 lines` — Supplies the acceptance scenarios, authority scans, route checks, and resource-pressure calculations. CURRENT RUNNER: YES, indirectly through selected tests.
  - `closure-evidence.test.mjs — 390 lines` — Checks complete closure rows, receipts, generated reports, and measurement rules. CURRENT RUNNER: YES.
  - `authority-protocol.test.mjs — 301 lines` — Checks owner authority, evidence freshness, identity, exact order filters, and truth labels. CURRENT RUNNER: YES.
- `m1/ — 572 lines` — Checks that one accepted Basis proposal is consumed once, starts off, and advances only on exact terminal fill evidence. CURRENT RUNNER: NO.
  - `basis-handoff-lifecycle.test.mjs — 572 lines` — The complete M1 handoff suite. CURRENT RUNNER: NO.
- `ops/ — 361 lines` — Checks bounded production logging while preserving money, security, warning, and error records. CURRENT RUNNER: NO.
  - `production-logging.test.mjs — 361 lines` — The complete logging suite. CURRENT RUNNER: NO.
- `bootstrap/ — 63 lines` — Checks environment configuration loads before durable cache paths are captured. CURRENT RUNNER: NO.

RUNS NOW?: DEAD — test-only, not mounted in the deployed process. Current root runners select a 5,850-line file footprint; 1,231 lines have no current selector. No current-pass claim is made.

MONEY?: NO — these tests inspect money safeguards, but none is Basis/Volume strategy logic or part of the engines’ live import chain.

REMOVABLE?: YES-BUT removing the selected files breaks or weakens the Binance, Product Assurance, and whole-product acceptance gates; removing the unselected files discards dormant regression proof. Deployed behavior itself would not change.

EVIDENCE: [package.json:38](/Users/cosmosgeek/Desktop/cosmos-live-20260809/package.json:38) · [server/test/run-deterministic-network-free.mjs:20](/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/test/run-deterministic-network-free.mjs:20) · [package.json:82](/Users/cosmosgeek/Desktop/cosmos-live-20260809/package.json:82) · [fixtures/i00/product-assurance-manifest.v1.json:274](/Users/cosmosgeek/Desktop/cosmos-live-20260809/fixtures/i00/product-assurance-manifest.v1.json:274) · [test/run-test-all-built.mjs:7](/Users/cosmosgeek/Desktop/cosmos-live-20260809/test/run-test-all-built.mjs:7)

## Web and Quant tests

<!-- visible task 134 -->
## web/test/productControlRoom positions 1–31 — 6,128 lines

WHAT IT IS: These 31 browser test suites cover Account, Dashboard, Basis, Borrow, Health, notifications, routing, and the operator control room. They check that pages preserve official server facts, never invent zero or green states, and use guarded control paths. They are proof code only and cannot serve pages or place orders.

SUB-PIECES:

- `account-epoch5r-private-task.test.mjs — 191 — proves six distinct Account views remain read-only and fail closed; current runner: YES.`
- `account-realdata.test.mjs — 378 — proves Spot, Margin, and dollar-margined futures rows preserve exact values, freshness, and unknown-versus-zero truth; current runner: YES.`
- `account-responsive-navigation.test.mjs — 34 — proves narrow Account tabs stay inside the screen and scroll horizontally; current runner: YES.`
- `attention-queue-projection.test.mjs — 129 — proves the read-only attention queue preserves server-supplied order and exposes no controls; current runner: YES.`
- `basis-realdata-truth.test.mjs — 697 — proves Basis rows, costs, proposals, and account facts reject stale or malformed evidence without adding order actions; current runner: YES.`
- `borrow-epoch5r-single-preflight-task.test.mjs — 118 — proves reverse-Basis borrow checks use only current evidence and expose no borrow action; current runner: YES.`
- `borrow-truth.test.mjs — 117 — proves required liability facts stay blocking while optional collateral facts may remain unknown; current runner: YES.`
- `calendar-page-bounded-freshness-5r.test.mjs — 106 — proves Calendar paging, time-zone bounds, and freshness stay inside the fetched range; current runner: YES.`
- `canonical-presentation.test.mjs — 411 — proves official server status alone controls green, blocked, topbar, and policy presentation; current runner: YES.`
- `clock-zone-contract.test.mjs — 60 — proves Token, chart, and Dashboard times use the owner-selected time zone; current runner: YES.`
- `command-result-readback.test.mjs — 436 — proves command identities and results survive reloads and tab conflicts while uncertain results remain blocked; current runner: YES.`
- `compatibility-state-liveness.test.mjs — 56 — proves the older state feed remains explicitly current, stale, or unavailable while Dashboard uses official Product truth; current runner: YES.`
- `contracts.test.mjs — 1,169 — proves the main control-room data, event-history, readiness, incident, risk, Ledger, and control relationships fail closed; current runner: YES.`
- `control-preview-revision.test.mjs — 56 — proves a control preview remains valid only for its exact current revision and unfinished work can be cancelled; current runner: YES.`
- `control-room-command-recovery.test.mjs — 119 — proves stale, future-skewed, or incomplete history disables operator commands; current runner: YES.`
- `crash-readback-contract.test.mjs — 189 — proves boot and crash history is bounded and rejects missing, contradictory, or mismatched release facts; current runner: YES.`
- `dashboard-age-clock.test.mjs — 39 — proves displayed ages advance from the live clock instead of freezing at snapshot time; current runner: YES.`
- `dashboard-realdata-truth.test.mjs — 67 — proves Dashboard uses one guarded account projection and proven continuity without local action paths; current runner: YES.`
- `dependency-boundary.test.mjs — 50 — proves browser imports match declared packages and the installed-version record; current runner: YES.`
- `dev-port-contract.test.mjs — 59 — proves the local web server uses the fixed port and rejects invalid or credential-bearing proxy targets; current runner: YES.`
- `durable-route-release-identity.test.mjs — 419 — proves page addresses, Back/Forward behavior, market freshness, and displayed release identity remain truthful; current runner: YES.`
- `epoch5r-dashboard-canonical-consolidation.test.mjs — 79 — proves Dashboard admits only proven supervisor truth and its page buttons only navigate; current runner: YES.`
- `epoch5r-notifications-truth-boundary.test.mjs — 142 — proves unavailable incidents never become zero and local routing readback stays separate from server authority; current runner: YES.`
- `epoch5r-risk-readonly-policy-facts.test.mjs — 64 — proves six risk limits render as non-interactive owner-gated facts and never false green; current runner: YES.`
- `fx-truth-liveness.test.mjs — 54 — proves stale currency conversion becomes unavailable while the dollar identity rate remains valid; current runner: YES.`
- `header-notification-liveness.test.mjs — 65 — proves Header and Notifications share one server-grouped incident list without browser regrouping; current runner: YES.`
- `header-overlay-liveness.test.mjs — 41 — proves News and Calendar quick views use bounded, cancellable reads and visibly expire stale data; current runner: YES.`
- `health-epoch5r-managed-recovery.test.mjs — 95 — proves Health accepts only the exact managed-root restart control through preview, submit, and saved-result readback; current runner: YES.`
- `incident-notification-hardening.test.mjs — 229 — proves incident identifiers, routing, ordering, acknowledgement recovery, and disabled external execution alerts remain strict; current runner: YES.`
- `legacy-boundary.test.mjs — 358 — proves retired private, money-moving, cancellation, and cloud-control paths cannot reappear or fabricate readiness; current runner: YES.`
- `machine-graph-inventory.test.mjs — 101 — proves the fourteen-component inventory includes Q calculation truth and renders missing or unavailable Q as blocked; current runner: YES.`

RUNS NOW?: DEAD — test-only. The deployed web build includes only `web/src`; current focused and full runners select every suite. No test was run now, so current pass/fail is UNKNOWN.

MONEY?: NO — even the Basis and Borrow suites only verify displayed truth; none belongs to an engine’s live import chain.

REMOVABLE?: YES-BUT removing them deletes 6,128 lines of regression proof and weakens the full test gate; deployed product code remains outside this block.

EVIDENCE: `web/tsconfig.json:12` · `package.json:80` · `test/run-test-all-built.mjs:17` · `web/test/productControlRoom/contracts.test.mjs:516` · `web/test/productControlRoom/legacy-boundary.test.mjs:27`

<!-- visible task 135 -->
## web/test/productControlRoom positions 32–61 + web/test/aiOps — 10,191 lines

WHAT IT IS: These automated checks guard the browser control room against stale, invented, or wrongly owned information. They also keep the future AI Operations surface passive: no network access, money action, secret handling, or self-granted command authority. “Proves” below means what a successful run would establish; nothing was run now.

SUB-PIECES:

`productControlRoom/ — 8,252 lines`

- `managed-inventory.test.mjs — 240 — proves: the browser accepts the official role and component inventory only when its evidence is complete; selected now: YES, focused control-room and full release runners.`
- `market-consumer-liveness.test.mjs — 98 — proves: retained or unavailable market facts cannot look current or create invented economics; selected now: YES, same runners.`
- `market-source-truth.test.mjs — 410 — proves: market facts require exact shape, valid time, consistent ordering, freshness, and complete coverage; selected now: YES, same runners.`
- `market-state-liveness.test.mjs — 75 — proves: loading, failure, current, stale, and incomplete market states remain visibly distinct; selected now: YES, same runners.`
- `mount.test.mjs — 404 — proves: the shell mounts each control-room surface once, uses official server truth, and omits retired action surfaces; selected now: YES, same runners.`
- `news-impact-truth.test.mjs — 176 — proves: missing news impact stays unknown, invalid cache data is rejected, and merges remain ordered; selected now: YES, same runners.`
- `news-owner-freshness-epoch5r.test.mjs — 240 — proves: news-context and Binance-source freshness stay independent and fail closed; selected now: YES, same runners.`
- `notification-cursor.test.mjs — 45 — proves: notification positions accept only safe nonnegative integers and are shared by both views; selected now: YES, same runners.`
- `notification-feed-owner.test.mjs — 21 — proves: Header and Notifications use the official incident owner rather than rebuilding raw events; selected now: YES, same runners.`
- `opportunities-ownership.test.mjs — 738 — proves: only owner-published Basis and Volume proposals appear, with exact economics and strict freshness; selected now: YES, same runners.`
- `optional-surface-load-control.test.mjs — 767 — proves: optional pages default off, load lazily, obey official admission, and release background demand correctly; selected now: YES, same runners.`
- `private-read-truth.test.mjs — 1,217 — proves: sanitized account and permission facts remain exact, fresh, non-authorizing, secret-free, and free of money controls; selected now: YES, same runners.`
- `product-binding-load.test.mjs — 953 — proves: official supervisor truth and event continuity load with bounded authentication, cancellation, timeout, and stale-history handling; selected now: YES, same runners.`
- `quick-view-live-truth.test.mjs — 55 — proves: quick-view live markers default off and become current only after valid evidence; selected now: YES, same runners.`
- `reconnect-backoff.test.mjs — 138 — proves: live-connection retries are bounded, deterministic, and cannot erase protocol trouble; selected now: YES, same runners.`
- `refresh-dock-liveness.test.mjs — 42 — proves: an old delayed reset cannot overwrite a newer refresh state; selected now: YES, same runners.`
- `research-lab.test.mjs — 276 — proves: the frozen research index, filters, custody, artifacts, search, and route stay exact without a fake Open action; selected now: YES, same runners.`
- `risk-verdict-panel.test.mjs — 108 — proves: review-needed risk remains non-authorizing and all bounded evidence stays visible; selected now: YES, same runners.`
- `search-perpetual-truth.test.mjs — 50 — proves: missing perpetual-market facts remain unknown instead of borrowing spot facts; selected now: YES, same runners.`
- `system-dashboard-truth.test.mjs — 179 — proves: navigation, exposure, reconciliation, readiness, and narrow trace views preserve unknown and blocked truth; selected now: YES, same runners.`
- `system-health-rows.test.mjs — 216 — proves: health rows require consistent retry, quality, checkpoint, and restart evidence; selected now: YES, same runners.`
- `token-cache-bounds.test.mjs — 57 — proves: token caches expire and evict entries within fixed bounds without warming inactive views; selected now: YES, same runners.`
- `token-evidence-ownership.test.mjs — 302 — proves: Token accepts only official bounded market, news, and private-read facts and keeps layouts contained; selected now: YES, same runners.`
- `tradingview-liveness.test.mjs — 79 — proves: chart loading ends in a same-site fallback or an honest unavailable state with cleanup; selected now: YES, same runners.`
- `volume-epoch5r-shadow-owner-controls.test.mjs — 53 — proves: Volume keeps freshness gates and genuine page controls even when errors occur; selected now: YES, same runners.`
- `volume-evidence-ownership.test.mjs — 592 — proves: Volume evidence, token forensics, thesis history, outcome absence, polling, and layout remain owner-bound; selected now: YES, same runners.`
- `volume-window-truth.test.mjs — 301 — proves: zero is shown only from current evidence, while missing runtime, market, account, or research truth blocks the view; selected now: YES, same runners.`
- `watchlist-mutation-truth.test.mjs — 100 — proves: watchlist changes serialize, use prior acknowledgements, and keep failures visible; selected now: YES, same runners.`
- `websocket-close-diagnostic.test.mjs — 183 — proves: only trusted live-browser close events become bounded restart evidence; selected now: YES, same runners.`
- `websocket-protocol-health.test.mjs — 137 — proves: malformed live-browser messages degrade health and close the connection at a bounded threshold; selected now: YES, same runners.`

`aiOps/ — 1,939 lines`

- `contracts.test.mjs — 482 — proves: the 120-row shadow-control catalog keeps requested, effective, and read-back authority separate and creates no operational effect; selected now: YES, AI Operations A4 browser runner and ordinary root test command.`
- `import-purity.test.mjs — 205 — proves: reusable browser modules import without network or other background work; selected now: YES, same runner.`
- `insertion-requests.test.mjs — 146 — proves: insertion rows match immutable source objects and grant no foreign-owner editing authority; selected now: YES, same runner.`
- `render.test.mjs — 329 — proves: shadow status, incidents, permissions, governance, gaps, and blockers render without false live claims or unbounded output; selected now: YES, same runner.`
- `source-boundary.test.mjs — 526 — proves: source paths stay allowlisted and contain no network, timer, persistence, secret, provider, money, or hidden control channel; selected now: YES, same runner.`
- `total-network-deny-preload.mjs — 251 — support file, not a suite; proves: the A4 process blocks browser and low-level network routes and fails even if an attempted connection is caught; selected now: YES, preloaded by the A4 runner.`

RUNS NOW?: DEAD — test-only. The deployed start command loads the built server, while these files are named only by test runners. Runner selection does not mean they are live or passed now.

MONEY?: NO. Some suites inspect Basis and Volume displays, but none is strategy logic or part of either engine’s deployed dependency chain.

REMOVABLE?: YES-BUT removing the control-room suites removes release-gate regression coverage; removing an AI Operations suite or its denial helper breaks that runner’s fixed five-suite, 48-check contract. Deployed behavior should remain unchanged, but false-green display and forbidden-network regressions could escape.

EVIDENCE:

- `package.json:16`
- `package.json:80`
- `test/run-test-all-built.mjs:17`
- `package.json:95`
- `server/test/run-ai-ops.mjs:269`

<!-- visible task 136 -->
## quant/tests/unit/{test_q02*, test_q03*, non-qNN test_*} — 6,591 lines

WHAT IT IS: These 17 files check the quantitative-research data foundation; they are not trading engines. Q02 checks stored evidence and historical instrument truth, while Q03 checks archive import, coverage, event discovery, feed translation, and made-up forward fixtures. “Runner YES” means the current dedicated `quant:test:unit` and `quant:test:all` commands select that suite; none was run in this audit.

SUB-PIECES:

- `test_canonical.py — 60 lines` — would prove fixed data-text encoding, strict parsing, and exact fields; runner YES.
- `test_config_clock_primitives.py — 111 lines` — would prove fixed clocks, immutable research settings, and strict identifier, seed, and time bounds; runner YES.
- `test_imports_and_frameworks.py — 67 lines` — would prove package loading has no side effects, core modules avoid hidden input sources, and library versions are pinned; runner YES.
- `test_q02_contracts.py — 1,181 lines` — would prove evidence quality, exact numbers, times, units, partition paths, revision inventories, and retention decisions remain bounded and immutable; runner YES.
- `test_q02_governance.py — 498 lines` — would prove source-admission gates, owner annotations, visible-at-the-time evidence, and later outcome links cannot overclaim authority; runner YES.
- `test_q02_governance_hostile.py — 187 lines` — would prove malformed text, fingerprints, ordering, and mutable inputs are rejected rather than accepted; runner YES.
- `test_q02_instrument_master.py — 764 lines` — would prove historical eligible-instrument lists respect listings, halts, delistings, filter changes, migrations, and missing evidence; runner YES.
- `test_q02_manifest_hostile.py — 610 lines` — would prove malformed inventory records, lineage, dates, exact numbers, and oversized input are rejected; runner YES.
- `test_q02_regression_coverage.py — 111 lines` — would prove command entry rejects recursive data, links, oversized files, bad text, wrong protocol identity, and missing required tools; runner YES.
- `test_q03_archive.py — 314 lines` — would prove official daily-trade archives preserve exact bytes, numbers, times, and source history without guessing asset identity; runner YES.
- `test_q03_atlas.py — 799 lines` — would prove the event catalogue separates checksum-backed history from made-up forward data and enforces time windows and bounded discovery rules; runner YES.
- `test_q03_bridge.py — 1,044 lines` — would prove feed translation preserves clocks, sequence rules, fingerprints, table shape, queue limits, and explicit blocked delivery; runner YES.
- `test_q03_campaign.py — 145 lines` — would prove campaign evidence stays bounded, content-fingerprinted, and review-only; runner YES.
- `test_q03_coverage.py — 465 lines` — would prove missing counts, missing times, open links, and weak licensing evidence cannot become complete historical coverage; runner YES.
- `test_q03_fixtures.py — 110 lines` — would prove made-up Spot and perpetual fixtures reproduce exactly and cannot claim real-market coverage; runner YES.
- `test_q03_tardis.py — 75 lines` — would prove the external archive-provider interface remains reference-only, uninstalled, unconfigured, and unable to download or connect; runner YES.
- `test_randomness.py — 50 lines` — would prove equal seeds reproduce equal streams while invalid bounds and exhausted counters are rejected; runner YES.

RUNS NOW?: DEAD — test-only. Dedicated Quant commands select them, but the deployed process does not load these test files, and this audit executed none.

MONEY?: NO. These files neither contain Basis or Volume decisions nor sit in either live engine’s loaded code path.

REMOVABLE?: YES-BUT removing them erases these safety proofs and makes the Quant gate fail its fixed file-and-test census.

EVIDENCE: [test/quant-command-contract.mjs:23](/Users/cosmosgeek/Desktop/cosmos-live-20260809/test/quant-command-contract.mjs:23) · [test/quant-command-contract.mjs:59](/Users/cosmosgeek/Desktop/cosmos-live-20260809/test/quant-command-contract.mjs:59) · [test/run-quant-gates.mjs:29](/Users/cosmosgeek/Desktop/cosmos-live-20260809/test/run-quant-gates.mjs:29) · [quant/tests/unit/test_q02_instrument_master.py:171](/Users/cosmosgeek/Desktop/cosmos-live-20260809/quant/tests/unit/test_q02_instrument_master.py:171) · [quant/tests/unit/test_q03_bridge.py:562](/Users/cosmosgeek/Desktop/cosmos-live-20260809/quant/tests/unit/test_q03_bridge.py:562)

<!-- visible task 137 -->
## quant/tests/unit/test_q04*.py + test_q05*.py — 5,869 lines

WHAT IT IS: These 12 automatic suites check the isolated Quant research package. Q04 checks that recorded spot and USD-M (dollar-margined futures) messages rebuild a trustworthy buy-and-sell price book, including gaps, reconnects, and replaying recorded steps. Q05 checks volume-event stages, price outcomes, basis convergence, costs, fair comparisons, and protection against using future data. They never direct or place trades.

SUB-PIECES:

- `test_q04_events.py — 364 lines` — Would prove message and snapshot records keep required timing and sequence facts and reject malformed data. Runner: YES (`test:unit`, `test:replay`, `test:all`); not run now.
- `test_q04_levels.py — 207 lines` — Would prove prices remain exact, zero size removes a price, and buy/sell levels stay ordered and capped. Runner: YES (`test:unit`, `test:replay`, `test:all`); not run now.
- `test_q04_replay.py — 361 lines` — Would prove recorded steps are read safely and identical steps produce byte-for-byte identical results. Runner: YES (`test:unit`, `test:replay`, `test:all`); not run now.
- `test_q04_spot_engine.py — 871 lines` — Would prove spot-book rebuilding handles startup, missing messages, reconnects, overflow, bad snapshots, and unsafe books. Runner: YES (`test:unit`, `test:replay`, `test:all`); not run now.
- `test_q04_usdm_engine.py — 390 lines` — Would prove futures-book rebuilding enforces message order and rebuilds after gaps, duplicates, unsafe books, or reconnects. Runner: YES (`test:unit`, `test:replay`, `test:all`); not run now.
- `test_q05_basis.py — 537 lines` — Would prove basis, after-cost edge, convergence timing, funding direction, and reverse-borrow feasibility treat missing or broken evidence honestly. Runner: YES (`test:unit`, `test:leakage`, `test:all`); not run now.
- `test_q05_controls_manifest.py — 673 lines` — Would prove fair comparison periods are chosen without future knowledge and their saved membership links are bounded, ordered, and repeatable. Runner: YES (`test:unit`, `test:leakage`, `test:all`); not run now.
- `test_q05_edges.py — 567 lines` — Would prove bad boundary values are rejected and cost, outcome, identity, stage, comparison, and basis records save exactly. Runner: YES (`test:unit`, `test:leakage`, `test:all`); not run now.
- `test_q05_foundations.py — 468 lines` — Would prove exact fractions, returns, spreads, evidence ordering, gaps, and sample identities cannot be forged or changed by later data. Runner: YES (`test:unit`, `test:leakage`, `test:all`); not run now.
- `test_q05_leakage.py — 350 lines` — Would prove seven future-data barriers: later values cannot change earlier facts, incomplete or gapped cases stay unknown or invalid, and comparison groups rebuild identically. Runner: YES (`test:unit`, `test:leakage`, `test:all`); not run now.
- `test_q05_outcomes.py — 667 lines` — Would prove later returns, maximum rise/fall, threshold timing, costs, delays, spreads, and market-relative returns distinguish trustworthy, missing, incomplete, and broken data. Runner: YES (`test:unit`, `test:leakage`, `test:all`); not run now.
- `test_q05_stages_disposition.py — 414 lines` — Would prove volume windows receive consistent dormant, ignition, growth, continuation, fade, and unwind labels, while bad or incomplete data never becomes a normal negative. Runner: YES (`test:unit`, `test:leakage`, `test:all`); not run now.

RUNS NOW?: DEAD — test-only. The deployed start command loads only the built server; these suites run only when an explicit Quant test gate is invoked. None was run now.

MONEY?: NO — they check basis- and volume-related research, but test files are outside the live engines’ import and runtime path.

REMOVABLE?: YES-BUT the deployed process keeps running while losing the checks that catch broken price-book rebuilding, future-data contamination, and wrong basis or volume labels.

EVIDENCE: `package.json:16`; `test/quant-command-contract.mjs:22-59`; `test/run-quant-gates.mjs:321-335`; `quant/tests/unit/test_q04_spot_engine.py:147-201`; `quant/tests/unit/test_q05_basis.py:147-280`

<!-- visible task 138 -->
## quant/tests/unit/test_q06*, test_q07*, test_q10* — 5,045 lines

WHAT IT IS: These 17 unit-test suites check Q06 feature math, Q07 quote/trade/order-book signals for VOLUME research, and Q10 model-comparison machinery. They use synthetic or replayed values to catch bad rounding, future-data leakage, dishonest unknown states, unstable calculations, and broken record formats. They are proof code, not a trading bot.

SUB-PIECES:

- `test_q06_baselines_values.py` — 368 lines — Proves rolling baselines, history requirements, cohort grouping, and honest available/stale/invalid/unknown states; current runner selects it: YES.
- `test_q06_diagnostics.py` — 151 lines — Proves missing-data counts, feature correlations, redundant-feature grouping, and deferred diagnostic records; current runner selects it: YES.
- `test_q06_fixedpoint_domains.py` — 404 lines — Proves exact scaled-number rounding and construction of clock, event, trade-count, and volume bars, including partial and unknown-volume cases; current runner selects it: YES.
- `test_q06_registry_primitives.py` — 344 lines — Proves registry integrity plus activity, price-return, recent-weighted variance, and robust-deviation features agree between whole-batch and one-update-at-a-time calculations; current runner selects it: YES.
- `test_q07_book.py` — 237 lines — Proves order-book flow, depth imbalance, slope, recovery after depletion, and executable spread for a requested size; current runner selects it: YES.
- `test_q07_families.py` — 444 lines — Proves dead-volume activity can be separated into warm-up, rejected spike, wake, persistence, and fade, and that every adopted feature has a complete test binding; current runner selects it: YES.
- `test_q07_flow.py` — 689 lines — Proves public-event rates, a self-exciting event model, signed trade pressure, arrival speed, size concentration, spread, price impact, absorption, and illiquidity while refusing incomplete evidence; current runner selects it: YES.
- `test_q07_inputs.py` — 306 lines — Proves quote, trade, and order-book records are ordered and valid and that each trade receives only the latest quote already visible at that time; current runner selects it: YES.
- `test_q07_l1.py` — 177 lines — Proves best-bid/best-ask flow imbalance, queue imbalance, and estimated fair-price displacement with exact rounding; current runner selects it: YES.
- `test_q10_battery.py` — 153 lines — Proves the model-comparison bundle records pinned library versions and honestly labels adopted, deferred, and reference-only work; current runner selects it: YES.
- `test_q10_contracts.py` — 347 lines — Proves model results, prediction fingerprints, comparison winners, ties, and adoption records cannot carry contradictory facts; current runner selects it: YES.
- `test_q10_engine.py` — 143 lines — Proves probability, linear, quantile, boosted-tree, ranking, and calibration models are deterministic, bounded, and directionally constrained; current runner selects it: YES.
- `test_q10_estimators.py` — 230 lines — Proves baseline and challenger model definitions, deterministic controls, declared feature directions, and target-to-model matching; current runner selects it: YES.
- `test_q10_metrics.py` — 436 lines — Proves research-only ranking, lead-time, information, cost, probability-error, calibration, regression-error, and ranking-agreement measurements without pretending they are production truth; current runner selects it: YES.
- `test_q10_quantize.py` — 87 lines — Proves floating-point outputs become exact scaled values with nearest-even rounding and reject invalid probabilities or unbounded numbers; current runner selects it: YES.
- `test_q10_split_synthetic.py` — 243 lines — Proves chronological training, separation, validation, and test partitions plus deterministic synthetic datasets and learnability guards; current runner selects it: YES.
- `test_q10_studies.py` — 286 lines — Proves bounded model-setting searches are repeatable, preserve exact settings, log rejected trials, and choose the correct best trial; current runner selects it: YES.

RUNS NOW?: DEAD (test-only) — none is mounted in the deployed server or web process. The current quant runner selects all 17 through its unit lane and again through its full canonical lane; no suite was run for this audit, so current pass/fail is UNKNOWN.

MONEY?: NO — some Q07 checks cover signals intended for VOLUME research, but these files only verify research libraries and cannot place or control an order.

REMOVABLE?: YES-BUT removing them deletes automated proof for feature and model correctness and makes the canonical runner miss its fixed expected test inventory.

EVIDENCE: `quant/tests/unit/test_q06_registry_primitives.py:136`; `quant/tests/unit/test_q07_families.py:346`; `quant/tests/unit/test_q10_metrics.py:137`; `test/quant-command-contract.mjs:23`; `test/run-quant-gates.mjs:495`

<!-- visible task 139 -->
## quant/tests/unit/test_q12* — 7,001 lines

WHAT IT IS: Four Python test suites for a research-only layer that combines model scores, adjusts them to match observed outcomes, adds prediction ranges, and withholds advice when evidence is unsafe. They use synthetic data and neither connect to an exchange nor place trades. The tests were not run during this audit.

SUB-PIECES:

- `test_q12_adapters.py — 927 lines` — Proves earlier validation and time-to-event evidence is accepted only when identity, timing, leakage checks, costs, and evidence links match exactly. Runner: YES, selected by the current Quant unit runner; not run now.
- `test_q12_conformal_abstention.py — 2,546 lines` — Proves prediction ranges and safety gates suppress advice when data is stale or incomplete, models conflict or disappear, conditions are unfamiliar, costs or timing are unsafe, or past coverage is weak. Runner: YES, selected by the current Quant unit runner; not run now.
- `test_q12_conformal_prequential.py — 1,390 lines` — Proves adaptive prediction ranges learn only after outcomes become known, never from future answers, while preserving exact source links and reporting unknown results honestly. Runner: YES, selected by the current Quant unit runner; not run now.
- `test_q12_stacking_calibration.py — 2,138 lines` — Proves multiple model scores are combined and adjusted using strictly ordered earlier and later data, with rejection for overlap, weak support, wrong timing, or substituted evidence. Runner: YES, selected by the current Quant unit runner; not run now.

RUNS NOW?: DEAD — test-only; none is mounted in the deployed process. The current Quant unit runner selects all four when invoked, but this audit did not invoke it.

MONEY?: NO — these suites test generic research and advisory safeguards, not basis or volume trading logic, and they are outside the engines’ running dependency chain.

REMOVABLE?: YES-BUT no deployed trading behavior changes; the current Quant gate stops checking these research-safety rules.

EVIDENCE: `quant/tests/unit/test_q12_adapters.py:363` · `quant/tests/unit/test_q12_conformal_abstention.py:1358` · `quant/tests/unit/test_q12_conformal_prequential.py:1132` · `quant/tests/unit/test_q12_stacking_calibration.py:433` · `test/quant-command-contract.mjs:23`

<!-- visible task 140 -->
## quant/tests/contract/** + quant/tests/property/** — 10,581 lines

WHAT IT IS: This is 36 Python test suites for the Quant research package: 26 contract suites check fixed rules and frozen evidence, while 10 property suites try many generated inputs against rules that should always hold. Together they protect research-data files, offline archive intake, order-book rebuilding, labels, indicators, models, and model-combining behavior. They cannot place orders and are not part of the deployed trading process.

SUB-PIECES:

- `contract/ — 7,792 lines — 26 fixed-rule suites; current runner selects them: YES.`
- `contract/test_q02_parquet_hostile.py — 925 lines — proves malformed or tampered column files, identity records, units, hashes, sizes, and writer settings are rejected; current runner selects it: YES.`
- `contract/test_q02_store_query.py — 658 lines — proves stored research revisions round-trip exactly, corrections preserve old bytes, and only fixed safe queries are allowed; current runner selects it: YES.`
- `contract/test_q02_store_query_hostile.py — 1,341 lines — proves unsafe queries, paths, links, replaced directories, partial writes, damaged ancestry, and corrupt reads fail closed; current runner selects it: YES.`
- `contract/test_q03_archive_hostile.py — 924 lines — proves offline Binance trade archives reject bad fingerprints, malformed ZIP or table data, oversized payloads, duplicate identities, and false timestamps; current runner selects it: YES.`
- `property/ — 2,789 lines — 10 generated-input suites; current runner selects them: YES.`
- `property/test_q04_book_properties.py — 393 lines — proves feed gaps and recovery cannot expose an out-of-sync spot or dollar-futures order book, and decimal prices remain correctly ordered; current runner selects it: YES.`
- `property/test_q05_properties.py — 336 lines — proves labels remain deterministic, later evidence cannot rewrite an earlier decision, comparison groups do not overlap, and every stage is classified; current runner selects it: YES.`
- `property/test_q07_micro_properties.py — 337 lines — proves fine-grained order and trade indicators agree between step-by-step and batch calculation and remain within declared bounds; current runner selects it: YES.`
- `property/test_q12_properties.py — 609 lines — proves uncertainty ranges, calibration, model combining, time-split membership, and abstention reasons remain deterministic, ordered, and bounded; current runner selects it: YES.`

RUNS NOW?: DEAD — test-only. The current runner selects every owned suite through its contract, property, or all-tests path, but the deployed server does not mount them. No test was run for this audit.

MONEY?: NO.

REMOVABLE?: YES-BUT the required Quant checks would lose these protections and fail their fixed inventory; deployed trading behavior would not gain or lose a money path.

EVIDENCE: `test/quant-command-contract.mjs:21`; `test/quant-command-contract.mjs:25`; `test/run-quant-gates.mjs:333`; `quant/tests/contract/test_q03_archive_hostile.py:206`; `quant/tests/property/test_q04_book_properties.py:357`

<!-- visible task 141 -->
## quant/tests/{fee_truth,n3_intake,maker_fee_grid,smeta1,q00} — 8,998 lines

WHAT IT IS: Five research-test suites plus one change-scope guard. They check Basis/Volume fee truth, the N3 final research gate, maker-fee evidence, profitability selection, and Quant-only file custody. The exact routed count is 8,998 test-source lines; fixed test data adds 2,073 lines, making 11,071 physical lines. Nothing here trades or proves profit.

SUB-PIECES:

- `fee_truth/ — 3,964 test lines; 5,623 with fixed data` — Proves exact Spot and Perpetual fee rules, safe rejection of private fields, and Basis/Volume fee projections; unknown costs stay unknown. Current runner: YES, main Quant gate and all-tests mode. Files/directories ≥300: `fixtures/` 1,659, including data-shape files of 946 and 711 lines; `test_boundary.py` 544; `test_contracts.py` 636; `test_conversion.py` 740; `test_hostile.py` 923; `test_projections.py` 704.
- `n3_intake/ — 2,523 test lines; 2,530 with fixed data` — Proves the final research gate accepts only correctly bound evidence, blocks pending or unknown facts, and renders safe deterministic decisions. Current runner: YES, main Quant gate and all-tests mode. Files ≥300: `test_bridge.py` 452; `test_contracts_and_adapters.py` 385; `test_decision.py` 683; `test_intake.py` 500; `test_renderer.py` 329.
- `maker_fee_grid/ — 195 test lines; 600 with fixed data` — Proves public maker-fee scenarios remain non-account evidence, missing measurements remain blocked, and every required research gate must pass without granting capital authority. Current runner: YES, main Quant gate and all-tests mode. Directories ≥300: `fixtures/` and its sole `fixtures/package/` child contain the same 405 data lines.
- `smeta1/ — 2,227 test lines; 2,229 with fixed data` — Proves the seven-family profitability registry cannot manufacture a winner after many trials, bypass fresh unseen-data checks, or promote unknown evidence. Current runner: YES, main Quant gate and all-tests mode. File ≥300: `test_smeta1_registry.py` 2,227.
- `q00/ — 89 lines` — Proves Quant changes stay on the required branch and inside Quant, while protected inputs and hidden out-of-scope history are rejected. Current runner: YES, the main Quant gate runs it separately; the Python-only all-tests mode does not.

RUNS NOW?: DEAD — test-only, with no deployed server or browser mount. Current runners select these suites only when invoked. No suite was run during this audit, so there is no present pass claim.

MONEY?: NO — these tests discuss fees and profitability, but contain no Basis/Volume production logic and are outside the live engines’ dependency chain.

REMOVABLE?: YES-BUT the deployed process would remain unchanged while the current Quant gate would fail and safeguards against false fee truth, false research winners, damaged evidence, and out-of-scope changes would disappear.

EVIDENCE:

- [quant/tests/fee_truth/test_projections.py:277](/Users/cosmosgeek/Desktop/cosmos-live-20260809/quant/tests/fee_truth/test_projections.py:277)
- [quant/tests/n3_intake/test_decision.py:155](/Users/cosmosgeek/Desktop/cosmos-live-20260809/quant/tests/n3_intake/test_decision.py:155)
- [quant/tests/maker_fee_grid/test_verify.py:26](/Users/cosmosgeek/Desktop/cosmos-live-20260809/quant/tests/maker_fee_grid/test_verify.py:26)
- [quant/tests/smeta1/test_smeta1_registry.py:1068](/Users/cosmosgeek/Desktop/cosmos-live-20260809/quant/tests/smeta1/test_smeta1_registry.py:1068)
- [test/run-quant-gates.mjs:483–501](/Users/cosmosgeek/Desktop/cosmos-live-20260809/test/run-quant-gates.mjs:483)

<!-- visible task 142 -->
## quant/tests/q08/** + quant/tests/q09/** — 10,004 lines

WHAT IT IS: These 25 test suites and one fixed expected-output file guard two offline research libraries. Q08 checks basis ingredients such as funding, borrow costs, tradable quotes, outstanding futures positions, liquidation events, price-gap paths, lead-and-lag signals, and convergence. Q09 checks tools for detecting market-state changes, unusual observations, repeated patterns, and comparable past periods; none places orders.

SUB-PIECES: “Runner YES” means the current runner selects the suite; none was run now, so its current result is UNKNOWN.

- `q08/ — 5,215 lines` — 5,214 suite lines plus a one-line expected-output file.
  - `test_q08_bar_features.py — 266 lines` — would prove four basis-gap measurements are exact and one-point-at-a-time calculation matches whole-history calculation; runner YES.
  - `test_q08_basis_path.py — 530 lines` — would prove spot and futures evidence align without hiding gaps and each leg’s move adds back to the total basis move; runner YES.
  - `test_q08_costs_borrow.py — 282 lines` — would prove fee, funding, and borrow totals never turn missing facts into zero; runner YES.
  - `test_q08_executable.py — 574 lines` — would prove normal and reverse basis use the correct buy/sell quotes, available size, costs, staleness, and borrow facts; runner YES.
  - `test_q08_funding.py — 219 lines` — would prove funding level, change, and next-payment timing preserve missing and stale states; runner YES.
  - `test_q08_golden.py — 159 lines` — would prove fixed expected outputs regenerate identically under changed working folders, time zones, and hash settings; runner YES.
  - `test_q08_hostile_coverage.py — 605 lines` — would prove bad types, ambiguous lead/lag results, cut-off horizons, and failed evidence runs are rejected; runner YES.
  - `test_q08_leadlag.py — 743 lines` — would prove measured leadership between markets handles missing data, ties, timing, source identity, and stability without inventing direction; runner YES.
  - `test_q08_oi_liquidations.py — 555 lines` — would prove outstanding futures-position changes and liquidation counts or values remain exact or honestly unknown; runner YES.
  - `test_q08_properties.py — 357 lines` — would prove randomized cases preserve calculation equality, attribution totals, convergence bounds, and missing-data rules; runner YES.
  - `test_q08_references.py — 179 lines` — would prove reference-price types cannot be silently substituted when missing or stale; runner YES.
  - `test_q08_safety.py — 175 lines` — would prove the library has no network, storage, order, production-server, or model-framework authority; runner YES.
  - `test_q08_scope.py — 101 lines` — would prove the original Q08 work stayed inside its allowed files and preserved frozen files; it does not prove current trading behavior; runner YES.
  - `test_q08_statespace_convergence.py — 469 lines` — would prove smoothing and convergence estimates handle observed, unfinished, gapped, and unavailable outcomes correctly; runner YES.
  - `fixtures/q08_derivatives_golden_v1.json — 1 line` — fixed expected output read indirectly by the selected golden suite.
- `q09/ — 4,790 lines` — eleven market-state and anomaly test suites.
  - `test_q09_alphabet_bocpd.py — 454 lines` — would prove value bucketing and the probability-based online change detector warm up, conserve probability, reset, and detect planted shifts correctly; runner YES.
  - `test_q09_analog.py — 457 lines` — would prove comparable-past-period search excludes future, overlapping, same-event, and wrong-group records before ranking; runner YES.
  - `test_q09_campaign_units.py — 388 lines` — would prove the offline evidence command writes its files and its anti-leak checks reject contaminated comparisons; runner YES.
  - `test_q09_contracts.py — 262 lines` — would prove observation ordering, quality handling, exact normalization, and shared input/output rules; runner YES.
  - `test_q09_cusum_page_hinkley.py — 580 lines` — would prove two running level-shift detectors handle warm-up, direction, stale observations, gaps, and resets; runner YES.
  - `test_q09_golden_safety.py — 333 lines` — would prove repeatable synthetic outputs and reject network, storage, time, or money authority; runner YES.
  - `test_q09_matrix_profile.py — 323 lines` — would prove repeated-pattern search uses earlier data only and excludes overlap, future data, and the same event; runner YES.
  - `test_q09_metrics.py — 414 lines` — would prove delays, misses, false alarms, segment matches, and unusual-observation scores are counted honestly; runner YES.
  - `test_q09_pelt.py — 232 lines` — would prove the change-boundary finder returns the lowest-cost valid segmentation and matches an independent exhaustive calculation; runner YES.
  - `test_q09_properties.py — 307 lines` — would prove randomized detector, segmentation, probability, pattern-search, and no-future-leak laws; runner YES.
  - `test_q09_soft_regime_anomaly.py — 1,040 lines` — would prove market-state probabilities, unusual-observation scoring, eight bounded research methods, and combined disorder judgments fail closed on bad evidence; runner YES.

RUNS NOW?: DEAD — test-only. The deployed start command loads only the built server, while the current canonical test chain selects all 25 suites. No suite was executed now.

MONEY?: NO. Q08 verifies money-adjacent basis research, but these tests are neither deployed basis/volume logic nor part of either engine’s runtime imports; Q09 is generic research verification.

REMOVABLE?: YES-BUT deployed behavior would remain unchanged while the current quant gate would lose its regression evidence and fail its pinned file/test inventory unless that runner contract were also changed.

EVIDENCE:

- `package.json:16`
- `test/run-test-all-built.mjs:21`
- `test/run-gate-coverage.mjs:9`
- `test/quant-command-contract.mjs:59`
- `quant/tests/q08/test_q08_safety.py:118`

<!-- visible task 143 -->
## quant/tests/q11/** + quant/tests/q13/** + quant/tests/q14/** — 9,594 lines

WHAT IT IS: Thirty test suites check three research layers: Q11 time-to-event and passive-fill estimates, Q13’s reference-only deep-sequence gate, and Q14’s chronological model validation. Q13 explicitly keeps training blocked while real evidence is insufficient; Q14 tries to catch future-data cheating, false discoveries, and unrealistic cost assumptions. This is generic research machinery and evidence custody, not deployed trading logic.

SUB-PIECES: “runner YES—canonical” means the current official Quant all-tests runner selects the suite; it does not mean the suite passed now.

- `quant/tests/q11/` — 3,696 lines — ten suites for event timing, competing outcomes, passive-fill estimates, and evidence quality.
  - `test_q11_campaign_units.py` — 171 lines — deterministic campaign generation, seeded records, probability rows, and command-line behavior; runner YES—canonical.
  - `test_q11_competing.py` — 246 lines — separate outcome-incidence curves, probability conservation, and malformed-input rejection; runner YES—canonical.
  - `test_q11_contracts.py` — 397 lines — input quality, outcome, duration, cohort, time-grid, size, and serialization rules; runner YES—canonical plus contract command.
  - `test_q11_golden_safety.py` — 226 lines — inert imports, no network/money authority, deterministic fixed-reference artifacts, and declared measurement budgets; runner YES—canonical.
  - `test_q11_hazard_model.py` — 436 lines — per-period event-chance fitting, prediction, smoothing, thin-data unknowns, and contract bounds; runner YES—canonical.
  - `test_q11_km.py` — 307 lines — chance-an-event-has-not-happened curves, unfinished-observation handling, independent references, and curve contracts; runner YES—canonical.
  - `test_q11_metrics.py` — 1,179 lines — probability error, ranking accuracy, calibration, exact cohort coverage, and acceptance budgets; runner YES—canonical.
  - `test_q11_passive_fill.py` — 253 lines — queue-position fill estimates, no credit for unproven cancellations, and no promotion from thin, synthetic, copied, or unstable evidence; runner YES—canonical.
  - `test_q11_properties.py` — 395 lines — generated-input invariants for survival, competing outcomes, probability error, ranking, calibration, and quality downgrades; runner YES—canonical plus property command.
  - `test_q11_targets.py` — 86 lines — declared target vocabulary, cause ordering, target specifications, and serialization; runner YES—canonical.
- `quant/tests/q13/` — 697 lines — seven suites preserving a failed-data gate around possible future deep-sequence models.
  - `test_q13_campaign.py` — 72 lines — deterministic evidence artifacts that record the failed gate and falsification probes without inventing costs; runner YES—canonical.
  - `test_q13_contracts.py` — 130 lines — bounded synthetic sequences, observation chronology, data quality, fold origin trails, and time-gap rules; runner YES—canonical plus contract command.
  - `test_q13_golden.py` — 52 lines — fixed-reference artifacts regenerate identically across working directory, timezone, and hash seed; runner YES—canonical.
  - `test_q13_q14_adversarial.py` — 46 lines — Q14 catches injected future values even when their timestamps are forged; runner YES—canonical.
  - `test_q13_references_validation.py` — 188 lines — proposed deep models stay inert and reference-only until an exact passed gate and origin trail exist; runner YES—canonical.
  - `test_q13_safety.py` — 66 lines — no effectful, money, training, or promotion interface exists in the deep package; runner YES—canonical.
  - `test_q13_sufficiency.py` — 143 lines — current evidence denies training, every required proof is mandatory, and false or ambiguous evidence is rejected; runner YES—canonical.
- `quant/tests/q14/` — 5,201 lines — thirteen suites plus two support files for chronological train-then-check validation.
  - `q14_fixtures.py` — 234 lines — shared deterministic sample, prediction, and fold-receipt builders; runner NO direct—imported by selected suites.
  - `q14_validation_campaign.py` — 519 lines — deterministic synthetic walk-forward, leakage, comparison, repeated-trial, bootstrap, and cost-stress artifacts; runner YES—walk-forward generator, and the canonical golden suite imports it.
  - `test_q14_comparison.py` — 377 lines — challenger-versus-baseline evidence, metric direction, fold sufficiency, leak blocking, and one-use holdout access; runner YES—canonical plus leakage command.
  - `test_q14_controls.py` — 188 lines — shuffled labels, stale predictions, future leaks, simple baselines, withheld data, and false-burst controls; runner YES—canonical plus leakage command.
  - `test_q14_feature_diagnostics.py` — 1,424 lines — point-in-time feature origin, train-only dependence checks, same-model permutation, tree attribution, genuine refits, and zero promotion authority; runner YES—canonical plus leakage command.
  - `test_q14_golden.py` — 147 lines — fixed-reference leak rejection and byte-identical campaign regeneration across environments; runner YES—canonical plus leakage command.
  - `test_q14_leakage.py` — 270 lines — deliberate future-data leaks, forged timestamps, implausible skill, temporal audits, and no-skill controls; runner YES—canonical plus leakage command.
  - `test_q14_metrics.py` — 380 lines — precision, recall, ranking areas, probability error, calibration, bounds, and exact dispatch rules; runner YES—canonical plus leakage command.
  - `test_q14_multiplicity_bootstrap.py` — 414 lines — trial ledgers, repeated-testing corrections, backtest-overfitting probability, and block-bootstrap uncertainty ranges; runner YES—canonical plus leakage command.
  - `test_q14_normal_dsr.py` — 267 lines — deterministic normal-number routines and risk-adjusted return scores corrected for repeated trials; runner YES—canonical plus leakage command.
  - `test_q14_properties.py` — 217 lines — generated-input invariants for splits, metrics, label shuffling, bootstrap ranges, overfitting probability, and corrected return scores; runner YES—canonical plus property and leakage commands.
  - `test_q14_safety.py` — 145 lines — inert imports, no ambient network/storage/money/time authority, and no floating-point public contracts; runner YES—canonical plus leakage command.
  - `test_q14_samples.py` — 262 lines — sample and prediction identity, ordering, bounds, alignment, digests, and honest unknown-quality behavior; runner YES—canonical plus leakage command.
  - `test_q14_splits.py` — 232 lines — chronological folds, purge gaps, embargo gaps, grouped records, untouched holdout, and quarantine rules; runner YES—canonical plus leakage command.
  - `test_q14_stress.py` — 125 lines — adverse-cost scenarios can turn an attractive result into abstention, while unknown costs never become zero; runner YES—canonical plus leakage command.

RUNS NOW?: DEAD — test-only; none is mounted in the deployed process. Current runners select the suites as described, but no test was executed and no present-pass claim is made.

MONEY?: NO — these files are neither Basis/Volume decision logic nor part of the deployed engines’ import/runtime closure.

REMOVABLE?: YES-BUT the current Quant gate loses these research safeguards and no longer matches its pinned test inventory; deleting them alone does not change deployed trading behavior.

EVIDENCE: `quant/tests/q11/test_q11_passive_fill.py:75` · `quant/tests/q13/test_q13_sufficiency.py:37` · `quant/tests/q14/q14_validation_campaign.py:12` · `test/quant-command-contract.mjs:22` · `test/run-quant-gates.mjs:483`

<!-- visible task 144 -->
## quant/tests/q15/** + quant/tests/q16/** — 7,852 lines

WHAT IT IS: Offline verification for Q15’s research-model catalog and Q16’s local scoring boundary. Q15 checks recorded outcomes, model comparison, promotion history, rollback, and safe abstention when evidence weakens; Q16 checks saved research files, strict local messages, generated clients, and abstention-only scoring. These suites do not trade or run in the deployed process, and none was executed during this audit.

SUB-PIECES:

- `q15/ — 4,220 lines — research-model evidence and custody tests.`
- `test_q15_campaign.py — 82 lines — would prove reports regenerate identically and unexpected model change ends in abstention — selected: YES, full Quant runner.`
- `test_q15_contracts_artifacts.py — 161 lines — would prove saved-file fingerprints, safe paths, stable cards, unavailable model weights, and all ten promotion checks — selected: YES.`
- `test_q15_drift_guard.py — 484 lines — would prove all eight change monitors can demote but cannot self-promote, reuse stale evidence, or silently re-enable — selected: YES.`
- `test_q15_integrity_adversarial.py — 492 lines — would prove registration, promotion, rollback, and restart reject altered files, history, timestamps, database links, or missing evidence — selected: YES.`
- `test_q15_recorded_outcomes.py — 1,620 lines — would prove exact prediction/outcome/cost comparisons, research-versus-production separation, prediction-before-outcome order, held-out passive-fill promotion receipts, and corrupt-storage refusal — selected: YES.`
- `test_q15_recorded_policy_comparison.py — 517 lines — would prove baseline and challenger use the same outcomes, any cost or probability regression blocks promotion, and rounding or forged numbers cannot hide failure — selected: YES.`
- `test_q15_registry.py — 272 lines — would prove restart restores the exact champion and synthetic research promotion, rollback, and retirement reject bad identities, gates, conflicts, and corruption — selected: YES.`
- `test_q15_restart_chaos.py — 164 lines — would prove a killed test child before or after commit restores the correct old or new champion without duplicate retry — selected: YES.`
- `test_q15_safety.py — 93 lines — would prove Q15 imports no network, private-exchange, or money authority and confines database access to its explicit store — selected: YES.`
- `test_q15_scope.py — 70 lines — would prove the audited historical change remained inside Q15-owned paths with exact ancestry — selected: YES.`
- `test_q15_shadow_feedback.py — 205 lines — would prove delayed outcomes mature at the exact horizon, deduplicate, remain immutable, preserve unknown truth, and stay separate from owner annotations — selected: YES.`
- `q16/ — 3,632 lines — local scoring, message, worker, and transport tests.`
- `test_q16_artifacts_pipeline.py — 298 lines — would prove the 34-file manifest and lineage are exact, features come from their owners, and stale, early, malformed, or authority-widening inputs abstain or fail — selected: YES.`
- `test_q16_generation_safety.py — 802 lines — would prove generated files and clients are repeatable, bounded, timeout-safe, strict about responses and large integers, free of money imports, and abstention-only — selected: YES.`
- `test_q16_hostile_branches.py — 1,980 lines — would prove hostile requests, manifests, worker failures, timeouts, queues, local connections, shutdowns, and pipeline inputs fail within bounds without crossing responses — selected: YES.`
- `test_q16_protocol.py — 226 lines — would prove Python and Node produce the same message bytes and reject duplicate keys, unsafe numbers, secret-like fields, unknown shapes, and actionable ambiguous results — selected: YES.`
- `test_q16_service_transport.py — 263 lines — would prove single and batch scoring abstain safely, health stays honest, concurrency remains one, errors stay bounded, and connections remain private or literal loopback — selected: YES.`
- `Support — 123 lines — q15_fixtures.py 60; q16/__init__.py 1; q16/conftest.py 62. These are loaded test support, not separate suites.`

RUNS NOW?: DEAD — test-only. Every suite is selected by the current full Quant runner, and the repository-wide runner reaches that gate. Selection is not a current pass: no test was run.

MONEY?: NO. This is research proof and read-only local-scoring safety, with no Basis/Volume decision or order authority.

REMOVABLE?: YES-BUT deployed behavior would remain unchanged while the required Quant file/test inventory, Q15 outcome-custody proof, and Q16 local-boundary proof would break.

EVIDENCE:

- [test/run-gate-coverage.mjs:9](/Users/cosmosgeek/Desktop/cosmos-live-20260809/test/run-gate-coverage.mjs:9)
- [test/run-quant-gates.mjs:495](/Users/cosmosgeek/Desktop/cosmos-live-20260809/test/run-quant-gates.mjs:495)
- [test/quant-command-contract.mjs:59](/Users/cosmosgeek/Desktop/cosmos-live-20260809/test/quant-command-contract.mjs:59)
- [quant/tests/q15/test_q15_safety.py:73](/Users/cosmosgeek/Desktop/cosmos-live-20260809/quant/tests/q15/test_q15_safety.py:73)
- [quant/tests/q16/test_q16_generation_safety.py:791](/Users/cosmosgeek/Desktop/cosmos-live-20260809/quant/tests/q16/test_q16_generation_safety.py:791)

<!-- visible task 145 -->
## quant/tests/q17/** — 6,240 lines

WHAT IT IS: This is the test-only pack for Q17, the final quantitative-research proof stage. It checks that research evidence is reproducible, safely handled, honestly classified, and unable to place trades. It does not calculate basis or volume opportunities.

SUB-PIECES:

- `test_generation.py — 1,340 lines` — Proves the generated evidence bundle can be rebuilt, validated, and published safely. Current runner selects it: YES, integration and full Quant checks.
- `test_component_manifest.py — 1,191 lines` — Proves the Q00–Q17 component inventory preserves accepted history, current corrections, file identities, and tamper detection. Current runner selects it: YES, integration and full Quant checks.
- `test_benchmark.py — 1,042 lines` — Proves timing and memory measurements use bounded real work, reject fabricated results, and clean up child processes. Current runner selects it: YES, benchmark and full Quant checks.
- `test_security.py — 1,024 lines` — Proves source scanning catches network, secret, unsafe process, private-exchange, and order-authority calls. Current runner selects it: YES, full Quant check.
- `test_replay_faults.py — 851 lines` — Proves repeated market-data replays match, corrupted or stale inputs are rejected, and uncertain results abstain instead of recommending action. Current runner selects it: YES, replay and full Quant checks.
- `test_evidence.py — 791 lines` — Proves accepted evidence remains pinned to exact files and keeps synthetic, advisory, unknown, and rejected findings truthful. Current runner selects it: YES, integration and full Quant checks.

The remaining one line is `__init__.py`, the package marker. No suite was run during this audit; selection is confirmed, but no current pass is claimed.

RUNS NOW?: DEAD (test-only) — the deployed start command mounts only the built server; these files run solely when an automated test command selects them.

MONEY?: NO — they test research proof and safety boundaries, not basis or volume trading logic, and they hold no execution authority.

REMOVABLE?: YES-BUT the deployed bots keep running, while the current Quant runner loses Q17 proof coverage and breaks its explicit selectors and fixed inventory checks.

EVIDENCE: `package.json:16`; `test/quant-command-contract.mjs:46`; `test/run-quant-gates.mjs:495`; `quant/tests/q17/test_evidence.py:62`; `quant/tests/q17/test_security.py:271`.

# 7. Non-code dossiers

The following five scopes are exclusive non-code inventory. They are intentionally absent from the 1,041,817 code total.

<!-- visible task 146 -->
## test/** non-code — 37,631 text lines; 146 binary files / 25,464,906 bytes

WHAT IT IS: This block contains 205 non-code files: 58 JSON (structured-text) records, one Markdown guide, and 146 PNG (image) files. Of these, 197 preserve a one-off July 16, 2026 local acceptance campaign for candidate …98f3: six light/dark browser captures at three sizes, performance and restart measurements, and the complete saved proof record. The old “~119k lines” estimate counted 82,649 newline-like bytes inside compressed images; those are not text lines, so this entire block stays outside the 1,041,817 code denominator.

SUB-PIECES:

- `performance/schema.v1.json — 653 lines` — format rules for performance evidence; runner selects: YES, named I00 performance checks only, not default `npm test`.
- `performance/{browser-receipt,browser-capture}.schema — 344 lines` — format rules for browser proof; runner selects: YES, named I00 acceptance checks only.
- `evidence/local-complete-acceptance-…6436.json — 4,853 lines` — records the serial acceptance campaign; runner selects: NO automatically, explicit validation path only.
- `evidence/local-proxy-performance-…6436.json — 5,135 lines` — records the three-boot local load, restart, crash, and recovery campaign; runner selects: NO automatically, explicit validation path only.
- `browser/…98f3/…574Z/local-browser-acceptance-…98f3.json — 2,354 lines` — indexes the browser runs and their artifacts; runner selects: NO automatically, explicit receipt path only.
- `browser/…98f3/…574Z/capture/…574Z.json — 17,101 lines` — raw browser, server-response, and visible-page observations; runner selects: NO automatically, through the explicit browser receipt only.
- `bottom-up/DARK — 1,862 lines` — dark-theme measurements for 13 lower-page surfaces; runner selects: explicit receipt only.
- `bottom-up/LIGHT — 1,862 lines` — light-theme measurements for the same surfaces; runner selects: explicit receipt only.
- `topbar/DARK — 1,580 lines` — dark-theme measurements for ten open top-bar panels; runner selects: explicit receipt only.
- `topbar/LIGHT — 1,580 lines` — light-theme measurements for the same panels; runner selects: explicit receipt only.
- `routes/ — 126 PNG files / 20,919,141 bytes` — screenshots of 21 pages across six size/theme runs; runner selects: explicit receipt only.
- `topbar/ — 20 PNG files / 4,545,765 bytes` — screenshots of open top-bar panels; runner selects: explicit receipt only.
- Below 300 each: remaining harness rules and guide — 258 lines; command-status format — 27 lines; restart record — 22 lines. Only their named I00 checks select them.

RUNS NOW?: DEAD — test-only, not mounted by the deployed process. The default runner does not select the acceptance or performance evidence; named validation reads it only when exact paths are supplied. No test or generator was run now.

MONEY?: NO.

REMOVABLE?: YES-BUT live basis and volume behavior stays unchanged while current I00 command checks, named acceptance validation, release packaging, and reproducible historical proof break.

EVIDENCE: [test/i00/performance/README.md:3](/Users/cosmosgeek/Desktop/cosmos-live-20260809/test/i00/performance/README.md:3); [test/i00/performance/README.md:67](/Users/cosmosgeek/Desktop/cosmos-live-20260809/test/i00/performance/README.md:67); [test/i00/performance/local-acceptance.mjs:3297](/Users/cosmosgeek/Desktop/cosmos-live-20260809/test/i00/performance/local-acceptance.mjs:3297); [package.json:16](/Users/cosmosgeek/Desktop/cosmos-live-20260809/package.json:16); [package.json:95](/Users/cosmosgeek/Desktop/cosmos-live-20260809/package.json:95)

<!-- visible task 147 -->
## `web/**` non-code files, excluding `node_modules` and `dist` — 49,888 text lines

WHAT IT IS: This block contains every owned data, image, page, and note file: 370 files totaling 5,279,429 bytes. Exact inventory: JSON data 191 files / 3,312,875 bytes / 37,927 lines; JavaScript 0; debug maps 0; PNG images 24 / 1,227,188 bytes / binary; SVG vector images 6 / 89,177 bytes / 65 lines; HTML pages 4 / 1,351 bytes / 49 lines; Markdown notes 145 / 648,838 bytes / 11,847 lines. By role: `web/public/**` has 360 live public files / 5,125,944 bytes / 47,679 text lines, split into 30 graphics and 330 research records; the root page plus two packed research data files have 1,993 lines; build settings have 37; previews have 36; two notes outside the archive have 143. No checked production bundle exists in scope because JavaScript and debug-map counts are zero; the three checked-in HTML previews are developer-only pages, while the Markdown files preserve documentation and research history.

SUB-PIECES: These are all 59 owned directories and 27 owned files measuring at least 300 text lines. Parent rows overlap their children and must not be added again.

| Directory | Lines | What it is |
|---|---:|---|
| `web/public/` | 47,679 | Live public graphics and research records. |
| `web/public/research-lab/` | 47,614 | The 330-file research archive opened by Research Lab. |
| `web/src/` | 2,159 | Owned live data, developer previews, and notes. |
| `web/src/data/` | 1,980 | Two research data files packed into the live page. |
| `web/public/research-lab/vg25/` | 10,784 | Saved research packet opened on demand. |
| `web/public/research-lab/vg35/` | 8,984 | Saved research packet opened on demand. |
| `web/public/research-lab/vg1/` | 906 | Saved research packet opened on demand. |
| `web/public/research-lab/s1t/` | 808 | Saved research packet opened on demand. |
| `web/public/research-lab/s1q/` | 749 | Saved research packet opened on demand. |
| `web/public/research-lab/s1p/` | 675 | Saved research packet opened on demand. |
| `web/public/research-lab/vg10/` | 660 | Saved research packet opened on demand. |
| `web/public/research-lab/vg12/` | 626 | Saved research packet opened on demand. |
| `web/public/research-lab/vg3/` | 584 | Saved research packet opened on demand. |
| `web/public/research-lab/be2/` | 546 | Saved research packet opened on demand. |
| `web/public/research-lab/s2a/` | 532 | Saved research packet opened on demand. |
| `web/public/research-lab/s1m/` | 517 | Saved research packet opened on demand. |
| `web/public/research-lab/s1g/` | 496 | Saved research packet opened on demand. |
| `web/public/research-lab/vg28/` | 478 | Saved research packet opened on demand. |
| `web/public/research-lab/vg24/` | 471 | Saved research packet opened on demand. |
| `web/public/research-lab/s1y/` | 458 | Saved research packet opened on demand. |
| `web/public/research-lab/vg30/` | 454 | Saved research packet opened on demand. |
| `web/public/research-lab/vg8/` | 428 | Saved research packet opened on demand. |
| `web/public/research-lab/vg22/` | 428 | Saved research packet opened on demand. |
| `web/public/research-lab/vg2/` | 425 | Saved research packet opened on demand. |
| `web/public/research-lab/s1u/` | 417 | Saved research packet opened on demand. |
| `web/public/research-lab/s1o/` | 417 | Saved research packet opened on demand. |
| `web/public/research-lab/vg9/` | 413 | Saved research packet opened on demand. |
| `web/public/research-lab/s2h/` | 408 | Saved research packet opened on demand. |
| `web/public/research-lab/vg19/` | 407 | Saved research packet opened on demand. |
| `web/public/research-lab/vg13/` | 402 | Saved research packet opened on demand. |
| `web/public/research-lab/vg38/` | 399 | Saved research packet opened on demand. |
| `web/public/research-lab/vg5/` | 394 | Saved research packet opened on demand. |
| `web/public/research-lab/vg36/` | 386 | Saved research packet opened on demand. |
| `web/public/research-lab/vg14/` | 384 | Saved research packet opened on demand. |
| `web/public/research-lab/vg31/` | 383 | Saved research packet opened on demand. |
| `web/public/research-lab/vg32/` | 382 | Saved research packet opened on demand. |
| `web/public/research-lab/vg29/` | 382 | Saved research packet opened on demand. |
| `web/public/research-lab/vg7/` | 374 | Saved research packet opened on demand. |
| `web/public/research-lab/s2g/` | 372 | Saved research packet opened on demand. |
| `web/public/research-lab/s1r/` | 371 | Saved research packet opened on demand. |
| `web/public/research-lab/s1i/` | 370 | Saved research packet opened on demand. |
| `web/public/research-lab/s1f/` | 366 | Saved research packet opened on demand. |
| `web/public/research-lab/s1k/` | 358 | Saved research packet opened on demand. |
| `web/public/research-lab/vg6/` | 357 | Saved research packet opened on demand. |
| `web/public/research-lab/s1s/` | 357 | Saved research packet opened on demand. |
| `web/public/research-lab/s1l/` | 351 | Saved research packet opened on demand. |
| `web/public/research-lab/dq7/` | 351 | Saved research explanation opened on demand. |
| `web/public/research-lab/s1n/` | 349 | Saved research packet opened on demand. |
| `web/public/research-lab/s2i/` | 347 | Saved research packet opened on demand. |
| `web/public/research-lab/vg26/` | 345 | Saved research packet opened on demand. |
| `web/public/research-lab/vg16/` | 339 | Saved research packet opened on demand. |
| `web/public/research-lab/s1w/` | 338 | Saved research packet opened on demand. |
| `web/public/research-lab/s1h/` | 336 | Saved research packet opened on demand. |
| `web/public/research-lab/vg37/` | 332 | Saved research packet opened on demand. |
| `web/public/research-lab/vg17/` | 326 | Saved research packet opened on demand. |
| `web/public/research-lab/s2k/` | 312 | Saved research packet opened on demand. |
| `web/public/research-lab/dq12/` | 310 | Saved research explanation opened on demand. |
| `web/public/research-lab/s1j/` | 305 | Saved research packet opened on demand. |
| `web/public/research-lab/vg15/` | 302 | Saved research packet opened on demand. |

| File | Lines | What it is |
|---|---:|---|
| `web/public/research-lab/vg25/freeze.v1.json` | 6,217 | Saved frozen research snapshot; it does not execute. |
| `web/public/research-lab/vg35/freeze.v1.json` | 6,216 | Saved frozen research snapshot; it does not execute. |
| `web/public/research-lab/vg25/development.v1.json` | 3,962 | Saved development result; it does not execute. |
| `web/public/research-lab/vg35/development.v1.json` | 2,089 | Saved development result; it does not execute. |
| `web/src/data/RESEARCH_LAB_INDEX.json` | 1,153 | Live Research Lab catalog data. |
| `web/src/data/researchLabStories.json` | 827 | Live plain-language Research Lab stories. |
| `web/public/research-lab/vg1/protocol.v1.json` | 676 | Saved research plan; it does not execute. |
| `web/public/research-lab/vg35/protocol.v1.json` | 525 | Saved research plan; it does not execute. |
| `web/public/research-lab/vg10/protocol.v1.json` | 509 | Saved research plan; it does not execute. |
| `web/public/research-lab/vg25/protocol.v1.json` | 478 | Saved research plan; it does not execute. |
| `web/public/research-lab/vg12/protocol.v1.json` | 440 | Saved research plan; it does not execute. |
| `web/public/research-lab/vg3/protocol.v1.json` | 404 | Saved research plan; it does not execute. |
| `web/public/research-lab/s1g/protocol.v1.json` | 400 | Saved research plan; it does not execute. |
| `web/public/research-lab/s1t/protocol.v1.json` | 394 | Saved research plan; it does not execute. |
| `web/public/research-lab/s1p/protocol.v1.json` | 359 | Saved research plan; it does not execute. |
| `web/public/research-lab/vg22/protocol.v1.json` | 356 | Saved research plan; it does not execute. |
| `web/public/research-lab/dq7/README.md` | 351 | Research explanation; it does not execute. |
| `web/public/research-lab/be2/protocol.v1.json` | 341 | Saved research plan; it does not execute. |
| `web/public/research-lab/vg24/protocol.v1.json` | 329 | Saved research plan; it does not execute. |
| `web/public/research-lab/s1t/README.md` | 321 | Research explanation; it does not execute. |
| `web/public/research-lab/s1m/protocol.v1.json` | 321 | Saved research plan; it does not execute. |
| `web/public/research-lab/s1q/result.v1.json` | 314 | Saved research result; it does not execute. |
| `web/public/research-lab/vg5/protocol.v1.json` | 308 | Saved research plan; it does not execute. |
| `web/public/research-lab/vg8/protocol.v1.json` | 303 | Saved research plan; it does not execute. |
| `web/public/research-lab/s2h/protocol.v1.json` | 303 | Saved research plan; it does not execute. |
| `web/public/research-lab/vg13/protocol.v1.json` | 301 | Saved research plan; it does not execute. |
| `web/public/research-lab/s2a/protocol.v1.json` | 300 | Saved research plan; it does not execute. |

RUNS NOW?: RUNNING — the live page server is listening on port 5173 from this exact `web` directory. The root page, two packed research data files, 30 public graphics, and all 330 public research records are available; Research Lab opens those records on demand and checks their recorded identity before displaying them. Nineteen top-level graphics have direct references outside the forbidden Watchdog inspection; the other eleven remain publicly served, but their Watchdog use is deliberately unmeasured. DEAD: the three preview HTML pages are not mounted in the normal app and are developer-only; the two local notes are documentation-only. No page request, test, or Watchdog access was performed.

MONEY?: NO — these files contain page setup, display data, pictures, saved research, previews, and notes; none contains basis or volume trading logic or sits inside either server engine’s required imports.

REMOVABLE?: NO — removing the block breaks the web entry, Research Lab data and artifact viewer, public pictures, and build setup. The three previews are YES-BUT their developer preview pages disappear; the two outside notes are YES-BUT their receipt and rebuild history disappear; the 330-file public archive is NO because the live Research Lab opens it; referenced graphics are YES-BUT visible pages lose their marks; the eleven graphics without permitted references must not be cut because Watchdog use remains unmeasured.

EVIDENCE:

- [web/index.html:6-10](/Users/cosmosgeek/Desktop/cosmos-live-20260809/web/index.html:6) — selects a public graphic and the normal live page entry.
- [web/src/pages/ResearchLab.tsx:45-50,191-200](/Users/cosmosgeek/Desktop/cosmos-live-20260809/web/src/pages/ResearchLab.tsx:45) — packs the stories and fetches the catalog.
- [web/src/data/researchLabArtifacts.ts:1-8](/Users/cosmosgeek/Desktop/cosmos-live-20260809/web/src/data/researchLabArtifacts.ts:1) — binds the public archive at exactly 330 files and 3,809,579 bytes.
- [web/src/pages/research-lab/researchLabArtifactClient.ts:253-270](/Users/cosmosgeek/Desktop/cosmos-live-20260809/web/src/pages/research-lab/researchLabArtifactClient.ts:253) — fetches a selected public research record for the live viewer.
- [web/src/features/systemDashboard/preview/index.html:6-10](/Users/cosmosgeek/Desktop/cosmos-live-20260809/web/src/features/systemDashboard/preview/index.html:6) — identifies the representative preview as unwired and gives it a separate developer entry.

<!-- visible task 148 -->
## repo-root non-code + `docs/**` + `live-edge-receipts/**` + `logs/**` + `.github/**` + `.claude/**` + server non-code — 67,335 text lines · 264 files · 4,249,084 bytes

WHAT IT IS: This is the repository’s non-code shell: owner documents, historical proof, live-edge decisions and receipts, launch settings, dependency manifests, logs, and three server configuration or fixture files. At the final read-only snapshot, zone counts were: repo root 42 files / 1,105,831 bytes / 11,072 text lines; docs 118 / 2,505,632 / 43,893; live-edge receipts 95 / 618,110 / 12,001; logs 4 / 12,825 / 141; `.github` 1 / 3,997 / 116; `.claude` 1 / 492 / 23; server 3 / 2,197 / 89. All 264 files are text-readable; binary count is zero, while source code, `node_modules`, `dist`, and `.git` are excluded. The two untracked logs were counted and preserved; no test, network interface, private exchange, database, order path, or Watchdog page was opened.

SUB-PIECES: Directory figures are overlapping roll-ups for trimming; only the heading is the unique total.

Directories at least 300 lines:

- `docs/` — 43,893 — Current dashboard truth plus archived plans, receipts, evidence, and screen-design records.
- `docs/archive/` — 33,386 — Historical project memory, work orders, component manifests, and acceptance receipts.
- `live-edge-receipts/` — 12,001 — Live-edge policies, tasks, acceptance records, and proposed integration patches.
- repo-root files — 11,072 — Canonical owner documents, state reports, and Node dependency and command manifests.
- `docs/design/` — 10,475 — Frozen Watchdog screen-design research.
- `docs/design/watchdog/` — 10,475 — Detailed Watchdog component, spacing, motion, and state guidance.
- `docs/archive/i00-phase4/` — 8,438 — Historical deployment, portability, recovery, and acceptance corrections.
- `docs/archive/i00-phase2/` — 5,218 — Historical integration-candidate receipts.
- `docs/archive/i00-phase4/evidence/` — 5,135 — Archived local-proxy performance evidence.
- `docs/archive/i00-phase4/evidence/R3-D-CLEAN-009/` — 5,135 — One recorded proxy-load, restart, and continuity run.
- `live-edge-receipts/RECEIPTS/` — 5,114 — Stage-by-stage completion, blocker, and acceptance records.
- `docs/archive/aiOps/` — 3,384 — Historical automation-layer port and observation-only receipts.
- `live-edge-receipts/DECISIONS/` — 3,207 — Policies governing exchange adapters, private truth, execution, and recovery.
- `live-edge-receipts/TASKS/` — 3,054 — Bounded live-edge work orders and state records.
- `docs/design/watchdog/notes/` — 2,162 — Working notes for field, metric, and owner-row components.
- `docs/archive/aiOps/a3/` — 829 — Automation-layer A3 port and observation-only evidence.
- `docs/archive/aiOps/a2/` — 718 — Automation-layer A2 port and observation-only evidence.
- `docs/archive/aiOps/a5/` — 649 — Automation-layer A5 port and observation-only evidence.
- `docs/archive/aiOps/a4/` — 645 — Automation-layer A4 blocked and observation-only evidence.
- `docs/archive/aiOps/a3/shadow/` — 596 — Observation-only A3 artifacts with no operating authority.
- `docs/archive/aiOps/a1/` — 543 — Automation-layer A1 port and observation-only evidence.
- `docs/archive/aiOps/a2/shadow/` — 459 — Observation-only A2 artifacts with no operating authority.
- `live-edge-receipts/patches/` — 385 — One patch and seven requests proposing changes rather than running them.
- `docs/archive/aiOps/a5/shadow/` — 384 — Observation-only A5 artifacts with no operating authority.
- `docs/archive/aiOps/a1/shadow/` — 343 — Observation-only A1 artifacts with no operating authority.
- `docs/archive/aiOps/a4/shadow/` — 302 — Observation-only A4 artifacts with no operating authority.

Files at least 300 lines:

- `docs/archive/i00-phase4/evidence/R3-D-CLEAN-009/local-proxy-performance-…1eee.json` — 5,135 — Structured evidence from one historical proxy load and recovery run.
- `docs/archive/i00-phase2/INTEGRATION_CANDIDATE_READY_RECEIPT.md` — 4,306 — Historical integration-candidate readiness record.
- `package-lock.json` — 4,277 — Exact dependency graph used by locked installation.
- `docs/design/watchdog/BIBLE.md` — 1,992 — Master Watchdog screen-design specification.
- `docs/archive/PROJECT_MEMORY.md` — 1,933 — Archived project history superseded by current root documents.
- `DESIGN.md` — 1,390 — Current cockpit design law and measured ship gate.
- `docs/archive/SUPERSEDED_BY_IP_ASSURANCE_AT_…70e3.md` — 1,351 — Retired assurance plan retained for history.
- `docs/design/watchdog/toggle.md` — 1,326 — Design rules for a control bound to server readback.
- `docs/design/watchdog/coverage-counter.md` — 1,244 — Design rules for section coverage counters.
- `docs/design/watchdog/notes/metric-cell.md` — 1,243 — Working design for headline metric cells.
- `docs/archive/PARALLEL_BACKEND_MAX_POWER_SPRINT.md` — 1,218 — Historical parallel-backend work order.
- `docs/design/watchdog/motion.md` — 1,165 — Motion, focus, hover, and live-state guidance.
- `docs/archive/SYSTEM_CONVERGENCE_VERTICAL_SLICE_MAX_POWER_SPRINT.md` — 1,153 — Historical system-composition work order.
- `docs/archive/CAPITAL_SUPERVISION_MAX_POWER_SPRINT.md` — 1,089 — Historical capital-supervision work order.
- `docs/archive/LIVE_INTELLIGENCE_RUNTIME_MAX_POWER_SPRINT.md` — 1,058 — Historical public-market runtime work order.
- `MISSION.md` — 868 — Permanent product purpose and its two money hypotheses.
- `docs/archive/ENGINE.md` — 853 — Archived engine design.
- `docs/archive/BLUEPRINT.md` — 847 — Archived product blueprint.
- `docs/archive/UI_SURFACE_BASELINE.md` — 678 — Historical sidebar, topbar, search, clock, and profile baseline.
- `docs/archive/DESIGN_PLAYBOOK.md` — 668 — Archived screen-building method superseded by root design law.
- `docs/design/watchdog/empty-state.md` — 657 — Design rules for missing or not-yet-measured states.
- `docs/archive/DIRECTOR_RULEBOOK.md` — 577 — Historical development-director operating rules.
- `docs/archive/MARKET_INTELLIGENCE_MAX_POWER_SPRINT.md` — 574 — Historical market-intelligence work order.
- `docs/design/watchdog/notes/field-pair.md` — 571 — Working design for label-and-value fields.
- `docs/design/watchdog/graph-node.md` — 567 — Design rules for dependency nodes and connecting wires.
- `docs/design/watchdog/tokens.md` — 555 — Watchdog spacing, type, and colour scale.
- `docs/archive/LIVE_INTELLIGENCE_RUNTIME_COMPONENTS.md` — 498 — Historical component manifest for public-market runtime.
- `docs/design/watchdog/owner-row.md` — 493 — Final design for component-health rows with provenance.
- `docs/archive/SYSTEM_CONVERGENCE_RECEIPT.md` — 478 — Historical composition receipt and source-verification record.
- `docs/archive/CAPITAL_SUPERVISION_RECEIPT.md` — 464 — Historical capital-supervision completion record.
- `docs/archive/CAPITAL_SUPERVISION_COMPONENTS.md` — 454 — Historical capital-supervision component manifest.
- `IP_ASSURANCE.md` — 450 — Current reliability and cockpit-completeness assurance packet.
- `live-edge-receipts/DECISIONS/D0009-l05-private-truth-policy.md` — 426 — Policy separating read-only private truth from money-capable lifecycles.
- `docs/archive/ENGINE_SPRINT_5H.md` — 418 — Historical five-hour engine work order.
- `docs/archive/LIVE_INTELLIGENCE_RUNTIME_RECEIPT.md` — 371 — Historical public-market runtime completion record.
- `docs/design/watchdog/notes/owner-row.md` — 348 — Working notes preceding the final owner-row design.
- `docs/archive/aiOps/a4/PORT_A4_RECEIPT.md` — 343 — Blocked automation-layer A4 port ruling.
- `docs/archive/aiOps/a3/shadow/A3X_SHADOW_ARTIFACT_RECEIPT.v1.json` — 339 — Observation-only A3 record explicitly granting no authority.
- `QL_DIRECTOR_STATE.md` — 314 — Director custody and state for the two-lane program.
- `docs/design/watchdog/status-chip.md` — 314 — Design rules for status and posture chips.
- `docs/archive/SYSTEM_CONVERGENCE_COMPONENTS.md` — 310 — Historical manifest of composed system components.

RUNS NOW?: RUNNING — only the launch, configuration, and log-output slice. Read-only process inspection found the server and web development server alive in this exact target; documents, receipts, archives, and the server fixture are passive records. The automated-check workflow selects `npm run test:all` on a push or pull request, but no suite was run now and no current pass is claimed.

MONEY?: NEEDED-BY-MONEY — dependency manifests and launch settings are required to install, build, and run the Basis and Volume engines, but this block contains no strategy logic; current boot reports signed mutations `NOT_CONFIGURED`.

REMOVABLE?: YES-BUT removing the whole block breaks locked installation, build/start commands, launch settings, and automated checks, while also erasing owner law and audit history; archives, receipts, and logs alone do not perform market calculations.

EVIDENCE: [package.json:16](/Users/cosmosgeek/Desktop/cosmos-live-20260809/package.json:16) · [.claude/launch.json:5](/Users/cosmosgeek/Desktop/cosmos-live-20260809/.claude/launch.json:5) · [.github/workflows/ci.yml:53](/Users/cosmosgeek/Desktop/cosmos-live-20260809/.github/workflows/ci.yml:53) · [server/src/index.ts:5251](/Users/cosmosgeek/Desktop/cosmos-live-20260809/server/src/index.ts:5251) · [logs/server.log:1](/Users/cosmosgeek/Desktop/cosmos-live-20260809/logs/server.log:1)

<!-- visible task 149 -->
## quant/** + verification/** non-code — 58,374 lines

WHAT IT IS: After excluding source files and `quant/tests` code, this is 342 regular text files totaling 5,143,950 bytes: Quant has 288 files / 2,287,552 bytes / 27,079 newline-counted lines; verification has 54 files / 2,856,398 bytes / 31,295 lines. Quant holds locked tooling inputs, saved test inputs, research results, decisions, tasks, and receipts. Verification is frozen product-truth campaign custody; none of these files is a current live-program input.

SUB-PIECES:

- `quant` — 27,079 — all owned Quant non-code.
- `quant/DECISIONS` — 1,535 — research design rulings.
- `quant/RECEIPTS` — 4,357 — historical build and acceptance records.
- `quant/TASKS` — 2,791 — completed Quant work orders and state.
- `quant/docs` — 1,944 — research and design explanations.
- `quant/generated` — 579 — saved research outputs read by Quant proof tools.
- `quant/research` — 11,997 — manual deep-question studies and saved inputs; its nearby test files are not selected by the current Quant gate.
- `quant/research/dq1` — 484 — public daily-candle source-boundary study.
- `quant/research/dq10` — 1,081 — research-result truth study.
- `quant/research/dq10/fixtures` — 710 — saved valid and hostile result inputs.
- `quant/research/dq11` — 352 — portable sample-denominator study.
- `quant/research/dq12` — 468 — Spot-to-perpetual instrument identity study.
- `quant/research/dq13` — 6,086 — causal clock and data-availability study.
- `quant/research/dq13/fixtures` — 2,277 — saved clock-ordering cases.
- `quant/research/dq3` — 401 — statistical-coordinate study.
- `quant/research/dq4` — 427 — origin-proof study.
- `quant/research/dq6` — 356 — research-economics truth study.
- `quant/research/dq7` — 1,329 — duplicate-hypothesis and multiple-trial study.
- `quant/research/dq7/fixtures` — 949 — saved program-validation inputs.
- `quant/research/dq8` — 660 — account-value and drawdown study.
- `quant/research/dq8/fixtures` — 554 — saved account-value test inputs.
- `quant/tests` — 2,074 — non-code inputs for current Quant tests; the current Quant gate selects their owning `tests` tree.
- `quant/tests/fee_truth` — 1,659 — fee scenario and receipt shape evidence.
- `quant/tests/fee_truth/fixtures` — 1,659 — the four saved fee inputs.
- `quant/tests/maker_fee_grid` — 405 — maker-fee experiment custody.
- `quant/tests/maker_fee_grid/fixtures` — 405 — saved maker-fee package.
- `quant/tests/maker_fee_grid/fixtures/package` — 405 — protocol, custody, source, and result records.
- `verification` — 31,295 — all owned frozen verification evidence.
- `verification/product-truth-20260716` — 31,295 — exact-candidate evidence and campaign records.
- `verification/product-truth-20260716/locked-input-payloads` — 15,173 — frozen copies of owner instructions and authority records.
- `verification/product-truth-20260716/wave1-inputs` — 2,049 — early runbook, precheck, and finding records.

Files at least 300 lines:

- `quant/QUANT_EDGE_BUILD_STATE.md` — 461 — historical Quant build state.
- `quant/RECEIPTS/Q17.md` — 360 — final Quant proof receipt.
- `quant/research/dq13/fixtures/cases.v1.json` — 2,277 — saved causal-clock cases.
- `quant/research/dq13/proof.v1.json` — 3,341 — frozen clock-validator proof with no money authority.
- `quant/research/dq7/README.md` — 351 — duplicate-hypothesis validator contract.
- `quant/research/dq7/fixtures/valid_program.v1.json` — 392 — saved valid research-program input.
- `quant/tests/fee_truth/fixtures/n3_fee_scenario_inputs.v1.schema.json` — 946 — fee-scenario shape rules.
- `quant/tests/fee_truth/fixtures/sanitized_fee_receipt.v1.schema.json` — 711 — sanitized fee-receipt shape rules.
- `quant/uv.lock` — 1,009 — exact Python tool and library versions for reproducible Quant runs.
- `verification/product-truth-20260716/EVIDENCE_SELECTION.json` — 461 — exact evidence selection.
- `verification/product-truth-20260716/INPUTS.lock` — 1,677 — frozen campaign-input inventory.
- `verification/product-truth-20260716/LOCKED_INPUT_PAYLOADS.json` — 682 — tracked payload bytes and binding metadata.
- `verification/product-truth-20260716/MANIFEST.json` — 447 — complete evidence-file inventory.
- `verification/product-truth-20260716/MERGE_PROVENANCE.json` — 1,421 — record of where merged code came from.
- `verification/product-truth-20260716/WORKTREE_CENSUS.json` — 7,658 — historical worktree inventory.
- `verification/product-truth-20260716/locked-input-payloads/01-CAMPAIGN.md` — 780 — frozen campaign brief.
- `verification/product-truth-20260716/locked-input-payloads/05-Q_L_LAUNCH.md` — 417 — frozen Quant and lifecycle launch order.
- `verification/product-truth-20260716/locked-input-payloads/06-Q_DIRECTIVE.md` — 1,930 — frozen Quant directive.
- `verification/product-truth-20260716/locked-input-payloads/07-L_DIRECTIVE.md` — 2,080 — frozen lifecycle directive.
- `verification/product-truth-20260716/locked-input-payloads/08-I00.md` — 2,546 — frozen product campaign order.
- `verification/product-truth-20260716/locked-input-payloads/13-POST_I00.md` — 1,980 — frozen later campaign instructions.
- `verification/product-truth-20260716/locked-input-payloads/15-FRONTIER.md` — 1,419 — frozen Frontier instructions.
- `verification/product-truth-20260716/locked-input-payloads/19-PARALLEL_CAPABILITY_FOUNDRY_AND_SENSE_PACKS_md.md` — 1,594 — frozen parallel capability order.
- `verification/product-truth-20260716/wave1-inputs/ACTIVATION_RUNBOOK_DRAFT.md` — 450 — reference-only activation draft.
- `verification/product-truth-20260716/wave1-inputs/CLEAN_CLONE_FINDINGS.json` — 583 — frozen clean-clone findings.
- `verification/product-truth-20260716/wave1-inputs/PROV_FINDINGS.json` — 743 — frozen evidence-origin findings.

RUNS NOW?: DEAD — not mounted / test-and-research-only. Production substitutes a blocked, not-configured Quant projection with no client, transport, or owner observation. The current Quant gate reads `quant/tests`, locks, registry, and proof material; the deterministic root runner selects the product-truth acceptance contract, whose verifier reads the verification inventory. No test was run now, and no current pass is claimed.

MONEY?: NO — some files study Basis and Volume, but neither live engine nor its required live-program dependencies read them.

REMOVABLE?: YES-BUT live bot behavior would remain unchanged while locked setup, current Quant and verification gates, research reproduction, and frozen campaign custody would break.

EVIDENCE: `server/src/systemIntegration/adapters/qAdvisory.ts:296-330`; `test/run-quant-gates.mjs:483-500`; `server/test/run-deterministic-network-free.mjs:20-31`; `verification/product-truth-20260716/verify-exact-candidate-evidence.mjs:456-475`; `verification/product-truth-20260716/STATE.md:7-16`.

<!-- visible task 150 -->
## fixtures/** + ops/** + integration/** + packages/** non-code — 113,036 lines

WHAT IT IS: This is 246 non-code text files totaling 4,485,385 bytes and 113,036 newline-counted lines. `fixtures/**` is 170 files / 3,565,200 bytes / 89,515 lines of test data, generated records, and archived receipts; `ops/**` is 73 files / 289,640 bytes / 6,936 lines of deployment, recovery, configuration, and operating records. `integration/**` is one generated evidence file / 600,921 bytes / 16,181 lines; `packages/**` is two protocol-test files / 29,624 bytes / 404 lines. The count excludes the order’s code extensions: `.ts`, `.tsx`, `.css`, `.py`, `.mjs`, and `.sh`.

SUB-PIECES:

- AI Operations fixture suite — 39,656 lines — TEST-ONLY; intended to prove its five lanes’ contracts, denials, handoffs, and interface behavior; current runner: YES, root `npm test`; not run now.
- I00 integration-acceptance fixture suite — 2,094 lines — TEST-ONLY; intended to prove route migration, closure evidence, scenarios, and the assurance manifest; current runner: YES, root `npm test`; not run now.
- Product Assurance fixture suite — 41,577 lines — TEST-ONLY with generated and archival records; intended to prove faults, cockpit rules, written safety models, hazards, monitoring evidence, and stability; current runner: YES, root `npm test`; not run now.
- Observability Shadow suite — 1,351 lines — TEST-ONLY/ARCHIVAL; intended to prove an unmounted monitoring-view port and its receipts; current runner: NO.
- Operations Shadow suite — 1,504 lines — TEST-ONLY/ARCHIVAL; intended to prove a staged operations port without deployment authority; current runner: NO.
- Replay Shadow suite — 2,535 lines — TEST-ONLY/ARCHIVAL; intended to prove deterministic replay and hostile cases; current runner: NO.
- Runbook Shadow suite — 798 lines — TEST-ONLY/ARCHIVAL; intended to prove staged drill and display contracts; current runner: NO.
- Operations artifact suite — 6,936 lines — RUNTIME-OPS/REFERENCE; explicit operations runners select these files, but the live application and root `npm test` do not; not run now.
- Integration proof report — 16,181 lines — GENERATED/ARCHIVAL/TEST-SELECTED; intended to prove the checked-in machine report matches reconstructed acceptance evidence; current runner: YES, root I00 proof runner; not run now.
- Edge protocol suite — 404 lines — TEST-ONLY; intended to prove protocol shape, size limits, and forbidden secret-bearing fields; current runner: YES through `test:all`, not default `npm test`; not run now.

All owned directories at least 300 lines:

- `fixtures` — 89,515 — TEST-ONLY/GENERATED/ARCHIVAL; contains every owned fixture family.
- `fixtures/aiOps` — 39,656 — TEST-ONLY; contains AI Operations contracts and test evidence.
- `fixtures/aiOps/a1` — 37,337 — TEST-ONLY; contains authority maps, adapted schemas, reliability targets, and runbooks.
- `fixtures/aiOps/a2` — 865 — TEST-ONLY; contains runtime-handoff and replay inputs.
- `fixtures/aiOps/a3` — 587 — TEST-ONLY; contains adapter and provider insertion records.
- `fixtures/aiOps/a5` — 601 — TEST-ONLY/ARCHIVAL; contains hostile-campaign drafts and research notes.
- `fixtures/i00` — 2,094 — TEST-ONLY; contains integration-acceptance evidence and runner manifests.
- `fixtures/obsShadow` — 1,351 — TEST-ONLY/ARCHIVAL; contains the unmounted monitoring-view port packet.
- `fixtures/obsShadow/receipts` — 464 — ARCHIVAL; records historical monitoring-port custody.
- `fixtures/opsShadow` — 1,504 — TEST-ONLY/ARCHIVAL; contains the staged operations-port packet.
- `fixtures/opsShadow/receipts` — 695 — ARCHIVAL; records historical operations-port custody.
- `fixtures/productAssurance` — 41,577 — TEST-ONLY/GENERATED/ARCHIVAL; contains product-safety evidence and models.
- `fixtures/productAssurance/fixtures-root` — 7,042 — TEST-ONLY; contains the main assurance evidence and synthetic fault corpus.
- `fixtures/productAssurance/generated` — 426 — GENERATED; contains produced assurance reports and matrices.
- `fixtures/productAssurance/systemic` — 33,884 — TEST-ONLY/ARCHIVAL; contains systemic safety contracts and evidence.
- `fixtures/productAssurance/systemic/agentBoundary` — 1,016 — TEST-ONLY; defines safe diagnostic-worker boundaries.
- `fixtures/productAssurance/systemic/assuranceCase` — 464 — TEST-ONLY/ARCHIVAL; contains assurance-case inputs and state.
- `fixtures/productAssurance/systemic/assuranceCase/receipts` — 315 — ARCHIVAL; records assurance-case acceptance and blockers.
- `fixtures/productAssurance/systemic/cockpit` — 16,548 — TEST-ONLY; contains cockpit truth contracts and hostile observations.
- `fixtures/productAssurance/systemic/cockpit/drafts` — 649 — GENERATED/ARCHIVAL; contains proposed insertion rows.
- `fixtures/productAssurance/systemic/cockpit/fixtures` — 10,509 — TEST-ONLY; contains panel contracts, observations, and projection mappings.
- `fixtures/productAssurance/systemic/cockpit/receipts` — 309 — ARCHIVAL; records cockpit prestage custody.
- `fixtures/productAssurance/systemic/cockpit/schemas` — 5,027 — TEST-ONLY; defines the permitted cockpit evidence shapes.
- `fixtures/productAssurance/systemic/formal` — 4,270 — TEST-ONLY/ARCHIVAL; contains written safety models and their reports.
- `fixtures/productAssurance/systemic/formal/contracts` — 450 — TEST-ONLY; contains formal-model result contracts.
- `fixtures/productAssurance/systemic/formal/contracts/schemas` — 450 — TEST-ONLY; defines machine-readable formal-result shapes.
- `fixtures/productAssurance/systemic/formal/receipts` — 530 — ARCHIVAL; records formal-model work and blockers.
- `fixtures/productAssurance/systemic/formal/tla` — 2,809 — TEST-ONLY/REFERENCE; contains thirteen written state-machine safety models.
- `fixtures/productAssurance/systemic/hazard` — 355 — TEST-ONLY/ARCHIVAL; contains hazard-analysis drafts, receipts, and state.
- `fixtures/productAssurance/systemic/observability` — 10,667 — TEST-ONLY; contains monitoring evidence, schemas, and evaluators’ inputs.
- `fixtures/productAssurance/systemic/observability/cases` — 9,079 — TEST-ONLY; contains historical-series, release, and reliability cases.
- `fixtures/replayShadow` — 2,535 — TEST-ONLY/ARCHIVAL; contains the staged replay corpus and entry packet.
- `fixtures/runbookShadow` — 798 — TEST-ONLY/ARCHIVAL; contains staged operational drills and entry records.
- `ops` — 6,936 — RUNTIME-OPS/REFERENCE; contains deployment, backup, restore, and rollback contracts.
- `ops/docs` — 552 — REFERENCE; contains operator instructions.
- `ops/docs/i00` — 552 — REFERENCE; contains integration-release and recovery instructions.
- `ops/i00` — 4,706 — RUNTIME-OPS; contains deployment contracts and validation schemas.
- `ops/i00/schemas` — 3,565 — RUNTIME-OPS; defines accepted deployment, rollback, backup, and receipt records.
- `ops/live` — 968 — RUNTIME-CONFIG; contains host configuration copied outside the repository during deployment.
- `ops/templates` — 478 — RUNTIME-CONFIG; contains configuration templates used during assembly or installation.
- `ops/templates/i00` — 462 — RUNTIME-CONFIG; contains integration-specific host templates.
- `integration` — 16,181 — GENERATED/ARCHIVAL; contains the machine acceptance report.
- `integration/reports` — 16,181 — GENERATED/ARCHIVAL; contains the sole checked-in integration report.
- `packages` — 404 — TEST-ONLY; contains the protocol test data.
- `packages/edge-protocol` — 404 — TEST-ONLY; contains the protocol schema and examples.
- `packages/edge-protocol/schema` — 383 — TEST-ONLY; contains the protocol’s accepted machine shape.

All owned files at least 300 lines:

- `fixtures/aiOps/a1/adapted-schemas.v1.json` — 20,049 — TEST-ONLY; stores adapted contract examples.
- `fixtures/aiOps/a1/capability-graduation-target-instances.v1.json` — 1,270 — TEST-ONLY; stores capability-graduation examples.
- `fixtures/aiOps/a1/classification-manifest.v1.json` — 1,067 — TEST-ONLY; classifies inherited interfaces and ownership.
- `fixtures/aiOps/a1/control-insertion-requests.v1.json` — 5,726 — TEST-ONLY; records proposed control insertion points.
- `fixtures/aiOps/a1/entry-inventory.v1.json` — 1,412 — TEST-ONLY; inventories source entries consumed by the AI test runner.
- `fixtures/aiOps/a1/identity-provider-matrix.v1.json` — 370 — TEST-ONLY; maps identity providers to allowed roles.
- `fixtures/aiOps/a1/mechanical-authority-manifests.v1.json` — 3,003 — TEST-ONLY; records machine-checkable authority boundaries.
- `fixtures/aiOps/a1/reliability-targets.v1.json` — 573 — TEST-ONLY; records reliability targets without activating them.
- `fixtures/aiOps/a1/runbook-manifest-instances.v1.json` — 1,550 — TEST-ONLY; provides runbook instances for tests.
- `fixtures/aiOps/a1/runbook-templates.v1.json` — 979 — TEST-ONLY; provides proposed automation runbooks.
- `fixtures/aiOps/a2/insertion-requests.v1.json` — 389 — TEST-ONLY; records requested runtime handoff seams.
- `fixtures/aiOps/a3/insertion-requests.v1.json` — 333 — TEST-ONLY; records requested adapter seams.
- `fixtures/aiOps/a5/INSERTION_REQUEST_ROWS.DRAFT.v1.json` — 469 — ARCHIVAL; preserves draft hostile-harness requests.
- `fixtures/i00/baseline-route-migration.json` — 715 — TEST-ONLY; maps historical routes to current ownership.
- `fixtures/i00/closure-evidence.json` — 337 — TEST-ONLY; records integration-closure claims checked by tests.
- `fixtures/i00/product-assurance-manifest.v1.json` — 631 — TEST-ONLY; tells the assurance runner which suites and checks to select.
- `fixtures/obsShadow/receipts/PORT_OBS_RECEIPT.v1.json` — 327 — ARCHIVAL; records monitoring-port prestage evidence.
- `fixtures/opsShadow/OPS_SHADOW_ENTRY_GATE.v1.json` — 459 — ARCHIVAL; records the staged operations entry decision.
- `fixtures/opsShadow/OPS_SHADOW_INSERTION_REQUESTS.v1.json` — 350 — ARCHIVAL; records staged operations insertion requests.
- `fixtures/opsShadow/receipts/OPS_SHADOW_RECEIPT.v1.json` — 313 — ARCHIVAL; records the original operations shadow result.
- `fixtures/opsShadow/receipts/PORT_OPS_PRESTAGE_RECEIPT.v1.json` — 382 — ARCHIVAL; records later operations-port prestage evidence.
- `fixtures/productAssurance/fixtures-root/core-assurance-evidence.json` — 300 — TEST-ONLY; inventories core assurance evidence.
- `fixtures/productAssurance/fixtures-root/fault-harness-synthetic.json` — 6,742 — TEST-ONLY; supplies synthetic failure cases rather than live evidence.
- `fixtures/productAssurance/systemic/agentBoundary/agent-boundary-v1.schema.json` — 473 — TEST-ONLY; defines safe diagnostic-worker records.
- `fixtures/productAssurance/systemic/cockpit/drafts/INSERTION_REQUEST_ROWS_DRAFT.v1.json` — 496 — GENERATED/ARCHIVAL; preserves proposed cockpit insertion rows.
- `fixtures/productAssurance/systemic/cockpit/fixtures/panel-contracts.v1.json` — 6,496 — TEST-ONLY; defines every tested cockpit panel contract.
- `fixtures/productAssurance/systemic/cockpit/fixtures/panel-observations.v1.json` — 1,843 — TEST-ONLY; supplies healthy and hostile panel observations.
- `fixtures/productAssurance/systemic/cockpit/fixtures/surface-projection-matrix.v1.json` — 2,170 — TEST-ONLY; maps owner truth to visible surfaces.
- `fixtures/productAssurance/systemic/cockpit/receipts/COCKPIT_PRESTAGE_RECEIPT.v1.json` — 309 — ARCHIVAL; records cockpit prestage custody.
- `fixtures/productAssurance/systemic/cockpit/schemas/cockpit-contract-set.v1.schema.json` — 1,106 — TEST-ONLY; defines valid cockpit contract sets.
- `fixtures/productAssurance/systemic/cockpit/schemas/cockpit-view-model.v1.schema.json` — 2,923 — TEST-ONLY; defines valid cockpit display data.
- `fixtures/productAssurance/systemic/cockpit/schemas/insertion-request-draft.v1.schema.json` — 311 — TEST-ONLY; defines valid insertion-request drafts.
- `fixtures/productAssurance/systemic/cockpit/schemas/release-bound-panel-evaluation.v1.schema.json` — 320 — TEST-ONLY; defines release-bound panel evaluations.
- `fixtures/productAssurance/systemic/formal/tla/S3M05BorrowLiability.tla` — 315 — TEST-ONLY/REFERENCE; models borrow-liability safety.
- `fixtures/productAssurance/systemic/formal/tla/S3M07CancellationBoundary.tla` — 351 — TEST-ONLY/REFERENCE; models cancellation safety.
- `fixtures/productAssurance/systemic/observability/cases/historical-series-complete.json` — 1,942 — TEST-ONLY; supplies a complete historical monitoring series.
- `fixtures/productAssurance/systemic/observability/cases/release-manifest-healthy.json` — 3,765 — TEST-ONLY; supplies a synthetic healthy release record.
- `fixtures/productAssurance/systemic/observability/cases/slo-catalog-complete.json` — 1,071 — TEST-ONLY; supplies a complete reliability-target catalog.
- `fixtures/productAssurance/systemic/observability/cases/slo-trend-history.json` — 2,153 — TEST-ONLY; supplies reliability trend history.
- `fixtures/productAssurance/systemic/observability/historical-series.schema.json` — 328 — TEST-ONLY; defines acceptable historical-series data.
- `fixtures/productAssurance/systemic/observability/release-bound-expected-manifest.schema.json` — 391 — TEST-ONLY; defines acceptable release expectations.
- `fixtures/replayShadow/corpus.v1.json` — 2,046 — TEST-ONLY/ARCHIVAL; contains the staged replay corpus.
- `fixtures/runbookShadow/drills.v1.json` — 380 — TEST-ONLY/ARCHIVAL; contains staged recovery drills.
- `ops/docs/i00/RELEASE_AND_RECOVERY_RUNBOOK.md` — 414 — REFERENCE; explains release, shutdown, restart, rollback, backup, and restore.
- `ops/i00/l15-amendment-contract.json` — 892 — RUNTIME-OPS; binds accepted operational amendments used by deployment scripts.
- `ops/i00/schemas/authorized-effect-handoff.schema.json` — 356 — RUNTIME-OPS; defines an authorized effect handoff.
- `ops/i00/schemas/authorized-effect-terminal.schema.json` — 412 — RUNTIME-OPS; defines a terminal operational result.
- `integration/reports/i00-proof-evidence.json` — 16,181 — GENERATED/ARCHIVAL/TEST-SELECTED; stores the reconstructed acceptance report.
- `packages/edge-protocol/schema/edge-protocol-v1.schema.json` — 383 — TEST-ONLY; defines the edge-protocol envelope checked by the protocol suite.

RUNS NOW?: DEAD — these repository paths are not mounted as inputs to the live Node program. The operations files take effect only after an owner copies or invokes them outside the tree; the other files are test-only, generated, or archival. Current installed-host copies were not measured, and no test was run.

MONEY?: NO — none contains Basis or Volume decision logic, and none is imported into either engine’s deployed runtime closure.

REMOVABLE?: YES-BUT removing the whole block breaks AI, assurance, integration, protocol, deployment, backup, restore, rollback, and recovery proof paths; it removes no live Basis or Volume strategy logic.

EVIDENCE: `ops/live/systemd/cosmos-app.service:10-13`; `package.json:82-95`; `server/test/run-ai-ops.mjs:266-273`; `server/test/i00Acceptance/closure-evidence.test.mjs:369`; `packages/edge-protocol-tests/protocol.test.mjs:14-15`.

# 8. Method, limits, and custody

- The Phase-0 command followed the governing extension set: .ts, .tsx, .css, .py, .mjs, and .sh; node_modules, .git, and dist were pruned.
- Remaining JSON, Markdown, HTML, YAML, images, locks, receipts, logs, schemas, fixtures, and configuration were inventoried separately by directory, file count, bytes, and text lines.
- Runtime proof was limited to safe process, working-directory, listener, open-file, built-artifact, and source/import inspection.
- No API response, database row, private exchange fact, browser render, test result, deployment result, or current money balance is implied by this report.
- Process, source, candidate, receipt, and manifest identifiers are shortened to their last four characters.
- The target tree was never written. The only new file is this report at /Users/cosmosgeek/Desktop/CODEX_BLOCK_AUDIT_REPORT.md, outside the target.

# 9. Closing ruling

The whole-tree audit is **VALID for source coverage** and **NOT a claim of runtime health, browser acceptance, test passage, deployment, or money readiness**. The rebuild handoff is the 117-file / 48,363-line extraction manifest in Section 4. Its strongest design instruction is also the simplest: preserve the two public-market scanners and their fail-closed dependencies, then build a new narrow execution boundary instead of assuming the dormant lifecycle islands are already the product.

walls hold
