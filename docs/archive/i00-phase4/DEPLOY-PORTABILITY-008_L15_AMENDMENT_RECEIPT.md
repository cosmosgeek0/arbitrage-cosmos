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
| donor-owned test transition | bounded replacements only | 8 paths | PASS |
| runtime API proof | local authorized-effect harness | 8 assertions | PASS |
| class isolation | only selected action resolves endpoint argv | lazy builder | PASS |
| verifier class isolation | only selected class derives action argv | focused proof | PASS |
| provider result contract | exact claim key and empty effect output retained | focused proof | PASS |
| provider empty maps | plain-object empty capability maps only | focused proof | PASS |
| install wrapper projection | exact claim key and empty effect output retained | `ops/i00/bin/install-ops-bundle.sh` | FIXED |
| verifier declaration order | lexical binding initialized before read | focused proof | PASS |
| null-capability Linux contract | unused effect FDs bind fixed null; provider closes through fd53 | bound and closed | PASS |
| historical R3 regressions | sealed-base bytes and modes retained at original paths | 2 paths | PASS |
| R3 successor routing | non-glob current-runtime suites invoked by DF-32 driver | 2 suites | PASS |
| focused byte proof | final descriptor, policy, and successor regressions | 388 assertions | PASS |
| backup publication output | one bounded canonical claim plus EOF | descriptor-bound | PASS |
| sanitizer proof | hostile environment matrix | 143 assertions | PASS |
| direct deploy proof | contained donor suite | 158 assertions | PASS |
| direct rollback proof | contained donor suite | 27 assertions | PASS |
| direct backup/restore proof | contained donor suite | 53 assertions | PASS |
| direct watchdog proof | contained donor suite | 35 assertions | PASS |
| watchdog portability proof | focused I00 suite | 177 assertions | PASS |
| watchdog whole-pass ceiling | Linux scheduler allowance; one-second hook timeout unchanged | 6000 ms | PASS |
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
| donor test path | modified only | `ops/tests/test-restore-drill.sh` | FIXED |
| donor test path | modified only | `ops/tests/test-rollback.sh` | FIXED |
| donor test path | modified only | `ops/tests/test-secret-scanner.sh` | FIXED |
| donor test path | modified only | `ops/tests/test-systemd-units.sh` | FIXED |
| donor test path | modified only | `ops/tests/test-watchdog.sh` | FIXED |
| additive regression | exact final byte proof | `ops/tests/i00/test-deploy-portability-008-l15-bytes.sh` | PASS |
| amendment contract | byte, tree, and runtime binding | `ops/i00/l15-amendment-contract.json` | BOUND |
| final Linux proof | separate final receipt | `docs/archive/i00-phase4/DEPLOY-PORTABILITY-008_CORRECTION_RECEIPT.md` | DEFERRED |

## Re-correction 2026-07-25 — usr-merge canonicality of the built-in Bash default

Authorized by the acting director (MSG-20) as a §2.4 mechanism correction. Recorded as a
RE-CORRECTION of this same finding via the per-amendment seen-paths law rather than a new
finding, because `FINDING_ORDER` is a closed eight-entry list and `ops/live/bin/common.sh`
is already a corrected path of DEPLOY-PORTABILITY-008. No new finding id was minted.

| item | expected | found | status |
|---|---|---|---|
| defect | built-in default survives its own canonicality assert | `I00_BASH=/bin/bash` then `[ "$canonical" = "$I00_BASH" ]` | RED |
| platform | deployment target shape | Ubuntu 24.04 is usr-merged; `/bin` is a symlink; `readlink -f /bin/bash` = `/usr/bin/bash` | MEASURED ON TARGET |
| blast radius | which entry points abort | `ops/live/bin/deploy.sh`, `ops/live/bin/rollback.sh`, `ops/live/bin/restore-drill.sh` — all three call `configure_i00_bash` | RUNTIME FAILURE |
| production exposure | does an env file supply the value | `ops/templates/i00/**` never sets `I00_BASH`, so production takes the built-in default | EXPOSED |
| masking | why it had not been seen | the guard-Node bootstrap aborted earlier in the same sourcing path | EXPLAINED |
| correction | canonicalize the DEFAULT at assignment only | `realpathSync('/bin/bash')` before the assert | FIXED |
| assert preserved | supplied values must still already be canonical | assert byte-identical; env-file branch untouched | UNCHANGED |
| class sweep | every other hardcoded `/bin/*` or `/sbin/*` default in `ops/live/**` | one hit only (this one) | COMPLETE |
| class sweep | `I00_ENV=/usr/bin/env` | `/usr/bin` is a real directory on both shapes; `readlink -f /usr/bin/env` = itself on the target | CLEAN |
| class sweep | remaining realpath-equality asserts in `ops/live/bin/common.sh` | all operate on caller-supplied or discovered paths, none on a hardcoded default | CLEAN |
| additive regression | default canonicalizes; assert still rejects non-canonical supplied values | `ops/tests/i00/test-deploy-portability-008-bash-canonicality.sh` | PASS (7 assertions) |
| donor test path | modified only | `ops/tests/helpers.sh` re-corrected for the fixed-interpreter preference | FIXED |
| amendment contract | effective tree, root digest, and file binding re-chained | `ops/i00/l15-amendment-contract.json` | BOUND |
| contract pin | repinned in every consumer | five consumers under `ops/i00/bin/` | REPINNED |
