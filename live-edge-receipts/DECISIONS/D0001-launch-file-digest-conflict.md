# D0001 — fail closed on launch-file digest conflict

Status: `ACTIVE_BLOCKER`

## Context

The owner instruction and `QL_DIRECTOR_STATE.md` require SHA-256 `0cc192e348f51f7ab372b0245568bbf88f3ccbf23d3f0c581e853dd9f30cd3cc` for `DIRECTOR_Q_L_TWO_LANE_LAUNCH.md`. The file's Git blob is recorded as `587c1b83e8f9d32b9097d88df7fea40d9829b68e`.

Independent `shasum -a 256` and OpenSSL checks of that exact blob/file produce `26b1d5ce118982b4b3ba64b44b7fb3e88b0b7ded26a818a775a65bffaa0f2c06`. Byte-identical copies in the Main, Q and L worktrees produce the same digest. No copy with the required digest was found. The tracked director state therefore contains an internally conflicting blob/content-digest pair.

The owner explicitly waived only the launch file's printed three-character transcription typo for the L-directive SHA-256, authenticated by the matching L-directive MD5. That waiver does not cover the launch file's own SHA-256 mismatch.

## Decision

End L00 at `PARTIAL_AUTHORITY_BLOCKED` and the lane at `BLOCKED_EXTERNAL`. Preserve all read-only launch, authority, source-research and baseline evidence. Do not implement L01 or mark any phase accepted.

## Resolution required

The director must do exactly one of:

1. supply `DIRECTOR_Q_L_TWO_LANE_LAUNCH.md` bytes whose SHA-256 is `0cc192e348f51f7ab372b0245568bbf88f3ccbf23d3f0c581e853dd9f30cd3cc`; or
2. explicitly and durably accept content SHA-256 `26b1d5ce118982b4b3ba64b44b7fb3e88b0b7ded26a818a775a65bffaa0f2c06` for Git blob `587c1b83e8f9d32b9097d88df7fea40d9829b68e` and correct the controlling director state.

After resolution, resume L00 from the durable state, re-run the input/hash/scope gates, finish the same phase, and do not repeat the completed inventory, official-source research or baseline unless their recorded inputs changed.
