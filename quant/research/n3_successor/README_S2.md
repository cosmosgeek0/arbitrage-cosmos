# N3-S2 accepted-only profitability convergence

N3-S2 is a deterministic overlay on accepted N3-S1 commit
`13631f3cc31020d8ca377d57e24ad6b75d89dba6`. It preserves the complete N3-S1
registry and consumes only orchestrator-accepted economic evidence after the
V-G31 receipt through the S-2I receipt, with complete accepted-ledger freshness
through the later DQ-14 source-only receipt. Rejections, duplicate stops, operational
rows, source-only controls, active task references, and unaccepted worker
terminal rows contribute no economics.

## Frozen state

- Accepted economic origins: 48.
- Deduplicated accepted-origin families: 47.
- Local verdicts: 24 `NO_GO`, 24 `UNMEASURED`.
- Accepted or verified credible positives: 0.
- Credible-positive count: `null`.
- Current profitability verdict: `UNKNOWN`.
- Owner $1,000 funding verdict: `NO`.
- Recommendation and capital authority: `NONE`.
- External effects and money: `NONE` / `$0`.

The twelve incremental origins are V-G28, V-G37, S-1Y, S-2C, S-1Z, V-G36,
S-2G, S-2H, V-G27, S-2A, S-2K, and S-2I. Each remains a distinct provisional post-SMETA1
family with effective
program-wide p-value 1. S-2M is a retired alias of V-G6 and adds no origin,
family, trial, or p-value. DQ-6 is exact-hash-bound source-only: its synthetic
known answer validates future economics semantics but is not profitability
evidence. DQ-8, DQ-9, DQ-11, DQ-4, and DQ-14 are likewise source-only: their
synthetic or prospective controls cannot authenticate profitability.
DQ-14 proves only deterministic consistency of a supplied source-access ledger;
it cannot detect facade bypass or authenticate a rebuilt ledger without an
independently held terminal tip/count, and it opened no archive or holdout.

S-2G remains `NO_GO`: its positive gross proxy cannot survive public costs,
its stress interval is entirely negative, multiplicity p-values are 1, stress
drawdown is 68.63%, no development qualifier or candidate exists, the holdout
is unopened, account-effective fees and synthetic-short borrow are unknown,
and executable capacity is unmeasured. S-2H remains `UNMEASURED`: its sole
screen falsely rejected nine checksum-valid resumed candidates, so the frozen
universe rank is uncertified; no development outcome was opened, all economics
remain null, and the holdout remains sealed. V-G27 and S-2A are both accepted
`NO_GO`; neither gross/diagnostic point can survive costs, intervals,
multiplicity, sample, drawdown, or execution gates. S-2K is also accepted
`NO_GO`: gross, base, stress, and severe public-proxy nets are negative; its
base interval is entirely negative; Holm and White are approximately 0.999268;
base five-minute drawdown is 96.10%; public p05 capacity is only $1.14; the
holdout remains sealed; account-effective fees and borrow costs are unknown;
and executable capacity is unmeasured.
S-2I is accepted `NO_GO`: base/stress/severe public-proxy nets and its stress
interval are negative; absolute/excess Holm values are 1/.8338; White is
.2951; severe drawdown is $3,677.87; marked gross exceeds the $1,000 cap;
the holdout remains sealed; account-effective commission and the historical
cross-engine clock offset are unknown; and executable capacity is unmeasured.

## Pending state

Two profitability tasks remain active and unpublished: V-G10 and S-1T. No
profitability task is terminal-awaiting an orchestrator
disposition at this freeze.

Six truth gates remain pending: an accepted pre-outcome family alias registry,
the complete global attempt ledger, sanitized account-effective fees,
executable capacity and execution proof, complete marked-equity paths, and one
fresh holdout receipt only if a winner emerges.

## Files and proof

- `origin_spec.v2.json`: strict accepted-boundary, origin, source-only, and
  pending-input adapter.
- `registry_tool_v2.py`: offline deterministic freeze and exact verifier.
- `current_profitability_registry.v2.json`: canonical machine registry.
- `owner_verdict_card.v2.md`: one-line bounded FABLE5 owner card.
- `test_registry_v2.py`: focused hostile mutation and determinism proof.

Run from the worktree root:

```sh
/usr/bin/python3 quant/research/n3_successor/registry_tool_v2.py verify \
  --registry quant/research/n3_successor/current_profitability_registry.v2.json \
  --card quant/research/n3_successor/owner_verdict_card.v2.md \
  --spec quant/research/n3_successor/origin_spec.v2.json \
  --run /Users/cosmosgeek/Desktop/run.md \
  --repo .

uv run --project quant --frozen pytest -q \
  quant/research/n3_successor/test_registry_v2.py
```

The tool has no network, clock, environment, host, provider, private API,
order, transfer, withdrawal, or money capability.

## Method references

- Binance public archive checksum and timestamp contract:
  <https://github.com/binance/binance-public-data>
- Binance Spot commission semantics:
  <https://developers.binance.com/docs/binance-spot-api-docs/faqs/commission_faq>
- Holm's sequentially rejective multiple-testing procedure:
  <https://doi.org/10.2307/4615733>
- CSCV / probability-of-backtest-overfitting diagnostic:
  <https://papers.ssrn.com/sol3/papers.cfm?abstract_id=2326253>
