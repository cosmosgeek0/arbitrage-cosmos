# A-AGENT integration receipt

Status: `A_AGENT_INTEGRATED / AGENT_PRESTAGE_READY_PRESERVED`

Date: `2026-07-14`

This receipt closes one accepted donor row only. The packet is deterministic, fixture-backed, and diagnostic-only. It does not activate a provider, execute a command, declare recovery, grant agent authority, or claim overall Product Assurance readiness.

## Immutable donor

- Branch: `ip-assur-agent-20260713`.
- Accepted tip: `97e87bd7045d2883ef8c4bd3cdb7f5daf83e0437`.
- Donor tree: `e68ef10d09c11bc5623099a2eb6eb6881054486b`.
- Frozen assurance base: `9785c93102b00389847b77c2f9348c06abc4344b`.
- Receipt: `fixtures/productAssurance/systemic/agentBoundary/receipts/AGENT_BOUNDARY_PRESTAGE_RECEIPT.v1.json`; Git blob `1c2fb625a3d90ece61a44c56adc9788063badb99`; SHA-256 `c237939f112a41abfb83508ed57e5783a9344cc3cb76e02003ca64487831a92c`; terminal `AGENT_PRESTAGE_READY`.
- Donor delta: 20 paths; sorted newline-terminated path-set SHA-256 `11a0a317f05371d5a9378776cc0d7343a5d4a622c5f19dce2c2f6dbe8a5d6b27`.
- Donor worktree had no staged or modified tracked path; its protected untracked I00 directive was not copied, staged, removed, or used as implementation.

## Integration identity and scope

- Merge commit: `251d901e2a38c7b3b9634ab1728098655f0104bb`.
- Merge tree: `7740fd6df57a5caf337320d439c027585df488de`.
- Parents in order: pre-A-AGENT integration `c5d18db072153d335ab14c82634eafca2370230c`; exact donor `97e87bd7045d2883ef8c4bd3cdb7f5daf83e0437`.
- First-parent delta: 20 paths; sorted newline-terminated path-set SHA-256 `11a0a317f05371d5a9378776cc0d7343a5d4a622c5f19dce2c2f6dbe8a5d6b27`.
- All 20 donor paths were compared by Git blob: 20 checked, 0 mismatches.
- No integration-owned production path changed in this merge; exact donor ancestry and `git diff --check` pass.

## Measured verification

| Gate | Measured result |
| --- | --- |
| Exact focused command at immutable donor tip | Exit 0; `111/111` |
| Exact focused command on accumulated integration branch | Expected context-only exit 1; `109/111`; the two failures are the immutable donor-branch name seal and whole-branch `9785..HEAD` path-scope assertion |
| Six non-context test files | Exit 0; `103/103` |
| Six positive-selected non-Git purity assertions from `purity-scope.test.mjs` | Exit 0; `6/6` |
| Combined integration-safe behavior | Exit 0; `109/109` |
| Git-backed integration provenance | Exact merge second parent, 20/20 blob equality, exact path-set hash, and accepted receipt identity all pass |
| `npm test` | Exit 0; typecheck/build green; deterministic `377/377`; existing Vite chunk-size warning only |
| `npm run test:all` | Exit 0; deterministic 377, application runtime 72, intelligence 152, intelligence runtime 394, capital 433, Foundation 871, System Integration `180/180` |

The two donor-branch-only assertions are not weakened, rewritten, or reported green on the integration branch. Their valid donor-tip result and their replacement Git-object proof are recorded separately so branch accumulation cannot create either a false failure or a false green.

## Honest gaps

- All three insertion-request rows remain `DRAFT`; serial-spine production owner wiring is pending.
- Provider state remains `NOT_CONFIGURED`; the packet has no network, credentials, external activation, execution, recovery, or money authority.
- The packet is still outside current root-script discovery; integration-safe Product Assurance harness wiring remains pending.
- Overall `ASSURANCE_PRESTAGE_READY` is not claimed.

## Ruling

Expected A-AGENT donor = discovered immutable tip = receipt-accepted donor = integrated donor by exact merge ancestry. All 20 donor paths are byte-identical, all 111 donor-tip proofs and all 109 integration-safe behavior proofs pass, the two immutable Git-context differences are explicitly proven rather than suppressed, and repository-wide gates are green.
