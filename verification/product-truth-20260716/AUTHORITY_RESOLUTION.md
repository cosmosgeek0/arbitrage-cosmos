# Authority Resolution — TruthA Pass 0

Immutable candidate authority remains C2 `dea2d2a5c2b5e83d3aea75b0e368f0a478596561` with tree `5a5486a3b1d50fd22017e22de2378ae9cfd607a0`. The containing evidence-only child is recorded separately and never replaces C2.

Live `origin/truth-campaign-20260716` and the verified backup bundle both resolve to exact C2. That custody result supersedes the generator's prior hardcoded no-custody conclusion. Historical D-LAUNCH-61 custody remains old-C evidence only.

The canonical exact-C2 gate passed. The required literal single-branch clean clone did not: `npm run test:all` exits `1` because the Git-backed donor proof cannot collect a missing object (`cat-file:128`). Exact-C2 census regeneration also fails closed because 96 worktrees are registered against an explicit expectation of 101.

Therefore Pass 0 is `PRECISE_BLOCKED`. No acceptance token is issued, no acceptance manifest is regenerated, and Wave 1b/final verification cannot begin. `current-main` remains untouched at `f0c030d37b762198b1e34d6b689112a433efa4c8`.
