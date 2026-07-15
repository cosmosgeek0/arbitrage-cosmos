# F8 EdgeMeter terminal receipt

## Seal identity

```text
programOrgan: F8 EdgeMeter
branch: f-edge-0715f
immutableBaseSha: f0168cb37bd04d21bc90591ab2256770de3b75bc
prestageStartHead: e0ace68de5d56bdfe51bb30cf74e44c6f109dfd5
dockContractSha: e0ace68de5d56bdfe51bb30cf74e44c6f109dfd5
directiveSha256: 4bb325b23c70e56103ee1553f0ea4396774ce0950d7abc9c73faa01f7006e1ad
buildState: PRESTAGE_READY
disposition: ACTIVE
terminalLabel: EDGE_METER_PRESTAGE_READY
MEASUREMENT_ONLY: true
NO_PROFIT_CLAIM: true
```

The final sealed module commit is the commit containing this receipt. Its exact full SHA is resolved and reported after commit because a Git commit cannot embed its own hash.

## Pre-write Git and admission gate

- Worktree: `/Users/cosmosgeek/Desktop/f-edge`.
- Required branch: `f-edge-0715f`; verified.
- Starting `HEAD`: `e0ace68de5d56bdfe51bb30cf74e44c6f109dfd5`; verified.
- Starting inventory: clean; no tracked or untracked changes before F8 wrote its exclusive root.
- Ancestry: `git merge-base --is-ancestor e0ace68de5d56bdfe51bb30cf74e44c6f109dfd5 HEAD`; passed before writes and must pass again after seal.
- Accepted Main base recorded by Dock: `f0168cb37bd04d21bc90591ab2256770de3b75bc`.
- Inherited directive: `frontier/directives/Frontier.md`; byte SHA-256 `4bb325b23c70e56103ee1553f0ea4396774ce0950d7abc9c73faa01f7006e1ad`; exact match and complete read before implementation.
- Executed directive scope: shared Sections `0`–`2`, F8 Section `9B`, and shared Sections `10`–`12` only.
- Coordinator F8 scout release: commit `887221418345ad54d7b98881b359fab85a6188e6`; path `frontier/coordinator/scouts/F8.json`; byte SHA-256 `fca83dc3e3fe1b47ec3a10a5e27f5f8494e66f47da47b90301d0b3fd2ab18002`; embedded content hash `1adcc68de1a732217ec0de015c296f73910fc24c9e120840bcf28c5a3ef775e9`; decision `APPROVED_REAL_DELTA`.
- Owner search found strong partial owners but no equivalent complete F8 capability. The exact disposition is recorded in `contracts/v1/owner-reuse-map.v1.json`; no private replacement for Capital, Q, Ledger, L, intelligenceFoundation, edge-protocol, or Product ownership was created.

## Research gate

Current primary sources were consulted and receipted before coding for temporal splitting, point-in-time joins, multiple-testing deflation, execution shortfall, JSON Schema 2020-12, and Node's test runner. Exact URLs, access times, lawful byte hashes where available, and design consequences are in `research/RESEARCH_RECEIPT.md`. No external code, formula, or dataset was copied into F8.

## Implemented local delta

- Closed immutable-reference contracts with exact owner classes, repository paths, Git commits, record revisions, content hashes, projection hashes, and event/availability timestamps.
- Deterministic binding between every available owner reference and the narrow sibling values projected from it.
- Forward-only comparability and post-horizon maturity checks; historical fit cannot become REAL evidence.
- Capital projection without local economic totals, policy, component-inclusion, or residual calculation.
- Q projection without split, calibration, abstention, uncertainty, multiplicity, DSR, or model-selection computation; accepted abstention enum and precedence are validated exactly.
- Separate gross timing identity anchored to Capital gross and accepted Q, L, and Ledger references; latency is never money.
- Explicit reference-only non-acted disposition with no monetary counterfactual.
- Full deterministic report revalidation, nested tamper rejection, identity-conflict handling, bounded batching, strict schemas, and inert Product-surface-shaped previews.

## Focused verification

Environment: Node `v22.23.1`; npm `10.9.8`. Runtime tests are network-free and use no dependency install.

Command:

```sh
node --test frontier/edge-meter/tests/edge-meter.test.mjs
```

Result at `2026-07-15T21:24:44Z`: exit `0`; `62` tests, `62` passed, `0` failed, `0` skipped, `0` cancelled.

The gate includes success and hostile proofs for immutable projection tampering, incorrect owner class/path/revision/hash/time, Q abstention precedence, point-in-time leakage, premature outcomes, partial Capital measures, unexplained residual, bridge/Capital mismatch, missing liabilities, non-acted monetary smuggling, duplicate identity conflict, report tampering and attacker rehashing, validly rehashed Dock facet forgeries, schema claim flips, resource overflow, and exact Product preview truth labels.

Additional local checks before commit:

- all module JSON artifacts parse;
- all source and test ESM files pass `node --check`;
- source byte hashes and aggregate source SHA match the descriptor;
- the extension descriptor validates through the inherited Dock reference implementation;
- saved reports/previews match deterministic generation;
- Git whitespace and forbidden-runtime scans pass;
- changed paths remain exclusively under `frontier/edge-meter/**`.

No full repository suite, `npm test`, `test:all`, I00, browser ship gate, integration battery, replay campaign, deployment check, shared mutation, transport, credential access, mount, merge, rebase, or push was performed.

## Independent adversarial closure

Independent read-only reviewers first found false-green risks in owner projection binding, report revalidation, Dock facet forgery, resource limits, Capital/Q gap handling, post-horizon evidence, gross-bridge anchoring, portable schemas, Product missing-data truth labels, and accepted Q abstention ordering. Each finding was corrected and covered by focused hostile tests. Final read-only re-audits reported no remaining P1/P2 runtime blocker and no remaining actionable schema blocker; the schema accepted all intended generated artifacts and rejected owner swaps, fabricated states/equations, wrong dimension sources, and missing data mislabeled as synthetic evidence.

## Sealed identities and resource envelope

- Source aggregate SHA-256: `110f185e34c2d5cabbde033de84a4d0464c399c9de2bca55f7079a9828cbcfc0`.
- Descriptor hash: `bdc6f1d0b448d5e63943a738a358861b042d4d9cf058d094334d737247a23f96`.
- Portable schema byte SHA-256: `a44a85ff56a225495814b25e754f0e18bc208718cb5ee94b80d0337d80a8ae58`.
- Complete REAL fixture byte SHA-256: `e35a1d0fcc8f959d43b1adde872c7462c544dd3e9269bc4f22e2092003cd4c0c`.
- Focused test byte SHA-256: `7e642c95cc685467a3c975b0b7ce9e9a8fb8eb1112e76d9f9fc88a79112dcb5d`.
- Research receipt byte SHA-256: `beab790ff0e6f8fb4648ce92e072fdcd1cf3709cb1543662a32837f69b093c10`.
- Attributable preview projection hash: `7a64dc60cb8dd556400d5d0c7c6d495466bdbedf54286afe26787ed951fc7f76`.
- Reference-only reject preview projection hash: `7d8412fac4fb806bd54328c4fca1c90f912dc93dd70118668b69379cc443dfc0`.
- Empty preview projection hash: `0a870670fccfca6fc3eb4cfa1d2c91703fd044426e5caaae3924cf839c01dc0c`.
- Maximum input batch: `32` records; report envelope: `1,048,576` bytes.
- Fixture event rate: `32` events per `1000 ms` fixture window; queue capacity `8`; zero network and model calls; production CPU, memory, disk, latency, and isolation remain unavailable.

## Future insertion and honest boundary

`INSERTION.md` requests only future owner-supplied read-only adapters for Capital economics/account truth, Q evidence, L fills/execution paths, Ledger outcomes, and a director-approved Product surface. It grants no mutation, authority, route, persistence, mount, or integration.

This receipt proves only a deterministic fixture prestage module. It does not prove production behavior, product integration, trading readiness, realized edge, profitability, canonical truth, or operational health.
