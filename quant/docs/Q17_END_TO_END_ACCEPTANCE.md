# Q17 end-to-end proof, benchmark and lane acceptance design

Status: `HISTORICAL C17/A17 ACCEPTED — POST-ACCEPTANCE CORRECTIONS PENDING INDEPENDENT VERIFICATION`

Date: 2026-07-13

Q17 is the final Q-lane composition phase. It verifies accepted Q00-Q16 owners,
replays the exact Q16 inference chain, exercises fail-closed faults, projects the
accepted research evidence without promotion, records one measured local benchmark,
and emits exact security/component/artifact evidence. It creates no strategy, model,
calibration, registry, transport, capital, risk or execution owner.

The current file also records post-acceptance correction projections. RB-13 changes
Q16 worker isolation, while F-034/F-038/F-039 change money-truth bytes owned by
Q02/Q05/Q08. Those fixes were integrated by director merge `5f887cf2…`, but none is
covered by the historical phase or Q17 receipts. Current correction bytes and
measurements remain `NOT_ACCEPTED` pending independent exact-commit verification.

The final result is deliberately conservative:

- advisory action: `ABSTAIN_UNKNOWN`;
- evidence posture: `SYNTHETIC_ONLY` / `DATA_INSUFFICIENT`;
- edge claim: `NOT_ESTABLISHED`;
- product integration: `NOT_CONFIGURED`;
- execution authority: `false`.

## End-to-end deterministic proof

The proof starts from exact accepted Q16 raw and request bytes and delegates to the
existing Q16 owners. Two independent calls produce byte-identical canonical output,
match the committed Q16 goldens and preserve the exact six-stage parent chain:

| Stage | Schema | SHA-256 | Parent SHA-256 |
| --- | --- | --- | --- |
| RAW | `Q16RawInferenceFixtureV1` | `0fa1b812d50d668301d25129efb1639a06a71824961f910d046c9935b8580a6f` | none |
| EVIDENCE | `MarketEvidenceEnvelopeV1` | `53f739ce494ad451764174660b207e1890d60b1f62dfef44cf5cf0b5835d639a` | RAW |
| FEATURES | `Q16FeatureSnapshotV1` | `ae943d80b2a6d1c6f9e571e2fd397105fed3694575235e20db2d7c6891180833` | EVIDENCE |
| MODELS | `Q16VerifiedModelStateV1` | `93b35bf8c2e63c0591dde99fdfea6ea77c350f10096027b6ce61420876f16dda` | FEATURES |
| CALIBRATION | `Q16CalibrationStateV1` | `0d246cae13dd0bc8be1d62fe06eae2bad00acfae0c8295ab2603831813e25f0e` | MODELS |
| ASSESSMENT | `EdgeAssessmentEnvelopeV1` | `10d4a858ac08c29b03ab3df6476b7eb6830359581d00791a229ccd765b369329` | CALIBRATION |

The complete pipeline SHA-256 is
`a48da64bd2fe055545c496595d01278cfc74f655f7fb334205162e8a07d4b1a9`;
the exact request SHA-256 is
`8812d64cd653052871d956ecd23222db9cc9d3bc847cc74d0a02db62142e0e4a`.
The frozen protocol validates the final envelope. Predictions and probability maps
are empty, gross estimate is absent, scores are absent and net economics remain
`UNKNOWN`.

The blockers are calibration unavailable, champion payload unavailable, deep data
insufficient, duplicate/reconstructed/gap-history evidence, incomplete economic
truth and accepted registry posture `ABSTAIN_UNKNOWN`.

## Hostile replay and fault proof

The deterministic fault campaign passes fail closed:

- a copied fixture with a forward-gap mutation is rejected before assessment;
- the accepted Q04 prefix observes `COMPLETE -> GAPPED -> RECONSTRUCTING`, an
  empty unusable book, unavailable update ID and a resynchronization trigger;
- an altered forward-gap script is rejected before assessment;
- expired consumption returns `ABSTAIN_UNKNOWN`, `SOURCE_STALE` and
  `ASSESSMENT_EXPIRED`;
- future-ambiguous consumption returns `ABSTAIN_UNKNOWN`,
  `SOURCE_TIME_AMBIGUOUS` and `EVALUATION_PRECEDES_GENERATION`;
- ambiguous lineage, unsupported fixture version, changed source hash, changed
  sequence and altered lifecycle times are all rejected without an assessment;
- symlink, FIFO, hard-link, parent replacement, leaf replacement and same-inode
  rewrite races are bounded and rejected by descriptor-relative readers.

No fault can mint a prediction, score, probability, known economic value or
execution authority.

## Accepted research-evidence projection

Q17 verifies immutable receipt bytes, preserves historical accepted pins, verifies
declared post-acceptance current bytes separately and keeps implementation,
evidence and integration as separate axes. The historical result is
`BUILT_AND_TESTED`, `SYNTHETIC_ONLY` and `NOT_CONFIGURED` respectively; current
corrections do not inherit those acceptances.

- Q10 transparent baselines/challengers are machinery results on synthetic evidence.
  Framework candidates remain `REFERENCE_ONLY`; real-evidence ablation remains
  `DATA_INSUFFICIENT`.
- Q10 has a documentary erratum: its immutable implementation receipt says the
  quantile best-trial index is `11`, while both accepted machine artifacts say `7`.
  Exact machine artifacts control; immutable Q10 evidence is not rewritten.
- Q12 calibration/uncertainty is synthetic-only evidence.
- Q13 remains `FAIL_DATA_INSUFFICIENT`; measured compute budget remains `UNKNOWN`.
- Q14 compares its own synthetic random baseline and informative challenger. It
  does not validate or promote Q10/Q11. Temporal and implausible-skill negative
  controls are rejected as intended.
- Q15 proves the synthetic registry mechanism, but every accepted model card lacks
  a loadable payload. Champion inference readiness is `UNAVAILABLE_NONLOADABLE`.

Therefore passing Q17 machinery does not establish either edge hypothesis.

## Measured local benchmark

`benchmark.v1.json` is one immutable runtime observation, not a deterministic
golden. It uses CPython 3.13.14 on Darwin arm64, three measured samples after two
warmups, `time.perf_counter_ns()` deltas and nearest-rank ceiling percentiles.
Measurements call the parent handler directly with no JSON or socket cost. Every
assessment sample includes explicit `spawn` worker startup, one-shot IPC, inference,
parent validation and bounded reap.

| Shape | Rows/sample | p50 ns | p95 ns | p99 ns | Exact throughput evidence |
| --- | ---: | ---: | ---: | ---: | --- |
| cold object construction | 1 | 9,000 | 25,709 | 25,709 | `1,500,000,000 / 20,167` objects/s |
| warm single | 1 | 124,242,416 | 124,429,167 | 124,429,167 | `8,000,000 / 993,681` items/s |
| deep focus | 10 | 159,596,125 | 160,847,667 | 160,847,667 | `1,875,000,000 / 29,974,237` items/s |
| focus | 25 | 218,822,334 | 219,342,500 | 219,342,500 | `12,500,000,000 / 109,467,507` items/s |
| candidate | 128 | 983,502,125 | 1,036,202,209 | 1,036,202,209 | `384,000,000,000 / 3,002,634,751` items/s |
| universe/watch | 452 | 3,711,352,291 | 3,791,230,541 | 3,791,230,541 | `1,356,000,000,000 / 11,092,977,457` items/s |

The bounded child reports self `ru_maxrss` as 58,949,632 bytes on Darwin, within
the provisional 8 GiB ceiling. Queue saturation is synchronized: three requests
are admitted and completed, one overflow attempt returns queue-full, and service
counters record exactly one queue rejection. The 2,750 ns close observation covers
the parent close signal and an idle worker guard only; it does not prove graceful
transport shutdown or active-worker termination latency.

Benchmark limitations are acceptance facts:

- the 452/128/25/10 shapes are distinct deep copies of one synthetic BNBUSDT
  fixture, not distinct symbols or a current universe;
- no observed event-rate trace is retained;
- the universe and watch rows share one measurement;
- three samples make p95 and p99 the observed maximum under the declared rule;
- the numeric promotion latency target is `UNKNOWN`;
- direct-handler latency includes worker IPC and scheduling but excludes JSON and
  socket transport;
- the result proves neither production capacity nor profitable edge.

## Security, frozen inputs and scope

The syntax-aware security scan covers 152 Python source files plus the Q17 campaign
script and reports zero findings. Exact digest-bound exceptions exist only for the
reviewed frozen protocol subprocess, Q16 local transport, Q16 bounded spawn-worker
lifecycle and Q17 bounded RSS child. Tests attack aliases, `getattr`, subscript
access, dynamic imports, unsafe loaders, unbounded process cleanup, shell/string
subprocesses, network clients and secret/account/order/money calls.

Eight historical frozen identities still match exactly. The accepted directive-
input lock identity remains pinned to `410010ef…` / 1,568 bytes, while the current
post-acceptance file is explicitly reported as the known `d4bf318…` / 1,757-byte
mismatch; it is not silently repinned or called clean. The generated scope artifact
contains only the declared 28-path expected C17 inventory. It truthfully labels
actual staged/committed Git scope as `NOT_MEASURED_RESERVED_FOR_Q17_RECEIPT`; the
immutable receipts must prove actual Git path and mode truth.

## Generated final kit

`quant/generated/q17/` contains seven payload files plus a self-excluding manifest:

- `accepted_research_evidence.v1.json`;
- `benchmark.v1.json`;
- `component_manifest.v1.json`;
- `end_to_end_proof.v1.json`;
- `fault_campaign.v1.json`;
- `integration_instructions.md`;
- `security_scope.v1.json`;
- `artifact_manifest.v1.json`, which lists every other regular file exactly once.

The component manifest keeps historical Q02/Q05/Q08/Q16 identities and accepted
source/evidence seals separate from live post-acceptance correction seals. Q02
retains its unchanged accepted primary while verifying current F-039 source. Q05
and Q08 retain accepted primary metadata while separately verifying current
F-038/F-039 and F-034/F-038/F-039 source/evidence bytes. Every correction row is
`NOT_ACCEPTED`, says immutable receipts do not attest corrected bytes, records exact
fix/director-merge provenance where available, and leaves the amended commit/tree
pending rather than self-referencing. The manifest also binds all other Q00-Q15
identities, director Q13/Q15 merge evidence, base/protocol/frozen truth, Q17
activation and the exact current Q17 task.

## Safe integration boundary

The only acceptable downstream use is read-only advisory inspection. Consumers must
verify exact commits and artifact hashes, preserve frozen-protocol validation, keep
UDS/literal-loopback transport only, reject stale/ambiguous/unavailable truth and
honor `ABSTAIN_UNKNOWN`. There is no permission to enable external networking,
secrets, private exchange APIs, orders, test orders, borrow/repay, transfers,
withdrawals, leverage/margin mutation, capital, risk, approval or execution.

`LIVE_EXECUTION_NOT_IMPLEMENTED` remains enforced. Q17 completion means evidence is
ready for exact C17 verification; it is not yet lane acceptance. Only a separate
clean-archive A17 receipt may mark `LANE_READY` and park the branch for director
audit.
