# RECEIPT — L15 deploy-infra satellite (immutable)

| field | value |
|---|---|
| order | D-LAUNCH-5 (director commit `ad6a1b3`, QL_PARALLEL_DAG.md) |
| scope | deployment-infrastructure ARTIFACT portion of `LIVE_EXECUTION_REALISM_CONTROL_PROOF_12H.md` §24, with launch-file §7 amendment L-B |
| branch | `l15-deploy-infra-20260712` |
| base verified | `0f2bb88` |
| work commit | `9a82d47` — 48 files, 3359 insertions (this receipt lands in the follow-up commit) |
| status | **ACCEPTED** (satellite-local acceptance; director integration pending) |
| date | 2026-07-12 |

## Delivered artifacts (all under `ops/live/**`)

- **systemd unit files**: `cosmos-app.service` (loopback-only, hardened,
  bounded journal), `cloudflared.service`, `cosmos-watchdog.service/.timer`
  (1min), `cosmos-backup.service/.timer` (hourly),
  `cosmos-restore-drill.service/.timer` (weekly), journald drop-in template.
- **deploy/rollback scripts**: immutable release dirs, pre-switch readiness
  probe, atomic `current` switch via rename(2), journal/schema
  `rollbackFloor` (explicit non-rollback barrier), §24.2 failure policy:
  auto-rollback ONLY pre-money-readiness with exposure literally `NONE`,
  otherwise FREEZE with marker + alert; auto-rollback failure escalates to
  FREEZE.
- **backup/restore + isolated restore drill**: SQLite online backup
  (`.backup`, hot-WAL proven), sha256+integrity-verified manifests,
  evidence/model path policy, retention, `--verify-latest` staleness probe;
  restore triple-guarded against the live DATA_DIR (flag + typed confirm +
  unit-inactive) with stale WAL/SHM sidecar removal; drill restores only
  into throwaway dirs and writes pass/fail reports.
- **external watchdog configuration**: timer-driven, installed OUTSIDE the
  release path; bounded restart budget on live-failure; ALERT-ONLY on
  ready-failure (incl. TRADE_UNSAFE) — performs no trading action ever;
  tunnel-down, deploy-frozen, backup-stale/missing alarms; stands down
  while a deploy holds the lock.
- **Cloudflare operator-boundary TEMPLATES**: `cloudflared` config
  (loopback origin, catch-all 404) + Access application/policy template +
  activation checklist; origin JWT re-validation wired to existing
  `CF_ACCESS_*` envs.
- **AWS templates**: exact-ARN Secrets Manager IAM policy template +
  instance-profile/no-static-credentials/no-inbound/SSM invariants (§24.4:
  no secret value ever transits the repo).
- **region/latency benchmark harness (L-B)**: runnable later, not now —
  plan-mode default; network runs require `--confirm-network` AND
  `OPS_ALLOW_NETWORK=1`; placeholder targets; reports all seven L-B chain
  stages with measured-vs-app-internal attribution; no region assumed.
- **docs**: `ops/live/README.md` (contract, layout, policy tables),
  `OPS_INTEGRATION_NOTES.md` (worktree root; spine wiring list).

## Proof (local, network-free beyond loopback)

```
bash ops/tests/run-all.sh
ops/tests summary: 11 passed, 0 failed   (347 assertions)
```

Coverage highlights: atomic switch observed via served release id; probe
rejection leaves current untouched; auto-rollback vs FREEZE matrix
(exposure ACTIVE/NONE/money-marker, auto-rollback-itself-fails); schema
barrier absolute on rollback; dirty-host refusals (real dir at `current`,
pre-existing release dir, stale lock reclaim, deleted previous release);
hot-WAL backup row fidelity; corrupted-backup refusal; restore-onto-empty-
box; production-restore refusal ladder; watchdog restart budget /
alert-only readiness / tunnel / frozen / backup-stale; env+systemd+
cloudflare template lint; secret/hostname/IP scanner (loopback-only,
placeholders-only) with seeded canary.

## Boundary attestations

- Zero execution against AWS, Cloudflare, Secrets Manager, systemd, or any
  remote system; tests use mocks and 127.0.0.1 only.
- Zero real credentials, hostnames, or secrets; enforced by
  `ops/tests/test-secret-scanner.sh`.
- Writes confined to `ops/live/**`, `ops/tests/**`, `OPS_INTEGRATION_NOTES.md`.
  `STATE.md` deliberately untouched (satellite boundary) — director folds
  status at integration (noted in OPS_INTEGRATION_NOTES.md §9).
- No push performed; branch left at the receipt commit for the director.

## Resume point

Artifacts complete and locally accepted. Next actor: director/L-spine per
`OPS_INTEGRATION_NOTES.md` (health-endpoint split override, EXPOSURE_CMD
wiring, release packaging step, owner-authorized activation checklist).
