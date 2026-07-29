# S-1L sealed quarterly-perpetual calendar-basis verdict

This packet measures one public-data Binance USD-M calendar-basis family on
BTCUSDT and ETHUSDT. It starts from exact canonical
`a169b123fb186d1943a75ad648552c4d95be1be1` and has no product, account,
provider, order, transfer, withdrawal, host, deployment, or money authority.
Each underlying uses equal base quantity across its dated and perpetual legs;
the pair, not each leg independently, is normalized to $500 gross.

Lifecycle:

1. `plan` writes the immutable archive object plan.
2. `discover` lists metadata only; it does not download archive bodies.
3. `freeze` binds protocol, evaluator, source research, methodology, tests,
   plan, runtime, and every listed object before outcomes.
4. Commit that freeze.
5. `acquire` downloads official checksum sidecars and ZIP bytes without
   decompression.
6. `run` creates an exclusive marker before decompression, evaluates
   development, seals one champion, creates the one holdout-open marker, opens
   the holdout once, and writes a create-once verdict.
7. `seal` writes `SHA256SUMS`; `report` authenticates without network access or
   recomputation.

After `run-marker.v1.json` exists, evaluator/protocol repair and rerun are
forbidden. A failure becomes a terminal `UNMEASURED` result.

Example commands from `quant/`:

```sh
PYTHONPATH=. python research/s1l/experiment.py plan
PYTHONPATH=. python research/s1l/experiment.py discover
PYTHONPATH=. python research/s1l/experiment.py freeze
PYTHONPATH=. python research/s1l/experiment.py acquire
PYTHONPATH=. PYTHONHASHSEED=0 python research/s1l/experiment.py run
PYTHONPATH=. python research/s1l/experiment.py seal
PYTHONPATH=. python research/s1l/experiment.py report
```

The default external cache is
`/private/tmp/cosmos-s1l-usdm-calendar-basis-v1`. Downloaded public archives
remain outside Git and are read-only inputs after checksum verification.
