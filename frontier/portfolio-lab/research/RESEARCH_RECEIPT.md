# PortfolioLab research receipt

Accessed at `2026-07-15T19:49:57Z`. Only official primary sources were used before implementation. The downloaded pages were inspected as research inputs; no source text, model, dataset, or executable content is redistributed by this module.

| Authority | Current source | Retrieved SHA-256 | Design consequence |
|---|---|---:|---|
| Basel Committee / BIS | [RMA30 Risk management and model risk, consolidated framework, published 2026-02-26](https://www.bis.org/basel_consolidated_guidelines/chapter/RMA/30.htm) | `791a7373cc6ded4c7360ea8f98024933371e1f09a7500d67054fffac50787f86` | Preserve model/input limitations, uncertainty, independent challenge, and governance boundaries; simulation volume cannot manufacture validity. |
| Bank of England | [System-wide exploratory scenario exercise, updated 2026-06-23](https://www.bankofengland.co.uk/financial-stability/boe-system-wide-exploratory-scenario-exercise) | `3b8a9e257ed118c6f688cac9668c4377a73b3cd190c08aaf90a1568331a40c85` | Use linked whole-system stresses and explicit cross-entity interactions instead of isolated single-risk decoration. |
| Bank of England | [Approach to stress testing the UK banking system from 2025 onwards](https://www.bankofengland.co.uk/stress-testing/2024/boes-approach-to-stress-testing-the-uk-banking-system) | `811ebd7af184f3276ee9501e78381f0617343bcbbead653fab45f58b6afc9ce8` | Record objective, horizon, severity, assumptions, and scenario limitations; treat results as decision support, not deterministic forecasts. |
| Federal Reserve / OCC / FDIC | [Supervisory Guidance on Model Risk Management, SR 26-2 / FRRS, issued 2026-04-17](https://www.federalreserve.gov/frrs/guidance/supervisory-guidance-on-model-risk-management.htm) | `e8f13ded607d4c31187b3edafbc2a6d4ef958f441f542fdd684249262aa3bdf1` | Make purpose, inputs, assumptions, limitations, validation, and use constraints explicit; fail closed on missing or unfit inputs. |

## Applied controls

- Every materialized scenario records origin, seed, reproducibility inputs, event-time horizon, liquidity/fill assumptions, exclusions, missing dependencies, uncertainty, output mode, and why it cannot support live sizing.
- Unknown and unavailable inputs never become zero. Missing case 20 produces `ABSTAIN_UNKNOWN` and preserves its known subtotal separately.
- Correlation and relationship rows are declared scenario inputs, `causal: false`; an absent edge never means independence.
- Historical/bootstrap and seeded simulation modes sample only the finite caller-supplied table. Draw count never upgrades origin, uncertainty, or evidence quality.
- All outputs are fixture-only, shadow-only advisory or synthetic read-only projection. They have no Capital, Risk, execution, health, mount, or mutation authority.

## Terms and licensing posture

The links above are citations to publicly accessible official guidance. This packet stores only titles, URLs, retrieval hashes, and original implementation conclusions. Any future retained external dataset, scenario series, or redistribution requires a separate source-card and canonical owner licensing decision.
