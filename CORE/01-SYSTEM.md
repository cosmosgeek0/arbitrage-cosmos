# 01 — SYSTEM TRUTH AND WHERE THINGS LIVE

Evidence cut: canonical `…1be1`, accepted `ORCHESTRATOR ROLLBACK EYES-ON`,
and `Desktop/CHANNEL.md` top, 2026-07-28. Later accepted rows supersede it.

## Truth by layer

| layer | measured truth |
|---|---|
| `SOURCE` | Canonical `…1be1` is clean/equal. Credential/GET-only private-read corrections are source-only; money mutations fail closed. |
| `STAGING` | Failed `…1be1` diagnostics/config remain preserved; packaging packet=`READY/EFFECT_NONE`. Blocker=`ROOT_ONLY_RELEASE_PACKAGING_PREVENTS_COSMOS_RUNTIME_ACCESS`; `Q(CUTOVER-RELEASE-MODE-PACKAGING)` pending; no retry. |
| `LIVE` | Rollback `…21a0` is active/stable: live=`200×3`, ready=`503`. Signed-in Dashboard/Account/Markets rendered at 1920×1080 with no 502; Dashboard also rendered at 398×486. Markets had 469 public rows; all were `BLOCKED_BACKEND`, private/account=`NOT_CONFIGURED/UNKNOWN`. This is `PUBLIC_AVAILABILITY_RESTORED_ONLY`. |
| `UNKNOWN` | Successor permission, account, freshness, mutation, LOW-CPU, timer, and `PRIVATE_READ_READY` remain unproved. Money=`$0`. |

Never call source or staging “live.” Re-read `Desktop/run.md` §0 and newest §5,
plus the top of `Desktop/CHANNEL.md`; newer accepted rows override stale §1.

## Checkout roles

| path | role |
|---|---|
| `Desktop/Main` | Git object store and detached viewing checkout. Do not delete it. |
| `Desktop/cosmos-merge` | canonical linked checkout on `current-main`; measure it, but do milestone work in an isolated worktree. |
| isolated worktree | the only place to edit and freeze a candidate; it remains staging until accepted and landed. |

## Source shape at `…1be1`

- `npm start` runs the built `server/dist/index.js`; a source tree is not a release.
- The production unit is loopback-oriented and environment-bound. Exact live bind,
  data path, installed units, public-feed health, and tunnel state require live readback.
- Public feeds are egress-gated. A dedicated GET-only private reader exists; legacy
  account/order mutation services receive no credential from that composition.
- The governed I00 drop-in uses systemd credentials and `app-entrypoint.mjs`; source
  presence does not prove the drop-in, provider, or credential is active on the host.
- `ops/i00/**` owns release, rollback, backup, and restore authorization/provenance.
  Focused source tests prove contracts only; host and browser acceptance stay separate.
