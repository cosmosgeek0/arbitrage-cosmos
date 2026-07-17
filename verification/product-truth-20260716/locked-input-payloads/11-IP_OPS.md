# IP-OPS — Operations Bring-Up Package

**Parent authority:** `I00_PRODUCT_ASSEMBLY_CONTROL_ROOM_AND_LIVE_BRINGUP.md`  
**Status:** subordinate packet; artifacts and tests only until external authorization  
**Purpose:** adapt the one accepted L15/infrastructure donor into final release, deployment, monitoring, backup, restore, rollback, and operator-readback artifacts without mutating AWS, EC2, Cloudflare, DNS, secrets, or production services

---

## 1. Donor law

L15 and any accepted infrastructure satellite remain the donor/acceptance owner.

Do not create another deployment architecture or duplicate systemd/service owner.

If an ops writer is active, wait for accepted/parked clean state before consuming its paths.

## 2. When this may run

IP-OPS may run in parallel with Q/L because it uses placeholders, fake services, temporary directories, and frozen runtime contracts.

Actual parameterization for the final composition and any host mutation occurs later under the director and an external authorization record.

## 3. Allowed ownership

Prefer additive equivalents of:

```text
ops/i00/**
ops/tests/i00/**
ops/templates/i00/**
ops/docs/i00/**
IP_OPS_STATE.md
IP_OPS_RECEIPT.md
IP_OPS_ACTIVATION_REQUEST.md
```

Forbidden:

```text
real AWS/Cloudflare/DNS APIs
real credentials or secret values
production host/service mutation
current production units/config
server/web/Q/L code
current-main
```

## 4. Required artifacts

- immutable release layout keyed by tested Git SHA;
- install/build/validate/switch/rollback scripts;
- app/Q/cloudflared service templates as accepted architecture requires;
- dependency/readiness/trade-readiness/recovery-readiness probes;
- environment/config validation;
- Secrets Manager provider and exact IAM policy templates;
- persistent DB/evidence/model/backup paths separated from releases;
- application-consistent SQLite/WAL backup;
- integrity-checked isolated restore drill;
- disk-space and migration compatibility preflight;
- safe shutdown/startup/restart procedure;
- deployment freeze on exposure/ambiguity/recovery;
- log rotation and retention;
- CloudWatch metrics/alarms and external watchdog definitions;
- Cloudflare tunnel/origin privacy/Access verification;
- stable egress/IP verification when used;
- release, rollback, backup, restore, and incident receipt schemas;
- owner runbooks and exact external activation plan.

## 5. Deployment truth contract

Expose:

```text
tested SHA
deployed SHA
release ID
schema/config/model revisions
service states
origin/tunnel/access state
watchdog state
last backup/restore drill
rollback candidate
current deployment blocker
```

Artifact creation never equals deployment.

## 6. Tests

Using temporary directories and fake services prove:

- failed validation never switches release;
- atomic switch and rollback;
- incompatible migration blocks rollback;
- active exposure/recovery freezes deployment;
- backup and isolated restore integrity;
- missing secret/provider fails closed without disclosure;
- loopback-only origin template;
- service dependency ordering;
- restart preserves mutable state;
- log/metric configuration is bounded;
- scripts are syntax/lint checked;
- no real external call occurs.

## 7. Acceptance

IP-OPS is `OPS_READY` only when:

- accepted donor was adapted rather than duplicated;
- all artifact tests pass;
- no external system was mutated;
- no secret appears in repo, log, receipt, or fixture;
- activation request lists exact owner inputs and commands;
- rollback and restore are mechanically proven in isolation;
- state/receipt record donor, commit, hashes, and limitations.

## 8. Exact worker prompt

```text
Read IP_OPS.md and the parent I00 directive. Verify the accepted L15/infra donor
and adapt it; do not create a competing deployment system. Work only in the
director-created IP-OPS worktree and exclusive ops/test/template paths. Use fake
services, placeholders, and temporary directories. Build and test release,
service supervision, readiness, Secrets/IAM templates, monitoring, backup,
restore, rollback, Cloudflare verification, and activation runbooks. Perform no
AWS/EC2/Cloudflare/DNS/secret/service mutation. Finish with commit, tests,
IP_OPS_RECEIPT.md, IP_OPS_STATE.md, and exact activation request.
```
