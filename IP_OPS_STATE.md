# IP-OPS state

## Status

`OPS_READY` means the operations artifacts are built, committed, and proven in
fake services and temporary directories. It does not mean deployed or externally
configured.

- Branch: `ip-ops-20260713`
- Packet base: `420cc83e5512d54ca1b1c064c1041d89b23914a0`
- Work commit: `ea32285237c1cee29e4b9efe0de0dbae6f5ed810`
- Work tree: `dc252802a4feebe8675d81cdb59d786bb9219cb9`
- Status: `OPS_READY`
- Deployed SHA / release ID: `null` / `null`
- AWS, EC2, Cloudflare, DNS, Secrets Manager, systemd, and target services: `NOT_CONFIGURED`
- External mutations performed by IP-OPS: `0`
- Money, order, borrow/repay, transfer, withdrawal, and leverage mutations: `0`

## Donor truth

The packet adapts the accepted `l15-deploy-infra-20260712` donor read-only.

- Accepted commit: `2cec412927fa2f64f05a0b2774b18e45f8ce4fa5`
- Implementation commit: `9a82d4715c73ebe4156638c2bf5e8a2c02373bbf`
- Donor base: `0f2bb884daf5b67981ea04f38298d89c1a980de7`
- `ops/live` tree: `584163858a0333cb1ccb9eff756e91a851b1cb71`
- `ops/tests` tree: `f3348a74ef22d9ca2faee431ea8cc5df63f552af`
- Embedded contract SHA-256: `078cc2a3d8bc79026f1de6985284856794e53ba34ffd7fda5d1140e46e31a1b3`
- Integration posture: `ADAPT_READ_ONLY`; no competing deploy, rollback,
  backup, restore, watchdog, systemd, or tunnel owner was created.

## Proof

- Accepted donor: 11/11 suites, 347 assertions.
- Additive I00: 8/8 suites, 304 assertions.
- Combined ops proof: 651 assertions, zero failures.
- `npm test`: exit 0.
- `npm run test:all`: exit 0; final integration group 180/180.
- Typecheck and production builds are included in `npm run test:all`.
- Protected prompt SHA-256 values are recorded in `IP_OPS_RECEIPT.md` and
  checked by the static suite.

## Capability state

| Capability | State | Current truth |
|---|---|---|
| SHA-keyed release assembly | `OPS_READY` | Production requires an externally trusted Ed25519 builder attestation; simulation is permanently marked unattested. |
| Installed ops bundle | `OPS_READY` | Git-free install embeds the exact read-only donor and performs no service mutation. |
| Deploy and rollback | `OWNER_GATED` | Exact §20 authorization binds release, manifest, trusted key, sanitized donor-env digest, host/account, effect, and receipt targets. |
| Dependency/readiness/trade/recovery probes | `OPS_READY` | Consume fresh canonical supervisor readback; never recompute owner truth. |
| Secret provider and IAM/KMS | `OWNER_GATED` | Exact ARN, instance role, exact permission, 0600 output, and authorization required. |
| Backup | `OWNER_GATED` | SQLite online backup, DB/FK checks, exact invocation result, and evidence/model proof; fake-root test passed. |
| Isolated restore | `OWNER_GATED` | Symlink-aware isolation, DB/FK checks, and evidence/model restoration passed. |
| Production restore | `BLOCKED_DONOR_AMENDMENT` | Accepted donor must add same-filesystem staged, verified, retained-prior-set atomic swap under separate authorization. |
| Cloudflare / monitoring | `OWNER_GATED` | Templates and readback validators only; no vendor or DNS call occurred. |
| Q service | `NOT_CONFIGURED` | Honest placeholder until the Q owner supplies the accepted command/protocol/entrypoint. |
| Target SQLite | `BLOCKED_EXTERNAL` | Local `3.51.0` is rejected for production; target must use a WAL-reset-fixed supported build. |
| Capacity / soak | `BLOCKED_EXTERNAL` | Exact target-size or proxy p50/p95/p99 and degradation receipt is absent. |
| Tiny-live canary | `OUT_OF_SCOPE_OWNER_GATED` | Service activation grants no trading authority; IP-OPS contains no money path. |

## Next exact action

The director may review and integrate the work and closure commits. External
activation must remain stopped until every input and separate authorization in
`IP_OPS_ACTIVATION_REQUEST.md` is resolved and the target readbacks validate.
