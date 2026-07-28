# 04 — RECOVERY, ROLLBACK AND BACKUPS

Evidence cut: canonical `…1be1` plus accepted rollback recovery/eyes-on rows,
2026-07-28. Source, staging, and live truth remain separate.

## Current truth

| layer | state |
|---|---|
| `SOURCE` | `BACKUP_CREATE` makes one integrity-checked SQLite snapshot; `ISOLATED_RESTORE` rejects production. Backup units are unbarred hourly/persistent; restore-drill units remain barred. |
| `STAGING` | M-C `…71f6` reports backup `73/73` and restore `11/11`; it is unlanded/undeployed and is not `…1be1` or live proof. |
| `LIVE` | One online backup and isolated restore were accepted 2026-07-27; checks passed without production DB/service/release change. |
| `UNKNOWN` | Current timers, freshness, retention, generation, recoverability, and automatic rollback remain `UNKNOWN`; accepted backup/watchdog were `NOT_ARMED`, restore drill barred. |
| `ROLLBACK` | `…21a0` is active/stable (live=`200×3`, ready=`503`). Signed-in Dashboard/Account/Markets rendered at 1920×1080 with no 502; Dashboard also at 398×486. All remain `BLOCKED_BACKEND`, private/account=`NOT_CONFIGURED/UNKNOWN`. Public recovery only. Failed `…1be1` is preserved; `ROOT_ONLY_RELEASE_PACKAGING_PREVENTS_COSMOS_RUNTIME_ACCESS` blocks service access; `Q(CUTOVER-RELEASE-MODE-PACKAGING)` pending; no successor retry authorized. The packet keeps current/previous on `…21a0` before any switch. |

## Boundaries

- Source timer bytes are not activation or run proof; because `Persistent=true`
  may catch up a missed run when activated, arming is an effectful owner step.
- One accepted isolated restore is not a scheduled drill or permission to replace
  the production database.
- The accepted backup receipt is narrow; it does not prove off-host storage,
  provider snapshots, ongoing retention, or scheduled config/evidence backup.

## Next recovery readback

Measure timer state, backup age/receipt, previous-release linkage, and one
still-isolated restore receipt. Keep every unmeasured field `UNKNOWN`.
