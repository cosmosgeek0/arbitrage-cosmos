# IP-CONTROL State

Status: `BINDING_READY`

## Immutable identity

- Branch: `ip-control-20260713`
- Director-created base: `420cc83e5512d54ca1b1c064c1041d89b23914a0`
- Implementation commit: `2c98ae653ba97e6383c29697283288346de28bdb`
- Accepted shell donor: `dashboard-shell-20260712` at `692501587617d4880303fbd747d93e63c376f088`
- Donor tree: `d3d899db3b0395532a3cf12b2304e91a2ce528ce`
- Donor receipt blob: `4a7b289d91290cacd44a11ce8f987a4dec5a38a8`
- Frozen `docs/DASHBOARD_TRUTH.md` blob: `15a8a843859f3c422e96a107aabf99c0aca80800`
- Frozen `DESIGN.md` blob: `4f980d133be03237693d9e10ea596387c853e58b`
- Donor verification: `21/21` files byte-identical; `0` mismatches
- Push state: not pushed, by directive

## Current package truth

- One accepted dashboard shell is imported unchanged. The final wrapper hides
  the donor's fixture-only control panel, incomplete machine graph, and legacy
  trace drill-down, then supplies one canonical registry, one complete
  component/dependency authority view, and one twelve-stage trace.
- `product-supervisor.v1`, `product-command.v1`, and `material-cursor.v1` are
  fail-closed runtime boundaries. Nested dashboard, owner, component, edge,
  incident, trace, control, result, cursor, and surface evidence are decoded
  before React receives them.
- One `ProductControlRoomProvider` owns the shared five-second binding. It
  requires the runtime's durable material-event resume cursor; cursor gaps,
  truncation, unproven continuity, and backfill requirements block controls.
- On a continuity failure, the full route and compact adapters retain only
  explicitly labeled `STALE LAST-KNOWN TRUTH`; no control remains mounted.
- The registry carries target, payload schema/enumeration, defaults, bounds,
  posture, expiry, reversibility, invariants, effect telemetry, preview digest,
  idempotency, revision fence, result, and durable receipt truth.
- Only `WIRED_LIVE` controls in the non-money allowlist can become functional:
  safe mode, kill switch, proposal intake, and bounded component restart.
  Recovery, canary, order, borrow, repay, transfer, and withdrawal authority is
  absent. `LIVE_EXECUTION_NOT_IMPLEMENTED` remains permanently visible.
- All 18 operational surfaces have exact mount rows and typed required-evidence
  contracts. Missing fixture/runtime evidence remains `MISSING` with a named
  reason; it is never fabricated.
- The five required fixtures advance monotonically. Preview/confirm/submit is
  sealed, idempotent, revision-fenced, and synthetic. Async restart/recovery
  transitions complete after five injected seconds; one-leg recovery clears
  exposure, incident, position, and recovery truth consistently.

## Director mount state

`IP_CONTROL_MOUNT_REQUEST.md` is exact and mechanical:

- full shell owner: the dedicated `ProductControlRoomRoute` only;
- Dashboard owner: compact `ProductSurfaceAdapter surfaceId="dashboard"`;
- one provider/client/durable cursor binding shared by all adapters;
- App, Header, store, existing pages, shared styles, server, packages, Q/L,
  and current-main remain untouched by this packet.

Runtime mounting remains `DIRECTOR_MOUNT_REQUIRED`. The director must provide
the frozen IP-RUNTIME endpoints and durable resume cursor. Current legacy
system-integration endpoints do not prove the final registry, owner view,
incident, surface-evidence, or gap/backfill contracts, so no entry claims
`WIRED_LIVE` from them.

Account routing also requires the exact director adaptations recorded in the
mount request: existing Orders/Fills routes must select their Account views;
Execution/Positions/PnL views do not currently exist and must be added as
read-only Account subviews before their adapters mount.

## Verification state

- Focused product contract suite: `18/18` passed with
  `node --import tsx --test web/test/productControlRoom/contracts.test.mjs`.
- Web typecheck: passed.
- Web production build: passed; only the pre-existing `>500 kB` chunk warning.
- `npm test`: exit `0`.
- `npm run test:all`: exit `0`, including `72/72` application gates and
  `180/180` system-integration tests.
- Independent final reviews: contract/implementation clean, UI clean after
  emergency-state correction, scope/donor/mount/non-money audit clean.
- Rendered browser evidence: light/dark desktop, narrow, owner-width,
  degraded, canary, recovery, reduced-motion, focus, and command lifecycle
  passes are recorded in `IP_CONTROL_RECEIPT.md`.

## Preserved inputs

The director-supplied root files `IP_CONTROL.md` and
`I00_PRODUCT_ASSEMBLY_CONTROL_ROOM_AND_LIVE_BRINGUP.md` remain untracked and
unmodified. They are not part of either packet commit.
