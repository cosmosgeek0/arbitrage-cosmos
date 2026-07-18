# Q14 validation-factory campaign (SYNTHETIC evidence)

- Seed: `20260712`
- Golden fixture SHA-256: `539c95b264333208dfd37c96856be32bd130b41907560558a38bd323e53b20c9`
- Campaign JSON SHA-256: `a0522034a97c2676d4af31c7b22c10412ebb06a115df4de72f307081b23d9f87`
- Golden dataset digest: `701e256d7beb6161812ed2d5edba16069856c1ded12e996b987c7e758249724b`
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
- Plan digest: `061a147448835f17ed74dc1739db1866e74c94d80effe97e8d58e8cafa9b2bd6`
- Trial ledger digest: `a94e471fb93ddc6ef6d0a322a3d18fe4e24a52e36990d6eb1881fd3a257fd43d`
- Baseline leakage verdict: `ACCEPTED_FOR_COMPARISON`
- Challenger leakage verdict: `ACCEPTED_FOR_COMPARISON`
- Folds compared/skipped: 4/0
- Improved/worsened/tied folds: 4/0/0
- Holdout opened: True
- Report digest: `ae6db6e18609937127014699301fe4b0c8794363b6137d4736447428e64b8e94`
