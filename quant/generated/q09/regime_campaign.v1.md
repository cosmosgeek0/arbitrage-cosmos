# Q09 regime campaign evidence (synthetic only)

- Seed: `20260712`
- Golden fixture SHA-256: `f7ba6deda66022c3ccc9dcd1aeb616fcf02eb586ab44eba01888f673d92b3c2d`
- Detection series: 24; anomaly series: 12; profile series: 12; analog batches: 12

No detector, regime, anomaly score or analogue is claimed to be predictive,
calibrated or economically valuable; these are machinery measurements.

| Detector | Detected | Missed | False alarms | In-control bars | Delay sum |
| --- | ---: | ---: | ---: | ---: | ---: |
| `bocpd` | 33 | 0 | 0 | 3975 | 66 |
| `cusum` | 33 | 0 | 0 | 3975 | 6 |
| `pageHinkley` | 33 | 0 | 0 | 3975 | 22 |

## Exclusion measurements

- Matrix profile exclusion totals: {'degenerate': 0, 'future': 46992, 'overlap': 7140, 'sameEvent': 792}
- Analog exclusion totals: {'COHORT': 96, 'DEGENERATE': 0, 'FUTURE': 108, 'OVERLAP': 0, 'SAME_EVENT': 36, 'SHAPE': 0}
