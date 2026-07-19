# Q11 survival campaign evidence (synthetic only)

- Seed: `20260712`
- Golden fixture SHA-256: `b3041042e63b98d4d70367b13cff4f04abe82c1169f8fb066b6d6c8088aef99b`
- Train/test: 240/240 subjects over 4 strata, 12 one-minute bins

No survival model, curve or hazard is claimed to be predictive, calibrated
on market data or economically valuable; these are machinery measurements
on cohorts drawn from a known synthetic hazard law.

| Measurement | Value |
| --- | ---: |
| KM max abs recovery gap | 0.032099 |
| Integrated Brier (model, any cause) | 0.146189 |
| Integrated Brier (marginal, any cause) | 0.207712 |
| Concordance (model risk scores) | 0.767056 |
| ECE at grid end (model, any cause) | 0.028710 |
| Quantized AJ conservation defect (ulps) | 1 |
| Budget verdict | PASS |
