# I00 operations adaptation

This package adapts the accepted L15 deployment owner at commit
`2cec412927fa2f64f05a0b2774b18e45f8ce4fa5`. It does not copy or replace
`ops/live/**`. Every switch, rollback, backup, restore, and watchdog action
continues to be owned by the accepted donor; I00 adds final packaging,
preflight, canonical readback validation, safe restore staging, current
provider/monitoring templates, receipt schemas, and owner-gated runbooks.

Nothing in this package proves a deployment. All checked-in files are
`BUILT_AND_TESTED`; real AWS, Cloudflare, DNS, Secrets Manager, systemd, host,
or service state remains `NOT_CONFIGURED` or `OWNER_GATED` until exact target
readback exists.

## Safety posture

- Tests materialize the donor from Git into a temporary directory.
- Switch/rollback/restore simulation refuses the real `systemctl` command.
- Non-simulation mutation requires an unexpired durable authorization whose
  action class matches the requested operation.
- Secrets retrieval rejects static/ambient AWS credentials, accepts one exact
  fully suffixed secret ARN, uses an injected AWS CLI seam, and never prints a
  secret value.
- The app origin remains `127.0.0.1`; Cloudflare and AWS templates contain
  placeholders and no credentials.
- Artifact assembly never sets a deployed SHA or deployed status.
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

## Local proof

```bash
bash ops/tests/i00/run-all.sh
```

The suite is network-free except for donor loopback fake services. It runs the
accepted donor's 11 suites (347 assertions) and the additive I00 tests.

## Activation prerequisites

The target SQLite must include the WAL-reset fix: `3.51.3+`, `3.50.7`, or
`3.44.6`. The current local `sqlite3` is `3.51.0`, which is adequate for the
isolated donor fixture proof but is intentionally rejected by I00 production
preflight. Prefer the current supported SQLite release on the target.

Read [DONOR_ADAPTATION_MAP.md](../docs/i00/DONOR_ADAPTATION_MAP.md),
[RELEASE_AND_RECOVERY_RUNBOOK.md](../docs/i00/RELEASE_AND_RECOVERY_RUNBOOK.md),
and [OFFICIAL_INTERFACE_MATRIX.md](../docs/i00/OFFICIAL_INTERFACE_MATRIX.md)
before any activation.
