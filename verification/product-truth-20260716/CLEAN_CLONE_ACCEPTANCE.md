# Exact-C4 Local Single-Branch Gate

Status: `REJECTED_LOCAL_GATE`

Candidate: `4c9143a0bcc331aa170e9e26b741240b39df8b9e`

Actor: `ACCOUNT_A_CANDIDATE_WRITER`; independent acceptance authority: `false`.

## Topology and isolation

- Source clone flags: `--no-local --no-hardlinks --single-branch`.
- Exact detached HEAD: C4.
- Local branch refs: exactly `refs/heads/codex/truth-campaign-c4-20260717`.
- Remote-tracking refs: exactly `refs/remotes/origin/codex/truth-campaign-c4-20260717`.
- `current-main`: absent from the clone.
- Repository: non-shallow; alternates absent; hardlinked object files 0; maximum object link count 1.
- Final tracked status: clean.

## Commands

| Command | Exit | Exact result |
| --- | ---: | --- |
| `npm ci` | 0 | dependency install completed |
| `npm run typecheck` | 0 | pass |
| `npm run build` | 0 | pass |
| `npm run test:product-integration:built` | 0 | 111/111 |
| `npm run test:product-control:built` | 0 | 101/101 |
| `npm run test:i00:commands` | 0 | 29/29 |
| `npm test` | 1 | candidate report parity rejected; acceptance contract 42/44 |
| `npm run test:all` | 1 | same candidate report parity rejection; acceptance contract 42/44 |

The detached canonical worktree produced the same exits and failure. Exact per-command output digests, causal tails, timestamps, cleanup, and unchanged `current-main` snapshots are recorded in `C4_LOCAL_GATE_REPORT.json`.

No `C4_CUSTODY_REQUIRED` token is issued. Repairing the stale tracked generated report would change candidate source and therefore requires C5; it cannot be placed in this evidence-only descendant.
