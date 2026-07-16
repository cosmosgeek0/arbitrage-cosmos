# I00 Phase 2 canonical Main baseline synchronization receipt

## Identity

- Status: `BASELINE_SYNCED_GREEN`
- Canonical source: `current-main`
- Canonical source SHA: `7383fd89477ed0b3e677e53c57c35d76ac34bbd8`
- Canonical source tree: `b19a9b535ce8a69174cd100eea42426e73fea8c6`
- Integration branch: `i00-product-assembly-20260713`
- First parent: `aedeb948d914057669773e1223dfed941af25996`
- Synchronization commit: `ce8d79a751c886dff388fa8f3f2fa6fb3f0414ee`
- Synchronization tree: `512f0022e782fccfd2e5c554570b2f0be948d2de`
- Second parent: exact canonical source SHA `7383fd89477ed0b3e677e53c57c35d76ac34bbd8`
- Changed paths against first parent: 4
- Sorted newline-terminated changed-path SHA-256: `2fec532e6d140a65f6c5195a4c3937e489b008fed52ce506953ff15157b8d833`

## Scope

```text
QL_DIRECTOR_STATE.md
QL_PARALLEL_DAG.md
STATE.md
WORKER_PROMPTS.md
```

The canonical synchronization brings no executable source, test, package, lockfile, route, schema, database, or UI change beyond the already separately integrated and receipted F-BRIDGE and SI-RECON ancestry. `STATE.md` records this exact posture in the same merge. The canonical Main tip is an ancestor of the integration commit.

## Measured verification

| Command | Result |
| --- | --- |
| `npm test` | Exit 0; typecheck/build pass; deterministic `377/377` |
| `npm run test:all` | Exit 0; deterministic `377`, app `72`, intelligence `152`, intelligence runtime `394`, capital `433`, all 24 Foundation files, System Integration `180/180` |

The existing Vite large-chunk warning remains non-fatal. No test or assertion was changed by this synchronization.

## Boundaries

- No write, merge, or push to `current-main` occurred.
- No private read, signed call, order, borrow/repay, transfer, withdrawal, AWS/Cloudflare change, deployment, or other external mutation occurred.
- The five protected untracked owner inputs remain untouched.
- This is a canonical baseline receipt, not a separate accepted donor row and not a candidate claim.
