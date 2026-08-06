# B-E2 prospective basis evidence

This directory defines the research-only evidence boundary for replacing the
historical E-1 slippage and capacity proxies with prospectively recorded public
Binance Spot and USD-M observations. The frozen source of truth is
[`protocol.v1.json`](protocol.v1.json), SHA-256
`a1610965a4fea03d3e3f0a3580ed902da4c7cd48cdacc330a17e13008aa778a3`.
Nothing here grants order, account, capital, execution, deployment, or profitability
authority.

## Current official-source methodology

The protocol was frozen before outcome access. Its declared universe is
`BTCUSDT`, `ETHUSDT`, `BNBUSDT`, and `SOLUSDT`, always measured as long Spot and
short USD-M. The prospective interval is exact:

- start inclusive: `2026-07-29T00:00:00Z`;
- end exclusive: `2026-08-12T00:00:00Z`;
- duration: 14 days, with no outcome-driven early stop;
- late starts do not move the interval; missed time remains missing coverage.

The campaign methodology follows the currently published official interfaces:

- [Binance Spot REST API](https://developers.binance.com/en/docs/products/spot/rest-api)
  and the official
  [Spot API specification](https://github.com/binance/binance-spot-api-docs/blob/master/rest-api.md)
  for public `exchangeInfo` and standard order-book depth. Public Spot requests use
  the documented market-data-only origin `https://data-api.binance.vision`.
- [Binance USD-M REST market data](https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/market-data)
  for public exchange information, standard depth, RPI depth, mark/funding state,
  and funding history at `https://fapi.binance.com`.

The REST mechanics surface was inspected against those live official pages on
`2026-07-28`. Binance's USD-M developer pages do not expose a commit-addressed
documentation revision, so this repository does not pretend that a date label is
an immutable upstream pin. The reproducible local boundary is instead the
already-frozen protocol bytes and SHA-256 above. The smoke admits only these exact
live URLs:

```text
https://data-api.binance.vision/api/v3/exchangeInfo?symbol=BTCUSDT
https://data-api.binance.vision/api/v3/depth?symbol=BTCUSDT&limit=5000
https://fapi.binance.com/fapi/v1/exchangeInfo
https://fapi.binance.com/fapi/v1/depth?symbol=BTCUSDT&limit=1000
https://fapi.binance.com/fapi/v1/rpiDepth?symbol=BTCUSDT&limit=1000
https://fapi.binance.com/fapi/v1/premiumIndex?symbol=BTCUSDT
https://fapi.binance.com/fapi/v1/fundingRate?symbol=BTCUSDT&limit=1
```

The frozen protocol separately pins the official Spot WebSocket/filter sources at
commit `6b8372cad7cecbdf5dd88a3372eafff51988c5cf` and the official public-archive
methodology at commit `5c7f3197591c0d54d85dc43066226bc4c671d47a`.

The full campaign—not this smoke—must preserve synchronized streams, snapshot
bridges, sequence continuity, source times, local receive clocks, configuration
epochs, immutable payload checksums, and sealed journal completeness. Standard
depth and RPI depth remain separate. The official RPI snapshot has no accepted
snapshot-to-stream bridge here, and public visibility does not prove API taker
eligibility. RPI therefore cannot be merged into standard depth or used to claim
executable capacity.

## E-1 proxy boundary

E-1's historical slippage and capacity inputs remain proxies. A current REST
snapshot cannot backfill historical depth, reconstruct queue position, establish a
four-hour round trip, or convert an E-1 proxy into observed execution evidence.
Only complete observations admitted under the already-frozen B-E2 protocol during
the exact future interval may replace those proxy inputs.

The included `smoke.py` is narrower still. It makes seven sequential, keyless
public GETs for the protocol's smoke pair (`BTCUSDT`): Spot exchange information
and depth, plus USD-M exchange information, standard depth, RPI depth, mark state,
and one funding-history row. It records point-in-time payloads and local clocks to
a caller-supplied temporary directory. It does not create a synchronized book,
prove continuity, run the 14-day interval, or produce a campaign-admissible row.
Every receipt says `eligible: false`.

Each attempted request, including the terminal failed attempt, receives a
journal record with endpoint identity, start/end wall and monotonic clocks, HTTP
outcome, the exact base64-encoded response bytes and checksum when bytes were
received, and error type/message when it failed. Replay decodes those raw bytes
and independently re-runs the endpoint-specific strict parser; a rehashed record
cannot substitute unrelated response, canonical-payload, or semantic digests.
After collection stops, the smoke uses the B-E2 implementation to:

1. append those records to a new exclusive JSONL segment;
2. persist the independently serialized record-count/terminal-hash seal;
3. persist and re-read the segment and complete-corpus manifests;
4. require a deterministic same-length payload mutation to be rejected;
5. replay the admitted sealed bytes twice with no network input; and
6. require the two canonical replay receipts to be byte-identical.

These are mechanics checks only. Even a complete receipt remains ineligible for
the campaign and profitability.

## Known economic unknowns

The mechanics capture must not turn missing economics into zero:

- effective account Spot and USD-M taker fees are unknown without sanitized owner
  evidence; the public fee examples are scenarios, not account truth;
- one current mark/funding observation is not a settled funding cash flow, and
  incomplete interval coverage leaves funding cost unknown;
- public RPI depth does not prove that API takers can execute it;
- standard depth can support only a coherent displayed-book lower bound; it
  cannot prove venue-total capacity, future capacity, maker queue position, or
  fills;
- no smoke result establishes expected profitability, live readiness, or a
  build/capital decision.

## Offline verification

Run these commands from the repository root. They perform no network requests and
do not execute the smoke:

```bash
test "$(shasum -a 256 quant/research/be2/protocol.v1.json | awk '{print $1}')" = \
  "a1610965a4fea03d3e3f0a3580ed902da4c7cd48cdacc330a17e13008aa778a3"

quant/.venv/bin/python -c 'import ast, pathlib; ast.parse(pathlib.Path("quant/research/be2/smoke.py").read_text(encoding="utf-8"))'

git diff --check -- quant/research/be2/README.md quant/research/be2/smoke.py
```

After a smoke has been run elsewhere, verify its canonical receipt and every
payload offline:

```bash
quant/.venv/bin/python - /absolute/path/to/temporary-output/receipt.v1.json <<'PY'
import base64
import hashlib
import json
import pathlib
import sys

receipt_path = pathlib.Path(sys.argv[1])
receipt_bytes = receipt_path.read_bytes()
receipt = json.loads(receipt_bytes)
canonical = lambda value: (
    json.dumps(
        value,
        allow_nan=False,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    + b"\n"
)
assert receipt_bytes == canonical(receipt)
expected = receipt.pop("receiptCoreSha256")
assert hashlib.sha256(canonical(receipt)).hexdigest() == expected
assert receipt["eligible"] is False
assert receipt["eligibleForCampaign"] is False
assert receipt["eligibleForProfitability"] is False
assert receipt["requestCount"] == len(receipt["observations"])
assert all(
    item["requestMonotonicEndNs"] >= item["requestMonotonicStartNs"]
    and item["requestWallEndNs"] >= item["requestWallStartNs"]
    for item in receipt["observations"]
)
for item in receipt["observations"]:
    if item["responseBase64"] is not None:
        response_bytes = base64.b64decode(item["responseBase64"], validate=True)
        assert len(response_bytes) == item["responseBytes"]
        assert hashlib.sha256(response_bytes).hexdigest() == item["responseSha256"]
    if item["canonicalPayloadFile"] is None:
        continue
    payload = receipt_path.parent / item["canonicalPayloadFile"]
    payload_bytes = payload.read_bytes()
    assert len(payload_bytes) == item["canonicalPayloadBytes"]
    assert hashlib.sha256(payload_bytes).hexdigest() == item["canonicalPayloadSha256"]
mechanics = receipt["mechanics"]
assert mechanics["appendOnlyJournal"] is True
assert mechanics["tamperRejected"] is True
assert mechanics["networkFreeReplay"] is True
assert mechanics["replayCount"] == 2
assert mechanics["replayReceiptsByteIdentical"] is True
for name, digest_key in (
    (mechanics["journalFile"], "journalSha256"),
    (mechanics["externalSealFile"], "externalSealSha256"),
    (mechanics["segmentManifestFile"], "segmentManifestSha256"),
    (mechanics["corpusManifestFile"], "corpusManifestSha256"),
    (mechanics["replayReceiptFile"], "replayReceiptSha256"),
):
    assert hashlib.sha256((receipt_path.parent / name).read_bytes()).hexdigest() == mechanics[
        digest_key
    ]
print("canonical mechanics receipt verified; eligible=false")
PY
```

## Optional online mechanics smoke

This command is deliberately separate from offline verification. It performs
public network I/O and remains ineligible for the campaign and profitability:

```bash
be2_smoke_dir="$(mktemp -d)"
quant/.venv/bin/python quant/research/be2/smoke.py --output-dir "$be2_smoke_dir"
printf '%s\n' "$be2_smoke_dir/receipt.v1.json"
```

The output directory must be an existing, empty, absolute directory outside the
repository. Keep or discard it as temporary mechanics evidence; never copy it into
the campaign journal.
