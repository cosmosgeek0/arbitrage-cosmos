# Q lane integration receipt

Status: `Q_DONOR_INTEGRATED / AUTHORIZED_EXTERNAL_SUPERSESSION`

Date: `2026-07-14`

This receipt is immutable integration evidence for one donor only. It records no Q edge, champion-model, private-source, signed-call, execution, deployment, or money authority. The integrated Q posture remains advisory `ABSTAIN_UNKNOWN`; production Q transport remains `NOT_CONFIGURED`.

## Immutable donor

- Donor: `quant-edge-research-factory-20260712`.
- Accepted tip / A17: `02b4eccc8d2ef53b830cafae06e5175715fa6ebb`.
- Donor tree: `5c86cebf0966cedd7ba01c56a01704b4f7bd0224`.
- Exact parent / C17: `4cc83f43edd9a50ff2d3e20970a57e2d0a57e92a`.
- C17 tree: `1aec7711f64419d50770d9c515d012173e982240`.
- Q17 acceptance receipt: `quant/RECEIPTS/Q17_ACCEPTANCE.md`; Git blob `3dad68c9dc52e97aadaec173930388e3404769e7`; 10,582 bytes; SHA-256 `9cfa0356228d7f48674df2d9db523f0f0d53dab1a4e4255b6ba9676e463ec5dc`; terminal `ACCEPTED — LANE_READY`.
- Donor worktree had no staged or modified tracked path. Its two untracked owner directives were protected external inputs, were not donor content, and were not copied, staged, removed, or used as implementation.

## Integration identity and scope

- Merge commit: `042dc9897d04bed2b0de3043cbdcbac408251412`.
- Merge tree: `3ffa75b34c2263a2688b6e42ac65f0a02bbb789c`.
- Parents in order: pre-Q integration `dc69f778f7e432132618b7c22c0795639492f844`; exact donor `02b4eccc8d2ef53b830cafae06e5175715fa6ebb`.
- First-parent delta: 510 paths; sorted newline-terminated path-set SHA-256 `ba623cd0bfd419bf0f6163ff38823c8a3540f7b67bf18743adf79e5c6d138b3f`.
- Donor payload: 504 `quant/**` additions relative to the first parent; sorted newline-terminated path-set SHA-256 `e8cf75f00380d265671227553c7019741fa0feb2004cfe37be56d66c592c11d8`.
- Integration-owned paths: `STATE.md`, `fixtures/i00/living-director-input-acceptance.json`, `fixtures/i00/q-directive-input-supersession.json`, `server/test/i00Acceptance/authority-protocol.test.mjs`, `server/test/i00Acceptance/harness.mjs`, and `test/i00/git-provenance.mjs`.
- `git diff 02b4eccc… 042dc989… -- quant` contains exactly one path: `quant/DIRECTIVE_INPUTS.lock`. Every other integrated Q path is byte-identical to the accepted donor.
- `git merge-base --is-ancestor 02b4eccc… 042dc989…`: exit 0.
- `git diff --check`: exit 0.

## Explicit semantic-conflict disposition

Q00 decision `quant/DECISIONS/Q00-003-D-LAUNCH-1.md` requires the accepted Q snapshot to keep its original directive lock byte-unchanged and consume D-LAUNCH-1 as external director evidence. Replacing Q17 pins or regenerated artifacts would violate that accepted decision, so none was changed.

The integration target instead preserves canonical Main truth:

| Object | Git blob | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| Historical accepted Q lock | `cf414da3b46d46d1807f4c04939c7ee1121f5895` | 1,568 | `410010ef635a5e44b205e56c6b38f2d06e5b8e72312f5d63edcb24a5086355e1` |
| D-LAUNCH-1/current target lock | `d1ebc3b6ddeae9f0b92520f9ca1bc5a3270430d5` | 1,757 | `d4bf31826625c2602ebb7ed72194e94a4571f7597a413ca545839f236c7a5a24` |
| Authentic owner launch input | `587c1b83e8f9d32b9097d88df7fea40d9829b68e` | 20,763 | `26b1d5ce118982b4b3ba64b44b7fb3e88b0b7ded26a818a775a65bffaa0f2c06` |

D-LAUNCH-1 is `9ca01537f4edda06ee566cd261e612d5c315fb76`, tree `d2de7721cbc83c8dd7842e21665876b528419c9d`. Its parent contains the historical lock blob, its result contains the canonical lock blob, and it is an ancestor of both `current-main` and the integration commit. The lock inventory remains six rows; headers and rows 2–6 are byte-identical; only the launch row changes from the stale pre-resave measurement to the corrected owner digest plus the exact D-LAUNCH-1 explanation.

`fixtures/i00/q-directive-input-supersession.json` SHA-256 is `ca881a88c363b1281de0be0e6fea486fadd42eca0405b390c0e9da4c9688d37e`. The verifier recomputes Git trees, ancestry, blobs, byte lengths, hashes, commit-message evidence, and the exact one-row transformation. Any third hash, extra row change, wrong object, missing ancestry, malformed bytes, or false byte-equivalence label returns `BLOCKED`.

## Measured verification

1. Combined-target diagnostic, run with target source forced first:

   ```text
   cd quant && PYTHONPATH=src <accepted-q-venv>/bin/python -m pytest tests/q17 -q --cov=quant_edge.final_proof --cov-branch --cov-report=term --tb=short
   ```

   Result: exit 1; `366 passed`, `18 failed`; 93.70% coverage. Every failure is the exact historical 1,568-byte lock versus canonical 1,757-byte lock boundary. Classification: `EXPECTED_TARGET_TREE_FROZEN_SNAPSHOT_MISMATCH`. This is diagnostic evidence, not a green gate and not a waived failure.

2. Exact donor archive gate: `git archive 02b4eccc…` was extracted without `.git`; only the accepted donor `.venv` was linked; `PYTHONPATH=src` forced archive source first.

   ```text
   PYTHONPATH=src .venv/bin/python -m pytest tests/q17 -q --cov=quant_edge.final_proof --cov-branch --cov-report=term --tb=short
   ```

   Result: exit 0; `384 passed`; 96.50% combined branch coverage against a 95% floor.

3. Complete unchanged Q suite from the same exact donor archive:

   ```text
   PYTHONPATH=src .venv/bin/python -m pytest -q --tb=short
   ```

   Result: exit 0; `3,011 passed`, six documented shard-branch-only skips.

4. Integrated Git/protocol/repository gates:

   - `node --test --test-concurrency=1 --test-reporter=spec server/test/i00Acceptance/authority-protocol.test.mjs`: exit 0; `14/14`.
   - `node packages/edge-protocol-tests/protocol.test.mjs`: exit 0; `22/22`.
   - `npm test`: exit 0; deterministic `377/377`.
   - `npm run test:all`: exit 0; deterministic 377, app 72, intelligence 152, intelligence runtime 394, capital 433, all Foundation files, System Integration `180/180`.

## Ruling

Expected Q donor = discovered Q donor = receipt-accepted Q donor = integrated Q donor by exact merge ancestry. The Q snapshot and canonical target lock are not called byte-identical: their one difference is explicitly authorized and fail-closed by D-LAUNCH-1 provenance. Q is integrated; Q runtime mounting and real-adapter acceptance remain later serial-spine work.
