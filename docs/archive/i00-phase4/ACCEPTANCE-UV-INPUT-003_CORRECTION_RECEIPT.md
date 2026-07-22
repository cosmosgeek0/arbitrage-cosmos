| Item | Status | Record |
| --- | --- | --- |
| Finding | FIXED | ACCEPTANCE-UV-INPUT-003 |
| Date | RECORDED | 2026-07-22 |
| Defect | CONFIRMED | Sealed acceptance children could not resolve uv from the fixed PATH, so the uv-lock gate failed inside complete acceptance. |
| Explicit input | ENFORCED | `--uv` is mandatory in run mode and accepts only an absolute platform-named uv path resolving to a regular executable file. |
| Entrypoint passthrough | ENFORCED | `test/i00/complete-acceptance.mjs` forwards the explicit uv input to `test/i00/performance/local-acceptance.mjs`. |
| Plan contract | ENFORCED | Plan mode lists the explicit uv path as a required run input without starting acceptance. |
| Preflight | ENFORCED | Missing, relative, absent, wrong-name, non-regular, and non-executable uv inputs fail before any acceptance step. |
| Provenance | ENFORCED | Complete-receipt provenance binds separate SHA-256 values for the resolved uv path and binary bytes. |
| Sealed environment | PRESERVED | Only the explicit uv path's directory is prepended to child PATH, and lookup resolves the validated target; every other sealed environment field remains unchanged. |
| Receipt validator | UPDATED | `ops/i00/complete-acceptance-receipt.mjs` requires exact uv provenance fields. |
| Fixture | UPDATED | `ops/tests/i00/fixtures/make-complete-acceptance.mjs` carries uv provenance. |
| Missing-input regression | PASS | Explicit-input tests exit 0; evidence paths are `test/i00/performance/performance.test.mjs` and `test/i00/commands/complete-entrypoint.test.mjs`. |
| Invalid-input regressions | PASS | Relative, absent, wrong-name, directory, and non-executable cases exit 0; evidence paths are in `test/i00/performance/`. |
| Lock-gate propagation | PASS | Exit 0; the nonzero uv-lock/current-Q result fails the chain in `test/i00/performance/acceptance-contract.test.mjs`. |
| Acceptance contract | PASS | Exit 0; 13 passed; 0 failed; `test/i00/performance/acceptance-contract.test.mjs`. |
| Performance contract | PASS | Exit 0; 34 passed; 0 failed; `test/i00/performance/performance.test.mjs`. |
| Entrypoint contract | PASS | Exit 0; 9 passed; 0 failed; `test/i00/commands/complete-entrypoint.test.mjs`. |
| Ops receipt contract | PASS | Exit 0; 175 assertions; `ops/tests/i00/test-release-and-preflight.sh`. |
| Root test | PASS | Exit 0; Product Assurance 802/802 behavior checks and 4/4 provenance checks; AI-Ops 456/456; `package.json` script `test`. |
| Full matrix | PASS | Exit 0; canonical gate PASS; Quant 3,242 passed, 1 allowed platform skip, 0 failed; `package.json` script `test:all`. |
| Documentation | UPDATED | `README.md`, `test/i00/performance/README.md`, and `STATE.md`. |
| Historical evidence | UNCHANGED | No existing receipt or acceptance evidence file is edited. |
| Gate posture | UNCHANGED | No acceptance gate, skip, waiver, authority boundary, private call, or money path is weakened. |
| Protected trees | UNCHANGED | No protected tree is modified. |
| External effects | NONE | No push, deployment, provider mutation, private exchange call, or secret use. |
