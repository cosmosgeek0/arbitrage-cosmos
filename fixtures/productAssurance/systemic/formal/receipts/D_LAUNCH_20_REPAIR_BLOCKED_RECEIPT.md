# D-LAUNCH-20 S3 repair BLOCKED receipt

This is a new immutable sibling receipt. It preserves the earlier BLOCKED
receipt and D-LAUNCH-10 reseal unchanged. Its containing Git commit seals the
D-LAUNCH-20 diagnosis, patch request, and packet-local state.

```text
schema: ip-assurance.s3.d-launch-20-repair-blocked.v1
terminal_status: BLOCKED_ROOT_TEST_EXTERNAL_EGRESS_OUTSIDE_S3_SCOPE
requested_terminal: FORMAL_REPAIRED_RESEALED_NOT_REACHED
candidate_status: NON_CANDIDATE
branch: ip-assur-formal-20260713
repair_input_commit: 89c783bd9e55ce83c21ed1181757122d88e4c980
repair_input_tree: bb444b7ea959f086bbc1d1021b6f9b45e0fadf79
packet_base_commit: 9785c93102b00389847b77c2f9348c06abc4344b
binding_ip_assurance_sha256: 5f6d4b3b70e384f6123e9ccc01891faf04aef9da7f7cfd1e0c63be5c3ba68803
dedup_matrix_sha256: 22686d2cd1c54bbc39af56399298a0ed9563bbc8643ad4f0e498718de83cb2cd
model_manifest_sha256: ace6777a0c71cdd0f08efbb7eb012027a4812986791a4581e9fed85077af4f04
root_package_sha256: e49ff499d4612a0141c884a0818663912f1a19c9a61afdb2f6b99a6b1a2b5e8a
root_lock_sha256: 3c97820f912390fcad3dab57b436319b95c15bc7877384dd98032d7751ec2fcf
server_package_sha256: 4fcc270fcb046db17b7e581e11bc02216a1b07465ff713b52edfd9a7b17feaf6
web_package_sha256: 839d4196aa8dc0d9056796592a7630ab5176d67134a724b521421593438775a8
protected_parent_i00_sha256: 9d7a36da6a2e6e7b3e905c73161b5e998a2f92416dd557e498ade3e73d5e5ef5
patch_request_sha256: a360476583fb385b18d3a8cc1292b9e3ea68a645593fe6b976a4b806efa9092b
report_draft_sha256: 57a79e8bc01bb82da8dab5777707a4778d855daa1a6a8ff0d09f28917f247143
toolchain: node@22.23.1 npm@10.9.8 typescript@5.9.3
sealed_date: 2026-07-14
```

## Exit-127 diagnosis

The historical failure is exact: root `npm test` exited 127 at server
typecheck with `sh: tsc: command not found`. That run performed no package
install. D-LAUNCH-20 did not reproduce the failure after the required clean
install:

```text
command: npm ci
exit: 0
result: added 229 packages; audited 232 packages; 0 vulnerabilities

command: npm test
exit: 0
result: server/web typecheck + server/web build + 377 reported checks
```

The root and workspace manifests already declare TypeScript, and the lockfile
already binds TypeScript 5.9.3 with its `tsc` binary. S3 changed none of those
files. The exit 127 was therefore an unhydrated-worktree failure, not a missing
S3 devDependency and not a reason to edit an out-of-scope package file.

## Network-boundary blocker

The plain passing root run is not an acceptable zero-network proof. It was
started before the effect path below was identified and had no egress monitor,
so zero external access cannot be established for that diagnostic run.

Static source tracing then proved an unconditional external-attempt path in the
root gate:

```text
root npm test
  -> test:focused:built
  -> server/test/perimeter.mjs
  -> spawned server/dist/index.js
  -> unconditional public-market/liquidation startup
  -> external wss://stream.binance.com / wss://fstream.binance.com sockets
```

`SKIP_DOTENV=1` removes keys; it is not an offline switch. External connection
failure is contained by the runtime, so the perimeter test can remain green
after an egress attempt. This is a false green against the repository's
network-free-test law.

A diagnostic rerun under the following OS policy exited 0 with all 377 checks:

```text
sandbox-exec -p '(version 1)(allow default)(deny network-outbound (require-not (remote ip "localhost:*")))' npm test
```

The policy denied external outbound traffic while retaining the loopback
traffic required by the perimeter test. An external `1.1.1.1:443` probe under
the same policy failed immediately. This demonstrates enforced blocking, not
zero attempted egress, and cannot close the acceptance condition.

## S3 focused proof

The packet-local suite remains clean and independent of the root defect:

```text
command: node --test --test-concurrency=1 --test-reporter=spec test/productAssurance/systemic/formal/*.test.mjs test/productAssurance/systemic/formal/contracts/*.test.mjs
exit: 0
tests: PASS 43 / FAIL 0 / SKIP 0
models: PASS 7 / FAIL 0 / UNKNOWN 0
bounded_graph: 1323 states / 1631 transitions / 505 terminals / 0 deadlocks
negative_controls: DETECTED 7 / 7
conformance: MISMATCH 2 / UNKNOWN 5
runtime_corpus_eligible: 0
```

The same 43 tests pass under external-network denial. Static and manual review
found no network, subprocess, timer, ambient clock, random, environment, or
third-party dependency in S3 runtime modules.

The final clean-room repeat used cached locked artifacts only:

```text
command: npm ci --offline
exit: 0
result: added 229 packages; audited 232 packages; 0 vulnerabilities

command: sandbox-exec <deny-external-allow-loopback> npm test
exit: 0
result: 377 checks; external traffic denied; loopback perimeter retained

command: sandbox-exec <deny-all-network> node --test <S3 focused paths>
exit: 0
result: PASS 43 / FAIL 0 / SKIP 0
```

These reruns confirm deterministic S3 behavior and the hydration diagnosis;
they do not erase the root source-level egress-attempt blocker.

## Required out-of-scope patch

The exact owner request is sealed at:

```text
fixtures/productAssurance/systemic/formal/drafts/D_LAUNCH_20_ROOT_TEST_OFFLINE_PATCH_REQUEST.DRAFT.md
```

The root/server test owner must provide an intrinsically offline perimeter
boot plus a loopback-aware, attempt-recording egress tripwire and hostile
failure control. A firewall-only green run is insufficient. The repair touches
shared root/server test or startup seams and is therefore forbidden to this S3
worker.

## Scope and handoff

- D-LAUNCH-20 changes are confined to
  `fixtures/productAssurance/systemic/formal/**`.
- No package, lockfile, production source, root state, Q/L, other IP packet,
  shared generated artifact, assembly worktree, branch, external system, money
  path, or secret was changed.
- The protected I00 input remains untracked, unmodified, and unstaged.
- No merge and no push occurred.
- This branch remains non-candidate. Any future re-entry is only through a
  director-controlled post-landing wave after the canonical owner closes the
  root offline-test blocker and reruns both clean gates.

Exact terminal word:

```text
BLOCKED_ROOT_TEST_EXTERNAL_EGRESS_OUTSIDE_S3_SCOPE
```
