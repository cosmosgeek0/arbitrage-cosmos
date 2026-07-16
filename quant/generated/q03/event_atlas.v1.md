# Event Atlas V1

Registry revision: `q03.event-atlas.v1`
Registry SHA-256: `f8d59dea19be7a4f633f73deaccc3910b086c5a50fa03c07a1b4147ba297b21c`
Truth posture: `RESEARCH_ONLY`; rules are discovery descriptors, not event truth.
Later outcomes: `UNAVAILABLE`.

## Evidence tiers

- `HISTORICAL_COARSE`: `REAL_CHECKSUM_VERIFIED_ARCHIVE`; real coverage `OBSERVED`; delivery `AVAILABLE`; coverage `f2f23bbb394e6547222bfde5ed4bc8ed9551a771ad5bfe18c4c239ca70429104`
- `FORWARD_HIGH_FIDELITY`: `SYNTHETIC_CONTRACT_ONLY`; real coverage `MISSING`; delivery `BLOCKED`; coverage `f2f23bbb394e6547222bfde5ed4bc8ed9551a771ad5bfe18c4c239ca70429104`

## Discovery rules

- `absolute.price-range.5m.v1` `v1`: `PRICE_RANGE` / `ABSOLUTE` >= `1/20` over `300000000000` ns
- `absolute.trade-count.5m.v1` `v1`: `TRADE_COUNT` / `ABSOLUTE` >= `250/1` over `300000000000` ns
- `relative.price-range.previous-max.5m.v1` `v1`: `PRICE_RANGE` / `PREVIOUS_WINDOW_MAX` >= `2/1` over `300000000000` ns
- `relative.trade-count.previous-mean.5m.v1` `v1`: `TRADE_COUNT` / `PREVIOUS_WINDOW_MEAN` >= `3/1` over `300000000000` ns

## Bounded inventory

- Historical rows: `832`
- Candidates: `20` retained `20` omitted `0`
- Controls: `143` retained `143` omitted `0`
- Known gaps / invalid / duplicate: `0` / `0` / `0`
- Symbols: `BNBUSDT`
- Products: `spot`
- UTC dates: `2017-11-06`

Every retained record binds source coverage, row-derived instrument identity, available pre/evolution evidence, and an explicit unavailable economics/outcome posture.
