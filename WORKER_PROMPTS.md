# WORKER_PROMPTS.md — copy-paste blocks for owner chats (director-maintained)

Rule: one block = one chat = one folder. Director appends/replaces blocks at every event; check the top entry's date. Board truth: QL_PARALLEL_DAG.md.

## ACTIVE WAVE 4 (2026-07-13, post L09-002) — running: Q spine, L10, L11. NEW: block 9 (L08.2 twin Spot seam). L09 BLOCKED until it lands.

### 9. L08.2 twin Spot seam — folder /Users/cosmosgeek/Desktop/live-execution-proof-20260712
```text
You are the L-spine bridge builder, ONE bounded phase L08.2 (D-LAUNCH-7 authority; verify `git -C /Users/cosmosgeek/Desktop/Main log -1 --format=%H -- QL_DIRECTOR_STATE.md`). The L spine is PARKED at f79247a (through L08.1 + L14). FIRST read live-edge-receipts/DECISIONS/L09-002-*.md (in the l09-normal-basis worktree history, branch l09-normal-basis-20260712, commit a560b8a) for the exact gap: the accepted L07 exchange twin has no seam to preflight/consume the L08.1 Spot order/TIF capability, so an exact Spot BUY LIMIT GTC leg is rejected PREFLIGHT_NOT_EXACT while USD-M fills. TASK: additively extend the accepted L07 twin so it exactly preflights and simulates Spot LIMIT/GTC (and the other L08.1-emitted Spot order types/TIFs) with the same rigor it already applies to USD-M — no send capability, deterministic, network-free, no new authority. Stay in lane exclusive paths (§3.3; shared files → patch requests). Full evidenced loop → accept as L08.2 with immutable receipt → record accepted SHA prominently in LIVE_EXECUTION_BUILD_STATE.md → PARK. Director then re-bases L09/L10/L11. Standing laws + hard external boundary unchanged; never push. Stop only at L08.2 ACCEPTED or BLOCKED.
```

## HISTORICAL WAVE 3 (2026-07-13, post L08.1) — running: Q spine, L10, L11. NEW: block 8.

### 8. L09 resume — folder /Users/cosmosgeek/Desktop/l09-normal-basis
```text
L09 shard resuming (D-LAUNCH-7; bridge landed). Verify: branch l09-normal-basis-20260712; `git log --oneline -2` shows the director re-base merge of L08.1 (f79247a — Spot order/TIF bridge accepted). Your blocker is CLEARED per your own resume condition: first prove the accepted L08.1 evaluator emits a non-sendable ordered normal-Basis plan; then implement ONLY server/src/liveEdge/adapters/normalBasis/** and matching server/test/liveEdge/normalBasis/** proofs — the NORMAL-BASIS two-leg lifecycle of §17 (staged entry, hedge, partial-fill/one-leg exposure, close, recovery) through the L07 twin, network-free. All prior L09 laws unchanged (exclusive paths, no shared files, no other worktrees, no push, hard external boundary). Full loop → acceptance → record SHA. Stop only at L09 ACCEPTED or BLOCKED.
```

## HISTORICAL WAVE 2 (2026-07-13, post D-LAUNCH-7) — currently running: Q spine (Q16), L10, L11. NEW blocks below: 6 + 7. L09 stays BLOCKED until the bridge lands. Old wave blocks 1-5 are historical.

### 6. L-BRIDGE (L08.1) — folder /Users/cosmosgeek/Desktop/live-execution-proof-20260712
```text
You are the L-spine bridge builder (D-LAUNCH-7; verify `git show HEAD -- QL_DIRECTOR_STATE.md` on current-main via `git -C /Users/cosmosgeek/Desktop/Main log -1`). The L spine is PARKED at 4ae270a (L00-L08 + L14 accepted); you own this worktree for ONE bounded phase: L08.1 — the Spot order/TIF capability bridge. FIRST read live-edge-receipts/DECISIONS/L09-001-NORMAL-BASIS-BLOCKER.md and the L09 blocker receipt in the l09-normal-basis worktree history (branch l09-normal-basis-20260712, commit e315ef5) for the exact gap. Implement additively within lane exclusive paths (§3.3): extend the accepted L04 instrument/filter registry and L08 order-policy evaluator so the evaluator emits a non-sendable ordered normal-Basis plan including Spot order-type/TIF validation — no new authority, no shared files (patch requests instead), no send capability of any kind. Full evidenced loop -> accept as L08.1 with immutable receipt -> record the accepted SHA prominently in LIVE_EXECUTION_BUILD_STATE.md -> PARK. The director then re-bases L09/L10/L11. Standing laws + hard external boundary unchanged; never push. Stop only at L08.1 ACCEPTED or BLOCKED.
```

### 7. I00-VERIFY resume — folder /Users/cosmosgeek/Desktop/i00-assembly
```text
I00-VERIFY resuming (D-LAUNCH-7). The five owner directives (I00 parent + IP_RUNTIME/CONTROL/OPS/PROOF) are now in your worktree root; the frozen-input gate must treat QL_DIRECTOR_STATE.md / QL_PARALLEL_DAG.md as LIVING director state accepted at their latest current-main commit (D-LAUNCH-7 ruling; verify `git -C /Users/cosmosgeek/Desktop/Main log -1 --format=%H -- QL_DIRECTOR_STATE.md`) — do NOT overwrite historical IP-PROOF receipt hashes; add an I00-level acceptance record instead. Resume from I00_PRODUCT_BUILD_STATE.md: clear the frozen-input blocker with that ruling, finish remaining Task 1/Task 2 items, commit + receipts + state. No push, no current-main, no other worktrees. Stop at I00_PRESTAGE_VERIFIED or a precise new blocker.
```

## HISTORICAL WAVE 1 — run all 5 concurrently

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
