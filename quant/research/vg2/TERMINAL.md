# V-G2 terminal disposition

`UNMEASURED`

The one authorized development open stopped during source semantic validation,
before any trial was evaluated or selected. The checksum-authenticated
`AXSUSDT-1d-2026-02.zip` contains the same complete 2026-02-10 daily row twice
at CSV lines 10 and 11. The frozen protocol maps any duplicate or conflicting
complete daily bar to `UNMEASURED`.

- Base net edge per `$1,000`: `null` / `NOT_ESTIMABLE`
- Stress net edge per `$1,000`: `null` / `NOT_ESTIMABLE`
- Development opens: `1`
- Holdout opens: `0/1` — untouched
- Repair or rerun: `false`
- Consumer: `N3 profitability verdict`
- Capital/execution/order authority: `NONE`
- Money effect: `$0`

The pre-outcome evaluator, protocol, source manifest, tests, and research report
remain byte-identical to `freeze.v1.json`. The planned `report` path requires a
completed holdout and is intentionally not invoked after this earlier terminal
stop. Terminal authentication is instead the committed `SHA256SUMS`, the
cross-file digest bindings in `run-marker.v1.json` and `result.v1.json`, and the
focused invariants below:

```sh
shasum -a 256 -c research/vg2/SHA256SUMS

jq -e '
  .verdict == "UNMEASURED" and
  .netEdge.baseNetUsdPer1000 == null and
  .netEdge.stressNetUsdPer1000 == null and
  .holdout.openCount == 0 and
  .repairOrRerunPerformed == false and
  .reason.code == "DUPLICATE_FULL_DAILY_BAR"
' research/vg2/result.v1.json

jq -e '
  .state == "TERMINAL_UNMEASURED_HOLDOUT_UNOPENED" and
  .developmentOpenCount == 1 and
  .holdoutOpenCount == 0
' research/vg2/run-marker.v1.json
```
