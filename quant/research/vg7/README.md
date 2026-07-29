# V-G7 — sealed Spot volume-climax exhaustion reversal

V-G7 is a one-attempt, public-data-only Binance Spot experiment. It tests a
daily, own-history downside volume climax followed by a completed failed-low
confirmation. Entry is no earlier than the following daily open (`t+2`).

The experiment is deliberately distinct from V-G1 through V-G6:

- no taker-buy compression or intraday continuation (V-G1);
- no positive shock-bar continuation or top-fraction breakout (V-G2/V-G5);
- no cross-sectional residual or immediate next-open 24-hour mean reversion
  (V-G3);
- no contracting-volume divergence—the V-G7 pivot requires at least `2x`
  causal median volume, mutually exclusive with V-G4's `<1.5x` rule;
- no low-volume compression breakout (V-G6).

## Frozen lifecycle

1. `freeze` validates the official `.CHECKSUM` sidecars and hashes the selected
   compressed ZIPs without decompressing a member.
2. The freeze outputs are committed; that clean commit is the pre-run SHA.
3. `run` creates an exclusive development marker before opening the first ZIP
   member. A consumed attempt cannot be repaired or rerun.
4. The Apr–Jun 2026 holdout remains byte-unopened unless one development
   candidate passes every preregistered gate. A candidate seal and exclusive
   holdout marker must precede the first holdout member read.
5. `verify.py` is network-free and checks packet, Git, checksum, lifecycle, and
   truth-boundary invariants.

Shared archives are read-only. Every V-G7 write is constrained to this
directory. This packet cannot place orders, inspect an account, mutate a host,
or authorize capital.

The pre-freeze archive audit disclosed one known publisher-checksummed semantic
defect: `AERGOUSDT-1d-2025-03.zip` fails the daily-close boundary contract.
V-G7 applies one generic rule to every symbol-month: a semantically invalid
warmup month is wholly unavailable and breaks that symbol's consecutive
eligibility until 90 valid prior days reaccumulate; any such defect in a
measurement month makes the sealed experiment `UNMEASURED`. No row is repaired,
deleted, or substituted.

## Commands

From `quant/`, with CPython 3.13:

```sh
uv run --frozen python research/vg7/experiment.py freeze \
  --state-root /private/tmp/cosmos-s1f-weekly-momentum-cash-v1

# Commit the generated universe/source/freeze artifacts, then:
uv run --frozen python research/vg7/experiment.py run \
  --state-root /private/tmp/cosmos-s1f-weekly-momentum-cash-v1

uv run --frozen python research/vg7/verify.py \
  --state-root /private/tmp/cosmos-s1f-weekly-momentum-cash-v1
```

Synthetic tests never read the shared corpus:

```sh
uv run --frozen pytest -q -p no:cacheprovider research/vg7/test_packet.py
```

## Truth boundary

`GO` means only that the locked public-bar experiment passed its frozen
research gates. `NO_GO` is a valid measured failure. `UNMEASURED` means the
sealed evidence could not support a valid measurement. None supplies
account-effective fees, historical order-book depth, verified executable
capacity, live profitability, or execution authority.
