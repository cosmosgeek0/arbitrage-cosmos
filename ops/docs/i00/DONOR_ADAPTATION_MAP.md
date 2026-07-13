# Donor adaptation map

Accepted donor: `l15-deploy-infra-20260712` at full commit
`2cec412927fa2f64f05a0b2774b18e45f8ce4fa5`. Implementation parent:
`9a82d4715c73ebe4156638c2bf5e8a2c02373bbf`. The donor is read from Git and
is never rewritten in this packet.

| Final requirement | Accepted owner | I00 adaptation | Posture |
|---|---|---|---|
| Immutable install, atomic current/previous switch | `ops/live/bin/deploy.sh` | `release-switch.sh` validates SHA-keyed package, disk, schema, exposure, ambiguity, and recovery, then delegates | owner-gated |
| Rollback and migration floor | `ops/live/bin/rollback.sh` | `rollback-switch.sh` adds final canonical preflight, then delegates | owner-gated |
| Application-consistent SQLite/WAL backup | `ops/live/bin/backup.sh` | `backup-verify.sh` adds safe-version, full integrity, and FK gates | built/tested |
| Guarded restore and isolated drill | donor restore scripts | `restore-drill-verify.sh` adds safe-version/full-integrity/FK proof without production mutation | built/tested; production restore remains donor-owner gated |
| External watchdog and bounded restarts | donor watchdog/timer | no duplicate; CloudWatch templates supplement external visibility | built/tested |
| App and cloudflared service owners | donor systemd units | additive app credential drop-in only | owner-gated |
| Optional Q service | no accepted command yet | honest placeholder template; cannot install unchanged | `NOT_CONFIGURED` |
| Release build/package | donor recorded as missing | `assemble-release.mjs` requires tested clean SHA, web/server output, prebuilt runtime dependencies, and hashes every file | built/tested |
| I00 helper installation | donor installs only accepted `bin/*` | release embeds hashed `ops/i00`; `install-ops-bundle.sh` installs it without units or restarts | simulation proved; host install owner-gated |
| Dependency/readiness/trade/recovery probes | canonical supervisor owns truth | `probe.mjs` consumes snapshots without recomputation | built/tested; runtime endpoint input pending |
| Secrets Manager provider | donor recorded as missing | exact-ARN instance-role provider seam plus systemd credential delivery | owner-gated |
| CloudWatch metrics/alarms | donor recorded as missing | unified agent, least-privilege policy, finite retention, fail-closed alarm templates | owner-gated |
| Cloudflare boundary proof | donor config/Access templates | current Access overlay and readback validator | owner-gated |
| Operation receipts | donor deploy/backup JSONL | strict release/deploy/rollback/backup/restore/incident schemas | built/tested |

## Inputs still owned elsewhere

- Health route split and canonical supervisor snapshot: I00 runtime owner.
- Exposure/ambiguity/recovery readback command: canonical supervisor owner.
- Journal/schema revision: existing ledger owner.
- Q executable/protocol/port: accepted Q runtime owner.
- Canonical `TradeReady` metric: runtime supervisor; ops does not synthesize it.
- Secret ARN, KMS key choice, target host, Access team/AUD/hostname, alert
  destinations, and action ARNs: owner inputs under durable authorization.

Missing inputs fail closed. They do not become zeros, healthy states, or proof.
