# DQ-6 research-economics truth validator

DQ-6 is one deterministic, network-free boundary for public research economics. It
checks a frozen JSON document, rejects category upgrades, and emits a canonical
SHA-256-bound receipt. It does not call an exchange, inspect an account, place an
order, or authorize capital.

## Truth contract

The validator makes five boundaries explicit:

1. **Capital denominator** — the per-1,000 denominator must be explicitly labeled
   `INITIAL_RESEARCH_CAPITAL`, positive, and denominated in USDT. Each entry leg has
   an exact USDT notional; their sum must reproduce a separate declared gross entry
   notional. The receipt retains the exact gross-exposure ratio so a producer cannot
   silently normalize on a leg sum, turnover, or gross exposure. It explicitly
   denies account-capital authority.
2. **Economic decomposition** — scenario net is exactly
   `grossPnl - feeCost - slippageCost + signed fundingPnl`. Fee and slippage are
   nonnegative costs. Funding received is positive and funding paid is negative.
   No component may be folded into another. If any component is sensitivity-only,
   the aggregate net must also be labeled `SENSITIVITY_SCENARIO`.
3. **Account fee** — a public schedule or sensitivity can supply a numeric scenario
   fee, but the account-effective fee and therefore the account-effective net
   remain `UNKNOWN`. A numeric account-fee claim is rejected.
4. **Capacity** — a public quote-volume participation or public order-book haircut
   may be labeled only `PUBLIC_MARKET_CAPACITY_PROXY`. The proxy math must reproduce,
   while executable capacity remains `UNMEASURED`.
5. **USDT versus USD** — all v1 amounts remain nominal USDT. USD conversion is
   `UNKNOWN` unless a separate conversion-evidence contract is introduced; assumed
   parity, a dollar symbol, or a relabeled USD amount is rejected.

The numeric receipt is therefore a **public scenario**, not account PnL, fill
capacity, or capital authority. Its only consumers are `N3` and
`FUTURE_RESEARCH_INTAKE`.

V1 accepts only a complete numeric public/sensitivity scenario. It never turns an
unknown component into zero: a producer without a numeric scenario assumption does
not get a receipt. `INITIAL_RESEARCH_CAPITAL` is a frozen research convention, not
an observed account balance.

## Focused verification

From `quant/`:

```sh
PYTHONPATH=src:. uv run --locked --no-sync pytest -q research/dq6/test_validator.py
PYTHONPATH=src:. uv run --locked --no-sync python -m research.dq6.verify_known_answer
uv run --locked --no-sync ruff check research/dq6
uv run --locked --no-sync ruff format --check research/dq6
MYPYPATH=src:. uv run --locked --no-sync mypy --strict --explicit-package-bases \
  research/dq6/__init__.py research/dq6/validator.py research/dq6/verify_known_answer.py
```

The fixture set contains one valid two-leg scenario and hostile mutations for the
wrong denominator, a broken decomposition, a numeric account fee, executable-
capacity relabeling, and USDT-to-USD overclaim. The verifier checks the exact
expected error code for every hostile document and the frozen receipt digest for
the valid document. All fixture values and repeated-digit hashes are synthetic test
data, not market evidence.

## Deliberate limits

DQ-6 validates structure, exact arithmetic, labels, and canonical output. It does
not authenticate the public artifact named by `artifactSha256`; the caller must
bind that digest to frozen source bytes before intake. It also does not establish
statistical validity, initial-capital realism, account fee truth, fillability,
executable capacity, stablecoin convertibility, or profitability. Any of those
claims requires its own accepted evidence boundary.

## Scope and non-authority

This package is source-only under `quant/research/dq6/**`. It neither reads nor
modifies any prior experiment or holdout. It has no UI, canonical, deployment,
host, provider, private-read, order, transfer, withdrawal, or money effect.

See [REFERENCES.md](REFERENCES.md) for the frozen official-source interpretation
used to define the boundary.
