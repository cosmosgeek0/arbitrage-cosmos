# IP-ASSURANCE S6 agent-boundary satellite state

Schema: `IP_ASSURANCE_AGENT_BOUNDARY_STATE_V1`

- Status: `AGENT_PRESTAGE_READY`
- Branch: `ip-assur-agent-20260713`
- Base: `9785c93102b00389847b77c2f9348c06abc4344b`
- Audited emergency checkpoint: `66a11f99f6a953be6534d3ff6722dce043501a87`
- Audited blocker checkpoint: `498d087dbc445d403be6aac5149ae7e377f04418`
- Verified implementation commit: `86a0e80f53069de33488f30aa55338648a46cf37`
- Binding owner law: `c57610c:IP_ASSURANCE.md#7.1`
- Binding owner commit: `c57610cb5f7d56efb61e53ae27057fbe92a6a2f6`
- Binding `IP_ASSURANCE.md` SHA-256: `49dcd690275ff35cb32566af307ad572d2a527e06d7388885f98826560968e84`
- Protected parent I00 SHA-256: `9d7a36da6a2e6e7b3e905c73161b5e998a2f92416dd557e498ade3e73d5e5ef5`
- Packet receipt: `fixtures/productAssurance/systemic/agentBoundary/receipts/AGENT_BOUNDARY_PRESTAGE_RECEIPT.v1.json`
- Packet receipt SHA-256: `c237939f112a41abfb83508ed57e5783a9344cc3cb76e02003ca64487831a92c`
- Exclusive writes: `fixtures/productAssurance/systemic/agentBoundary/**` and `test/productAssurance/systemic/agentBoundary/**`
- External actions: `NONE`

## D-LAUNCH-13 disposition

The prior `CLASS_TAXONOMY_OWNER_LAW_MISSING` blocker is cleared by the exact
current owner object above. The packet now binds all Class A-D routes to that
law and projects deterministic triggers, special clock/event/backup-path
evidence, shadow/no-authority posture, numeric policy and candidate bounds, all
nine Class A promotion evidence points, and automatic recurrence/drift/changed-
assumption demotion.

- Class A projects registered-only eligibility through the canonical Control
  Plane route. Its reference evidence cannot mutate capital or an external
  environment, and `operationalActionAllowed` remains `false`.
- Class B projects only canonical reconciliation/recovery and cannot enter an
  agent-repair allowlist.
- Class C projects the owner-approved hash-bound release route; external
  activation stays blocked pending separate I00 section 20 authorization.
- Class D projects abstention or demotion through the accepted Q/runtime owner.
- Active Class A recurrence, drift, or changed assumptions changes the effective
  class to D and the route to abstain/demote without granting execution authority.

The schemas remain closed, the evaluators are pure and injected-clock only, the
fixtures are synthetic, and the cockpit adapter consumes the sealed decision
without recomputing class, bounds, promotion, or demotion truth.

## Verification

- Focused agent-boundary suite after receipt/state seal: `111 tests; 111 pass; 0 fail`; exit `0`.
- Syntax/import and packet JSON parse checks: pass; exit `0`.
- `git diff --check`: pass; exit `0`.
- Standard repository gate `npm test`: exit `0`; `253` disjoint reported checks, all green.
- Accumulated repository gate `npm run test:all`: exit `0`; `3,365` disjoint reported checks, all green.
- Repository gates ran in a disposable copy using the existing Main dependency
  installation. Root, lockfile, server-workspace, and web-workspace manifest
  SHA-256 values matched this worktree exactly before execution. This worktree's
  own `node_modules` remains absent and no package or lockfile was changed.
- Adversarial regressions cover every missing nine-point evidence element,
  law/policy drift, class-route widening, forbidden capital/external effects,
  special trigger gaps, recurrence/drift/assumption demotion, Class B repair
  smuggling, Class C external activation, forged envelopes, common mode, replay,
  and cockpit false-green paths.

## Scope and authority

- The protected untracked I00 input was neither edited nor staged.
- No production evaluator, runtime, route, startup, persistence, package,
  lockfile, UI, shared generated artifact, Q/L path, exchange adapter, Capital,
  Risk, reconciliation, supervisor, ledger, or command owner was changed.
- No network, provider, secret, private/signed exchange, order, test order,
  borrow/repay, transfer, withdrawal, leverage/margin, deployment, merge, or push
  action was performed.
- Provider mode remains `DETERMINISTIC_STUB_ONLY`; `NOT_CONFIGURED` remains a
  complete valid absence state.
- Receipt and state claim packet-local prestage readiness only. They do not claim
  `INTEGRATED`, `LIVE`, `DEPLOYED_PROVED`, or `I00_ACCEPTED`.

Terminal state: `AGENT_PRESTAGE_READY`.
