# 03 — KNOWN DEFECTS AND TRAPS

Read this before debugging anything. Every row carries the command or `file:line` it came
from, or is marked `NOT MEASURED`. Paths are relative to `Desktop/cosmos-merge` unless stated.

---

## A. TRAPS THAT WILL COST YOU AN HOUR IF NOBODY WARNS YOU

**A1 — verify checkout role and remote before trusting a tip.**
`Desktop/Main` holds the object store; `Desktop/cosmos-merge` is the canonical linked
checkout. Make changes in an isolated worktree based on its exact accepted tip.

**A2 — a grep returning zero is not proof of absence.**
Three separate false conclusions came from scope-limited greps stated as product-wide facts.
The worst: "live execution is missing", concluded from searching two directories while the
execution code lived in a third. **State the search scope or do not state the count. Enumerate
what IS there rather than confirming what is not.**

**A3 — backup rehearsals were green by construction.**
The backup evidence directory sits INSIDE the backup write root in production and BESIDE it in
every rehearsal, so the retention check could never fail in practice and always failed in
production. One defect survived three fix rounds because of it. *(Relayed by the finding lanes;
NOT re-measured by this lane.)*

**A4 — the acceptance receipt stores step output as SHA-256 digests only.**
`stdoutSha256` / `stderrSha256`. Hundreds of KB of output exist as a hash and nothing else.
There is no route to a failure's text except re-running with output captured outside the clone.
A zero-byte failure-detail file is structural, not sloppiness. *(Runner 2's measurement.)*

**A5 — anything that binds a revision must be produced AFTER that revision stops moving.**
An identity card and a capture receipt were both generated before the tip settled and were
stale within minutes. Same class as a stale tip.

---

## B. SOURCE AND OPERATIONAL GAPS

**B1 — backup capability exists; current schedule state is `UNKNOWN`.**
Source `…1be1` has an unbarred hourly persistent backup template. One live online
backup and one isolated restore are accepted. At that acceptance, hourly
backup/watchdog were `NOT_ARMED` and restore-drill remained barred. See
`04-RECOVERY.md`; source timer bytes are not host activation proof, and no newer
timer activation/freshness acceptance existed at this evidence cut.

**B2 — `AF_NETLINK` is fixed in source.**
Canonical `ops/live/systemd/cosmos-app.service:67` includes `AF_NETLINK` from
`…68df`. Rollback `…21a0` has live=`200×3` and ready=`503`; that readback
does not prove its installed unit contains the source fix.

**B3 — the netlink defect does NOT extend to the backup or restore-drill units.**
`git grep -n networkInterfaces -- server/src ops` returns three textual hits:
two implementation references in `dataDirLease.ts` and one explanatory app-unit
comment. Backup and restore-drill units contain zero. Rollback `…21a0` is
accepted active/live (`200×3`; ready=`503`).

**B4 — readiness mode/document truth is `UNKNOWN`.**
Source maps `READINESS_POLICY_WRONG_MODE` after separate missing, malformed, and
scope checks. Accepted rollback evidence proves only ready=`503`; no accepted
response body or supervisor/waiver readback identifies why. Mode/document truth
stays `UNKNOWN`.

**B5 — release validation lets the release supply code that judges it.**
`ops/i00/bin/validate-release.mjs:252` awaits canonical acceptance validation, which dynamically
imports two modules **from the release being validated** and calls their exports to judge that
release's evidence. The artifact manifest covering those files is verified at `:322` — seventy
lines later, both top-level, source order = execution order. **The hash pin exists and is checked
after the code has already run.** The guard `existsSync(sourceValidator) ? MODULE_ROOT : releaseRoot`
is inert because both arms resolve to the same directory.
Harmless on a self-built release. **Real from the second deploy onward.**

**B6 — second executable name list still omits two entries.**
`ops/live/bin/common.sh:453-456` (`const names = [...]`) omits `exposure` and `alert`, the two names
the landed fix added at `:271`. Verified by content: `grep -n -A3 "^const names = \["`.
Weakens an identity binding only; causes no refusal.

---

## C. RELEASE-SWITCH CONCERNS

Rollback `…21a0` is active/stable: live=`200×3`, ready=`503`. Signed-in
Dashboard/Account/Markets rendered at 1920×1080 with no 502; Dashboard also at 398×486.
Failed `…1be1` is preserved; blocker=`ROOT_ONLY_RELEASE_PACKAGING_PREVENTS_COSMOS_RUNTIME_ACCESS`.
Public only: packaging Q pending, no retry, `PRIVATE_READ_READY` blocked.

---

## D. THE PROCESS RULES THAT WERE PAID FOR IN TIME

1. **If you are not working, name the blocker.** If you cannot name one, resume. Four separate
   stalls were lanes waiting for something that was never coming.
2. **A reporting rule is not a stopping rule.** "Report X" means append the row and keep working.
3. **A file-change event is not a heartbeat.** It shows writes from any source.
4. **A lane's self-report about its own capacity is a claim, not a measurement.**
5. **A deferred item's stated REASON decays exactly like a stale revision.** Re-measure the reason
   before accepting that something is still blocked.
6. **When two checks guard the same property, fix the one that runs FIRST.** Three times a fix landed
   on the second-firing site while the first-firing one survived and masked it.
