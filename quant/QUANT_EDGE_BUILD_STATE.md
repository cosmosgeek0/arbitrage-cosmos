# QUANT EDGE RESEARCH FACTORY — durable build state

State generation: `30`

Updated: 2026-07-13T03:42:03+0530

Status: `Q12 ACTIVE` (director-accepted Q11 and Q14 are merged on the spine; D-LAUNCH-2/5 authorizes exactly one self-accepted Q12 loop, then park)
Program: Q lane — deterministic research evidence, labels, models, calibration, drift and advisory inference.

## Frozen launch identity

- Worktree: `/Users/cosmosgeek/Desktop/quant-edge-research-20260712`
- Branch: `quant-edge-research-factory-20260712`
- Current HEAD at generation-25 authoring: `8a5dd092b73ba0069a67f3a3bead0561f3269370` (director Q09 merge; descends from A7)
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

- Last accepted sequential phase: `Q11`; validation factory Q14 is also `ACCEPTED+MERGED`.
- Latest director acceptance: `D-LAUNCH-1` (`9ca01537f4edda06ee566cd261e612d5c315fb76`, authentic launch digest); standing order `D-LAUNCH-2` (`84d2ff65fd8d2b200821126dd17b4ba75f3c131c`, continuous self-accepted execution with full evidenced loops, director audits at LANE_READY); `D-LAUNCH-3` (`cf37df4af0ef3724f8f3a145c6be3cdcc84799c0`, Q lane transferred to the Fable lead builder); `D-LAUNCH-5` amendment (`d0e34f0310ebb5ad67b9c7f1ed4785a49a4bb0f8`, director branch): the spine finishes and accepts Q07 only, then parks — Q08/Q09/Q14 are shard-owned in separate worktrees and Q10+ waits for the director's shard merge.
- Current phase: `Q12` (ensemble, calibration and abstention), activated in generation 29 and bound to `quant/TASKS/Q12.md` in generation 30 under the director order in `QL_PARALLEL_DAG.md` at `72dee36`. Execute exactly Q12, including closure of the Q10 `WAITING_Q14` seams against the now-merged Q14 owner; do not begin Q13, Q15, Q16 or Q17.
- Resume merge record at generation 29:
  - Q11 survival/competing-risk shard acceptance `d04286d` was merged by the director at `ef15473`; Q10 acceptance remains its lane ancestor.
  - Q14 validation/falsification factory shard acceptance `e266b42` was merged by the director at `f756f3b`, the generation-29 activation parent and lane tip at resume.
- Q10 activation: generation-25 state commit `cc75e9bbde18f536297ea5f166c08ac4d266dcca` is the activation base; activation commit `79f6621985a5f38ae254ea45109a8e3f01f79e4d` contains `quant/TASKS/Q10.md` SHA-256 `709e611ee4a8f6a62a13d659e90a0bed36375d7eb78af347a523ee0bfd2c20df` (unchanged through C10).
- Q10 implementation receipt: `quant/RECEIPTS/Q10.md`; SHA-256 `d9261dbdc5cb141e529b2978182563acd4754a2c0003b43236f23a58d7c89f37`; immutable in C10.
- Q10 implementation commit C10: `f25648ace7f7adf8cd9c59ba459d1099ffdc7638`; exact parent `79f6621985a5f38ae254ea45109a8e3f01f79e4d`; tree `b89ef4eabe6d729a83009982c5b705266559b4cf`; 36 changed paths, all under `quant/**`.
- Q10 acceptance receipt: `quant/RECEIPTS/Q10_ACCEPTANCE.md`; SHA-256 `93f1d6b3e44864ed90e013522f0bc4d3a5fd97bd8f1995653881044ea6bff458`.
- Q10 acceptance/state commit A10: the commit that first contains this generation-28 state and the acceptance receipt; exact parent C10; intentionally non-self-referential.
- Archive-derived C10 full-repo SHA-256 `70b8dae90b8fc918e7ff304ddc751fbe8615814599ede825c9aa0b4f270328a4`; clean locked install (`uv sync --all-extras --frozen`, 68 packages), Ruff/format, strict mypy (205 files), full Q suite `1941 passed, 4 skipped` at `100.00%` (13,819/4,642) under hostile env, and byte-identical artifact regeneration all pass; the documented libomp host prerequisite recurred on the rebuild's managed-Python root and was provisioned per `DECISIONS/Q10-001`.
- Q10 dependency adoption: `quant/uv.lock` SHA-256 `716a9d0208f449bba51cde7fd67f9c90206ab0724aeac86ba862e119be859d29`, 68 packages (scikit-learn 1.9.0, xgboost 3.3.0, optuna 4.9.0 as the `models` extra per the Q01 deferred-ADOPT cards); dependency evidence in `quant/generated/q10/`.
- Director shard merges recorded at this generation:
  - Q08 derivatives shard accepted at `4bac0892fd410d60edcf7b35f8ca59a5e0cf37c9` (build `4c9b02672aed7c02149fd7e37e9fd2ec5552107a`, scope-skip fix `6649749c700fbb6825f44e22bf551e82effea4d1`) and merged by the director in `c00de401b27f3d6cccc3f1e8968ad7578f3575ca`.
  - Scope-guard merge-law fix `494d6ceacd9438f370b27f17b45ff8368179c5ee`: the Q08 per-commit shard scope test skips honestly on the merged lane branch and retains full power inside the shard worktree.
  - Q09 regime shard accepted at `a3426e53731d65e8c1fd9b824f69b4e4644f398e` (build `8c5bf3486e3bab28fd8c1865cc607765b8877af3`) and merged by the director in `8a5dd092b73ba0069a67f3a3bead0561f3269370`.
  - Confirmed merged-lane baseline at `8a5dd092…` on 2026-07-12: `.venv/bin/python -m pytest -q` → `1842 passed, 4 skipped` (the four skips are the Q08 shard scope-law tests, verifiable only inside the shard worktree), exit 0.
- Last accepted spine task: `quant/TASKS/Q10.md`; SHA-256 `709e611ee4a8f6a62a13d659e90a0bed36375d7eb78af347a523ee0bfd2c20df`; unchanged through C10/A10. Active task: `quant/TASKS/Q12.md`; SHA-256 `6356245d2c3d85f23faa6eef877073f09e7c0bdc5a25eb8ef4c186ae64130c01`.
- Checkpoint receipt: `quant/RECEIPTS/Q00.md`; blob `7ba41768ba747bbc3eddd1941f6f5d82985dc1ca`; SHA-256 `738dad4caac7cfac9ba8b7b84fb646ec1817c6f0eb34fc09daa60129ab1996c3`; immutable in checkpoint commit.
- Acceptance receipt: `quant/RECEIPTS/Q00_ACCEPTANCE.md`; SHA-256 `c29c7646af5f284a88eca782beb7dbf636e6c6eb11dda25d1bccc03ea97385de`; immutable after this acceptance commit.
- Q00 checkpoint implementation commit: `fa6fecd8295aaab6aa38d35bd34843b64af69e69`.
- Q00 checkpoint-state commit: `1dca8ce3022472488117cc9eab0f2f5b37905aac`.
- Q00 acceptance/state commit: `a7606b49d26cfc9aeec4e8a4166219885a0d19e5`.
- Q01 activation/state commit: `90e1ef89edd4cc449664ac05cb429448e0bac6f0`.
- Q01 implementation receipt: `quant/RECEIPTS/Q01.md`; SHA-256 `254b638eaa00b3f2ea06f12a3c5b460ac330c0ca5e48236042ea97ddb543114e`; immutable in C.
- Q01 implementation commit C: `73330e281c7a91fa5fba2059570e9619f9ade34d`; exact parent `90e1ef89edd4cc449664ac05cb429448e0bac6f0`.
- Q01 acceptance receipt: `quant/RECEIPTS/Q01_ACCEPTANCE.md`; SHA-256 `368daeccd6b43f28bfc41110f1dc85b8037f1c7eac81e3539a5e2bea893bd4b2`.
- Q01 acceptance/state commit A: `501eff34a7bcc354dfcd900d2d72ca263ade8b93`.
- Q02 activation/state commit: `9294b0f0ad5a73b7e746057ccf7a76eed677beb0`; exact parent `501eff34a7bcc354dfcd900d2d72ca263ade8b93`.
- Q02 implementation receipt: `quant/RECEIPTS/Q02.md`; SHA-256 `978456a8e3bb5adfc8092fc7d647ef3cb8ade9ac6b548578a578c23c11bc9b97`; immutable in C2.
- Q02 implementation commit C2: `7edd275e98762f600c6168e405b26716ba9d7e0d`; exact parent `9294b0f0ad5a73b7e746057ccf7a76eed677beb0`.
- Q02 acceptance receipt: `quant/RECEIPTS/Q02_ACCEPTANCE.md`; SHA-256 `5ffa157aa4d568916623add4e4b641498b27fb4ea6cef94e5e4f496e809409ab`.
- Q02 acceptance/state commit A2: `1db50828c8474b0f9fe70a70817ab20003107546`; exact parent C2.
- Q03 activation/state commit: `404645858830610677d0b6f6a75453b9a9bc531a`; exact parent `1db50828c8474b0f9fe70a70817ab20003107546`.
- Q03 implementation receipt: `quant/RECEIPTS/Q03.md`; SHA-256 `767c94f8680490a35b992da1a6abf349379508ba75bef670ac3de1071f5fe92a`; immutable in C3 after commit.
- Q03 implementation commit C3: `34b88ef7f022226acd8e294d3a023f71f3dfc397`; exact parent `404645858830610677d0b6f6a75453b9a9bc531a`; tree `34ea865d2df4ecf98f79c83f65bb1d0f49a00636`.
- Q03 acceptance receipt: `quant/RECEIPTS/Q03_ACCEPTANCE.md`; SHA-256 `31cf167aa6f7bcd209ebbb29254e9d0f6ccd65ec7093885dacd488ec49270486`.
- Q03 acceptance/state commit A3: `9e7d4aabae68a0e20479c389c0f08c33886bdeb4`; exact parent C3.
- Q04 activation/state commit: `c7ff41c9f1a82aefd879f3f7ca56b29e5ea79b91`; exact parent A3.
- Q04 implementation receipt: `quant/RECEIPTS/Q04.md`; SHA-256 `95b87d68b781f6cdeca560249d848fb7512d94b844051ce360bcd882c4f03a47`; immutable in C4.
- Q04 implementation commit C4: `668ab5d0548d1713c299e85972fcbc6433c59504`; exact parent `c7ff41c9f1a82aefd879f3f7ca56b29e5ea79b91`; tree `8611a1ac3c9f23fa61aa806ae5dcfc4e00e4f017`.
- Q04 acceptance receipt: `quant/RECEIPTS/Q04_ACCEPTANCE.md`; SHA-256 `ad14fe33c852ea0be0ccd269d15f942557cd66c1080a28f7809d33eef11fd2ae`.
- Q04 acceptance/state commit A4: `3455216249c2d7bcac67ef0d44a5567bcf93a26c`; exact parent C4.
- Q05 activation/state commit: `a8e701e3d191561035753e5298bdf5c25dc3194f`; exact parent A4.
- Q05 implementation receipt: `quant/RECEIPTS/Q05.md`; SHA-256 `36b34d000d3f02af8180f047b83a65a718cb713639987aebc90249bd171272b9`; immutable in C5.
- Q05 implementation commit C5: `a1baa003b2d9a1c746fe55956cad7b9633bcecdd`; exact parent `a8e701e3d191561035753e5298bdf5c25dc3194f`; tree `f59734a85329a55aa76d98432b76c090646c9206`.
- Q05 acceptance receipt: `quant/RECEIPTS/Q05_ACCEPTANCE.md`; SHA-256 `835865ec2f4fc40740b84ca94e0bc419ab8f0c7f8563622bab2d7701d1f596df`.
- Q05 acceptance/state commit A5: `8986653b0bbe371d7b129d56742bec7ba158ebaf`; exact parent C5.
- Q06 activation/state commit: `8f0af66df40843c8ca0fabca065ebd1b38df5686`; exact parent A5.
- Q06 implementation receipt: `quant/RECEIPTS/Q06.md`; SHA-256 `084836741fd74759b526760d6b2657deb7137d6d1f4ce227565dfb63ed26bddf`; immutable in C6 after commit.
- Q06 implementation commit C6: `3bf9e2a775c0aa91a29ab2f67c27544b9ddc6602`; exact parent `8f0af66df40843c8ca0fabca065ebd1b38df5686`; tree `e183d53c1cc0d2866211824cde020e6149147a85`.
- Q06 acceptance receipt: `quant/RECEIPTS/Q06_ACCEPTANCE.md`; SHA-256 `8b2d558b003e5eb9f17aabf80eb3d10efac8ff2478b29d032c2b3c4f5ec016d3`.
- Q06 acceptance/state commit A6: `24ccf5880cbce8b1ee81ddd7d33f7c9c7271aacd`; exact parent C6.
- Q07 activation/state commit: `d0573734e2e2ab5576863ca5fe6875d770dfe68a`; exact parent A6.
- Q07 implementation receipt: `quant/RECEIPTS/Q07.md`; SHA-256 `06bcc7ca89160d9d6351ca26f0125bde48b064dbc8a049cad8ea6bf1b2292162`; immutable in C7.
- Q07 implementation commit C7: `22ab5bc8db94bf92883fdeac2a397ebf8c132ca0`; exact parent `d0573734e2e2ab5576863ca5fe6875d770dfe68a`; tree `919f86ce835dac86d9c534ff5734d4361c8198c4`.
- Q07 acceptance receipt: `quant/RECEIPTS/Q07_ACCEPTANCE.md`; immutable in A7 after commit.
- Q07 acceptance/state commit A7: the commit that first contains this generation-24 state and the acceptance receipt; exact parent C7; intentionally non-self-referential.
- Acceptance state: Q00 `ACCEPTED`; Q01 `ACCEPTED`; Q02 `ACCEPTED`; Q03 `ACCEPTED`; Q04 `ACCEPTED`; Q05 `ACCEPTED`; Q06 `ACCEPTED`; Q07 `ACCEPTED`; Q08 `ACCEPTED+MERGED` (shard-owned receipts `quant/RECEIPTS/Q08.md`/`Q08_ACCEPTANCE.md`); Q09 `ACCEPTED+MERGED` (shard-owned receipts `quant/RECEIPTS/Q09.md`/`Q09_ACCEPTANCE.md`); Q10 `ACCEPTED`; Q11 `ACCEPTED+MERGED` (shard acceptance `d04286d`, director merge `ef15473`); Q14 `ACCEPTED+MERGED` (shard acceptance `e266b42`, director merge `f756f3b`); Q12 `ACTIVE`.

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

## Q02 implementation inventory

- Decision/research: `DECISIONS/Q02-001-IMMUTABLE-LAKE.md`, `docs/Q02_STORAGE_RESEARCH.md`.
- Golden contract: `fixtures/q02_partition_golden_v1.json`.
- Lake package: eight `src/quant_edge/lake/*.py` modules.
- Tests: five contract, five unit and one property test file.
- Durable implementation: immutable `RECEIPTS/Q02.md` and generation-8 state in C2.
- Durable acceptance: `RECEIPTS/Q02_ACCEPTANCE.md` and this generation-9 state in A2.

Implementation commit C2 therefore has 24 changed paths, all under `quant/**`. `TASKS/Q02.md` remains unchanged from activation commit. The two root directives remain preserved untracked owner inputs and are never staged.

## Q03 implementation inventory

- Decision/research: `DECISIONS/Q03-001-HISTORICAL-BOOTSTRAP.md`, `docs/Q03_SOURCE_CONTRACT_REFRESH.md`.
- Package/script: nine `src/quant_edge/bootstrap/*.py` files and `scripts/q03_real_sample.py`.
- Generated evidence: ten `generated/q03/*` hash/count/schema/Markdown artifacts; no raw external bytes or rows.
- Tests: five contract, two property and seven unit test files.
- Durable completion: immutable `RECEIPTS/Q03.md` and generation-11 state in C3.
- Durable acceptance: `RECEIPTS/Q03_ACCEPTANCE.md` and this generation-12 state in A3.

Implementation C3 has 38 changed paths, all under `quant/**`. `TASKS/Q03.md` remains unchanged from activation. The two root directives remain preserved untracked owner inputs and are never staged.

## Q04 implementation inventory

- Decision/research: `DECISIONS/Q04-001-LOCAL-BOOK-TEMPORAL-TRUTH.md`, `docs/Q04_BOOK_CONTRACT_RESEARCH.md`.
- Package/script: five `src/quant_edge/book/*.py` modules and `scripts/q04_replay_campaign.py`.
- Fixture/evidence: `fixtures/q04_replay_golden_v1.json` and two `generated/q04/replay_campaign.v1.*` artifacts; all synthetic, deterministic and hash-bound.
- Tests: five unit, one property and two contract test files (140 focused tests).
- Durable completion: immutable `RECEIPTS/Q04.md` and this generation-14 state in C4.

Implementation C4 has 21 changed paths, all under `quant/**`. `TASKS/Q04.md` remains unchanged from activation. The two root directives remain preserved untracked owner inputs and are never staged.

## Q05 implementation inventory

- Decision/design: `DECISIONS/Q05-001-LABEL-CONTROL-FACTORY.md`, `docs/Q05_LABEL_FACTORY_DESIGN.md`.
- Package/script: ten `src/quant_edge/labels/*.py` modules and `scripts/q05_label_campaign.py`.
- Fixture/evidence: `fixtures/q05_label_golden_v1.json` and two `generated/q05/label_campaign.v1.*` artifacts; all synthetic, deterministic and hash-bound.
- Tests: seven unit, one property and two contract test files (126 focused tests incl. the full §11.7 law).
- Durable completion: immutable `RECEIPTS/Q05.md` and this generation-17 state in C5.

Implementation C5 has 28 changed paths, all under `quant/**`. `TASKS/Q05.md` remains unchanged from activation. The two root directives remain preserved untracked owner inputs and are never staged.

## Q06 implementation inventory

- Decision/design: `DECISIONS/Q06-001-FEATURE-REGISTRY.md`, `docs/Q06_FEATURE_REGISTRY_DESIGN.md`.
- Package/script: nine `src/quant_edge/features/*.py` modules and `scripts/q06_feature_campaign.py`.
- Fixture/evidence: `fixtures/q06_feature_golden_v1.json` and two `generated/q06/feature_campaign.v1.*` artifacts; all synthetic, deterministic and hash-bound.
- Tests: four unit, one property and two contract test files (74 focused tests).
- Durable completion: immutable `RECEIPTS/Q06.md` and this generation-20 state in C6.

Implementation C6 has 24 changed paths, all under `quant/**`. `TASKS/Q06.md` remains unchanged from activation. The two root directives remain preserved untracked owner inputs and are never staged.

## Q07 implementation inventory

- Decision/design: `DECISIONS/Q07-001-MICROSTRUCTURE-LIBRARY.md`, `docs/Q07_MICROSTRUCTURE_DESIGN.md`.
- Package/script: seven `src/quant_edge/micro/*.py` modules and `scripts/q07_micro_campaign.py`.
- Fixture/evidence: `fixtures/q07_micro_golden_v1.json` and two `generated/q07/micro_campaign.v1.*` artifacts; all synthetic, deterministic and hash-bound.
- Tests: five unit, one property and two contract test files (84 focused tests).
- Durable completion: immutable `RECEIPTS/Q07.md` and the generation-23 state in C7.
- Durable acceptance: `RECEIPTS/Q07_ACCEPTANCE.md` and this generation-24 state in A7.

Implementation C7 has 23 changed paths, all under `quant/**`. `TASKS/Q07.md` remains unchanged from activation (`11da284d…`). The two root directives remain preserved untracked owner inputs and are never staged.

## Q-lane posture map

- `LIVE`: none. Q has no production integration, listener, data producer, model or authority.
- `SHADOW`: none. No Q assessment service or champion/challenger is running.
- `SYNTHETIC`: frozen protocol/product fixtures, Q01 deterministic config/RNG, Q02 golden vector, Q03 hash-only forward bridge fixtures and Q04 replay/golden book fixtures; never observed market evidence.
- `RESEARCH`: locked offline package, eight-family hypothesis portfolio, one checksum-verified/disposable archive replay, a hash-only two-tier Event Atlas bootstrap, the Q04 fail-closed Spot/USD-M local-book reference model with deterministic replay, the Q07 sixteen-feature §13.1 microstructure library, the merged Q08 derivatives/Basis/cross-market library, the merged Q09 change/regime/anomaly/analog layer, and the Q10 §14.1–14.3 transparent-and-boosted model battery (calibrated linear baselines, honest controls, XGBoost challengers, bounded fully-logged Optuna studies, synthetic planted-structure proofs, WAITING_Q14 validation seam), all with honest dispositions; no edge claim.
- `UNAVAILABLE`: real forward Q delivery, point-in-time instrument master, owner-annotation records, feature/label/model registries, trained/calibrated models, drift service and inference.
- Money/order/capital/risk authority: `NONE` in every posture.

## Framework and source decisions

- Python/toolchain: CPython `3.13.14`, `uv/uv-build 0.11.28`; `uv.lock` SHA-256 `716a9d0208f449bba51cde7fd67f9c90206ab0724aeac86ba862e119be859d29`, 68 entries (Q02–Q09 goldens were built under the 51-entry lock `3449f6eb…4ed81`; partition/manifest bytes measured identical across the change).
- Immediate runtime frameworks: Polars `1.42.1`, PyArrow `25.0.0`, DuckDB `1.5.4`; Q10 activated the deferred-ADOPT modeling cards as the `models` extra: scikit-learn `1.9.0`, XGBoost `3.3.0`, Optuna `4.9.0` (bounded threads, no pickle/joblib persistence); LightGBM/CatBoost remain `REFERENCE_ONLY`, scikit-survival `REJECT`; remaining registry/sequence candidates stay deferred exactly as `docs/Q01_FRAMEWORK_ADOPTION.md` records. Host prerequisite: XGBoost needs `libomp.dylib`; the sklearn-vendored copy is symlinked into the managed toolchain `lib/` (see `DECISIONS/Q10-001`).
- Framework/paper cards: 24 explicit framework cards plus all 15 required primary-paper implement/test/ablate decisions, with no measured economic claim.
- Binance public archive: `ADAPT` for checksum/revision-manifested coarse history; raw-data redistribution permission unresolved.
- Canonical runtime capture: `ADAPT` for forward high-fidelity atlas through a future append-only bridge; Q owns no production socket.
- Full L2 inferred from candles/coarse archive: `REJECT`.
- External venue/context feeds: `REFERENCE_ONLY` until a source card passes launch Section 6 admission gates.
- Exit-liquidity heuristics: challengers only; no `P(bait)` semantics without target/calibration proof.

## Dataset, registry and evidence state

- Dataset version evidence: temporary `binance_spot_aggtrades/r_2de38a97c23e86d2aafc`; partition `3420b1eb…baf8`, manifest `31b3a78e…5a35`; disposed after validation, with no external row bytes retained.
- Coverage: observed BNBUSDT Spot `aggTrades` for 2017-11-06, 832 rows, 0 observed internal ID discontinuities/invalid/duplicates; boundary/upstream completeness and point-in-time identity remain unknown.
- Event Atlas: `q03.event-atlas.v1`, as-of `1783846749003` ms; 832 rows, 20 candidates, 143 controls, 0 omitted; later outcomes `UNAVAILABLE`; forward tier real coverage `MISSING/BLOCKED`.
- Hypothesis registry: `edge-hypotheses-2026-07-12-v2`; 8 families (`DATA_INSUFFICIENT=5`, `RESEARCH=2`, `UNTESTED=1`), exact deterministic Markdown projection; no `SHADOW`.
- Feature registry: the Q06 §12 law (fixed-point/domains/baselines/cards/equivalence/quality) with four v1 primitives, synthetic proofs only. Label registry: the Q05 §11 machinery (identity/outcomes/stages/basis/disposition/controls/manifests) exists with synthetic proofs only; no populated real-label dataset. Model registry: none (Q15). Models: the Q10 battery machinery exists with synthetic planted-structure proofs only — comparison reports, fully-logged bounded studies and per-model isotonic calibration with measured ECE; no model is trained on real evidence and none carries probability semantics without calibration evidence.
- Source cards: Q03 archive/runtime/Tardis reviews all remain `INELIGIBLE`/`REVIEW_ONLY_NO_ADMISSION`; no source is admitted and no Q producer exists.
- Owner annotations: separate immutable weak-supervision/blinding/link contracts exist; no annotation or objective-outcome record exists.
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
- Q01–Q03 measurement detail is compacted here; the exact commands, counts and digests remain in the immutable receipts `quant/RECEIPTS/Q01.md`–`Q03_ACCEPTANCE.md`.
- Q01: clean locked env (CPython 3.13.14, 51 entries), Ruff/mypy clean, focused `88 passed` at `96.71%` branch, deterministic seed fixture, registry semantics, protocol `22/22`, exact-C verification and archive re-run all passed.
- Q02: `602 passed` at `100.00%`; golden partition/manifest replay `2/2`; hostile store proofs; independent `SEAL`; exact-C2 verification and archive re-run passed.
- Q03: focused `430`/accumulated `1032` at `100.00%`; real BNBUSDT 2017-11-06 sample (832 rows) imported and disposed with hash-only evidence; byte-identical campaigns; adversarial seal; exact-C3 verification and archive re-run passed.
- Q04–Q05 measurement detail is compacted here; exact commands, counts and digests remain in the immutable receipts `quant/RECEIPTS/Q04.md`–`Q05_ACCEPTANCE.md`.
- Q04: focused `140`/accumulated `1172` at `100.00%` (5,223/1,864); 74 files Ruff/mypy clean; seeded Spot/USD-M truth-schedule properties; fixture `32e13493…6aec` and campaign artifacts byte-identical across CWD/TZ/hash-seed; scope `6/6`, protocol `22/22`, npm unchanged; replay-counter/stream-id/intent-window findings corrected.
- Q05: focused `126`/accumulated `1298` at `100.00%` (6,744/2,406); 95 files clean; §11.7 seven-law matrix one-for-one; fixture `f36a9b08…fe47` and campaign artifacts byte-identical across hostile env; scope `6/6`, protocol `22/22`, npm unchanged; pre-validation/dead-branch/duplicate-pool findings corrected.
- Q06 pinned `uv 0.11.28 lock --check`: exit 0, 51 resolved packages; no dependency change.
- Q06 Ruff lint/format and strict mypy: exit 0, 112 files including all campaign scripts.
- Q06 focused suite: `74 passed`; `quant_edge.features` 1,085 statements / 298 branches, `100.00%`.
- Q06 accumulated Q suite: `1372 passed`; 7,829 statements / 2,704 branches, `100.00%`.
- Q06 property campaigns: seed `20260712`; 60+60+60+80 examples over equivalence, bar boundary laws, median/MAD recomputation and quality propagation.
- Q06 golden fixture `06c81655…abb3`; campaign JSON `51b87e70…da0c`; Markdown `622d580f…3a42`; byte-identical across CWD/TZ/hash-seed changes and equal to in-test regeneration; measured EWMA drift 2 ulp against declared 64.
- Q06 accumulated Q00 scope `6/6`, protocol `22/22`, `npm test` exit 0 unchanged.
- Q06 adversarial review: batch-EWMA unit error, feature-id separator, slots-violating class and dead defensive branches corrected with regression tests; no remaining known blocker at receipt authoring.
- Q07 pinned `uv 0.11.28 lock --check`: exit 0, 51 resolved packages; no dependency change.
- Q07 Ruff lint/format-check and strict mypy: exit 0, 128 files including all campaign scripts.
- Q07 focused suite: `84 passed`; `quant_edge.micro` 887 statements / 202 branches, `100.00%`.
- Q07 accumulated Q suite: `1456 passed`; 8,716 statements / 2,906 branches, `100.00%`.
- Q07 property campaigns: seed `20260712`; 60-example suites prove exact (0-ulp) streaming/batch agreement for all 16 features over randomized quotes/ladders/trades/bars, boundedness laws, the signed-imbalance window law and the OFI pure-size-pressure sign law.
- Q07 golden fixture `d8308437…4ce3`; campaign JSON `dbb303be…a950`; Markdown `d1ab9605…7032`; byte-identical across CWD/TZ/hash-seed changes and equal to in-test regeneration; measured drift 0 ulp everywhere; measured update costs within declared bounds; wall-time evidence is stdout-only.
- Q07 accumulated Q00 scope `6/6`, protocol `22/22`, `npm test` exit 0 unchanged.
- Q07 adversarial review: dead defensive branches under strict-ordering invariants, unsorted card failure modes, a streaming Kyle-slope missing-quote divergence and initially missing task deliverables (`trade_dispersion:v1`, stdout wall-time evidence) corrected with regression tests; a hand-expanded activation-SHA tail in the first C7 attempt was caught by the parent check and the commit re-created before verification.
- Independent exact C7 verifier: exact parent/ancestry, 23-path scope, regular modes, frozen/accepted emptiness, task/receipt/state/artifact blob hashes and `git diff-tree --check` all pass; tree `919f86ce835dac86d9c534ff5734d4361c8198c4`.
- Archive-derived C7 SHA-256 `6bdf3da023a1a333df89ac897f4edecc5ee7a61b7ac8140a612fb75c99e0a408`; clean locked install, Ruff, strict mypy, Q `1456` at `100.00%` (8,716/2,906) under hostile env and byte-identical artifact regeneration all pass.
- Independent exact C6 verifier: exact parent/ancestry, 24-path scope, regular modes, frozen/accepted emptiness, task/receipt/state/artifact blob hashes and `git diff-tree --check` all pass; tree `e183d53c1cc0d2866211824cde020e6149147a85`.
- Archive-derived C6 SHA-256 `50c15a2fad7f158228cfb0061525e547a2abb7c3ca0ce3fe199b55ac5c5f0f27`; clean locked install, Ruff, strict mypy, Q `1372` at `100.00%` (7,829/2,704) and byte-identical artifact regeneration all pass.
- Independent exact C5 verifier: exact parent/ancestry, 28-path `quant/**` scope, regular modes, frozen/accepted emptiness, task/receipt/state/artifact blob hashes and `git diff-tree --check` all pass; tree `f59734a85329a55aa76d98432b76c090646c9206`.
- Archive-derived C5 SHA-256 `8628e338beb21274b473819bf0d32bc7d62c5a29829f71c1b373d170a796b0e9`; clean locked install, Ruff/format, strict mypy, Q `1298` at `100.00%` (6,744/2,406) and byte-identical artifact regeneration all pass.
- Independent exact C4 verifier: exact parent/ancestry, 21-path `quant/**` scope, regular modes, frozen/accepted emptiness, task/receipt/state/artifact blob hashes and `git diff-tree --check` all pass; tree `8611a1ac3c9f23fa61aa806ae5dcfc4e00e4f017`.
- Archive-derived C4 SHA-256 `b1680299466a2e903f9e5aad2a2bf8633539cf00ea2ba994d0dbe18e5f217918`; clean locked install, Ruff/format, strict mypy, Q `1172` at `100.00%` (5,223/1,864), golden/campaign byte regeneration and subprocess determinism all pass.
- Q10 pinned `uv 0.11.28 lock --check`: exit 0 after the deferred-ADOPT activation, 68 resolved packages; dependency audit 64 distributions / 0 indexed vulnerabilities / 0 unknown licenses (2026-07-12).
- Q10 Ruff lint/format-check and strict mypy: exit 0, 205 files (overrides only for untyped `sklearn.*`/`threadpoolctl`).
- Q10 focused suite: `99 passed`; `quant_edge.models` 1,261 statements / 394 branches, `100.00%`.
- Q10 accumulated Q suite: `1941 passed, 4 skipped` (honest Q08 shard scope skips); 13,819 statements / 4,642 branches, `100.00%`.
- Q10 property campaigns: seed `20260712`; quantization nearest-grid/half-even law, brute-force exact-rational metric parity, comparison-winner law, split partition law; seeded planted-direction monotone laws for constrained classifier/ranker; study determinism, known-optimum, injected-failure and fail-closed logging laws.
- Q10 golden fixture `874b2cd9…833e`; campaign JSON `ab1f8a60…541f`; Markdown `6c0489d7…255b`; byte-identical across CWD/TZ/hash-seed subprocesses and equal to in-test regeneration; measured winners: XGBoost on the planted-XOR binary and heteroscedastic quantile targets, `ols:v1` over both boosted challengers on the noise-dominated regression target (honest losses frozen), `xgb_ranker:v1` on ranking; 4 × 12/12 trials logged.
- Q10 accumulated Q00 scope `6/6`, protocol `22/22`, `npm test` exit 0 unchanged.
- Q10 adversarial review: multi-quantile monotone-constraint violation measured and the constraint honestly removed; Q02 golden live-lock pin amended for lawful lock evolution (partition/manifest bytes measured identical); dead helper/unreachable-guard cleanups with testable seams; sklearn deprecation removed at byte-identical battery digest; libomp host provisioning recorded.
- Host: Apple M4 Max, 16 cores, 48 GB; Node `v22.23.1`; npm `10.9.8`.
- Current Q performance/inference measurements: none. Historical receipt and synthetic capacity facts remain separately labeled in `quant/docs/Q00_BENCHMARK_PROFILE.md`.

## Known defects and blockers

- Resolved: D-LAUNCH-1 binds launch blob `587c1b83…` to SHA-256 `26b1d5ce…0f2c06`; the stale `0cc192e3…` measurement no longer blocks. The Q worktree's frozen lock remains byte-unchanged; see decisions Q00-002 and Q00-003.
- Resolved before Q01 seal: mandatory hypothesis numbering, substantive Markdown drift, arbitrary-runner protocol false green, unbounded/malformed Unicode input, compact framework-card gaps and ephemeral-only scanner detail.
- Q01 exact-commit verification completed and acceptance conditions passed; no Q01 blocker remains.
- Q02 exact-commit verification passed and Q02 is accepted; no Q02 blocker remains.
- Q03 exact-commit verification passed and Q03 is accepted; no Q03 blocker remains.
- No canonical forward runtime-to-Q append-only bridge exists; this is a later integration seam, not permission for a Q socket.
- Resolved in Q03: separate nullable-source-time forward schema fingerprint `bd030e0a…8886`, explicit clock/order/payload posture and bounded `DROP_NEW` seam.
- Free history cannot prove full L2, receive latency, borrow truth or causal intent.
- Archive data license/redistribution, point-in-time identity/filter economics and upstream/boundary completeness remain unresolved; only hash/count/derived registry evidence is retained.
- Real canonical runtime-to-Q append-only delivery remains `MISSING/BLOCKED`; Q03 implements no socket or operational payload materialization.
- Current official liquidation selection wording conflicts; preserve sampled/unknown semantics.
- The official USD-M local-book text leaves the exact-boundary bridge (`U == lastUpdateId + 1`) unsatisfiable; Q04 follows the text, converges through its retained restart buffer, and records the residual boundary behavior as inherited for the integration owner.
- Numeric Q inference SLOs are unknown until measured on the Q01 lock; only provisional resource/queue budgets exist.

## Exact next task

Execute exactly Q12: close the Q10 `WAITING_Q14` seams against the merged validation factory; implement out-of-fold stacking, calibration, conformal/adaptive interval challengers, uncertainty decomposition and deterministic abstention so stale/OOD/conflicting/cost-negative evidence yields `ABSTAIN_UNKNOWN`; complete the full evidenced self-acceptance loop and park. Do not touch Q13/Q15-owned paths or begin Q13, Q15, Q16 or Q17. Never rewrite accepted work; never push.

Next exact command (on resume only):

```bash
git status --short && git log -4 --format='%H %P %s' && shasum -a 256 quant/QUANT_EDGE_BUILD_STATE.md quant/TASKS/Q12.md
```

## Fresh-session read order

1. `STATE.md`, `MISSION.md`, `ARCHITECTURE.md` Part II, `DIRECTOR.md`.
2. `QUANT_EDGE_RESEARCH_FACTORY_12H.md` and only launch Section 6.
3. `EDGE_PROTOCOL_V1.md`, frozen schema/fixtures, and `quant/DIRECTIVE_INPUTS.lock`.
4. This state, `quant/TASKS/Q12.md`, immutable Q10/Q11/Q14 receipts and the Q10/Q11/Q14 decision/design records.
5. Read Q09 quality/OOD, Q10 model contracts, Q11 survival contracts and Q14's public validation barrel directly; accepted artifacts are inputs only and must not be rewritten.
6. Q00 reuse matrix and Q01 framework/security docs remain inputs only; do not redo accepted work or regenerate accepted evidence unless exact code/input identity changed.

## Work not to repeat

- Do not redo the Q00 source/reuse audit while its recorded source hashes are unchanged.
- Do not modify or replace either immutable Q00 receipt.
- Do not recreate or edit accepted phase tasks; Q12 is the only current phase.
- Do not recreate retired paths or old authority files.
- Do not materialize the Event Atlas, download market data or create a production source during Q02.
- Do not edit or normalize the two untracked owner directives.
- Do not rewrite the immutable Q01 receipt after implementation commit C.
- Do not rerun or rewrite accepted Q01; the next bounded phase is Q02.
- After C2, do not rewrite `quant/RECEIPTS/Q02.md`; verify the exact commit and create a separate acceptance receipt.
- Do not rerun or rewrite accepted Q02; the activated Q03 task is the only current work.
- Do not implement Q04 book reconstruction or Q05 labels/controls during Q03.
- After C3, do not rewrite `quant/RECEIPTS/Q03.md`; verify the exact commit and create a separate acceptance receipt.
- Do not rerun or rewrite accepted Q03, Q04 or Q05; Q06 is the only current phase.
- After C6, do not rewrite `quant/RECEIPTS/Q06.md`; verify the exact commit and create a separate acceptance receipt.
- Do not rerun or rewrite accepted Q06; Q07 is the only current phase.
- Do not implement Q08 derivatives features or models during Q07.
- Do not rewrite either immutable Q07 receipt after A7; Q07 is accepted.
- The Q08 and Q09 shard merges are landed and accepted: never rewrite, rebase or "clean up" the merged shard history, receipts or code; the Q08 shard scope tests legitimately skip on this branch (494d6ce).
- Q11 and Q14 are accepted and director-merged at `ef15473` and `f756f3b`. Q12 is the sole active spine phase. Q13 and Q15 remain shard-owned in separate worktrees; Q16/Q17 await later director order.
- Do not rewrite either immutable Q10 receipt after A10; Q10 is accepted.
- Do not rerun or regenerate accepted Q10 evidence unless exact code/input identity changed; the golden fixture freezes the seed-20260712 battery outcome including the honest boosted losses.
- Do not re-add monotone constraints to the multi-quantile challenger without new measured evidence that the objective honors them.
- Do not "fix" the Q02 golden fixture's build-time lock binding: the fixture is frozen accepted evidence; only the explicit live-lock pin in `tests/contract/test_q02_golden.py` moves with lawful lock changes.
- Do not rewrite either immutable Q04 receipt after A4.
- After C5, do not rewrite `quant/RECEIPTS/Q05.md`; verify the exact commit and create a separate acceptance receipt.
- Do not implement Q06 features or models during Q05.
