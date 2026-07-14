# S4 assurance-case research basis

Research checked: **2026-07-14**. This is packet-local design evidence, not a new standard, runtime owner, or acceptance authority.

## Primary sources used

| Source | Current identity checked | S4 design consequence |
| --- | --- | --- |
| Object Management Group, Structured Assurance Case Metamodel | SACM 2.3, latest formal version, adopted October 2023: <https://www.omg.org/spec/SACM> | Keep explicit claims, assumptions, evidence references, inference edges, and assertion states. Preserve artifact identity, revision, date, and revocation/change context. SACM `asserted` is not treated as this packet's `PASS`. |
| NIST SP 800-160 Vol. 1 Rev. 1, *Engineering Trustworthy Secure Systems* | Official NIST publication: <https://doi.org/10.6028/NIST.SP.800-160v1r1> | A reasoned assurance case needs explicit claims, arguments, evidence, and assumptions. Evidence quality includes accuracy, credibility, relevance, rigor, and quantity; insufficient support remains negative or unknown, not green. |
| NASA-STD-8739.8B, *Software Assurance and Software Safety Standard* | Active NASA standard, approved 2022-09-08: <https://standards.nasa.gov/standard/nasa/nasa-std-87398> | Producer/verifier inequality is necessary but insufficient. Technical, managerial, and financial independence motivate explicit actors, owners, failure domains, and common-mode checks. |
| NASA/SP-20250002210, Safety Management System Framework implementation guidance | Version 1.0, March 2025: <https://ntrs.nasa.gov/citations/20250002210> | Separate provider, acquirer, independent reviewer, and decision-maker roles. Changed conditions can invalidate prior support; the case informs an existing decision owner and does not grant authority itself. |
| UK National Protective Security Authority, CAE guidance | Current NPSA catalog; CAE concepts and connection rules: <https://www.npsa.gov.uk/security-best-practices/assurance> | Treat required support as conjunctive. Keep atomic propositions, explicit assumptions, visible unsupported paths, and dependency drill-down so a graphical view cannot hide material edges. |
| UK Health and Safety Executive, control-system independence guidance | Official HSE guidance: <https://www.hse.gov.uk/comah/sragtech/techmeascontsyst.htm> | Common-mode review must not stop at actor names. Shared personnel/organization, environment, utilities, technology, code, telemetry, network, store, clock, credential, or model dependencies can defeat independence. |
| UK HSE offshore safety-case review guidance | Official current guidance: <https://www.hse.gov.uk/offshore/omar/guidance.htm> | Assurance remains valid only while it reflects current reality and knowledge. Periodic and change-triggered review supports explicit expiry and immediate ineligibility of stale support. |

## Packet-specific interpretation

- `PASS`, `FAIL`, and `UNKNOWN` are packet-local evaluation results. They are not SACM assertion declarations and never imply runtime health or permission.
- Every mandatory dependency is required (`ALL`). Known contradiction is `FAIL`; missing, expired, stale, structurally untrusted, or non-independent support is `UNKNOWN`.
- Explicit evidence expiry is exclusive: support is ineligible at `nowMs === expiresAtMs`. Maximum age remains valid at equality and expires one millisecond later, matching accepted S1.
- An invalid leaf is propagated through the complete reverse claim path. The prior green is immediately unusable for a new action. The closed packet contract pins a 1,000 ms projection SLO and 5,000 ms assurance SLO so a rendered result cannot rewrite its own deadline; neither SLO grants halt or command authority.
- Evidence producer and verifier actors must differ. Positive capital-critical evidence also requires declared independence basis, no shared typed failure-domain identity, and no declared common-mode dependency. Independence weakness cannot erase known adverse evidence.
- The graph consumes accepted S1 assumption-result projections by stable ID and exact accepted provenance. It never writes S1, adds reverse links to S1, or creates another assumption registry.
- I08 remains the sole runtime supervisor projection. S4 returns render-neutral, `SYNTHETIC_ONLY`, `authorityEffect=NONE` packet evidence and recommendations to existing owners only.
