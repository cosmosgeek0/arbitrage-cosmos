# DEPLOY-PORTABILITY-008 L15 amendment receipt

| item | expected | found | status |
|---|---|---|---|
| contract phase | shared byte freeze | final | PASS |
| amendment | one closed successor | `DEPLOY-PORTABILITY-008` | BOUND |
| base live tree | prior effective tree | retained contract binding | PASS |
| effective live tree | regenerated from final donor bytes | contract binding | PASS |
| base root digest | prior effective root | retained contract binding | PASS |
| effective root digest | canonical final donor tree | contract binding | PASS |
| effective inventory | unchanged regular-file set | 31 files | PASS |
| live transition | modified paths only | 19 paths | PASS |
| donor-owned test transition | bounded replacements only | 6 paths | PASS |
| runtime API proof | local authorized-effect harness | 8 assertions | PASS |
| focused byte proof | final descriptor and policy regression | 80 assertions | PASS |
| backup publication output | one bounded canonical claim plus EOF | descriptor-bound | PASS |
| sanitizer proof | hostile environment matrix | 143 assertions | PASS |
| direct deploy proof | contained donor suite | 158 assertions | PASS |
| direct rollback proof | contained donor suite | 27 assertions | PASS |
| direct backup/restore proof | contained donor suite | 53 assertions | PASS |
| direct watchdog proof | contained donor suite | 35 assertions | PASS |
| watchdog portability proof | focused I00 suite | 177 assertions | PASS |
| live path | modified only | `ops/live/README.md` | FIXED |
| live path | modified only | `ops/live/bin/alert-log.sh` | FIXED |
| live path | modified only | `ops/live/bin/backup.sh` | FIXED |
| live path | modified only | `ops/live/bin/common.sh` | FIXED |
| live path | modified only | `ops/live/bin/deploy.sh` | FIXED |
| live path | modified only | `ops/live/bin/restore-drill.sh` | FIXED |
| live path | modified only | `ops/live/bin/restore.sh` | FIXED |
| live path | modified only | `ops/live/bin/rollback.sh` | FIXED |
| live path | modified only | `ops/live/bin/watchdog.sh` | FIXED |
| live path | modified only | `ops/live/env/cosmos-backup.env.template` | FIXED |
| live path | modified only | `ops/live/env/cosmos-deploy.env.template` | FIXED |
| live path | modified only | `ops/live/env/cosmos-watchdog.env.template` | FIXED |
| live path | modified only | `ops/live/systemd/cosmos-app.service` | FIXED |
| live path | modified only | `ops/live/systemd/cosmos-backup.service` | FIXED |
| live path | modified only | `ops/live/systemd/cosmos-backup.timer` | FIXED |
| live path | modified only | `ops/live/systemd/cosmos-restore-drill.service` | FIXED |
| live path | modified only | `ops/live/systemd/cosmos-restore-drill.timer` | FIXED |
| live path | modified only | `ops/live/systemd/cosmos-watchdog.service` | FIXED |
| live path | modified only | `ops/live/systemd/cosmos-watchdog.timer` | FIXED |
| donor test path | modified only | `ops/tests/helpers.sh` | FIXED |
| donor test path | modified only | `ops/tests/test-backup-restore.sh` | FIXED |
| donor test path | modified only | `ops/tests/test-deploy.sh` | FIXED |
| donor test path | modified only | `ops/tests/test-rollback.sh` | FIXED |
| donor test path | modified only | `ops/tests/test-systemd-units.sh` | FIXED |
| donor test path | modified only | `ops/tests/test-watchdog.sh` | FIXED |
| additive regression | exact final byte proof | `ops/tests/i00/test-deploy-portability-008-l15-bytes.sh` | PASS |
| amendment contract | byte, tree, and runtime binding | `ops/i00/l15-amendment-contract.json` | BOUND |
| final Linux proof | separate final receipt | `docs/archive/i00-phase4/DEPLOY-PORTABILITY-008_CORRECTION_RECEIPT.md` | DEFERRED |
