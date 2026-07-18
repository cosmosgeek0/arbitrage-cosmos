# Q17-001 — final proof, benchmark and lane-seal architecture

Status: historical C17/A17 acceptance; post-acceptance corrections pending independent verification.

## Context

Q17 is the final Q-lane phase. Q00-Q16 already own acquisition evidence, temporal
truth, labels, features, model experiments, calibration, validation, registry state
and local inference. Q17 may verify and compose those owners; it may not implement a
replacement algorithm or upgrade their evidence posture.

Current accepted truth is deliberately conservative:

- Q13 deep work is `FAIL_DATA_INSUFFICIENT` / `REFERENCE_ONLY`.
- Q15 records a synthetic champion but no accepted card has a loadable model
  payload.
- Q16 therefore emits a protocol-valid `ABSTAIN_UNKNOWN` envelope with no score,
  probability, prediction or known net economics.
- Q00 has only a synthetic 452/128/25/10 universe/focus load shape, no retained
  event-rate trace, no current point-in-time universe and no numeric inference
  promotion latency target.

## Decision 1 — one final-proof composition package

`quant_edge.final_proof` owns only final verification evidence:

- replay/fault proof over accepted Q04/Q16 owners;
- exact-current projection of accepted research reports;
- measured local benchmark/resource evidence;
- syntax-aware security and frozen/scope evidence;
- generated manifests and integration instructions.

It stores no durable runtime state and creates no scanner, data source, feature,
label, model, calibration, registry, service, socket, approval, capital, risk or
execution authority. Existing owners remain read-only inputs.

## Decision 2 — proof bytes and benchmark measurements are different truth classes

Replay, fault, evidence, security and manifest projections are deterministic and
canonical. The accepted replay runs twice from the same immutable bytes and must
produce identical stage/output identities.

Performance measurements are observations, not deterministic fixtures. The
committed benchmark records raw positive integer nanosecond samples, explicit
warmups/sample counts, integer percentile law, workload metadata and resource
units. A later rerun may differ and must be compared as a fresh observation; Q17
does not demand byte equality from wall-clock measurements.

The benchmark uses `time.perf_counter_ns()` deltas, consistent with Python 3.13's
monotonic performance-counter guidance. It records cold construction, warm single,
deep-focus 10, focus 25, candidate 128 and universe 452 shapes, chunking every
service request within Q16's batch bound. Assessment measurements call the parent
service directly and include explicit `spawn` worker startup, one-shot IPC,
inference, parent validation and bounded reap; they exclude JSON and socket cost.
Repeated fixture rows are explicitly `SYNTHETIC_LOAD_SHAPE`, never described as
distinct symbols or event-rate evidence. Queue saturation/overflow and idle-service
shutdown are measured separately.

Peak child RSS is measured in a bounded child process, with platform-specific
units retained and normalized bytes checked against the Q00 provisional 8 GiB
ceiling. Child execution uses fixed argv, no shell, a timeout and kill/communicate
cleanup. Host metadata excludes hostname, serial number, hardware UUID, credentials
and environment values. No numeric latency acceptance SLO is invented.

RB-13 is a post-A17 correction, not accepted Q17 history. Its current benchmark and
generated proof-kit projection include the disposable-worker correction and are
recorded as pending evidence. They do not replace the historical C17/A17
measurements or inherit those commits' acceptance.

The current Q02, Q05 and Q08 owner bytes also contain post-acceptance money-truth
corrections. F-034, F-038 and F-039 were director-integrated by `5f887cf2…`, but
their current bytes are not attested by the immutable Q02/Q05/Q08 receipts. Q17
therefore verifies them as explicit pending corrections without changing any
historical phase identity, receipt, source seal or primary-evidence pin.

## Decision 3 — syntax-aware security proof with pinned exceptions

Security scanning parses Python ASTs. It identifies executable imports, attributes,
subscripts and calls instead of matching documentation text. It checks external
network clients, environment/secret access, unsafe deserialization/dynamic
execution, subprocess/shell use, and exchange/account/order/money/risk authority.

Exceptions are exact-path, exact-source-digest and behavior-specific:

- Q16's permissioned UDS/literal-loopback transport;
- Q16's per-request `spawn` inference worker, allowed only with one-shot IPC,
  bounded join/terminate/kill/reap cleanup and an exact reviewed source digest;
- the frozen protocol-verification CLI's argv-only Node subprocess;
- Q17's argv-only benchmark child used solely for RSS measurement.

No generic module or self-computed digest is trusted. The generator pins expected
digests after the reviewed sources are frozen. A changed exception source fails the
scan until explicitly reviewed and repinned.

The historical directive-input lock pin remains `410010ef…` / 1,568 bytes. RB-13
does not repin it to the current 1,757-byte file: security evidence records the
exact `d4bf318…` mismatch, remains non-clean, and accepts only that declared
post-acceptance drift while rejecting any additional frozen-file change.

## Decision 4 — exact artifacts outrank stale receipt prose, without rewriting history

Receipts are immutable evidence, not a license to repeat a contradiction. Q17
verifies the actual accepted bytes and records documentary errata explicitly.

Known examples at activation:

- Q16's stale decision-document hash is corrected by
  `quant/RECEIPTS/Q16_ACCEPTANCE.md`.
- Q10 receipt prose names Optuna best-trial indices `4,11,0,10`, while both exact
  accepted Q10 campaign and golden fixture name `4,7,0,10`. Q17 uses the matching
  machine artifacts as semantic truth, records the receipt field as stale and does
  not rewrite Q10.

Post-acceptance source corrections are a different truth class from documentary
errata. The accepted Q02/Q05/Q08 pins remain historical evidence even when the same
paths now contain corrected bytes:

- Q02 source seal remains `9d1429b3…bd64c`; F-039 current source is
  `3d755d72…9bfc`, while the 3,198-byte primary fixture remains unchanged at
  `01b648ee…49ba`.
- Q05 source seal remains `fb3fc657…fe12` and its 4,184-byte primary remains
  `f36a9b08…fe47`; current F-038/F-039 bytes are `d8c5709d…bed7` and
  `c82cf92d…709e` respectively.
- Q08 source seal remains `0224276b…8d74` and its 1,204-byte primary remains
  `d2054e47…525b`; current F-034/F-038/F-039 bytes are `232ee05a…c06` and
  `3a2a912c…54a8` respectively.

For those three phases the component manifest projects the accepted source and
primary references without pretending their paths still contain accepted bytes,
verifies the current correction source/evidence separately, and records exact fix
and director-integration provenance. Each correction remains `NOT_ACCEPTED`, its
implementation commit/tree stays `PENDING_NOT_EMBEDDED`, and the historical
receipts explicitly do not attest the corrected bytes.

Q14's synthetic `IMPROVES`, Q12's healthy-fixture `WATCH`, and Q15's synthetic
champion are not current edge or advisory truth. Q14 validates its own synthetic
baseline/challenger campaign; it is not retroactively described as a validation of
Q10/Q11. Component status keeps three axes separate: implementation,
evidence posture and product integration.

## Decision 5 — exact self-excluding generated kit

Q17 generates versioned proof, fault, research-evidence, benchmark,
security/scope, component-manifest and integration-instruction artifacts. The
artifact manifest contains every regular file under `quant/generated/q17/` except
itself, exactly once, in sorted safe POSIX-path order with byte size and SHA-256.
Missing, extra, duplicate, unsafe or symlink entries fail closed.

The component manifest pins Q00-Q16 implementation/acceptance identities and the
Q17 activation commit. Historical accepted references remain distinct from
Q02/Q05/Q08 money-truth and Q16 RB-13 post-acceptance correction references. It
cannot self-reference a pending correction re-attestation or pending C17/A17
commit. The immutable C17 receipt later binds the component/artifact bytes; the
separate A17 receipt binds exact C17 and freezes final HEAD.

## Consequences and rejected shortcuts

- A passing benchmark proves only measured local behavior on the recorded host and
  synthetic shape; it is not edge, capacity, production reliability or a deployment
  recommendation.
- A passing test suite proves machinery, not profitable hypotheses.
- Q17 reports absent real source coverage, ablations, current universe, rate trace,
  latency SLO, loadable model and product wiring as missing/unknown rather than
  creating placeholders.
- Broad grep-based security scans, ambient environment capture, shell commands,
  unsafe loaders, network access, model retraining, new stores and money paths are
  rejected.
- Final status can become `LANE_READY` only after exact C17 clean-archive proof and
  separate A17 acceptance. `LANE_READY` means parked for director integration audit,
  never pushed or live.
