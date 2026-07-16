# IP-RUNTIME immutable receipt

Receipt schema: `IP_RUNTIME_RECEIPT_V1`

Disposition: `PRESTAGE_READY`

Implementation commit: `8f19db431871ab8a21f82875d65e7777dd6cba9c`

Packet base: `420cc83e5512d54ca1b1c064c1041d89b23914a0`

Branch: `ip-runtime-20260713`

Sealed date: `2026-07-13`

## Launch and source proof

1. `git show c418bbe7026bdec843b1d74424f5de1fb1265866 -- QL_DIRECTOR_STATE.md` proves D-LAUNCH-6 authorizes the IP-RUNTIME packet.
2. The worker read the complete local `IP_RUNTIME.md` and parent `I00_PRODUCT_ASSEMBLY_CONTROL_ROOM_AND_LIVE_BRINGUP.md` before implementation. Their observed SHA-256 values were `6e93016e3177db69a26844c12e6449d9afac1700e9946570a243051645565810` and `9d7a36da6a2e6e7b3e905c73161b5e998a2f92416dd557e498ade3e73d5e5ef5`.
3. Current implementation guidance was checked against the official Node.js v22 test-runner documentation and the official TypeScript narrowing/object-model documentation before coding.
4. Q/L interfaces were read only from immutable Git objects in the shared object store. No Q/L worktree folder was inspected or changed.

## Frozen protocol and accepted donor evidence

| Evidence | Immutable value |
|---|---|
| Q/L protocol commit | `73e1a1ff7daa48df8dac45713fc5f106842edafc` |
| Protocol document SHA-256 | `951fdbb5f347f900c61e60055f90cf2e1e1e743b75b7dc733652acb8d43353a1` |
| Protocol schema SHA-256 | `229af0ff13d600c7d305c6deb7f57b61bdb6f8a35f6f2349d91f5ab1b4972f1c` |
| L00-L07 accepted state | `4c815f5b739ee0e572e5e72e1eeda6698a4d72ba` |
| L07 implementation | `51be697476f32fbf2e9ae2cf4c5fab359187345f` |
| L07 receipt commit / content SHA-256 | `ebd7aa567334e8e6cbd82e3559f2bcebf56a0088` / `9977d9ea6000a5c2980988254b80893090aaa84bde46164495b5c4d50879c62d` |
| L14 implementation / receipt / acceptance / state | `40b97b7c69ed91e621d1b8a8f66a13a9bd23fec2` / `cf9a104c8f104e06082721203796d71b12d28bc3` / `6c622ac4d3c2d170a59309b73faa436e94d7918b` / `04e50f43ab18b1a0e4b03effcb70f0d7ea5a0e28` |
| Dashboard donor | `692501587617d4880303fbd747d93e63c376f088` |
| L15 work / receipt | `9a82d4715c73ebe4156638c2bf5e8a2c02373bbf` / `2cec412927fa2f64f05a0b2774b18e45f8ce4fa5` |

No accepted Q16/Q17 runtime interface was found. L08 is ready for work but not implemented; L09-L13 remain without accepted implementation. L07 is accepted only as synthetic exchange-twin/calibration evidence. L15 is accepted only as an artifact satellite and performed no real deployment.

## Delivered immutable implementation

The implementation commit adds only:

- `server/src/productIntegration/contracts/**`
- `server/src/productIntegration/adapters/**`
- `server/src/productIntegration/lifecycle/**`
- `server/src/productIntegration/supervisor/**`
- `server/src/productIntegration/commands/**`
- `server/src/productIntegration/fixtures/**`
- `server/test/productIntegration/**`
- `IP_RUNTIME_SHARED_INSERTION_REQUEST.md`

It contains 26 files and 4,934 inserted lines. The insertion request content SHA-256 at the implementation commit is `1a5d61298ba63197ecffdeb0aeba1a2dac2e8a9682d6c4b2925c8d5d98e047b7`.

No `server/src/productIntegration/index.ts` was added because §2 grants only the named subtrees; the director-owned production barrel is an explicit insertion request. No startup, route, package, canonical database, web, quant, live-edge, current-main, Q, or L path changed. The owner-provided root directives remained untracked and were not committed.

## Verification receipt

| Command or review | Result |
|---|---|
| `npm run typecheck -w server` | Exit `0` |
| `npm run build -w server` | Exit `0` |
| `node --test --test-concurrency=1 --test-reporter=spec "server/test/productIntegration/**/*.test.mjs"` | `76/76` pass |
| `node --test --test-concurrency=1 --test-reporter=spec packages/edge-protocol-tests/protocol.test.mjs` | `22/22` protocol checks pass |
| `npm test` | Exit `0`; deterministic total `377/377` |
| `npm run test:all` | Exit `0`; all repository families pass, final System Integration `180/180` |
| `git diff --cached --check` before implementation commit | Pass |
| §2 staged-path allowlist and forbidden-path denylist | Pass |
| Adversarial source/fixture/authority review after hostile proxy/accessor/symbol probes | `ACCEPT` |
| Immutable Q/L/L15 pin, insertion-plan, and final scope review | `ACCEPT` |

The adversarial review initially reproduced acceptance of proxies, symbol-bearing objects, and accessors at the core contract boundary. The implementation was hardened to reject proxies, symbols, hidden fields, accessors, non-plain prototypes, cycles/aliases, overdeep graphs, and overbound graphs before reading field values. The exact hostile repro then passed with zero getter invocations.

An earlier `npm test` run overlapped a separate clean build and lost generated `server/dist/config.js` mid-run. That run was discarded as invalid concurrency evidence. The final uncontended `npm test` and `npm run test:all` both exited zero.

## Non-authority attestation

- No network request, exchange call, credential read, external write, deployment, push, or money action was performed by this packet.
- No live order, test order, borrow/repay, transfer, withdrawal, leverage/margin mutation, signed/private exchange call, or withdrawal/transfer-out UI was added.
- `LIVE_EXECUTION_NOT_IMPLEMENTED` remains enforced.
- L07 synthetic venue/fill/local/recovery truth is not canonical execution, reconciliation, position, exposure, or trade readiness.
- L14 fixture acceptance is not canonical Ledger persistence.
- L15 artifact acceptance is not service installation, external activation, money readiness, or deployment proof.
- This receipt proves pre-stage implementation quality and scope only; it does not claim integration, runtime wiring, browser truth, production readiness, or live operation.

## Handoff

The director may resume from `IP_RUNTIME_SHARED_INSERTION_REQUEST.md`. Required work remains: accepted-donor fan-in, canonical Ledger/database transactions, composition/startup/routes/event delivery, package registration, runtime and rendered-browser proof, current-state documentation, and separately authorized deployment activation. Until those proofs exist, the only truthful terminal state is `PRESTAGE_READY`.
