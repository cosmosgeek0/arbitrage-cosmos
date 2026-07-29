# S-1Q: USD-M funding-sign-flip mean reversion

S-1Q is a sealed, public-only research packet for a materially distinct event
family: at a common settled-funding timestamp, it pairs symbols whose funding
sign flipped positive-to-negative (long) against symbols whose sign flipped
negative-to-positive (short). It never ranks funding levels, uses acceleration,
uses basis/premium/volume as a signal, adds a spot leg, or forecasts funding.

The frozen protocol is [`protocol.v1.json`](protocol.v1.json). Official-source
semantics and the pre-outcome unknowns are frozen in
[`OFFICIAL_SOURCE_RESEARCH.md`](OFFICIAL_SOURCE_RESEARCH.md).

## Lifecycle

The evaluator has two mutating commands and refuses unsafe paths:

```bash
python quant/research/s1q/experiment.py freeze \
  --shared-root /private/tmp/cosmos-s1d-funding-dispersion-v1/raw \
  --state-root /private/tmp/cosmos-s1q-usdm-funding-sign-flip-v1

python quant/research/s1q/experiment.py run \
  --shared-root /private/tmp/cosmos-s1d-funding-dispersion-v1/raw \
  --state-root /private/tmp/cosmos-s1q-usdm-funding-sign-flip-v1
```

`freeze` first writes `preseal.v1.json`, binding the source note, protocol,
evaluator, and tests before any archive member is opened. It then verifies
publisher checksum custody, opens only June 2025 contract-kline screen cells,
freezes the top-40 universe, inventories every required source cell without
opening development or holdout bodies, and writes the final `freeze.v1.json`
binding the preseal, June receipt, universe, and source manifest.
Holdout inventory is stricter: before admission it reads only paths, stat sizes,
and adjacent sidecars. Holdout ZIP payloads are neither read nor hashed until
after candidate seal and the holdout-open marker.

The first final-freeze attempt exposed one selected-symbol availability cell:
`FUNUSDT` has no May 2026 funding-rate ZIP. The preserved protocol already
required missing future data to invalidate a cohort without symbol
replacement. A create-once `PRESEAL_CORRECTION.v1.json` transparently binds the
original and corrected evaluator/test hashes; `resume-freeze` preserves the
original June screen and universe and implements that pre-outcome rule. It does
not repeat the screen.

`POSTRUN_VERIFICATION.v1.json` is the authoritative count-semantics erratum:
the frozen `publisher_checksum_count=1560` field counts source cells. There are
1,554 present publisher checksums, 1,200 verified non-holdout ZIPs, 354
unread/unhashed deferred holdout ZIP payloads, and six explicit unavailable
FUNUSDT holdout cells. The erratum does not change the protocol, run, outcome,
or verdict.

`run` atomically creates `RUN_CONSUMED.v1.json` before the first development
archive member is parsed. It cannot be run again, including after failure.
Holdout ZIP bodies remain unopened unless every development gate passes and
`candidate_seal.v1.json` is written first. The holdout-open marker is created
before the first holdout member is parsed.

## Authority boundary

This packet performs no private, signed, host, UI, order, test-order, transfer,
withdrawal, provider, or money action. Hourly opens, public fee assumptions,
mark opens, and prior-day quote volume are proxies. Publication causality,
archive `rateType`, account-effective fees, executable capacity, depth, spread,
filters, latency, and fills remain `UNKNOWN`. Public-only `GO` and capital
authority are structurally unavailable.
