# S-1Y: USD-M pair-residual mean reversion

S-1Y is one sealed public-only test of a fixed six-pair, two-perpetual,
market-neutral residual-reversion family over the planned calendar year
2025-07-01 through 2026-07-01 UTC. It has no Spot leg and uses no funding,
volume, basis, premium, mark/index, or open-interest input in selection or
signal generation.

The exact protocol is [`protocol.v1.json`](protocol.v1.json). Current official
source semantics, pre-worktree availability proof, family boundaries, and
irreducible limitations are in
[`OFFICIAL_SOURCE_RESEARCH.md`](OFFICIAL_SOURCE_RESEARCH.md).

## Controlled lifecycle

The evaluator has three commands:

```bash
python3 quant/research/s1y/experiment.py freeze \
  --shared-root /private/tmp/cosmos-s1d-funding-dispersion-v1/raw

python3 quant/research/s1y/experiment.py run \
  --shared-root /private/tmp/cosmos-s1d-funding-dispersion-v1/raw

python3 quant/research/s1y/experiment.py verify \
  --shared-root /private/tmp/cosmos-s1d-funding-dispersion-v1/raw
```

`freeze` creates the preseal before hashing any ZIP payload. It verifies and
binds all warm-up/development publisher bytes, but records only file metadata
and publisher sidecars for embargo/holdout ZIPs. It also captures current
public contract identity. No archive member is decompressed during freeze.

`run` atomically consumes the sole run before opening a development member. It
evaluates all 12 frozen trials and admits the predeclared primary trial to the
holdout only if every development gate passes. A candidate seal and holdout
marker must exist before the first embargo/holdout ZIP hash or decompression.
If development fails, those ZIP payloads remain unread and unhashed by S-1Y.
The run cannot be repeated, including after failure.

`verify` is read-only and checks artifact bindings, source custody consistent
with the holdout state, and scope.

## Authority

This packet has no execution or capital authority. Account-effective fees,
historical exchange filters, book depth, impact, spread, latency, fills, and
executable capacity remain `UNKNOWN`. No public-only outcome can authorize a
live or test order or a $1,000 deployment.
