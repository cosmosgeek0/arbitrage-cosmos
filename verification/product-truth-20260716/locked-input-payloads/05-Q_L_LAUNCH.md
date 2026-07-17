# DIRECTOR Q/L TWO-LANE LAUNCH

**Purpose:** orchestration handoff for the real Fable 5 director.

**This is not a third product build, strategy, engine, authority, or competing directive.** It only tells the director how to launch, supervise, checkpoint, integrate, and accept the two supplied implementation lanes from the current clean consolidated repository.

## 0. Supplied implementation directives

The director receives exactly these two build directives:

1. `QUANT_EDGE_RESEARCH_FACTORY_12H.md`
   - role: evidence, labels, features, hypotheses, models, calibration, falsification, drift, advisory inference;
   - MD5: `63ca3f39e3d3aeee2cce5e71c1978a9c`;
   - SHA-256: `198f131d4b04c1edab728b85ea6a5e5c5f7f80875866e407a3c93a24aafa5ab4`.
2. `LIVE_EXECUTION_REALISM_CONTROL_PROOF_12H.md`
   - role: exchange truth, execution realism, two-leg coordination, recovery, controls, cockpit, deployment proof;
   - MD5: `7ef86a5d1078c664a66ba9720a6e38d6`;
   - SHA-256: `40de1feb6678d8741bd38f7538b2c6f25304c0f64195a596961bdf2539a3b037`.

Recompute both hashes after receiving the files. Stop if either differs.

`DIRECTOR_VERDICT_GAP_AUDIT.md` is **not** a controlling input and is not required for execution. Its useful, corrected additions are incorporated below. Do not give that audit to the Codex builders as a third directive.

## 1. Starting-state assumption and verification

The owner reports that the director has already:

- consolidated prior branches;
- removed stale/junk directives and obsolete artifacts;
- integrated the earlier convergence, foundation, intelligence-runtime and live-product work;
- run the relevant verification;
- committed and pushed the accepted state to GitHub;
- restored a clean canonical Main.

Treat this as a claim to verify, not a reason to repeat the old work.

Before spawning builders, record in `QL_DIRECTOR_STATE.md`:

```text
canonical repository absolute path
canonical branch
canonical HEAD SHA
origin tracking SHA
git status --short
accepted authority-map file and hash
accepted mission file and hash
current build command and result
current complete test commands and results
current engine/runtime/control/deployment capabilities
current LIVE / SHADOW / VALIDATE_ONLY / SYNTHETIC / UNWIRED / MISSING map
Q directive hash
L directive hash
director launch-file hash
```

If Main is dirty only because the three supplied handoff documents are untracked, preserve them unchanged and explicitly exempt only those documents. Do not stash, delete, overwrite, or absorb unrelated owner changes.

Do not redo completed convergence or create another broad audit. Map actual source, freeze the base, and begin implementation.

## 2. Authority order

Use this precedence:

1. current accepted `MISSION.md` and explicit owner safety boundaries;
2. current accepted System/Live Product Authority Maps;
3. canonical source and tests at the verified base SHA;
4. this launch file for orchestration only;
5. Q directive inside the Q worktree;
6. L directive inside the L worktree;
7. bounded phase briefs created by the director.

No builder may create a second owner for:

- public market ingestion;
- Basis or Volume strategy/proposal authority;
- Capital or Risk;
- ledger/journal truth;
- order/execution authority;
- control commands;
- private account truth;
- deployment/process authority.

When a lane needs one of these, it must consume or extend the canonical owner through a narrow typed adapter. Semantic overlap is resolved during integration; duplicate permanent types are not retained merely because both branches compile.

## 3. Freeze one integration protocol before parallel work

The director—not either Codex lane—must inspect the accepted source and create or reuse one small protocol/interchange commit containing only the minimal shared types required by both lanes.

The protocol must map to existing canonical concepts rather than redefine them. At minimum map:

- instrument identity and Spot/USD-M/Margin relationships;
- timestamps, freshness, completeness, source lineage and unknown states;
- evidence/assessment interchange;
- proposal identity without proposal authority;
- outcome feedback projection without ledger authority;
- component health/status vocabulary;
- failure/reason identifiers;
- compatibility/version handling.

Record `PROTOCOL_SHA`. Both worktrees must descend from exactly:

```text
CANONICAL_BASE_SHA + accepted protocol commit
```

No lane may later edit the shared protocol unilaterally. It submits a protocol-change request to the director.

## 4. Create two isolated worktrees and two Codex leads

Create two isolated worktrees/feature branches from the same `PROTOCOL_SHA`:

```text
Q worktree -> quant-edge-research-factory-<timestamp>
L worktree -> live-execution-control-proof-<timestamp>
```

Main remains director-owned and receives no parallel implementation edits.

Launch:

- one Codex 5.6 Sol/Max/Ultra lead in the Q worktree with the Q directive;
- one Codex 5.6 Sol/Max/Ultra lead in the L worktree with the L directive.

Each Codex lead may use internal workers only for exclusive subdirectories. The lead owns continuity, integration inside its lane, accumulated tests and receipts.

Do not give one Codex both lanes. Do not allow both Codex sessions to write to the same worktree. Do not let Fable personally create a third implementation.

## 5. Compaction-proof execution law

The two directives are multi-phase programs. A model context window is not project memory.

For each lane, the director must require:

```text
<lane>/STATE.md
<lane>/TASKS/<phase-id>.md
<lane>/RECEIPTS/<phase-id>.md
<lane>/DECISIONS/<decision-id>.md
```

Every `STATE.md` must contain:

```text
directive hash
mission/authority/base/protocol hashes and SHAs
worktree and branch
current HEAD
accepted phases and acceptance commits
current phase and exact bounded task
exclusive paths
changed files
commands and measured results
known failures or limitations
blocked items
next exact task
LIVE / SHADOW / SYNTHETIC / UNAVAILABLE status
```

One Codex turn receives only one bounded phase brief. A phase is accepted only after:

1. actual implementation;
2. focused tests;
3. accumulated lane tests;
4. adversarial review;
5. correction of review findings;
6. implementation commit;
7. immutable receipt containing measured evidence;
8. director acceptance commit/update.

At context compaction, rate-limit stop, crash, or handoff, the next session reads only the frozen directive, current `STATE.md`, exact phase task, accepted receipts and relevant source. It must not reconstruct history from chat.

Use this resume instruction:

```text
Resume this lane from its durable state, not from conversation memory. Verify directive, mission, authority, base, protocol, state and current-task hashes; verify Git ancestry and accepted phase commits. Execute only the recorded current phase. Do not repeat accepted work, broaden scope, create duplicate authorities or return a planning-only response. Implement, test, review, commit, write the receipt and update durable state. If capacity ends, leave a truthful PARTIAL or BLOCKED checkpoint with the next exact task.
```

## 6. Q-lane amendments and priorities

The Q directive remains controlling. The following are clarifications/priorities within its existing phases, not a new Q program.

### Q-A. Materialize the Event Atlas early

During Q03–Q05, materialize a versioned `EventAtlas`, split into two evidence tiers:

1. **Historical coarse atlas** from checksum-verified, point-in-time available public data.
2. **Forward high-fidelity atlas** from the canonical runtime's trades, book ticker, sequenced depth, funding, OI, liquidations, receive clocks and gap evidence.

The atlas must detect and retain data-supported candidate events such as:

- dormant-to-active transitions;
- rapid volume/trade-intensity changes;
- Spot/perpetual divergence and basis blowouts;
- funding-cap/frequency regime transitions where verified;
- continuation, exhaustion, fade and disorder;
- quiet controls, rejected candidates and missed events.

Thresholds are versioned discovery rules, not definitions of truth. Start with multiple volatility/liquidity-relative and absolute discovery thresholds; do not hard-code only `25%/24h`.

Every event stores pre-event windows, event evolution, later outcomes, data quality, source coverage, point-in-time instrument identity and applicable economics. Receipt must report event counts, symbol/product/date coverage, gaps, label distribution, controls and known missing evidence.

Never claim the free archive contains every trap or reconstructs unavailable L2, borrow, latency or causal intent.

### Q-B. Maintain a versioned Edge/Hypothesis Map

Create one `EDGE_HYPOTHESIS_MAP.md` and machine-readable registry. It is a research portfolio, not a declaration that edge exists.

Candidate families may include:

- executable normal Basis convergence;
- reverse Basis where borrow/liability truth exists;
- violent small-cap Spot/perpetual dislocations;
- funding-cap/frequency transition regimes;
- dormant-to-active early transition;
- continuation versus exhaustion/exit-liquidity risk;
- cross-venue leadership/funding differences;
- listing, unlock, announcement and on-chain context.

For every family record:

```text
hypothesis and null
economic mechanism
required sources
coverage and missingness
gross opportunity definition
fees/funding/borrow/slippage/latency/recovery floor
capacity and crowding assumptions
primary metric and controls
multiple-testing family
minimum effective evidence across time/regimes
promotion criterion
continuation criterion
kill/retirement criterion
current status: UNTESTED / DATA_INSUFFICIENT / RESEARCH / SHADOW / REJECTED
```

BROCCOLI/MYX-like events are case-study seeds, not evidence of a durable pond. BTC/ETH or any other family is rejected only by measured net evidence, not a narrative.

### Q-C. External evidence priority without source chaos

The Q file already covers announcements, unlocks, on-chain context and cross-venue evidence. Move only narrow forward-capture experiments earlier when the source card proves:

- official/licensed access;
- stable identity mapping;
- timestamp/sequence semantics;
- retention permission;
- resource/rate budget;
- explicit hypothesis value;
- canonical producer ownership;
- observable failure state.

Do not create multiple unowned socket managers. Cross-venue recording is evidence-only until separately integrated and accepted. Do not call Granger leadership tradable alpha without cost/latency validation.

### Q-D. Exit-liquidity risk remains a calibrated research target

Use existing H5. Additional trade-size clustering, round-number or self-similarity features are challengers only. Do not call an output `P(bait)` unless a reproducible target and calibration justify probability semantics. Benford-like diagnostics must survive tick/lot/filter controls before adoption.

### Q-E. Owner annotation is separate weak supervision

Add an immutable owner-annotation channel for selected acted, rejected and missed events. It must record:

- evidence visible when tagged;
- whether the outcome was hidden or already known;
- timestamp and annotation schema version;
- tags such as plausible precursor, obvious trap, too late, insufficient evidence;
- later objective outcome linkage.

Prefer blinded or pre-outcome tagging. Owner annotations never overwrite objective labels, never directly authorize orders/capital and must prove out-of-sample incremental value before model use.

## 7. L-lane amendments and priorities

The L directive remains controlling. The following are clarifications/priorities within its existing phases.

### L-A. Capital–Evidence Ladder after the fixed tiny-live envelope

The existing 10-USDT canary remains unchanged. Build a versioned policy seam for later owner-approved rungs, but do not automatically increase capital during this lane.

Each future promotion must require evidence appropriate to that rung:

- operational correctness: acknowledgements, fills, reconciliation, restart, recovery;
- execution calibration: predicted versus realized fees, slippage, latency and adverse selection;
- effective sample size across independent events, symbols, time and regimes;
- clustered/block-bootstrap uncertainty rather than an IID trade-count shortcut;
- live-versus-shadow divergence bounds;
- drawdown, tail-loss and failure/recovery distributions;
- model calibration and abstention behavior;
- strategy-specific capacity/liquidity limits;
- explicit owner authorization and rollback/demotion state.

Do not encode `170 trades`, a fixed calendar duration, a fixed dollar ladder, automatic Kelly sizing, or profit targets as universal truth. Capital/Risk remains the sole authority; Q supplies evidence only.

### L-B. Empirical region and full-chain latency benchmark

Before final deployment acceptance, identify the current AWS region and measure:

```text
exchange event -> local receive
receive -> evidence/features
features -> decision/proposal
approval -> durable intent
intent -> network submission
submission -> acknowledgement
acknowledgement -> private-stream confirmation
```

Benchmark feasible candidate regions with repeated distributions, disconnect behavior, rate limits, stable outbound identity, cost and operational constraints. Do not assume Binance matching location or hard-code Tokyo. Move regions only through a reviewed deployment decision with rollback proof.

### L-C. Market-regime posture through existing authority

Expose the Q-lane's calibrated regime assessment as a versioned advisory input. Existing strategy, Capital and Risk policies may translate it into owner-bounded family caps or disablement states.

Required states include `UNKNOWN`; stale, unsupported or disagreeing regime models fail to conservative posture. Display posture, evidence, freshness and resulting caps in the existing machine graph. Do not create a second regime supervisor or let a model bypass Capital/Risk.

### L-D. Immediate recording uses the canonical runtime

The Q directive already requires immediate forward Spot/USD-M evidence retention. L must expose the canonical runtime bridge, gaps, quotas, storage pressure and health without opening duplicate production feeds. Recording failure must degrade research truth and appear in the cockpit; it must not block money-critical reconciliation/recovery.

## 8. Time and capacity instruction

The remaining initial Codex window may be approximately one hour. Do not respond by superficially touching every Q00–Q17/L00–L17 phase.

Use the hour to complete the largest number of **fully accepted early phases** in parallel:

- Q: launch gate/reuse map, package/determinism, lake/manifests, then Event Atlas bootstrap as capacity permits;
- L: launch gate/reuse map, protocol compatibility, current source matrix, then signed kernel/filter/private-truth work as capacity permits.

When the limit approaches, both lanes must commit clean checkpoints and exact resumes. After reset, continue from receipts without re-auditing or re-planning.

`12H` means a sustained work tranche, not guaranteed completion in one model context. The director must report `PARTIAL`, `LANE_READY`, or `INTEGRATED_ACCEPTED` truthfully.

## 9. Director integration order

When a lane reaches its full acceptance gate:

1. freeze its accepted HEAD and final receipt;
2. verify changed-path scope and authority compliance;
3. integrate/adapt Q first onto a fresh integration branch from canonical Main;
4. run existing plus Q tests;
5. integrate/adapt L second;
6. resolve duplicated semantics through canonical adapters;
7. run existing, Q, L, security, build, runtime, browser/cockpit and fault gates;
8. execute the director-owned I00 combined acceptance;
9. update concise canonical project state and capability map;
10. commit and push only verified integration;
11. preserve original lane SHAs and receipts for recovery.

Do not mechanically merge the old foundation branch wholesale if the current Main already contains newer audited equivalents. Reuse/adapt phase commits against current authority.

## 10. External-action boundary

Code, deterministic fixtures, local simulations and public read-only research are permitted within the directives.

The following require separate explicit durable owner authorization and must not be inferred from this launch:

- private account reads if not already authorized;
- signed Binance test-order calls;
- AWS/Cloudflare/Secrets Manager mutations;
- deployment or process restart;
- Margin borrow/repay test calls;
- any real order;
- any capital increase;
- any repeated automated live entry.

Implement and test the boundaries without performing unauthorized external actions.

## 11. What completion actually means

Full `INTEGRATED_ACCEPTED` completion means the repository contains one coherent system that can:

- capture and replay granular evidence;
- construct point-in-time events, controls, features and outcomes;
- test and reject edge hypotheses honestly;
- produce calibrated advisory assessments with abstention;
- consume existing Basis/Volume proposals through canonical Capital/Risk;
- validate and coordinate Spot/USD-M/Margin actions;
- reconcile fills, liabilities and ambiguous outcomes;
- survive restart and recover failed/partial legs;
- expose the machine graph, reasons, freshness, controls and positions in the existing website;
- deploy reproducibly after authorization;
- retain evidence for continued research and drift detection.

It does **not** mean profitable edge is already proved. After construction and integration, the next work is bring-up and evidence generation:

1. run locally against public/live-read data;
2. populate the atlas and verify cockpit truth;
3. train/evaluate/shadow calibrated candidates;
4. complete authorized signed validation;
5. deploy and observe restart/degradation behavior;
6. only then perform the separately authorized tiny-live canary;
7. promote or kill hypotheses from measured outcomes.

This should be the last major disconnected-organ build. After accepted integration, work should shift to running, measuring, repairing, calibrating and selectively extending the coherent product rather than launching more broad skeleton programs.

## 12. Exact prompt for the real Fable director

```text
You are the sole integration director for the current clean, committed and pushed current-main.

Read DIRECTOR_Q_L_TWO_LANE_LAUNCH.md, QUANT_EDGE_RESEARCH_FACTORY_12H.md and LIVE_EXECUTION_REALISM_CONTROL_PROOF_12H.md completely. The launch file is orchestration only; Q and L are the two implementation lanes. DIRECTOR_VERDICT_GAP_AUDIT.md is not a controlling input and must not become a third build program.

Verify the actual canonical repository, current HEAD/origin, clean-tree state, mission, authority maps, build/tests and current LIVE/SHADOW/SYNTHETIC/UNWIRED capability map. Do not repeat completed convergence, foundation, runtime or live-product work. Freeze one minimal director-owned protocol/interchange commit after mapping existing canonical contracts.

From that exact protocol SHA create two isolated worktrees and launch two Codex 5.6 Sol/Max/Ultra leads concurrently:

- Q lead executes QUANT_EDGE_RESEARCH_FACTORY_12H.md plus only Section 6 of the launch file.
- L lead executes LIVE_EXECUTION_REALISM_CONTROL_PROOF_12H.md plus only Section 7 of the launch file.

Main remains director-owned. No duplicate engines, feeds, strategy/proposal authority, Capital, Risk, ledger/journal, control or execution authority. Give each Codex only one bounded phase at a time and require hashed durable state, implementation commit, tests, adversarial review, immutable receipt and director acceptance so compaction or rate limits cannot erase progress.

There may be only about one hour before the first usage reset. Start implementation immediately. Complete fully accepted phases rather than superficial breadth, then leave clean resumable checkpoints and continue after reset without re-auditing. Do not ask routine questions.

When the lanes finish, integrate/adapt Q first and L second onto a fresh branch from the current canonical Main, run the full combined I00 acceptance, update the canonical capability/state map, commit and push verified work. Do not perform private reads, signed test orders, AWS mutations, deployment, process restarts, Margin actions, real orders or capital changes without their separate explicit owner authorizations.

Return immediately with the verified canonical SHA, protocol SHA, two worktree paths/branches, initial phase assignments and confirmation that both Codex leads are actively implementing—not a planning-only response.
```

