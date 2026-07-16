# Q15-001 — crash-safe offline research registry and conservative drift law

Status: `ACCEPTED_FOR_Q15_IMPLEMENTATION`

Date: 2026-07-13

## Decision

Build a Q-native offline research registry under `registry_ops/**`. Persist its
immutable cards, artifact references, model registrations, transition history,
shadow batches, delayed feedback, alarms, annotations and retirement evidence in
one caller-rooted local SQLite database. Use explicit `BEGIN IMMEDIATE`
transactions, WAL journaling and `synchronous=FULL`; required PRAGMAs are read back,
and a transition row, immutable
champion-history row, lifecycle updates and current champion projection commit in
one transaction. Startup performs `PRAGMA quick_check` and verifies the current
projection against its exact transition, history, model/card and artifact bytes.
Corruption abstains by raising a registry-integrity failure; it never silently
falls back to an older model or selects a challenger.

This store is not the product ledger or deployment authority. It has no listener,
remote URI, autologging, model deserialization, private data, secrets, exchange,
capital, Risk or order integration. The existing operational ledger remains the
sole operational durability owner. Q15 stores only local research metadata and
content-addressed public/synthetic artifact references.

## Why SQLite, not MLflow or a mutable JSON HEAD

Current official SQLite documentation states that transactions are atomic across
program/OS crashes and power failures and describes crash-test recovery of an
incomplete transaction. Python 3.14 documentation recommends explicit transaction
control; Q15 uses explicit begin/commit/rollback on the repository-pinned Python
3.13 runtime. Official sources reviewed immediately before implementation:

- <https://www.sqlite.org/atomiccommit.html>
- <https://www.sqlite.org/transactional.html>
- <https://docs.python.org/3/library/sqlite3.html>

Current MLflow guidance uses aliases/tags for flexible model version selection, but
the accepted Q01 framework card records MLflow as a large overlapping dependency
and allows only a deferred local projection. Q15 therefore adopts the useful
separation—immutable model versions plus a separately versioned champion
pointer—without installing MLflow or starting a tracking server:

- <https://www.mlflow.org/docs/latest/ml/model-registry/workflow/>

Q09 already owns a deterministic, quality-aware two-sided Page-Hinkley detector.
Q15 reuses it rather than adding River or duplicating drift math. The current River
project still treats drift detection as a univariate streaming concern; its code is
not added to the lock:

- <https://github.com/online-ml/river>

A multi-file mutable JSON HEAD was rejected because card/state/journal writes could
tear independently. Reusing the Q02 Parquet lake store was rejected because it owns
immutable dataset revisions, not model lifecycle, shadow feedback or champion CAS.

## State and authority law

- Artifact and card bytes are immutable. Lifecycle is separate state.
- Model lifecycle is `SHADOW_CHALLENGER | CHAMPION | RETIRED`.
- Serving posture is only `ADVISORY | ABSTAIN_UNKNOWN`.
- Champion identity binds model ID/revision, artifact SHA-256, model-card SHA-256,
  policy revision, transition ID and generation.
- Restart validates a contiguous generation-one-to-head transition chain, canonical
  command/evidence bodies, lifecycle/projection bijection, all referenced cards,
  transitive shadow/feedback/report lineage and exact artifact bytes from one
  consistent SQLite read transaction.
- Bootstrap is allowed only for an explicit `SYNTHETIC_ONLY` proof.
- Promotion requires all ten Section 16.5 gates and exact report content/identity.
- A shadow comparison is not a caller assertion: exact score and outcome values bind
  their canonical digests, and Brier losses/verdict are recomputed from persisted
  matured batches. Comparisons bind the current champion generation/transition.
- Drift has no candidate field and no call path to promotion or rollback. It keeps
  champion identity fixed and can only preserve advisory posture or tighten to
  abstention.
- Promotion is forbidden while abstaining, and recovery changes generation, so
  pre-drift comparison evidence cannot be replayed after demotion or recovery.
- No-drift evidence never automatically changes `ABSTAIN_UNKNOWN` back to advisory.
- Rollback is an explicit command to an exact prior champion. Retirement cannot
  select a successor and cannot retire an active champion.

## Accepted artifact truth

Q10 files are model evidence, not serialized estimators. Q11 golden bytes contain
the transparent hazard mapping but Q15 does not invent a loader. Q14 validates its
own synthetic baseline/challenger IDs, not Q10/Q11. The real Q14 report is therefore
registered and hashed but fails promotion identity binding. A separate
`Q15SyntheticPromotionReportV1` exists only to exercise crash consistency; its body
states that Q14 did not validate the registered pair.

Future Q12 enters through the same generic artifact/card/validation interfaces as
any other model. Q15 imports no ensemble or calibration implementation and contains
no placeholder for one.

## Consequences and limitations

- Exact application-crash behavior is tested with SIGKILL at pre- and post-commit
  boundaries. SQLite's underlying hardware/filesystem assumptions remain those in
  its official atomic-commit documentation.
- Hashes prove byte integrity relative to the accepted repository, not publisher
  authenticity, profitability, calibration or market truth.
- Q15 records injected shadow outputs; Q16 will own bounded inference. It does not
  execute a model. The deterministic Q15 score event is truthfully `HYPOTHETICAL`,
  never represented as replayed market evidence.
- No current Q10/Q11 artifact is genuinely promotion-qualified from the merged Q14
  evidence. All Q15 campaign evidence remains `SYNTHETIC_ONLY`.
- Registry recovery is fail-closed. Operational integration must separately pin an
  approved artifact/policy and pass integration, rollback and supervisor gates.
