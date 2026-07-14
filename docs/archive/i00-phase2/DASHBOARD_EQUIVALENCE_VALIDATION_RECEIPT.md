# Dashboard donor equivalence validation receipt

Status: `DASHBOARD_DONOR_INTEGRATED_BY_EXACT_RECEIPTED_EQUIVALENCE`

Date: `2026-07-14`

This receipt closes one accepted donor row only. It does not claim that the Product Control Room is mounted, browser-visible, backed by final runtime endpoints, deployed, or live. The controlling production work remains `DIRECTOR_MOUNT_REQUIRED` under `IP_CONTROL_MOUNT_REQUEST.md`.

## Immutable donor

- Donor: `dashboard-shell-20260712`.
- Accepted tip: `692501587617d4880303fbd747d93e63c376f088`.
- Donor commit tree: `61d0c5a3e9146fc0b78d8c7fce3e7ebdfbc3b46d`.
- Donor receipt: `web/src/features/systemDashboard/RECEIPT.md`; Git blob `4a7b289d91290cacd44a11ce8f987a4dec5a38a8`; 5,919 bytes; SHA-256 `878cc578d88f38ca3bf8edce554b2cb258b4e9309718854f7ba18c33cb50b968`.
- Accepted feature subtree: `web/src/features/systemDashboard/**`; 21 files; Git tree `d3d899db3b0395532a3cf12b2304e91a2ce528ce`.
- Accepted donor delta: 22 additions; sorted newline-terminated path-set SHA-256 `49400222f70044a8fe851b26123a59cba7cc973f8a346de20aceb0e60f70419c`.

The donor worktree's committed object, not its mutable filesystem, is the integration authority. No donor implementation was copied from an uncommitted path.

## Existing integration ancestry

- IP-CONTROL accepted tip: `56c47dad398c485b6653036c8b90c53f11061b1e`.
- IP-CONTROL fan-in: `d50de1dd1b23a40b3895b29fee5486bc069597af`; parents are pre-IP-CONTROL `f5523e63efcb0a5434341cf9328162be1482fc38` and the exact accepted IP-CONTROL tip.
- IP-CONTROL receipt SHA-256: `4864f9a7de2a640b5e643e7817b33a0114cd988b29ac20cb2b6f0f77f6bf43f7`.
- The IP-CONTROL receipt proves all 21 donor feature files by Git blob identity and records the donor subtree `d3d899db3b0395532a3cf12b2304e91a2ce528ce`.
- Phase 2 validation base: `3eeda75b02f514f1aceccf43b42a154f7db92dc7`; tree `4cfae9d47619f038191951db548ad05be74d4266`.
- `git rev-parse 6925015:web/src/features/systemDashboard` and `git rev-parse 3eeda75:web/src/features/systemDashboard` both return `d3d899db3b0395532a3cf12b2304e91a2ce528ce`. Therefore all 21 feature files remain byte-identical without a redundant donor re-merge.

## Explicit 22nd-path disposition

The donor's 22nd addition is root `DASH_INTEGRATION_NOTES.md`. It is historical satellite wiring guidance, not product code. It is intentionally excluded from the root-document set because:

- the accepted IP-CONTROL packet consumed the donor and produced the controlling `IP_CONTROL_MOUNT_REQUEST.md`;
- root-document law permits one root document per purpose and sends superseded blueprints/instructions to `docs/archive/`;
- restoring the stale note would create a second, less complete owner for the same mount operation.

This is an explicit documentation-law disposition, not a claim that all 22 donor paths are byte-identical. The accepted implementation payload is the exact 21-file subtree; the mount request is the authoritative successor for integration work.

## Measured verification

| Gate | Measured result |
| --- | --- |
| Donor/current feature-tree comparison | Exact `d3d899db3b0395532a3cf12b2304e91a2ce528ce` on both sides; 21/21 files equivalent |
| `node --import tsx --test --test-concurrency=1 --test-reporter=spec web/test/productControlRoom/contracts.test.mjs` | Exit 0; `18/18` passed |
| `npm test` | Exit 0; deterministic `377/377` |
| `npm run test:all` | Exit 0; deterministic 377, application runtime 72, intelligence 152, intelligence runtime 394, capital 433, Foundation all green, System Integration `180/180` |
| `git diff --check` | Exit 0 |

## Ruling

Expected dashboard donor = discovered immutable tip = receipt-accepted donor = integrated implementation by exact receipted equivalence. No redundant merge is permitted. Production mounting, endpoint freeze, shared polling/cursor binding, page adapters, runtime readback, and rendered-browser acceptance remain later serial-spine work and are not claimed here.
