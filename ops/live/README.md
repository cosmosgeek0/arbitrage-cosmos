# ops/live — deployment infrastructure artifacts (L15 satellite)

Testable artifacts implementing the deployment-infrastructure portion of
`LIVE_EXECUTION_REALISM_CONTROL_PROOF_12H.md` §24 (with launch-file §7
amendment L-B for the latency harness). **Nothing here executes against
AWS, Cloudflare, Secrets Manager, systemd, or any remote system.** Every
external interaction is behind an injectable seam (`SYSTEMCTL`, `CURL`,
`NODE`, `SQLITE`), every hostname/credential is a documented
`REPLACE_ME_*` placeholder, and the whole set is proven by local tests:

```sh
bash ops/tests/run-all.sh      # loopback + mocks only; passes on macOS/Linux
```

The live deployment PROOF itself (real EC2/tunnel/secrets activation) is
owned by the L spine under separate owner authorization.

## Contents

```text
bin/
  common.sh          shared helpers (locking, gates, JSON, atomic symlink swap)
  deploy.sh          immutable release install -> pre-switch readiness probe ->
                     atomic `current` switch -> post-switch gate -> §24.2
                     failure policy (auto-rollback only pre-money + exposure
                     NONE; otherwise FREEZE)
  rollback.sh        schema-barrier-checked rollback; exposure-gated automation
  backup.sh          application-consistent SQLite online DB backup +
                     --verify-latest staleness probe; an authorization-bound
                     create never prunes existing data and rejects unbound
                     evidence/model/configuration archive inputs
  restore.sh         integrity-verified restore into an EXPLICIT target;
                     I00 authorization is isolated-only and cannot target DATA_DIR
  restore-drill.sh   staging-only donor; no production action class exists
  watchdog.sh        staging-only external supervision donor,
                     alert-only on ready-failure, tunnel/backup/frozen alarms
  alert-log.sh       default ALERT_CMD (journald-friendly local logging)
  latency-bench.mjs  L-B region/full-chain latency harness (plan-mode default;
                     network runs require --confirm-network + OPS_ALLOW_NETWORK=1)
systemd/             hardened unit + timer templates, journald bounds
env/                 documented .env templates (placeholders only)
cloudflare/          tunnel + Access operator-boundary templates
aws/                 exact-ARN IAM policy template + identity invariants
bench/               benchmark targets template + harness docs
```

## Target host layout (parameterized; defaults shown)

```text
/opt/cosmos/releases/<releaseId>/   immutable release dirs (chmod a-w)
/opt/cosmos/current -> releases/…   atomic symlink, swapped via rename(2)
/opt/cosmos/previous -> releases/…  rollback candidate
/var/lib/cosmos/data/               DATA_DIR (cosmos.db + journal-compat.json)
/var/lib/cosmos/ops/                deploy log, locks, markers, watchdog state
/var/backups/cosmos/                published backups + drills
/etc/cosmos/*.env                   installed env files (root-owned, 0640)
/usr/local/lib/cosmos-ops/i00/accepted-ops-live/bin/  these scripts, OUTSIDE the release path
```

## Production effect boundary

The canonical production path is `run-bound-effect.mjs` with one consumed,
authorization-bound evidence chain. It opens every donor byte, environment,
interpreter, helper, and effect executable before dropping to the bound effect
identity. The donor receives readonly descriptor capabilities, not a caller-set
class or named command string. `common.sh` verifies the one-use handoff,
acknowledges it once, and derives the exact action class and command from the
verified result before it loads the descriptor-bound sanitized environment.

| donor effect | verified action class | exact boundary |
|---|---|---|
| release switch | `SERVICE_RELEASE_SWITCH` | one switch; a compensating `--auto` rollback requires a distinct one-use subhandoff and the runner-retained deploy-lock capability |
| manual rollback | `SERVICE_ROLLBACK` | one schema-compatible switch; the bound donor owns lock acquisition/reuse and the switch |
| backup publication | `BACKUP_CREATE` | one new completed DB backup; no retention, stale-partial deletion, or evidence/model/configuration archival |
| isolated restore | `ISOLATED_RESTORE` | one explicit target disjoint from `DATA_DIR`; production restore is unavailable |

Release and rollback exposure reads use only the verified Node and exposure
helper descriptors with no helper arguments and a fixed outer timeout. Local
alert logging uses only the verified Bash and local alert-helper descriptors
with the fixed severity/code/message shape and timeout. Authorized donor
environments reject `EXPOSURE_CMD` and `ALERT_CMD`; named command seams remain
available only to contained TEST or direct non-effect fixtures.

The canonical backup environment leaves `EVIDENCE_PATHS` empty. Authorized
`BACKUP_CREATE` rejects any nonempty value before the donor effect because no
evidence, model, or configuration read capability is retained. In particular,
`/etc/cosmos` is never archived. DB backup remains available; evidence/model
archival is `BLOCKED_PENDING_EXPLICIT_READ_CAPABILITY`. Direct contained
staging tests retain the legacy archive branch only as non-production proof.
After durable publication, logging, and the final capability rechecks, the
authorized donor writes one bounded canonical publication claim to its retained
effect-output descriptor and closes that descriptor. The runner independently
requires exactly one new direct child under the retained backup root, opens it
without following links, and binds its identity, manifest, database, tree, and
pre/post inventory evidence before a successful terminal outcome exists.

On a rollback post-switch gate failure, the bound donor writes the frozen
marker through its retained `opsStateDir` capability, opens that exact file
without following a link, changes it to mode `0400`, fsyncs the file and
directory capability, and only then exits `3`. The wrapper records the already
sealed marker; it does not mutate the named marker or own the donor lock.

No ratified action class exists for direct production `restore-drill.sh` or
`watchdog.sh`. The backup, restore-drill, and watchdog services and timers keep
their historical unit bytes for verification but carry an always-false unit
condition plus `RefuseManualStart=yes`; they cannot be scheduled, dependency
started, or manually started.

## DATA_DIR authority deployment precondition

Every process or container that can mutate one physical `DATA_DIR` must run on
the same host and share the same logical-lease runtime root, compatible mount
view, and PID/liveness namespace. The lease record binds the Linux PID
namespace identity before a PID probe; a mismatched namespace is unavailable
and cannot be reclaimed as a dead owner. Separate PID namespaces remain an
unsupported deployment topology, and no cross-namespace exclusion guarantee is
claimed. The service therefore does not request a private PID namespace and pins
`DATA_DIR_LOGICAL_LEASE_ROOT=/run/cosmos-app/data-dir-leases` in `ExecStart`
after `EnvironmentFile=` processing rather than using an overrideable
`Environment=` directive. Every component of the normalized absolute requested
`DATA_DIR` must be ASCII, and its logical lease identity uses ASCII lowercase;
case aliases therefore share one lease while Unicode filesystem-folding aliases
are rejected before the runtime lease root or data directory is created.
The active physical and logical lease records use schema v2 names and records.
During upgrade, an exact live v1 root/witness owner is rejected and an exact
dead v1 chain is reclaimed; each v2 owner also holds a same-inode v1-name
version interlock so a legacy binary fails closed instead of running beside it.

`ICON_CACHE`, `LIQ_CACHE`, and `PROFILE_CACHE` are optional. When configured,
their resolved physical parent and target must remain inside the exact physical
`DATA_DIR`; external targets and parent-symlink escapes fail closed. Cache names
use a conservative ASCII-only policy for every `DATA_DIR`-relative component,
then compare with ASCII lowercase for both each component and the complete
target. A read-only phase-zero validates the complete requested and prospective
set before the logical lease root or absent `DATA_DIR` is created. Phase one
recomputes physical/symlink targets before any cache parent is created. Both
phases enforce containment, file type, and pairwise path collisions; existing
regular-file leaves are also compared by device/inode against each other and
reserved Ledger, journal, news, and lease owner files. Any non-ASCII relative
component is rejected before parent creation. An ASCII requested path may still
bind an existing Unicode physical root; only its `DATA_DIR`-relative cache names
are constrained. No parent or leaf component can alias a reserved owner on a
case-insensitive filesystem or through a hard link.

## Release contract

A release source directory must contain `server/dist/index.js` and a
`release.json`:

```json
{ "releaseId": "r20260712-abc1234", "gitSha": "abc1234",
  "builtAtUtc": "2026-07-12T00:00:00Z",
  "schemaVersion": 1, "rollbackBarrier": false }
```

`deploy.sh` maintains `$DATA_DIR/journal-compat.json`
(`dataSchema` = highest schema that has run; `rollbackFloor` = highest
schema deployed with `rollbackBarrier:true`). Rollback to any release whose
`schemaVersion` is below the floor is refused absolutely — that is the
explicit non-rollback barrier of §24.2. Ownership of this marker should
move into the app/ledger at integration (see `docs/archive/i00-phase2/L15_OPS_INTEGRATION_NOTES.md`).

## Deploy failure policy (§24.2, exact)

| condition after a failed post-switch gate | action | exit |
|---|---|---|
| money-readiness never reached AND exposure == `NONE` AND a previous release exists | automatic rollback | 3 |
| anything else (`ACTIVE`/`AMBIGUOUS`/`RECOVERY_REQUIRED`/`UNKNOWN`, money reached, no previous, or the auto-rollback itself fails) | FREEZE: marker + alert, state preserved for incident handling | 2 |

Exposure comes from `EXPOSURE_CMD` (unset/failed ⇒ `UNKNOWN` ⇒ freeze-safe).
The deploy gate uses `/health/live` + `/health/ready` only — **never**
`/health/trade-ready`; the cockpit must stay reachable while trade
readiness is red (§24.3).

## Watchdog policy (§23/§24)

Live-gate failure: restart after `LIVE_FAIL_THRESHOLD` consecutive misses,
at most `MAX_RESTARTS_PER_WINDOW` per window, then page. Ready-gate failure
(incl. `TRADE_UNSAFE`): **alert only** — restarting cannot fix degraded
inputs and may destroy recovery state. The watchdog performs **no trading
action of any kind** and never auto-liquidates on infrastructure alarms.
It also alarms on tunnel-down, deploy-frozen, and backup-stale/missing.

## What activation (owner-authorized, spine-owned) still requires

Filling `REPLACE_ME_*` values, creating users/dirs, installing inert unit
templates, creating the tunnel/Access app, attaching the IAM policy, and the
live §24 proof run. Timer activation remains unavailable until a separately
ratified action class and I00 wrapper exist. None of that is performed — or
performable — from this artifact set.
