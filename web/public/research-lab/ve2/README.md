# V-I2 prospective Volume measurement packet

This packet freezes a forward-only measurement policy before any outcome
interval is activated or opened. It supplies a bounded public capture utility,
an append-only SHA-256 evidence format, and a deterministic network-free replay
entry point for the source-only Volume forward-measurement engine.

It does not contain evidence from a measurement interval. It does not claim
profitability. `N-3` remains
`BLOCKED_VE2_INTERVAL_NOT_TERMINAL_ACCEPTED`.

## Frozen prospective activation

The policy is `VOLUME_MEASUREMENT_MAX_HOLD_60S_V1`. Its activation timestamp is
deliberately `null`: no accepted capture-ready activation exists yet.

After an independent exact-hash capture-ready acceptance, the scored interval
starts at the first UTC midnight at least 24 hours later. Four hours immediately
before the derived start are unscored warm-up. The scored interval is exactly
`2592000000` ms (30 days) and cannot mature until `62000` ms after its exclusive
end. Those timestamps must be derived and sealed in separate activation
evidence; this packet never fabricates them.

The sample universe is every non-pseudo Volume detector proposal accepted and
prospectively captured during the frozen interval whose symbol is proven
TRADING, Spot-enabled, USDT-quoted, and unblocked by the exact point-in-time
exchangeInfo/config state bound to that proposal. The packet introduces no
rolling-volume threshold and does not independently reconstruct a symbol
universe. A later configuration, exchangeInfo response, or current book must
never be substituted for earlier state.

Each accepted detector proposal can create at most one shadow record-only
lifecycle. Entry is the first accepted source-native 2-second cut bound to the
proposal, modeled at exactly `10.00 USDT` against synchronized displayed depth.
Exit is the first accepted source-native 2-second cut at or after 60 seconds.
Missing continuity, filters, full displayed capacity, or an eligible exit cut
rejects the lifecycle; none is silently filled.

Proposal admission ends at the exclusive 30-day interval end. Evidence remains
open for the separate 62-second maturity horizon only so already-admitted
proposals can reach their final source-native exit cut. A proposal first
observed during that maturity tail never enters the sample.

The only fee outputs allowed are explicit public scenarios of 10 bp/side and
12 bp/side. Source-native or account-effective fees remain `UNKNOWN`.
Partial-interval economics and all outcome access before maturity are
forbidden.

## Evidence contract

Capture uses only:

- public `GET` requests to `https://data-api.binance.vision` for exchangeInfo
  and depth snapshots capped at 100 levels;
- public `wss://data-stream.binance.vision:443` combined streams for
  `depth@100ms`, `aggTrade`, `trade`, and `bookTicker`;
- Binance's default millisecond stream timestamps without conversion;
- `process.hrtime.bigint()` as the local monotonic receipt clock.

Each public-source JSONL row contains the exact source payload bytes after HTTP
content decoding or WebSocket decompression and before JSON parsing. For the
combined WebSocket, the exact outer frame is appended and fsynced immediately;
the immediately following typed row repeats those identical bytes and callback
entry clocks while binding the combined `stream`. Its derived inner byte
offset/length plus outer and inner hashes are reconciled in the
generation-close ledger. Canonical replay requires this raw-first adjacency and
parses that exact outer frame.
Rows bind the raw payload hash, prior-row hash, generation, receipt clocks,
source, and transport state. A reconnect starts a new generation and a
diff-depth gap invalidates that generation and requires a new snapshot; it
never permits filling history.

Snapshot bootstrap continuity lists all and only retained applied diff frames
in exact order, from the snapshot update ID through the final applied update
ID. Stale buffered frames remain preserved in the raw ledger but never appear
in the applied continuity proof. Any record/byte truncation is named and makes
the generation ineligible for exact mechanics.

One canonical chain is deliberately bounded to at most `100000` records and
`268435456` canonical JSONL bytes, so a terminal 30-day interval is an ordered,
non-empty set of independently sealed segments. `DETECTOR_COVERAGE` segments
form one exact, non-overlapping partition of every 2-second detector cut from
interval start through the 62-second maturity boundary; proposal admission
still closes at the interval end. They bind the accepted-proposal ID, revision,
digest, and symbol universe to a frozen detector source ID/digest and chained
batch digests. Overlay `SYMBOL_LIFECYCLE` segments retain the public source cuts and
fully closed record-only lifecycle for each accepted proposal. Segment
rotation never creates permission to omit, overlap, or reconstruct an
interval.

The terminal manifest inventories every segment in deterministic order and
binds the inventory with a caller-held SHA-256 root. Each descriptor is
recomputed from the exact bounded JSONL file by the canonical evidence verifier
and canonical Volume replay; manifest counts and status strings are never
trusted as assertions. Detector segments must cover the scored interval and
frozen maturity tail with zero missing cuts, at most 2000 ms between cuts, and
zero uncovered duration. Every accepted detector proposal must map exactly once, including
the same digest and symbol, to a fully closed lifecycle. A terminal zero-sample
result is possible only when that complete detector partition proves that the
accepted-proposal universe was empty.

The packet carries no key, signature, authentication, cookie, private/signed
endpoint, submit port, CAS port, order, transfer, withdrawal, host, provider, or
money authority. Strategy is DEFAULT OFF, the kill switch is ON, and replay is
SHADOW ONLY / record only.

## Verify and replay

From the repository root:

```sh
npm run build -w server
node quant/research/ve2/verify.mjs
node --test quant/research/ve2/verify.test.mjs
(cd quant/research/ve2 && shasum -a 256 -c SHA256SUMS)
node quant/research/ve2/replay.mjs \
  --evidence /absolute/path/capture.jsonl \
  --expected-policy-digest sha256:<capture-frozen-policy-digest> \
  --expected-terminal-hash sha256:<independently-held-terminal-hash>
```

The evidence CLI is a thin adapter over the single canonical
`cosmos.engine.volume.forward-measurement-evidence.v1` implementation emitted
at `server/dist/engine/volume/forwardMeasurementEvidence.js`; a server build is
a prerequisite. It never creates a second research-only evidence schema and
accepts no caller-selected evidence or measurement module. Replay inputs must
be bounded regular files; special files and oversized files or lines fail
closed.

The replay command is network-free and is fixed to the single canonical
`server/dist/engine/volume/forwardMeasurementReplay.js` named export. There is
no custom-module override. Every symbol terminal `CONFIG_STATE`, and every
detector terminal descriptor, must bind `FORWARD_MEASUREMENT_SEGMENT_V1`;
`SMOKE_MECHANICS_ONLY` can never satisfy a terminal manifest. Each terminal
segment must bind both the bare SHA-256 of
`measurement-policy.v1.json` and the distinct canonical core `POLICY` digest,
plus the accepted activation, interval, detector source, cut, hold, notional,
proposal-universe, segment-predecessor, and no-authority rules. The canonical
result must prove SHADOW ONLY, record only, DEFAULT OFF, KILL ON, and zero
submit/CAS/private/order/transfer/withdrawal/money authority.
The packet-policy SHA and core-policy digest are not interchangeable. Every
segment replay requires a caller-held expected core-policy digest and expected
terminal hash, and terminal validation additionally requires a caller-held
segment-inventory root. Replay never derives its own trust anchor from the
evidence being checked. Missing, wrong, or merely recomputed-in-file anchors
fail closed.
An explicit `--integrity-only` still requires both anchors, verifies the
canonical sealed evidence without lifecycle replay, and keeps N-3 blocked.

## Explicit public smoke

No public smoke runs by default. A bounded one-symbol mechanics check requires
both an explicit opt-in flag and a new output path:

```sh
node quant/research/ve2/smoke-capture.mjs \
  --run-public-smoke \
  --symbol BTCUSDT \
  --duration-ms 5000 \
  --max-records 1000 \
  --max-bytes 16777216 \
  --output /absolute/new/path/ve2-smoke.jsonl
```

> SMOKE_MECHANICS_ONLY — validates capture, schema, clocks, chain/dedupe,
> checksums, and serialization using synthetic or pre-interval data. Smoke rows
> are permanently excluded from the VE2 universe, sample counts, economics,
> uncertainty, N-3, and every profitability or capacity claim. A passing smoke
> is not a strategy sample, fill, return, fee or slippage measurement, drawdown,
> capacity proof, edge, or execution authority.

The smoke symbol is not a scored-universe claim. The CLI uses one public
exchangeInfo GET per generation, depth snapshots capped at 100, and the frozen
combined `/stream?streams=...` public market-data URL, with hard
time/record/byte/generation bounds, no redirects, and no retry beyond its
two-generation ceiling. `SMOKE_MECHANICS_EXACT` requires the combined-URL open
acknowledgement, point-in-time exchangeInfo, snapshot-to-diff bridge, exact
continuity, every four stream kinds, exact outer-frame mapping, displayed-book
agreement, and a complete aggregate-trade proof containing every constituent
trade ID with exact price, maker side, generation, and quantity sum. At the
first exact source cut the socket is paused, real time passes the one-millisecond
smoke expiry, and only then are the expired detector proposal and its exact
chained OBSERVED/BLOCKED record-only assertions appended. No later source row
can slip between that cut and proposal. Exact smoke accepts only the named
`DETECTOR_PROPOSAL_EXPIRED` replay reason. Any short, truncated, or interrupted
capture lacking one of those facts seals only under the explicit
incomplete-preservation profile and reports
`BLOCKED_SMOKE_MECHANICS_INCOMPLETE`; it can never report success.

The activation, segmented terminal-manifest, and outcome-open schemas have executable
companion validators in `verify.mjs`. They enforce the first qualifying UTC
midnight, 24-hour lead, four-hour warm-up, exact 30-day interval, 62-second
maturity lag, exact detector-cut partitioning, proposal/lifecycle bijection,
activation/manifest hashes, and deterministic IDs. Acceptance requires
caller-held expected capture commit, capture-implementation SHA-256,
packet-policy SHA-256, detector source digest, detector-coverage core-policy
digest, every segment core-policy/terminal/file hash, and the canonical
segment-inventory root. A self-consistent recomputed chain is not an anchor.
The outcome-open lock identity is derived solely from the recomputed terminal
manifest and is intended for exclusive-create, single-open storage.

A complete interval with zero accepted detector proposals is truthful terminal
evidence, not an invitation to fabricate a sample. Its reconciled proposal
counts are all zero, `proposalSampleState` is `NO_ACCEPTED_PROPOSALS`,
economics remain `UNKNOWN`, profitability remains false, and N-3 still requires
independent terminal acceptance.

## Official sources

`official-sources.v1.json` binds the inspected official Binance Spot
documentation revision `6b8372cad7cecbdf5dd88a3372eafff51988c5cf`
and SHA-256 hashes for WebSocket streams, REST market data, filters, and the
market-data-only origins. These sources define current public mechanics; they
do not create historical book or local receive-time evidence.
