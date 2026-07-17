# STATE.md — what is true right now

**Status:** `INTEGRATED_ACCEPTED`

**Accepted product source:** `d8a86f722689ed82ad40f9ec44bbbc19c2347646`
**Landing commit:** `dae131726ddb3bb69c75c8a3e5f4259119b84350`
**Pre-cleanup `current-main`:** `bcb3e76b274b7f459af0f85545d38ca117c1f0bd`

The accepted source, landing, and pre-cleanup tip share exact tree `1da28eb2dcc03a0545fc2bc51e2a735e88826014`. This repository-hygiene change is a descendant that changes documentation, campaign artifacts, and one dedicated self-check only; product source remains byte-identical.

**Law:** this file owns current product state. `MISSION.md` owns purpose, and `ARCHITECTURE.md` Part II owns structure and authority. Unknown, unavailable, blocked, or unmounted capability never becomes green.

## Product identity

Cosmos Arbitrage Control Room is one local, observable, validate-only product. Basis and Volume remain the sole strategy authorities. Intelligence Foundation and Intelligence Runtime own evidence and public-source truth. Capital Foundation owns allocation and position policy. Foundation owns control, risk, execution contracts, and reconciliation. The existing Ledger owns durable history. System Integration composes those owners and projects canonical supervisor truth to the cockpit.

`LIVE_EXECUTION_NOT_IMPLEMENTED` remains enforced. Live or test orders, borrow or repay, leverage or margin mutation, transfer, withdrawal, and private exchange operations are unavailable. No withdrawal or transfer-out code or UI exists. Operator modes remain `READ_ONLY`, `ADVISORY`, and `VALIDATE_ONLY`. Server-side keys remain environment-only and untracked.

## Exact product-source identity

| Path | Git tree |
| --- | --- |
| `server/src` | `91c215b392d227be88c1341559fdd2c78b867400` |
| `web/src` | `db9929206447c7413b4d5de2881bce34784815cf` |
| `quant` | `75c79f771d76c7ff37c892ddf1eafe2c9fad9c88` |

## Capability truth

| Capability | State | Boundary |
| --- | --- | --- |
| Validate-only product core | `INTEGRATED_ACCEPTED` | Canonical engine, intelligence, capital, risk, ledger, control, reconciliation, cockpit, operations, and assurance owners remain composed. |
| Basis and Volume | `CANONICAL_OWNER` | No Q, browser, or integration layer may create a second strategy authority. |
| AI-Ops source package | `INTEGRATED` | Contracts, runtime modules, adapters, cockpit surfaces, proof, replay, operations, and runbooks are present. |
| AI-Ops composed runtime | `UNWIRED` | Provider activation, worker lifecycle, production routing, and external paging remain `NOT_CONFIGURED`. |
| Product Assurance | `INTEGRATED` | All 17 required pure families exist; missing or false critical facts fail closed. |
| Existing Ledger and L06 adapter | `WIRED_LOCAL` | The existing Ledger owns atomic local persistence. The production append producer remains `NOT_CONFIGURED`. |
| Foundation quantity bridge | `VERIFIED` | Evidence-only comparison is closed; its production consumer remains `NOT_CONFIGURED`. |
| Formal artifacts | `REFERENCE_ONLY` | Source is integrated; runtime tooling grants no production authority. |
| Q research and forward edge | `ABSTAIN_UNKNOWN` | No accepted evidence establishes repeatable forward value after costs. |
| Cockpit | `INTEGRATED_FAIL_CLOSED` | Required missing, unknown, unavailable, blocked, or unconfigured facts force `BLOCKED_BACKEND` and non-green rendering. |
| Canonical presentation | `SERVER_OWNED` | Component, feed, strategy, and Watchman presentation truth comes from the canonical supervisor; browser code does not recompute it. |
| Refresh acknowledgement | `NON_AUTHORITATIVE` | A successful local refresh action cannot overwrite canonical health or recovery truth. |
| Private account truth and external deployment | `NOT_CONFIGURED` | Separate owner authorization and durable runtime evidence are required. |
| Frontier material | `REFERENCE_ONLY` | It is not accepted product authority. |

## Repository hygiene

The campaign archive, removable coordination notes, and their dedicated self-check are outside the tracked product tree. `QL_DIRECTOR_STATE.md`, `QL_PARALLEL_DAG.md`, and the generated closure-report family remain because protected I00 gates consume their exact product-proof bytes. Product modules do not import the removed campaign folder.

## Verification

These rows are filled only from this cleanup's fresh runs.

| Command | Result |
| --- | --- |
| `npm test` | Exit `0`; acceptance `44/44`, I00 proof `47/47`, Product Assurance `802` behavior + `4` provenance checks, `205/205` operations covered, and `0` prohibited egress attempts. |
| `npm run test:all` | Exit `0`; deterministic and application gates passed, and the final serial Node phase passed `1,618/1,618` with `0` failures. |
| `git diff --cached --check` | Exit `0` for the exact cleanup scope. |
| Tracked-tree reference audit | `server/src`, `web/src`, and `quant` have zero references to the removed campaign folder. |

## Known boundaries

- `NOT_CONFIGURED`: AI provider execution, production AI routing, external paging, staging deployment, private account truth, test-order lifecycle, and deferred production consumers.
- `UNWIRED`: composed AI-Ops production runtime.
- `ABSTAIN_UNKNOWN`: production capacity and forward economic edge.
- `DEFERRED_OWNER_GATE`: private-read, validation, test-order, deployment, and every capital rung.

## Documentation map

Root documentation remains one file per purpose: `README.md` for access, `MISSION.md` for purpose, `STATE.md` for current truth, `ARCHITECTURE.md` for ownership and structure, `AGENTS.md` for repository law, `DIRECTOR.md` for orchestration method, and `DESIGN.md` for the UI system. Historical product receipts belong under `docs/archive/`; temporary campaign and coordination material does not belong in the tracked product tree unless a protected product-proof gate still binds its exact bytes.
