# QUANT EDGE RESEARCH FACTORY — durable build state

State generation: `6`

Updated: 2026-07-12T11:42:57+0530

Status: `ACCEPTED`
Program: Q lane — deterministic research evidence, labels, models, calibration, drift and advisory inference.

## Frozen launch identity

- Worktree: `/Users/cosmosgeek/Desktop/quant-edge-research-20260712`
- Branch: `quant-edge-research-factory-20260712`
- Current HEAD at generation-6 authoring: `73330e281c7a91fa5fba2059570e9619f9ade34d`
- Origin: `git@github.com:cosmosgeek0/arbitrage-cosmos.git`
- Canonical base: `7010499170e24b31c9c0be2c9d73a536e680c6fe`
- Protocol SHA / current parent: `73e1a1ff7daa48df8dac45713fc5f106842edafc`
- Mission: `MISSION.md`; blob `239f0f938360e73e5b30d385acbf77b5d1a9a364`; SHA-256 `95e152d76844aa391b7a28bd45548d7fe58f83ed1ced558dbdbeb01797436362`
- Authority: `ARCHITECTURE.md` Part II; blob `93d7604599b43109eb67433e85101009c3f82b8e`; SHA-256 `beb8be8baefe2faa78356e2dc44983735b855535c21cd5f0172a8e1e3fa665db`
- Protocol document: blob `d0dd07ac9c46b81c4c87785e9ad60171543da249`; SHA-256 `951fdbb5f347f900c61e60055f90cf2e1e1e743b75b7dc733652acb8d43353a1`
- Protocol schema: blob `a23c5796e73e142c83bbea98276bd237be300ef7`; SHA-256 `229af0ff13d600c7d305c6deb7f57b61bdb6f8a35f6f2349d91f5ab1b4972f1c`
- Q directive: blob `eebe7b0c751c065e06d0bf817b86c144541adff3`; SHA-256 `198f131d4b04c1edab728b85ea6a5e5c5f7f80875866e407a3c93a24aafa5ab4`
- Launch directive: blob `587c1b83e8f9d32b9097d88df7fea40d9829b68e`; SHA-256 `26b1d5ce118982b4b3ba64b44b7fb3e88b0b7ded26a818a775a65bffaa0f2c06`, bound by D-LAUNCH-1.
- Frozen input lock: blob `cf414da3b46d46d1807f4c04939c7ee1121f5895`; SHA-256 `410010ef635a5e44b205e56c6b38f2d06e5b8e72312f5d63edcb24a5086355e1`

## Phase position

- Last accepted phase: `Q01`
- Latest director acceptance: `D-LAUNCH-1`, commit `9ca01537f4edda06ee566cd261e612d5c315fb76`; authentic launch blob/digest binding independently verified.
- Current phase: `Q01 ACCEPTED`; next phase `Q02 NOT_STARTED`.
- Latest completed task: `quant/TASKS/Q01.md`
- Latest completed task SHA-256: `8c830de5b97673dc6593bb29adcedaa26542d9c2060ceaa4d7ba8e4dde2c22ee`
- Checkpoint receipt: `quant/RECEIPTS/Q00.md`; blob `7ba41768ba747bbc3eddd1941f6f5d82985dc1ca`; SHA-256 `738dad4caac7cfac9ba8b7b84fb646ec1817c6f0eb34fc09daa60129ab1996c3`; immutable in checkpoint commit.
- Acceptance receipt: `quant/RECEIPTS/Q00_ACCEPTANCE.md`; SHA-256 `c29c7646af5f284a88eca782beb7dbf636e6c6eb11dda25d1bccc03ea97385de`; immutable after this acceptance commit.
- Q00 checkpoint implementation commit: `fa6fecd8295aaab6aa38d35bd34843b64af69e69`.
- Q00 checkpoint-state commit: `1dca8ce3022472488117cc9eab0f2f5b37905aac`.
- Q00 acceptance/state commit: `a7606b49d26cfc9aeec4e8a4166219885a0d19e5`.
- Q01 activation/state commit: `90e1ef89edd4cc449664ac05cb429448e0bac6f0`.
- Q01 implementation receipt: `quant/RECEIPTS/Q01.md`; SHA-256 `254b638eaa00b3f2ea06f12a3c5b460ac330c0ca5e48236042ea97ddb543114e`; immutable in C.
- Q01 implementation commit C: `73330e281c7a91fa5fba2059570e9619f9ade34d`; exact parent `90e1ef89edd4cc449664ac05cb429448e0bac6f0`.
- Q01 acceptance receipt: `quant/RECEIPTS/Q01_ACCEPTANCE.md`; SHA-256 `368daeccd6b43f28bfc41110f1dc85b8037f1c7eac81e3539a5e2bea893bd4b2`.
- Q01 acceptance/state commit A: the commit containing this generation-6 state; intentionally non-self-referential.
- Acceptance state: Q00 `ACCEPTED`; Q01 `ACCEPTED`; Q02 `NOT_STARTED` with no task file.

## Ownership and safety

- Exclusive write path: `quant/**` only.
- Frozen inside that path: `quant/DIRECTIVE_INPUTS.lock`.
- Read-only: root docs/directives, protocol files, existing source/tests, Main, L worktree, shared package/config/composition paths.
- No push/merge; no secrets/env reads; no private/signed endpoints; no money/order/capital/risk authority; no withdrawal/transfer code.
- Production public acquisition, strategy, focus, capital, risk, execution, ledger, control and supervisor owners remain unchanged.

## Q00 changed-file inventory

- `quant/QUANT_EDGE_BUILD_STATE.md`
- `quant/TASKS/Q00.md`
- `quant/RECEIPTS/Q00.md`
- `quant/DECISIONS/Q00-001-DURABLE-PATHS.md`
- `quant/DECISIONS/Q00-002-LAUNCH-HASH-GATE.md`
- `quant/DECISIONS/Q00-003-D-LAUNCH-1.md`
- `quant/RECEIPTS/Q00_ACCEPTANCE.md`
- `quant/docs/Q00_ACTUAL_SOURCE_REUSE_MATRIX.md`
- `quant/docs/Q00_BENCHMARK_PROFILE.md`
- `quant/docs/Q00_SOURCE_RESEARCH.md`
- `quant/scripts/check-scope.sh`
- `quant/tests/q00/scope_guard.test.sh`
- `quant/TASKS/Q01.md`

## Q01 changed-file inventory

- Workspace: `.gitignore`, `.python-version`, `README.md`, `pyproject.toml`, `uv.lock`.
- Decision/research: `DECISIONS/Q01-001-LOCKED-RESEARCH-WORKSPACE.md`, `docs/Q01_FRAMEWORK_ADOPTION.md`, `docs/Q01_DEPENDENCY_SECURITY_LICENSE.md`.
- Portfolio/evidence: `EDGE_HYPOTHESIS_MAP.md`, `registry/edge_hypotheses.v1.json`, `fixtures/deterministic_seed_v1.json`, two `generated/q01/*.json` dependency evidence files.
- Package: ten `src/quant_edge/*.py` modules.
- Tests: three `tests/contract/*.py` and four `tests/unit/*.py` files.
- Durable completion: `RECEIPTS/Q01.md`, `RECEIPTS/Q01_ACCEPTANCE.md` and this state.

Implementation commit C therefore has 32 changed paths, all under `quant/**`. The two root directives remain preserved untracked owner inputs and are never staged.

## Q-lane posture map

- `LIVE`: none. Q has no production integration, listener, data producer, model or authority.
- `SHADOW`: none. No Q assessment service or champion/challenger is running.
- `SYNTHETIC`: frozen protocol fixtures, existing product fixtures and Q01 deterministic config/RNG fixtures only; contract evidence, never market claims.
- `RESEARCH`: locked offline package and eight-family hypothesis falsification portfolio; this status is not edge evidence.
- `UNAVAILABLE`: historical lake, point-in-time master, Event Atlas, owner annotations, feature/label/model registries, trained/calibrated models, drift service and inference.
- Money/order/capital/risk authority: `NONE` in every posture.

## Framework and source decisions

- Python/toolchain: CPython `3.13.14`, `uv/uv-build 0.11.28`; `uv.lock` SHA-256 `3449f6eb892e2e5dd27dd48a735f9fe30d1ddfb38f16d858bba60202f5f4ed81`, 51 entries.
- Immediate runtime frameworks: Polars `1.42.1`, PyArrow `25.0.0`, DuckDB `1.5.4`; modeling/registry/sequence candidates remain deferred or reference/rejected exactly as `docs/Q01_FRAMEWORK_ADOPTION.md` records.
- Framework/paper cards: 24 explicit framework cards plus all 15 required primary-paper implement/test/ablate decisions, with no measured economic claim.
- Binance public archive: `ADAPT` for checksum/revision-manifested coarse history; raw-data redistribution permission unresolved.
- Canonical runtime capture: `ADAPT` for forward high-fidelity atlas through a future append-only bridge; Q owns no production socket.
- Full L2 inferred from candles/coarse archive: `REJECT`.
- External venue/context feeds: `REFERENCE_ONLY` until a source card passes launch Section 6 admission gates.
- Exit-liquidity heuristics: challengers only; no `P(bait)` semantics without target/calibration proof.

## Dataset, registry and evidence state

- Dataset versions: none. No external data entered the repository.
- Coverage: no retained historical/Q dataset; no point-in-time master; no current Q event trace.
- Event Atlas: absent; two-tier build routed to Q03–Q05.
- Hypothesis registry: `edge-hypotheses-2026-07-12-v2`; 8 families (`DATA_INSUFFICIENT=5`, `RESEARCH=2`, `UNTESTED=1`), exact deterministic Markdown projection; no `SHADOW`.
- Feature registry: none. Label registry: none. Model registry: none. Calibration: none.
- Owner annotations: absent; separate immutable weak-supervision channel routed to Q02/Q05.
- Frozen protocol fixtures and product test fixtures are `SYNTHETIC_ONLY`, never research evidence.
- Dependency evidence: 49-package durable vulnerability/license inventories; zero indexed vulnerabilities/unknown license fields observed on 2026-07-12, subject to time-varying scanner/legal limits.

## Tests and measurements

- `node packages/edge-protocol-tests/protocol.test.mjs`: exit 0, `22/22`.
- `npm test`: exit 0; typecheck/build and deterministic baseline green (`377` underlying checks).
- `npm run test:all`: exit 0; full repository battery green.
- Launch counters: existing 377; gates 72; intelligence 152; runtime 394; capital 433; foundation 871; integration scenarios 30; protocol 22.
- `bash quant/tests/q00/scope_guard.test.sh`: exit 0, `6/6`, including reverted out-of-scope commit history.
- Q00 checkpoint staged `bash quant/scripts/check-scope.sh`: exit 0, exact branch/protocol, `10` allowed paths.
- Q00 acceptance staged `bash quant/scripts/check-scope.sh`: exit 0, exact branch/protocol, `3` allowed paths.
- Q01 clean disposable environment: CPython `3.13.14`; 50 installed packages plus local project from locked 51-entry resolution; exact framework/package imports pass.
- Q01 lint/format: Ruff exit 0, 17 files formatted. Strict mypy: exit 0, 17 source files.
- Q01 focused suite: exit 0, `88 passed`; branch coverage `96.71%` against required `95%`.
- Q01 seed fixture: separate `PYTHONHASHSEED=1/987654` processes byte-identical, SHA-256 `b01207e33339c44e15500091ea52a019a2983a69b3702da46f87f9a04804cd05`.
- Q01 registry: exit 0, mandatory H1–H6 semantics preserved, all substantive Markdown drift fails.
- Q01 frozen protocol verifier: artifact/output identities bound, public runner override absent, `22/22`, output SHA-256 `6591ec8e208d1c17f43c99522660d8d7f1d039347a3ea7b0aecd986e6b0c8d54`.
- Q01 dependency audit/license: 49 packages, zero indexed vulnerabilities, zero unknown license fields; durable normalized evidence committed.
- Accumulated Q00 scope suite: `6/6`; `npm test`: exit 0. Q00 accepted full `npm run test:all` remains broad baseline because Q01 changes no shared path.
- Q01 adversarial review: initial no-seal findings corrected; final independent `SEAL`, no P0–P3 findings.
- Q01 final implementation scope gate: `Q_SCOPE_OK`, exactly 32 staged paths; C `73330e281c7a91fa5fba2059570e9619f9ade34d` created.
- Independent C verification: exact parent/ancestry, 32 allowed paths, empty frozen diff, artifact/task/receipt hashes and `git diff-tree --check` all pass.
- Archive-derived C environment: clean locked install, imports, Ruff, strict mypy, `88` tests, `96.71%` coverage, registry, seed and protocol `22/22` all pass; archive SHA-256 `c4e53bd84e1cb928791e23c5db600d2b008db03326ca2c767bb7de0578db42b0`.
- `git diff --cached --check`: exit 0.
- Independent verification of `fa6fecd`: exact 10-path `quant/**` history, empty frozen diff, range `git diff --check` exit 0, scope suite `6/6`, protocol `22/22`.
- Host: Apple M4 Max, 16 cores, 48 GB; Node `v22.23.1`; npm `10.9.8`.
- Current Q performance/inference measurements: none. Historical receipt and synthetic capacity facts remain separately labeled in `quant/docs/Q00_BENCHMARK_PROFILE.md`.

## Known defects and blockers

- Resolved: D-LAUNCH-1 binds launch blob `587c1b83…` to SHA-256 `26b1d5ce…0f2c06`; the stale `0cc192e3…` measurement no longer blocks. The Q worktree's frozen lock remains byte-unchanged; see decisions Q00-002 and Q00-003.
- Resolved before Q01 seal: mandatory hypothesis numbering, substantive Markdown drift, arbitrary-runner protocol false green, unbounded/malformed Unicode input, compact framework-card gaps and ephemeral-only scanner detail.
- Q01 exact-commit verification completed and acceptance conditions passed; no Q01 blocker remains.
- No canonical forward runtime-to-Q append-only bridge exists; this is a later integration seam, not permission for a Q socket.
- Free history cannot prove full L2, receive latency, borrow truth or causal intent.
- Current official liquidation selection wording conflicts; preserve sampled/unknown semantics.
- Numeric Q inference SLOs are unknown until measured on the Q01 lock; only provisional resource/queue budgets exist.

## Exact next task

1. Verify the acceptance commit containing this generation is a direct child of C, changes only this state plus `quant/RECEIPTS/Q01_ACCEPTANCE.md`, and leaves frozen paths unchanged.
2. For continued work, verify this state, C, A and both Q01 receipts; do not repeat Q00/Q01 research, implementation or tests except accumulated gates.
3. Create one bounded `quant/TASKS/Q02.md` from directive Q02 only, record its hash in generation 7 and activate Q02 in a separate commit.
4. Execute Q02 only after that activation; no Event Atlas or Q03 work during Q02.

Next exact command:

```bash
git rev-parse HEAD && git diff-tree --no-commit-id --name-status -r HEAD && shasum -a 256 quant/QUANT_EDGE_BUILD_STATE.md quant/RECEIPTS/Q01_ACCEPTANCE.md
```

## Fresh-session read order

1. `STATE.md`, `MISSION.md`, `ARCHITECTURE.md` Part II, `DIRECTOR.md`.
2. `QUANT_EDGE_RESEARCH_FACTORY_12H.md` and only launch Section 6.
3. `EDGE_PROTOCOL_V1.md`, frozen schema/fixtures, and `quant/DIRECTIVE_INPUTS.lock`.
4. This state, `quant/TASKS/Q01.md`, both Q01 receipts, `quant/RECEIPTS/Q00_ACCEPTANCE.md`, and Q00-003.
5. Q00 reuse matrix, benchmark profile and source research only as inputs; do not redo them. If C exists, verify the exact commit rather than rebuilding it.

## Work not to repeat

- Do not redo the Q00 source/reuse audit while its recorded source hashes are unchanged.
- Do not modify or replace either immutable Q00 receipt.
- Do not recreate or edit `quant/TASKS/Q00.md`; Q01 is the only current phase.
- Do not recreate retired paths or old authority files.
- Do not materialize the Event Atlas or create a production source during Q01.
- Do not edit or normalize the two untracked owner directives.
- Do not rewrite the immutable Q01 receipt after implementation commit C.
- Do not rerun or rewrite accepted Q01; the next bounded phase is Q02.
