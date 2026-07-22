| item | expected | found | status |
|---|---|---|---|
| correction | assigned pair | path handling and performance diagnostics | COMPLETE |
| branch base | suffix 600c | suffix 600c | PASS |
| entry temporary root | physical path | `fs.realpathSync('/tmp')` | PASS |
| local temporary roots | one physical source | all three derivations use the shared resolver | PASS |
| performance ordering | child result before receipt read | failure branch precedes `readFileSync` | PASS |
| performance detail | bounded child output | 64 KiB tail at `test/i00/performance/evidence/soak-failure-<runId>.log` | PASS |
| performance result | final child line | preserved without receipt-file substitution | PASS |
| measured managed inventory | current projection | counts 15/15/13/2/3; canonical count 14 | PASS |
| measured control inventory | current projection | 8 ordered controls | PASS |
| candidate control crosswalk | catalog and measured projection | counts 4/9/4 | PASS |
| evidence schema | component and owner forms | exact union; sibling constraints retained | PASS |
| focused entry proof | exit 0 | 9 passed; 0 failed | PASS |
| focused performance proof | exit 0 | 35 passed; 0 failed | PASS |
| focused acceptance proof | exit 0 | 15 passed; 0 failed | PASS |
| focused release proof | exit 0 | 175 assertions; 0 failed | PASS |
| root proof | `npm test` exit 0 | exit 0 | PASS |
| existing history | unchanged | existing receipt and evidence files unchanged | PASS |
| gate behavior | unchanged | acceptance checks and boundaries preserved | PASS |
| external actions | none | no push or provider action | PASS |
