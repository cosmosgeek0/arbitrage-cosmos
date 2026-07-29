# V-G4 terminal source anomaly proof

## Verdict boundary

V-G4 terminated `UNMEASURED` during development source validation. It did not
calculate strategy edge, select a champion, create a candidate seal, or open any
March–June 2026 holdout archive. Dropping the affected symbol, deduplicating the
archive, or rerunning would violate the frozen one-run protocol.

## Checksum-bound source

- Object:
  `data/spot/monthly/klines/AXSUSDT/1d/AXSUSDT-1d-2026-02.zip`
- Frozen object ETag: `8b434a197f6a7f6bbb8ebcb70f4f88b5`
- Frozen object last modified: `2026-03-02T06:36:05.000Z`
- ZIP SHA-256:
  `7f18d5a29f2e767389efce407d47a247dac3e0e309cef4a3b377040bddf001bf`
- The official `.CHECKSUM` names that ZIP and publishes the same ZIP digest.
- Checksum-file SHA-256:
  `3b16313140110bfac82b1beef671ab866025eea4edd89ffdceedbc926330f250`
- Local pair-receipt SHA-256:
  `38031483589006c82bf65b4ca1090c20630d580daf11e7ef7337c84b1ec1c0e1`

These values are frozen in `source-manifest.v1.json`.

## Exact failure

CSV rows 10 and 11 are byte-identical daily kline records. Both use open time
`1770681600000000` microseconds and close time `1770767999999999` microseconds.
The SHA-256 of each complete CSV row including its LF terminator is:

`36e86b2b8bdd586e5672faa0b9beda042442895f8de7bde3e4479c8d047a51ba`

The duplicate makes symbol-day identity non-unique. The frozen parser therefore
failed closed with `daily rows are duplicate or unsorted`; it did not silently keep
the first row, keep the last row, average them, or exclude AXSUSDT.

## Run-control proof

- Pre-outcome evaluator commit: `faf7e2f8c3b14bbcaf34c560f83c4574fc076e57`
- Freeze SHA-256:
  `31fa9150758ebb76407d60755b6673aa552719a0bb5ebd071e3d98e5dd138d49`
- Source-manifest SHA-256:
  `5b96dd6c5f8760abd69832ec901700fa3548f04a43b0542ea97d9d128bb4ef7e`
- Sole run-marker SHA-256:
  `f1af064b52245da20a8a460a5a66a5a8139bd7962af7ce245ff35aae15328d37`
- Terminal result SHA-256:
  `f870c0eb004fac138634968db402e6e9a38856ce4fe1fade002fc3de983c28e3`
- Holdout-open receipt: absent.
- Candidate seal: absent.

N3 must consume `UNMEASURED`; capital authority remains `NONE`.
