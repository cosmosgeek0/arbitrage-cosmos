# N3-S1 profitability convergence

This directory freezes one source-only profitability snapshot from canonical
commit `a169b123fb186d1943a75ad648552c4d95be1be1`. The inclusive economic-evidence
cutoff is the orchestrator's V-G26 acceptance receipt
`9cdbb8ee0e3cf40dbc9deef232a3ec7f4a29d8e32f658f0c331868c5bf21a718`.
Later acceptance receipts are named and excluded; their outcome artifacts are
not consumed.

## Frozen result

- Accepted economic origins: 36.
- Deduplicated accepted-origin family rollups: 35.
- Receipt-only origins: 3.
- Accepted credible positives observed: 0.
- Global credible-positive count: `null` because the family universe and
  material profitability inputs remain incomplete.
- Current profitability verdict: `UNKNOWN`.
- Owner $1,000 funding verdict: `NO`.
- Recommendation: `NONE`.
- Capital authority: `NONE`.

The seven S-META1 identities retain canonical F01-F07 order. E-1 and the Basis
successor collapse into F01. Every accepted post-SMETA1 origin has a distinct
provisional `POST_SMETA1::<origin>::<protocol-sha256>` identity and an effective
program-wide p-value of 1. No point estimate, PBO diagnostic, public fee
scenario, or public capacity proxy can create a verified positive.

## Exact pending state at freeze

The pending ledger is inclusive through the V-G31 acceptance receipt. Any
newer acceptance row is outside this immutable snapshot and is neither consumed
nor allowed to change its counts.

Five in-cutoff tasks remain active and unpublished:

- V-G1 `…cbbc`
- V-G10 `…99f9`
- V-G12 `…67aa`
- S-1T `…fea0`
- S-1V `…2058`

Ten active tasks are outside the V-G26 cutoff and excluded:

- S-1W `…d575`
- V-G27 `…d010`
- V-G28 `…d38a`
- V-G32 `…a0fe`
- V-G33 `…366e`
- V-G34 `…1c43`
- V-G35 `…d704`
- V-G36 `…c56f`
- V-G37 `…e9ad`
- V-G38 `…a07d`

Thirteen published acceptances occurred after the frozen cutoff and are
receipt-only exclusions: V-G14, V-G15, V-G24, V-G16, V-G18, V-G21, V-G22,
V-G29, S-1P, S-1U, V-G25, V-G30, and V-G31.

The six unresolved truth inputs are the accepted pre-outcome family alias
registry, complete global attempt ledger, sanitized account-effective fees,
executable capacity and execution proof, complete marked-equity paths, and a
single fresh holdout receipt only if a winner emerges.

## Files and proof

- `origin_spec.v1.json` is the strict origin, cutoff, and pending-input adapter.
- `registry_tool.py` freezes and verifies canonical JSON, live acceptance rows,
  exact Git objects, origin-spec bindings, family rollups, truth policy, and the
  one-line card.
- `current_profitability_registry.v1.json` is the deterministic machine
  registry.
- `owner_verdict_card.v1.md` is the terse FABLE5 owner card.
- `test_registry.py` exercises deterministic generation and hostile mutations.

From the repository root:

```sh
uv run --project quant --frozen python \
  quant/research/n3_successor/registry_tool.py freeze \
  --spec quant/research/n3_successor/origin_spec.v1.json \
  --run /Users/cosmosgeek/Desktop/run.md \
  --repo /Users/cosmosgeek/Desktop/cosmos-merge \
  --output-dir quant/research/n3_successor

uv run --project quant --frozen python \
  quant/research/n3_successor/registry_tool.py verify \
  --registry quant/research/n3_successor/current_profitability_registry.v1.json \
  --card quant/research/n3_successor/owner_verdict_card.v1.md \
  --spec quant/research/n3_successor/origin_spec.v1.json \
  --run /Users/cosmosgeek/Desktop/run.md \
  --repo /Users/cosmosgeek/Desktop/cosmos-merge

uv run --project quant --frozen pytest -q \
  quant/research/n3_successor/test_registry.py
```

The verifier makes no network, provider, private API, host, order, transfer,
withdrawal, or money call.

## Method references

- Binance Spot commission rates:
  <https://developers.binance.com/docs/binance-spot-api-docs/faqs/commission_faq>
- Binance public archive checksum and timestamp contract:
  <https://github.com/binance/binance-public-data>
- Holm's sequentially rejective multiple-testing procedure:
  <https://doi.org/10.2307/4615733>
- CSCV / probability-of-backtest-overfitting diagnostic:
  <https://papers.ssrn.com/sol3/papers.cfm?abstract_id=2326253>
