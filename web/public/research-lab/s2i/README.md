# S-2I — Binance-public Spot → USD-M lead-lag

S-2I is one sealed, public-data-only test of whether a completed hourly Spot
return innovation leads the next one to six hours of the same symbols' USD-M
perpetual returns. The payoff is an equal-long/equal-short USD-M portfolio;
there is no Spot position, basis trade, private endpoint, order, transfer, or
capital authority.

The planned economic window is
`[2025-07-01T00:00:00Z, 2026-07-01T00:00:00Z)`. Development ends on
2026-03-01, a seven-day embargo follows, and the remaining period is a
conditional holdout. The holdout ZIP members cannot be opened unless every
predeclared development gate passes.

## Lifecycle

Run from the repository root with Python 3.13:

```text
python3.13 quant/research/s2i/acquisition.py acquire \
  --raw-root /private/tmp/cosmos-s2i-spot-usdm-leadlag-v1-fbce/raw

# Commit source_manifest.v1.json before freezing.
python3.13 quant/research/s2i/experiment.py freeze \
  --raw-root /private/tmp/cosmos-s2i-spot-usdm-leadlag-v1-fbce/raw

# Commit freeze.v1.json before running.
python3.13 quant/research/s2i/experiment.py run \
  --raw-root /private/tmp/cosmos-s2i-spot-usdm-leadlag-v1-fbce/raw

# Commit the outcome packet first.
python3.13 quant/research/s2i/verify.py --write-postrun

# After committing POSTRUN_VERIFICATION.v1.json:
python3.13 quant/research/s2i/verify.py
```

`acquire` retrieves publisher checksum sidecars and ZIP bytes but never opens a
ZIP container. `freeze` binds every source byte plus the protocol and evaluator
before any outcome member is opened. `run` requires a clean frozen tree and
atomically consumes its external run gate before the first member access.
Failure consumes the run permanently. Candidate formation, capacity,
marked-exposure, and hourly-PnL ledgers are sealed with the outcome so the
offline verifier derives every GO gate and the PBO diagnostic rather than
trusting reported scalars.

If a lifecycle or data failure occurs after development has been sealed,
`development.v1.json` is preserved byte-for-byte and
`terminal_failure.v1.json` records the failing stage. A holdout-stage failure
therefore cannot invalidate the candidate seal's development hash.

Raw archives and the external one-shot marker are outside Git at the canonical
paths frozen in the protocol. Alternate raw or state roots are rejected. The
tracked receipts are evidence, not the authority to rerun.

## Verdict boundary

A valid failed economic gate is `NO_GO`. A custody, clock, schema, lifecycle,
or required-metric failure is `UNMEASURED`. Passing every development and
holdout gate can produce only `GO_PUBLIC_PROXY_LOCAL`; account-effective fees,
historical depth, impact, filters, and executable capacity remain unknown, so
capital authority is always `NONE`.

The only downstream consumer named by this packet is
`N3 successor/final convergence`. This packet does not mutate N3.
