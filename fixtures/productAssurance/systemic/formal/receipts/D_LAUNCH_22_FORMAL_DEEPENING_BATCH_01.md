# D-LAUNCH-22 — S3 formal deepening batch 01 receipt

```text
schema: ip-assurance.s3.formal-deepening-receipt.v1
status: FORMAL_DEEPENING_BATCH_01_RESEALED
authority: D-LAUNCH-22
branch: ip-assur-formal-20260713
parent_repair_commit: a0c7b6ed58ceba21bc4e3ceaf450ce6cb8d1ffb2
content_commit: 9f3b927f8faef34b09e67b43deb08fd9489fbf63
content_tree: 1ef7404c17afe3fe7871cf35e93af6b0350b53dd
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

The content cut adds M08 order-policy, M09 normal-Basis, and M10 Reverse-Basis
models plus their negative controls, TLA source/config pairs, content-hashed
manifest entries, exact frozen-source conformance rows, focused tests, report,
and packet state. The cut contains `21` changed paths, `1,553` insertions, and
`84` deletions, all inside the S3 exclusive write scope.

| Model | Bundle SHA-256 | Model source SHA-256 | States | Transitions | Properties | Fingerprint |
| --- | --- | --- | ---: | ---: | ---: | --- |
| `S3-M08-ORDER-POLICY` | `6bcd4c8d65fc5616af837212fd846d1d310331b40c60a15f461cb2d4ea6a9ea5` | `a19a55a5f466882e2d4fad457843991064be4ef797ed0bd474753783ca30dd6e` | 13 | 12 | 6 | `588b54fbbc1420bf` |
| `S3-M09-NORMAL-BASIS-LIFECYCLE` | `12edb746f45406682f6ded78a17a792d2072e2f37b7475757587d827bd06dce2` | `bc44bcdf99921b196324d6baef9552c70e118d8b81320825168b22bfb992ad52` | 69 | 78 | 12 | `f49e4d501711b685` |
| `S3-M10-REVERSE-BASIS-LIABILITY` | `1469e8e780f9ae53fe903e38e7a0b071b419156b7eed4a09fc063cbe23fdb055` | `1f3833d2a98634851d39732dfc570a7b8d86aeb9ca55b731cb0f7cc7177bd183` | 198 | 219 | 12 | `676f7194331bb8b1` |

Batch-01 canonical total: `280` states, `309` transitions, `30` property
checks. Accumulated M01–M10 total: `1,603` states, `1,940` transitions, `73`
property checks, `0` deadlocks, all exhaustive and PASS.

Manifest SHA-256:
`bd07df0b07eb73d4f9daa55247fb05a3ba710ed7071530a192c6d1c557ea90c9`.

Content-cut report SHA-256:
`9ae3cf4a5700ffbd538688e2fc0260fc7828ff4ab3100147a3143a66526e248b`.

Content-cut packet-state SHA-256:
`c36bd6a0732d44013a6804036c605dd4d5a0b21fc9d7b71fbc8418fd529ab00d`.

## Hostile and conformance evidence

- `DROP_KILL_GUARD` fails `S3-SAF-08` and `S3-SAF-11`.
- `CANCEL_REQUEST_IS_FACT` fails `S3-SAF-03` and `S3-SAF-14`.
- `REPAY_PRINCIPAL_ONLY` fails `S3-SAF-15`.
- All ten negative-control profiles are detected, producing `18`
  authenticated model-limitation traces and `0` runtime-corpus-eligible rows.
- M08 conformance remains `UNKNOWN`; M09 and M10 remain `REFERENCE_ONLY`.
  None can produce `SUPPORTING_EVIDENCE` without owner-pinned independent
  readback and ordinary-harness replay.

## Zero-network focused gate

Exact command:

```text
/usr/bin/sandbox-exec -p '(version 1)(allow default)(deny network*)' node --test --test-concurrency=1 --test-reporter=spec test/productAssurance/systemic/formal/*.test.mjs test/productAssurance/systemic/formal/contracts/*.test.mjs
```

Result: `PASS 43 / FAIL 0 / SKIP 0`, exit `0`.

The sandbox policy denied all network access. The packet runtime scan also
found no ambient clock, randomness, secrets, timer, filesystem, process, or
network authority. Per D-LAUNCH-22, the root gate was not rerun and server
startup was not touched; the prior root finding is adjudicated
`KNOWN_PREEXISTING_TEST_EGRESS`.

## Boundaries

- No checkout, write, signal, merge, or entry occurred in `i00-assembly` or any
  other worktree or branch.
- No push, merge, external action, server start, secret access, or network
  lookup occurred.
- Protected untracked input
  `I00_PRODUCT_ASSEMBLY_CONTROL_ROOM_AND_LIVE_BRINGUP.md` remained untracked and
  unchanged at SHA-256
  `9d7a36da6a2e6e7b3e905c73161b5e998a2f92416dd557e498ade3e73d5e5ef5`.
- The frozen implementation lacks literal HALT/fence primitives in M09/M10;
  those models do not claim them. Execution policy is an evaluator, not a
  reducer. These omissions are explicit conformance boundaries.
- This is a NON-CANDIDATE checkpoint. The repaired/deepened tip may re-enter
  only through a director-controlled post-landing wave.

Next authorized work is batch 02: M11 Volume, M12 exchange-twin ambiguity, and
M13 durable-control revision fencing under the same total-network-deny gate.
