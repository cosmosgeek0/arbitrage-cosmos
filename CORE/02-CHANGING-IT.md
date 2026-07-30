# 02 — CHANGING THE RUNNING SITE

## The shortest honest path

Rollback `…21a0` is public-only; do not blindly copy or restart a successor:

1. work from the exact accepted tip in an isolated worktree
2. wait for `Q(CUTOVER-RELEASE-MODE-PACKAGING)`; no retry before its ruling
3. if authorized, build off-host as a service-readable, non-writable immutable release
4. after the fresh restart, require permission readback, signed-in eyes-on, and LOW CPU

`PRIVATE_READ_READY` and money remain blocked until those gates pass.

## Current deploy boundary

The original install bypassed `release-switch.sh`. Current source, staging, and live
identities differ; use `01-SYSTEM.md` and the newest accepted `Desktop/run.md` rows
to select the path. Never infer a deployed wrapper or SHA from source.

## Batching rule that saves real time

`Desktop/patches/af-netlink-app-unit.patch` and `Desktop/patches/arm-backups.patch`
were consumed in source commit `…68df`. Do not reapply them; re-measure the
current governed bytes before preparing a new amendment.

## Testing, and its one large blind spot

`ops/tests/` is extensive and mostly honest. **But the authorized-effect seam has never executed
anywhere**: CI runs the delegation-gate suite without elevated privileges and declares a sanctioned
skip, while a workstation run exits green **with no skip marker at all** — a dishonest green.
The capability exists in CI already (it uses elevation elsewhere in the same file).
**Any change to that seam is unverified by the suite until this is fixed.** *(Finding-lane
measurement, see `Desktop/_TRASH/COMMANDER_INTAKE/`.)*

## Where the useful history is

Current routing is in `Desktop/run.md` §4. Retained historical lane material is
under `Desktop/_TRASH/COMMANDER_INTAKE/`; the old `history/` path is gone.
