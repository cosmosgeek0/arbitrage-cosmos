# S-1W — lagged open-interest acceleration funding-carry verdict

S-1W freezes one Binance-public USD-M perpetual research family:

- a fixed pre-outcome 11-symbol cohort after BTCUSDT sample-access quarantine;
- fixed daily decisions independent of funding settlements;
- symbol selection from strictly lagged base-unit open-interest acceleration only;
- funding sign consulted only after cohort selection to choose the receive-funding side;
- equal allocation across selected legs, with unused capital held as cash;
- public cost stresses, exact net USD per original $1,000, synchronized uncertainty,
  multiplicity, PBO, drawdown, and a public capacity proxy if causal evidence is
  admissible.

The sole run terminated before opening any development or holdout outcome archive.
Current official Binance sources do not establish historical point-in-time publication
or availability for archive `metrics` rows or the funding sign used for side
assignment, and the public OI REST history exposes only the latest month. The result is
therefore `UNMEASURED`; economics remain null and the capital verdict is `NO_GO`.

This packet is public research only. It has no private API, order, transfer,
withdrawal, execution, capital, host, provider, deployment, or UI authority.

Before the freeze, bounded source inspection opened only BTCUSDT samples. The
June 2026 sample set comprised metrics, funding-rate, contract-kline, and mark-price
kline members; the July 2025 set included metrics, funding-rate, and book-depth
members; the January 2025 set included metrics, funding-rate, and 5-minute
mark-price-kline members. Ten unique archive members were opened, all quarantined.
`PRE_FREEZE_EXPOSURE.v1.json` quarantines BTCUSDT from the complete S-1W outcome
cohort. No accessed row is eligible for the run.

## Reproduce

Run from `quant/` with the locked Python 3.13 environment:

```text
python -m research.s1w.experiment inspect-sources
python -m research.s1w.experiment seal
python -m research.s1w.experiment run
python -m research.s1w.verifier
python -m pytest -q research/s1w/test_experiment.py research/s1w/test_verifier.py
```

`run` is create-once. If `generated/RUN_CONSUMED.v1.json` exists, the evaluator
refuses a second run. The verifier is network-free and opens no raw archive.
