# V-G12 official-source research

Research checked on 2026-07-29 before the V-G12 protocol, evaluator, or verifier
was written.

## Primary Binance sources

- Binance's official public-data repository documents monthly Spot kline archives,
  companion `.CHECKSUM` files, the twelve kline fields (including quote-asset
  volume), the possibility of later archive corrections, and Spot microsecond
  timestamps from 2025-01-01:
  <https://github.com/binance/binance-public-data/blob/master/README.md>
- The current official Spot REST contract says klines are uniquely identified by
  open time, uses UTC by default, and publishes quote-asset volume:
  <https://github.com/binance/binance-spot-api-docs/blob/master/rest-api.md#klinecandlestick-data>
- Current Spot filter documentation defines `LOT_SIZE`, `MARKET_LOT_SIZE`,
  `MIN_NOTIONAL`, and `NOTIONAL`. The monthly kline archive does not contain
  historical exchange-filter snapshots:
  <https://developers.binance.com/en/docs/products/spot/filters>
- Official commission documentation shows that standard, special, tax, and
  discount commission truth can be account/order-specific and requires
  authenticated access. V-G12 makes no private or signed request:
  <https://developers.binance.com/en/docs/products/spot/faqs/commission_faq>

## Methodological sources

- Shannon defines entropy for a probability distribution. V-G12 applies the
  discrete formula to each cohort member's share of cohort quote volume and divides
  by `ln(30)` so both frozen windows are on the same `[0,1]` scale. Quote-volume
  masses, medians, logarithms, and comparison use frozen 80-digit decimal
  arithmetic with a `1E-40` tolerance:
  <https://doi.org/10.1002/j.1538-7305.1948.tb00917.x>
- Politis and Romano introduce dependence-aware block resampling. V-G12 uses a
  seeded circular block bootstrap with a frozen four-week block length; it does not
  claim iid or normal returns:
  <https://doi.org/10.1080/01621459.1994.10476870>
- White explains why reuse of one history across a specification search can create
  false discoveries. V-G12 is one frozen trial, but the surrounding V-G program is
  a larger global search and has no valid program-wide multiplicity adjustment:
  <https://doi.org/10.1111/1468-0262.00152>
- Related crypto research has applied Shannon entropy to portfolio construction.
  It motivates measurement only; it does not validate V-G12's direction, threshold,
  schedule, or economics:
  <https://arxiv.org/abs/2210.02633>

The current pre-freeze distinctness audit bound exact protocol hashes for V-G8,
V-G9, V-G10, and V-G11 and returned `MATERIAL_DISTINCTNESS_PASS`. V-G8 shares
weekly dates and quote-volume input but not V-G12's entropy transform or action.
Sibling outcomes are correlated search evidence and cannot be counted as
independent confirmation.

## Frozen interpretation

Quote-asset volume is used only for point-in-time eligibility, lagged liquidity,
cohort construction, and the two entropy windows. Price is used only after the
signal is fixed to measure the Tuesday-to-Tuesday public research return. Taker
fields, trade counts, futures data, private data, and account state are not signal
or selection inputs. A daily quote-volume zero is valid public data; a cohort
window whose aggregate quote-volume mass is zero has unresolved entropy and holds
cash.

The archive and its sidecars are source evidence, not fill evidence. The frozen
10/10, 10/25, and 20/25 fee/adverse-execution basis-point pairs are scenarios.
Account-effective fees are `UNKNOWN`; historical spread, impact, order-book depth,
filter compliance, and executable book capacity are `UNMEASURED`. The reported
capacity statistic is a public quote-volume participation proxy only. Its equal-
weight total `C_1BP` is capped by the weakest cohort leg: cohort size times the
minimum member's lagged median daily quote volume times one basis point.

Monthly archives are admitted only after exact full-shared-scope manifest
row/absence metadata, count, and digest reconstruction. The continuous V-G12
month range is then derived as an exact ordered subset and bound as a separate
pair/absence inventory; shared rows outside that slice remain authenticated. ZIP
The protocol is the independent root of trust for the exact full shared-manifest
raw hashes, month roster, universe, and pair/absence summaries; runner and
verifier require protocol, live manifests, and freeze to agree before slicing.
Thus a coherent live-manifest replacement cannot self-authorize a smaller scope.
ZIP and sidecar leaves are opened without following symlinks,
validated as regular files with descriptor metadata, and size-bounded before the
first content read. ZIP validation then covers one member, compression method,
flags, and compression ratio. Checksum/digest drift is terminal custody failure;
checksum-valid decompression, CRC, decode, CSV, and semantic faults remain
symbol-local causal ineligibility.

March through June 2026 is retrospective public history. Process sealing can
prevent the V-G12 evaluator from opening those archive bodies before qualification,
but it cannot turn that period into fresh forward evidence or erase any prior human
or program exposure.
