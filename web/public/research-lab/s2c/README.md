# S-2C — USD-M low residual-volatility research

S-2C is a public-data-only, market-factor-neutral low-minus-high residual-volatility
experiment. It is research evidence, not execution or capital authority.

The protocol, source plan, official-source record, evaluator, and tests are frozen
before any archive body is opened. Acquisition stores checksum-verified Binance
public archives outside Git. The evaluator has one permitted economic run, uses
development data first, and opens the sealed holdout only if every frozen
development gate passes.

`protocol.freeze.v2.json` is the operative freeze. It preserves and supersedes the
first pre-outcome freeze after an independent STOP found missing funding-cadence
validation and a contradictory holdout-failure state. No archive body had been
opened and no economic run had been consumed before this correction.

Commands are run from `quant/` with `PYTHONPATH=.`:

```text
python3.13 research/s2c/experiment.py freeze
python3.13 research/s2c/experiment.py acquire
python3.13 research/s2c/experiment.py run
python3.13 research/s2c/verifier.py
```

The frozen family uses only the second moment of prior-only market-model residuals.
Residual sign, residual momentum, raw return momentum, reversal, funding rank, volume
rank, and outcome-conditioned universe changes are forbidden.
