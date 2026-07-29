# V-G3 — public Spot volume-shock mean reversion

V-G3 is one sealed, public-only, twelve-month experiment for N3's profitability
verdict. It tests whether unusually high quote volume combined with a large
negative cross-sectional daily return residual mean-reverts over the next 24 hours.

It is deliberately separate from V-G2 continuation, the production Volume engine,
S-1E intraday seller-pressure reversal, and S-1F weekly momentum. Nothing in this
directory is imported by production code. It has no UI, host, private-read, order,
or money authority.

## Evidence law

- Exact base: `a169b123fb186d1943a75ad648552c4d95be1be1`.
- Git scope: `quant/research/vg3/**` only.
- Raw archives, complete manifests, and one-use markers live outside Git.
- `protocol.v1.json`, code, tests, source research, the commit-pinned official
  documentation bytes, and the explicitly reader-attested fee-row limitation are
  committed before outcome acquisition.
- Every present archive is matched to its official SHA-256 sidecar; an absent
  minute archive, including a sidecar whose body returns 404, remains missing
  evidence and becomes terminal only if a selected event requires it.
- Development makes one terminal decision. Holdout bytes may be present but cannot
  be decompressed until one immutable candidate passes all development gates.
  After a result exists, `verify` may re-read the same checksum-bound bytes only
  to deterministically recompute and compare that fixed candidate and result; it
  cannot select, change, repair, or rerun a decision.
- Missing or ambiguous evidence yields `UNMEASURED`; measured failure yields
  `NO_GO`. No failed run is repaired or rerun.

## Lifecycle

Run from `quant/` with the repository's pinned environment:

```sh
export VG3_STATE_ROOT=/Users/cosmosgeek/.codex/evidence/cosmos-vg3-public-volume-v1-4ddd-r3
PYTHONPATH=src:. .venv/bin/python research/vg3/experiment.py discover
git add research/vg3
git commit -m "research(vg3): preregister public volume-shock reversal"
PYTHONPATH=src:. .venv/bin/python research/vg3/experiment.py freeze
git add research/vg3/freeze.v1.json
git commit -m "research(vg3): seal pre-outcome protocol"
PYTHONPATH=src:. .venv/bin/python research/vg3/experiment.py acquire
PYTHONPATH=src:. .venv/bin/python research/vg3/experiment.py run
(
  cd research/vg3
  shasum -a 256 \
    OFFICIAL_SOURCE_RESEARCH.md \
    README.md \
    experiment.py \
    freeze.v1.json \
    protocol.v1.json \
    result.v1.json \
    source-receipts.v1.json \
    test_experiment.py > SHA256SUMS
)
git add research/vg3/result.v1.json research/vg3/SHA256SUMS
git commit -m "research(vg3): record sealed public verdict"
PYTHONPATH=src:. .venv/bin/python research/vg3/experiment.py verify
```

`discover` creates `source-receipts.v1.json` and the external listing receipt.
Commit the source receipt with the preregistered code and protocol. `freeze`
creates `freeze.v1.json`; commit that receipt before `acquire`. `run` consumes its
development marker before parsing development data and writes `result.v1.json`
exactly once. It consumes the holdout marker only after a passing development
candidate has been sealed. An interrupted one-use run is terminalized as
`UNMEASURED`, never resumed. Final `verify` deliberately requires the result and
canonical manifest to be committed in a clean worktree; internal crash recovery
uses the same semantic recomputation without pretending that terminal Git sealing
has already happened.

## Focused verification

```sh
.venv/bin/ruff check research/vg3
.venv/bin/ruff format --check research/vg3
MYPYPATH=src:. .venv/bin/mypy --strict --explicit-package-bases \
  research/vg3/experiment.py research/vg3/test_experiment.py
PYTHONPATH=src:. PYTHONHASHSEED=0 .venv/bin/pytest -q \
  --hypothesis-seed=20260712 research/vg3/test_experiment.py
(cd research/vg3 && shasum -a 256 -c SHA256SUMS)
```

The result reports gross movement, adverse execution, quote-valued public
fill-time commission, terminal PnL drag from that fee law, incremental stress
drag, net edge per $1,000, multiplicity, CSCV PBO, drawdown, public-print
capacity proxy, holdout custody, and the terminal `GO`/`NO_GO`/`UNMEASURED`
verdict. Positive and drawdown gates are evaluated at the same precision sealed
in the result. The 12/20-bps stress increments are explicitly all-in received
asset deductions, not extra commissions or claimed price slippage. Bootstrap,
Holm, max-T, CSCV PBO, and walk-forward use the protocol-frozen half-even
daily-return quantization at 12 decimal places; exact Decimal NAV and economics
remain separate. A positive lower-bound gate must strictly exceed one full input
quantum. A research `GO` is only an input to N3; capital authority remains
`NONE`.
