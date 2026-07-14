# EXTERNAL_ACTION_AUTHORIZATION — AWS/Cloudflare deployment activation

Status: `DRAFT_OWNER_SIGNOFF_REQUIRED` · Effective: `false` · Result/reconciliation: `NOT_RUN`

| Field | Class-pinned draft value |
| --- | --- |
| Action class | `AWS/Cloudflare deployment activation` |
| Scope | One exact AWS account/region/host plus one exact Cloudflare account/tunnel/hostname/Access application |
| Account / host / environment | `OWNER_MUST_BIND_EXACT_TARGETS` |
| Candidate/deployed identity | `OWNER_MUST_BIND_VERIFIED_SHA_TREE_RELEASE_AND_CONFIG_DIGESTS` |
| Commands/endpoints/products | `OWNER_MUST_BIND_EXACT_VENDOR_AND_LOCAL_COMMANDS` |
| Maximum capital/notional/effect | `0` / `0` / activate only the enumerated infrastructure boundary |
| Credentials/permissions | Exact instance-role and Cloudflare permission names only; no token/key value |
| Start/expiry | `OWNER_MUST_BIND_SHORT_UTC_WINDOW` |
| Preconditions | Capacity receipt; immutable release; loopback origin; no public ingress; Access/origin auth plan; backup; rollback; target readback; no exposure/ambiguity/recovery |
| Rollback/recovery | Disable only the enumerated activation, preserve prior route/release, keep application non-public, reconcile vendor and origin readbacks |
| Result/reconciliation receipts | `OWNER_MUST_BIND_TWO_DISTINCT_TARGETS` |
| Owner confirmation | `UNSIGNED` |

This class does not authorize a service restart/deploy, secret materialization, private exchange read, signed request, or money action.
