# F8 EdgeMeter research receipt

## Scope and timing

- Research began before module implementation on `2026-07-15T19:55:07Z`.
- Current-source refresh completed on `2026-07-15T20:24:18Z`.
- Scope: forward-only evaluation, point-in-time evidence, selection-bias controls, execution/timing attribution, portable contracts, and the dependency-free focused test harness.
- No source code, formulas, fixtures, or prose were copied from an external source. External material was used only to select conservative contract boundaries.

## Sources consulted

| Source | Accessed | Exact retrieval evidence | Design consequence |
|---|---:|---|---|
| [scikit-learn `TimeSeriesSplit`](https://scikit-learn.org/stable/modules/generated/sklearn.model_selection.TimeSeriesSplit.html) | 2026-07-15 | HTTP body SHA-256 `b71849dcef41ce8bf7964f958c0bb572e9b4cde77e20f9786034e19fafa58096`, 138,511 bytes | A temporal gap is part of evaluation validity. EdgeMeter therefore accepts Q's partition/embargo proof by immutable reference and marks historical-fit or unproven temporal evidence non-comparable; it does not split data itself. |
| [Feast point-in-time joins](https://docs.feast.dev/getting-started/concepts/point-in-time-joins) | 2026-07-15 | HTTP body SHA-256 `eec9f20091c806628bacecbbc64e4fd43e4542bb8abb5963c8edcf081eb50506`, 815,882 bytes | Point-in-time correctness depends on event time and availability. Owner references carry both times; a pre-decision reference arriving after the information cutoff fails comparability. |
| [Bailey and Lopez de Prado, Deflated Sharpe Ratio](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=2460551) | 2026-07-15 | SSRN abstract page read successfully; direct HTTP retrieval returned 403, so no local byte hash is claimed | Multiple testing and non-normal returns can inflate performance evidence. EdgeMeter projects Q's multiplicity, selection-pressure, and DSR evidence by exact reference and display value only; it never recomputes or promotes them. |
| [SEC request for comment on mutual-fund transaction costs](https://www.sec.gov/rules-regulations/2003/12/request-comments-measures-improve-disclosure-mutual-fund-transaction-costs) | 2026-07-15 | SEC page read successfully through public web access; direct HTTP retrieval returned 403, so no local byte hash is claimed | Implementation shortfall compares intended/benchmark trading with actual execution and can include unexecuted intent, but the SEC discussion also notes calculation-method ambiguity. EdgeMeter therefore keeps a separately labeled, non-accounting gross timing bridge and forbids a locally invented monetary reject effect. |
| [JSON Schema Draft 2020-12](https://json-schema.org/draft/2020-12) | 2026-07-15 | HTTP body SHA-256 `93b2f0c234c30a35d4abfe9d5bafae03c767ea4c16a21681741d2cd2886805a3`, 88,618 bytes | The portable fixture schema declares Draft 2020-12 explicitly and uses closed object shapes for bounded contract exchange. Runtime cross-field rules remain enforced by the dependency-free parser. |
| [Node.js v22.23.1 test-runner documentation](https://nodejs.org/download/release/latest-v22.x/docs/api/test.html) | 2026-07-15 | HTTP body SHA-256 `1d3b2f46608915abf70add4f18758290c0d920c0b280033c372a4f5af14d5adf`, 355,176 bytes | The focused harness uses the stable built-in `node:test` runner and serial test-file concurrency, avoiding dependency hydration and any repository-wide battery. |

## Applied boundary

The research supports a conservative adapter, not a new owner. Capital retains the accounting taxonomy, exact net, and residual. Q retains forward partitions, embargo, point-in-time joins, calibration, abstention, uncertainty, multiplicity, and deflated-performance computation. F8 validates immutable reference shape and time semantics, projects owner-supplied values, preserves unknowns, and emits no monetary aggregate across breakdowns.

## License and terms posture

- scikit-learn documentation is associated with the BSD-3-Clause project; Feast is associated with the Apache-2.0 project.
- The papers, SEC material, JSON Schema site, and Node.js documentation were citation-only references.
- No external implementation or dataset is distributed in this module, so there is no third-party runtime dependency or copied-code license obligation introduced by F8.
