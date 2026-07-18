# Q14 validation-factory campaign (SYNTHETIC evidence)

- Seed: `20260712`
- Golden fixture SHA-256: `26bb358d99473c371e2be513f6952047792994be46bbc266faeba99d58295aa5`
- Campaign JSON SHA-256: `cb873140f03eed45c06cc0f05aa1472f6dbd0c7deb7b97e50a37cd765cb023b2`
- Golden dataset digest: `cd3b2e72e7070153ddd7a71499bc1089b9291b76a10c33f3dd10090d419cbcd2`
- Leaked model (true lineage): `REJECTED_TEMPORAL_LEAK`
- Leaked model (falsified lineage): `REJECTED_IMPLAUSIBLE_SKILL`
- Honest baseline: `ACCEPTED_FOR_COMPARISON`
- Rejection battery: 8/8 temporal, 8/8 behavioral, 8/8 honest baselines accepted
- Comparison verdict (challenger vs baseline): `IMPROVES`
- Stress flips to non-actionable: fee/slippage 62, latency 62 of 62 base-actionable
- PBO: `AVAILABLE`
- DSR: `AVAILABLE`

No claim of real-market validity is made; every input is a seeded synthetic
fixture proving only that the falsification machinery works.

## Golden comparison report

# Q14 comparison report

- Baseline: `random-baseline`
- Challenger: `informative-challenger`
- Verdict: `IMPROVES`
- Plan digest: `a61e28326586c5e01ad26ddacd550fee4d0ed5d7f4c5ae5b8e062e8fd5d2fc3d`
- Trial ledger digest: `a94e471fb93ddc6ef6d0a322a3d18fe4e24a52e36990d6eb1881fd3a257fd43d`
- Baseline leakage verdict: `ACCEPTED_FOR_COMPARISON`
- Challenger leakage verdict: `ACCEPTED_FOR_COMPARISON`
- Folds compared/skipped: 4/0
- Improved/worsened/tied folds: 4/0/0
- Holdout opened: True
- Report digest: `63c6d0948d469a85c1066e544186e8bbe2acb3da72a4e33bed49aefced1e08ff`
