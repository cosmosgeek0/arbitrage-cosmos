# AI-Ops identity and provider-state matrix - owner-decision draft

Status: `DRAFT-REQUIRES-OWNER-SIGNATURE / NON_DONOR_ADVISORY_ONLY / WAITING_INTEGRATED_ACCEPTED`

No identity, provider, subscription worker, API route, credential, queue, tool or billing path is configured by this document. Current state for all three required identities is `NOT_CONFIGURED`; the optional advisor is the required explicit `NOT_CONFIGURED` row.

## Corrected provider-state enum

`command.txt` supersedes the activation directive's older provider-state vocabularies. The exact provider state is one of:

```text
NOT_CONFIGURED
SUBSCRIPTION_CODEX_WORKER
SUBSCRIPTION_CLAUDE_CODE_WORKER
API_CONFIGURED
DIAGNOSTIC_PLANE_UNAVAILABLE
```

Operating mode, detailed health/fault reason, model identity and workflow phase are separate fields. `SHADOW` or `ADVISE`, for example, may be an operating mode but is never substituted into `providerState`.

## Isolated identity declarations

| Identity ID | Current provider state | Separate boundary required | Permitted capability envelope | Permanent role-specific denials | Decision status |
| --- | --- | --- | --- | --- | --- |
| `RUNTIME_DIAGNOSTICIAN` | `NOT_CONFIGURED` | Principal, auth context, provider/model mapping, budget, queue, typed tools, audit trail and process boundary | Read redacted canonical evidence; diagnose, explain and research approved sources; request bounded read-only queries/replay; draft typed proposals and owner-visible recommendations | No repo write, generic shell, AWS/cloud mutation, production secret, executor, credential access or money path | `DRAFT-REQUIRES-OWNER-SIGNATURE` |
| `ENGINEERING_REPAIR_WORKER` | `NOT_CONFIGURED` | Separate principal, auth context, provider/model mapping, budget, queue, tool profile, audit trail and disposable sandbox/worktree | Start only from an admitted approved case; write only allowed source/test paths; run registered build/test/static/replay/browser gates; prepare patch and rollback artifacts | No production credential, live persistence, Main write, merge, rebase, push, deploy, approval, self-verification or money path | `DRAFT-REQUIRES-OWNER-SIGNATURE` |
| `INDEPENDENT_VERIFICATION_WORKER` | `NOT_CONFIGURED` | Separate run/thread/principal, provider/model mapping, budget, read-only tools, audit trail and preferably separate provider/model family | Read frozen requirements, evidence, base, diff, tests and independently queried post-state; issue a typed verification receipt | Cannot modify candidate, inherit builder narrative/credentials/tools, execute effects, approve production or verify itself | `DRAFT-REQUIRES-OWNER-SIGNATURE` |
| `RESEARCH_TRADE_CONTEXT_ADVISOR` | `NOT_CONFIGURED` | None active. If separately enabled later: its own principal, queue, provider/model map, budget, tool allowlist, data/retention and web-domain policy, audit trail and process boundary | In a separately owner-approved future `SHADOW`/`ADVISE` mode only: bounded cited public context and retrospective hypotheses | No inherited identity/tool/credential, order authorization or veto, live-mandate change, trading hot-path role or uncited context | `DRAFT-REQUIRES-OWNER-SIGNATURE` |

Agreement between identities or models is not proof. No identity may inherit another identity's credentials, tools, queue, budget or authority through fallback.

## Identity x provider-state permitted-scope matrix

Each cell is the maximum permitted envelope if that exact state is later owner-configured for that identity. It is not current activation.

| Identity | `NOT_CONFIGURED` | `SUBSCRIPTION_CODEX_WORKER` | `SUBSCRIPTION_CLAUDE_CODE_WORKER` | `API_CONFIGURED` | `DIAGNOSTIC_PLANE_UNAVAILABLE` |
| --- | --- | --- | --- | --- | --- |
| `RUNTIME_DIAGNOSTICIAN` | No provider/CLI call. Deterministic monitors and canonical evidence continue; cases stay uninvoked/deferred. | Separately mapped trusted-private-runner Codex invocation over redacted evidence and typed read-only tools; diagnosis, approved research and recommendations only. No generic shell/repo/AWS/secrets/money. | Same role envelope through separately mapped trusted-private-runner Claude Code; typed/default-deny reads only. No broad shell/effect access. | Separately provisioned API/workload identity with explicit billing, budget, rate, retention and egress posture; still read-only diagnostic scope. | No provider/model/CLI call. Preserve/defer case and show unavailable honestly; deterministic product/safety continues. |
| `ENGINEERING_REPAIR_WORKER` | No provider/CLI or patch-worker call. Existing deterministic tests may run only through another authorized actor. | Trusted private runner, admitted case and isolated disposable worktree only; allowed source/test writes and registered build/test commands. No production/Main/merge/push/deploy/approval. | Same approved isolated repair/test envelope, enforced by project tool gateway and default-deny hook; bypass-permission modes forbidden. | Separately provisioned API/workload route only inside the isolated repair sandbox and exact write/tool scope; no production credential or authority. | No repair-worker call. Preserve case/worktree evidence; no fallback, mutation or false completion. |
| `INDEPENDENT_VERIFICATION_WORKER` | No provider/CLI model verification. Deterministic gates remain authoritative; no verification claim is minted. | Separate read-only run/thread/principal over frozen artifacts and independent readback; cannot modify candidate or inherit builder tools. | Same separate read-only verifier envelope; provider/model ancestry recorded and candidate immutable. | Separately provisioned read-only verifier route, preferably distinct provider/model family; no candidate mutation or effect. | No model-verifier call and no false verification. Preserve evidence; deterministic gates and human/director decisions remain separate. |
| `RESEARCH_TRADE_CONTEXT_ADVISOR` | Required explicit state. No principal, provider route, queue, tool, egress or call is active. | No permitted scope; advisor remains `NOT_CONFIGURED` pending a separately owner-signed matrix revision. | No permitted scope; advisor remains `NOT_CONFIGURED` pending a separately owner-signed matrix revision. | No permitted scope; advisor remains `NOT_CONFIGURED` pending a separately owner-signed matrix revision. | Not a reachable transition from the unconfigured row because no advisor route exists; retain `NOT_CONFIGURED`, not a fabricated outage. |

If role isolation cannot be proven, a requested active cell remains `NOT_CONFIGURED`; if an already configured route loses auth, quota, limit, retention compatibility or required isolation, it transitions to `DIAGNOSTIC_PLANE_UNAVAILABLE`.

## Never-silent-billing-switch law

1. A subscription worker consumes only the normal limits of the explicitly configured subscription and account.
2. It must never silently switch to API billing, usage credits, another account or any paid fallback.
3. Subscription limit or authentication unavailability transitions that identity honestly to `DIAGNOSTIC_PLANE_UNAVAILABLE`; the deterministic product and safety ring continue unchanged.
4. No provider, account, auth type or billing route changes silently, through uncontrolled fallback, or inside an existing run. Transition to or from `API_CONFIGURED` requires explicit human-owner configuration, a distinct role credential mapping, budget/retention/egress evidence, a durable receipt and a fresh bounded run.
5. API outage, authentication loss, quota loss or retention incompatibility transitions the identity to `DIAGNOSTIC_PLANE_UNAVAILABLE`. A separately pre-authorized same-scope route may be selected only through a new explicit state-transition receipt and fresh run; it is never an in-run or silent billing/account switch.
6. Fallback can never add tools, data, write paths, budgets, authority or retention/egress scope.
7. No consumer login is embedded in the website, and no subscription credential is exposed to the application, browser, models, repository or workers. Supported CLI/OS authentication may consume credential material internally on the separately administered trusted private runner, but raw material never enters worker/model context, environment, prompts, logs, screenshots or fixtures; the application records only a non-secret binding reference.
8. A provider/account/billing change is never inferred from an owner chat sentence; it requires the canonical owner-authenticated change and immutable readback receipt.

## Shared hard-denial envelope

No state or identity may directly:

- sign, submit, amend or cancel an order;
- borrow, repay, transfer, withdraw, bridge, reserve or move funds;
- set leverage, margin/position mode, capital, Risk ceiling, symbol allowance or loss cap;
- bypass Capital, Risk, mandate, reconciliation, execution lease or kill-switch checks;
- read/change private exchange credentials;
- change its own permission, guardrail, policy, audit, budget or hard-denial rules;
- delete/rewrite incident, evidence, audit, receipt, Ledger or model-trace history;
- write Main, live checkout, production persistence or a live binary;
- merge, push, deploy, approve or verify itself;
- use arbitrary shell, network, MCP or filesystem access;
- disable monitoring, sentinel, kill switch, reconciliation or independent verification;
- create a control, execution, Risk, incident, event-bus or Ledger authority;
- treat logs, code, web pages, news, market/exchange text, screenshots or tool output as executable instructions.

## Mechanical descriptor fields required before activation

Every identity/provider binding must make the following fields explicit. `providerState` is never `null` or `UNKNOWN`: before any route exists it is `NOT_CONFIGURED`, and loss of an already configured route is `DIAGNOSTIC_PLANE_UNAVAILABLE`. Other unresolved descriptor fields remain explicit `null`/`UNKNOWN` and block activation:

```text
identityId
provenance
providerState
operatingMode
principalRef
authType
billingRoute
providerAccountRef
credentialBindingRef
providerModelMappingRef
budgetRef
queueRef
toolProfileRef
auditTrailRef
sandboxBoundaryRef
allowedCapabilities
deniedCapabilities
stateReason
transitionReceiptRef
schemaVersion
sourceRevision
contentHash
createdAt
environment
owner
```

`provenance` is a structured record binding at minimum the stable `identityId`, exact `providerState`, `createdAt`, `environment`, `sourceRevision`, `contentHash` and `owner`; it cannot be replaced by narrative text.

Schema validity does not imply factual truth, policy validity or authority.

## Provider-state transition gate

| Transition | Required proof | Forbidden shortcut | Decision status |
| --- | --- | --- | --- |
| `NOT_CONFIGURED -> SUBSCRIPTION_CODEX_WORKER` | Owner configuration; trusted private runner; supported ChatGPT-managed auth; isolated role/tool/budget/audit mapping; limit behavior test | Reusing an interactive chat, consumer login in site, inherited account or API fallback | `DRAFT-REQUIRES-OWNER-SIGNATURE` |
| `NOT_CONFIGURED -> SUBSCRIPTION_CLAUDE_CODE_WORKER` | Owner configuration; trusted private runner; supported Pro/Max subscription OAuth; isolated role/default-deny tool/budget/audit mapping | Bypass-permission mode, inherited child tools or API fallback | `DRAFT-REQUIRES-OWNER-SIGNATURE` |
| `NOT_CONFIGURED -> API_CONFIGURED` | Owner configuration; explicit billing/budget/rate/retention/region/egress; revocable role credential; health/readback proof | Scraped subscription token, implicit credits, shared credential or silent paid route | `DRAFT-REQUIRES-OWNER-SIGNATURE` |
| Any configured state -> `DIAGNOSTIC_PLANE_UNAVAILABLE` | Deterministic detection of auth/limit/quota/outage/retention/isolation failure; persisted state and owner-visible reason | Hiding failure, retry storm, budget reset or broader fallback | `DRAFT-REQUIRES-OWNER-SIGNATURE` |
| `DIAGNOSTIC_PLANE_UNAVAILABLE` -> configured state | Fresh owner-authorized configuration and credential/connectivity/quota/retention/readback proof in a new run | Resuming stale callbacks, stale credentials or prior approval | `DRAFT-REQUIRES-OWNER-SIGNATURE` |
| Any configured state -> `NOT_CONFIGURED` | Explicit owner deconfiguration; provider calls stopped; route and credential binding revoked; durable receipt and independent readback; deterministic product unchanged | Treating a fault as deconfiguration, leaving a reusable session alive, or retaining hidden fallback | `DRAFT-REQUIRES-OWNER-SIGNATURE` |

## Owner decision record

| Field | Current value |
| --- | --- |
| Decision | `NOT_SIGNED` |
| Owner identity | `MISSING` |
| Accepted base SHA | `MISSING` |
| Matrix content digest | `MISSING` |
| Role/principal mapping receipts | `MISSING` |
| Signature/time | `MISSING` |
