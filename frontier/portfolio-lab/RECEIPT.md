# F2 PortfolioLab terminal receipt

## Seal identity

```text
programOrgan: F2 PortfolioLab
branch: f-lab-0715f
immutableBaseSha: f0168cb37bd04d21bc90591ab2256770de3b75bc
prestageParentHeadSha: e0ace68de5d56bdfe51bb30cf74e44c6f109dfd5
implementationCodeCommitSha: 5684abe4c612cd29b0914afededc9bd4b3d533db
implementationSourceSha: 5cac88062c701800a08c602bd191ce796a175421
dockContractCommitSha: e0ace68de5d56bdfe51bb30cf74e44c6f109dfd5
directiveSha256: 4bb325b23c70e56103ee1553f0ea4396774ce0950d7abc9c73faa01f7006e1ad
buildState: PRESTAGE_READY
disposition: ACTIVE
terminalLabel: PORTFOLIO_LAB_PRESTAGE_READY
terminalTags: ADVISORY_ONLY, NO_CAPITAL_AUTHORITY, NO_RISK_AUTHORITY
authorityClass: NO_AUTHORITY
```

`prestageParentHeadSha` is the exact clean branch HEAD verified before the first module write and is also the required accepted F0 Dock commit. `implementationSourceSha` is the exact pre-seal source commit referenced by the extension descriptor. The final seal commit contains this receipt and is resolved and reported externally after commit because a commit cannot embed its own hash.

## Ancestry and directive gate

- Worktree: `/Users/cosmosgeek/Desktop/f-lab`
- Required branch: `f-lab-0715f` — `PASS`
- Starting HEAD: `e0ace68de5d56bdfe51bb30cf74e44c6f109dfd5` — `PASS`
- Dock commit is an ancestor of both implementation commits — `PASS`
- Implementation source commit `5cac88062c701800a08c602bd191ce796a175421` descends from code commit `5684abe4c612cd29b0914afededc9bd4b3d533db` — `PASS`
- Initial inventory: clean; no tracked or untracked module work existed.
- Directive path: `frontier/directives/Frontier.md`
- Directive SHA-256: `4bb325b23c70e56103ee1553f0ea4396774ce0950d7abc9c73faa01f7006e1ad` — `PASS`
- Directive read completely; execution limited to Sections 0-2, 5, and 10-12.
- Dock file pins and required binding hashes match commit `e0ace68de5d56bdfe51bb30cf74e44c6f109dfd5`.

Required Dock bindings:

| Facet | Operation | Binding hash | Result |
|---|---|---|---|
| `ADVISORY_ASSESSOR` | `EVALUATE_FIXTURE` | `bd4fe6b1d4354729b0caa856e05e661e3f956b5574b8be68401336b18be0eefa` | `USABLE` |
| `SCENARIO_REFERENCE` | `VALIDATE_FIXTURE` | `35f74a00293a869adcb3cbb7dfa884d40cbd33afdf82b2ed4590cda048d28d19` | `USABLE` |
| `COCKPIT_PROJECTION` | `PROJECT_FIXTURE` | `588e54eb6cafc8ca0114e3f11eac55801fc4b4957d1f6a32bfb797f9754ffa00` | `USABLE` |

## Existing-owner adjudication

Targeted searches at accepted Main `f0168cb37bd04d21bc90591ab2256770de3b75bc` found no accepted `PortfolioLab`, whole-portfolio counterfactual orchestrator, scenario matrix, or equivalent comparative drill-down implementation. At Dock commit `e0ace68de5d56bdfe51bb30cf74e44c6f109dfd5`, only the F2 module and facet reservation exists. The following exact owner contracts were reused rather than duplicated:

- Capital: `f0168cb37bd04d21bc90591ab2256770de3b75bc:server/src/capitalFoundation/budgets/types.ts#PortfolioBudgetSnapshot`
- Risk: `f0168cb37bd04d21bc90591ab2256770de3b75bc:server/src/foundation/contracts/risk.ts#RiskVerdict`
- Q: `02b4eccc8d2ef53b830cafae06e5175715fa6ebb:quant/src/quant_edge/validation/stress.py#CostStressReportV1`
- L twin: `df6b472993ca9659ce09cf5f72004981c6835f0d:server/src/liveEdge/adapters/exchangeTwin/types.ts#TwinScenarioState`
- L recovery: `df6b472993ca9659ce09cf5f72004981c6835f0d:server/src/liveEdge/adapters/exposureRecoveryProjection/types.ts#L12SupervisorSnapshot`

Each object exists at its named commit. Instance evidence remains a hash-bound, unaccepted synthetic fixture stub; a contract or type reference is never represented as an accepted output instance.

## Research gate

Current primary-source research was completed before implementation and is recorded in `research/RESEARCH_RECEIPT.md`, including URL, UTC access time, retrieved-content SHA-256, and terms or licensing posture. Sources were BIS stress and scenario analysis guidance, Bank of England system-wide and bank stress methodology, and Federal Reserve model-risk guidance. No retrieved page content is a runtime dependency or proof of an adapter.

## Module-local verification

Environment: Node `v22.23.1`. No dependency installation, browser run, product import, real transport, or credential was used.

Command:

```sh
node --test frontier/portfolio-lab/tests/*.test.mjs
```

Result: exit `0`; 67 tests, 67 passed, 0 failed, 0 skipped, 0 cancelled.

Proof includes:

- exact-decimal bounds, overflow denial, known-zero distinction, and unknown propagation;
- immutable snapshot, scenario, owner-output, seed, unit, time, and hash bindings;
- finite owner-claim allowlists derived exactly from 5 snapshot and 27 scenario claims;
- exactly 20 ordered Section 5 cases with 19 comparative evaluations and one `ABSTAIN_UNKNOWN`;
- archived-fixture bootstrap and deterministic seeded finite-table simulation without historical-evidence laundering;
- non-causal concentration and relationship maps, output bounds, and absent-edge-is-unknown semantics;
- full nested report, matrix, draw, view, preview, authority, and self-rehash forgery rejection;
- actual fixture-wrapped Dock requests with class, operation, provider, authority, network, and effect denial;
- deterministic static preview regeneration with 20 complete drill-down records and no controls;
- exact schema and runtime parity, including typed liquidation-distance and margin-headroom facts;
- exact resource and backpressure behavior against the executed 20-case workload.

Additional seal checks:

- every module JSON file parses;
- all 360 local portable-schema reference occurrences resolve across 78 definitions;
- all 43 object definitions are closed;
- `shasum -a 256 -c frontier/portfolio-lab/CONTRACT_HASHES.sha256` passes for 14 artifacts;
- all runtime ESM files pass syntax and import checks;
- static imports stay inside `frontier/portfolio-lab/src/**` and read-only `frontier/dock/src/**`;
- Git whitespace check passes;
- the committed path set is restricted to `frontier/portfolio-lab/**`.

No full-repository, I00, browser ship, system-integration, replay-soak, deployment, mount, merge, rebase, or push battery was run.

## Acceptance and resource identities

- Snapshot hash: `df24c9b456a2061473daca71f0f152da618eeadddf8f73bf102593cd13ab78a1`
- Snapshot owner-claim hash: `86e23b2d2d1a47466fde56d0b5f0d67bafaaa9d44f049c4d2d805bdeae5619e3`
- Owner-evidence hash: `cdad6dd37b19304e0c6876cd8f5813bac7feac1b79d2a622aa5738d69fa89984`
- Archived-fixture payload hash: `5eaccc3618c2e3cc8883c1ebd80c5154f9dff7e0d706faa7e988126a58323f6e`
- Campaign hash: `2cded910cbd41863544d6324c531d1a5a73bf79db9bdc1f7c4b71799561ddb95`
- Campaign report hash: `ec316dd759c811777c2cc91cfc9b3fd38dd51292ebbb91ebbe341aaa22604c91`
- Cockpit projection hash: `3adbcad485c5eb998f4f43f3311b335d5facf2b5abc79cec5abdffe88adb0654`
- Workload hash: `996fa4a8a879711edd9239f15104066fb0031630c1938efee7727035a045aeee`
- Workload receipt hash: `297893bd080652663d1d4e8d9c266e21bb856fa77527a01b17534cceff52a7a8`
- Canonical serialized bytes: snapshot `6,101`; campaign `102,357`; report `513,089`.
- At limit: 20 offered, 20 accepted, 0 rejected; deterministic p50, p95, and p99 are all 1 step.
- Beyond limit: 21 offered, 0 accepted, 21 rejected; `DEGRADATION_REQUESTED` for `EVENT_RATE`; no silent loss, canonical state, or authority grant.
- Host CPU, memory, disk, and production performance remain explicitly unmeasured and unproved.

## Adversarial correction record

Independent read-only review found and the implementation corrected: invalid owner symbols; contract-reference and instance-reference conflation; unbound owner provenance; finite-claim derivation gaps; empty-impact false zero; aggregate overflow; incomplete-snapshot false evaluation; unsupported absolute output; seed and unit drift; sparse archived-fixture input; invented historical relabeling; unaccepted F12 ambiguity; forged nested reports and projections; shallow Dock request maps; missing Section 5 views and drill-down; false fixture time; unbounded graph and report output; portable-schema drift; a resource proof not tied to executed work; and a missing future F12 provider-artifact round-trip proof. Focused tests were rerun after correction.

## Honest boundary and insertion blockers

This receipt proves only isolated deterministic fixture compatibility. It does not prove canonical owner acceptance, observed historical evidence, accepted F12 definitions, a canonical portfolio advisory output, mounting, production isolation, host performance, runtime safety, product integration, live sizing, Capital or Risk approval, execution, edge, or profit.

Future canonical insertion is explicitly blocked on:

- `SCENARIO_REFERENCE:ACCEPTED_F12_SCENARIO_ARTIFACT_NOT_AVAILABLE`
- `ADVISORY_ASSESSOR:ACCEPTED_OWNER_FIELD_ADAPTERS_NOT_AVAILABLE`
- `ADVISORY_ASSESSOR:PORTFOLIO_LEVEL_CANONICAL_OUTPUT_ADAPTER_DECISION_REQUIRED`
- `ADVISORY_ASSESSOR:ACCEPTED_HISTORICAL_OWNER_OUTPUT_TABLE_NOT_AVAILABLE`
- `COCKPIT_PROJECTION:PORTFOLIO_LAB_SURFACE_ID_AND_MOUNT_DECISION_REQUIRED`

All shared-system and lifecycle decisions remain future canonical-owner work through `INSERTION.md`.
