# Product Truth Campaign State

Pass-0 status: `BUILDING_C2`

Next-gate status: `BLOCKED` — exact C2 freeze, root/full gates, fresh single-branch clone, and C2 custody

Actor: `ACCOUNT_A_CANDIDATE_WRITER`

Gate: `BLOCKED:D_LAUNCH_62_C2_NOT_YET_FROZEN`

This file is the sole campaign-status authority. Root `STATE.md` owns product state.

## Candidate transition

- Old candidate C `41752d6a87dc1cb1b933bb4460c9cabfc15ff694` is rejected for final-verifier handoff because Wave 1 contains critical provenance findings.
- C2 cannot self-name inside its source commit. Candidate-embedded matrices use `SELF_COMMIT_UNBOUND_USE_EXACT_EVIDENCE_DESCENDANT`; `EVIDENCE_SELECTION.json` defines the only valid exact-C2 selection rule.
- Source base Main remains `2ae812624f20b9bc93fc4ad66cb568929101110f`. The D-LAUNCH-62 director record at `2a832750…` is a controlling input, not candidate ancestry. `current-main` has not been changed by Account A.
- The prior D-LAUNCH-61 GitHub custody head `d2c4f43…` and bundle cover old C only. They do not satisfy C2 custody.

## Wave 1 adjudication

- All durable findings were ingested: PROV `2 CRITICAL + 8 HIGH + 1 MEDIUM` and CLEAN `2 HIGH + 1 MEDIUM`, fourteen total. The abbreviated director prose did not cause PROV-009/010/011 to be dropped.
- `INPUTS.lock` v3 directly hashes controlling, protected, POST-I00, IP_ASSURANCE, Frontier, composite deployment, superseded, absent-superseded, and Wave-1 inputs.
- Directive coverage now contains 17 explicit Frontier rows, six missing MISSION laws, three missing ARCHITECTURE laws, honest `NOT_CONFIGURED` rows for `INCIDENT_ACK` and `SOURCE_ISOLATE`, and exact Ledger/quantity-bridge mappings.
- AI-Ops source remains `INTEGRATED`; route `UNWIRED`; provider, worker, sentinel, paging, and root-test mount `NOT_CONFIGURED`; C2 baseline acceptance `EXCLUDED`. Canonical runners print that exclusion.
- Product Assurance root gating includes A-FORMAL and S2 action-evidence (`131/131` focused checks). The obsolete generator-era closure artifact set is explicitly `REFERENCE_ONLY_NOT_C2_EVIDENCE`; exact C2 regeneration is a `DEFERRED_OWNER_GATE` disposition.
- Sealed I00 proof evidence is now generated from tracked bytes. Ambient Git objects and moving refs are separate tri-state diagnostics. Focused proof passed `47/47`; acceptance contract passed `44/44`, including exact-byte parity from a sole branch with no `current-main` ref.
- D-LAUNCH-7 historical pins remain immutable. The V2 living-input seal binds D-LAUNCH-62-authorized current QL bytes.

## Exact boundaries

- Browser/runtime proof: `BLOCKED` — no exact-C2 rendered browser receipt has been produced.
- Product Assurance real soak and incident corpus: `NOT_RUN` / `UNKNOWN_EMPTY`.
- Deployment, external sentinel, paging, restore, rollback: `NOT_CONFIGURED`.
- Private/signed/test-order/capital paths: `DEFERRED_OWNER_GATE`; no authority granted.
- Wave 1b (`shard-sec` and `v-cockpit`): `PENDING`; final-verifier handoff is blocked.
- C2 off-machine custody: `PENDING`; old-C custody is historical only.

## Exact next action

Finish source corrections, run the canonical gates, freeze exact C2, reproduce `npm ci`, `npm test`, and `npm run test:all` from a fresh local single-branch clone, generate exact-C2 evidence and manifest, then reassess Pass 0. Issue no baseline token unless C2 itself has valid custody.
