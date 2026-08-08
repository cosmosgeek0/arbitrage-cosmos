# Maker-fee edge grid

This package freezes the requested public Regular User maker-entry fee scenarios
before any maker-grid outcome is calculated. It accepts only the exact previously
accepted E-1 bodies. It does not reacquire, reconstruct, or substitute historical
data.

The accepted custody registry records the E-1 measurement and manifest bodies as
`TEMP_PACKET_ABSENT`, the derived ledger and audit plan as digest-only, and the E-1
role as `ACCEPTED_RECEIPT_ONLY`. Therefore the terminal result is fail-closed:
requested net, interval, drawdown, capacity, and subset outputs remain null or
unknown.

Run the deterministic package check from `quant/`:

```sh
PYTHONPATH=src python -m quant_edge.maker_fee_grid \
  research/maker_fee_edge_grid
```

Run the focused tests:

```sh
PYTHONPATH=src python -m pytest -q tests/maker_fee_grid
```

The public fee schedule is a scenario input only. Account-effective fees and
realized commissions remain unknown.
