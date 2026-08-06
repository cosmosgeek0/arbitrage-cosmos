# S-2H — Spot UTC-boundary gap reversal

S-2H is one sealed Binance-public research experiment. It tests whether a
fixed, liquid Spot USDT universe exhibits cross-sectional reversal after the
price discontinuity between the final `23:00` UTC hourly bar close and the next
`00:00` UTC hourly bar open.

Binance Spot trades continuously. “Overnight” is only a conventional label for
the UTC bucket boundary; it is not an exchange closure. The signal is not
formed until the entire `00:00–01:00` bar is complete. Proxy entries occur at
the `02:00` hourly open and fixed exits at `06:00` or `10:00`, so the signal is
never filled at the same open used to define it.

The portfolio is synthetic and dollar-neutral: equal gross dollars long the
lowest gaps and short the highest gaps. Ordinary Spot cannot create the short
leg without owned inventory or margin borrowing. Borrow availability, borrow
interest, collateral, liquidation, historical filters, account-effective
commission, spread, depth, impact, and executable capacity remain `UNKNOWN` or
`UNMEASURED`. Every terminal state therefore has capital authority `NONE`.

## Frozen lifecycle

1. `prepare` binds the prior complete official-prefix discovery receipt,
   consumes only its checksum-verified June 2025 daily anchor cache, records
   all 679 inherited ASCII USDT candidates (including 74 frozen exclusions),
   and freezes the top-30 liquid universe. The prior candidate grammar omitted
   non-ASCII prefixes even though its raw listing recorded them; this retained
   discovery limitation is explicit and its effect on the June 2025 top 30 is
   not established.
2. `acquire` downloads the selected 30 symbols' June 2025 through June 2026
   official hourly ZIPs and adjacent `.CHECKSUM` files. It verifies compressed
   bytes without opening hourly members.
3. `freeze` binds the protocol, implementation, tests, source research,
   universe, source manifest, runtime, base commit, and empty outcome state.
4. `run` creates one exclusive marker before the first hourly member opens.
   It evaluates development once. Only a fully passing development champion
   can create the exclusive holdout-open marker before March–June member
   access.
5. Any post-marker failure is terminal `UNMEASURED`. Repair, rerun, retuning,
   runner-up substitution, and direction reversal are forbidden.

The default external state root is
`/private/tmp/cosmos-s2h-spot-utc-gap-reversal-v1`. Evaluation is network-free.
Sparse but otherwise valid hourly archives preserve their missing clocks:
missing pre-formation boundary evidence routes the whole fixed cohort to cash,
whereas a missing selected entry, exit, or mark terminates the one run as
`UNMEASURED`.

## Commands

Run from `quant/`:

```text
PYTHONPATH=. uv run --frozen python research/s2h/experiment.py prepare \
  --anchor-cache /private/tmp/cosmos-s1f-weekly-momentum-cash-v1/archives
PYTHONPATH=. uv run --frozen python research/s2h/experiment.py acquire
PYTHONPATH=. uv run --frozen python research/s2h/experiment.py freeze
PYTHONPATH=. uv run --frozen python research/s2h/experiment.py run
PYTHONPATH=. uv run --frozen python research/s2h/verify.py
```

The exact clocks, partitions, costs, inference, gates, custody, and authority
laws are in `protocol.v1.json`.
