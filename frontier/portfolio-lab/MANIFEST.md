# F2 PortfolioLab manifest

## Identity

- Program organ: `F2 PortfolioLab`
- Extension version: `0.1.0`
- Branch: `f-lab-0715f`
- Immutable accepted Main base: `f0168cb37bd04d21bc90591ab2256770de3b75bc`
- Clean pre-write HEAD and required Dock contract commit: `e0ace68de5d56bdfe51bb30cf74e44c6f109dfd5`
- Implementation source SHA: `5cac88062c701800a08c602bd191ce796a175421`
- Directive SHA-256: `4bb325b23c70e56103ee1553f0ea4396774ce0950d7abc9c73faa01f7006e1ad`
- Terminal authority tags: `ADVISORY_ONLY`, `NO_CAPITAL_AUTHORITY`, `NO_RISK_AUTHORITY`
- Authority class: `NO_AUTHORITY`
- Runtime network: `FIXTURE_ONLY`
- Secrets: `NONE`

PortfolioLab is a removable, deterministic whole-portfolio counterfactual and stress organ. It consumes hash-bound caller-supplied fixture evidence, orchestrates comparative scenarios, and produces shadow-only reports. It does not recalculate canonical Q, Capital, Risk, L, health, execution, or recovery truth.

The final seal commit contains this manifest and is resolved externally with Git after commit; a commit cannot truthfully embed its own SHA.

## Owner and dedup disposition

The accepted source contains canonical owners for Capital snapshots, Risk verdicts, Q stress evidence, L exchange-twin state, and L recovery projections. No accepted owner implements the Section 5 whole-portfolio scenario orchestrator, comparative report, scenario matrix, or drill-down projection. The missing delta is therefore implemented with `disposition: ACTIVE`; no competing owner calculator, store, registry, transport, or product mount was created.

All five owner-output instances in `fixtures/owner-output-evidence.v1.json` are explicitly `UNACCEPTED_SYNTHETIC_OWNER_OUTPUT_STUBS`. Their accepted Git references identify contract lineage only. All local `f12.*` scenario records are explicitly `UNACCEPTED_SYNTHETIC_F12_REFERENCE_STUB`; they are not accepted F12 definitions.

## Module artifacts

- `contracts/v1/dock-pin.v1.json`: exact Dock commit, file hashes, and three required facet bindings.
- `contracts/v1/portfolio-lab-v1.schema.json`: closed portable input, report, graph, view, preview, and facet-request records.
- `contracts/v1/*.adapter-map.v1.json`: identity-only fixture maps for advisory, scenario-reference, and cockpit facets.
- `contracts/v1/extension-descriptor.v1.json`: Dock-valid extension descriptor with explicit resource, source, and limitation declarations.
- `src/contracts.mjs` and `src/exact.mjs`: bounded exact-decimal snapshots and scenario inputs with unknown propagation.
- `src/analysis.mjs`: non-causal relationship graph and concentration maps with fixed output bounds.
- `src/campaign.mjs`: declared-grid, archived-fixture bootstrap, and seeded finite-table campaigns; exact comparative reports and views.
- `src/dock.mjs`: fixture-wrapped request factories and read-only Dock routing.
- `src/preview.mjs`: unmounted, control-free, drill-down cockpit projection.
- `src/resources.mjs`: deterministic resource proof bound to the actual ordered 20-case workload.
- `fixtures/acceptance-corpus.v1.json`: the exact twenty Section 5 scenarios in directive order.
- `fixtures/historical-bootstrap-source.v1.json`: an archived fixture table explicitly classified `NOT_OBSERVED_HISTORY`.
- `preview/portfolio-lab.v1.json`: deterministic static projection with 20 matrix rows and 20 full drill-down records.
- `CONTRACT_HASHES.sha256`: SHA-256 inventory for 14 frozen contract, fixture, and preview artifacts.
- `tests/*.test.mjs`: module-local deterministic, hostile, boundary, packet, Dock, and resource tests.
- `research/RESEARCH_RECEIPT.md`: separately receipted current official-source research.
- `INSERTION.md`: future shared-seam request only; it implements no shared change.

## Deterministic proof entry point

```sh
node --test frontier/portfolio-lab/tests/*.test.mjs
```

The network-free, module-local proof passes 67 of 67 tests. It covers exact arithmetic; unknown and abstention behavior; immutable provenance; owner-claim derivation; the ordered 20-case corpus; archived-fixture source gating; seeded finite-table replay; graph and report bounds; nested forgery rejection; portable-schema parity; Dock boundaries; static preview regeneration; 14 artifact hashes; and deterministic backpressure.

## Honest boundary

This packet proves deterministic fixture compatibility and an isolated preview only. It does not prove canonical owner acceptance, observed historical evidence, accepted F12 definitions, a canonical portfolio advisory output, mounting, production isolation, host performance, runtime safety, product composition, portfolio sizing, Capital or Risk approval, external transport, execution, edge, or profit. Future canonical owners must resolve the exact blockers in `INSERTION.md` before any mount or shared change.
