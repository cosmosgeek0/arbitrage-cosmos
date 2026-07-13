# IP-CONTROL Mount Request

Status: `DIRECTOR_MOUNT_REQUIRED`
Packet branch: `ip-control-20260713`
Packet base: `420cc83e5512d54ca1b1c064c1041d89b23914a0`
Accepted shell donor: `dashboard-shell-20260712` at `692501587617d4880303fbd747d93e63c376f088`

This request is intentionally mechanical. IP-CONTROL owns no shared App, store,
router, page, global-style, server, or package file.

## 1. Runtime contract prerequisite

Before mounting, the director must freeze the IP-RUNTIME/client contract and
provide `ProductIntegrationEndpoints` for one versioned supervisor envelope,
one gap-free material-event cursor, bounded traces, command preview, and command
submission. Instantiate the client with:

```ts
createProductIntegrationClient(createHttpProductIntegrationTransport(endpoints))
```

Do not silently point this package at legacy endpoints:

- current `/api/system-integration/supervisor` lacks the final owner view,
  machine-readable control registry, complete component fields, incident groups,
  surface projections, and final revisions;
- current `/api/system-integration/events` does not publish continuity, gap,
  truncation, or required-backfill truth;
- current `/api/system-integration/controls` publishes control state, not the
  I00 registry or preview/digest/result lifecycle.

Until those contracts freeze, the client intentionally has no default URL and
no control may claim `WIRED_LIVE`.

## 2. Exact App / store / router request

| Shared owner | Exact request |
| --- | --- |
| `web/src/App.tsx` | Instantiate the frozen client once and wrap the existing application shell in `ProductControlRoomProvider client={client} initialMaterialCursor={durableResumeCursor}`. The cursor comes from the runtime's durable resume contract; this is the single polling/cursor binding shared by the route and all adapters. |
| `web/src/App.tsx:43` | Replace the Dashboard page's legacy convergence summary through the page row below; do not mount a second shell here. |
| `web/src/App.tsx:43-56` | Inside `ProductControlRoomProvider`, register one director-owned `control-room` route that renders `ProductControlRoomRoute` with no props. No other route owns the full shell. |
| `web/src/components/Header.tsx:385-417` | Add one `Control Room` destination beside the existing operational destinations; use existing navigation grammar and a truthful existing/code-native icon. |
| `web/src/store.tsx` | No product truth fields and no second store. Add only the route ID if the existing page union requires it. `ProductControlRoomProvider` owns the one polling/cursor binding. |
| `web/src/styles.css` | No change requested. `productControlRoom.css` neutralizes donor preview padding and uses inherited house tokens. |

## 3. Exact page insertion rows

All rows consume `snapshot.surfaces[surfaceId]` from the shared
`ProductControlRoomProvider`. They format but do not derive domain truth.

| Surface | Existing owner / current anchor | Mount export | Operation |
| --- | --- | --- | --- |
| Dashboard | `web/src/pages/Dashboard.tsx:473`, `<SystemIntegrationSurface surface="dashboard" />` | `ProductSurfaceAdapter surfaceId="dashboard"` | Replace the legacy summary with the compact adapter; the full shell exists only on Control Room. |
| Control Room | `web/src/App.tsx:43-56` plus `Header.tsx` navigation | `ProductControlRoomRoute` | Register one new route after IP-RUNTIME endpoint freeze. |
| Account | `web/src/pages/Account.tsx`, after canonical account summary | `ProductSurfaceAdapter surfaceId="account"` | Append one canonical band. |
| Markets | `web/src/pages/Markets.tsx`, after summary and before table canvas | `ProductSurfaceAdapter surfaceId="markets"` | Append one canonical band. |
| Token | `web/src/pages/TokenDetail.tsx`, after symbol identity summary | `ProductSurfaceAdapter surfaceId="token"` | Append one chronology/correlation band. |
| Basis | `web/src/pages/Strategies.tsx`, after Basis workspace header | `ProductSurfaceAdapter surfaceId="basis"` | Append one owner projection. |
| Volume | `web/src/pages/VolumeScanner.tsx`, after Volume workspace header | `ProductSurfaceAdapter surfaceId="volume"` | Append one owner projection. |
| Opportunities | `web/src/pages/Opportunities.tsx:238`, legacy convergence surface | `ProductSurfaceAdapter surfaceId="opportunities"` | Replace legacy summary. |
| Borrow | `web/src/pages/Loans.tsx`, after Borrow workspace summary | `ProductSurfaceAdapter surfaceId="borrow"` | Append liability/borrow-truth band; no money action. |
| Execution | `web/src/pages/Account.tsx` has no execution view | `ProductSurfaceAdapter surfaceId="execution"` | Director adds an explicit `execution` Account view and routes it from App; no money action. |
| Orders | `web/src/pages/Account.tsx` has `orders`, but App currently opens default `overview` | `ProductSurfaceAdapter surfaceId="orders"` | Director passes the orders route into Account, then mounts in that existing view. |
| Positions | `web/src/pages/Account.tsx` has no positions view | `ProductSurfaceAdapter surfaceId="positions"` | Director adds an explicit read-only `positions` Account view and routes it from App. |
| Fills | `web/src/pages/Account.tsx` has `fills`, but App currently opens default `overview` | `ProductSurfaceAdapter surfaceId="fills"` | Director passes the fills route into Account, then mounts in that existing view. |
| PnL | `web/src/pages/Account.tsx` has no PnL view | `ProductSurfaceAdapter surfaceId="pnl"` | Director adds an explicit read-only `pnl` Account view and routes it from App. |
| Risk | `web/src/pages/Risk.tsx:456`, legacy convergence surface | `ProductSurfaceAdapter surfaceId="risk"` | Replace legacy summary. |
| Health | `web/src/pages/SystemHealth.tsx:569`, legacy convergence surface | `ProductSurfaceAdapter surfaceId="health"` | Replace legacy summary. |
| Logs / Ledger | `web/src/pages/LedgerPage.tsx:545`, legacy convergence surface | `ProductSurfaceAdapter surfaceId="logs-ledger"` | Replace legacy summary; retain bounded raw drill-down. |
| Notifications | `web/src/pages/NotificationsPage.tsx`, before daily incident tape | `ProductSurfaceAdapter surfaceId="notifications"` | Append grouped-incident projection only. |

The same machine-readable inventory is exported as
`SURFACE_MOUNT_CONTRACTS` from
`web/src/features/productControlRoom/surfaceMounts.ts`.

## 4. Control and truth law at mount

- Mount the additive registry; the wrapper already suppresses the donor's
  fixture-only four-control panel.
- Enable only server-returned `WIRED_LIVE` entries.
- Keep `WIRED_FIXTURE` persistent-synthetic and outside the live route.
- Keep `PENDING_BACKEND:*`, `OWNER_GATED`, and `UNAVAILABLE:*` disabled with
  their returned reason.
- Never translate an unproven event cursor into a successful empty page.
- Never remove the visible `LIVE_EXECUTION_NOT_IMPLEMENTED` barrier.
- Do not mount preview files in production.

## 5. Director verification after mounting

Run `npm run typecheck`, `npm run build`, the focused product-control tests,
`npm test`, and `npm run test:all`. Then repeat the real rendered app sweep in
Light and Dark at desktop, narrow, and the owner's 2940-CSS-pixel window;
verify zero horizontal overflow, zero console errors, reduced motion, every
route row, and exact current/live/synthetic/unavailable labels.
