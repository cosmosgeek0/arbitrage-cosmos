# I00 operations adaptation

This package adapts the accepted L15 deployment owner at commit
`2cec412927fa2f64f05a0b2774b18e45f8ce4fa5`. The immutable donor contract,
Git trees, receipt, and donor tests remain exact. Post-integration Role 3
corrections to `ops/live/**` are allowed only through the separate, closed
`l15-amendment-contract.json`, which binds every changed path and before/after
blob, the focused evidence, and the complete effective runtime inventory.
Every switch, rollback, backup, restore, and watchdog action remains owned by
that effective L15 root; I00 adds final packaging, preflight, canonical
readback validation, safe restore staging, current provider/monitoring
templates, receipt schemas, and owner-gated runbooks.

Nothing in this package proves a deployment. All checked-in files are
`BUILT_AND_TESTED`; real AWS, Cloudflare, DNS, Secrets Manager, systemd, host,
or service state remains `NOT_CONFIGURED` or `OWNER_GATED` until exact target
readback exists.

## Safety posture

- Historical donor tests materialize the accepted Git object; runtime and
  release tests materialize the separately verified effective root.
- Switch/rollback/restore simulation refuses the real `systemctl` command.
- Non-simulation mutation requires an unexpired durable authorization whose
  action class matches the requested operation.
- Secrets retrieval rejects static/ambient AWS credentials, accepts one exact
  fully suffixed secret ARN, binds and rechecks one canonical AWS CLI path and
  digest, proves one exact instance role through STS, permits CLI injection
  only inside the sealed simulation seam, and never prints a secret value.
- The app origin remains `127.0.0.1`; Cloudflare and AWS templates contain
  placeholders and no credentials.
- Artifact assembly never sets a deployed SHA or deployed status.
- Production source assembly and non-contract donor verification execute only
  one fixed-safe-path canonical Git binary and recheck its digest and identity
  around each invocation. Contract-only on-host donor verification and
  simulation assembly remain Git-free.
- Non-secret environment validation rejects placeholders, public bind addresses,
  duplicate keys, embedded secret values, non-absolute durable paths, and
  incomplete Access/operator identity.
- Deployment freezes on exposure, ambiguity, recovery, schema incompatibility,
  insufficient disk, missing canonical readback, or unsafe SQLite.
- Production donor environments are normalized to numeric loopback, an enabled
  candidate probe, exact `/health/live /health/ready` gates, and canonical
  deploy-frozen/money-ready marker paths; caller weakening is rejected.
- Release `schemaVersion`, `rollbackFloor`, and `rollbackBarrier` are derived
  from the tested `server/dist/ledger.js` exports and reverified from the
  release-local compiled artifact. Caller compatibility overrides are refused.
- `bin/exposure-from-app.mjs` performs one bounded read-only GET against the
  exact numeric-loopback `/api/system-integration/ops/readback` contract. Any
  transport, status, body, schema, freshness, or lease failure prints only
  `UNKNOWN`. Production sanitization binds `EXPOSURE_CMD` to the release-installed
  helper and derives its readback URL from the canonical app origin. The
  server-side producer remains `NOT_CONFIGURED` until mounted.

## Deployment authorization evidence

External authorization is downstream evidence, never an input that may define
its own risk or preview bindings. Start from one canonical
`deployment-action-request.json` shaped by
`ops/templates/i00/deployment-action-request.json.template`. Then:

1. `bin/produce-deployment-risk-version.mjs` validates the closed request and
   exact action-class policy, creates one random nonce, and writes one
   create-only `BOUND_NOT_AUTHORIZED` risk artifact.
2. `bin/produce-deployment-action-preview.mjs` rereads that artifact, derives
   the class-specific command, scope, credential, permission, effect,
   precondition, rollback, recovery, and endpoint digest, and writes one
   create-only `PREVIEW_READY_NOT_AUTHORIZED` preview artifact.
3. The owner may separately issue an `APPROVED` authorization whose complete
   binding matches both artifacts. `bin/validate-authorization.mjs` recomputes
   every digest and atomically creates the preview-bound consumption claim.
   Reuse, concurrent reuse, caller-defined nonce/risk/preview values, widened
   permissions, and altered class semantics fail closed.

Before the class authorization exists, these two create-only producers may run
on a real host only through separately owner-approved engineering access and
inside dedicated evidence directories. They inspect local evidence and do not
call a provider, mutate a service, execute the donor effect, or grant approval.
Every effect wrapper remains blocked until the owner supplies the matching
durable class authorization.

Every production risk invocation requires `--request`, `--class`, and
`--output`. The request supplies identity, authorization window, and receipt
targets only; the producer derives exact operational bindings from these
class-specific evidence inputs:

| class | additional required risk-producer inputs |
|---|---|
| `OPS_BUNDLE_INSTALL` | `--release`, `--trusted-build-public-key`, `--host-readback`, `--host-evidence`, `--destination` |
| `SERVICE_RELEASE_SWITCH` | `--release`, `--trusted-build-public-key`, `--runtime-env`, `--deploy-env`, `--sqlite`, plus exactly either `--host-readback` with `--host-evidence` or `--first-host-evidence-dir` |
| `SERVICE_ROLLBACK` | `--release`, `--trusted-build-public-key`, `--host-readback`, `--host-evidence`, `--runtime-env`, `--deploy-env`, `--rollback-evidence-root` |
| `BACKUP_CREATE` | `--host-readback`, `--host-evidence`, `--runtime-env`, `--backup-env` |
| `ISOLATED_RESTORE` | `--host-readback`, `--host-evidence`, `--runtime-env`, `--backup-env`, `--backup`, `--target` |
| `SECRET_MATERIALIZATION` | `--provider-config`, `--credential-output` |

Every preview invocation requires exactly `--deployment-risk`,
`--consumption-root`, and `--output`. Test-only clock, nonce, command-root, and
donor-root inputs are not production inputs. Wrappers independently recheck
every bound endpoint identity immediately before effects.

Production risk artifacts are marked `SYSTEM_CLOCK_CRYPTOGRAPHIC_NONCE`.
Explicit test-clock artifacts are marked `TEST_FIXTURE_INJECTED` and the real
validator refuses them. Production previews bind a persistent mode-0700
consumption root; the secrets-provider unit creates its exact
`/var/lib/cosmos-authorization-consumption` state directory. Every claim file
and its parent directory are durability-synced before an action may continue.
Risk and preview producer outputs live below the separately prepared
root-owned mode-0700 `/var/lib/cosmos-deployment-authorization` directory.
Ops-bundle install, backup, isolated restore, and secret materialization also
preflight distinct absent targets below a root-owned mode-0700
`/var/lib/cosmos-action-receipts` directory. After the effect succeeds,
`bin/record-authorized-action-outcome.mjs` revalidates the consumed chain and
class-specific evidence, then create-only writes both mode-0600 receipts.
Receipt publication failure remains a failed consumed action.
`SERVICE_RELEASE_SWITCH` uses its dedicated v2 Gate-5 result owner and publishes
the preview-bound Gate-5 reconciliation last as the directory-synced commit
marker; that marker does not claim edge, watchdog, backup, restore, or final
deployment reconciliation.

`SERVICE_ROLLBACK` is a staged terminal-proof lifecycle. The initial authorized
invocation records `pre-target-readback.json`, performs the exact switch, then
records `post-target-readback.json`, `authorization.json`, and
`rollback-effect.json` below the preview claim key. It exits `75` with
reconciliation pending and leaves both terminal receipt targets absent. The
wrapper and outcome recorder bind the loaded application unit fragment,
drop-in state, reload state, and exact env/Node `ExecStart` before accepting
the switch readback. The
claim directory must then contain the six independently produced
`cloudflare-boundary.json`, `watchdog.json`, `database-schema.json`,
`backup.json`, `recovery.json`, and `reconciliation.json` files. Re-running the
same rollback wrapper with `--finalize-only` rechecks the live release, service,
health, consumed authorization chain, exact ten-file claim inventory, and all
nine semantic evidence gates before publishing the v2 `ROLLBACK` result first
and its authorized reconciliation last.

Donor exit `3` is a distinct post-effect failure: the release links have
already switched and the donor has frozen the deployment. The wrapper captures
the exact failed post-switch readback, seals the donor marker mode `0400`, and
copies canonical `frozen-marker.json`,
records a frozen `rollback-effect.json`, then publishes an
`ACTION_FAILED_AFTER_EFFECT` result followed by its reconciliation commit
marker. It exits `3`, never emits `ROLLED_BACK_PROVED`, and cannot enter the
success finalizer.

Donor exits `1`, `4`, `5`, and `6` are terminal pre-switch refusals. After
authorization consumption, the wrapper proves that the staged current and
previous release links remain exact, writes `refusal-readback.json`,
`authorization.json`, and `rollback-refusal.json` beside the staged
`pre-target-readback.json`, then publishes an `ACTION_REFUSED_NO_EFFECT`
result and reconciliation commit marker. It preserves the donor exit code,
never writes `rollback-effect.json`, and cannot enter the success finalizer.

The six supported classes are `OPS_BUNDLE_INSTALL`,
`SERVICE_RELEASE_SWITCH`, `SERVICE_ROLLBACK`, `BACKUP_CREATE`,
`ISOLATED_RESTORE`, and `SECRET_MATERIALIZATION`. Producers grant no
authorization and perform no deployment action.

`bin/run-bound-effect.mjs` is the only production donor launcher. Its public
interface accepts exactly the four canonical authorization-chain document
paths, then `--` and the authorization-bound script; only environment-bearing
classes also accept the one canonical sanitized-environment path. The runner
opens and rechecks the documents, consumption root, start evidence, script,
typed environment/config, common bootstrap or verifier source, interpreter,
typed temporary/output directory, class executables, and class helpers before
the identity drop. The child receives fixed descriptor slots rather than
caller-selected command paths.

Shell donors preload the descriptor-bound `common.sh`, which invokes the
independently anchored handoff verifier, emits exactly one primary
acknowledgement, and derives readonly class, command, environment, executable,
and helper policy from the verifier's closed output. Release auto-rollback has
its own script, handoff, and acknowledgement descriptors; it cannot reuse the
primary capability. Secret materialization receives its provider config and
credential-output parent as typed descriptors. Descriptor locators use fixed
uppercase underscore names; document endpoint names are never converted into
environment-variable names dynamically.

Release and rollback exposure checks use the verified Node and exposure-helper
descriptors with no helper arguments and a 3000 ms outer timeout. Their local
alerts use the verified Bash and alert-log descriptors with exactly the
severity, code, and message arguments and a 5000 ms outer timeout. Authorized
deploy environments bind `GATE_TIMEOUT_SEC=60`, `HTTP_TIMEOUT_SEC=5`,
`LOCK_TIMEOUT_SEC=30`, and `I00_OPS_READBACK_TIMEOUT_MS=750`, and reject named
`EXPOSURE_CMD` or `ALERT_CMD` selection.

Every directly invoked production `.mjs` gate runs through
`bin/run-fixed-node-gate.sh`. The root-only launcher selects only a
root-owned, non-writable `/usr/bin/node` after a
fixed-path bootstrap check, clears runtime and loader injection variables,
rechecks executable identity, and starts the allowlisted gate in a closed
environment. Direct shebang or ambient-`node` activation is development-only.

`bin/validate-release.mjs` normally requires the validator and release to be
the same exact trusted cohort. A single code-pinned historical sealed tuple is
accepted only as `PINNED_LEGACY_VALIDATION_ONLY` so its immutable receipt can
be checked with the corrected host-neutral validator. It cannot be selected
by arguments or environment and `bin/install-ops-bundle.sh` refuses to install
it. Omitting `--require-exact-cohort` is reserved for that historical Linux
proof; activation always requires the flag. Every installable release remains
`EXACT_TRUSTED_COHORT`.

`bin/publish-install-receipt.mjs` exact-creates the install receipt through a
held private staging-directory descriptor on Linux, verifies owner, mode,
identity, and exact bytes, and syncs both the file and parent before the
installed tree can be frozen or published.

## Local proof

```bash
bash ops/tests/i00/run-all.sh
```

The suite is network-free except for donor loopback fake services. It replays
the accepted donor's immutable 11 suites (347 assertions), verifies the closed
effective-root amendment, and runs the additive I00 tests.

## Activation prerequisites

The target SQLite must include the WAL-reset fix: `3.51.3+`, `3.50.7`, or
`3.44.6`. The current local `sqlite3` is `3.51.0`, which is adequate for the
isolated donor fixture proof but is intentionally rejected by I00 production
preflight. Prefer the current supported SQLite release on the target.

Read [DONOR_ADAPTATION_MAP.md](../docs/i00/DONOR_ADAPTATION_MAP.md),
[RELEASE_AND_RECOVERY_RUNBOOK.md](../docs/i00/RELEASE_AND_RECOVERY_RUNBOOK.md),
and [OFFICIAL_INTERFACE_MATRIX.md](../docs/i00/OFFICIAL_INTERFACE_MATRIX.md)
before any activation.
