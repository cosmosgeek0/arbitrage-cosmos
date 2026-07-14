# D-LAUNCH-22 — S3 formal deepening batch 02 receipt

```text
schema: ip-assurance.s3.formal-deepening-receipt.v1
status: FORMAL_DEEPENED_RESEALED
authority: D-LAUNCH-22
branch: ip-assur-formal-20260713
parent_batch_01_seal_commit: 0b0771b5af986ef3f133f939e1d4328107a5e45c
content_commit: 10a3fa94d14229c6e6864f2d1ef097f3682fc2b3
content_tree: a429308c0074c70d7e12e4af57b2c71aa2df085e
frozen_l_donor_commit: df6b472993ca9659ce09cf5f72004981c6835f0d
frozen_l_donor_tree: 1add5ee43fea623509c20d0990ec9efac2543fc4
frozen_l_access: GIT_SHOW_READ_ONLY
source_truth: SYNTHETIC_ONLY
authority_label: SUPPORTING_EVIDENCE_ONLY
runtime_claim_closure: NOT_PERMITTED
candidate_status: NON_CANDIDATE
external_mutation: NONE
money_authority: NONE
```

## Immutable batch content

The content cut adds M11 Volume, M12 exchange-twin ambiguity/reconciliation,
and M13 durable-control revision models; their negative controls; TLA+
source/config pairs; exact frozen-source conformance evidence; a per-transition
M08–M13 manifest; focused tests; report; and packet state. The cut contains
`22` changed paths, `2,420` insertions, and `56` deletions, all inside the S3
exclusive write scope.

| Model | Bundle SHA-256 | Model source SHA-256 | States | Transitions | Properties | Terminals | Fingerprint |
| --- | --- | --- | ---: | ---: | ---: | ---: | --- |
| `S3-M11-VOLUME-LIFECYCLE` | `c83d7fcad1e7e761ed6ef7db0fe0ba9321b7dd866fb41c10a623272a3fe076e4` | `fb593dea12bd8cf5bcdecf436550c4c3d15500178900242c98a8a4c189284821` | 49 | 55 | 10 | 25 | `9dde4da6fa0bc321` |
| `S3-M12-EXCHANGE-TWIN-AMBIGUITY` | `b69b785c129b07d9858d98be740375d97ad65fffe462893128fe5e6e57df5902` | `68fafb3d126407fd571438a43bb54cf37eb6dc628b1c10ffdb411bd04754aac0` | 27 | 38 | 12 | 13 | `25d101d585412bf9` |
| `S3-M13-DURABLE-CONTROL-REVISION` | `afa61ceccb89f3aa401e17b5d111dbcb121b09b08786a890a46651e651da0ecc` | `ef498b676f4fa0759dbe2b31c23bda5036353adef020597c485e7465accd790e` | 123 | 161 | 12 | 54 | `b0e715dbd96bdb25` |

Batch-02 canonical total: `199` states, `254` transitions, and `34`
model-property checks. Accumulated M01–M13 total: `1,802` states, `2,194`
transitions, `718` terminal states, `107` model-property checks, and `0`
deadlocks; all thirteen canonical graphs are exhaustive and PASS inside their
declared finite envelopes.

Content hashes:

- Model manifest: `8e1615b8919a3e11b9df1aac54b65e386426fc57db519930d45dc00c681c445d`.
- Per-transition conformance manifest: `54ce780e426c5ae2517b1b7acdde42e921b5150ea01d437b75d9b434135f6cc3`.
- Property catalog: `6a01b025ae1bd53c2c5676a21dad43dace19b4f1c8d32ebac95edcf8c502fd5e`.
- Conformance fixtures: `fab0b19474918d4e4f818dae6044a0d5d639560aea9505eb9abaf2430ef9c7e8`.
- Content-cut report: `7c446e403c164468575b4f97c9be278dd38fc3ce61055bee5730a44a4a1d66a5`.
- Content-cut packet state: `d10824ab2fd62d98fb827c45352075b22a886fae42a8a0d19a4a00f96b068301`.

TLA+ source/config SHA-256 pairs:

| Model | Source SHA-256 | Config SHA-256 |
| --- | --- | --- |
| M11 | `a573ad63626e905b3e483f63b6160cc421b998b0079b4bf44bbb8aa9d6700c3e` | `48e222e02b33e5a654a588d6c1c121a07dd8d5dcc546bb6d5d605678e0d73a3d` |
| M12 | `6afbc9a8e4cd60eedb25dcf1d0a8828dfbb11d97bc541e5d49fb60e6bb44204a` | `359ca843d1a2f2dde70061922d7952fc052833a547f7f8344c038f371650a9b1` |
| M13 | `9796d6bbf137013d776786a6764db96e4d378d8109dbecd55770babd617f07a4` | `abbcfd89e2b4c0b32881aec0e4f729bfd685e4acbd2a1a5f1431fc4d0975ea46` |

TLA+/TLC tooling remains `TLA_TOOLING_NOT_CONFIGURED`; these are structural,
content-hashed sources, not checker-executed evidence.

## Frozen donor bindings

All donor reads used `git show df6b472:<path>` only. The inspected frozen
SHA-256 bindings are:

| Frozen source | SHA-256 |
| --- | --- |
| `server/src/liveEdge/adapters/volumeLifecycle/types.ts` | `44268936146d03334d7e813490357649a0e264ebe1c3832d3215eacba5cf30de` |
| `server/src/liveEdge/adapters/volumeLifecycle/lifecycle.ts` | `703f49ed69b4b729e9d2130bcdfd500759611840cf8564bd3363a53b45543a0d` |
| `server/src/liveEdge/adapters/volumeLifecycle/policy.ts` | `9f876e1714c4f50abd756f262c6a00707a9c22fe76e7f45a3e56390e4a8cc3ab` |
| `server/src/liveEdge/adapters/exchangeTwin/types.ts` | `c3bf70a72a5d87d6899e0cc21a7dcd106842e6de57002c8fcbd08decdea097f9` |
| `server/src/liveEdge/adapters/exchangeTwin/twin.ts` | `4084c2bb579a6b8e31cc3335ea5239aecb0c4d02069be149c16cf041ad6d726d` |
| `server/src/liveEdge/controls/types.ts` | `2896d2f40c55bbb464454121df0c79567c67ea8e9b0537e91cd017835a666373` |
| `server/src/liveEdge/controls/adapter.ts` | `a80417934958059395fb22bf706867f0e386837faa13fc83a36402dea5bf1654` |
| `server/src/liveEdge/controls/integrity.ts` | `ee7c10923ca1c40dda6e9f306f70586cf78e5143932516d6c539c2c9bc1bd73d` |
| `server/src/liveEdge/controls/validation.ts` | `b128e5299af7fdc0506accec751ffb1884aeddb5dd657b0892963f45b951e9de` |
| `server/test/liveEdge/controls/fixtures.mjs` | `1dfedf361082414e3f77252cd50de06173278dff8309f820eed7b36dcd3a7023` |

## Audit, hostile controls, and conformance

The pre-reseal audit closed these false-green seams without weakening a
property: flat failed Volume gates now remain `BLOCKED` with an absent
projection; the M11 TLA+ ambiguity cut cannot loop forever; M12 carries an
explicit placement-dispatch liveness monitor; M13 represents post-intent
expiry, known rejection, failed finalization, best-effort pre-intent audit, and
monotonic `0 -> 1 -> 2` journal phases; aggregate conformance rows no longer
cross-cite symbols from the wrong file.

- `HALT_ALLOWS_ADD`: 60 states / 77 transitions; fails `S3-SAF-08` and
  `S3-SAF-11`.
- `AMBIGUOUS_CANCEL_RACE_ALLOCATES_FILL`: 25 states / 32 transitions; fails
  `S3-SAF-06`, `S3-SAF-13`, and `S3-M12-INV-01`.
- `NON_ATOMIC_CONTROL_REVISION_RESERVATION`: 115 states / 150 transitions;
  fails `S3-SAF-01` and `S3-M13-INV-01`.
- All thirteen negative-control profiles are detected, producing `25`
  authenticated model-limitation traces and `0` runtime-corpus-eligible rows.

The exact per-transition manifest covers `144/144` reachable canonical M08–M13
actions: `28 MAPPED`, `103 PARTIAL`, `13 ABSENT`, `0` missing, `0` extra, and
`0` duplicate rows. An independent object audit found all `55` unique exact
file/symbol references across `13` frozen paths in `df6b472` and found `0`
missing references.

Implementation conformance remains fail-closed: M11 and M12 are
`REFERENCE_ONLY`; M13 is `MISMATCH` because atomic global control-revision
reservation exists only in the synthetic harness while production canonical
persistence is unwired. Accumulated verdicts are `MISMATCH 3`, `UNKNOWN 6`,
and `REFERENCE_ONLY 4`. No row can produce `SUPPORTING_EVIDENCE` without an
owner-pinned registry and ordinary-harness replay.

M01–M07 were audited for cheap widening and remain unchanged: growth is `0`
states and `0` transitions. Retrofitting frozen-L cases would change their
sealed abstraction semantics; M08–M13 carry the new finite scenarios instead.

## Zero-network focused gate

Exact command:

```text
/usr/bin/sandbox-exec -p '(version 1)(allow default)(deny network*)' node --test --test-concurrency=1 --test-reporter=spec test/productAssurance/systemic/formal/*.test.mjs test/productAssurance/systemic/formal/contracts/*.test.mjs
```

Clean-room result: `PASS 44 / FAIL 0 / SKIP 0`, exit `0`.

The sandbox policy denied all network access. The packet runtime scan found no
ambient clock, randomness, secrets, timer, filesystem, process, or network
authority. Per D-LAUNCH-22, the root gate was not rerun and server startup was
not touched; the prior root finding remains adjudicated
`KNOWN_PREEXISTING_TEST_EGRESS`.

## Boundaries and re-entry

- No checkout, write, signal, merge, or entry occurred in `i00-assembly` or any
  other worktree or branch.
- No push, merge, external action, server start, secret access, or network
  lookup occurred.
- Protected untracked input
  `I00_PRODUCT_ASSEMBLY_CONTROL_ROOM_AND_LIVE_BRINGUP.md` remained untracked and
  unchanged at SHA-256
  `9d7a36da6a2e6e7b3e905c73161b5e998a2f92416dd557e498ade3e73d5e5ef5`.
- This branch remains NON-CANDIDATE. Its repaired/deepened tip may re-enter
  only through a director-controlled post-landing wave.

The S3 terminal state is `FORMAL_DEEPENED_RESEALED`.
