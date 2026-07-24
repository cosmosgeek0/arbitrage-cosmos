# IP-OPS activation request

## Request state

`REQUESTED_NOT_AUTHORIZED`

This is a parameter and authorization request, not permission to execute. No
effect wrapper, provider call, systemd action, or vendor action below may run
until the owner creates the matching durable parent §20 authorization record.
Before that record exists, read-only validation and the create-only risk and
preview producers may run on a real host only through separately owner-approved
engineering access and only inside the dedicated evidence directories. Those
steps inspect local evidence and create `BOUND_NOT_AUTHORIZED` or
`PREVIEW_READY_NOT_AUTHORIZED`; they do not grant approval or perform an
operational effect. One action class never implies another. No withdrawal,
transfer-out, order, borrow/repay, leverage, or other money authority is
requested or permitted.

## Exact owner inputs required

### Release and trusted build

- final tested/integration full Git SHA and clean Git tree;
- tested receipt with exact successful `npm test`, `npm run test:all`, and
  `bash ops/tests/i00/run-all.sh` results;
- pinned runtime dependency tree digest and lockfile hash;
- canonical `I00_PRODUCTION_BUILD_V1` predicate, detached Ed25519 signature,
  durable builder identity, and owner-controlled trusted public SPKI PEM;
- schema/config/model revisions and rollback barrier/floor;
- exact release and artifact-manifest SHA-256 values.

### Host and runtime

- exact AWS account, region, instance ID/hostname, environment, AMI/OS,
  intended EC2 size, instance-role ARN, systemd version, service user/group,
  and stable-egress requirement/expected IP;
- canonical durable paths for releases, current/previous links, database,
  evidence, models, ops state, backups, receipts, and isolated restore drills;
- exact app unit, loopback liveness/readiness routes, probe command, exposure
  readback command, alert command, shutdown/drain/reconciliation commands;
- owner host readback with `TARGET_HOST_OWNER_READBACK`, exact account/host,
  free bytes, backup reserve, target SQLite version, timestamp, and evidence
  SHA-256;
- canonical supervisor snapshot/readback command, source timestamp, lease
  expiry, exposure/ambiguity/recovery/freeze states, schema and rollback floor;
- a WAL-reset-fixed supported target SQLite build (`3.51.3+`, `3.50.7`,
  `3.44.6`, or a newer supported fixed release). Local `3.51.0` is blocked.

### Secret and identity boundary

- one fully suffixed Secrets Manager ARN, exact region/account, required key
  names, and exact instance-role permission readback;
- optional exact customer-managed KMS key ARN and constrained decrypt policy,
  or explicit AWS-managed-key selection;
- exact 0600 runtime credential output path plus distinct result and
  reconciliation receipt paths below a dedicated root-owned mode-0700
  `/var/lib/cosmos-action-receipts`; never provide secret values here;
- Cloudflare account, tunnel ID, operator hostname, team domain, Access
  application/AUD, operator email/role, origin host, tunnel credential owner,
  and stable-egress readback;
- boundary evidence proving direct origin privacy, unauthenticated denial,
  authenticated 200, missing-JWT rejection, valid-JWT acceptance, and freshness.

### Monitoring, Q, backup, restore, and capacity

- exact CloudWatch region, namespace, log group, retention, instance-role
  policy, alarm names, action ARNs, alert destinations, heartbeat owner, and
  watchdog readback command;
- accepted Q entrypoint/command, protocol, port, dependencies, lifecycle owner,
  and health readback, or explicit `NOT_CONFIGURED`;
- backup directory/retention/age policy, database and filesystem capacity,
  isolated restore target, and receipt evidence root. Canonical
  `BACKUP_CREATE` is DB-only with empty `EVIDENCE_PATHS`; `/etc/cosmos` is never
  archived. Evidence/model archival is
  `BLOCKED_PENDING_EXPLICIT_READ_CAPABILITY` and requires a separate accepted
  read-capability amendment;
- accepted donor production-restore amendment for same-filesystem staging,
  complete DB/evidence/model verification, stopped connections, retained prior
  set, atomic switch, and rollback; until then production restore is blocked;
- hashed parent §23 capacity/soak receipt for the exact EC2 size or documented
  proxy with p50/p95/p99 and visible degradation/load-shedding proof;
- canonical parent §24 canary-envelope readback if a later, separately
  authorized canary is ever requested: at most 10 USDT aggregate, one active
  ticket, zero repeats before re-arm, 2 USDT aggregate loss, exact revision and
  expiry, and exact `BLOCKED_BY_MIN_NOTIONAL` math. IP-OPS will not execute it.

## Separate authorization classes

Each record must use the exact template at
`ops/templates/i00/external-authorization.json.template`, bind the exact account,
host, environment, command, product, endpoints/digests, credential permissions,
zero capital/notional effect, operational maximum, preconditions, start/expiry,
rollback/recovery, owner approval, and distinct result/reconciliation receipts.
Before the owner creates that record, the class request must pass the canonical
risk-version and action-preview producers. The owner copies the producer-bound
risk version, nonce, preview digest, and exact action into the approval; callers
receive the two producer artifacts and their dedicated persistent mode-0700
consumption root, never caller-created raw risk/nonce/preview values.
For ops-bundle install, backup, isolated restore, and secret materialization,
the two receipt targets must be absent below canonical mode-0700 parents. The
wrapper create-only publishes both exact mode-0600 outcome receipts after its
class-specific verification succeeds.

- `OPS_BUNDLE_INSTALL`
- `SECRET_MATERIALIZATION`
- `SERVICE_RELEASE_SWITCH`
- `SERVICE_ROLLBACK`
- `BACKUP_CREATE`
- `ISOLATED_RESTORE`
- AWS/Cloudflare/DNS/systemd activation: unavailable until the owner defines its
  exact non-overlapping class and target contract.
- `PRODUCTION_RESTORE`: unavailable until the donor amendment is accepted.
- Any private read, signed validation, or tiny-live canary is a different parent
  §20 authorization and is not granted by this packet.

## Exact producer input matrix

Every production risk invocation requires `--request`, `--class`, and
`--output`. The owner request supplies identity, authorization window, and
receipt targets only. The producer derives the exact class, host, release,
configuration, endpoint, executable, and digest bindings from the following
verified evidence; callers cannot supply a nonce, risk version, preview digest,
clock, or command-path override.

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
donor-root inputs are not production activation inputs.

## Placeholder-only command plan

The following commands are exact in shape and intentionally unresolved. Replace
every `<OWNER_INPUT_...>` only inside an approved activation workspace.

```bash
ops/i00/bin/run-fixed-node-gate.sh verify-donor.mjs --repo <OWNER_INPUT_REPO>

ops/i00/bin/run-fixed-node-gate.sh assemble-release.mjs \
  --source-root <OWNER_INPUT_CLEAN_SOURCE_ROOT> \
  --runtime-deps <OWNER_INPUT_PREBUILT_RUNTIME_DEPS> \
  --output-root <OWNER_INPUT_RELEASE_OUTPUT_ROOT> \
  --tested-sha <OWNER_INPUT_FULL_TESTED_SHA> \
  --tested-receipt <OWNER_INPUT_TESTED_RECEIPT_JSON> \
  --built-at-utc <OWNER_INPUT_BUILD_UTC> \
  --schema-version <OWNER_INPUT_SCHEMA_VERSION> \
  --config-revision <OWNER_INPUT_CONFIG_REVISION> \
  --model-revision <OWNER_INPUT_MODEL_REVISION> \
  --build-attestation <OWNER_INPUT_BUILD_ATTESTATION_JSON> \
  --build-attestation-signature <OWNER_INPUT_BUILD_ATTESTATION_SIG> \
  --build-attestation-public-key <OWNER_INPUT_BUILD_PUBLIC_KEY_PEM>

ops/i00/bin/run-fixed-node-gate.sh validate-release.mjs \
  --release <OWNER_INPUT_RELEASE_DIR> \
  --trusted-build-public-key <OWNER_INPUT_TRUSTED_BUILD_PUBLIC_KEY_PEM> \
  --require-exact-cohort

install -d -m 0700 <OWNER_INPUT_AUTHORIZATION_CONSUMPTION_ROOT>

ops/i00/bin/run-fixed-node-gate.sh produce-deployment-risk-version.mjs \
  --request <OWNER_INPUT_CLASS_ACTION_REQUEST_JSON> \
  --class <OWNER_INPUT_EXACT_ACTION_CLASS> \
  <OWNER_INPUT_EXACT_CLASS_EVIDENCE_ARGUMENTS_FROM_MATRIX> \
  --output <OWNER_INPUT_DEPLOYMENT_RISK_JSON>

ops/i00/bin/run-fixed-node-gate.sh produce-deployment-action-preview.mjs \
  --deployment-risk <OWNER_INPUT_DEPLOYMENT_RISK_JSON> \
  --consumption-root <OWNER_INPUT_AUTHORIZATION_CONSUMPTION_ROOT> \
  --output <OWNER_INPUT_ACTION_PREVIEW_JSON>

# Only after reviewing both outputs, the owner may create the matching
# external-authorization v2 document. Repeat the complete chain per class.

ops/i00/bin/run-fixed-node-gate.sh validate-config.mjs \
  --env <OWNER_INPUT_RUNTIME_ENV> \
  --expected-sha <OWNER_INPUT_FULL_TESTED_SHA>

ops/i00/bin/run-fixed-node-gate.sh probe.mjs --input <OWNER_INPUT_SUPERVISOR_JSON> --kind dependency --max-age-sec 30
ops/i00/bin/run-fixed-node-gate.sh probe.mjs --input <OWNER_INPUT_SUPERVISOR_JSON> --kind readiness --max-age-sec 30
ops/i00/bin/run-fixed-node-gate.sh probe.mjs --input <OWNER_INPUT_SUPERVISOR_JSON> --kind trade-readiness --max-age-sec 30
ops/i00/bin/run-fixed-node-gate.sh probe.mjs --input <OWNER_INPUT_SUPERVISOR_JSON> --kind recovery-readiness --max-age-sec 30

ops/i00/bin/run-fixed-node-gate.sh verify-readback.mjs \
  --input <OWNER_INPUT_DEPLOYMENT_READBACK_JSON> --max-age-sec 30 \
  --expected-sha <OWNER_INPUT_FULL_TESTED_SHA>

ops/i00/bin/run-fixed-node-gate.sh verify-cloudflare-readback.mjs \
  --input <OWNER_INPUT_CLOUDFLARE_READBACK_JSON> --max-age-sec 30 \
  --expected-hostname <OWNER_INPUT_OPERATOR_HOSTNAME> \
  --expected-account <OWNER_INPUT_CLOUDFLARE_ACCOUNT>

I00_TRUSTED_BUILD_PUBLIC_KEY=<OWNER_INPUT_TRUSTED_BUILD_PUBLIC_KEY_PEM> \
ops/i00/bin/install-ops-bundle.sh \
  --release <OWNER_INPUT_RELEASE_DIR> \
  --destination <OWNER_INPUT_IMMUTABLE_OPS_BUNDLE_DIR> \
  --authorization <OWNER_INPUT_OPS_INSTALL_AUTHORIZATION_JSON> \
  --operator <OWNER_INPUT_OPERATOR> \
  --config-version <OWNER_INPUT_CONFIG_VERSION> \
  --deployment-risk <OWNER_INPUT_OPS_INSTALL_DEPLOYMENT_RISK_JSON> \
  --action-preview <OWNER_INPUT_OPS_INSTALL_ACTION_PREVIEW_JSON> \
  --authorization-consumption-root <OWNER_INPUT_OPS_INSTALL_CONSUMPTION_ROOT> \
  --host <OWNER_INPUT_TARGET_HOST> --environment <OWNER_INPUT_ENVIRONMENT> \
  --account <OWNER_INPUT_ACCOUNT> \
  --result-receipt <OWNER_INPUT_INSTALL_RESULT_RECEIPT> \
  --reconciliation-receipt <OWNER_INPUT_INSTALL_RECONCILIATION_RECEIPT>

/usr/bin/node <OWNER_INPUT_INSTALLED_I00>/bin/secret-materialization.mjs \
  --authorization <OWNER_INPUT_SECRET_AUTHORIZATION_JSON> \
  --deployment-risk <OWNER_INPUT_SECRET_DEPLOYMENT_RISK_JSON> \
  --action-preview <OWNER_INPUT_SECRET_ACTION_PREVIEW_JSON> \
  --authorization-consumption-root <OWNER_INPUT_SECRET_CONSUMPTION_ROOT>

I00_TRUSTED_BUILD_PUBLIC_KEY=<OWNER_INPUT_TRUSTED_BUILD_PUBLIC_KEY_PEM> \
<OWNER_INPUT_INSTALLED_I00>/bin/release-switch.sh \
  --release <OWNER_INPUT_RELEASE_DIR> --env-file <OWNER_INPUT_DEPLOY_ENV> \
  --runtime-env <OWNER_INPUT_RUNTIME_ENV> --host <OWNER_INPUT_HOST_READBACK_JSON> \
  --supervisor <OWNER_INPUT_SUPERVISOR_JSON> \
  --authorization <OWNER_INPUT_SWITCH_AUTHORIZATION_JSON> \
  --operator <OWNER_INPUT_OPERATOR> \
  --config-version <OWNER_INPUT_CONFIG_VERSION> \
  --deployment-risk <OWNER_INPUT_SWITCH_DEPLOYMENT_RISK_JSON> \
  --action-preview <OWNER_INPUT_SWITCH_ACTION_PREVIEW_JSON> \
  --authorization-consumption-root <OWNER_INPUT_SWITCH_CONSUMPTION_ROOT> \
  --evidence-root <OWNER_INPUT_EVIDENCE_ROOT> \
  --result-receipt <OWNER_INPUT_DEPLOYMENT_RECEIPT> \
  --reconciliation-receipt <OWNER_INPUT_RECONCILIATION_RECEIPT>

I00_TRUSTED_BUILD_PUBLIC_KEY=<OWNER_INPUT_TRUSTED_BUILD_PUBLIC_KEY_PEM> \
<OWNER_INPUT_INSTALLED_I00>/bin/rollback-switch.sh \
  --release <OWNER_INPUT_ROLLBACK_RELEASE_DIR> --env-file <OWNER_INPUT_DEPLOY_ENV> \
  --runtime-env <OWNER_INPUT_RUNTIME_ENV> --host <OWNER_INPUT_HOST_READBACK_JSON> \
  --supervisor <OWNER_INPUT_SUPERVISOR_JSON> \
  --authorization <OWNER_INPUT_ROLLBACK_AUTHORIZATION_JSON> \
  --operator <OWNER_INPUT_OPERATOR> \
  --config-version <OWNER_INPUT_CONFIG_VERSION> \
  --deployment-risk <OWNER_INPUT_ROLLBACK_DEPLOYMENT_RISK_JSON> \
  --action-preview <OWNER_INPUT_ROLLBACK_ACTION_PREVIEW_JSON> \
  --authorization-consumption-root <OWNER_INPUT_ROLLBACK_CONSUMPTION_ROOT> \
  --evidence-root <OWNER_INPUT_EVIDENCE_ROOT> \
  --result-receipt <OWNER_INPUT_ROLLBACK_RECEIPT> \
  --reconciliation-receipt <OWNER_INPUT_RECONCILIATION_RECEIPT>

<OWNER_INPUT_INSTALLED_I00>/bin/backup-verify.sh \
  --env-file <OWNER_INPUT_BACKUP_ENV> \
  --authorization <OWNER_INPUT_BACKUP_AUTHORIZATION_JSON> \
  --operator <OWNER_INPUT_OPERATOR> \
  --deployed-sha <OWNER_INPUT_FULL_TESTED_SHA> \
  --config-version <OWNER_INPUT_CONFIG_VERSION> \
  --deployment-risk <OWNER_INPUT_BACKUP_DEPLOYMENT_RISK_JSON> \
  --action-preview <OWNER_INPUT_BACKUP_ACTION_PREVIEW_JSON> \
  --authorization-consumption-root <OWNER_INPUT_BACKUP_CONSUMPTION_ROOT> \
  --host <OWNER_INPUT_TARGET_HOST> --environment <OWNER_INPUT_ENVIRONMENT> \
  --account <OWNER_INPUT_ACCOUNT> \
  --result-receipt <OWNER_INPUT_BACKUP_RESULT_RECEIPT> \
  --reconciliation-receipt <OWNER_INPUT_BACKUP_RECONCILIATION_RECEIPT>

<OWNER_INPUT_INSTALLED_I00>/bin/restore-drill-verify.sh \
  --backup <OWNER_INPUT_EXACT_BACKUP_DIR> \
  --target <OWNER_INPUT_ISOLATED_RESTORE_DIR> \
  --env-file <OWNER_INPUT_BACKUP_ENV> \
  --authorization <OWNER_INPUT_ISOLATED_RESTORE_AUTHORIZATION_JSON> \
  --operator <OWNER_INPUT_OPERATOR> \
  --deployed-sha <OWNER_INPUT_FULL_TESTED_SHA> \
  --config-version <OWNER_INPUT_CONFIG_VERSION> \
  --deployment-risk <OWNER_INPUT_RESTORE_DEPLOYMENT_RISK_JSON> \
  --action-preview <OWNER_INPUT_RESTORE_ACTION_PREVIEW_JSON> \
  --authorization-consumption-root <OWNER_INPUT_RESTORE_CONSUMPTION_ROOT> \
  --host <OWNER_INPUT_TARGET_HOST> --environment <OWNER_INPUT_ENVIRONMENT> \
  --account <OWNER_INPUT_ACCOUNT> \
  --result-receipt <OWNER_INPUT_RESTORE_RESULT_RECEIPT> \
  --reconciliation-receipt <OWNER_INPUT_RESTORE_RECONCILIATION_RECEIPT>
```

## Stop conditions

Stop without mutation on any missing/expired authorization, digest mismatch,
unknown source, stale readback, insufficient disk, unsafe SQLite, public origin,
Access/JWT failure, watchdog failure, exposure, ambiguity, recovery, schema
incompatibility, missing semantic receipt, absent capacity proof, or unresolved
production-restore amendment.
