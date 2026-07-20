# FIRST-HOST-001 correction receipt — under-lock first-host refusal guard

Status: `PROVENANCE_STAGED_T3_PENDING`

Candidate: `9ce472ab1066dae9d3f0ab0e9930a40a1a703768`

This amendment binds the smallest donor-owned correction required by the
ratified first-host deployment design. The I00 wrapper may set
`I00_REQUIRE_FIRST_HOST_NO_CURRENT=1`; after acquiring the donor deployment
lock and installing its cleanup trap, `ops/live/bin/deploy.sh` rechecks both
`CURRENT_LINK` and `PREVIOUS_LINK`. Either `-e` or `-L` being true refuses the
deploy before donor mutation, so regular files, directories, valid symlinks,
and dangling symlinks all count as occupied. A set marker value other than
exactly `1` also refuses. An absent marker preserves the donor's established
deployment behavior.

The donor-owned regression `ops/tests/test-deploy.sh` evolves with the donor
file. It proves the occupied-path matrix for current and previous, the exact
marker-value rejection matrix, a deterministic lock-wait race, cleanup of the
deployment lock on refusal, absence of release/probe/systemctl mutation, and
the established first-host post-switch freeze behavior. The additive I00
regression `ops/tests/i00/test-first-host-001-l15-bytes.sh` pins the guard's
ordering and closed shell predicates, and pins those donor-test coverage
markers without referring to its own bytes.

## Before/after containment

- Base effective live tree:
  `fd2e76085fdf98c892e3e9cca2f0f085adfd2b9f`
- Base effective root digest:
  `f4dafa650326c67e254c2c798721324709bee182a7b9f4d4a249f54324bdd3d5`
- Changed live path only: `ops/live/bin/deploy.sh`
- Changed donor-test path only: `ops/tests/test-deploy.sh`
- Effective live inventory remains exactly 31 regular files.
- No rollback donor, common helper, systemd unit, environment template,
  private-call surface, order path, transfer path, withdrawal path, or money
  readiness rule changes under this amendment.

## Recorded proof

The pre-change focused first-host attempt against unmodified
`01cf1792d1f340199f4e2ca783dabaabe727e4e8` was a real red. The fixture's host
source was `TARGET_HOST_OWNER_READBACK`, its supervisor source was
`FIRST_HOST_BOOTSTRAP_READBACK`, and `lstat(current)` returned `ENOENT`:

```text
node ops/i00/bin/preflight.mjs --release <sealed-fixture> --host <owner-host.json> --supervisor <bootstrap-supervisor.json> --mode deploy --now 2026-07-20T00:00:01Z --max-host-age-sec 300 --max-supervisor-age-sec 300 --required-supervisor-window-sec 120
exit: 1
I00_OPS_BLOCKED: supervisor source is not canonical readback
```

The committed donor correction's focused suite was then run directly:

```text
bash ops/tests/test-deploy.sh
exit: 0
OK (158 assertions)
```

The donor guard is therefore locally regression-tested. The complete wrapper
feature, its full §5.4 matrix, both aggregate operations suites, and integrated
donor verification are deliberately recorded as pending T3 proof here. They
must be run only after the wrapper feature and this provenance amendment are
committed; this preliminary receipt makes no false integrated-acceptance or
deployment claim.

## Independent verifier sign-off

`/root/independent_audit`, independently of the donor-guard implementation,
confirmed the committed amendment anchors, the guard's one-live-path and
one-donor-test-path containment, the chained base tree/root digest, and the
required receipt, byte regression, pin, and finding-ID bindings. The L15
implementer separately inspected the committed guard ordering and its exact
marker/link predicates. Sign-off: `PASS`, 2026-07-20.

No deployment, signed/private exchange call, order, borrow/repay, transfer,
withdrawal, leverage/margin mutation, or other money action was performed or
authorized by this correction.
