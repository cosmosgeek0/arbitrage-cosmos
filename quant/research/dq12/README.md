# DQ-12 — Binance Spot↔USD-M instrument identity

DQ-12 is a portable, deterministic, offline validator for one **current**
Binance Spot instrument joined to one USD-M crypto perpetual. It was built from
exact canonical
`a169b123fb186d1943a75ad648552c4d95be1be1`. This packet is source-only,
has `authority=NONE`, and grants no provider, private-read, order, transfer,
withdrawal, execution, capital, profitability, deployment, or landing
authority.

## Contract

`validate_spot_usdm_identity_v1` accepts the exact bytes of:

1. a request that precommits the symbols, expected canonical identities,
   evaluation time, source metadata, payload digests, and registry digest;
2. a Spot `/api/v3/exchangeInfo` snapshot;
3. a USD-M `/fapi/v1/exchangeInfo` snapshot; and
4. an explicit identity registry.

Market type comes only from exact endpoint provenance:

- `https://api.binance.com/api/v3/exchangeInfo` → `SPOT`
- `https://fapi.binance.com/fapi/v1/exchangeInfo` → `USD_M`

The only positive result is `MATCHED`. Every malformed, missing, stale,
future-dated, skewed, contradictory, unsupported, ambiguous, or historically
scoped input fails closed as `UNKNOWN` with one stable reason code. `MATCHED`
means current identity at the receipt boundary only; `historicalStatus` remains
`UNKNOWN`.

A match requires all of the following:

- Spot is exactly `status=TRADING` with
  `isSpotTradingAllowed=true`;
- USD-M is exactly `contractType=PERPETUAL`, `status=TRADING`,
  `underlyingType=COIN`, and `pair == symbol`;
- both base assets resolve to one precommitted canonical underlying;
- Spot quote, USD-M quote, and USD-M `marginAsset` resolve to the same
  precommitted canonical quote identity with identical unit scales; and
- both venue symbols resolve to their precommitted current instrument
  identities.

USD-M exposes `marginAsset`, not a distinct settlement-asset fact. DQ-12 treats
it only as `SETTLE_PROXY_FROM_MARGIN_ASSET`; the receipt records
`settlementBasis="SETTLE_PROXY_FROM_MARGIN_ASSET"` and
`settlementSourceField="marginAsset"` and does not assert stronger settlement
truth.

## Aliases and migrations

DQ-12 never derives identity by splitting symbols, stripping numeric prefixes
or delivery suffixes, changing case, or applying Unicode normalization.
Aliases and migrations must be explicit, Binance/market/role scoped,
time-bounded, evidence-digest bound, quantity-scale complete, acyclic, and
within the frozen chain-depth limit. Symbol scales must remain one-to-one.
A registry edge's rational scale means canonical target units per one source
unit; chained scales multiply. The receipt exposes the resulting exact base
ratio as Spot units per one USD-M base unit.
A migration marked as changing its underlying, an absent or inactive rule, a
conflict, a cycle, or an unresolved chain returns `UNKNOWN`.

This is intentionally current-only. Binance's current exchange-info endpoints
do not establish historical venue status, and archived market data does not
repair that evidence gap. See
[`OFFICIAL_SOURCE_RESEARCH.md`](OFFICIAL_SOURCE_RESEARCH.md) for the
Binance-owned sources and frozen interpretation.

## Determinism and receipt

The validator performs no network I/O. It rejects duplicate JSON keys,
non-canonical scalar types, unbounded inputs, duplicate symbol rows, digest or
endpoint drift, stale/future captures, and excessive cross-endpoint skew.
Registry and receipt digests use bounded, canonical JSON serialization. The
receipt contains the input digests, resolved identities and rational scales
only on `MATCHED`; `UNKNOWN` withholds unresolved identity fields. All receipts
state `authority=NONE`.

Because the validator is offline, endpoint metadata and payload digests prove
that the supplied bytes match the precommitted request; they do not
independently authenticate how a collector obtained those bytes. A consumer
must preserve the trusted collection receipt as part of its own evidence
boundary.

CLI usage:

```sh
PYTHONPATH=quant python -B -m research.dq12.validator \
  --request REQUEST.json \
  --spot SPOT_EXCHANGE_INFO.json \
  --usdm USDM_EXCHANGE_INFO.json \
  --registry IDENTITY_REGISTRY.json
```

The CLI writes canonical receipt JSON to stdout and exits `0` for `MATCHED` or
`2` for `UNKNOWN`.

## Focused proof

Run only the DQ-12 offline packet:

```sh
PYTHONPATH=quant python -B -m pytest -q -p no:cacheprovider \
  quant/research/dq12/test_validator.py
ruff check quant/research/dq12
ruff format --check quant/research/dq12
MYPYPATH=quant mypy --strict --explicit-package-bases \
  quant/research/dq12/__init__.py \
  quant/research/dq12/validator.py \
  quant/research/dq12/test_validator.py \
  quant/research/dq12/verify_known_answer.py
PYTHONPATH=quant python -B -m research.dq12.verify_known_answer
(cd quant/research/dq12 && shasum -a 256 -c SHA256SUMS)
```

Hostile fixtures must cover venue-leg swaps, endpoint/digest/time drift,
ineligible and unknown statuses, delivery/non-coin contracts, quote or
`marginAsset` mismatches, implicit multiplier traps such as `1000SHIB`,
legitimate digit-leading assets such as `1INCH`, aliases/migrations and scales,
duplicates, malformed payloads, and deterministic input ordering.

The sole downstream consumer is the **N3 successor/final convergence** step.
Until that step independently composes and lands the exact clean hash, DQ-12
remains a preserved source-only candidate.
