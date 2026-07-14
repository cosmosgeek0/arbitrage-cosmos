# Q17 acceptance receipt — final Q-lane proof and benchmark

Status: `ACCEPTED — LANE_READY`

Date: 2026-07-13

Accepted implementation commit C17:
`4cc83f43edd9a50ff2d3e20970a57e2d0a57e92a`.

Accepted C17 tree: `1aec7711f64419d50770d9c515d012173e982240`.

Exact C17 parent / Q17 activation:
`ba7323e0ac1f5013d9309b5b73998b84bdffbae5`.

This acceptance receipt and generation-39 state are first contained by the separate
A17 acceptance commit. A17 is intentionally non-self-referential: its commit SHA is
reported externally after commit and is not fabricated inside its own bytes.

## Ancestry and launch authority

- Branch: `quant-edge-research-factory-20260712`.
- C17's exact parent is the Q17 activation commit, whose tree is
  `976feb81db7ad9d7bbc2ea48819dc500afcf5a1f` and whose exact parent is accepted
  Q16 A16 `4ac05802244a194639865a4b615ee2af13dce4e2`.
- Accepted Q16 implementation/acceptance:
  `b3d8cedece8cf3a9f546c60016beae442f85f160` /
  `4ac05802244a194639865a4b615ee2af13dce4e2`.
- Q13 acceptance/director merge:
  `06f0a8f0c722ece6c46f56c62156aec291a77317` /
  `3ed8e38d65812e2eb8ed6eba19e4eb5084c253d1`.
- Q15 acceptance/director merge:
  `e69f6879b5914879b5d9342e3f05fa964f5b9496` /
  `f54180c3a7d014e4d91a0c6b7dc5ea4c3d521754`; merged-lane scope fix
  `c070fdaf7dc568448212067dde5e1fb2ecc21356`.
- Director board evidence remains `git show 1fec867 -- QL_PARALLEL_DAG.md`; it
  authorizes Q16 -> Q17 -> `LANE_READY` and is evidence, not lane ancestry.
- Frozen protocol commit
  `73e1a1ff7daa48df8dac45713fc5f106842edafc` remains an ancestor.

## Exact C17 Git proof

Deterministic Git inspection used `git show`, `git diff-tree`, `git ls-tree` and
`git diff-tree --check` against exact C17.

- C17 contains exactly the 28 paths declared in `EXPECTED_C17_PATHS` and the
  implementation receipt; path-set SHA-256 is
  `604cdd885b4b61211b5408bf6abadb36382fb79b2b52d015ba459521fd33f8c6`.
- Every old/new changed mode is regular `100644`; all paths are under `quant/**`.
- `git diff-tree --check C17^ C17`: exit 0.
- No protocol, registry, directive lock, dependency lock, accepted Q00-Q16 owner,
  root, Main or other-worktree path changed.
- The two owner directives remain protected and untracked with SHA-256 values
  `26b1d5ce118982b4b3ba64b44b7fb3e88b0b7ded26a818a775a65bffaa0f2c06`
  and `198f131d4b04c1edab728b85ea6a5e5c5f7f80875866e407a3c93a24aafa5ab4`.

Committed identity evidence:

- Q17 implementation receipt SHA-256:
  `057617ed928bc61964a38efc22e185a65f2b5c4a14215928c8d228b4626db32f`;
  Git blob `8f4cf9cea5f1751ae30d4b00e552825de54a9a9c`.
- Generation-38 state SHA-256:
  `a5932b8aa35dd2ee0f3f18452423c4a55652f861e44d4ed76182e3317dd8aba8`;
  Git blob `90b14f4ccb5bbce7298360472790f84aba20dda8`.
- Completed Q17 task SHA-256:
  `03d489ce5b0583dab2ec2a96380519535a2547ee78743d1794622cfc4a30c80e`;
  Git blob `a9b4e24f63f6a8530dba7f7387e492f743a62627`.
- Q17 decision SHA-256:
  `93cb9448846e0eb8fcc5d9160e822cd3fffe55256651f3e18579b815a8dda612`;
  Git blob `7d34ab0e8daf32133342985f7308c3fa03cfb695`.
- End-to-end design SHA-256:
  `bd5ce7d8f6be2a5f1b43cee111e10a85c6d890503e0ac6a9371ef70bc4f268fa`;
  Git blob `0efa432cf6a8ffbf10abcbd958123de25fb7e989`.

## Clean-archive construction and import isolation

The exact command `git archive --format=tar --output=<tarball> C17` produced a tar
with SHA-256:

`271fedc527a5da2d4096415f72915458e9d7a32f52505c7d9d1e66a50b2f4127`.

It was extracted to a new non-worktree directory with no `.git`. Python commands
used the accepted pinned CPython 3.13.14 environment and forced the extracted
`quant/src` first through `PYTHONPATH`. Before testing, an import assertion resolved
these modules inside the extracted archive:

- `quant_edge/__init__.py`;
- `quant_edge/inference/__init__.py`;
- `quant_edge/final_proof/__init__.py`.

The archive initially had no `quant/.venv`, as expected. The first accumulated run
therefore reported four infrastructure failures (`3,007 passed, 6 skipped, 4
failed in 83.86s`) when Q16 subprocess tests tried to launch the absent path
`quant/.venv/bin/python`. No assertion against implementation behavior failed.

The harness was corrected by symlinking only `quant/.venv` to the pinned interpreter
environment while retaining the archive `PYTHONPATH`. A separate subprocess import
assertion again proved `quant_edge`, `quant_edge.inference` and
`quant_edge.final_proof` resolved inside the archive. The full suite was then rerun
from the beginning and passed. Root `node_modules` was likewise linked only as a
dependency runtime for root builds/tests; application source and build outputs came
from the archive.

The Q00 scope-guard self-test needs a Git top level. It was run from a second
extraction of the same tar after initializing an otherwise empty temporary Git
repository; the six tests copy and attack the exact archived guard. That temporary
repository was removed after the test.

## Exact-C17 archive verification

Unless labeled root, Python/static commands ran from the extracted `quant/`
directory with archive `quant/src` forced first. Root JavaScript commands ran from
the extracted repository root.

- Q17 artifact validation: seven exact self-excluding manifest rows;
  `ABSTAIN_UNKNOWN` / `ADVISORY_ONLY`; regenerated deterministic content equals
  committed bytes without remeasuring benchmark equality.
- Focused Q17 coverage:
  `384 passed in 33.72s`; 2,959 statements / 960 branches; `96.50%` combined branch
  coverage; required threshold 95% passed.
- Complete accumulated quant suite after harness correction:
  `3,011 passed, 6 skipped in 83.57s`. Four Q08 and two Q15 skips are the documented
  shard-branch-only scope laws.
- Stable categories, run separately from archive: unit `1,273 passed in 26.07s`;
  property `81 passed in 6.24s`; contract `517 passed in 22.89s`;
  leakage/validation `237 passed in 3.47s`; replay `189 passed in 1.73s`;
  Q16/Q17 integration `279 passed in 10.33s`; benchmark `121 passed in 12.42s`.
- `ruff check src tests scripts`: clean. `ruff format --check src tests scripts`:
  325 files already formatted. `mypy --strict src tests scripts`: no issues in 325
  source files.
- `uv lock --check`: 68 packages resolved; no lock change.
- Registry entrypoint: exit 0; eight families (`5 DATA_INSUFFICIENT`, `2 RESEARCH`,
  `1 UNTESTED`).
- Frozen protocol entrypoint: `22/22`, exit 0.
- Q00 scope-guard self-test: `6/6`, exit 0.
- Exact archived Q04 temporary campaign: fixture
  `32e134938d9e2ba5e9f32fb279bfa9bf9c6dcc8abe0d220107382d7f78fa6aec`,
  campaign `e9cd85c0958d8471066d82744a46aa3df3e50fe7cbe426f2ea503aefa88e7334`,
  Markdown `321cb6c29106f20430406e95b8720b2e394a8d9c3ac4786a3c5e60a16b614b9e`.
- Q16 deterministic generation: `11/11` committed artifacts exact-current without
  rewriting the archive.
- Root `npm test`: exit 0; typecheck, builds and deterministic server/web checks
  pass. The existing Vite chunk-size warning is non-failing.
- Root `npm run test:all`: exit 0; the terminal integration group reports
  `180 passed, 0 failed`.

The immutable C17 receipt contains the complete exact command ledger and live-tree
results. This acceptance run independently reproduced its material gates from C17
bytes.

## Accepted proof and measured benchmark

- Exact Q16 raw/request bytes replay twice through
  `RAW -> EVIDENCE -> FEATURES -> MODELS -> CALIBRATION -> ASSESSMENT`.
- All parent identities and the complete pipeline match committed Q16 goldens.
  Pipeline SHA-256:
  `a48da64bd2fe055545c496595d01278cfc74f655f7fb334205162e8a07d4b1a9`;
  assessment SHA-256:
  `10d4a858ac08c29b03ab3df6476b7eb6830359581d00791a229ccd765b369329`.
- The frozen protocol validates the final `EdgeAssessmentEnvelopeV1`.
- Corruption, stopped-gap prefix, expiration, future ambiguity and semantic
  mutations reject or remain explicit safe abstention.
- Accepted research projection remains `DATA_INSUFFICIENT`; edge is
  `NOT_ESTABLISHED`; Q10's `11` versus machine-artifact `7` best-index conflict is
  an explicit documentary erratum; Q14 remains its own synthetic comparison; Q15
  remains non-loadable.
- Captured benchmark SHA-256:
  `6bd88082677513808145025272dab2c617df4e932df9b9d9d0e1619fa0cba788`.
  It is validated as one actual observation rather than remeasured for byte
  equality. Warm-single/focus/candidate/universe-watch p50 values are respectively
  `3,349,209`, `89,467,750`, `464,945,042` and `1,614,296,000 ns`.
  Child self peak RSS is `66,551,808` bytes within the provisional 8 GiB ceiling.
- The benchmark uses distinct copies of one synthetic BNBUSDT fixture. It is not a
  current 452-symbol universe or event trace. Numeric promotion latency, observed
  capacity and production performance remain `UNKNOWN`.

## Final artifact kit

- Accepted research evidence:
  `e9f2de26df495538edf7c57db0edbf334dc1929456a2d23128e32fada4f03a7c`.
- Benchmark:
  `6bd88082677513808145025272dab2c617df4e932df9b9d9d0e1619fa0cba788`.
- Component manifest:
  `8269709a143d2720d70362eb213876e588d7ddb6a813226c2cf92cb52dcdaedd`.
- End-to-end proof:
  `4831a31105f7e87099a75062e412c7fbc73f626ea3c4c00b8c8ddf8360b40f73`.
- Fault campaign:
  `ed0d763343bef2671af0adab24abf1c7f0a96f45eadb37b6d36d7fcb4255f425`.
- Integration instructions:
  `ad64875b533369c4dca1d7f7e30685fe2e5962e0b5f67d5f0f2cb9e53f030a79`.
- Security/scope:
  `fb7affcb837349b5225e866ba301d4ef3bddaa9041667ff8119acf8f900ec229`.
- Self-excluding artifact manifest:
  `c5574c79cbd9450e6a890b67ade9a6c71e2f1fb9574e71c0eaec3057c545e1b2`.

Generated component evidence truthfully marks C17/A17 pending because it predates
both commits. This acceptance receipt, exact Git inspection and externally reported
A17 identity provide the non-self-referential final binding.

## Safety and final classification

Q17 is accepted as deterministic advisory evidence only:

- final action `ABSTAIN_UNKNOWN`;
- evidence `SYNTHETIC_ONLY` / `DATA_INSUFFICIENT`;
- edge `NOT_ESTABLISHED`;
- model payload `UNAVAILABLE_NONLOADABLE`;
- product integration `NOT_CONFIGURED`;
- execution authority false.

There is no secret/environment read, external listener, external data source,
private/signed exchange call, order, test order, borrow/repay, transfer, withdrawal,
leverage/margin mutation, capital, risk, approval or execution path.
`LIVE_EXECUTION_NOT_IMPLEMENTED` remains enforced. Q16 transport remains
UDS/literal-loopback only.

Q17 is `ACCEPTED`. The Q lane is `LANE_READY — PARKED FOR DIRECTOR AUDIT`.
No merge or push is authorized. The sole next action is director inspection and
controlled integration decision on a director-owned branch.
