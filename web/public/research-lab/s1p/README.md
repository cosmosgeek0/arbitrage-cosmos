# S-1P deterministic experiment

This directory implements the frozen public-only S-1P protocol:
`relative-volume intensity event -> one-to-six later own-basis event -> paired
basis reversion`. It is a research evaluator, not a product strategy or money
path.

The implementation is Python standard-library only, deterministic, and has no
network import or network command. It never calls an exchange API. The focused
suite uses the repository's pinned Python 3.13 environment. The only child
process is pinned `/usr/bin/git` read-only plumbing used to prove the local
pre-outcome commit, tag, tree bytes, clean state, parent, and origin URL.

## Frozen and tracked inputs

The evaluator binds:

- `protocol.v1.json`
- `official_sources.v1.json`
- `OFFICIAL_SOURCE_RESEARCH.md`
- `DISTINCTNESS.md`
- `README.md`
- `test_experiment.py`
- the exact `experiment.py` bytes
- the allowed S-1H `DISCOVERY.v1.json`
- all 96 discovery URL, sidecar, and checksum-addressed ZIP identities
- the exact V-G9 protocol SHA-256 observed by `freeze-candidate`

The three original frozen source/protocol files are inputs and are not written
by the evaluator.

`DISTINCTNESS.md` records the reviewed V-G9 comparison. At freeze time the
command re-reads only the supplied V-G9 protocol and refuses unless its
machine-readable contract both forbids `BASIS` as a signal and explicitly says
there is no own-symbol temporal sequence, basis event, or paired trade. The
freeze-time V-G9 digest is then authoritative; the run does not follow a later
moving sibling checkout.

## One-way lifecycle

Choose a fresh state directory that is not inside the shared S-1H directory.
The state directory is deliberately required; there is no implicit result
location.

```bash
/Users/cosmosgeek/Desktop/cosmos-merge/quant/.venv/bin/python \
  quant/research/s1p/experiment.py freeze-candidate \
  --state-dir /private/tmp/cosmos-s1p-relative-volume-basis-v1 \
  --vg9-protocol /absolute/path/to/final/vg9/protocol.v1.json
```

`freeze-candidate`:

1. proves the V-G9 distinctness gate;
2. authenticates the frozen S-1P inputs and allowed discovery;
3. validates the exact 96-row discovery Cartesian product;
4. hashes every content-addressed ZIP without opening a ZIP member; and
5. exclusively creates `S1P_PRE_OUTCOME_FREEZE_CANDIDATE.v1.json`.

Review that candidate, copy its exact bytes to tracked `freeze.v1.json`, and
commit the seven frozen inputs plus that freeze before outcome access. Preserve
that clean commit under a unique local `s1p-pre-outcome-*` tag and record both
the commit and full tag ref. The run proves the object exists, is clean `HEAD`,
has the canonical base as its sole parent, contains the exact frozen bytes, and
is reached by the preserved tag before it writes the run marker.

```bash
/Users/cosmosgeek/Desktop/cosmos-merge/quant/.venv/bin/python \
  quant/research/s1p/experiment.py run \
  --state-dir /private/tmp/cosmos-s1p-relative-volume-basis-v1 \
  --pre-outcome-git-anchor <clean-pre-outcome-commit> \
  --pre-outcome-git-ref refs/tags/<unique-s1p-pre-outcome-tag>
```

`run` is intentionally irreversible:

1. it exclusively creates `S1P_RUN_CONSUMED.v1.json` before the first
   development decompression;
2. it opens and validates development only;
3. it evaluates all four frozen trials and the two walk-forward folds;
4. a failed development champion seals `NO_GO` with holdout unopened;
5. only a passing champion is written to
   `S1P_FREEZE_CANDIDATE.v1.json`;
6. `S1P_HOLDOUT_OPEN.v1.json` is written before any holdout member opens;
7. holdout evaluates that one sealed champion with no fallback; and
8. the terminal `S1P_RESULT_CANDIDATE.v1.json` is written once.

Any second `run`, post-marker repair, rerun, retune, or overwrite is refused.
A data/custody/schema failure seals terminal `UNMEASURED`; it does not make the
state repairable.

After the run, copy the exact external result bytes to tracked
`result.v1.json`, create `SHA256SUMS` for all nine packet files, and then
authenticate. Amend the pre-outcome branch tip with the result and manifest so
the delivered branch remains exactly one final commit ahead of the canonical
base. The authenticated run marker preserves the earlier immutable pre-outcome
commit identity; amending cannot authorize another evaluator run.
`authenticate-report` requires the final amended worktree to be clean and
revalidates that the preserved tag still resolves to the original anchor with
the same frozen tree and freeze bytes.

Authenticate the completed chain without opening an archive:

```bash
/Users/cosmosgeek/Desktop/cosmos-merge/quant/.venv/bin/python \
  quant/research/s1p/experiment.py authenticate-report \
  --state-dir /private/tmp/cosmos-s1p-relative-volume-basis-v1
```

Authentication checks canonical artifact digests, file-digest links, frozen
input hashes, lifecycle schemas, verdict vocabulary, tracked/external
freeze-result byte equality, the nine-file checksum manifest, and the
non-negotiable truth boundary. It also recomputes trade and daily arithmetic,
capacity-fill checks, equity-path drawdown, bootstrap/Holm/reality/PBO
statistics, walk-forward and holdout gates, and champion binding from
authenticated artifact fields without reopening archive bodies.

## Exact evaluator semantics

- Spot archive timestamps must be microseconds and normalize exactly to the
  five-minute millisecond grid. USD-M, mark, and funding timestamps must be
  milliseconds.
- Every phase must contain a complete, unique five-minute grid. Spot, USD-M,
  and mark-price clocks must be identical within the phase and across BTCUSDT
  and ETHUSDT. Funding archives must have the exact frozen three-column header,
  nonempty on-hour rows, no coverage gap above the applicable declared funding
  interval across monthly and phase boundaries, no interval transition, and an
  exact mark-price open for every settlement.
- Only Spot/USD-M open, close, and quote volume enter the signal. Funding,
  mark, trade count, taker flow, returns, and all forbidden families do not.
- At each UTC day start, calibration freezes the previous 28 complete UTC
  days. Volume uses same-slot `log1p` median/MAD. Basis uses all prior-window
  synchronized bars.
- A volume event crosses from strictly below to at-or-above its threshold and
  only arms. The basis event must cross from strictly below to at-or-above one
  through six completed bars later using calibration captured at the arm.
- Close of bar `i` can schedule a fill only at open `i+1`. The time stop
  evaluates after close `entry+287` and fills at open `entry+288`.
- Same-bar priority is position exit, then existing arm crosses, then new
  volume events. A basis winner is the oldest arm, then largest threshold
  excess, then symbol ascending. Scheduling one entry cancels all other arms.
- A volume event is eligible only when `event_index + 295 < phase_end_index`.
  Development and holdout positions cannot cross their phase boundary.
- The portfolio holds at most one paired position. Base quantity is
  `500 / Spot entry open`, and the perpetual leg uses the same base quantity.
- A short-perpetual funding cashflow is
  `quantity * settlement mark open * published rate` for settlements in the
  half-open holding interval `[entry_open, exit_open)`. Adverse cashflow is
  debited; favorable cashflow is recorded and discarded.
- Capacity is only a causal public proxy. Each entry and exit fill on each leg
  tests its actual equal-base fill notional against that leg's immediately
  prior completed bar quote volume. Executable capacity remains `UNMEASURED`.
- Statistics use the frozen synchronous seeded circular-block bootstrap,
  one-sided basic lower bound, centered family p-values, Holm step-down,
  synchronous max reality check, and 8-block/70-split CSCV PBO.

## Verdict boundary

- Valid measured evidence with a failed frozen gate: research `NO_GO`.
- All public proxy gates pass: research `UNMEASURED`, because account-effective
  profitability is unknown.
- Invalid evidence: `UNMEASURED`.
- Account-effective Spot and USD-M commissions, promotions, taxes, and
  discounts: `UNKNOWN`.
- Executable capacity: `UNMEASURED`.
- Capital verdict in every case: `NO_GO`.
- Product and execution authority: `NONE`.

The report never emits `GO`.

## Focused verification

The tests use in-memory bars and temporary lifecycle artifacts plus the allowed
frozen discovery identity. They do not instantiate a ZIP reader and do not read
a shared archive body or sibling result. Run these commands from `quant/`:

```bash
/Users/cosmosgeek/Desktop/cosmos-merge/quant/.venv/bin/ruff check research/s1p
/Users/cosmosgeek/Desktop/cosmos-merge/quant/.venv/bin/ruff format --check research/s1p
MYPYPATH=. /Users/cosmosgeek/Desktop/cosmos-merge/quant/.venv/bin/mypy \
  --strict --explicit-package-bases \
  research/s1p/experiment.py research/s1p/test_experiment.py
PYTHONPATH=. PYTHONHASHSEED=0 \
  /Users/cosmosgeek/Desktop/cosmos-merge/quant/.venv/bin/pytest -q \
  research/s1p/test_experiment.py
```
