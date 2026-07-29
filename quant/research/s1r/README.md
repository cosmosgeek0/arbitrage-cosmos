# S-1R — post-settlement funding-surprise basis reversion

S-1R is one sealed, network-free research verdict built from Binance public
archives. It is not a trading system and grants no execution, product, private
API, host, UI, order, or money authority.

The hypothesis is deliberately narrow:

1. Normalize the newly settled positive USD-M funding rate to an eight-hour
   equivalent.
2. Compare it only with the symbol's strictly prior positive settled
   observations.
3. If the robust surprise is large, enter equal-base long Spot / short the same
   USD-M perpetual at the first common five-minute open strictly after the
   settlement plus the frozen event-time delay.
4. Measure paired basis contraction over a fixed 15, 30, or 45 minute horizon.

No funding payment is booked. A sign transition is ineligible. Funding level
carry, persistence, cross-sectional rank, acceleration, premium, open interest,
volume, COIN-M, and dated futures are forbidden signal inputs.

## Lifecycle

From this directory:

```text
python experiment.py prepare
python experiment.py run
python verifier.py
```

`prepare` verifies the checksum-addressed compressed archive files without
opening a ZIP member, writes `source_manifest.v1.json`, and freezes all declared
inputs. `run` creates `run_consumed.v1.json` before any archive member is opened.
It is create-once. Development failure leaves holdout members unopened. Only a
development-admitted champion can create the champion and holdout-open seals.

Tests are synthetic and never open a shared archive member:

```text
python -m pytest test_experiment.py test_verifier.py -q
```

## Interpretation

- `NO_GO`: valid measured public-proxy gates failed.
- `UNMEASURED`: the sealed public evidence cannot support a verdict.
- Public-proxy success still cannot become capital `GO`. Historical funding
  publication latency, account-effective commissions, paired fills, historical
  depth, and executable capacity are not present in the public archive packet.

The consumer is the N3 successor/final-convergence scoreboard only.
