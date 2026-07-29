# S-1Z — sealed USD-M residual momentum

S-1Z asks whether lagged residual price continuation exists across a fixed, long-lived
Binance USD-M cohort after actual archived funding rates and conservative public cost
proxies. It is public research only.

The signal uses no funding, Premium Index, basis, open-interest, volume, or order-flow
feature. Four high residual-momentum contracts are long, four low residual-momentum
contracts are short, and closed-form projection targets dollar, BTC, and ETH beta
neutrality. BTCUSDT and ETHUSDT are factor-only.

The source window is an exact 365 days, `[2025-06-22, 2026-06-22)`, with January to
21 June 2025 used only for warm-up. The primary trial `w120_l28_h3` is frozen before
source-body access. Eleven variants exist only to measure local specification risk.
The holdout never selects a trial and cannot rescue a development failure.

## Lifecycle

Run from `quant/`:

```bash
PYTHONPATH=.:src uv run --frozen python -B research/s1z/acquire.py acquire
PYTHONPATH=.:src uv run --frozen python -B research/s1z/acquire.py audit
PYTHONPATH=.:src uv run --frozen python -B research/s1z/experiment.py freeze
PYTHONPATH=.:src uv run --frozen python -B research/s1z/experiment.py arm
PYTHONPATH=.:src uv run --frozen python -B research/s1z/experiment.py run
PYTHONPATH=.:src uv run --frozen python -B research/s1z/verifier.py
```

`acquire.py` is the only network-capable module. `experiment.py` is network-free.
The pre-freeze audit reads hashes, sidecars, current metadata, and ZIP central
directories only; it never decompresses a CSV member. Full schema, row-grid, funding
cadence, and economic validation happen only after the exclusive consumption receipt.
Protocol/source freeze and the run marker must each be committed and equal to origin
before the next lifecycle phase. The outcome command creates an exclusive external
consumption receipt and refuses every rerun.

## Interpretation boundary

`netUsdPer1000` is non-compounded public-proxy P&L on $1,000 gross steady-state
capital. The archive rate is actual; hourly mark price, fee, adverse execution, and
capacity are public proxies. There is no account, provider, private API, UI, host,
order, transfer, withdrawal, or money effect.

Even a statistical pass can authorize only
`PUBLIC_PROXY_GO_FOR_PROSPECTIVE_SHADOW`. Account profitability and executable
capacity remain `UNMEASURED`; capital and execution remain `NO_GO`/`NONE`.
