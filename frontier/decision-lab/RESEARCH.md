# F13 DecisionLab public research receipt

Public documentation was reviewed before implementation, as permitted by Frontier Section 10. No external package, code, dataset, model, or runtime dependency was installed or copied. Runtime tests remained network-off.

Initial research pass: `2026-07-15T20:16:00Z`

Current-page refresh: `2026-07-15T21:24:25Z`

The SHA-256 values below identify the raw HTTP response body retrieved at the current-page refresh. They are not publisher PDF hashes.

| Source | URL | Normalized retrieval SHA-256 | Terms/licensing note | Applied ruling |
|---|---|---|---|---|
| Khan, Saveski & Ugander, *Off-policy Evaluation Beyond Overlap* (PMLR 2024) | https://proceedings.mlr.press/v235/khan24b.html | `f3d14eec227b6e829b96c3a8217d1b646f151fd6f1b016ddcceee08ca5d98450` | Publisher page and paper cited; no paper text or assets embedded. Reuse remains under publisher/paper terms. | Missing overlap cannot be waved away; no value estimate is emitted. |
| Zhang & Bareinboim, *Causal Eligibility Traces for Confounding Robust OPE* (PMLR 2025) | https://proceedings.mlr.press/v286/zhang25d.html | `485bd74f8ee274d7669d0fc81ad22a674b62c5b0b193f921af781ea401eb0724` | Publisher page and paper cited; no paper text or assets embedded. | Confounding and no-overlap remain explicit warnings/unavailable states. |
| Li, Chu, Langford & Wang, *Unbiased Offline Evaluation of Contextual-bandit Algorithms* | https://arxiv.org/abs/1003.5956 | `1017ccee5f55481e4dc39aae8a3245bbb3a9312013a5df22d83323e9d9fd5c3b` | arXiv metadata page cited; paper-specific reuse license controls content. No content embedded. | Replay/OPE requires logged action/outcome support that one incomplete decision record does not provide. |
| Dudik, Langford & Li, *Doubly Robust Policy Evaluation and Learning* | https://arxiv.org/abs/1103.4601 | `226f5a041edbc1c58102e62d2aec9fd60dc1bbbb4ebbefcb96ece20c3dc792b1` | arXiv metadata page cited; paper-specific reuse license controls content. | No DR estimate without an adequate reward or logging-policy model. |
| Wang, Agarwal & Dudik, *Optimal and Adaptive Off-policy Evaluation in Contextual Bandits* (PMLR 2017) | https://proceedings.mlr.press/v70/wang17a.html | `2b78252516def8be2f94759fc1715818b1979f28ec37684610b995d2a9eb67ee` | Publisher page cited; no paper text or assets embedded. | IPS/DR/SWITCH are not substitutes for absent owner payloads, support, or propensities. |
| OSF Registrations and Preregistrations guidance | https://help.osf.io/article/330-welcome-to-registrations | `54323aecf386e6255bb733a38bb04df7b7b0bcaa2f8aac9b01542bc779a5e73b` | OSF support documentation cited; no content embedded. | Alternative grammar is frozen before fixture outcomes, while clearly labeled non-authoritative for real history. |
| scikit-learn Common Pitfalls | https://scikit-learn.org/stable/common_pitfalls.html | `a72acc13a7fc7f6b556a80836084b3ef065f29db34511f4981419d17daf88f4e` | Project documentation cited; no source or documentation copied into the module. | Outcome/test information is prohibited from decision-time feature construction; preprocessing leakage fails closed. |

## Implementation conclusion

The research supports a narrower module than a generic counterfactual estimator: immutable point-in-time references, explicit support/propensity missingness, descriptive same-path/same-cost comparisons only, no optimization, and no causal claim. Because accepted owner artifacts do not supply the necessary policies and recorded outcomes, the only honest result is `UNAVAILABLE` plus the exact blocker.
