# D0019 — L17 worker scope and final evidence boundary

Status: `ACCEPTED_FOR_L17`

Date: `2026-07-14`

## Decision

Implement D-LAUNCH-16 as a per-commit worker scope gate. The latest qualifying
commit on the current first-parent history — exactly two parents and an exact
case-sensitive `director:` subject prefix — is the baseline. Its integrated
tree is canonical and exempt. Every later commit is worker scope and is checked
individually against §3.3; similarly named side-history commits are never
baselines or exemptions.

Use NUL-delimited path streams and disable rename folding. For each worker
commit, `git diff-tree -m --root --no-commit-id --name-only -z -r --no-renames`
observes paths against every parent. This retains forbidden history even after
a later revert and exposes both sides of a rename. Worktree checks likewise use
NUL-delimited tracked and untracked output.

The known D-LAUNCH-16 merge is an ancestry anchor, not a permanently fixed
baseline: a future qualifying canonical first-parent director merge advances
the baseline. Final mode requires a clean tracked tree and exactly the two
byte-verified protected untracked directive inputs.

The accompanying pure final evidence adapter consumes already validated L16
evidence and measured gate facts. It classifies rather than performs fault,
deployment, rollback, canary, private or combined-chain work. `LANE_READY`
means only the applicable local lane is built/tested/unwired; I00 retains
combined integration and product acceptance.

## Current-source implications

Official Git documentation checked on `2026-07-14`:

- `git diff-tree` compares tree objects and supports `-m` for merge diffs,
  `--no-renames` and `-z` path termination, so the gate can inspect each worker
  commit without lossy rename or delimiter assumptions:
  `https://git-scm.com/docs/git-diff-tree`;
- revision traversal supports `--first-parent`, which keeps the baseline search
  on the canonical integration spine rather than accepting a side-branch
  marker:
  `https://git-scm.com/docs/rev-list-options`;
- `git rev-parse` exposes exact revision verification and ancestry object
  identities used by the anchor and branch checks:
  `https://git-scm.com/docs/git-rev-parse/2.39.3.html`.

No remote lookup is required by the gate.

## Security and provenance boundary

The director commits available here use the same visible author/committer
identity as worker commits and are unsigned. Therefore Git cannot
cryptographically authenticate authorship from the ruling classifier alone.
The gate enforces the exact D-LAUNCH-16 structural rule; signed director merges
or a separate immutable authorization channel would be needed for
cryptographic provenance.

The scope gate may read local Git metadata and files but has no mutation,
network, credential or external-action authority. The pure final evidence
adapter may not read Git, files, environment or process state at all.
