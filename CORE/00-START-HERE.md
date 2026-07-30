# COSMOS — START HERE

Rollback `…21a0` is active. Current truth: `Desktop/run.md` §0/newest §5
and `Desktop/CHANNEL.md` top. Six files; start here.

| file | read it when |
|---|---|
| `00-START-HERE.md` | now |
| `01-SYSTEM.md` | you need to know how it is built and where things live |
| `02-CHANGING-IT.md` | you are about to change code and ship it |
| `03-KNOWN-DEFECTS.md` | **before you debug anything** — the trap you are about to hit may already be measured here |
| `04-RECOVERY.md` | something is broken, or you need backups |
| `05-TURNING-ON-TRADING.md` | you are ready to move real money |

`Desktop/run.md` §4 routes retained evidence. The old `history/` path no longer
exists; follow the current exact pointer.

## The one thing to know before anything else

**Measure, do not infer.** This project lost roughly a week to inferred state presented as
measured state: revisions called "final" from cached reads, defects "verified absent" by a
grep that returned zero, a rehearsal declared green by a topology that differed from
production, a lane declaring itself out of context at 27% used. Every rule in
`03-KNOWN-DEFECTS.md` exists because someone believed something they had not measured.

**When you state a fact, say where it came from. When you did not measure it, write NOT MEASURED.**
