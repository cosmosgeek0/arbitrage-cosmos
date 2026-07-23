| item | expected | found | status |
|---|---|---|---|
| correction | Q10 vendor drift closed at publication boundary | fixed significant-digit boundary plus diagnostic probe | COMPLETE |
| failed lottery draw | same source can fail then pass | run suffix `2788`; source suffix `750e`; attempt 1 failed and attempt 2 passed | VERIFIED |
| neighboring green draws | green evidence retained | run suffixes `3975` and `6141`; source suffixes `3dfe` and `ac9f` | VERIFIED |
| Quant source identity | green and failed draws use identical Quant bytes | shared Quant tree suffix `4d4d`; no Quant path diff | VERIFIED |
| runner-vendor label | distinguish log fact from diagnosis | Intel is director-diagnosed; the failed log did not record a CPU model | QUALIFIED |
| observed metric field | exact semantic location | regression target; OLS model; MSE mantissa | IDENTIFIED |
| observed prediction field | exact semantic location | regression target; OLS model; prediction-vector digest | IDENTIFIED |
| observed numeric scale | characterize drift without publishing raw values | one adjacent-binary64-scale movement; about `9.37e-17` relative | RECORDED |
| probe candidate field | report metric publication | `/battery/reports/*/results/*/metrics/*/value/mantissa` | COVERED |
| probe candidate field | prediction-vector publication | `/battery/reports/*/results/*/predictionsSha256` | COVERED |
| probe candidate field | study-objective publication | `/battery/studies/*/trials/*/objective/mantissa` | COVERED |
| probe report | paths and semantic context only | numeric values and digest bodies omitted; unexpected drift exits nonzero | ENFORCED |
| precision policy | fixed significant digits before fixed-point and digest publication | `12` significant digits with `z.12g` | ENFORCED |
| precision rationale | preserve useful precision with binary64 headroom | observed pair agrees through 16 digits; 12 digits leaves conservative headroom | RECORDED |
| measurement rationale | publication disturbance below campaign measurement noise | ordinary nonzero rounding is at most about `5e-12` relative; noise floor is materially higher | RECORDED |
| finite-value law | no invalid value crosses the boundary | non-finite values rejected | ENFORCED |
| zero law | one canonical zero | negative zero normalizes to zero | ENFORCED |
| prediction digest law | canonicalize before hashing | every Q10 model-output vector crosses the new boundary before digesting | ENFORCED |
| transcendental law | canonicalize post-libm output | Q10 log loss crosses the same policy after logarithm evaluation | ENFORCED |
| legacy quantizers | historical consumers retain exact-binary64 behavior | Q09, Q12, and Q14 paths unchanged | PRESERVED |
| byte-identity law | exact golden equality remains mandatory | no tolerance, approximate comparison, or weakened assertion added | UNCHANGED |
| local regenerated diff | only model-derived candidate classes move | 21 metric mantissas; 10 prediction digests; 26 study objectives; selectors unchanged | VERIFIED |
| Q10 regeneration | two complete generator passes | three accepted-byte matches per pass and three cross-pass matches | PASS |
| cascade | generator-owned Q10 through Q17 current artifacts | Q15 and Q16 regenerated twice; Q17 rebuilt twice from the retained benchmark | PASS |
| source pins | only current correction pins may move | current Q10/Q15/Q16/Q17 seals and assertions re-pinned | UPDATED |
| protected history | Q14, historical assignments, directives, tasks, and receipts | unchanged | PASS |
| focused Q10 | one sanctioned macOS golden skip only | 120 passed; 1 skipped | PASS |
| static checks | Ruff and strict mypy | exit `0` for both | PASS |
| Linux canonical re-mint | director-owned deployment-platform mint | pending; replace the exact three listed Q10 files | DIRECTOR_REQUIRED |
| Linux mint file | canonical fixture | `quant/fixtures/q10_model_golden_v1.json` | REPLACE |
| Linux mint file | canonical campaign JSON | `quant/generated/q10/model_campaign.v1.json` | REPLACE |
| Linux mint file | canonical campaign Markdown | `quant/generated/q10/model_campaign.v1.md` | REPLACE |
| double-vendor proof | independent mint on multiple runner draws and byte diff | pending; 12-digit midpoint and control-flow equivalence require empirical proof | DIRECTOR_REQUIRED |
| external effects | no push, provider mutation, private call, or secret use | none | PASS |
