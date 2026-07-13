# IP Assurance worker emergency checkpoint

Checkpoint reason: usage-limit emergency stop on 2026-07-13. This file records resumable worker state only; it is not an acceptance receipt and does not claim `ASSURANCE_PRESTAGE_READY`.

## Current step

Step **4/7** — close the remaining generated-report truth gaps before the final SHA-bound regeneration and full evidence loop.

## Exact next sub-task

Finish wiring the new synthetic Failure Atlas into `test/productAssurance/generate-closure.mjs`: create `syntheticAtlas` from the 103 sealed observations, pass it to `renderFailureAtlas`, and include it in `fault-harness-synthetic.json`. Then syntax-check the generator before any regeneration.

## Half-finished at checkpoint

- `test/productAssurance/generate-closure.mjs` contains newly added `buildSyntheticFailureAtlas`, expanded Failure Atlas rendering, and expanded diagnostic approval/provider/sandbox/Class A-D/repair/corpus/run-audit reporting.
- The new Atlas builder is **not yet called** from `main`; `renderFailureAtlas` still has its previous call shape, and the machine fault evidence does not yet include `failureAtlas`.
- The generator has **not** been syntax-checked or executed after this latest patch.
- The 12 packet closure artifacts currently present under `fixtures/productAssurance/{generated,fixtures-root,receipts}` were generated before the latest generator changes and are therefore **stale WIP preservation copies**, not final SHA-bound evidence.
- A read-only Atlas/diagnostic audit subagent was interrupted before completion.
- The protected owner input `I00_PRODUCT_ASSEMBLY_CONTROL_ROOM_AND_LIVE_BRINGUP.md` remains untracked and must not be committed or modified.

## Verified before the half-finished generator patch

- Branch: `ip-assurance-20260713`.
- Core implementation commit before this emergency checkpoint: `3391dcfba93bdf370859a62559612e5ea0d42a35`.
- Required packet, parent-I00, and dedup hashes were verified; base/D-LAUNCH-8 identity was verified.
- Focused Product Assurance suite passed 32/32; server typecheck/build passed; `npm test` and `npm run test:all` passed.
- Production operation scan intentionally failed closed at exactly `server/src/services/newsContext.ts:2302:25`, `fetch:DYNAMIC_METHOD`, `OPSITE_FD086559819579DF346A` (142/143 mapped).
- Scope/import/secret purity passed before the latest generator patch.
- Earlier closure generation was byte-identical across two runs and produced 68 unique insertion rows, but those proofs bind the pre-checkpoint generator/output state and must be repeated after resumption.

## Required terminal posture

Do not claim `ASSURANCE_PRESTAGE_READY`. Unless the director-accepted serial satellite fan-in and the owner disposition of the dynamic fetch method have changed, the exact terminal path remains:

`BLOCKED_AWAITING_DIRECTOR_ACCEPTED_SERIAL_ASSURANCE_SATELLITE_FAN_IN_AND_OWNER_DISPOSITION_OF_NEWS_CONTEXT_DYNAMIC_FETCH_METHOD`

Never push and never touch `current-main`.
