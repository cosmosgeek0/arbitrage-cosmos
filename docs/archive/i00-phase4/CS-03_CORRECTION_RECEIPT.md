# CS-03 correction receipt — public-source deployment admission

Status: `CORRECTED_AND_REGRESSION_TESTED`

The canonical I00 and application activation templates now carry the exact
`I00_PUBLIC_SOURCE_STARTUP_EGRESS=1` admission required by the public-source
runtime. Activation validation rejects a missing or non-exact admission and
rejects deterministic-offline mode. The isolated deployment probe supplies
the same exact admission to custom and default probe commands and refuses an
inherited offline override before release mutation.

No deployment, private exchange call, signed action, or money path was
performed or authorized by this correction.

Regression proof:

```text
bash ops/tests/i00/test-cs-03-public-source-admission.sh
```

The regression fails on the pre-correction tree because both activation
templates omit the required admission, then passes with 12 assertions after
the correction.
