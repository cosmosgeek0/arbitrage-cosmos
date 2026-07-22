| Item | Status | Record |
| --- | --- | --- |
| Finding | FIXED | ACCEPTANCE-Q-CURRENT-002 |
| Date | RECORDED | 2026-07-22 |
| Defect | CONFIRMED | Active complete acceptance re-executed immutable archive-era Q tests under the current stripped macOS environment; those tests are not a portable active gate. |
| Historical execution | HISTORICAL | `q_exact_donor_q17` and `q_exact_donor_all`; no active plan or receipt validator requires them. |
| Standing proof | PRESERVED | `test/i00/performance/evidence/local-complete-acceptance-20260716022242828-76436.json`; both historical steps passed on 2026-07-16. |
| Reproduction evidence | RECORDED | `/Users/cosmosgeek/Desktop/block13/q-archive-detail.txt`; archive Q17 and full execution fail on the current machine. |
| RSS failure | ENVIRONMENTAL | Archive-era child RSS probing fails under the stripped current macOS environment. |
| Golden failures | ENVIRONMENTAL | Nine archive-era process-determinism cases predate the current platform-canonical golden law. |
| Archive history proof | UNCHANGED | Donor Git identity, extraction, Git-metadata refusal, complete inventory, venv provenance and manifest, source pins, and dependency integrity remain mandatory. |
| Active execution | ENFORCED | `q_current_gate`; `node test/run-quant-gates.mjs`; current clone `quant/`; real exit, signal, timeout, byte counts, and output digests remain step evidence. |
| Venv proof | ENFORCED | The accepted archive venv remains provenance- and manifest-checked; the current gate separately requires current `quant/.venv` and enforces locked sync plus dependency integrity. |
| Strictness | INCREASED | 3,243 current tests versus 3,016 archive execution outcomes; +227; current gate also enforces inventory, allowed skips, ruff, format, strict mypy, locked sync, and dependency integrity. |
| Active plan | ENFORCED | Ten exact steps; one current Q gate replaces two historical archive-execution steps without removing archive proof. |
| Failure propagation | PASS | A nonzero `q_current_gate` fails the chain guard and cannot validate as a passed receipt. |
| Archive tamper refusal | PASS | A required archive-entry digest mismatch fails before current execution. |
| Acceptance contract | PASS | 51/51; exit 0. |
| Command contract | PASS | 30/30; exit 0. |
| Ops receipt contract | PASS | 173 assertions; exit 0. |
| Root test | PENDING | Canonical root suite pending. |
| Full matrix | PENDING | Canonical full suite pending. |
| Historical evidence | UNCHANGED | No historical Q receipt or acceptance evidence file is edited. |
| Gate posture | UNCHANGED | No skip, waiver, authority, private call, or money path is added. |
| External effects | NONE | No push, deployment, provider mutation, private exchange call, or secret use. |
