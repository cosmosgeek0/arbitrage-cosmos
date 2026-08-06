# FEE-1 sanitized fee-truth research

Reviewed through `2026-07-28T17:53:31Z`. This note records public Binance documentation only. It contains no private request, account rate, credential, account identifier, order identifier, contact field, payment field, or execution authority. `official_sources.v1.json` is the machine-readable source inventory.

## Truth states

Every scenario row carries exactly one frozen `truthState`:

- `CURRENT_ACCOUNT_RATE`: copied from an owner-supplied sanitized current account capture and valid only within the receipt's current-point-in-time window.
- `PUBLIC_SCHEDULE`: copied from a visible current public fee schedule; it is generic public truth, not account truth.
- `SENSITIVITY_ONLY`: an explicitly hypothetical maker/taker, discount, promotion, or adverse-cost assumption.
- `UNKNOWN`: absent, stale, ambiguous, inconvertible, or not supported by the sanitized receipt.

`UNKNOWN` has no numeric substitute. It is never `0`, never a regular-user public rate, and never a permission to reuse a prior receipt. A mixed two-leg scenario is no more truthful than its least truthful required leg.

## Official interface findings

### Binance Spot

`GET /api/v3/account/commission` is a signed `USER_DATA` current snapshot for one symbol. Its documented response contains:

- `symbol`
- `standardCommission.{maker,taker,buyer,seller}`
- `specialCommission.{maker,taker,buyer,seller}`
- `taxCommission.{maker,taker,buyer,seller}`
- `discount.{enabledForAccount,enabledForSymbol,discountAsset,discount}`

The rate fields are decimal strings representing dimensionless fractions of the commission basis. For example, fraction `0.001` is `0.1%` and `10` basis points. Preserve the strings as exact decimals; do not parse them through binary floating point.

For a Spot fill, select `maker` or `taker`, then add the applicable `buyer` or `seller` rate within each commission family. Binance documents the commission basis as the received amount: base quantity for a buy and quote notional for a sell. Standard, special, and tax are separate truth components and must not be collapsed before their individual provenance and discount treatment are known.

A test order with `computeCommissionRates=true` returns order-specific maker/taker values whose side component is already incorporated. It is not interchangeable with the account-commission response. This adapter does not submit test orders or any other private request.

The exact realized historical Spot fee is the per-fill `commission` plus `commissionAsset` reported by account trade data. A current commission snapshot cannot reconstruct a historical fill's promotions, tier, discount eligibility, BNB balance, conversion price, commission-asset rounding, or mixed maker/taker execution.

### Binance USDⓈ-M Futures

`GET /fapi/v1/commissionRate` is a signed `USER_DATA` current snapshot for one symbol. Its documented response contains:

- `symbol`
- `makerCommissionRate`
- `takerCommissionRate`
- `rpiCommissionRate`

All three are decimal-string fractions. RPI is a distinct execution role and must not be folded into maker. The documentation's numeric examples illustrate payload shape; they are not public live rates and are not owner account rates.

`GET /fapi/v1/feeBurn` separately returns `feeBurn: boolean`. That boolean says whether the account-level BNB fee discount setting is on or off. It does not itself provide a discount fraction, prove sufficient BNB at a fill, prove symbol eligibility, state whether `/commissionRate` is already discount-adjusted, or reconstruct a historical fee. The frozen receipt does not accept the raw boolean as a standalone scenario field. It accepts only a fully normalized discount application and payable multiplier with matching enum provenance; otherwise the discount is `UNKNOWN`.

### Public schedules at the review point

The public Binance fee schedule is a current generic schedule, not account truth. On `2026-07-28`, its Spot & Margin regular-user row displayed `0.100% / 0.100%` maker/taker (`0.001 / 0.001` fractions, `10 / 10` bps) and its “BNB 25% off” columns displayed `0.07500% / 0.07500%` (`0.00075 / 0.00075`, `7.5 / 7.5` bps). Product-specific, VIP, stablecoin, and promotion rows may change independently.

The dedicated USDⓈ-M public fee-schedule URL returned no visible fee rows in this review context. FEE-1 therefore captured and invented no public USDⓈ-M numeric rate. Missing schedule visibility is `UNKNOWN`, not a regular-user default and not permission to reuse the API reference's fictional examples.

Binance's current dedicated BNB fee FAQ states savings of up to 25% for Spot and Margin and up to 10% for Futures, subject to enablement and sufficient BNB. Those public maxima are admissible only as `SENSITIVITY_ONLY`.

Do not copy an entire public tier table into account truth. VIP qualification, symbol promotions, stablecoin columns, liquidity programs, jurisdictional tax, special commission, and account-specific settings can make a public row inapplicable. When no fresh sanitized account receipt exists, the exact account rate remains `UNKNOWN`.

## Discount, special, and tax boundary

For Spot, BNB payment requires both documented enablement flags, an eligible symbol, and sufficient BNB. Binance documents that the discount applies only to standard commission; it does not apply to tax or special commission. Tax and special may still be converted into BNB when BNB is used for payment, but conversion is not a rate discount.

The current official pages are not safe to normalize from the `discount` number alone: the API schema describes a remaining-rate style example (`0.75000000`), while the FAQ includes a `0.25000000` example and a multiplication formula whose wording can be read differently. Normalization therefore occurs before this boundary. The frozen receipt accepts only:

- `application = APPLIED_TO_STANDARD_ONLY` with a known `standardPayableMultiplier` in `[0, 1)`, and `feeAsset = BNB`;
- `application = NOT_APPLIED` with a known `standardPayableMultiplier = 1` and the venue's known ordinary fee asset;
- `application = UNKNOWN` with an unknown multiplier and `feeAsset = UNKNOWN`.

`standardPayableMultiplier` is the already-normalized fraction of standard commission that remains payable. The receipt has no reduction-fraction field and no alternate discount-interpretation enum. No code may infer a multiplier from a raw discount number, asset name, `feeBurn`, or public “25% off” label. A `discountAsset` such as `BNB` is a public asset symbol, not proof that the discount was usable.

For `CURRENT_ACCOUNT_RATE`, `NOT_APPLIED` is also evidence-bearing: Spot requires both account- and symbol-enablement source references, and USDⓈ-M requires the distinct fee-burn-status source reference. Without that proof, discount application is `UNKNOWN`. `PUBLIC_SCHEDULE` is always the no-BNB baseline; discounted public conditions and promotions are `SENSITIVITY_ONLY`.

## Units, precision, and rounding

- Canonical fee-rate unit: exact decimal fraction of one, encoded as a base-10 string without exponent notation.
- Conversion: `percent = fraction × 100`; `basis_points = fraction × 10_000`.
- Preserve sign. A rebate or negative maker rate must not be converted to an absolute cost.
- Keep venue, symbol, execution role, side, and commission family separate until a named scenario is assembled.
- Perform arithmetic with exact decimal or integer-scaled math. Binary floats are not evidence.
- A `KNOWN` decimal `"0"` is observed zero; it is distinct from `UNKNOWN` and `NOT_APPLICABLE`.
- Binance documents example calculations but does not specify one universal commission-asset rounding rule for all products, symbols, promotions, and assets. The frozen receipt accepts no rounding mode, rounding quantum, or exact fee-asset quantity field, so those remain outside its truth claim.
- Round only a presentation copy. Evidence retains the exact input strings and exact derived fraction.

For a Spot fill with a known `standardPayableMultiplier m`:

```text
standard = standard[role] + standard[side]
special  = special[role]  + special[side]
tax      = tax[role]      + tax[side]
rate     = standard * m + special + tax
```

When no discount applies, `m = 1`. If any required component, multiplier, or application is `UNKNOWN`, the exact total is `UNKNOWN`; a separately labeled sensitivity may still be produced from explicitly supplied sensitivity inputs.

## Strict sanitized-receipt allowlist

Input is reject-by-default. The frozen top-level receipt keys are exactly:

- `schema = FEE_TRUTH_RECEIPT`;
- `version = 1`;
- `sanitizationPolicyId = FEE1_STRICT_ALLOWLIST_V1`;
- `provenance`;
- non-empty, bounded, `scenarioId`-sorted `rows`.

The byte boundary accepts strict UTF-8 canonical JSON only: recursively key-sorted, compact separators, exactly one terminal line feed, no BOM, duplicate keys, trailing bytes, floating JSON numbers, or non-canonical spellings. Receipts are limited to 262,144 bytes and 512 rows. The caller must also provide a non-empty frozen allowlist of at most 4,096 canonical public symbols; a receipt symbol outside that independently supplied set is rejected.

`provenance` has exactly:

- `captureKind = OWNER_SUPPLIED_SANITIZED_CAPTURE`;
- whole-second canonical UTC `observedAtUtc`;
- whole-second canonical UTC `validUntilUtc`, strictly after observation and no more than 3,600 seconds later;
- `temporalScope = CURRENT_POINT_IN_TIME`;
- non-empty, sorted, unique `sources`.

The only provenance-source values are:

- `BINANCE_BNB_DISCOUNT_TERMS`
- `BINANCE_SPOT_ACCOUNT_COMMISSION_SCHEMA`
- `BINANCE_SPOT_COMMISSION_FAQ`
- `BINANCE_SPOT_FEE_SCHEDULE`
- `BINANCE_USDM_ACCOUNT_COMMISSION_SCHEMA`
- `BINANCE_USDM_FEE_BURN_STATUS_SCHEMA`
- `BINANCE_USDM_FEE_SCHEDULE`

Each row has exactly `scenarioId`, `truthState`, `venue`, `symbol`, `role`, `side`, `chargeBasis`, `standard`, `special`, `tax`, `discount`, and `sourceFieldRefs`. `scenarioId` is not owner-entered identity; it is deterministically derived as:

```text
fee1.{truthState.lower}.{venue.lower}.{symbol.lower}.{role.lower}.{side.lower}
```

The frozen dimension enums are:

- `venue`: `BINANCE_SPOT` or `BINANCE_USDM`;
- `role`: `MAKER`, `TAKER`, or `RPI`;
- `side`: Spot uses `BUY` or `SELL`; USDⓈ-M uses `BOTH`;
- `chargeBasis`: `RECEIVED_ASSET_AMOUNT` or `USDM_QUOTE_NOTIONAL`;
- `truthState`: `CURRENT_ACCOUNT_RATE`, `PUBLIC_SCHEDULE`, `SENSITIVITY_ONLY`, or `UNKNOWN`.

`standard`, `special`, `tax`, and `discount.standardPayableMultiplier` are rate-state unions: `KNOWN` requires an exact signed plain decimal string in `[-1, 1]`; `UNKNOWN` requires `decimal = null`; `NOT_APPLICABLE` also requires `decimal = null`. Spot standard/special/tax are never `NOT_APPLICABLE`. USDⓈ-M special and tax are always `NOT_APPLICABLE`, a structural omission rather than an observed zero.

Spot rows use `RECEIVED_ASSET_AMOUNT`, always identify `BUY` or `SELL`, and never use `RPI`; `CURRENT_ACCOUNT_RATE` Spot rows require known standard/special/tax values. Before the boundary, the sanitizer combines the selected role and side fields within each commission family, while `sourceFieldRefs` proves both inputs. A Spot `PUBLIC_SCHEDULE` row is strictly `NOT_APPLIED`; its special and tax values remain `UNKNOWN`. USDⓈ-M rows use `USDM_QUOTE_NOTIONAL` and `side = BOTH`; RPI is admitted only from current account truth because no public RPI schedule field is frozen. An `UNKNOWN` row has unknown standard and discount truth; Spot unknown rows also keep special and tax unknown.

`discount` has exactly `application`, `feeAsset`, and `standardPayableMultiplier`. Applications are `APPLIED_TO_STANDARD_ONLY`, `NOT_APPLIED`, or `UNKNOWN`; fee assets are `BNB`, `RECEIVED_ASSET`, `SETTLEMENT_ASSET`, or `UNKNOWN`.

`sourceFieldRefs` is a sorted, unique list from the frozen enum. It may identify only the documented Spot account standard/special/tax role-and-side fields, Spot account discount asset/enablement/multiplier fields, Spot or USDⓈ-M schedule maker/taker fields, USDⓈ-M account maker/taker/RPI fields, USDⓈ-M BNB discount status, or the normalized Spot/USDⓈ-M BNB payable multiplier. Every field reference must match the row's venue, role, side, truth state, and a declared provenance source. An `UNKNOWN` row has no field references.

Everything else is forbidden, including arbitrary metadata and extensions. In particular, reject raw API keys, signatures, secrets, headers, cookies, request URLs with query strings, raw response bodies, account/subaccount/user IDs, order/trade/client IDs, IP or device data, names, email addresses, phone numbers, postal addresses, bank/card/wallet/payment identifiers, balances, positions, transfers, withdrawals, deposits, and free-form notes.

Symbols, venue names, `BNB` as a public asset symbol, canonical timestamps, frozen enums, nulls required by rate states, and exact rate strings are the only intended data classes. Unknown keys fail validation rather than being silently dropped. Validation errors report stable reason codes only, never field paths or rejected values.

The sanitized receipt must itself be secret-free before it reaches this adapter. This adapter is not a sanitizer for a raw private response and never fetches private data.

The offline CLI reads only standard input and requires an explicit evaluation clock plus one or more frozen expected symbols:

```text
uv run --locked --no-sync python -m quant_edge.fee_truth --evaluation-time-utc 2026-07-28T00:01:00Z --expected-symbol BTCUSDT
```

It writes one canonical `N3FeeScenarioInputsV1` artifact on success. Every failure writes only the fixed rejection line to standard error and emits no partial artifact.

## Freshness and provenance

The provenance tuple is fixed to `captureKind = OWNER_SUPPLIED_SANITIZED_CAPTURE`, `observedAtUtc`, `validUntilUtc`, `temporalScope = CURRENT_POINT_IN_TIME`, and enum `sources`. There is no `effectiveAtUtc`, `expiresAtUtc`, free-form source kind, or arbitrary source URL in the receipt.

Before `observedAtUtc` or after `validUntilUtc`, a row projects as `UNKNOWN` for current decisions. The adapter rejects validity windows longer than 3,600 seconds; this is a conservative adapter policy horizon, not an exchange guarantee that a rate remains unchanged for one hour. A consumer may retain the receipt as a dated artifact, but may not relabel it fresh. Public-source review time proves only when documentation was inspected; it does not prove when an account rate was effective.

## Deterministic consumer conversion

The adapter's output is a fee-cost input, not an edge verdict:

1. Resolve one venue, symbol, role, side, charge basis, discount application, and already-normalized payable multiplier per scenario row.
2. Produce the exact effective rate fraction and its truth state without presentation rounding.
3. Preserve each leg independently. Do not average Spot and USDⓈ-M rates or maker and taker rates.
4. When the downstream harness accepts basis points, use `fraction × 10_000` exactly. When it accepts a per-notional cost, use `notional × fraction` in the same quote unit.
5. For a `$1,000` normalization, use the harness's explicit leg-notional weights: `costPer1000 = 1000 × Σ(weight_i × effectiveRate_i)`. Never assume whether “$1,000 deployed” means `$1,000` per leg or `$1,000` total.
6. If a fee is paid in base asset or BNB, exact quote-cost conversion additionally requires a time-aligned conversion price and an explicit valuation convention. Without them, quote cost is `UNKNOWN`; the rate scenario may remain available.
7. Keep hypothetical inputs in `SENSITIVITY_ONLY` rows. A `CURRENT_ACCOUNT_RATE` row applied to older public fills retains `temporalUse = CURRENT_RATE_COUNTERFACTUAL` and `historicalAccountActualState = HISTORICAL_ACCOUNT_ACTUAL_UNKNOWN`. Emit `UNKNOWN` when a required rate, role, side, discount application, conversion price, or notional convention is absent.
8. Treat a generic `UNKNOWN` row as a per-route fallback for the account and public base scenarios. A route-specific `CURRENT_ACCOUNT_RATE` or `PUBLIC_SCHEDULE` row deterministically takes precedence only in its matching base scenario, so the adapter never emits duplicate consumer route keys.

The N-3 artifact preserves `captureKind`, the sorted provenance-source enums, the observation and validity window, temporal scope, sanitization policy, and the digest of the accepted normalized receipt. Its units declare exact reduced rate fractions, exact basis-point conversion, `monetaryRounding = NONE` for adapter arithmetic, and `exchangeFeeAssetRounding = UNKNOWN` for exchange asset-quantity rounding that the receipt does not prove.

### Consumer boundary

- **Basis:** consumes one exact four-fill, one-symbol topology: exactly two Spot routes and two USDⓈ-M routes. The two Spot routes must be the explicit `BUY` and `SELL` sides; every route retains its explicit maker/taker/RPI role and venue-specific charge basis. A complete Basis cost requires all four addressed fills, and an adverse run requires one shared explicit base scenario.
- **Volume:** consumes exactly one Spot entry and one Spot exit for the same symbol, with opposite explicit `BUY`/`SELL` sides. Its projection is labeled `consumer = Volume` and `schema = VolumeFeeProjectionV1`; it cannot consume USDⓈ-M routes, inherit a Basis rate, or use a regular-user default.
- **S-1:** consumes exactly one explicit entry and exit for the same symbol and venue. Spot entry/exit sides must be opposite `BUY`/`SELL`; USDⓈ-M uses the explicit `BOTH` fee dimension for each fill. Its projection is labeled `consumer = S-1` and `schema = S1FeeProjectionV1`. Candidate reruns retain exact scenario/base labels, and sensitivity values remain separate from primary values.
- **N-3:** may compare the prior proxy against a sanitized current-rate counterfactual, but it may label account-actual only realized fill receipts. A current receipt applied to the 12-month E-1/Volume sample is `CURRENT_RATE_COUNTERFACTUAL` with `HISTORICAL_ACCOUNT_ACTUAL_UNKNOWN`, not historical actual.

These research files perform no network call at runtime, alter no account or provider state, and authorize no order, transfer, withdrawal, deployment, landing, canary, or funding decision.
