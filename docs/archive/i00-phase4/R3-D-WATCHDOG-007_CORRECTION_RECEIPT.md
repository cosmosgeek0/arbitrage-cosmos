# R3-D-WATCHDOG-007 correction receipt

**Finding:** `R3-D-WATCHDOG-007`

**Severity:** `High`

**Disposition:** `FIXED`

**Correction base:** `172d042054fefc273097426a2ee1ee616ffec30f`

**Rejected candidate C:** `098f7b9449ab3b1c26bda19f51537bfea01d4c48`

**Role 3 receipt SHA-256:** `90613c8273e5c866603dbaa74106f2ff436c06e320a95a0cbdbc4c55c0d5ae1d`

## Exact reproduction and red proof

The verifier's exact command was rerun from the clean correction base. It
exited `0` with a retained `999999` PID lock, `skipped=true`,
`live/ready/tunnel=unknown`, zero external alert bytes, and zero systemctl
bytes. Directory existence alone silently suppressed every out-of-band check.

The additive regression was then authored before the production correction:

```sh
bash ops/tests/i00/test-r3-d-watchdog-007.sh
```

It exited nonzero in the first dead-owner scenario because the status had no
deploy-lock classification and the dead lock was still treated as a live
deployment. No original L15 donor test was edited to obtain the red result.

## Smallest safe correction

- `common.sh` remains the one mkdir-lock owner. A successful acquirer now
  atomically publishes a bounded canonical PID and a closed
  `cosmos-lock-owner.v1` record. The record binds PID reuse to the current boot
  plus process-start identity. Linux uses `/proc/<pid>/stat` field 22 parsed
  after the final command-name delimiter and the kernel boot ID; the macOS test
  host uses fixed-locale `ps` start truth plus `kern.boottime`. Only SHA-256
  commitments to those local identity values are retained.
- The shared classifier is read-only and emits exactly `ABSENT`, `LIVE`,
  `INITIALIZING`, `DEAD`, `STALE`, `MALFORMED`, or `UNKNOWN`. PID and owner
  paths are `lstat`-checked regular files, opened nonblocking and no-follow,
  inode-checked across a bounded read, and parsed with closed formats. A FIFO,
  symlink, oversized record, noncanonical PID, zombie, dead PID, PID reuse,
  permission failure, or observation race cannot become `LIVE`. Every
  non-absence result is revalidated against the original directory inode and
  mode immediately before publication; a replaced observation becomes
  `UNKNOWN`, never a stale consequential classification.
- A fresh incomplete directory gets only a five-second publication grace. This
  preserves the byte-identical donor race test. A proven live owner always
  causes a silent skip regardless of directory age. A dead, stale, or malformed
  lock raises a critical local and external finding while the watchdog runs
  liveness, readiness, tunnel, freeze, and backup checks. Unavailable identity
  is critical and fail-closed. The watchdog never deletes, rewrites, touches,
  or ages out any lock.
- Existing deploy and rollback acquisition may reclaim only a classified dead
  or stale owner. Acquisition, owner publication and its failure cleanup,
  reclamation, and release all share one atomic sibling mutation guard.
  Reclamation reclassifies the exact guarded directory, revalidates its
  device/inode token, and renames only that directory beneath the guard before
  deletion. Release additionally proves the canonical PID plus boot/start
  process generation before making the same guarded rename. A newly published
  live lock therefore cannot be deleted by a reclaimer or an obsolete releaser.
  `LIVE`, `INITIALIZING`, `MALFORMED`, and `UNKNOWN` remain blocking. The
  existing dead-owner deploy regression remains green.
- `status.json` now retains `deployLockState` and `deployLockReason` on every
  pass, and fields not observed during a proven-owner/fail-closed skip remain
  `unknown`. The watchdog writes its local JSONL finding before invoking the
  external hook in a dedicated process group, preserving its output while
  bounding execution and killing the whole group on timeout. External alert
  failure, hang, waiting descendant, or successful hook that backgrounds work
  therefore cannot erase local evidence, leak a child, or suppress later
  checks; the complete process group is cleaned on timeout and normal exit.

No timer, socket, strategy, store, proposal, risk, capital, exchange, private,
signed, transfer, withdrawal, or other money-path owner was added.

## Immutable donor and effective-runtime provenance

The original accepted L15 object and `ops/i00/donor-contract.json` remain
byte-identical. Their immutable anchors remain:

- accepted commit `2cec412927fa2f64f05a0b2774b18e45f8ce4fa5`;
- accepted `ops/live` tree `584163858a0333cb1ccb9eff756e91a851b1cb71`;
- accepted `ops/tests` tree `f3348a74ef22d9ca2faee431ea8cc5df63f552af`;
- 31 accepted live files, 17 donor-owned test files, and the original
  `11` suites / `347` assertions;
- donor contract SHA-256
  `078cc2a3d8bc79026f1de6985284856794e53ba34ffd7fda5d1140e46e31a1b3`;
- accepted live-root digest
  `6c0f6ed75273758a05cc009d0ee2ecab77f0c009c2f783043550706d4a3bc0bf`.

A separate pinned `l15-amendment-contract.json` authorizes only this finding's
two post-integration replacements:

```text
ops/live/bin/common.sh
ops/live/bin/watchdog.sh
```

The effective runtime tree is
`a7ef13b0b81444f7c4021b168669c25fd8180cb6`; its full 31-file root digest is
`83454fb2ee20e529108f84c7f51b4270a25270d62d869f382efdab88322575dc`.
The separate contract binds each before/after Git blob and SHA-256, this
receipt, the focused regression, the exact full effective inventory, and the
ordered base-to-effective tree/digest transition. It contains no wildcard,
placeholder, null authorization, or advance authorization for
`R3-D-BACKUP-008`.

The integrated verifier still re-proves the immutable donor commit, trees,
receipt, ancestry, and all 17 donor test blobs, then permits only the exact
declared modified paths and exact effective hashes. The release assembler,
release validator, installer, and installed no-Git wrappers verify the separate
contract and the complete effective runtime root before use. Release receipts
distinguish immutable donor provenance from authorized effective bytes. The
assembler and validator also require typed full-tree equality between the
packaged `ops/i00` enforcement cohort and the trusted invoking cohort, so a
rewritten packaged verifier plus recomputed artifact manifest still fails.
The installer caches the trusted validator result and staged effective-root
verification, derives the expected enforcement-cohort digest only from its
invoking trusted `ops/i00`, and uses those cached facts to write the receipt.
It never rereads mutable release metadata after validation. Only the trusted
pre-copy verifier and library recheck staged bytes before and after the complete
bundle becomes read-only. Before copying any release bytes, the installer
atomically claims a private real staging directory; it then reasserts that the
staging root remains a real directory and that reserved installed paths are
absent before creating either one. Additive hostile release regressions rewrite
the source cohort plus self-declared digest, inject a reserved receipt, and
precreate the predictable staging path as a symlink immediately after
validation. Each install fails closed before destination publication, and the
symlink target remains untouched.

## Focused green proof

Measured before the finding commit:

- additive hostile regression: exit `0`, `132/132`, including two concurrent
  stale-lock reclaimers serializing without deleting the newly live winner, a
  foreign process generation being unable to release that winner,
  non-canonical grace failing closed without aborting, and a hanging alert hook
  plus descendant being killed without suppressing local evidence or later
  checks, whether the hook waits or exits successfully. A dead lock is also
  proven unable to suppress frozen-deploy and missing-backup evidence;
- unchanged donor watchdog suite: exit `0`, `34/34`;
- unchanged donor deploy suite: exit `0`, `52/52`, including dead-owner
  reclamation and live-lock refusal;
- unchanged donor rollback suite: exit `0`, `27/27`;
- verifier's exact command: exit `0`, `skipped=false`, `live=false`,
  `ready=false`, `tunnel=true`, `deployLockState=DEAD`,
  `deployLockReason=OWNER_NOT_RUNNING`, one critical `DEPLOY_LOCK_DEAD` alert,
  one `is-active cloudflared.service` observation, and the original lock bytes
  retained;
- Bash and Node syntax plus diff hygiene: exit `0`.

The clean correction base had already passed the complete configured
`npm run test:all`, including System Integration `401/401`, Product Integration
`109/109`, Product Control `99/99`, I00 proof `47/47`, I00 commands `28/28`,
and live-edge `1618/1618`. Post-commit root, cross-family, effective-donor, and
release verification remains mandatory before this finding can be treated as
closed in the final Phase 4 acceptance.

The final Phase 4 closure receipt will bind the exact correction commit.
`LIVE_EXECUTION_NOT_IMPLEMENTED`, 16-donor equality, serial dispositions, Q
ancestry receipts, protected owner-input boundaries, and all external-action
nonclaims remain unchanged.
