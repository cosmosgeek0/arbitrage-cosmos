# S-1T packet report

`result.v1.json` raw SHA-256: `0558791e94d4edebcc7a20756ec022e924578b9103b655427bc3a0183b5eb16f`

That digest is the SHA-256 of the exact canonical bytes of `result.v1.json` as
written, and `SHA256SUMS` repeats it alongside every other final packet file.
Recompute it with `shasum -a 256 result.v1.json`.

S-1T reports a retrospective observational association only. The decision hour is
a simulation index after the final confirmation settlement, not a proven
live-public availability time. Capital authority is NO_GO in every branch.

| item | expected | found | status |
|---|---|---|---|
| S-1T verdict | sealed public-only verdict | UNMEASURED_RUN_CONSUMED_NO_RERUN | FINAL |
| producer commit | clean child of the canonical base | ee1e7f32609ba25932e9805046594cccc98291b2 | PINNED |
| net USD per $1k | base; stress; severe | base=None; stress=None; severe=None | SEALED |
| reported interval | base; stress; severe | UNMEASURED | SEALED |
| multiplicity | Holm; White; PBO | UNMEASURED | SEALED |
| severe hourly drawdown | fixed $1k denominator | UNMEASURED | SEALED |
| public capacity | coarse prior-volume proxy only | UNMEASURED | NON_EXECUTABLE |
| holdout custody | gate-bound champion only | development=RUN_CONSUMED_UNMEASURED; holdout=UNOPENED; holdout opens=0 | SEALED |
| executable limits | no capital authority | account fees=UNKNOWN; executable capacity=UNKNOWN; capital=NO_GO | NO_GO |
