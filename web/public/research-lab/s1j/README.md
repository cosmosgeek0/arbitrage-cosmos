# S-1J sealed public-data verdict

This directory is the complete standalone S-1J evidence packet. It reads two
pre-existing official Binance archive collections without modifying them:

- USD-M: `/private/tmp/cosmos-s1d-funding-dispersion-v1`
- Spot: `/private/tmp/cosmos-s1f-weekly-momentum-cash-v1`

The lifecycle is irreversible:

1. `prepare` reads only parent manifest metadata, freezes the point-in-time
   symbol inventory, and binds evaluator/configuration bytes.
2. The clean freeze commit is recorded.
3. `run` atomically consumes S-1J before opening any outcome ZIP, evaluates
   development, seals one champion, and opens holdout only if development
   passes.
4. `verify` authenticates the packet without network or outcome recomputation.

```bash
cd quant
PYTHONPATH=. /Users/cosmosgeek/Desktop/cosmos-merge/quant/.venv/bin/python research/s1j/experiment.py prepare
PYTHONPATH=. /Users/cosmosgeek/Desktop/cosmos-merge/quant/.venv/bin/python research/s1j/experiment.py run
PYTHONPATH=. /Users/cosmosgeek/Desktop/cosmos-merge/quant/.venv/bin/python research/s1j/verifier.py
PYTHONPATH=. /Users/cosmosgeek/Desktop/cosmos-merge/quant/.venv/bin/pytest -q research/s1j/test_experiment.py research/s1j/test_verifier.py
```

No private endpoint, account credential, UI, host, provider, order, transfer,
withdrawal, money action, canonical mutation, or N3 registry mutation is in
scope. N3 integration is intentionally deferred to its successor because the
current adapter registry cannot be edited inside S-1J's exclusive path.
