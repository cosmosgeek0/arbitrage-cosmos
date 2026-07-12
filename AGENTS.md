# AGENTS.md — rules for any coding agent in this repository

This repository is the durable source of truth. Do not depend on chat history, external agent memory, or hidden assistant state. Everything you need is in the root docs.

## Read order before any work

1. `STATE.md` — what is true right now: components, verification counts, gaps, next steps.
2. `MISSION.md` — why this exists and the two edge hypotheses. Do not relitigate it.
3. `ARCHITECTURE.md` — code families, decision chain, and the canonical authority map (Part II is law).
4. For UI work: `DESIGN.md` — mandatory before touching `web/src`. Part I is the method and ship gate; Part II is the locked baseline for shared surfaces.
5. For directing/orchestrating: `DIRECTOR.md`.
6. Historical evidence (receipts, superseded blueprints, sprint directives): `docs/archive/`.

## Non-negotiable operating rules

- **No money paths.** No live orders, test orders, borrow/repay, transfer, withdrawal, leverage/margin mutation, or signed/private exchange calls. `LIVE_EXECUTION_NOT_IMPLEMENTED` stays enforced and tested. No withdrawal/transfer-out code or UI, ever.
- **No secrets** in code, fixtures, logs, screenshots, receipts, or prompts. Binance keys are server-side `.env` only; pure domain code never reads the environment.
- **One concept, one owner.** Existing Basis/Volume engines own strategy; intelligenceFoundation owns evidence; intelligenceRuntime owns public source truth; capitalFoundation owns allocation/position policy; foundation owns control/risk/execution/reconciliation; the existing ledger owns durable history; systemIntegration only composes. Never create a duplicate scanner, cache, proposal queue, risk gate, store, or socket for an owned concept — write a narrow adapter (see ARCHITECTURE.md Part II).
- **Determinism in domain code.** Injected clocks, no import-time side effects, no timers/sockets/fs/env/`Math.random()` in pure modules, bounded structures, unknown values stay `null`/`UNKNOWN`/`UNAVAILABLE` — never fabricated zeros, confidence, or "pump probability".
- **Tests are network-free** and hostile to false green: meaningful failure cases, real exit codes, no fake-success returns. A module counts only when it compiles, behaves deterministically, and has success and failure proofs.
- **No fake UI.** No decorative buttons, toggles, badges, or health. If it is not wired, label it honestly (`SYNTHETIC_ONLY`, `BLOCKED`, `NOT_CONFIGURED`, `MISSING`) or omit it. The cockpit renders canonical supervisor truth; it never recomputes engine/risk/capital/health truth.
- **Git discipline.** Work on the assigned feature branch. Never commit to `current-main`, never merge/push unless you are the director, never reset/clean/revert work you did not make, and preserve unfamiliar untracked files.
- **Inspect before you edit.** Search the current source for an existing owner before creating anything. For UI, open the real rendered app and measure; screenshots from the owner are evidence, not decoration.

## Verification gate before claiming anything done

- Run the relevant focused suite AND `npm test`; for cross-family changes run `npm run test:all`.
- For UI: reload the app, inspect computed styles, click what you touched, and run the DESIGN.md ship gate.
- Report real numbers and real failures. Never report success from line counts or compilation alone.

## Documentation law (self-documenting project)

- Any change that alters project state (component status, wiring, counts, commands) updates `STATE.md` **in the same commit**.
- Sprint receipts/manifests go to `docs/archive/`; `STATE.md` points at the newest.
- One root doc per purpose; never add a root doc without retiring one. If ownership shifts, amend ARCHITECTURE.md Part II in the same change.
- No chronological diaries. Record state, not story.
