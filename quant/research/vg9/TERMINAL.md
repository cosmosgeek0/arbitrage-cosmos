# V-G9 terminal handoff

This file is the authoritative current V-G9 lifecycle handoff.

`README.md` and `verify.py` are immutable pre-outcome, freeze-time evidence.
They truthfully describe and verify Phase 1, but they must not be read as the
current lifecycle status after the one permitted development open.

## Current status

- Verdict: `UNMEASURED`.
- Development opens consumed: exactly one.
- Frozen failure:
  `USD-M timestamp is not integer: 1000CATUSDT/1h/1000CATUSDT-1h-2025-07.zip`.
- Failure class: `DataError`.
- Analysis and economics: `null` / unmeasured, not zero.
- Base net, stress net, matched Spot-share excess, confidence intervals, sample
  counts, round trips, and drawdown: unmeasured, not zero.
- Account-effective fees: `UNKNOWN`.
- Executable capacity/depth: `UNKNOWN`.
- Candidate seal: absent.
- Holdout: unopened.
- Capital and execution authority: `NONE`.

The immutable outcome must not be rerun, repaired, retuned, normalized, or replaced
with an alternate threshold or parser. No holdout open is permitted.

Tracked terminal evidence is under `evidence/`. `verify_terminal.py` authenticates
the Phase-1 freeze, source metadata without reading ZIP bodies, the complete tracked
terminal evidence inventory, optional external-state identity, and the unopened
holdout boundary. It does not recompute outcomes.

## Final verification

Run from `quant/`:

```sh
(cd research/vg9 && shasum -a 256 -c SHA256SUMS)
(cd research/vg9/evidence && shasum -a 256 -c SHA256SUMS)
(cd research/vg9 && shasum -a 256 -c TERMINAL_SHA256SUMS)

PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=.:src PYTHONHASHSEED=0 \
  /Users/cosmosgeek/Desktop/Main/quant/.venv/bin/pytest -q \
  -p no:cacheprovider \
  research/vg9/test_experiment.py \
  research/vg9/test_verify.py \
  research/vg9/test_verify_terminal.py \
  tests/q14

/Users/cosmosgeek/Desktop/Main/quant/.venv/bin/ruff check research/vg9
/Users/cosmosgeek/Desktop/Main/quant/.venv/bin/ruff format --check research/vg9

PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=.:src PYTHONHASHSEED=0 \
  /Users/cosmosgeek/Desktop/Main/quant/.venv/bin/python \
  research/vg9/verify_terminal.py
```

The terminal verifier works from tracked evidence if
`/private/tmp/cosmos-vg9-spot-usdm-volume-leadership-v1` is absent. When that state
root exists, it additionally requires byte-identical development artifacts and no
candidate, holdout, or terminal-result artifact.
