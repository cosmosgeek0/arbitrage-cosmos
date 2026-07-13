# QUANT EDGE RESEARCH FACTORY — durable build state

State generation: `38`

Updated: 2026-07-13T12:59:52+0530

Status: `Q17 COMPLETE — READY FOR EXACT C17 VERIFICATION`. Q13 and Q15 are
accepted and director-merged. Q16 is exact-commit accepted. Q17 implementation,
proof, benchmark, generated kit and adversarial correction loop are complete. C17
is pending exact Git scope verification; only a separate clean-archive A17 may set
`LANE_READY` and park the branch for director audit.

Program: Q lane — deterministic research evidence, labels, models, calibration,
uncertainty and advisory-only local inference.

## Frozen launch and ancestry

- Worktree: `/Users/cosmosgeek/Desktop/quant-edge-research-20260712`
- Branch: `quant-edge-research-factory-20260712`
- Accepted Q16 implementation C16:
  `b3d8cedece8cf3a9f546c60016beae442f85f160`; tree
  `a35b888041cbdd4ea56accd29a490a8ce043cef0`; exact parent
  `cff7943845231ef1518dbfb937f986cdf2e247f5`.
- Q16 acceptance A16 / Q17 activation parent:
  `4ac05802244a194639865a4b615ee2af13dce4e2`; tree
  `eb367affe1952093be09d8ec2d1d1344ae905453`; exact parent C16.
- Q16 activation commit:
  `cff7943845231ef1518dbfb937f986cdf2e247f5`; tree
  `b988cd7ebc2eff2090f972115a0741f6089d358a`; exact parent
  `5076eba16299595961a7a250a7e917b868afd454`.
- Generation-33 state commit: `5076eba16299595961a7a250a7e917b868afd454`.
- Director Q13 merge: `3ed8e38d65812e2eb8ed6eba19e4eb5084c253d1`;
  Q13 acceptance: `06f0a8f0c722ece6c46f56c62156aec291a77317`.
- Director Q15 merge: `f54180c3a7d014e4d91a0c6b7dc5ea4c3d521754`;
  merged-lane scope fix `c070fdaf7dc568448212067dde5e1fb2ecc21356`;
  Q15 acceptance `e69f6879b5914879b5d9342e3f05fa964f5b9496`.
- Director board: `git show 1fec867 -- QL_PARALLEL_DAG.md`; board blob SHA-256
  `469370d904484e450f17da301991d07b9d87ef39ee5b693048e14e997000338b`.
  The board commit is evidence, not lane ancestry; it records Q13+Q15 merged and
  authorizes Q16 -> Q17 -> `LANE_READY`.
- Canonical base: `7010499170e24b31c9c0be2c9d73a536e680c6fe`.
- Frozen protocol commit: `73e1a1ff7daa48df8dac45713fc5f106842edafc`.
- Mission SHA-256:
  `95e152d76844aa391b7a28bd45548d7fe58f83ed1ced558dbdbeb01797436362`.
- Architecture SHA-256:
  `beb8be8baefe2faa78356e2dc44983735b855535c21cd5f0172a8e1e3fa665db`.
- Factory directive SHA-256:
  `198f131d4b04c1edab728b85ea6a5e5c5f7f80875866e407a3c93a24aafa5ab4`.
- Launch directive SHA-256:
  `26b1d5ce118982b4b3ba64b44b7fb3e88b0b7ded26a818a775a65bffaa0f2c06`.
- Frozen input lock SHA-256:
  `410010ef635a5e44b205e56c6b38f2d06e5b8e72312f5d63edcb24a5086355e1`.
- The two directive files remain protected untracked owner inputs and are never
  staged.

## Accepted upstream truth

- Q00–Q15 are accepted. Historical implementation and acceptance evidence remains
  immutable under `quant/RECEIPTS/Q*.md` and
  `quant/RECEIPTS/Q*_ACCEPTANCE.md`.
- Q04 replay fixture SHA-256:
  `32e134938d9e2ba5e9f32fb279bfa9bf9c6dcc8abe0d220107382d7f78fa6aec`.
- Q06 feature golden SHA-256:
  `06c81655ebb61a6311f29f7964d99b6d4dca94d7a1f8c2416d922fda3fcbabb3`.
- Q07 microstructure golden SHA-256:
  `d8308437461b8d6aebd3814ef91044208255f34290ff9d260b167b21723f4ce3`.
- Q12 ensemble golden SHA-256:
  `88382d291f6d0ddb4443888df80ce1d03bc893790ca746d13237b23b58d2bb77`.
- Q13 data-sufficiency SHA-256:
  `126e27674a99f18accfc21638cbb5bdb1d1bda0f563a03284a7e4ad75665365d`;
  deep work remains `FAIL_DATA_INSUFFICIENT` / `REFERENCE_ONLY`.
- Q15 campaign SHA-256:
  `24debb2a96b91338d937b67878c75be2ef38615880c9c0ad8cd30590ac0bd11b`;
  cards SHA-256:
  `0457f22f9b713955f654d99b7dcfe9795d84c71c7ec8baf5a927e007d5a08fb5`.
  `logistic:v1` is recorded champion, but every accepted card has
  `loadableModelPayload=false` and final posture `ABSTAIN_UNKNOWN`.
- Dependency lock SHA-256:
  `716a9d0208f449bba51cde7fd67f9c90206ab0724aeac86ba862e119be859d29`.
- Frozen schema SHA-256:
  `229af0ff13d600c7d305c6deb7f57b61bdb6f8a35f6f2349d91f5ab1b4972f1c`;
  frozen fixture SHA-256:
  `c42a4257ea5f46abb38ec9ab4e56983e7049cdf5b448150a4d4647a6234d99a4`.

## Accepted Q16 truth

- Task: `quant/TASKS/Q16.md`; status complete; SHA-256
  `5b98e966af7fcc40ef540b20e9f22828d74c4b00dde7eaaaa407120e7c51b0d0`.
- Decision: `quant/DECISIONS/Q16-001-LOCAL-INFERENCE.md`; authoritative C16
  SHA-256
  `eac813f4e07c72915e06ee3bd707b0d7a9c71951c1c9fb2bad9a387e345d2d`.
- Design: `quant/docs/Q16_INFERENCE_PROTOCOL_DESIGN.md`; SHA-256
  `a4e96d377cfe4f0557bd4ec6535f96b2be6d9549020ec246a97adcb1ab93e316`.
- Generated raw fixture SHA-256:
  `0fa1b812d50d668301d25129efb1639a06a71824961f910d046c9935b8580a6f`.
- The exact six-stage chain is `RAW -> EVIDENCE -> FEATURES -> MODELS ->
  CALIBRATION -> ASSESSMENT`; every stage has a deterministic SHA-256 parent link.
- Accepted source event and receive times come from Q04 truth. Cutoff, generation,
  injected evaluation time and expiry cannot rewrite them. Stale, future-ambiguous
  or expired consumption yields explicit safe abstention.
- The serving manifest pins exact Q04/Q06/Q07/Q12/Q13/Q15/dependency identity,
  the complete imported Q06/Q07 source closure and all eight Q16 inference source
  files. Kind, media, path, schema, version, size and digest are verified against
  current accepted bytes.
- Serving lineage is opaque and field-sealed. Original, copied, mutated or
  dataclass-replaced seals cannot create `AVAILABLE`, `ADVISORY`, calibration-ready
  or deep-pass truth.
- The current model payload and model output are unavailable. No score, probability,
  prediction or net expected value is fabricated. Final action is
  `ABSTAIN_UNKNOWN`; net economics are `UNKNOWN`; health is `DEGRADED`; readiness is
  `SAFE_ABSTAIN_ONLY`; streaming is `NOT_JUSTIFIED`.
- UDS parent/socket modes are `0700`/`0600`; startup races never unlink a foreign
  winner; cleanup is device/inode bound. Optional TCP permits only literal
  `127.0.0.1` or `::1`.
- Local handlers, request bytes, response bytes, batch, queue, concurrency and time
  are bounded. Request responses remain correlated. Late inference is quarantined
  behind the concurrency semaphore; pre-frame handler creation is bounded; close
  stops the server and performs identity-safe cleanup.
- Generated Python and Node clients preserve raw request bytes, reject unsafe
  object integers, apply I/O timeouts, strict decode, embedded frozen-schema
  validation and fail-closed assessment/health/error semantics.

## Generated Q16 evidence

- `edge_assessment.v1.json` is protocol-canonical and advisory-only.
- `market_evidence.v1.json` binds accepted Q04 replay truth.
- `serving_manifest.v1.json` binds 32 exact accepted/source identities.
- `request_assess.v1.json` retains Q04 nanosecond integers byte-for-byte.
- `response_assess_wrapped.v1.json` is a complete local wire response fixture.
- `python_client_v1.py` and `node_client_v1.mjs` are strict local clients.
- `inference_campaign.v1.md` contains startup, trusted-clock, UDS, client,
  operation, timeout, shutdown and fail-closed integration instructions.
- `protocol_kit_manifest.v1.json` hashes every generated Q16 file except itself.

Exact current hashes are recorded in immutable `quant/RECEIPTS/Q16.md`, with its
single stale decision-document hash corrected fail-closed by the immutable
acceptance receipt. Implementation receipt SHA-256:
`b3b08998bfc3450de2b3502defca482cb6759f6cfe44a4cbb9f2e95d43fea5d6`;
Git blob `26d1c16390c9d7763969e5abb8eb42d8591af020`.

## Completed Q17 truth pending exact C17 verification

- Activation commit: `ba7323e0ac1f5013d9309b5b73998b84bdffbae5`; tree
  `976feb81db7ad9d7bbc2ea48819dc500afcf5a1f`; exact parent A16.
- Task: `quant/TASKS/Q17.md`; status complete/ready for independent commit
  verification; SHA-256
  `03d489ce5b0583dab2ec2a96380519535a2547ee78743d1794622cfc4a30c80e`.
- Decision SHA-256:
  `93cb9448846e0eb8fcc5d9160e822cd3fffe55256651f3e18579b815a8dda612`.
- End-to-end design SHA-256:
  `bd5ce7d8f6be2a5f1b43cee111e10a85c6d890503e0ac6a9371ef70bc4f268fa`.
- Non-self-referential implementation receipt SHA-256:
  `057617ed928bc61964a38efc22e185a65f2b5c4a14215928c8d228b4626db32f`.
- Exact replay runs twice from accepted Q16 bytes, matches all six committed stage
  identities and the protocol-valid assessment SHA-256
  `10d4a858ac08c29b03ab3df6476b7eb6830359581d00791a229ccd765b369329`.
  Pipeline SHA-256 is
  `a48da64bd2fe055545c496595d01278cfc74f655f7fb334205162e8a07d4b1a9`.
- Corruption, stopped-gap prefix, expired/future consumption and semantic lineage
  mutations reject or return explicit safe abstention. Final action remains
  `ABSTAIN_UNKNOWN`; predictions, scores, probabilities and gross estimate are
  absent; net economics are `UNKNOWN`.
- Accepted research evidence remains `DATA_INSUFFICIENT`; edge is
  `NOT_ESTABLISHED`. The Q10 receipt's quantile best-index `11` versus both machine
  artifacts' `7` is preserved as a documentary erratum. Q14 is its own synthetic
  fixture comparison, not Q10/Q11 validation. Q15 remains non-loadable.
- One actual benchmark observation records three samples after two warmups. Warm
  single p50 is `3,349,209 ns`; focus-25 p50 is `89,467,750 ns`; candidate-128
  p50 is `464,945,042 ns`; universe/watch-452 p50 is `1,614,296,000 ns`.
  Child self peak RSS is `66,551,808` bytes within the provisional 8 GiB ceiling.
  The rows are copies of one synthetic BNBUSDT fixture; current universe, event
  trace and numeric latency promotion target remain `UNKNOWN`.
- Syntax-aware scanning covers 152 source files plus the campaign with zero
  findings. Nine frozen file identities match. The generated scope proof is a
  declared expected inventory only; actual Git scope is reserved for the C17/A17
  receipts.

## Generated Q17 evidence

- Accepted research projection SHA-256:
  `e9f2de26df495538edf7c57db0edbf334dc1929456a2d23128e32fada4f03a7c`.
- Benchmark SHA-256:
  `6bd88082677513808145025272dab2c617df4e932df9b9d9d0e1619fa0cba788`.
- Component manifest SHA-256:
  `8269709a143d2720d70362eb213876e588d7ddb6a813226c2cf92cb52dcdaedd`.
- End-to-end proof SHA-256:
  `4831a31105f7e87099a75062e412c7fbc73f626ea3c4c00b8c8ddf8360b40f73`.
- Fault campaign SHA-256:
  `ed0d763343bef2671af0adab24abf1c7f0a96f45eadb37b6d36d7fcb4255f425`.
- Integration instructions SHA-256:
  `ad64875b533369c4dca1d7f7e30685fe2e5962e0b5f67d5f0f2cb9e53f030a79`.
- Security/scope SHA-256:
  `fb7affcb837349b5225e866ba301d4ef3bddaa9041667ff8119acf8f900ec229`.
- Self-excluding artifact manifest SHA-256:
  `c5574c79cbd9450e6a890b67ade9a6c71e2f1fb9574e71c0eaec3057c545e1b2`;
  it contains seven exact current rows.
- Generated component evidence binds activation/current task truth separately and
  truthfully marks C17/A17 pending.

## Verification evidence

- Restored baseline at director Q13 merge `3ed8e38`: `2455 passed, 6 skipped in
  85.01s` under pinned CPython 3.13.14, uv 0.11.28 and `models` extra.
- Exact-C16 clean archive SHA-256:
  `7c5073166795ee3dd7f88d3f5e71bbe4e4942ebfb18dfd440c7894cc24763621`.
- Q16 focused: `172 passed`; combined `quant_edge.inference` branch coverage
  `95.50%` over 1,374 statements and 514 branches; required threshold 95% passed.
- Accumulated Q suite after final corrections: `2627 passed, 6 skipped in 62.15s`.
  Four Q08 and two Q15 skips are the documented shard-branch-only scope laws.
- Ruff lint/format and strict mypy over the Q16 implementation/tests: clean.
- Complete static gate before final correction: 310 files clean; the final Q16
  focused static gate is also clean.
- `uv lock --check`: 68 packages resolved; no lock change.
- Registry verification: exit 0. Frozen protocol: `22/22`. Q00 scope guard:
  `6/6`.
- `npm test`: exit 0; typecheck/build and all deterministic server/web checks pass.
  Vite's existing chunk-size warning is non-failing.
- Clean archive accumulated suite: `2627 passed, 6 skipped in 65.13s`; Ruff and
  format-check clean over 310 files; strict mypy clean over 310 files; lock,
  registry, protocol and Q00 gates all passed.
- Generation is byte-identical across CWD, timezone and hash-seed changes. Node and
  Python canonical hashes agree over frozen fixtures and deterministic numeric
  vectors.
- Independent protocol review: acceptance-ready. Independent transport review:
  clear. Final lineage/body-version quality recheck: acceptance-ready. Every
  reproduced finding has a regression in `quant/tests/q16/**`.
- Q17 focused after final artifact capture: `384 passed in 32.80s`; combined
  `quant_edge.final_proof` branch coverage `96.50%` over 2,959 statements and 960
  branches; required threshold 95% passed.
- Stable Q17-era categories, recorded separately: unit `1,273`; property `81`;
  contract `517`; leakage/validation `237`; replay `189`; Q16/Q17 integration
  `279`; benchmark `121`.
- Accumulated quant suite after final implementation corrections: `3,011 passed,
  6 skipped in 81.50s`; the skips remain the documented Q08/Q15 shard-branch
  scope laws.
- Mutable static scope `src tests scripts`: Ruff lint/format clean over 325 files;
  strict mypy clean over 325 source files. The immutable generated Q16 client is
  intentionally not reformatted.
- Q04 temporary campaign, Q16 deterministic builder `11/11`, Q17 artifact
  validation, dependency lock, registry, frozen protocol `22/22` and Q00 scope
  `6/6` all pass.
- Root `npm test` and `npm run test:all`: exit 0. The latter's terminal integration
  group reports `180 passed, 0 failed`.
- Independent adversarial reviews of replay/evidence/components, benchmark,
  security and generation report no remaining material finding after corrections.

## Scope and safety

- C16 contains exactly 32 changed regular `100644` paths, all under `quant/**`.
  Frozen registry/protocol/input-lock and accepted Q00–Q15 bytes remain unchanged.
- Exact verification found one stale Q16 decision SHA in the immutable C16 receipt;
  `quant/RECEIPTS/Q16_ACCEPTANCE.md` records the authoritative hash and preserves
  the original receipt rather than rewriting history.
- No Main, other worktree, merge or push is touched.
- No environment/secret read, public listener, external network source, private or
  signed exchange call, unsafe deserializer, order, test order, borrow/repay,
  transfer, withdrawal, leverage/margin, capital, risk or execution authority was
  added. `LIVE_EXECUTION_NOT_IMPLEMENTED` remains untouched.
- Q16 is `SYNTHETIC_ONLY`. It proves deterministic plumbing and safe abstention, not
  edge, observed-market validity, production performance, calibration quality,
  capacity or permission to act.
- Expected C17 scope is exactly 28 regular `100644` files under `quant/**`, with
  path-set SHA-256
  `604cdd885b4b61211b5408bf6abadb36382fb79b2b52d015ba459521fd33f8c6`.
  Actual staged/committed path and mode truth remains pending Git verification.
- Q17 adds no environment/secret read, external listener/source, unsafe loader,
  private/signed exchange call, order, test order or money/risk/execution authority.
  UDS/literal-loopback-only Q16 transport remains the only serving boundary.
- Q17 is `SYNTHETIC_ONLY` / `DATA_INSUFFICIENT`. Passing proof and benchmark
  machinery do not establish edge, production performance or permission to act.

## Completed Q17 contract pending commit acceptance

- Task: `quant/TASKS/Q17.md`; status complete/ready for independent commit
  verification; SHA-256
  `03d489ce5b0583dab2ec2a96380519535a2547ee78743d1794622cfc4a30c80e`.
- Activation parent is Q16 acceptance A16. Activation commit is
  `ba7323e0ac1f5013d9309b5b73998b84bdffbae5`.
- Exclusive writes: `quant/src/quant_edge/final_proof/**`, `quant/tests/q17/**`,
  `quant/scripts/q17_acceptance_campaign.py`, `quant/generated/q17/**`, Q17
  task/decision/docs/receipts and this quant state only.
- Q17 composes accepted owners for deterministic end-to-end replay, fault proof,
  accepted research-evidence projection, actual benchmark/resource measurement,
  AST-exact security/scope proof and the final component/artifact manifests.
- The benchmark uses the Q00 fixed synthetic universe/focus load shape and 8 GiB
  provisional ceiling. Current point-in-time universe, retained event-rate trace and
  numeric latency promotion targets remain `UNKNOWN`.
- No Q17 result can promote Q13/Q15/Q16 truth. The final advisory action remains
  `ABSTAIN_UNKNOWN` unless accepted upstream bytes themselves change through a
  future director-controlled phase.
- C17/A17 are not embedded in generated evidence. C17 must prove exact Git scope;
  A17 must bind exact C17 and its clean-archive results.

## Exact next task

1. Remove only Q17 transient coverage/bytecode artifacts; preserve both protected
   untracked owner directives.
2. Stage exactly the declared 28 C17 paths, verify cached path set, regular `100644`
   modes, diff checks, scope gate and frozen bytes, then commit C17.
3. Verify exact C17 Git identity and run the full acceptance gate from a clean
   archive importing archive source only.
4. Create separate A17 with only `quant/RECEIPTS/Q17_ACCEPTANCE.md` and this state
   at generation 39; freeze HEAD at `LANE_READY — PARKED FOR DIRECTOR AUDIT`.
   Never push.

## Resume read order

1. Root `STATE.md`, `MISSION.md`, `ARCHITECTURE.md` Part II and `DIRECTOR.md`.
2. The two launch directives, frozen protocol inputs and
   `quant/DIRECTIVE_INPUTS.lock`.
3. This state, `quant/TASKS/Q17.md`, Q17 implementation receipt and immutable Q16
   implementation/acceptance receipts.
4. Confirm branch/HEAD, protected untracked inputs, frozen hashes and scope before
   resuming Q17 implementation or verification.
