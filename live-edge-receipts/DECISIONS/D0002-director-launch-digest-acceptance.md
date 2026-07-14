# D0002 — director acceptance of authentic launch digest

Status: `ACCEPTED`

Acceptance ID: `D-LAUNCH-1`

Director commit: `9ca01537f4edda06ee566cd261e612d5c315fb76` on `current-main`

Recorded: `2026-07-12T05:02:30Z`

## Verified evidence

`git show 9ca0153 -- QL_DIRECTOR_STATE.md quant/DIRECTIVE_INPUTS.lock` records that:

- Git blob `587c1b83e8f9d32b9097d88df7fea40d9829b68e` is the authentic `DIRECTOR_Q_L_TWO_LANE_LAUNCH.md` input;
- its accepted SHA-256 is `26b1d5ce118982b4b3ba64b44b7fb3e88b0b7ded26a818a775a65bffaa0f2c06`;
- the earlier `0cc192e348f51f7ab372b0245568bbf88f3ccbf23d3f0c581e853dd9f30cd3cc` value was a stale pre-resave measurement and is superseded;
- the separately waived three-character L-directive digest typo remains unchanged and consistent with the accepted input;
- the L lane must finish L00 without repeating its verified reuse/source work and then continue.

The acceptance commit is contained by local `current-main`; `git merge-base --is-ancestor 9ca0153 current-main` returned exit 0. The L worktree independently recomputed the accepted blob and content digest. Frozen protocol and director-owned files were not edited.

## Decision effect

- D0001 remains an immutable historical record of the correct fail-closed decision at the earlier gate.
- Its blocking effect is superseded by `D-LAUNCH-1`.
- The launch input integrity gate is `PASSED`.
- L00 may complete from commits `1b97515e` and `310063c8`; their evidence is not repeated.
- No external-action, money, secret, scope, protocol or authority boundary changes.
