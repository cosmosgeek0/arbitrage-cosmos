# QUANT EDGE RESEARCH FACTORY — durable build state

State generation: `42`

Updated: 2026-07-18T09:14:15+0530

Status: `HISTORICAL LANE_READY — POST-ACCEPTANCE CORRECTIONS PENDING`.
Historical Q02/Q05/Q08/Q16 and C17/A17 acceptance remains immutable. Money-truth
F-034/F-038/F-039, RB-13 and final-hunt Q06/Q07/Q09/Q11/Q12/Q14/Q15/Q16 changes
alter owner/projection bytes after those acceptances; the corrections do not
inherit them. No immutable phase receipt attests the current corrected bytes, and
independent exact-commit verification remains pending. No merge or push is
authorized.

Program: Q lane — deterministic research evidence, labels, models, calibration,
uncertainty and advisory-only local inference.

## Current Q02/Q05/Q08 money-truth correction truth

- Corrections `MONEY_TRUTH_Q02_INSTRUMENT_UNIT_IDENTITY`,
  `MONEY_TRUTH_Q05_DIRECTIONAL_LABEL_ECONOMICS` and
  `MONEY_TRUTH_Q08_EXECUTABLE_BASIS_ECONOMICS` are implemented current bytes with
  acceptance state `NOT_ACCEPTED`. Their re-attestation commit/tree deliberately
  remains `PENDING_NOT_EMBEDDED`.
- Q02 retains historical source seal `9d1429b33176e4f8726032243741af9e532ca36798610e08ea129eccc35bd64c`;
  current F-039 source seal is `3d755d7255a030528008e22b590f33b8355d87f74ed68620825ba245c1ff9bfc`.
  Its 3,198-byte primary fixture is unchanged at
  `01b648ee6ae5f9d4dbba345b775d4f19b4d1ce2276036d9161554c73ab8f49ba`.
- Q05 retains historical source seal `fb3fc6571a45e330499c52000672c9f6e6819f3b12e03f42506546e85b31fe12`
  and 4,184-byte primary `f36a9b089fe2c935c08f6f67e8b7debcf40b8d67cde46ae73271835b725afe47`.
  Current F-038/F-039 source and primary are
  `d8c5709d1c1caace7c32e9d58c32648e940b14804ff18aaca5245ec6f538bed7`
  and `c82cf92d68bebcfbc5d818de667b9ca50714e7cffbeac331fe06176899c6709e`.
- Q08 retains historical source seal `0224276b1a356696eab857aea38d40d8956491761a9e0012a0298cb9e3448d74`
  and 1,204-byte primary `d2054e47d0050ef521d91f653b9ab6f60411a2d2f0633933c7ec65e76145525b`.
  Current F-034/F-038/F-039 plus pending FIX-017 source and primary are
  `46ceb4f5d530e1d3f2ed38dd634989debe84d1926a35497fafc260a7afaf2bb7`
  and `3a2a912ccecdd9fb893d798c38b4cc40d2f4821465fd2d3e82987b7449c654a8`.
- Exact fix commits are F-034 `19f674a35944f1f3fdd4fdafd396fba9df6fd255`,
  F-038 `42e431fbc8ee8823cba826f759737ce3b3f52465` and F-039
  `039c3866619c3e3af9533c651284af32a7bc114d`. The previously attested
  correction chain ends at F-039 tree `6724c8fa53fb74df5ef840d37ca3de8364b7c64f`; current
  Q08 bytes additionally contain FIX-017, whose commit/tree deliberately remain
  `PENDING_NOT_EMBEDDED` until independent verification. Director merge
  `5f887cf27ce246d80b7fc553eed470b015976963` / tree
  `813a383df420e318dc97522c860d6b1e6b99aab4` integrates that chain without
  creating new Q-phase acceptance.
- Q17 component-manifest focused verification is `43 passed`; the complete Q17
  suite is `405 passed`. The canonical campaign regenerated and validated all
  eight current proof-kit artifacts; generated JSON was not hand-edited.

## Current cumulative final-wave post-acceptance correction truth

- Q16 correction: `Q16_CUMULATIVE_POST_ACCEPTANCE_CORRECTION`; implementation state
  `CORRECTION_IMPLEMENTED_PENDING_INDEPENDENT_VERIFICATION`; acceptance state
  `NOT_ACCEPTED`; amended commit/tree deliberately remain
  `PENDING_NOT_EMBEDDED` to avoid self-reference.
- Q06/Q07/Q09/Q11/Q12/Q14/Q15 carry the same `NOT_ACCEPTED`, pending exact-commit
  posture. Their current source seals are respectively `67f64bff…`, `f7e0cdf5…`,
  `2592c0ab…`, `5d9d0e2c…`, `284a22a9…`, `5f537f1b…` and `0e7a58f1…`.
- Q07/Q11 current primary evidence is `6b5ad2e2…` / 26,326 bytes and
  `6d35ef2d…` / 18,709 bytes. Q12 historical campaign/golden pins
  `ad9d9b1f…` / `88382d29…` remain separate from current `3230b579…` / 2,376
  bytes and `28d657a8…` / 153,683 bytes. Q15 historical campaign/cards
  `24debb2a…` / `0457f22f…` remain separate from current `1b93c4ce…` / 4,425
  bytes and `88554771…` / 16,676 bytes.
- Historical accepted Q16 source seal remains
  `6c67b5bf2488e3b13e5c5fc72a2b613d0ed74fb00a14f635ab71444f7c6d321a`.
  Current cumulative inference source seal is
  `b16710dfdeaf1d2792d0b62d2805f91c425ce4db5c9f13a6a4282f74b407a20d`;
  current service SHA-256 is
  `763e08352e201ce7173c16a6a72cd413c7feac58ca7e624a3d94dab4eb70fb68`.
- Each assessment now uses a disposable `spawn` child and an 80-byte atomic,
  request-correlated header followed by a length- and SHA-256-bound body. The parent
  reads the raw pipe descriptor nonblockingly while watching the child sentinel,
  deadline and close signal. Partial, malformed, trailing or nonzero-exit results
  are discarded and the child is boundedly terminated/killed/reaped before the
  sole work slot is released.
- Current regenerated Q16 inference-campaign SHA-256:
  `a66c2c1e4e500c90a7aa01a4c35144aed7d83735365f4130a5c66740196946b4`;
  serving-manifest SHA-256:
  `2bcd1b5b19430e87229d8be28a73d8c1211e2d4a07a3dbae59512e52d0be06c6`;
  protocol-kit-manifest SHA-256:
  `faf9ddc1dd45fc160299a0d491af4deca9ad4ae794083012eaa8ba675024f91d`.
- Current Q16 decision SHA-256:
  `88332cc8ab64825363b3b9a4f6f89d2ca24d03f4a04e35179793836f832ae49b`;
  current Q17 decision SHA-256:
  `604f84449351cd6ce8060ed33294450d925a9c565c03c3a71e280c8bc6d0bd19`;
  current Q17 design SHA-256:
  `ff2992c8d1edf5ba6c0641336d240c5bd04ceef323dadba23021e0e9ae635c70`.
- Prior RB-13 benchmark observation: warm-single p50 `124,242,416 ns`,
  focus-25 p50 `218,822,334 ns`, candidate-128 p50 `983,502,125 ns`,
  universe/watch-452 p50 `3,711,352,291 ns`, child peak RSS `58,949,632`
  bytes. These are fresh pending measurements, not historical A17 measurements.
- Current combined-correction benchmark observation: warm-single p50
  `132,974,584 ns`, focus-25 p50 `223,359,916 ns`, candidate-128 p50
  `998,414,791 ns`, universe/watch-452 p50 `3,654,287,250 ns`, child peak RSS
  `67,698,688` bytes. These are fresh pending measurements, not historical A17
  measurements.
- Current generated Q17 SHA-256 values: benchmark
  `46727b85e53e8d50382fd74c39d06d495b60dae8ad2db2fd46593fe720526418`;
  component manifest
  `127687fb4b8886d893465a3e7d2787e364ca7e59f8085354bd6c2640868656fc`;
  security scope
  `eaadef6587de309e5ff91b5c98ae12d4d4092df8067559d6ac3285cfa253ccaa`;
  self-excluding artifact manifest
  `0246146f30ed665c5abf5c79eb144ad235c8c6f93e9ff573ca18ab9bd9b7eb45`.
  The last digest is mutable pending-correction evidence, not an acceptance seal.
- Historical directive-input lock acceptance remains
  `410010ef635a5e44b205e56c6b38f2d06e5b8e72312f5d63edcb24a5086355e1`
  / 1,568 bytes. The current file is explicitly reported as the known
  `d4bf31826625c2602ebb7ed72194e94a4571f7597a413ca545839f236c7a5a24`
  / 1,757-byte post-acceptance mismatch. Historical package-lock acceptance remains
  `3c97820f912390fcad3dab57b436319b95c15bc7877384dd98032d7751ec2fcf`
  / 147,793 bytes; current is the exact `59e4151191058e0bea3c82356e4b90ff84538cc1a62066104f05498d4f60b353`
  / 147,256-byte mismatch. Neither historical pin was silently repinned; current
  frozen evidence has seven matches, exactly two declared mismatches and remains
  intentionally non-clean.
- Current focused Q17 verification is `405 passed`; prior RB-13 Q16 verification
  was `200 passed`, 96% combined branch coverage. The hostile
  regression writes a valid header and seven body bytes, stalls forever, and proves
  deadline return, child termination/reap, work-slot recovery and subsequent health.

## Frozen launch and ancestry

- Worktree: `/Users/cosmosgeek/Desktop/quant-edge-research-20260712`
- Branch: `quant-edge-research-factory-20260712`
- Accepted Q17 implementation C17:
  `4cc83f43edd9a50ff2d3e20970a57e2d0a57e92a`; tree
  `1aec7711f64419d50770d9c515d012173e982240`; exact parent Q17 activation
  `ba7323e0ac1f5013d9309b5b73998b84bdffbae5`.
- Q17 acceptance receipt SHA-256:
  `9cfa0356228d7f48674df2d9db523f0f0d53dab1a4e4255b6ba9676e463ec5dc`.
  A17 is the first commit containing that non-self-referential receipt and this
  generation-39 state; its exact SHA is reported externally after commit.
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
- Historical C16 decision SHA-256:
  `eac813f4e07c72915e06ee3bd707b0d7a9c71951c1c9fb2bad9a387e345d2d`.
  The current decision carries a clearly labeled cumulative post-acceptance
  amendment; its pending hash is recorded in the final-wave section above.
- Design: `quant/docs/Q16_INFERENCE_PROTOCOL_DESIGN.md`; SHA-256
  `a4e96d377cfe4f0557bd4ec6535f96b2be6d9549020ec246a97adcb1ab93e316`.
- Generated raw fixture SHA-256:
  `0fa1b812d50d668301d25129efb1639a06a71824961f910d046c9935b8580a6f`.
- The exact six-stage chain is `RAW -> EVIDENCE -> FEATURES -> MODELS ->
  CALIBRATION -> ASSESSMENT`; every stage has a deterministic SHA-256 parent link.
- Accepted source event and receive times come from Q04 truth. Cutoff, generation,
  injected evaluation time and expiry cannot rewrite them. Stale, future-ambiguous
  or expired consumption yields explicit safe abstention.
- The historical accepted serving manifest pins exact
  Q04/Q06/Q07/Q12/Q13/Q15/dependency identity, the complete imported Q06/Q07
  source closure and all eight historical Q16 inference source files. The
  cumulative final-wave correction regenerates a separate current manifest; those
  bytes are verified but pending, not relabeled as accepted.
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
  are bounded. Request responses remain correlated. Each assessment runs in a
  disposable explicit-`spawn` worker with one-shot IPC; timeout or close performs
  bounded join/terminate/kill/reap cleanup before releasing the sole work slot.
  Pre-frame handler creation is bounded; close stops the server and performs
  identity-safe cleanup.
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

Historical accepted hashes are recorded in immutable `quant/RECEIPTS/Q16.md`; that
receipt does not attest current cumulative correction source or generated bytes.
Its single stale historical decision-document hash was corrected fail-closed by
the immutable acceptance receipt. Historical implementation receipt SHA-256:
`b3b08998bfc3450de2b3502defca482cb6759f6cfe44a4cbb9f2e95d43fea5d6`;
Git blob `26d1c16390c9d7763969e5abb8eb42d8591af020`.

## Accepted Q17 truth

- Activation commit: `ba7323e0ac1f5013d9309b5b73998b84bdffbae5`; tree
  `976feb81db7ad9d7bbc2ea48819dc500afcf5a1f`; exact parent A16.
- Accepted implementation C17:
  `4cc83f43edd9a50ff2d3e20970a57e2d0a57e92a`; tree
  `1aec7711f64419d50770d9c515d012173e982240`; exact parent activation.
- Exact-C17 archive tar SHA-256:
  `271fedc527a5da2d4096415f72915458e9d7a32f52505c7d9d1e66a50b2f4127`.
- Acceptance receipt: `quant/RECEIPTS/Q17_ACCEPTANCE.md`; SHA-256
  `9cfa0356228d7f48674df2d9db523f0f0d53dab1a4e4255b6ba9676e463ec5dc`.
- Task: `quant/TASKS/Q17.md`; status complete/ready for independent commit
  verification; SHA-256
  `03d489ce5b0583dab2ec2a96380519535a2547ee78743d1794622cfc4a30c80e`.
- Historical accepted decision SHA-256:
  `93cb9448846e0eb8fcc5d9160e822cd3fffe55256651f3e18579b815a8dda612`.
- Historical accepted end-to-end design SHA-256:
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
- The historical A17 benchmark observation records three samples after two warmups. Warm
  single p50 is `3,349,209 ns`; focus-25 p50 is `89,467,750 ns`; candidate-128
  p50 is `464,945,042 ns`; universe/watch-452 p50 is `1,614,296,000 ns`.
  Child self peak RSS is `66,551,808` bytes within the provisional 8 GiB ceiling.
  The rows are copies of one synthetic BNBUSDT fixture; current universe, event
  trace and numeric latency promotion target remain `UNKNOWN`.
- Historical syntax-aware scanning covered 152 source files plus the campaign with
  zero findings and nine matching frozen identities. Current final-wave evidence
  keeps all historical pins and truthfully reports seven matches plus the exact
  directive-lock and package-lock mismatches recorded above. The generated scope proof is a
  declared expected inventory only; actual Git scope is reserved for the C17/A17
  receipts.

## Historical accepted Q17 generated evidence

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
  it contains seven exact rows from the historical A17 kit.
- Historical generated component evidence bound activation/task truth separately
  and marked C17/A17 pending because it predated those commits. Exact Git
  inspection and the acceptance receipt provided the non-self-referential binding.
  The current component manifest instead separates historical acceptance from all
  pending final-wave corrections, as recorded above.

## Verification evidence

- Restored baseline at director Q13 merge `3ed8e38`: `2455 passed, 6 skipped in
  85.01s` under pinned CPython 3.13.14, uv 0.11.28 and `models` extra.
- Exact-C16 clean archive SHA-256:
  `7c5073166795ee3dd7f88d3f5e71bbe4e4942ebfb18dfd440c7894cc24763621`.
- Q16 focused: `172 passed`; combined `quant_edge.inference` branch coverage
  `95.50%` over 1,374 statements and 514 branches; required threshold 95% passed.
- Accumulated Q suite after the final hunt: `3096 passed, 0 skipped in 126.98s`.
- Ruff lint/format and strict mypy over all 325 tracked Python files: clean.
- Complete static gate after the final hunt: 325 files clean.
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
- Exact-C17 archive SHA-256:
  `271fedc527a5da2d4096415f72915458e9d7a32f52505c7d9d1e66a50b2f4127`.
  Explicit import assertions proved `quant_edge`, `quant_edge.inference` and
  `quant_edge.final_proof` resolved inside the extracted archive.
- The first accumulated archive attempt exposed only the absent archived
  `quant/.venv/bin/python` harness path: four Q16 subprocess tests could not launch.
  After linking the pinned interpreter while forcing archive `PYTHONPATH`, import
  isolation was reproved and the suite reran from the beginning.
- Exact-C17 archive focused: `384 passed in 33.72s`, `96.50%` branch coverage.
  Accumulated: `3,011 passed, 6 skipped in 83.57s`.
- Exact-C17 archive stable categories: unit `1,273`; property `81`; contract `517`;
  leakage/validation `237`; replay `189`; Q16/Q17 integration `279`; benchmark
  `121`.
- Exact-C17 archive Ruff/format/mypy are clean over 325 files; lock 68 packages;
  registry eight families; protocol `22/22`; Q00 guard `6/6`; Q04/Q16/Q17
  deterministic evidence exact-current.
- Exact-C17 archive root `npm test` and `npm run test:all`: exit 0; terminal
  integration `180 passed, 0 failed`.

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
- Accepted C17 scope is exactly 28 regular `100644` files under `quant/**`, with
  path-set SHA-256
  `604cdd885b4b61211b5408bf6abadb36382fb79b2b52d015ba459521fd33f8c6`.
  Exact committed-tree and mode inspection passed.
- A17 is restricted to `quant/RECEIPTS/Q17_ACCEPTANCE.md` and this state, both
  regular `100644`. Its commit identity is external to its non-self-referential
  bytes and freezes final HEAD for director audit.
- Q17 adds no environment/secret read, external listener/source, unsafe loader,
  private/signed exchange call, order, test order or money/risk/execution authority.
  UDS/literal-loopback-only Q16 transport remains the only serving boundary.
- Q17 is `SYNTHETIC_ONLY` / `DATA_INSUFFICIENT`. Passing proof and benchmark
  machinery do not establish edge, production performance or permission to act.

## Accepted Q17 contract

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
- C17/A17 are not embedded in generated evidence. Exact C17 Git proof, the clean-
  archive acceptance receipt and externally reported A17 identity complete the
  binding without self-reference.

## Exact next task

1. Preserve historical C17/A17 and both protected untracked owner directives.
2. Hand the current `NOT_ACCEPTED` correction commit/artifacts to a fresh
   independent verifier and director; historical receipts do not attest them.
3. Do not relabel current bytes, merge or push from this lane.

## Resume read order

1. Root `STATE.md`, `MISSION.md`, `ARCHITECTURE.md` Part II and `DIRECTOR.md`.
2. The two launch directives, frozen protocol inputs and
   `quant/DIRECTIVE_INPUTS.lock`.
3. This state, Q17 implementation/acceptance receipts and immutable Q16 receipts.
4. Confirm final A17 HEAD, exact C17 ancestry, protected untracked inputs and frozen
   hashes before any director audit. The builder lane stays parked.
