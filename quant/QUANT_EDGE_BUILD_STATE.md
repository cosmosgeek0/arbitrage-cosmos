# QUANT EDGE RESEARCH FACTORY — durable build state

State generation: `3`

Updated: 2026-07-12T10:33:42+0530

Status: `ACCEPTED`
Program: Q lane — deterministic research evidence, labels, models, calibration, drift and advisory inference.

## Frozen launch identity

- Worktree: `/Users/cosmosgeek/Desktop/quant-edge-research-20260712`
- Branch: `quant-edge-research-factory-20260712`
- Current HEAD at generation-3 authoring: `1dca8ce3022472488117cc9eab0f2f5b37905aac`
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

- Last accepted phase: `Q00`
- Latest director acceptance: `D-LAUNCH-1`, commit `9ca01537f4edda06ee566cd261e612d5c315fb76`; authentic launch blob/digest binding independently verified.
- Current phase: `Q00` complete; `Q01` is next and has not started.
- Current task: `quant/TASKS/Q00.md`
- Current task SHA-256: `0643c54b81b93e57c5f9548a5968d670f7f31c7499bacc078fff87e38b323507`
- Checkpoint receipt: `quant/RECEIPTS/Q00.md`; blob `7ba41768ba747bbc3eddd1941f6f5d82985dc1ca`; SHA-256 `738dad4caac7cfac9ba8b7b84fb646ec1817c6f0eb34fc09daa60129ab1996c3`; immutable in checkpoint commit.
- Acceptance receipt: `quant/RECEIPTS/Q00_ACCEPTANCE.md`; SHA-256 `c29c7646af5f284a88eca782beb7dbf636e6c6eb11dda25d1bccc03ea97385de`; immutable after this acceptance commit.
- Q00 checkpoint implementation commit: `fa6fecd8295aaab6aa38d35bd34843b64af69e69`.
- Q00 checkpoint-state commit: `1dca8ce3022472488117cc9eab0f2f5b37905aac`.
- Q00 acceptance/state commit: the commit containing state generation 3; intentionally non-self-referential.
- Acceptance state: `ACCEPTED`; implementation, focused/accumulated tests, adversarial review, corrections, checkpoint receipt and D-LAUNCH-1 are verified.

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

No other path is authored or staged. The two root directives remain preserved untracked owner inputs.

## Q-lane posture map

- `LIVE`: none. Q has no production integration, listener, data producer, model or authority.
- `SHADOW`: none. No Q assessment service or champion/challenger is running.
- `SYNTHETIC`: frozen protocol fixtures and existing product test fixtures only; Q00 uses them for contract evidence, not market claims.
- `UNAVAILABLE`: historical lake, point-in-time master, Event Atlas, owner annotations, hypothesis/feature/label/model registries, trained/calibrated models, drift service and inference.
- Money/order/capital/risk authority: `NONE` in every posture.

## Framework and source decisions

- Python/framework adoption: none; Q01 not started.
- Binance public archive: `ADAPT` for checksum/revision-manifested coarse history; raw-data redistribution permission unresolved.
- Canonical runtime capture: `ADAPT` for forward high-fidelity atlas through a future append-only bridge; Q owns no production socket.
- Full L2 inferred from candles/coarse archive: `REJECT`.
- External venue/context feeds: `REFERENCE_ONLY` until a source card passes launch Section 6 admission gates.
- Exit-liquidity heuristics: challengers only; no `P(bait)` semantics without target/calibration proof.

## Dataset, registry and evidence state

- Dataset versions: none.
- Coverage: no retained historical/Q dataset; no point-in-time master; no current Q event trace.
- Event Atlas: absent; two-tier build routed to Q03–Q05.
- Hypothesis registry: absent; routed to Q01 with honest initial statuses.
- Feature registry: none. Label registry: none. Model registry: none. Calibration: none.
- Owner annotations: absent; separate immutable weak-supervision channel routed to Q02/Q05.
- Frozen protocol fixtures and product test fixtures are `SYNTHETIC_ONLY`, never research evidence.

## Tests and measurements

- `node packages/edge-protocol-tests/protocol.test.mjs`: exit 0, `22/22`.
- `npm test`: exit 0; typecheck/build and deterministic baseline green (`377` underlying checks).
- `npm run test:all`: exit 0; full repository battery green.
- Launch counters: existing 377; gates 72; intelligence 152; runtime 394; capital 433; foundation 871; integration scenarios 30; protocol 22.
- `bash quant/tests/q00/scope_guard.test.sh`: exit 0, `6/6`, including reverted out-of-scope commit history.
- Q00 checkpoint staged `bash quant/scripts/check-scope.sh`: exit 0, exact branch/protocol, `10` allowed paths.
- Q00 acceptance staged `bash quant/scripts/check-scope.sh`: exit 0, exact branch/protocol, `3` allowed paths.
- `git diff --cached --check`: exit 0.
- Independent verification of `fa6fecd`: exact 10-path `quant/**` history, empty frozen diff, range `git diff --check` exit 0, scope suite `6/6`, protocol `22/22`.
- Host: Apple M4 Max, 16 cores, 48 GB; Node `v22.23.1`; npm `10.9.8`.
- Current Q performance/inference measurements: none. Historical receipt and synthetic capacity facts remain separately labeled in `quant/docs/Q00_BENCHMARK_PROFILE.md`.

## Known defects and blockers

- Resolved: D-LAUNCH-1 binds launch blob `587c1b83…` to SHA-256 `26b1d5ce…0f2c06`; the stale `0cc192e3…` measurement no longer blocks. The Q worktree's frozen lock remains byte-unchanged; see decisions Q00-002 and Q00-003.
- No canonical forward runtime-to-Q append-only bridge exists; this is a later integration seam, not permission for a Q socket.
- Free history cannot prove full L2, receive latency, borrow truth or causal intent.
- Current official liquidation selection wording conflicts; preserve sampled/unknown semantics.
- Numeric Q inference SLOs are unknown until measured on the Q01 lock; only provisional resource/queue budgets exist.

## Exact next task

1. Seal and independently verify the Q00 acceptance/state commit; do not repeat accepted Q00 work.
2. Create the bounded `quant/TASKS/Q01.md` brief from Q01, launch Section 6 and durable state.
3. Research current official framework/version/license/security facts before Q01 code.
4. Execute only Q01: pinned deterministic Python workspace, minimal CLI and early honest hypothesis registry/map.
5. Run focused Q01 tests, accumulated Q-lane tests, adversarial review, corrections, scope gate, implementation commit, immutable receipt and state update.

Next exact command after the Q00 acceptance commit:

```bash
git show --stat --oneline HEAD && bash quant/scripts/check-scope.sh && git diff 73e1a1f..HEAD --name-only
```

## Fresh-session read order

1. `STATE.md`, `MISSION.md`, `ARCHITECTURE.md` Part II, `DIRECTOR.md`.
2. `QUANT_EDGE_RESEARCH_FACTORY_12H.md` and only launch Section 6.
3. `EDGE_PROTOCOL_V1.md`, frozen schema/fixtures, and `quant/DIRECTIVE_INPUTS.lock`.
4. This state, `quant/TASKS/Q00.md`, both Q00 receipts, and all three Q00 decisions.
5. Q00 reuse matrix, benchmark profile and source research.

## Work not to repeat

- Do not redo the Q00 source/reuse audit while its recorded source hashes are unchanged.
- Do not modify or replace either immutable Q00 receipt.
- Do not recreate retired paths or old authority files.
- Do not materialize the Event Atlas or create a production source during Q01.
- Do not edit or normalize the two untracked owner directives.
