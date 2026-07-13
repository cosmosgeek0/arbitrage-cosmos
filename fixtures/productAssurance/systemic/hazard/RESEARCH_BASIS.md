# S1 research basis

Checked: **2026-07-13**

Authority boundary: these sources are informative design checks only. The binding requirements remain `IP_ASSURANCE.md` §7, accepted amendment §2, the systemic dedup matrix, I00, and the repository authority map.

| Primary source | Current check used | Packet-local design consequence |
| --- | --- | --- |
| MIT Partnership for Systems Approaches to Safety and Security, [STPA Handbook (MIT-STAMP-001)](https://psas.scripts.mit.edu/home/books-and-handbooks/) | The official handbook remains the detailed/up-to-date STPA guide and centers control structures, unsafe control actions, loss scenarios, and derived constraints | Hazard records preserve controller, controlled process, control/feedback paths, one of four unsafe-action kinds, triggering context, causal scenario, and safety constraint |
| NIST, [SP 800-160 Vol. 1 Rev. 1](https://csrc.nist.gov/pubs/sp/800/160/v1/r1/final) | Current final trustworthy-systems engineering publication emphasizes assurance, validation, verification, traceability, and system-life-cycle evidence | Assumptions bind sources/evidence, validation method/version, time bounds, dependents, reasoned result, owner consequence, and residual risk |
| NASA Office of Safety and Mission Assurance, [System Safety](https://sma.nasa.gov/sma-disciplines/system-safety) | Current NASA guidance treats safety holistically across interacting system parts and lists the 2025 objectives-driven, risk-informed, case-assured framework | The Atlas checker starts from a finite expected release denominator and preserves uncertainty instead of treating observed reporters as the universe |
| NASA Office of Safety and Mission Assurance, [Software Engineering and Software Assurance Electronic Handbook announcement](https://sma.nasa.gov/news/articles/newsitem/2026/05/18/the-nasa-software-engineering-and-software-assurance-electronic-handbook---a-unified-ai-ready-resource-for-engineering-assurance-iv-v-and-milestone-governance) | NASA identifies the electronic handbook as its integrated source for requirements, rationale, guidance, assurance activities, and objective evidence | DRAFT rows keep requirement, owner, evidence, test, expected behavior, and authority effect traceable end to end |

No fixture or test performs network access. No vendor interface fact, external capability, or live proof is encoded as packet truth.
