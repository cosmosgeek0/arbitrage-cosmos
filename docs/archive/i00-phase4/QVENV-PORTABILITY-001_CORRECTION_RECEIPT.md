| Item | Status | Record |
| --- | --- | --- |
| Finding | FIXED | QVENV-PORTABILITY-001 |
| Date | RECORDED | 2026-07-22 |
| Defect | CONFIRMED | The raw venv-inspection JSON included filesystem-specific prefix, base-prefix, and executable paths in the accepted manifest hash. |
| Director reproduction | RECORDED | Two otherwise identical locked 65-distribution venvs at different paths produced different raw hashes; both missed the old pin, and the former acceptance worktree path is absent. |
| Old pin | SUPERSEDED | SHA-256 suffix `fc7d`; exact historical value remains in `test/i00/performance/evidence/local-complete-acceptance-20260716022242828-76436.json`. |
| New pin | ACTIVE | SHA-256 suffix `bc0e`; exact machine value is in `test/i00/performance/local-acceptance.mjs` and `ops/i00/complete-acceptance-receipt.mjs`. |
| Fresh sync | PASS | Exit 0; uv 0.11.28; CPython 3.13.14; locked all groups and extras; 65 distributions. |
| Dependency integrity | PASS | Exit 0; `python -I -m pip check`. |
| Computation | PASS | Fixed-order JSON projection; 1,586 UTF-8 bytes; SHA-256 suffix `bc0e`; the complete projection was printed during computation. |
| Hash input | ENFORCED | `implementation`, `pythonVersion`, `versionInfo`, and the complete sorted `distributions` list. |
| Path input | EXCLUDED | `prefix`, `basePrefix`, and `executable` are excluded only from the hash. |
| Venv identity | ENFORCED | Resolved prefix equals resolved venv; resolved executable equals the Python real path; base prefix differs from prefix. |
| Source pins | UNCHANGED | `quant/pyproject.toml` and `quant/uv.lock` SHA-256 checks remain mandatory. |
| Relocation regression | PASS | Two valid path variants produce the same manifest hash. |
| Distribution regressions | PASS | Added, removed, and version-changed distributions each produce `MANIFEST_HASH`. |
| Python regression | PASS | Coordinated Python version drift produces `PYTHON_VERSION` and `MANIFEST_HASH`. |
| Identity regressions | PASS | Prefix, executable, and base-prefix identity failures each produce `VENV_IDENTITY`. |
| Focused manifest test | PASS | Exit 0; `test/i00/performance/performance.test.mjs`. |
| Acceptance contract | PASS | Exit 0; 50 passed; 0 failed; 0 skipped; `npm run test:i00:acceptance-contract`. |
| Release preflight | PASS | Exit 0; `ops/tests/i00/test-release-and-preflight.sh`. |
| Root test pre-freeze | BLOCKED | Exit 1 on two attempts; the sealed-owner fallback correctly refused a dirty clone without protected owner input; the second attempt passed 146/146 terminal groups and 804/805 assurance checks. |
| Root test | PASS | Exit 0; 146/146 passed; 121 seconds; `npm test`. |
| Full matrix | PASS | Exit 0; 14/14 mounted suites; Quant 3,242 passed, 1 platform skip, 0 failed; 866 seconds; `npm run test:all`. |
| Historical evidence | UNCHANGED | No existing receipt or acceptance evidence file was edited. |
| Gate posture | UNCHANGED | No acceptance gate, authority boundary, money path, private call, or protected owner input was weakened or changed. |
| External effects | NONE | No push, deployment, provider mutation, private exchange call, or secret use. |
