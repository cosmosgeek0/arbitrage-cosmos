# Release, shutdown, restart, rollback, backup, and restore runbook

This is an exact activation plan, not authorization. Running any systemd, AWS,
Cloudflare, DNS, secret, or target-host command requires the matching durable
external authorization described in `IP_OPS_ACTIVATION_REQUEST.md`.

## Release preparation (local/CI, no host mutation)

1. Check out the exact accepted integration SHA with a clean worktree.
2. Run `npm run test:i00:complete`. It runs `npm test`, `npm run test:all`, the
   accepted Q donor gate, both operations suites, and the candidate-bound local
   runtime/performance/browser evidence checks in the fixed local order. Use
   `--plan` for a no-execution preview or `--validate-only` to validate already
   generated evidence; neither mode is a substitute for the successful full run.
3. Produce a JSON tested receipt with the exact full SHA/tree, clean status,
   exact measured nested commands and real exit codes (including `npm test`,
   `npm run test:all`, `bash ops/tests/i00/run-all.sh`, and
   `npm run test:i00:complete`), lockfile hash, prepared runtime-dependency tree
   hash, candidate-bound runtime/performance/browser receipt hashes, and UTC
   completion time.
4. Produce prebuilt Linux runtime dependencies using the pinned lockfile in a
   controlled build environment. Do not install dependencies on the target
   during the switch.
5. An owner or CI builder with a durable identity prepares the canonical
   `I00_PRODUCTION_BUILD_V1` JSON predicate from
   `ops/templates/i00/build-attestation.example.json`, signs its exact bytes
   with an Ed25519 private key held outside this repository, and supplies the
   detached signature and corresponding public SPKI PEM. The predicate binds
   the clean tested SHA/tree, tested-receipt hash, lockfile, runtime dependency
   tree, both build-output trees, exact successful commands, both UTC completion
   times, and builder identity. Never copy the private key into a source tree,
   release, fixture, log, receipt, or target host.
6. Assemble the release with `ops/i00/bin/assemble-release.mjs`; production
   assembly refuses missing, malformed, forged, or mismatched attestations and
   embeds the attestation, detached signature, and public key. Simulation
   assembly is always `SIMULATION_ONLY_NOT_ATTESTED` and cannot pass production
   validation.
7. Run `validate-release.mjs --trusted-build-public-key <owner-controlled-path>`,
   which requires the embedded public key to match that external trust anchor
   and then reverifies the Ed25519 proof. Production wrappers use the equivalent
   `I00_TRUSTED_BUILD_PUBLIC_KEY` environment input and fail closed when it is
   absent. Then run the four snapshot probes, SQLite version check,
   and deploy preflight. Preserve their outputs in a release receipt.
   Keep target activation blocked until a hashed parent §23 capacity/soak
   receipt for the exact EC2 size or documented proxy proves bounded
   distributions and visible degradation before loss.
8. Under the separately authorized host-install class, install the embedded I00
   helper bundle to `/usr/local/lib/cosmos-ops/i00` with
   `install-ops-bundle.sh`. The install contains both the I00 wrappers and the
   release-embedded, read-only effective L15 `ops/live` root at
   `accepted-ops-live`; it does not need a Git checkout on the host. Each switch
   separately verifies the immutable accepted-donor contract, the closed
   correction contract, and the full effective-root inventory and digest before
   delegation. An explicit `DONOR_ROOT` is allowed only for another immutable
   copy with the same proofs; wrappers never infer a sibling
   `/usr/local/lib/ops/live` path. The install performs no unit install or
   restart. Verify its install receipt before installing the I00 systemd
   templates.

## Safe startup

1. Confirm the current/previous links and ledger/schema readback.
2. Start persistence, configuration, and secret provider prerequisites.
3. Start the optional Q sidecar only if its accepted command and protocol are
   configured; otherwise leave it explicitly `NOT_CONFIGURED`.
4. Start the app and wait for liveness, dependency readiness, and readiness.
5. Start or verify the tunnel and watchdog independently.
6. Keep trade readiness blocked until private truth/reconciliation/risk owners
   report canonical readiness. Readiness alone never grants money authority.

## Safe shutdown

1. Through the canonical Control Plane, halt new risk and new proposal/ticket
   intake. Record the durable command receipt.
2. Drain inference and decision queues while continuing reconciliation,
   position, liability, exit, and recovery supervision.
3. Refuse ordinary shutdown if exposure, liability, ambiguity, or recovery is
   unresolved; enter maintenance/recovery instead.
4. Reconcile, checkpoint, and make an application-consistent backup.
5. Stop analytical components and Q, then public/private sources.
6. Stop the app only after ledger flush and clean-shutdown readback.
7. Keep the external watchdog in maintenance-aware alert mode; never let it
   infer that stopped entry capability means flat exposure.

## Safe restart

Use the shutdown sequence first. Restart the app through the accepted service
owner, then require canonical reconciliation and all non-trade readiness gates.
Do not resume new exposure from process liveness. Preserve the mutable state
directories `/var/lib/cosmos/{data,evidence,models,ops}` outside releases.

## Rollback

1. Freeze new risk and capture canonical exposure/ambiguity/recovery readback.
2. Refuse automatic rollback unless the accepted donor's pre-money/literal
   `NONE` law applies. Otherwise require incident handling and authorization.
3. Run the rollback preflight against the exact candidate release and current
   rollback floor. Incompatible migrations are absolute blockers.
4. Delegate the atomic switch to the read-only effective L15 rollback tooling
   embedded with the installed I00 bundle (or an explicitly supplied immutable
   `DONOR_ROOT` that passes the same exact contract and critical-file proofs).
5. Reconcile and verify service, origin, tunnel, Access, watchdog, database,
   backup, and recovery readback before recording success.

Real release and rollback commands also require the exact evidence root, result
receipt target, and reconciliation receipt target authorized under §20. They
cannot return a proved success until the hashed semantic receipt validates.

## Backup and restore

- Backup uses the SQLite online backup API through effective L15. I00 additionally
  requires a WAL-fixed SQLite, `integrity_check=ok`, zero FK violations, hashes,
  and evidence/model policy readback. The installed backup and isolated-restore
  adapters use the same embedded `accepted-ops-live` root by default and verify
  both provenance contracts plus the immutable full effective inventory before
  use.
- Restore drills always use isolated temporary directories.
- I00 proves only isolated restore and performs no production swap. Before live
  activation, the L15 owner must amend its production restore path to stage on
  the target filesystem, preserve DB/evidence/model payloads, stop every app
  connection, fully verify the staged set, retain the prior set, and switch
  atomically under explicit authorization.
- Never copy a live WAL database file alone, remove an open database, or delete
  the prior database before the new database is verified and switched.

## Incident freeze

On any post-switch failure, schema ambiguity, missing readback, exposure,
recovery, Access failure, tunnel failure, stale backup, or watchdog exhaustion:
freeze deployment, halt new risk through the canonical Control Plane, preserve
reconciliation/recovery, capture one incident receipt, and do not clear the
incident until readback proves recovery.
