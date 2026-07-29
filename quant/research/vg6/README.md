# V-G6 sealed public Spot experiment

V-G6 tests one narrow claim: a quiet, range-compressed USDT Spot market may
continue upward after a completed daily close breaks its prior 20-day high.
The experiment is public-data-only, cash-only, long-only, and has no execution
or capital authority.

The protocol, evaluator, official-source note, archive universe, costs, trial
family, partitions, gates, and holdout law are frozen before any ZIP member is
opened. The shared S-1F archive root is an immutable byte source only; V-G6
never writes there and does not inherit S-1F's lifecycle state or verdict.

## Distinct hypothesis

- V-G1 uses BTC-only taker-buy pressure and price displacement.
- V-G2 uses positive cross-sectional high-volume shock continuation.
- V-G3 uses negative residual/high-volume shock mean reversion.
- V-G4 uses drawdown/pivot reversal on contracting volume.
- V-G5 requires an abnormal-volume breakout.
- V-G6 requires lagged low-volume plus narrow-range compression, then rejects
  breakout bars at or above 1.5 times the same prior 20-day median quote-volume
  denominator used by V-G5.

V-G6 has no buyer-pressure, abnormal-volume, cross-sectional rank, drawdown,
pivot, or reversal parameter.

## Sealed lifecycle

First commit only the six human-authored code/protocol/test/document files. That
clean commit is the code freeze. Then, before any outcome open:

```sh
PYTHONPATH=src:. python research/vg6/experiment.py inventory \
  --source-root /private/tmp/cosmos-s1f-weekly-momentum-cash-v1
```

The inventory command binds compressed-byte sizes, hashes, and checksum
metadata only after the code freeze; it never opens a ZIP member. Review and
commit the resulting `source_manifest.v1.json` and `freeze.v1.json` as the
second pre-outcome seal commit.
The run command then requires a clean Git tree, verifies the frozen hashes,
consumes `run-marker.v1.json` once, opens development archives, and opens the
champion-only holdout at most once and only if every development gate passes:

```sh
PYTHONPATH=src:. python research/vg6/experiment.py run
```

`inventory` never opens a ZIP member. `run` refuses a second invocation. A
custody, schema, chronology, lifecycle, or implementation failure after marker
consumption is terminal `UNMEASURED`; the packet must not be repaired or rerun.

If the process is interrupted while writing terminal evidence, `finalize` is a
frozen, idempotent, data-free recovery step. It never opens an archive. If no
durable result exists, it seals `UNMEASURED` rather than recomputing outcomes:

```sh
PYTHONPATH=src:. python research/vg6/experiment.py finalize
```

## Interpretation

`GO` means public research is suitable only for a new frozen forward-shadow
test. It never means capital is safe. `capitalVerdict` remains `NO_GO`,
account-effective fees and executable book capacity remain `UNKNOWN` or
`UNMEASURED`, and execution authority remains `NONE`.
