# WORKER_PROMPTS.md — copy-paste blocks for owner chats (director-maintained)

Rule: one block = one chat = one folder. Director appends/replaces blocks at every event; check the top entry's date. Board truth: QL_PARALLEL_DAG.md.

## ACTIVE WAVE (2026-07-13) — run all 5 concurrently

### 1. Q spine — folder /Users/cosmosgeek/Desktop/quant-edge-research-20260712
```text
Q-lane spine resuming (D-LAUNCH-2/5; verify `git show 1fec867 -- QL_PARALLEL_DAG.md`). Verify: branch quant-edge-research-factory-20260712; HEAD 3ed8e38; `cd quant && .venv/bin/python -m pytest -q` ~2,455 passing. RESUME FROM DURABLE STATE; record Q13 (06f0a8f) + Q15 (e69f687) merges in a new state generation. Execute Q16 (inference service + generated protocol kit; deterministic hashes; protocol 22/22; loopback/UDS; ABSTAIN_UNKNOWN fail-closed) then Q17 (end-to-end proof, benchmark, final receipt). Full evidenced loop each, self-accepted. quant/** only; frozen registry/protocol read-only; no Main/other worktrees/push; network-free tests; advisory-only. Limit → commit+receipt+stop clean; same message resumes. Stop only at BLOCKED or LANE_READY then park.
```

### 2. L09 — folder /Users/cosmosgeek/Desktop/l09-normal-basis
```text
L09 shard builder (D-LAUNCH-5; verify `git show 1fec867 -- QL_PARALLEL_DAG.md`). Verify: branch l09-normal-basis-20260712, HEAD 4ae270a (L00–L08 + L14 available read-only). Execute ONLY the NORMAL-BASIS two-leg lifecycle of LIVE_EXECUTION_REALISM_CONTROL_PROOF_12H.md §17 (root; derive your §7 module path, record it, keep exclusive): staged entry, hedge, partial-fill/one-leg exposure, close, recovery — proven through the L07 twin, network-free. Exclusive: own module dirs under server/src/liveEdge/** + matching tests + live-edge-receipts/*/L09*. Forbidden: reverse-basis/volume paths, shared files (patch requests instead), other worktrees, current-main, push, all external actions. Full loop → acceptance → record SHA. Stop only at L09 ACCEPTED or BLOCKED.
```

### 3. L10 — folder /Users/cosmosgeek/Desktop/l10-reverse-basis
```text
L10 shard builder (D-LAUNCH-5; verify `git show 1fec867 -- QL_PARALLEL_DAG.md`). Verify: branch l10-reverse-basis-20260712, HEAD 4ae270a. Execute ONLY the REVERSE-BASIS lifecycle of LIVE_EXECUTION_REALISM_CONTROL_PROOF_12H.md §17 (root; derive §7 module path, keep exclusive): verified borrow identity, principal/accrued interest, collateral, repay status, residual-liability law (never "closed" while liability/open order/ambiguity/unmatched fill remains; missing borrow truth fails closed), staged entry/hedge/close/recovery via the L07 twin, network-free. Exclusive: own module dirs under server/src/liveEdge/** + tests + live-edge-receipts/*/L10*. Forbidden: normal-basis/volume paths, shared files (patch requests), other worktrees, current-main, push; NO Margin calls ever — borrow truth from injected fixtures only. Full loop → acceptance → record SHA. Stop only at L10 ACCEPTED or BLOCKED.
```

### 4. L11 — folder /Users/cosmosgeek/Desktop/l11-volume
```text
L11 shard builder (D-LAUNCH-5; verify `git show 1fec867 -- QL_PARALLEL_DAG.md`). Verify: branch l11-volume-20260712, HEAD 4ae270a. Execute ONLY the VOLUME DIRECTIONAL lifecycle of LIVE_EXECUTION_REALISM_CONTROL_PROOF_12H.md §18 (root; derive §7 module path, keep exclusive): staged directional entry under advisory gating (launch §7 — Volume cannot silently gain live authority), time-stop/loss/trailing policy revisions, one-position/no-repeat limits, exhaustion/reversal exits, recovery hooks — via the L07 twin, network-free. Exclusive: own module dirs under server/src/liveEdge/** + tests + live-edge-receipts/*/L11*. Forbidden: basis paths, shared files (patch requests), other worktrees, current-main, push, all external actions. Full loop → acceptance → record SHA. Stop only at L11 ACCEPTED or BLOCKED.
```

### 5. I00-VERIFY — folder /Users/cosmosgeek/Desktop/i00-assembly
```text
I00-VERIFY worker (D-LAUNCH-6; verify `git show 1fec867 -- QL_PARALLEL_DAG.md`). Verify: branch i00-product-assembly-20260713 with four ip-* fan-in merges. TASK 1: `npm ci`; `npm test`; every packet suite (server/test/productIntegration/**, web/test/productControlRoom/**, `bash ops/tests/i00/test-templates-and-schemas.sh`, `node test/i00/verify-scope.mjs`, protocol 22/22); `npm run typecheck` + `npm run build`. Fix ONLY fan-in fallout (paths/scaffolding) — never production semantics or Q/L code; needed shared edits become patch-request files + BLOCKED. TASK 2: pre-populate evidence-backed MISSION_COVERAGE_MATRIX.md, AUTONOMY_CLOSURE_REPORT.md, NO_TERMINAL_DEPENDENCY_REPORT.md, RESOURCE_AND_BACKPRESSURE_REPORT.md, OFFICIAL_INTERFACE_MATRIX.md (every row cites path/SHA/receipt; unknown stays UNKNOWN). Commit per task + I00_VERIFY_RECEIPT.md + I00_PRODUCT_BUILD_STATE.md (per I00 §6). No push, no current-main, no other worktrees. Stop at I00_PRESTAGE_VERIFIED or BLOCKED.
```

## Event → next action (director fills)
- L09/L10/L11 ACCEPTED → director merges serially, then appends "L spine L12→L13→L16→L17" block here.
- Q LANE_READY → director audit, then Q lane frozen.
- All lanes + I00_PRESTAGE_VERIFIED → director runs real I00 integration (shared wiring, mount, combined acceptance, land, push).
