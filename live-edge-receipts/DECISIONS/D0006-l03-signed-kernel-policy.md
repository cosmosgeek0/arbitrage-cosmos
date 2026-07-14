# D0006 — L03 signed-kernel construction policy

Status: `ACCEPTED_FOR_LANE_L03`

Date: `2026-07-12`

Authority: L-lane stateless construction policy only. This decision does not
grant credential, transport, private-read, order, Margin, execution,
reconciliation, persistence, deployment or capital authority and does not
rewrite accepted L02 evidence.

## Verified controlling bytes

- Spot pinned repository commit remains
  `31643ed390e2aa450ce872981556186acf96a195`.
- Spot `rest-api.md` SHA-256 remains
  `49ea6809243fc7fb426e07f2fe662097736c7bb405bd2da5eef637d715427999`,
  exactly the captured L02 source.
- USD-M `general-info.md` SHA-256 remains
  `b2e647582fb3ae4cae3a79d6f6f6030d0c03cf403d05176117b24094a083521b`,
  exactly the captured L02 source.
- The rendered USD-M page now displays a July 10, 2026 modification date while
  the accepted L02 record says June 26. Unchanged raw bytes make this visible
  metadata drift, not a semantic source change.

## Construction decisions

- Select HMAC-SHA256 only for both Spot and USD-M in L03. Spot also supports
  RSA and Ed25519. The USD-M general page normatively describes HMAC-SHA256 and
  separately illustrates PKCS#8 RSA; L03 treats RSA as an official alternative
  outside the selected implementation, not as permission to widen the signer.
- Interpret USD-M `permittedKeyTypes: ['HMAC']` in accepted L02 as the selected
  lane subset. It is not an exhaustive claim that official USD-M documentation
  contains no RSA illustration. A future matrix-schema revision should name
  selected versus officially illustrated key types separately; L03 does not
  mutate the accepted matrix.
- Never accept key material, API keys, key IDs or credentials. A call-scoped
  injected signer receives only canonical bytes and returns a validated digest;
  its thrown cause/message/stack is discarded without inspection.
- Reject sensitive parameter aliases, credential-shaped parameter values and
  credential-shaped opaque handles/references before they can reach signing or
  documentary state. Request correlations use the exact Foundation
  `cor_<16-lowercase-hex>` form.
- Use query-only placement for L03 REST construction, including POST/PUT/DELETE,
  so `totalParams` is one unambiguous sequence. No caller chooses query/body
  split and the malformed USD-M mixed query/body example is not a positive
  request vector.
- Expose unsigned construction independently for inspection and testing. The
  signed entry point repeats every contract, parameter, clock and identity gate
  from raw caller input; it never accepts caller-prepared canonical bytes.
- Per-order cancel construction requires the exact Foundation-derived
  `origClientOrderId` form and never mints a replacement. Broad cancel-all and
  countdown-cancel contracts stay mechanically blocked because their L02
  documentary contracts do not bind one deterministic order identity.
- Sort parameter names by code point as a deterministic local policy. Binance
  permits parameters in any order and does not mandate sorting; official HMAC
  vector parity therefore signs the exact published byte sequence separately
  from canonical-construction tests.
- Encode UTF-8 parameter components with RFC 3986 form-safe percent encoding,
  preserving exact decimal strings byte-for-byte. Caller-supplied percent
  sequences, duplicate/reserved parameters and unsafe text fail closed.
- Construct integer-millisecond timestamps. Use an evidence-backed local UTC
  anchor plus monotonic send/receive values; monotonic values alone can never
  be subtracted from exchange epoch time.
- Fresh clock evidence permits at most 100 ms sample dispersion after rejecting
  samples more than 250 ms from the median offset.
- Operational `recvWindow` is at most 5000 ms for both products. Spot's
  documented 60000 ms maximum remains an outer source fact, not the selected
  operating window. USD-M's general page recommends 5000 ms or less and does
  not prove one universal maximum across every endpoint.

## Rate, cooldown and ambiguity decisions

- L02 rate claims are endpoint costs, not complete account/IP capacity. L03
  never fabricates a remaining quota from those values; missing capacity and
  missing headers remain unknown.
- Pre-dispatch quotes always reserve the worst accepted conditional cost
  atomically across request-weight and order-count dimensions. Caller-authored
  condition labels can never downgrade that reservation.
- Rate state is V2, starts with unknown usage until exact canonical headers
  prime a window, enforces non-regressing header chronology and validates every
  event against the exact L02 cost/source/dimension contract.
- Spot documents `Retry-After` on 429/418 as delta-seconds, so L03 accepts only
  bounded canonical digit seconds for Spot. USD-M does not currently prove
  header emission or units; a USD-M `Retry-After` value cannot establish an
  automatic next-safe time.
- 429 blocks until proved safe. 418 opens a manual circuit. Missing, malformed,
  regressed or overflowing rate evidence never becomes zero or shortens a
  cooldown.
- Read-only retry advice is bounded data only. Order mutations, test orders,
  cancels, Margin mutations, private-stream controls and every ambiguous
  outcome always produce `NO_AUTOMATIC_RETRY`.
- Ambiguity is only a transport fact mapped one-way to existing Foundation
  vocabulary. L03 creates no execution lifecycle event or reconciliation
  result. A terminal-evidence reference is only a hand-off candidate and can
  never clear an ambiguous outcome. Request-attempt identity accepts only the
  L03 request-ID form and the Foundation-derived client-order-ID form.
  Crash-safe duplicate prevention remains a later canonical Ledger/checkpoint
  integration requirement.

## Official-document inconsistencies retained

- USD-M illustrates RSA after its HMAC-SHA256 signed-endpoint rule.
- The USD-M HMAC curl example contains `fapi/binance.com` while the declared
  current base is `fapi.binance.com`; L03 resolves the accepted L02 contract and
  never consumes the example host.
- The USD-M mixed vector signs whitespace not present in the transmitted curl
  body and is excluded as an end-to-end positive vector.
- Spot contains a malformed rendered RSA non-ASCII intermediate line; the
  selected HMAC vectors and encoded bytes are unaffected.

## External boundary

The source verification read only public official documentation. No exchange
API endpoint, private account, signed request, test/live order, Margin action,
deployment/restart, cloud/secret mutation or capital change was performed.
`LIVE_EXECUTION_NOT_IMPLEMENTED` remains unchanged.
