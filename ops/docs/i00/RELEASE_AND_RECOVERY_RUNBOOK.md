# Release, shutdown, restart, rollback, backup, and restore runbook

This is an exact activation plan, not authorization. Running any systemd, AWS,
Cloudflare, DNS, secret, donor-effect, or service-mutation command requires the
matching durable external authorization described in
`IP_OPS_ACTIVATION_REQUEST.md`. Before that authorization exists, read-only
validation and the create-only risk and preview producers may run on the target
only through separately owner-approved engineering access and only inside the
dedicated evidence directories. They inspect local evidence and publish
`BOUND_NOT_AUTHORIZED` or `PREVIEW_READY_NOT_AUTHORIZED`; they do not call a
provider, mutate a service, or grant approval.

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
6. Run every direct production `.mjs` gate through the root-only
   `ops/i00/bin/run-fixed-node-gate.sh <allowlisted-gate> ...` launcher; do not
   activate a gate through its shebang or ambient `node`. Assemble the release
   with `run-fixed-node-gate.sh assemble-release.mjs`; production
   assembly refuses missing, malformed, forged, or mismatched attestations and
   embeds the attestation, detached signature, and public key. Production
   source reads use one fixed-safe-path, canonical Git executable whose bytes
   and filesystem identity are checked around every invocation; ambient
   `PATH` cannot select Git. Simulation assembly is Git-free, is always
   `SIMULATION_ONLY_NOT_ATTESTED`, and cannot pass production validation.
7. Run
   `run-fixed-node-gate.sh validate-release.mjs --trusted-build-public-key <owner-controlled-path> --require-exact-cohort`,
   which requires the embedded public key to match that external trust anchor,
   reverifies the Ed25519 proof, and refuses a validation-only historical
   cohort. Plain validation admits only the one fully content-pinned historical
   cohort and verifies its own pinned L15 amendment contract; it never applies
   the current cohort's amendment pin to historical sealed bytes. Production
   wrappers use the equivalent
   `I00_TRUSTED_BUILD_PUBLIC_KEY` environment input and require the same exact
   cohort. Then run the four snapshot probes, SQLite version check, and deploy
   preflight. Preserve their outputs in a release receipt.
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
   restart. Its receipt is an absent-only private descriptor-relative create;
   exact bytes and both file and staging-parent durability are verified before
   the tree is frozen. Verify that receipt before installing the I00 systemd
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

## Authorization evidence order

Use the same closed evidence order for every external action class:

1. Create one exact request from
   `ops/templates/i00/deployment-action-request.json.template`. Bind the
   operator, approver, approval reference, authorization identity, action
   class, tested/deployed SHA, configuration, target, validity window,
   endpoints, and prerequisite receipts. A first-host release-switch request
   must include the already prepared first-host evidence endpoint.
2. Create `/var/lib/cosmos-deployment-authorization` and
   `/var/lib/cosmos-action-receipts` as `root:root` mode `0700`. Every request
   binds two absent outputs below the latter directory. Run
   `produce-deployment-risk-version.mjs` with that request and a new output
   below the authorization directory. The producer validates the class policy,
   generates the nonce, derives the deployment-risk version, and create-only
   writes `BOUND_NOT_AUTHORIZED`.
3. Create a dedicated persistent mode-0700 authorization-consumption
   directory. The secrets-provider unit owns the exact
   `/var/lib/cosmos-authorization-consumption` state directory. Run
   `produce-deployment-action-preview.mjs` with the risk artifact, that exact
   directory, and a new output below
   `/var/lib/cosmos-deployment-authorization`. The producer derives the
   class-specific preview and create-only writes
   `PREVIEW_READY_NOT_AUTHORIZED`.
4. Only then may the owner issue the separate v2 `APPROVED` authorization. Its
   complete binding must exactly match the request, risk artifact, preview,
   and validity window. Neither producer output is approval.
5. Invoke the class wrapper with the authorization, deployment-risk artifact,
   action-preview artifact, and authorization-consumption directory. The
   wrapper first proves both receipt targets are absent below canonical
   mode-0700 parents. The validator then rereads and recomputes the entire
   chain before atomically creating the exact mode-0600 consumption receipt.
   Only that one winning consumer may continue.
6. After a successful effect, the class outcome owner rereads the exact
   authorization chain and consumption claim, rechecks class-specific evidence,
   and create-only publishes the bound mode-0600 result followed by its
   reconciliation commit marker. Missing either receipt is failure, never
   success. Release-switch uses its closed Gate-5 semantic receipt owner;
   rollback retains its closed semantic receipt owner and later evidence gates.
7. A refusal, failed action, retry, or concurrent attempt never revives the
   consumed authorization. Begin again with a new request run and producer
   nonce.

Every production risk invocation requires `--request`, `--class`, and
`--output`. The request supplies identity, authorization window, and receipt
targets only; the producer derives the operational bindings from these exact
class inputs:

| class | additional required risk-producer inputs |
|---|---|
| `OPS_BUNDLE_INSTALL` | `--release`, `--trusted-build-public-key`, `--host-readback`, `--host-evidence`, `--destination` |
| `SERVICE_RELEASE_SWITCH` | `--release`, `--trusted-build-public-key`, `--runtime-env`, `--deploy-env`, `--sqlite`, plus exactly either `--host-readback` with `--host-evidence` or `--first-host-evidence-dir` |
| `SERVICE_ROLLBACK` | `--release`, `--trusted-build-public-key`, `--host-readback`, `--host-evidence`, `--runtime-env`, `--deploy-env`, `--rollback-evidence-root` |
| `BACKUP_CREATE` | `--host-readback`, `--host-evidence`, `--runtime-env`, `--backup-env` |
| `ISOLATED_RESTORE` | `--host-readback`, `--host-evidence`, `--runtime-env`, `--backup-env`, `--backup`, `--target` |
| `SECRET_MATERIALIZATION` | `--provider-config`, `--credential-output` |

Every preview invocation requires exactly `--deployment-risk`,
`--consumption-root`, and `--output`. Production refuses caller clocks, nonces,
simulation command roots, simulation donor roots, and command-path overrides.
Wrappers independently recheck every bound endpoint identity immediately before
the authorized effect.

For `SECRET_MATERIALIZATION`, resolve the AWS CLI symlink chain before the
request is created. Record the resulting canonical regular non-symlink
executable path and its SHA-256 digest in the provider config and exact preview
endpoints. Also bind the exact same-account IAM instance role ARN, without an
IAM path, and both permissions `sts:GetCallerIdentity` and
`secretsmanager:GetSecretValue`. The provider uses no caller-supplied CLI
override in real mode. It hashes the configured executable, consumes the
authorization, rechecks that executable, calls STS through a closed
environment, requires the returned assumed-role account and role name to match
the exact configured role, rechecks the executable again, and only then reads
the exact secret ARN. No secret value is emitted.

The accepted historical sealed release may be checked through the
code-pinned `PINNED_LEGACY_VALIDATION_ONLY` bridge. That status is
non-installable. Omitting `--require-exact-cohort` is reserved only for that
historical Linux validation proof. No caller input can add another bridge tuple
or convert it to `EXACT_TRUSTED_COHORT`.

## Backup configuration read boundary

The retained unit-scoped ACL contract below is historical host-preparation
readback for the inert service template. It is not an authorized-effect read
capability and must not be used to archive configuration. The production
`BACKUP_CREATE` wrapper passes only the retained `DATA_DIR` read capability;
its canonical backup environment has empty `EVIDENCE_PATHS`, and a nonempty
value is rejected before the donor effect. `/etc/cosmos` is never archived.

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

The scheduled backup, restore-drill, and watchdog units remain deliberately
inert until a separately ratified action class exists for their activation.
Do not enable or manually start them. Before accepting the retained backup
permission boundary for an owner-authorized `BACKUP_CREATE` wrapper invocation,
require every readback below to match the sealed values.
`SupplementaryGroups` must be exactly `cosmos-backup`; each ACL
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
reinstalls this sealed permission contract before a separately authorized
backup wrapper invocation. It does not enable the inert timer.

## Safe startup

1. Confirm the current/previous links and ledger/schema readback.
2. Start persistence, configuration, and secret provider prerequisites.
3. Start the optional Q sidecar only if its accepted command and protocol are
   configured; otherwise leave it explicitly `NOT_CONFIGURED`.
4. Start the app and wait for liveness, dependency readiness, and readiness.
5. Start or verify the tunnel independently. Keep the watchdog unit and timer
   inert; no production watchdog action class is ratified.
6. Keep trade readiness blocked until private truth/reconciliation/risk owners
   report canonical readiness. Readiness alone never grants money authority.

## Safe shutdown

1. Through the canonical Control Plane, halt new risk and new proposal/ticket
   intake. Record the durable command receipt.
2. Drain inference and decision queues while continuing reconciliation,
   position, liability, exit, and recovery supervision.
3. Refuse ordinary shutdown if exposure, liability, ambiguity, or recovery is
   unresolved; enter maintenance/recovery instead.
4. Reconcile and checkpoint. Create an application-consistent backup only
   through a separate `BACKUP_CREATE` authorization.
5. Stop analytical components and Q, then public/private sources.
6. Stop the app only after ledger flush and clean-shutdown readback.
7. Keep the inert watchdog state explicit. Use only the separately authorized
   monitoring owner; no donor watchdog activation is implied.

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
For a release, the wrapper's result target is the closed v2 `RELEASE_SWITCH`
receipt containing only Gate 5 facts: the exact release and manifest, complete
authorization/risk/preview/consumption binding, conditional first-host evidence
digest, current/previous link readback, active app unit, donor exit `0`, and the
donor's loopback liveness/readiness gate. The separately pre-bound
reconciliation target is created and directory-synced last as the Gate-5 commit
marker; it binds the exact result digest and explicitly leaves later gates
pending. Edge/Access, watchdog, backup, isolated restore, and final
reconciliation evidence remain owned by their later gates; the unchanged
closed `DEPLOYMENT` receipt requires all of them before final deployment
acceptance.

An authorized rollback intentionally has two invocations. The initial
`rollback-switch.sh` stages and consumes the evidence chain, while the bound
effect runner retains the root capabilities and the donor owns canonical
deploy-lock acquisition/reuse, the switch, and durable effect readback. The
wrapper does not mutate that lock or any donor marker. A successful effect
returns `75`, not success, and leaves the result and
authorized-reconciliation targets absent. Under
`<rollback-evidence-root>/<preview-claim-key>/`, it creates
`pre-target-readback.json`, `post-target-readback.json`, `authorization.json`,
and `rollback-effect.json`. Before and after the donor, the wrapper rechecks the
authorization-bound loaded unit fragment, no-drop-in/no-reload state, and exact
env/Node `ExecStart`; the outcome recorder independently repeats that binding.

If the immutable donor exits `3`, the release switch has already occurred but
restart/readiness failed and the deployment is frozen. Before returning, the
donor has already written the marker through its retained `opsStateDir`
capability, opened that exact file without following a link, changed it to mode
`0400`, and fsynced both file and directory capability. The wrapper only reads
and captures that already sealed marker with the exact switched links into the
five-file private claim; it never mutates the named marker. It then publishes
the failed-after-effect result and its
reconciliation commit marker last. It then preserves exit `3`; this path never
claims `ROLLED_BACK_PROVED` and is not eligible for `--finalize-only`.

If the immutable donor exits `1`, `4`, `5`, or `6`, it refused before the
switch. Because authorization is already consumed, the wrapper must not return
with only staged evidence. It proves both release links still match the staged
readback, records the exact donor refusal class in `rollback-refusal.json`,
publishes an `ACTION_REFUSED_NO_EFFECT` result and its reconciliation commit
marker, then preserves the donor exit code. This terminal path has exactly four
claim files, contains no `rollback-effect.json`, and is not eligible for
`--finalize-only`.

After the independent gates create mode-0600 canonical
`cloudflare-boundary.json`, `watchdog.json`, `database-schema.json`,
`backup.json`, `recovery.json`, and `reconciliation.json` in that same private
claim directory, repeat the exact rollback wrapper inputs with
`--finalize-only`. The finalizer does not consume a second authorization or
repeat the switch. It requires the existing consumption claim, exact ten-file
inventory, unchanged pre/post transition, active service, loopback health, and
all nine semantic evidence files. Only then does it create the v2 `ROLLBACK`
result followed by the distinct authorized reconciliation as the commit
marker. Missing, extra, stale, noncanonical, or semantically contradictory
evidence remains a blocker.

## Backup and restore

- Backup uses the SQLite online backup API through effective L15. I00
  additionally requires a WAL-fixed SQLite, `integrity_check=ok`, zero FK
  violations, and hashes. Authorized `BACKUP_CREATE` is DB-only: the canonical
  environment has empty `EVIDENCE_PATHS`, nonempty values fail before effect,
  and `/etc/cosmos` is never archived. DB backup remains available; evidence
  and model archival is `BLOCKED_PENDING_EXPLICIT_READ_CAPABILITY`. The
  installed backup and isolated-restore adapters use the same embedded
  `accepted-ops-live` root by default and verify both provenance contracts plus
  the immutable full effective inventory before use. Its donor reports one
  canonical publication claim through the retained output descriptor only
  after durable completion and final capability checks. The runner accepts a
  successful terminal outcome only after independently proving one exact added
  direct child and binding its identity, manifest, database, tree, and
  pre/post backup-root inventories.
- Restore proofs always use isolated temporary directories.
- I00 and effective L15 permit only isolated restore and perform no production
  swap. The closed amendment snapshots and verifies the complete
  manifest/database/archive cohort before isolated-target creation. Canonical
  authorized backups currently contain only the verified DB and report bytes;
  direct contained staging fixtures may retain legacy archives as test inputs.
  The restore stages the verified cohort on the target filesystem,
  identity-binds publication, and removes only its unpublished isolated staging
  bytes on failure. The retained `--allow-production` spelling fails closed and
  cannot be combined with confirmation, force, service state, or an action
  class to target `DATA_DIR`.
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
2. Prove `cosmos-watchdog.timer`, `cosmos-backup.timer`, and
   `cosmos-restore-drill.timer` are inactive and their sealed
   `ConditionPathExists=!/` plus `RefuseManualStart=yes` barriers remain loaded.
   If any is active, treat that as an incident; this replacement procedure does
   not authorize stopping or mutating it.
3. Make the tree writable and remove it: `chmod -R u+w <dest> && rm -rf <dest>`.
4. Re-run `install-ops-bundle.sh` from the NEW validated release with its full
   authorization arguments (same procedure as first install).
5. Compare the new `<dest>/install-receipt.json` against the outgoing record:
   the `testedSha` must be the new release's, and the receipt must validate.
6. Re-prove all three timers remain inactive and barred from activation. Do not
   start them as part of bundle replacement.

The destination is `/usr/local/lib/cosmos-ops/i00`; the effective donor
scripts live under `<dest>/accepted-ops-live/bin/` (see F-040).
