| item | expected | found | status |
|---|---|---|---|
| correction | SLO-RSS-005 | peak-RSS soft-bound review | COMPLETE |
| observed source | suffix `6786` | suffix `6786` | PASS |
| observed peak RSS | exact measured value | `583,024,640` bytes | RECORDED |
| prior soft bound | historical baseline | `536,870,912` bytes | RECORDED |
| approved soft bound | 640 MiB | `671,088,640` bytes | PASS |
| hard bound | unchanged | `805,306,368` bytes | PASS |
| slope soft bound | unchanged | `10,485,760` bytes/hour | PASS |
| slope hard bound | unchanged | `52,428,800` bytes/hour | PASS |
| composition rationale | evidence wave, AI-Ops, and readiness growth since 2026-07-16 | director-authorized | RECORDED |
| leak metrics | director finding remains green | zero invariant failures; hard and slope guards unchanged | PASS |
| short-window slope | retain truthful state | not configured for the 60-second campaign | PRESERVED |
| mandatory re-review | by 2026-10-18 | encoded cutoff | REQUIRED |
| unreviewed cutoff behavior | fail soft again | effective soft returns to `536,870,912` bytes at cutoff | ENFORCED |
| cutoff clock | completed-run SLO evaluation | receipt-bound evaluation timestamp | ENFORCED |
| focused observation proof | `583,024,640` passes soft | exact assertion; exit `0` | PASS |
| focused hard proof | value above hard fails | `805,306,369` blocked; exit `0` | PASS |
| focused expiry proof | cutoff restores prior soft | exact cutoff assertion; exit `0` | PASS |
| cutoff chronology proof | completed-run time selects policy | producer and validator exact; exit `0` | PASS |
| focused suite | all tests pass | `37/37`; exit `0` | PASS |
| acceptance contract | all consumers pass | `57/57`; exit `0` | PASS |
| release fixture | current receipt schema validates | `175` assertions; exit `0` | PASS |
| project gate | `npm test` passes | exit `0` | PASS |
| historical receipts | unchanged | unchanged | PASS |
| external actions | none | no push | PASS |
