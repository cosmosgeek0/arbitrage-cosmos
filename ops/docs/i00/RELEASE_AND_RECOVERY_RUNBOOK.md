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

## First-host evidence and authorization order

A first-host release is two distinct wrapper invocations. First run
`release-switch.sh` with the exact recovery target and
`--prepare-first-host-evidence`, but with no authorization, operator, result,
or reconciliation receipt input. The wrapper produces and preflights one
retained mode-0700 evidence directory, emits
`FIRST_HOST_EVIDENCE_PREPARED`, and performs no donor deployment or service
mutation.

Only after that successful preparation may the owner create the release-switch
authorization. It must bind the emitted `firstHostEvidenceSha256` and the other
existing exact endpoints. The authorized switch then supplies the same
directory through `--first-host-evidence-dir`; the wrapper revalidates its four
mode-0600 files, live SQLite identity, clean host baseline, 300-second evidence
age, and remaining 300-second lease before delegation. It never regenerates or
substitutes first-host evidence during the authorized invocation.

## Backup configuration read boundary

Host preparation creates the system group `cosmos-backup` without adding the
`cosmos` user to it globally. Install
`ops/templates/i00/systemd/cosmos-backup-config-read.conf.template` as
`/etc/systemd/system/cosmos-backup.service.d/10-config-read.conf` and
`ops/templates/i00/tmpfiles/cosmos-backup-config-access.conf.template` as
`/etc/tmpfiles.d/cosmos-backup-config-access.conf`. The service drop-in gives
only `cosmos-backup.service` the supplementary group.

Keep `/etc/cosmos` owned by `root:cosmos` with mode `0750`. Keep
`cosmos-app.env`, `cosmos-backup.env`, and `cosmos-i00.env` owned by
`root:cosmos` with mode `0640`. Keep the two non-secret files
`cosmos-deploy.env` and `cosmos-watchdog.env` owned by `root:root` mode `0640`;
the exact-path tmpfiles policy adds read-only access for `cosmos-backup` without
changing those owner/group/mode values or granting other access. Apply it with
`systemd-tmpfiles --create /etc/tmpfiles.d/cosmos-backup-config-access.conf`
after both files exist and after every atomic replacement of either file.

Apply this boundary in the following order, replacing `<validated-release>`
with the canonical unpacked release path:

```sh
getent group cosmos-backup >/dev/null || groupadd --system cosmos-backup
install -d -o root -g root -m 0755 /etc/systemd/system/cosmos-backup.service.d
install -o root -g root -m 0644 <validated-release>/ops/templates/i00/systemd/cosmos-backup-config-read.conf.template /etc/systemd/system/cosmos-backup.service.d/10-config-read.conf
install -o root -g root -m 0644 <validated-release>/ops/templates/i00/tmpfiles/cosmos-backup-config-access.conf.template /etc/tmpfiles.d/cosmos-backup-config-access.conf
systemd-tmpfiles --create /etc/tmpfiles.d/cosmos-backup-config-access.conf
systemctl daemon-reload
```

Before enabling the backup timer, require every readback below to match the
sealed values. `SupplementaryGroups` must be exactly `cosmos-backup`; each ACL
must contain only `user::rw-`, owning `group::r--`, named
`group:cosmos-backup:r--`, `mask::r--`, and `other::---`; the two file
owner/group/mode rows must remain `root root 640`. The final command must
return `0`, proving that the `cosmos` account is not a global member of
`cosmos-backup`.

```sh
systemctl show --property=SupplementaryGroups --value cosmos-backup.service
getfacl --absolute-names --omit-header /etc/cosmos/cosmos-deploy.env /etc/cosmos/cosmos-watchdog.env
stat --format='%U %G %a %n' /etc/cosmos/cosmos-deploy.env /etc/cosmos/cosmos-watchdog.env
id cosmos >/dev/null && test "$(id -nG cosmos | tr ' ' '\n' | grep -Fxc cosmos-backup)" -eq 0
```

The `cosmos` account must not be added globally to `cosmos-backup`. Do not add a
default, recursive, directory-wide, wildcard, provider, authorization,
credential, or secret-file ACL. Credential-capable and other secret-bearing
files remain `root:root` mode `0600` with no named backup ACL. A missing group,
drop-in, exact ACL, or readable mandatory path blocks backup acceptance; it is
never repaired by widening file or directory modes. A host rebuild or restore
reinstalls this sealed permission contract before enabling the timer.

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
For a release, the wrapper's result target is the closed `RELEASE_SWITCH`
receipt containing only Gate 5 facts: the exact release and manifest,
authorization digest, conditional first-host evidence digest, current/previous
link readback, active app unit, donor exit `0`, and the donor's loopback
liveness/readiness gate. The separately pre-bound reconciliation target need
not exist and is not read at Gate 5. Edge/Access, watchdog, backup, isolated
restore, and reconciliation evidence are collected at their owning later
gates; the unchanged closed `DEPLOYMENT` receipt requires all of them before
final deployment acceptance.

## Backup and restore

- Backup uses the SQLite online backup API through effective L15. I00 additionally
  requires a WAL-fixed SQLite, `integrity_check=ok`, zero FK violations, hashes,
  and evidence/model policy readback. The installed backup and isolated-restore
  adapters use the same embedded `accepted-ops-live` root by default and verify
  both provenance contracts plus the immutable full effective inventory before
  use.
- Restore drills always use isolated temporary directories.
- I00 proves only isolated restore and performs no production swap. The closed
  `R3-D-BACKUP-008` amendment makes the L15 incident-recovery owner snapshot and
  verify the complete manifest/database/archive cohort before target creation,
  stage verified DB/evidence/report bytes on the target filesystem, require the
  app service to be provably inactive, identity-bind each publication, and
  restore the prior owned set on failure. Live activation must still rehearse
  the exact target filesystem and service-manager behavior under separate
  operator authorization; no activation is claimed here.
- Never copy a live WAL database file alone, remove an open database, or delete
  the prior database before the new database is verified and switched.

## Incident freeze

On any post-switch failure, schema ambiguity, missing readback, exposure,
recovery, Access failure, tunnel failure, stale backup, or watchdog exhaustion:
freeze deployment, halt new risk through the canonical Control Plane, preserve
reconciliation/recovery, capture one incident receipt, and do not clear the
incident until readback proves recovery.

## Replacing the installed ops bundle (F-041)

`install-ops-bundle.sh` correctly refuses an existing destination and installs
the bundle read-only (`chmod -R a-w`); this section is the reviewed reversal
that refusal message points at. Replacement is an owner-authorized host step:

1. Verify the outgoing installation before touching it:
   `cat <dest>/install-receipt.json` and record its `testedSha` in the
   incident/change log. If the receipt is missing or unreadable, treat the
   installation as unverified and preserve a copy
   (`cp -R <dest> <dest>.quarantine-$(date -u +%Y%m%dT%H%M%SZ)`) before removal.
2. Stop consumers first: `systemctl stop cosmos-watchdog.timer
   cosmos-backup.timer cosmos-restore-drill.timer` (units under
   `/etc/systemd/system` keep their files; only the scripts are replaced).
3. Make the tree writable and remove it: `chmod -R u+w <dest> && rm -rf <dest>`.
4. Re-run `install-ops-bundle.sh` from the NEW validated release with its full
   authorization arguments (same procedure as first install).
5. Compare the new `<dest>/install-receipt.json` against the outgoing record:
   the `testedSha` must be the new release's, and the receipt must validate.
6. Restart the timers stopped in step 2 and confirm one green watchdog pass.

The destination is `/usr/local/lib/cosmos-ops/i00`; the effective donor
scripts live under `<dest>/accepted-ops-live/bin/` (see F-040).
