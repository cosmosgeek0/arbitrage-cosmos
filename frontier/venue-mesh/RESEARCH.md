# VenueMesh current-source research receipt

Research cutoff: `2026-07-15T19:49:03Z`.

Only official exchange documentation and legal/terms pages were used. The retrieved documentation informed fixture schema and capability descriptions; it did not authorize live access, retention, redistribution, or production use.

| Venue | Official source | Retrieved content SHA-256 | Fixture use |
|---|---|---:|---|
| Coinbase | `https://docs.cdp.coinbase.com/api-reference/exchange-api/rest-api/products/get-all-known-trading-pairs` | `d79cd6d8473d8f35e9a8e85850e904d2b0faf1c9e6ae637d922a6fdc6d52a2f7` | Product identity, status, increments |
| Coinbase | `https://docs.cdp.coinbase.com/exchange/websocket-feed/channels` | `3542734efeac3497cf0997926b160b50c231d08f33ca540931b1bba04244a3d9` | Ticker and match schema, timestamp and sequence fields |
| Coinbase | `https://www.coinbase.com/legal/market_data` | `UNAVAILABLE` (`curl` returned HTTP 403; page reviewed through browser) | Terms reference only; retention/redistribution remain `REVIEW_REQUIRED` |
| Kraken | `https://docs.kraken.com/exchange/api-reference/spot-websocket-v2/instrument` | `55234e13e91abff82e4c3e52b7a1be0eafdf61929fdfb13d1cd0e4d884a2fb55` | Instrument identity, status, increments |
| Kraken | `https://docs.kraken.com/exchange/api-reference/spot-websocket-v2/book` | `160bada19e919edc659c212702be6ba7343be5c208b8e722368e15ac3d32367a` | Book levels and checksum; no fabricated numeric sequence |
| Kraken | `https://www.kraken.com/en-ca/legal/global-terms` | `69f899156b00e8d1e1bdaa114e66097baa57e9d31c62c68ca9d221bfbd360531` | Terms reference only; retention/redistribution remain `REVIEW_REQUIRED` |
| Deribit | `https://docs.deribit.com/api-reference/market-data/public-get_instrument` | `778419c4fe1f948f9e3e848be6a468e77e469aa8d5fe32b429ed688ed14ccfc9` | Futures/options identity, contract size, expiry, strike, status |
| Deribit | `https://docs.deribit.com/api-reference/market-data/public-ticker` | `9a1df3ee594411330132ae7066896ea2515b4ab35027fce6d42a629b52953a44` | Best bid/ask, mark, index, funding, open interest |
| Deribit | `https://support.deribit.com/hc/en-us/sections/25944487080477-Legal` | `UNAVAILABLE` (`curl` returned HTTP 403; page reviewed through browser) | Legal reference only; retention/redistribution remain `REVIEW_REQUIRED` |

Research consequence: examples are pinned synthetic schema fixtures only. All three source cards remain `REFERENCE_ONLY`; all market-data retention and redistribution gates fail closed until Q and the relevant legal/policy owner approve exact source terms, geography, sampling, retention, and producer ownership.
