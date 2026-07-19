# FIX-031 / CS-06 correction receipt — DATA_DIR lease deployment authority and inert token removal

Status: `CORRECTED_AND_REGRESSION_TESTED`

The final landing (current-main 28fe54c8) carried two accepted corrections into
the effective L15 operations tree:

FIX-031 (fail-closed single-process DATA_DIR lease, bucket-D item 1): the
deployment surface now documents and enforces the lease's host preconditions.
The systemd unit provisions a private runtime directory
(`RuntimeDirectory=cosmos-app`, mode 0700, preserved across restarts) and pins
the deployment-owned `DATA_DIR_LOGICAL_LEASE_ROOT=/run/cosmos-app/data-dir-leases`
inside `ExecStart` via `/usr/bin/env`, because `EnvironmentFile=` overrides
`Environment=` regardless of line order. `ReadWritePaths` admits the runtime
lease root. The environment template constrains `DATA_DIR` to ASCII components
and requires optional `ICON_CACHE`/`LIQ_CACHE`/`PROFILE_CACHE` overrides to
resolve physically inside `DATA_DIR`, rejecting the complete configuration
before any directory is created. The operations README records the lease's
namespace, mount-view, schema-v2, and v1-interlock preconditions.

CS-06 (final verification wave): the inert `NOTIFICATION_AWS_INGEST_TOKEN`
placeholder was removed from the environment template; the route it fed is not
part of the accepted product surface.

The donor-owned trees remain byte-identical. The correction is proved by one
additive I00 regression:

```text
bash ops/tests/i00/test-fix-031-cs-06-l15-bytes.sh
```

No deployment, private exchange call, signed action, or money path was
performed or authorized by this correction. Deployment remains `NOT_CONFIGURED`
pending separate owner approval.

## Donor-owned test evolution

FIX-031 changed the systemd unit that the donor-owned generic proof
`ops/tests/test-systemd-units.sh` asserts, so that test evolved with it: the
old entrypoint pattern became an exact assertion of the pinned
lease-root `ExecStart`, and coverage was added for the runtime directory
(mode 0700, preserved across restart), the forbidden `Environment=` override,
the absence of `PrivatePIDs`, and the lease runtime in `ReadWritePaths`.
The amendment binds this evolution's exact before/after bytes
(`changedTestFiles`); the strengthened test replaces, and never weakens, the
donor's original assertions.
