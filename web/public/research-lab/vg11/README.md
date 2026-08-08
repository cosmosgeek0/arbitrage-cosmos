# V-G11 trade/notional intensity

V-G11 is a public, offline, cash-long research packet for
`ORDINARY_NOTIONAL_TRADE_FRAGMENTATION_CONTINUATION`. It tests whether a first
causal increase in Binance-counted trades per unit of ordinary quote notional
continues over the frozen next-open to third-subsequent-open label horizon.

The packet owns no strategy, capital, order, account, host, or UI authority.
`result.v1.json` and `verdict.v1.json` are the only terminal result surfaces;
all account-effective fees, historical filters, slippage, impact, and capacity
remain unknown or unmeasured. A research `GO`, if reached, still has capital
authority `NONE` and capital verdict `NO_GO`.

Lifecycle commands, all network-free:

```bash
PYTHONDONTWRITEBYTECODE=1 python3 quant/research/vg11/experiment.py preflight
PYTHONDONTWRITEBYTECODE=1 python3 quant/research/vg11/experiment.py freeze
PYTHONDONTWRITEBYTECODE=1 python3 quant/research/vg11/experiment.py run
PYTHONDONTWRITEBYTECODE=1 python3 quant/research/vg11/experiment.py verify
PYTHONDONTWRITEBYTECODE=1 python3 quant/research/vg11/experiment.py report
```

`freeze` is create-once. `run` consumes the sole development grant before the
first archive body read. If development gates fail, holdout authorization,
evaluation marker, archive bodies, and result manifest remain absent.
`verify` checks closed checksums, exact bindings, and semantic relationships
without opening archives or recomputing outcomes.

V-G11 is cross-distinct from inspectable V-G1 through V-G8. The observed
uncommitted V-G12 draft is also cross-distinct but is not accepted Git evidence.
V-G9, V-G10, V-G13, and V-G14 were not protocol-certifiable at freeze, so the
packet does not claim full active-lane certification.
