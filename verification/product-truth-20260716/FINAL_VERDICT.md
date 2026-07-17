# Candidate Verdict — Defect Wave 3 C4

Status: `REJECTED_LOCAL_GATE`

Candidate: `4c9143a0bcc331aa170e9e26b741240b39df8b9e`

Direct parent: `dea2d2a5c2b5e83d3aea75b0e368f0a478596561` (`1/1`, exact equality)

Custody: `WITHHELD_C4_LOCAL_GATE_REJECTED`

The six VFINAL3 findings are corrected in C4 source or its bounded evidence descendant. Focused typecheck, build, Product Integration `111/111`, Product Control `101/101`, I00 commands `29/29`, topology, census, lock-byte, and 61/61 coverage checks pass.

The required canonical and literal local single-branch batteries are not green. In both contexts, `npm test` and `npm run test:all` exit 1 because the exact-HEAD and sole-branch report-parity tests reject stale `integration/reports/i00-proof-evidence.json` bytes. The acceptance-contract result is `42/44`; the recorded artifact SHA-256 is `8c45974c2b27f1c92fb7bb53b2a50f3146233614015b218105374863dff7a9b7`, while deterministic regeneration yields `8968726acf2edd47326da3c61b9ba983ac74d28c4d92fda5cb82018b5f3f71f8`.

C4 remains immutable. No custody token is issued, and no evidence-only child may repair this source artifact. Any correction must be C5.
