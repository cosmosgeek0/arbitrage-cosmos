# INDEPENDENT PRODUCT TRUTH AND LIVE-READINESS CAMPAIGN

**Date:** 2026-07-16  
**Purpose:** verify the existing Cosmos Arbitrage Control Room without launching another competing product build  
**Input snapshot:** `FULL_LOCAL_STATE_BRIEFING_FOR_WEB_COMMANDER_20260716.md` and the canonical mission/architecture documents  
**Authority:** verification and release gating only; this file does not replace `MISSION.md`, architecture authority, the accepted I00 assembly program, or the POST-I00 AI-Ops program

---

## 0. The instruction in one paragraph

Stop measuring progress by line count, chat confidence, worktree count, test-count headlines, or the word `done`. Preserve the current work, finish and seal the already active lanes, freeze one exact candidate SHA, and subject that immutable candidate to two-account independent verification. Account A may assemble and fix. Account B may inspect and reject but must not fix or write to the candidate. Before deployment, the campaign must prove directive coverage, Git provenance, clean-checkout reproducibility, cockpit-to-backend truth, composed-runtime behavior, failure recovery, rollback, and external detection. Deployment, private reads, signed tests, and each capital rung remain separately owner-authorized. No new heavyweight feature program may start during this campaign.

---

## 1. Honest verdict from the supplied evidence

### 1.1 What appears strong

The supplied local-state briefing describes a materially credible validate-only platform:

- a core candidate was assembled from controlled donors;
- an independent verifier rejected the first candidate with 15 findings;
- separate analysis shards confirmed those findings;
- fixes were applied and a fresh verifier reported zero surviving findings;
- the accepted core was landed and re-tested;
- Q, L, capital, risk, ledger, cockpit, system-integration, operations, and assurance organs have substantial test evidence;
- Git SHAs, receipts, one-writer worktrees, and durable state were used instead of chat memory;
- the current code is mechanically blocked from moving money.

That is real engineering evidence. It is not the pattern of a director blindly merging every worker output.

### 1.2 What is not yet proved

The same briefing explicitly says the following are not complete:

- AI-Ops is not integrated into Main at the briefing snapshot;
- the live-execution layer is built and tested but unwired;
- private account truth is absent;
- no signed exchange call has occurred;
- no real order has occurred;
- deployment has not occurred;
- external watchdog and paging have not been proved in the deployed environment;
- no $10 canary has occurred;
- no forward economic edge has been established;
- Q correctly abstains because forward evidence is insufficient.

Therefore the truthful description is:

> A strongly tested validate-only platform exists. It is not yet a deployed, privately connected, independently live-verified, money-producing product.

### 1.3 What this review can and cannot assert

This campaign is based on a read-only briefing created by a commander with local Git access. The briefing is evidence-rich, but this web commander does not have the live repository. Every SHA and claim must be re-measured by the verification agents from Git. No document, including this one, may substitute for that readback.

No audit can guarantee “zero bugs” or profits. The achievable standard is stronger and more useful: no silent omissions, no unexplained code, no false green, reproducible builds, independent rejection authority, bounded failures, observable runtime behavior, tested recovery, small canaries, and complete economic evidence.

---

## 2. Immediate P0 truth-reconciliation gate

Do this before another feature wave and before treating the briefing as current truth.

### 2.1 Resolve briefing contradictions from Git

The verifier must produce an explicit ruling for each item:

1. **CI hotfix status:** the briefing says Main contains two CI-hotfix commits, while elsewhere it says hotfix #2 remains in a worktree. Record the actual Main ancestry and terminal status.
2. **Active writer status:** the ledger lists some AI-Ops ports as active while the briefing calls them sealed. Reconcile the writer ledger from the filesystem and Git.
3. **Canonical state:** `STATE.md` reportedly claims current-state authority while containing a pre-landing state. Select one current-state authority and rewrite it atomically after the candidate freezes.
4. **AI-Ops state:** prove the exact number of AI-Ops files on Main now. Do not reuse the briefing’s older count.
5. **A4 and egress durability:** identify all dirty tracked and untracked source paths, commit or deliberately abandon them with a receipt, and never clean them implicitly.
6. **Owner-signature ordering:** state exactly whether AI-Ops integration may proceed before owner signatures and at which gate signatures become blocking.
7. **Deferred ledger compare-and-set contract:** cite the exact decision and receipt that accepted, rejected, adapted, or deferred it.
8. **Deferred Foundation quantity-bridge contract:** cite the exact decision and receipt that accepted, rejected, adapted, or deferred it.
9. **Clean-checkout CI:** prove the final frozen SHA is green from a fresh single-branch checkout. A green dirty worktree does not count.

Any unresolved item is `UNKNOWN`, not “probably fine.”

### 2.2 Freeze feature expansion

Until P0 is accepted:

- do not start Frontier;
- do not add another strategy family;
- do not add another execution authority, ledger, risk engine, account store, supervisor, AI plane, or dashboard shell;
- do not prune or clean any worktree;
- do not let an exhausted chat perform final integration or final verification;
- do not call a sealed branch integrated;
- do not call an integrated module deployed;
- do not call a deployed module live-proved;
- do not call a backtest or validate-only result an edge.

---

## 3. Status vocabulary that may not be collapsed

Every capability must have exactly one of these measured states:

1. `PROPOSED` — directive only.
2. `BRANCH_BUILT` — source exists on an isolated branch.
3. `SEALED` — the branch has a terminal receipt and immutable SHA.
4. `INTEGRATED` — the source is in candidate ancestry or has an exact selective-merge receipt.
5. `VERIFIED` — an independent verifier tested the exact integrated SHA.
6. `WIRED_LOCAL` — mounted into the composed local runtime.
7. `DEPLOYED_STAGING` — running on the intended staging host and network boundary.
8. `PRIVATE_READ_PROVED` — real read-only account truth reconciles.
9. `SIGNED_TEST_PROVED` — an owner-authorized signed test path works.
10. `TEST_ORDER_PROVED` — owner-authorized test-order lifecycle reconciles.
11. `CANARY_PROVED` — a named capital rung completes with recovery and PnL evidence.
12. `EDGE_ESTABLISHED` — forward evidence demonstrates repeatable net value after costs.

The following honest states remain first-class:

- `NOT_CONFIGURED`;
- `UNWIRED`;
- `REFERENCE_ONLY`;
- `DEFERRED_OWNER_GATE`;
- `ABSTAIN_UNKNOWN`;
- `MISSING`;
- `CONFLICTING`;
- `BLOCKED`.

The word `done` is forbidden in acceptance receipts unless followed by one of the precise states above.

---

## 4. Two-account authority model

### 4.1 Account A — candidate owner and fix integrator

Account A:

- owns candidate assembly;
- may create isolated fixer worktrees;
- is the only account allowed to merge fixes into the candidate;
- must freeze each candidate to an immutable SHA;
- must produce exact build and provenance receipts;
- may not issue final independent acceptance.

### 4.2 Account B — independent verifier

Account B:

- starts from a fresh clean clone or detached worktree at the exact frozen SHA;
- reads canonical files and source, not builder-chat explanations;
- has no write authority over Main, the candidate, shared branches, or accepted receipts;
- returns findings and evidence only;
- may reject the candidate;
- may not repair its own findings;
- is the only account allowed to issue the final verification token.

Use different model families/providers for A and B when possible. Independent prompts and different model families reduce correlated blind spots.

### 4.3 What parallelism is safe

Parallelize discovery and verification, not shared writes.

Safe parallel work:

- worktree census;
- directive extraction;
- Git ancestry/provenance checks;
- duplicate-authority scans;
- read-only security and egress review;
- clean-clone environment preparation;
- independent test shards at one frozen SHA;
- cockpit binding analysis;
- runtime fault-injection planning.

Unsafe parallel work:

- two agents editing the same candidate;
- two integrators landing shared seams;
- testing while the candidate is mutating;
- a verifier silently fixing what it finds;
- two directors issuing competing current-state truth;
- merging based on a receipt label without checking its Git object.

### 4.4 Fix loop

For every rejected candidate:

1. B publishes findings against exact SHA C.
2. A validates and groups non-overlapping findings.
3. A creates bounded fixer worktrees with exclusive paths.
4. A integrates fixes and freezes new SHA C+1.
5. B reruns affected tests and the complete acceptance battery on C+1.
6. No evidence from C is reused as proof for C+1 unless the artifact is content-addressed and byte-identical.

---

## 5. How to verify 94 worktrees without reading them manually

The product is not “94 worktrees.” The product is one frozen candidate tree. Worktrees are donor vessels and historical evidence.

Generate one machine-readable census for every registered worktree with:

- absolute path;
- branch name;
- HEAD SHA;
- base SHA;
- upstream;
- ahead/behind counts;
- dirty tracked paths;
- untracked paths;
- task/owner;
- allowed-write paths;
- terminal receipt path;
- claimed terminal state;
- accepted donor SHA;
- whether the donor SHA is in candidate ancestry;
- whether an exact selective-merge receipt exists;
- whether its patch is duplicated elsewhere;
- disposition reason.

Classify every worktree as exactly one:

- `ACTIVE_DIRTY`;
- `SEALED_UNMERGED`;
- `MERGED_RETAINED`;
- `BLOCKED`;
- `SUPERSEDED_SAFE`;
- `ABANDONED_SAFE`;
- `DUPLICATE_PATCH`;
- `UNKNOWN`.

Release is blocked by:

- any `UNKNOWN`;
- any unexplained dirty source;
- any mandatory `SEALED_UNMERGED` requirement;
- any protected-path modification outside a worker’s grant;
- any donor receipt whose SHA does not exist;
- any claimed merge not in ancestry and lacking a selective-merge receipt.

Do not run destructive cleanup during this campaign. Worktree deletion is a later housekeeping operation after a signed census proves that every tree is safely contained, superseded, or deliberately abandoned.

---

## 6. Required campaign artifacts

Place all outputs under one directory, not across more overlapping root documents:

`verification/product-truth-20260716/`

Required files:

1. `STATE.md` — the one campaign status and exact next action.
2. `INPUTS.lock` — hashes of controlling directives, candidate SHA, lockfiles, and toolchain.
3. `AUTHORITY_RESOLUTION.md` — controlling vs superseded documents and code owners.
4. `WORKTREE_CENSUS.json` — all registered worktrees and classifications.
5. `DIRECTIVE_COVERAGE_MATRIX.csv` — every binding requirement.
6. `MERGE_PROVENANCE.json` — donor→candidate Git proof.
7. `UNMERGED_DELTA_REPORT.md` — every sealed, dirty, blocked, duplicated, or unknown delta.
8. `CAPABILITY_TRUTH_MATRIX.csv` — exact status vocabulary from §3.
9. `COCKPIT_BINDING_MATRIX.csv` — every page, panel, gauge, control, API, state transition, and receipt.
10. `CLEAN_CLONE_ACCEPTANCE.md` — commands and results from exact frozen SHA.
11. `INDEPENDENT_FINDINGS.json` — Account B findings, severities, evidence, and disposition.
12. `COMPOSED_RUNTIME_RECEIPT.md` — local replay/live-public/fault/restart evidence.
13. `STAGING_OPERATIONAL_RECEIPT.md` — deployment, sentinel, paging, restore, and rollback evidence.
14. `FINAL_VERDICT.md` — precise accepted states and remaining gates.
15. `MANIFEST.sha256` — hashes of all campaign artifacts.

Every receipt must include:

- exact candidate SHA;
- command or operator action;
- environment/toolchain digest;
- dependency lock hash;
- start and end time;
- exit code;
- test count;
- artifact hashes;
- actor role;
- whether the actor had write permission;
- deviations, skips, and unavailable evidence.

---

## 7. Pass 0 — preserve, reconcile, and freeze

Account A must:

1. push the current durable Main state;
2. create or refresh an off-machine Git bundle;
3. generate the full worktree census;
4. seal all legitimate active dirty work or record deliberate abandonment;
5. resolve the P0 contradictions in §2;
6. identify one candidate commit C;
7. record C, Main SHA, source lock hashes, and toolchain versions;
8. prevent any source changes to C;
9. hand only C to Account B.

Gate token:

`BASELINE_TRUTH_ACCEPTED:<candidate-sha>`

This token is forbidden while any P0 item remains `UNKNOWN`.

---

## 8. Pass 1 — directive and mission coverage

This pass detects the failure the owner fears most: a large directive was given, workers ran, and part of it silently disappeared.

Account A and Account B independently extract every binding requirement from every controlling file. They must not share their first-pass matrices. Reconcile the union afterward.

Each row must contain:

`requirement_id, source_file, source_section, authority, owner, implementation_path, test_path, cockpit_surface, runtime_evidence, donor_sha, candidate_sha, status, blocker, disposition`

Each requirement receives one status from §3. `MISSING` and `CONFLICTING` block release. `NOT_CONFIGURED`, `UNWIRED`, and `DEFERRED_OWNER_GATE` may remain only when the mission permits them and the cockpit exposes them honestly.

The matrix must cover at least:

- permanent mission requirements;
- architecture and engine invariants;
- Q and L lane requirements;
- capital, ledger, risk, and execution boundaries;
- I00 assembly requirements;
- IP runtime/control/ops/proof requirements;
- cockpit and no-false-green requirements;
- assurance satellites;
- POST-I00 AI-Ops requirements;
- deployment and recovery requirements;
- owner-gated bring-up requirements.

The authority resolver must mark duplicate or older directives `SUPERSEDED_REFERENCE_ONLY` so they cannot spawn another program.

Gate:

- zero silent omissions;
- zero conflicting authorities;
- every accepted requirement points to source, test, runtime evidence, and merged SHA;
- every intentionally absent capability is visibly absent.

---

## 9. Pass 2 — Git integration and provenance

Verify mechanically, not conversationally:

- every required donor commit exists;
- every accepted donor is in candidate ancestry or has an exact selective-merge receipt;
- every donor’s changed paths fit its exclusive-write grant;
- no protected/shared path was modified without director authorization;
- insertion requests were all dispositioned;
- generated manifests match discovered source;
- no stale receipt names a different candidate SHA;
- no duplicate strategy authority, executor, ledger, risk engine, account-truth store, supervisor, or AI plane exists;
- the ledger compare-and-set and Foundation quantity-bridge contracts have explicit dispositions;
- all AI-Ops ports included in the candidate match their sealed inputs or carry documented integration adaptations;
- A-FORMAL and S2 are either admitted and verified or honestly excluded;
- no Frontier code is counted as accepted unless explicitly authorized and verified.

SLSA describes provenance as verifiable information tracing an artifact through the moving parts that produced it. This pass applies that principle to the project’s worktree and donor graph: <https://slsa.dev/spec/v1.2/provenance>.

Gate:

`PROVENANCE_ACCEPTED:<candidate-sha>`

Zero unexplained edits are allowed.

---

## 10. Pass 3 — clean-clone deterministic acceptance

Run from new clean clones of exact C. Never run the acceptance proof from a dirty integration worktree.

Required classes:

- install strictly from lockfiles;
- build;
- lint and typecheck;
- root deterministic tests;
- Q full suite and protocol conformance;
- L full accumulated suite;
- capital, foundation, risk, and System Integration batteries;
- I00 complete acceptance;
- product assurance/no-false-green inventory;
- browser ship gates in light and dark;
- backup, restore, release switch, and rollback suites;
- restart and reconciliation suites;
- secrets, authority, egress, and network tripwires;
- clean-checkout CI-equivalent workflow.

Run the complete canonical command at least once. Sharded runs provide diagnosis and speed; they do not replace the one complete canonical acceptance command.

NIST’s SSDF recommends integrating secure development practices into the lifecycle to reduce vulnerabilities, mitigate undetected defects, and address root causes rather than repeatedly patching symptoms: <https://csrc.nist.gov/pubs/sp/800/218/final>.

Gate:

`CLEAN_CLONE_ACCEPTED:<candidate-sha>`

Any skip, timeout, test substitution, environment-only waiver, or changed denominator is visible in the receipt and prevents an unconditional green result.

---

## 11. Pass 4 — independent adversarial verification

Account B may fan out read-only verification shards at exact C:

1. **Market truth:** source freshness, temporal coherence, stale/unknown propagation, source disagreement, spot/perp timestamp compatibility.
2. **Quant truth:** leakage, look-ahead, survivorship, calibration, reference-only deep models, abstention, false positives, missed opportunities.
3. **Capital and ledger:** reservations, balances, accounting conservation, CAS behavior, quantity bridge, PnL decomposition, crash consistency.
4. **Execution:** identity, idempotency, ambiguous acknowledgements, partial fills, one-leg exposure, cancels, restart, reconciliation, exchange-twin realism.
5. **Authority:** sole strategy authority, sole executor, sole ledger, sole risk engine, fail-closed kill switch, no bypass routes.
6. **Cockpit:** canonical truth, missing instrumentation, stale states, control effects, no fake green, drill-down evidence.
7. **Security and egress:** secrets, authn/authz, middleware coverage, public/private endpoint classification, dependency/supply-chain posture, network escape.
8. **Operations:** systemd, watchdog, external sentinel, backup, restore, rollback, deploy lock, paging.
9. **AI-Ops:** provider isolation, budgets, prompt/tool injection defenses, capability grants, no self-approval, no live capital/order authority, no silent production patch.
10. **Directive challenge:** search specifically for requirements that the first coverage matrices omitted or falsely marked proved.

Finding severity:

- `CRITICAL` — credible money, authority, signing, secret, reconciliation, or destructive-control failure.
- `HIGH` — release-blocking integrity, missing instrumentation, recovery, provenance, or false-green failure.
- `MEDIUM` — material defect not on a current money/authority path.
- `LOW` — bounded quality or maintainability issue.

Gate:

- zero Critical and High findings;
- no waiver for money paths, retry identity, account truth, reconciliation, signing, secrets, kill switch, deployment rollback, or false green;
- Medium findings require explicit non-money impact and owner disposition;
- B alone issues `VERIFIED_ACCEPTED:<candidate-sha>`.

---

## 12. Pass 5 — cockpit truth, not visual similarity

The website looking mostly unchanged is neither success nor failure. Much of the accepted work is backend, assurance, and validate-only behavior. The real question is whether every displayed thing is bound to canonical truth.

For every page, panel, gauge, table, alarm, and control, record:

- component ID;
- expected backend owner;
- API/event source;
- freshness rule;
- healthy/degraded/stale/missing logic;
- exact `UNKNOWN` behavior;
- permission requirement;
- control validation and safe range;
- request correlation ID;
- resulting state transition;
- ledger/audit event;
- persistence/restart behavior;
- screenshot and network evidence;
- test covering the behavior.

Required cockpit proof:

1. A missing component cannot disappear from the denominator.
2. Process-alive alone cannot render green.
3. Every enabled control changes a real backend state.
4. Every unwired control is disabled and explains why.
5. Every control change is versioned, persisted, and auditable.
6. The five-second safety view exposes active capital, kill state, stale feeds, reconciliation, and attention-required conditions.
7. Detailed pages drill into the same canonical event/trace, not separately calculated copies.
8. Browser tests prove interaction and computed rendering, not only compilation or static screenshots.

OpenTelemetry’s observability guidance explains why logs alone are insufficient and why traces, metrics, and logs must be correlated to answer novel “why is this happening?” questions: <https://opentelemetry.io/docs/concepts/observability-primer/>.

Gate:

`COCKPIT_TRUTH_ACCEPTED:<candidate-sha>`

---

## 13. Pass 6 — composed-runtime and failure proof

Static tests do not prove that the whole system works together. Run the complete candidate from an empty runtime state.

Required modes:

1. deterministic recorded replay;
2. live public-data validate-only mode;
3. shadow intent recording with zero money authority;
4. restart from durable state;
5. host/process failure drills.

Inject at least:

- stale or frozen source;
- spot/perp timestamp skew;
- WebSocket disconnect and message gap;
- REST rate limit and timeout;
- malformed or partial response;
- queue backlog and backpressure;
- clock drift;
- SQLite lock/slow write/partial write;
- disk pressure;
- process kill;
- host reboot;
- tunnel failure;
- telemetry loss;
- external sentinel path while the app and dashboard are dead;
- ambiguous order acknowledgement in the twin/test environment;
- partial fill and one-leg exposure;
- restore and rollback to known-good artifact.

For every drill, prove detection, truthful cockpit state, automated bounded response, alert delivery, durable incident record, and recovery without hidden liability.

Run a minimum 24-hour shadow soak; prefer 72 hours before private/signed promotion. Time-in-operation is evidence and cannot be replaced by more agent tokens.

Gate:

`LOCAL_RUNTIME_ACCEPTED:<candidate-sha>`

---

## 14. Pass 7 — staging release and rollback

Only after the prior gates:

- build and test on the target EC2 environment;
- bind only to the intended loopback port;
- serve through Cloudflare tunnel/Access;
- configure an external sentinel independent of the app;
- configure the owner-selected out-of-band paging destination;
- verify no secrets reach browser, repo, logs, screenshots, or AI contexts;
- prove service restart, host reboot, backup, restore, release switch, rollback, and tunnel outage;
- verify deployed SHA equals verified SHA;
- verify the dashboard and server report that same SHA;
- run a staging soak and game-day drills.

Google SRE’s release guidance emphasizes reproducible builds, automated tests/deployments, small releases, monitoring, rollback, and canary evaluation because tests cannot cover every production condition: <https://sre.google/workbook/canarying-releases/>.

Gate:

`STAGING_OPERATIONAL_ACCEPTED:<deployed-sha>`

---

## 15. Pass 8 — separately authorized exchange bring-up

Each step requires a distinct durable owner authorization. No earlier authorization implies a later one.

1. Rotate every old/exposed development key.
2. Create minimum-scope, IP-restricted read-only credentials.
3. Prove private account, fee, position, collateral, and borrow truth.
4. Reconcile private truth through restart and stream loss.
5. Authorize signed validation/test calls.
6. Authorize test-order lifecycle where supported.
7. Prove order/fill/cancel/reconciliation and failure handling.
8. Authorize $10 canary.
9. Observe and reconcile it completely.
10. Only then consider $50 and $200 as separate gates.

No withdrawals or transfers. No blanket “live enabled” decision.

Gate tokens:

- `PRIVATE_READ_ACCEPTED`;
- `SIGNED_TEST_ACCEPTED`;
- `TEST_ORDER_ACCEPTED`;
- `CANARY_10_ACCEPTED`;
- `CANARY_50_ACCEPTED`;
- `CANARY_200_ACCEPTED`.

---

## 16. Pass 9 — economic edge and learning

This is the mission proof static code cannot provide.

Record forward observations, rejected opportunities, shadow intents, trades, costs, execution shortfall, false positives, misses, and outcomes. Measure:

- conservative expected value versus realized value;
- fees, funding, borrow, spread, slippage, impact, and infrastructure cost;
- calibration;
- false-positive and missed-opportunity rates;
- maximum one-leg duration;
- drawdown;
- regime dependence;
- model and rule version;
- strategy decay;
- operational loss.

The correct day-one result may be `ABSTAIN_UNKNOWN` and `EDGE_NOT_ESTABLISHED`. Profitability is earned by forward evidence, not produced by an audit or a large codebase.

Promotion requires paper/shadow comparison, controlled canaries, meaningful sample size, and repeatable net value. A short winning streak does not establish edge.

---

## 17. What can run immediately using two accounts

Do not wait idly for the active integration lanes.

### Account A now

- generate the 94-worktree census;
- reconcile current Main, hotfix, active-writer, and dirty-tree truth;
- generate donor ancestry/provenance proof;
- extract its independent directive coverage matrix;
- prepare the clean-clone acceptance environment;
- do not touch active dirty work owned by another writer.

### Account B now

- independently extract the directive coverage matrix;
- audit the already landed core read-only;
- prepare adversarial shard prompts;
- prepare a fresh clean-clone verifier environment;
- inspect cockpit binding contracts and expected instrumentation;
- do not read Account A’s reasoning until its first matrix is sealed.

### When the candidate freezes

- A publishes exact SHA and inputs lock;
- B immediately runs Passes 2–5 read-only;
- A waits for findings rather than continuing feature work;
- after rejection, A fixes bounded batches and freezes a new SHA;
- B verifies the new SHA.

With more than two simultaneous chats, fan out Account B’s read-only adversarial shards. Do not create more candidate writers.

---

## 18. Known current holes to carry into the campaign

As of the supplied briefing snapshot, do not lose these:

1. AI-Ops was not on Main.
2. AI-Ops A4, egress patch, and CI hotfix #2 were in flight.
3. The hotfix status and active-writer ledger contained contradictory wording.
4. `STATE.md` was stale despite claiming current-state authority.
5. Exact dispositions were not sighted for ledger CAS and Foundation quantity bridge.
6. A-FORMAL and S2 were not admitted.
7. No deployment existed.
8. No private account truth existed.
9. No signed exchange call or order existed.
10. Paging destination was not selected.
11. Old/exposed keys still required rotation.
12. Capital ladder values and owner signatures remained.
13. Cockpit behavior had not been proved against deployed/private/live state.
14. Learning and edge measurement had no forward runtime evidence.
15. Frontier was optional and parked.

These facts must be re-measured; never copy them forward as current state without Git/runtime proof.

---

## 19. Release blockers and non-blockers

### Release blockers for the validate-only verified candidate

- any unknown worktree;
- unexplained dirty source;
- mandatory sealed-but-unmerged requirement;
- missing/conflicting directive row;
- unexplained Git delta;
- stale candidate SHA in any acceptance receipt;
- red clean-checkout acceptance;
- missing instrumentation that permits false green;
- Critical/High verifier finding;
- unresolved money-path contract;
- unverified AI-Ops integration if AI-Ops is included in candidate.

### Blockers for deployment

- validate-only candidate not independently accepted;
- no rollback/restore proof;
- no external sentinel/paging;
- secrets or egress violations;
- deployed SHA differs from verified SHA;
- cockpit cannot prove canonical truth.

### Blockers for money

- no private account reconciliation;
- no signed/test lifecycle proof;
- recovery/ambiguity not proved;
- no separate owner authorization;
- no hard capital cap;
- no external kill/recovery path;
- any false-green or stale-truth defect.

### Not blockers for the first validate-only deployment

- Frontier;
- additional exchanges;
- deep models that honestly remain reference-only;
- an unproved edge, provided the system remains shadow/abstaining and cannot move money;
- decorative UI expansion.

---

## 20. Final acceptance ladder

The only acceptable sequence is:

`BASELINE_TRUTH_ACCEPTED`

→ `PROVENANCE_ACCEPTED`

→ `CLEAN_CLONE_ACCEPTED`

→ `VERIFIED_ACCEPTED`

→ `COCKPIT_TRUTH_ACCEPTED`

→ `LOCAL_RUNTIME_ACCEPTED`

→ `STAGING_OPERATIONAL_ACCEPTED`

→ `PRIVATE_READ_ACCEPTED`

→ `SIGNED_TEST_ACCEPTED`

→ `TEST_ORDER_ACCEPTED`

→ `CANARY_10_ACCEPTED`

→ later capital rungs

→ `EDGE_ESTABLISHED` only after forward evidence.

An earlier token never implies a later token.

---

## 21. Paste-ready order for the director

```text
Execute INDEPENDENT_PRODUCT_TRUTH_AND_LIVE_READINESS_CAMPAIGN_20260716.md as a verification and release-gating program, not as a third product build.

Do not launch Frontier, another strategy, another dashboard, or another authority. Preserve all active work. Never clean, prune, reset, or delete any worktree. Finish and seal only the already authorized in-flight lanes.

The existing high-context director must not perform the final surgery. Its remaining job is to persist a complete state handoff, current Git SHAs, active-writer ownership, dirty-path inventory, exact next action, and the authority map. Then retire it from final integration and acceptance.

Use two independent accounts/roles:

ACCOUNT A = candidate owner/fix integrator. It is the sole candidate writer. It may assemble and fix, but it may not issue final verification.

ACCOUNT B = independent verifier. It starts from a fresh clean clone/detached worktree at the exact frozen candidate SHA, has no candidate/Main write authority, does not rely on builder-chat reasoning, and may reject but not fix. Only Account B may issue VERIFIED_ACCEPTED.

Start immediately in parallel:

1. A generates the full machine-readable worktree census, resolves the briefing contradictions, proves donor ancestry, seals legitimate dirty work, extracts its directive coverage matrix, and freezes exact candidate C.
2. B independently extracts the directive coverage matrix, audits the landed core read-only, and prepares the clean-clone/adversarial/cockpit/runtime verification shards.

Before C is handed to B, require BASELINE_TRUTH_ACCEPTED with zero UNKNOWN worktrees, exact disposition receipts for ledger CAS and Foundation quantity bridge, reconciled STATE/ledger, and clean durability of every included donor.

After C freezes, B executes provenance, clean-clone full acceptance, independent adversarial shards, cockpit binding proof, and composed-runtime proof against that exact SHA. Shards may run concurrently; one canonical complete acceptance command must also run. A must not mutate C during verification.

If B rejects, A fixes bounded non-overlapping finding groups in isolated worktrees, freezes C+1, and B re-verifies C+1. The fixer never verifies its own fix. Evidence from an older SHA is not reused without byte-identical content proof.

Maintain all campaign outputs only under verification/product-truth-20260716/ with one STATE.md. Do not create overlapping root directives. Report status using the exact vocabulary and gate tokens in the campaign file. Never say done without SHA, receipt, command, environment, and status.

Do not deploy or connect private keys during this campaign unless separately owner-authorized. Do not place any order. After VERIFIED_ACCEPTED, proceed only through staging, external sentinel/paging, restore/rollback drills, private-read gate, signed-test gate, test-order gate, and separately authorized canary ladder.

Stop only at a precise gate token or a precise BLOCKED report containing the exact missing evidence and safest next action.
```

---

## 22. Owner actions that can proceed in parallel

These do not require waiting for code verification:

1. choose the out-of-band paging destination;
2. rotate old Alchemy and any exposed Binance credentials;
3. define capital ladder values, beginning with a hard $10 ceiling;
4. sign or reject the AI-Ops reliability targets and runbooks;
5. decide whether A-FORMAL and S2 should be admitted now;
6. schedule the staging game-day;
7. keep Frontier unauthorized until the existing product is verified and deployed;
8. authorize continuous forward data capture if storage, retention, and privacy boundaries are acceptable.

---

## 23. Closing law

The way to supervise a half-million-line system is not for one director to remember every line. It is to make omissions, unexplained changes, stale evidence, missing instrumentation, and unsafe authority mechanically impossible to hide.

Use compute for independent evidence, not more volume.

The product is ready to advance when one exact artifact can be traced to its requirements, source, tests, runtime behavior, cockpit truth, deployment, recovery, and economic result. Until then, honest `UNWIRED`, `NOT_CONFIGURED`, and `EDGE_NOT_ESTABLISHED` states are signs of discipline, not failure.
