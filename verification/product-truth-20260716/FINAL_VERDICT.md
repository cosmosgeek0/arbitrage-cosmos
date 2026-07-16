# Candidate Verdict — TruthA Pass 0

Status: `PRECISE_BLOCKED`

Immutable candidate C2: `dea2d2a5c2b5e83d3aea75b0e368f0a478596561`

Evidence HEAD: `ASSIGNED_BY_CONTAINING_EVIDENCE_ONLY_COMMIT`

Canonical gate: `PASS`.

Live-remote and backup-bundle custody: `VERIFIED`; bundle SHA-256 `4c36d73fcef5e065c8b416e9e3f64da3a93981abde0b4d40e0b4daa26b799d1b`.

Literal clean-clone gate: `BLOCKED`.

Failing command: `npm run test:all`

Exit code: `1`

First causal error: `DONOR_EQUALITY_BLOCKED:COLLECTION_FAILED:GIT_COMMAND_FAILED:cat-file:128`
Affected evidence: `verification/product-truth-20260716/C2_GATE_REPORT.json`

Exact-C2 census regeneration is also blocked: the generator expected 101 registered worktrees and observed 96. The historical census is not accepted as C2 evidence.

C2 remains immutable and is not rewritten. The evidence child is not a replacement C2. No baseline, independent, final, integration, deployment, or money-path acceptance token is issued.
