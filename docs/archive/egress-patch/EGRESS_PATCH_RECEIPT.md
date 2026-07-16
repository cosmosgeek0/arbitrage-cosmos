# EGRESS patch receipt

Status: `BLOCKED`

The bounded EGRESS implementation is complete and its root acceptance proof is
green. The requested terminal state is blocked because the full `test:all`
gate cannot complete or pass on foreign-owner, base-identical inputs described
below. This receipt grants no authority to repair those seams.

## Authority and immutable inputs

- Branch: `egress-patch-20260716`
- Assigned base: `492e3f69b054c85686bcfc4c09dbff4ababeda3f`
- Assigned base tree: `3adef4d97ab595a8c81a307bac8dce22d037abdb`
- D-LAUNCH-51 authority: `e619ff18ef159c27061cfaf318036e18a4fac131`
- Patch-request commit: `a0c7b6ed58ceba21bc4e3ceaf450ce6cb8d1ffb2`
- Patch-request blob: `ef626c5fc51eee65c7816e357ab1fe8df3c62078`
- Patch-request SHA-256: `a360476583fb385b18d3a8cc1292b9e3ea68a645593fe6b976a4b806efa9092b`
- Implementation commit: `6aca80ac6d310f819393607dfdf8d875b59eca9e`
- Implementation tree: `a33cb311f7adbec69c9f31c3633a946ce2089f67`
- Changed-path-set SHA-256: `523cb17355a9352c1ac329996f845b050f3c5b60f218f20bc1a2352ab46ec6c8`
- Base-to-implementation binary-diff SHA-256: `bed9de6ba1221427d6da20051c9a13ea1f9e9293a55227f1f6376391770c227e`

## Exact implementation inventory

| Path | Git blob |
| --- | --- |
| `package.json` | `d05433de2f863d8bacb2349fa8f01bcb444818d2` |
| `server/test/gates.mjs` | `45d5de42cbf57388f866c59bc5b6c86217438941` |
| `server/test/perimeter.mjs` | `eb603b3409283d868decfd10e51b181cf600ddb1` |
| `server/test/private-egress-tripwire.mjs` | `00cc359c1e3e4f83af4907205bbd4ad32c1a1bdf` |
| `server/test/productIntegration/runtime/crash-readback.process.test.mjs` | `a87bc965b2438caf4e58febd2cf49ab8c8ac1a4f` |
| `server/test/run-deterministic-network-free.mjs` | `e2b3ad6991b7d9c17e6f36c51467b1a25b0b5ddb` |
| `server/test/systemIntegration/production/restart-truth-process.test.mjs` | `1664396a52c0ce2049908e490e5b20eccd2f4243` |

No other implementation path changed.

## Implemented behavior

- Root `npm test` now enters one deterministic runner before typecheck, build,
  or test children and installs an exact test-only Node preload in every
  controlled top-level child.
- The runner deletes ambient public-source admission and negative-control
  flags, uses the existing default-off offline startup seam only in the
  application test children that require it, and rejects an ambient copy of
  its own preload.
- One shared append-only transcript records every installation context,
  forbidden attempt, and bounded overflow. Missing, malformed, attempted, or
  overflowed evidence fails the parent.
- Covered surfaces include fetch, WebSocket, EventSource, HTTP, HTTPS, HTTP/2,
  DNS, TCP, TLS, UDP, constructors and Worker preload propagation. Numeric
  loopback and raw Unix-domain IPC remain available for real local test
  plumbing; HTTP and HTTP/2 authority-masking socket paths are denied.
- Strict mode latches a caught attempt to exit `86`. Evidence is redacted to
  protocol, host, and port and capped at 64 attempt records plus one overflow.
- The perimeter continues to exercise a real loopback HTTP server and a real
  loopback WebSocket. Hostile controls use `.invalid` names, fake dispatchers,
  fake connectors, or a loopback-only DNS resolver; they contain no provider
  credentials and cannot become a money path.

## Passing proof at the implementation commit

| Command or proof | Result |
| --- | --- |
| `npm ci --offline` | exit `0`; 229 packages installed; TypeScript `5.9.3`; 0 vulnerabilities |
| `npm run build` | exit `0` |
| `I00_TEST_EGRESS_STRICT=1 I00_TEST_EGRESS_NEGATIVE_CONTROLS=1 node --test server/test/perimeter.mjs` | exit `0`; 3/3 tests; all 28 hostile channel cases plus bounded retry/audit controls passed |
| `node server/test/run-deterministic-network-free.mjs --hostile-fetch-control` | expected exit `86`; parent reported exactly one `FETCH` attempt |
| `npm run test:app:built` | exit `0`; 83/83 gates; complete-lifetime public/private attempts both zero |
| strict shared-report `npm run test:focused:built` | exit `0`; 59/59 + 29/29 + 51/51 + 14/14 + 2/2; 11 installs; 11 processes; zero attempts |
| strict crash-readback plus restart-truth process tests | exit `0`; 3/3; 7 process installs; zero attempts |
| strict file-Worker proof with `env: {}` and `execArgv: []` | exit `0`; 3/3 execution contexts installed; zero attempts |
| `npm test` | exit `0`; Product Assurance behavior 802/provenance 4; S3 43/43; root audit 111 installs, 99 processes, 111 contexts, zero forbidden attempts |
| `git diff --check` | exit `0` |

The root proof used the intrinsic Node boundary, not a machine firewall or OS
sandbox.

## Production-default preservation

The patch reuses the already-landed, test-only offline seam and changes no
production source, lockfile, or server package metadata. The following base
and implementation objects are identical:

| Object | Base and implementation Git object |
| --- | --- |
| `server/src` | `18b2f67fbc2fc1f4925ee7102547a82b4835066b` |
| `web/src` | `206a689933a6c88acb466a3faaa2d1a50186f582` |
| `package-lock.json` | `54efede0fbadd309ca38375349075affc347cb51` |
| `server/package.json` | `807ba798ddd41fdcf80618da78ff8a4133e5a610` |

`LIVE_EXECUTION_NOT_IMPLEMENTED` remains enforced. No live order, test order,
borrow, repay, transfer, withdrawal, leverage, signed/private call, provider
credential, push, merge, or `current-main` mutation occurred.

## Blocking full-gate evidence

`npm run test:all` was run from the clean tracked implementation commit. It
passed typecheck, build, deterministic tests, the zero-attempt deterministic
audit, application gates, Intelligence, Capital, and Foundation. It then
stalled indefinitely in
`server/test/systemIntegration/persistence/live-edge-mutation-journal-adapter.test.mjs`
after its first three subtests reported pass. The file child remained at 100%
CPU with no new output for more than three minutes and was manually interrupted;
therefore `test:all` did not exit `0`.

That failing path was not preloaded and had no `NODE_OPTIONS`,
`I00_TEST_EGRESS_*`, deterministic-offline, or public-source admission variable.
An additional plain run that excluded the named third test still left the same
file child spinning at 100% CPU, so no exact test-level attribution is made.
Its Git blob is `bc1d8588d36087e8fa6fc935678653ce590ae54e` at both base and implementation.
The Ledger blob `2d16cf8a978046efd37e159152b41b852e3e56fe`, adapter blob
`4d6a4aa696cf0465436286ea128b28495bd3baaa`, package lock, and integration
command are also base-identical. The file contains unbounded Worker message and
exit awaits, but the exact spinning test and native frame were not captured and
are not claimed.

Later families were probed independently so the first stall would not hide
additional external blockers:

- protocol: 22/22 pass;
- Product Integration: 111/111 pass;
- Product Control: 102/102 pass;
- I00 proof: 45/47, with two failures because the committed `QL_DIRECTOR_STATE.md`
  and `QL_PARALLEL_DAG.md` bytes no longer match the accepted moving
  `current-main` objects;
- I00 commands: 25/28, with three donor/topology failures against external Git
  authority;
- Live Edge was diagnostic-only and was stopped before a terminal count; no
  success is claimed for that incomplete run.

The EGRESS worker has no authority to edit the base-identical System
Integration test, repin I00 authority, modify another worktree, or mutate
`current-main`. Consequently `EGRESS_PATCH_READY` is not claimed.

## Boundary and limitations

This is a deterministic boundary for the controlled Node root-test graph, not
an OS syscall firewall. Deliberate same-process mutation of the tripwire,
native bindings/addons, and networking by a non-Node subprocess are outside the
claim. The accepted proof is instead that all controlled root children and
Worker contexts installed the boundary and recorded exactly zero forbidden
attempts without sandbox reliance.

## Insertion requests

```json
{
  "schema": "InsertionRequestRowV1",
  "version": 1,
  "rowId": "EGRESS-IR-STATE-001",
  "status": "DRAFT",
  "requestedOwner": "DIRECTOR_LANDING_OWNER",
  "targetSeam": "STATE.md",
  "reason": "Record landed deterministic root-test wiring, measured counts, and zero-attempt proof.",
  "wiringState": "PENDING_BACKEND:EGRESS-IR-STATE-001",
  "authorityCreated": false
}
```

```json
{
  "schema": "InsertionRequestRowV1",
  "version": 1,
  "rowId": "EGRESS-IR-INTEGRATION-TEST-001",
  "status": "DRAFT",
  "requestedOwner": "SYSTEM_INTEGRATION_PERSISTENCE_TEST_OWNER",
  "targetSeam": "server/test/systemIntegration/persistence/live-edge-mutation-journal-adapter.test.mjs",
  "reason": "Diagnose and bound the base-identical integration process so test:all cannot spin indefinitely.",
  "wiringState": "PENDING_BACKEND:EGRESS-IR-INTEGRATION-TEST-001",
  "authorityCreated": false
}
```

```json
{
  "schema": "InsertionRequestRowV1",
  "version": 1,
  "rowId": "EGRESS-IR-I00-AUTHORITY-001",
  "status": "DRAFT",
  "requestedOwner": "DIRECTOR_LANDING_OWNER",
  "targetSeam": "I00 accepted Git authority and current-main topology",
  "reason": "Reconcile moving QL object pins and donor topology so the I00 proof and command gates can pass from the accepted branch.",
  "wiringState": "PENDING_BACKEND:EGRESS-IR-I00-AUTHORITY-001",
  "authorityCreated": false
}
```

Terminal disposition: `BLOCKED`.
