# IP_PROOF_RECEIPT.md — product-closure proof prestage receipt

Status: **PROOF_PRESTAGE_READY — FIXTURE ONLY, NOT INTEGRATED OR DEPLOYED**

Recorded: 2026-07-13T01:04:58Z

## Acceptance identity

- Branch: `ip-proof-20260713`
- Director base: `420cc83e5512d54ca1b1c064c1041d89b23914a0`
- Implementation commit: `88430c6a0e4850823f631c6b72afbfe2b6bb8b37`
- D-LAUNCH-6 evidence: `c418bbe7026bdec843b1d74424f5de1fb1265866`
- Frozen protocol: `73e1a1ff7daa48df8dac45713fc5f106842edafc`, 22/22
- Scope: only `IP_PROOF.md` §2 test, fixture, evidence, report, state, receipt, and insertion-request paths
- Production composition, Q/L implementation, shared packages, Architecture, Dashboard Truth, and root package scripts changed: zero
- External systems, private/signed calls, deployment, process restart, money actions, and push performed: zero

## What this receipt accepts

This receipt accepts the reusable prestage machinery, not product integration:

- a source-reporting authority/protocol scan that keeps five unresolved conflicts explicit and `authorityConverged=false`;
- timestamp, freshness, completeness, stable-identity, exact-decimal/filter, revision/expiry, and truth-label semantics;
- a linked synthetic owner chain from public evidence through Q, Basis, opportunity, Capital, Risk, ticket, exchange twin, reconciliation, position, outcome, feedback, and supervisor;
- stateful ambiguity, partial-leg, residual-liability close refusal, kill, crash/restart, DB-before/after, idempotency, stale revision, incident grouping, deployment mismatch, and isolated restore fixtures;
- generated mission, autonomy, no-terminal, resource/backpressure, and official-interface reports;
- machine-checkable page, required-absent-surface, capability, control, adapter-replacement, and no-surprises matrices;
- exact Git provenance for seven accepted baseline SHAs.

No fixture is imported by production code. Every scenario event remains `SYNTHETIC` and `SYNTHETIC_ONLY`.

## Verification receipt

| Gate | Measured result |
| --- | --- |
| Frozen protocol | 22/22, exit 0 |
| IP-PROOF focused suite | 30/30, exit 0 |
| Root `npm test` | exit 0 |
| Root `npm run test:all` | exit 0 |
| App/runtime gates inside full suite | 72/72 |
| System-integration suite inside full suite | 180/180 |
| Frozen inputs | 14/14 exact SHA-256 |
| Accepted receipt provenance | 7/7 Git/ancestry/receipt checks |
| Implementation staged scope | 22/22 §2 paths |
| IP-owned secret/egress scan | zero findings |
| Adversarial review | three independent read-only passes; all implementation blockers corrected before seal |

## Evidence hashes

| Artifact | SHA-256 |
| --- | --- |
| `MISSION_COVERAGE_MATRIX.md` | `547b85886b96b2fc421f5e6c0eb7948e87e2968b0e0b8d6d44cd885fbca5c9b2` |
| `AUTONOMY_CLOSURE_REPORT.md` | `0725a92e56d7921f5ba5ecd8f91bac5e38a186af9d7d53e8698594342f57429d` |
| `NO_TERMINAL_DEPENDENCY_REPORT.md` | `41c1b1d67be03ddf2189334079fd5d4eaeaa035975cae80c5ce338fa90c8e44e` |
| `RESOURCE_AND_BACKPRESSURE_REPORT.md` | `dc0fbef4ed4746eb0e0d0f020ba5cd4e2bd5abb7ff6bd1f1c2a4ad658a4f700a` |
| `OFFICIAL_INTERFACE_MATRIX.md` | `c37491fa427943aa5e739e03fff70c9e38494ab18a5f9215ee139931fe3b461b` |
| `IP_PROOF_SHARED_INSERTION_REQUEST.md` | `4c87cdbc76197dc3a4ea4daa4c486b09a2921563219a0e97307ebaacc09d7d1a` |
| `integration/reports/i00-proof-evidence.json` file | `3d132f701f9de90e0f9260a3e4f0b86d55459f14306abd5cf7d6a1968a013c64` |
| Canonical machine-evidence payload | `83f730e10b73e1c7a0ab098b9f0d32a97d90424c14625359acc7d344c4889ab2` |
| `fixtures/i00/closure-evidence.json` | `cf9fc80ca6352d1c294edcbe83a166a8d361cdea5115df039defbe3a944a3ac9` |
| `fixtures/i00/proof-catalog.json` | `df5f96951133457b56cb4e087af6cf394f74576fd85b5f750a7ee849c16a2109` |
| `fixtures/i00/scenarios.json` | `4fe2d75ef85c208aa4fc0584f269cd49200ac0f6a66ee459bb510f6b4a1955a1` |

The evidence file hash differs from its canonical payload digest because the file also stores the digest field.

## Current-source research boundary

Implementation decisions were checked on 2026-07-13 against current official Binance Spot JSON WebSocket, Spot user-data, Spot SBE, Spot trading, USD-M, and Margin references, plus official AWS Secrets Manager, CloudWatch Agent, and Cloudflare Access JWT-validation references. Exact dated facts and unresolved vendor/adapter blockers are in `OFFICIAL_INTERFACE_MATRIX.md`.

No source lookup authorized or caused a network call from the fixture/test code.

## Adversarial corrections incorporated

The final harness no longer treats desired labels as proof: the happy chain passes IDs stage-to-stage and uses journal/twin state; restart readiness derives from restored durable state plus exact reconciliation; partial exposure halts new entries; residual liability refuses close. Git ancestry is executed, scope is checked against the actual staged NUL-delimited path set, frozen hashes are code-anchored, allowed root reports are secret-scanned, load shedding is policy-derived, absent private/Q metrics render `UNAVAILABLE`, and unresolved authority/interface/control/page gaps remain named blockers.

## Director handoff

The exact immutable prerequisites, replacement map, mandatory gates, and next integration command are in `IP_PROOF_SHARED_INSERTION_REQUEST.md` and repeated in `IP_PROOF_STATE.md`.

After all named immutable tips are accepted and fixtures are replaced, the director's exact first combined command is:

```bash
node packages/edge-protocol-tests/protocol.test.mjs && \
npm run build -w server && \
node --test --test-concurrency=1 --test-reporter=spec "server/test/i00Acceptance/**/*.test.mjs" && \
npm test && \
npm run test:all
```

Only the final I00 director may replace fixtures, mount accepted Q/L/IP adapters, execute authorized real readback, and mark `INTEGRATED_ACCEPTED`.
