# S-1T operator README

`s1t-binance-usdm-funding-interval-transition-v1` — Binance USD-M funding
settlement cadence compression in the frozen June-2025 top-100
contract-quote-volume stable-8h universe.

This directory holds the frozen protocol and its public-only research engine.
It is not a trading execution surface and it moves no money.
Authoritative parameters live in `protocol.v1.json`; where this README and that
file disagree, the JSON wins.

## Hypothesis

Within the frozen June-2025 top-100 contract-quote-volume stable-8h Binance
USD-M `*USDT` universe, in a retrospective archive after an *observed*
compression of a contract's funding settlement cadence from 8 hours to 4 or 1
hours, is the contrarian side of the final confirming settled funding sign
associated with positive net USD per fixed 1000 USD cohort, after public proxy
costs?

- Universe: enumerate and validate only June-2025 evidence, sum each eligible
  symbol's 720 June contract `klines/1h` `quote_volume` tokens with exact decimal
  arithmetic, rank total descending then raw ASCII symbol ascending, and select
  ranks 1 through `min(100, eligible_count)`.
- Event: six consecutive stable 8h rows (gaps 8h ±1000 ms), then a first row
  whose interval is 4 or 1 and whose gap matches that new interval ±1000 ms.
- Signal: negative sign of the **last** row in the configured one- or two-row
  confirmation. An exactly zero finite rate makes the complete synchronized
  cohort cash. Any non-finite required value is invalid evidence and consumes
  the run; it is never cash or a fabricated zero.
- Sizing: each eligible decision hour is either the **complete** synchronized
  cohort at 1000 USD split equally, or exactly 1000 USD in cash. No partial
  cohorts, no renormalization, no compounding, no leverage claim.
- Trial family: 12 trials, the Cartesian product of `confirmation_rows` ∈ {1,2},
  `entry_lag_hours` ∈ {1,2}, `hold_hours` ∈ {4,8,12} (`trial_ledger.v1.json`).
- Per-symbol cooldown: 7 days between accepted noncash final-confirmation
  timestamps. Only accepted noncash cohorts advance cooldown or overlap state;
  cash cohorts never block later candidates.

## Observational boundary

S-1T measures an association between an observed settlement cadence change and
subsequent net USD only in that fixed June-2025 selected universe. It is not a
policy study and makes no claim about symbols outside the selected universe.

The selected source is a retrospective monthly archive whose historical
publication delay is `UNKNOWN`. The decision hour is a deterministic simulation
index after the final confirmation row; it is not a proven live-public
availability time. S-1T therefore makes no causal, as-of, or lag-safe claim.

Not claimed, and forbidden as output:

- causal policy effect, treatment effect, ATE, or impact of an interval change;
- an announcement time or a policy effective timestamp inferred from archive rows;
- current `exchangeInfo` membership, filters, or `fundingInfo` interval applied
  backwards over history;
- another universe cutoff, post-June reranking, or replacement of a selected symbol;
- maker fills, executable capacity, or an account-effective fee;
- that the mark price is an executable price.

Permanently `UNKNOWN` in this packet: archive publication latency, historical
spread, book depth, queue position, fill probability, market impact, historical
filters, account leverage and margin, account effective fee, executable capacity.
Interval changes are exchange-selected and may co-move with cap pressure and
funding extremity — the endogeneity is stated, not corrected.

Capacity is reported only as `PUBLIC_COARSE_PRIOR_VOLUME_PARTICIPATION_PROXY`:
a 0.005% participation rate against prior contract-kline quote volume. For each
member, the volume reference is the lesser of the trailing 24-hour sum and the
fourth sorted value of seven immediately preceding nonoverlapping 24-hour sums.
Member proxy is that reference times 0.005%; equal-weight cohort proxy is member
count times the minimum member proxy. The population is all accepted noncash
cohorts in the partition. The reported 5th percentile is the sorted element
`ceil(0.05*n)-1`; the minimum is the first element. Cash cohorts are excluded,
and no noncash cohort makes capacity `UNMEASURED`. Source quote volume is USDT;
the reported USD number is explicitly a nominal 1-USDT-to-1-USD proxy with
USDT/USD basis unmeasured. This is a proxy, never a fill claim.

## Frozen lifecycle

Canonical base is pinned at `a169b123fb186d1943a75ad648552c4d95be1be1`.
That object is the clean starting parent, not the later static or result
producer commit. The preseal records the clean frozen static producer whose
first parent is this base. Windows (all UTC):

| Partition | Range | Custody |
| --- | --- | --- |
| Screen | 2025-06-01 → 2025-07-01 | membership only, no outcome scoring |
| Development | 2025-07-01 → 2026-04-01 | opens only after the frozen source manifest and consumed-run marker exist |
| Embargo | 2026-04-01 → 2026-04-08 | not scored |
| Holdout | 2026-04-08 → 2026-07-01 | sealed; see holdout law |

For every scored trial event, its six stable rows, all confirmation rows, final
signal, decision, entry, complete 168-hour capacity lookback, funding
settlements, every hourly mark, and exit must lie wholly inside the same
exclusive-end partition. Boundary-crossing candidates are structurally outside
the partition. Once an in-horizon candidate exists, missing, duplicate,
malformed, or non-finite required evidence is terminal invalid evidence, not
cash. Development cannot carry into the embargo, and holdout cannot use embargo
or development rows for any input.

Data is read from a pre-existing official-archive cache; the engine has no
network access, uses no credentials, and has no REST or private fallback. The
fixed universe is selected solely from complete June-2025 evidence. Every
eligible symbol receives an exact-decimal June contract-quote-volume total and
one-based rank; the screen ledger records `SELECTED` or `REJECTED_BY_RANK`.
Only the frozen N=100 cutoff is permitted, and fewer than 100 eligible symbols
means select all without padding. Later availability never changes rank or
membership and cannot replace a selected symbol. Every selected-universe
funding-rate month in an opened scored partition is mandatory for complete
transition surveillance; a missing required member cannot silently remove a
symbol. Before development rows open, an
exhaustive compressed-file inventory binds all expected universe/month/dataset
paths as present or missing. Each used ZIP and sidecar is independently hashed
against the official `.CHECKSUM`, copied without hardlinks into a new read-only
packet file, and rehashed before and after member access. Because Binance may
revise archives, the packet claims equality only to the frozen cached bytes —
never to a later remote revision.

One run. No repair, no rerun, and no deletion of a completed marker or result.
A failed partial exclusive creation is not an artifact and must be fail-closed,
removed under the exact incomplete-write law, and parent-directory-fsynced
before any successful-close or immutability claim. A second invocation of the
screen or the run must refuse.

## Commands

The commands below are the ordered stage contract. The concrete engine command
is updated once its static implementation passes focused acceptance.

```sh
export S1T_PROTOCOL="$PWD/quant/research/s1t"
export S1T_PACKET_ROOT=/private/tmp/cosmos-s1t-funding-interval-transition-v1
export S1T_BASE=a169b123fb186d1943a75ad648552c4d95be1be1
export S1T_BOOTSTRAP_ENGINE="$PWD/quant/research/s1t/experiment.py"

# 0. confirm clean exact lineage before anything is sealed
test "$(git rev-parse HEAD^)" = "$S1T_BASE"
test -z "$(git status --porcelain)"
```

**preseal** — refuses unless the Git S-1T path set exactly equals the static
allowlist, the worktree is clean, and `HEAD^` is the canonical base. It records
the static producer commit/tree, Git blob object id and raw SHA-256 for each
file, and copies each static file without hardlinks to an exclusively created
packet file. Nothing may be opened before this exists.

```sh
"$S1T_BOOTSTRAP_ENGINE" preseal --protocol "$S1T_PROTOCOL" --packet-root "$S1T_PACKET_ROOT"
export S1T_ENGINE="$S1T_PACKET_ROOT/static/quant/research/s1t/experiment.py"
```

Every later stage executes only the presealed packet copy and first verifies its
raw digest.

**screen** — durably creates `screen_consumed.v1.json` with
`O_CREAT|O_EXCL|O_NOFOLLOW` *before* the first June member is opened, then
screens 2025-06 for `^[A-Z0-9]+USDT$` candidates with complete June funding,
mark-price, and contract-hour evidence and a stable 8h June history. It sums all
720 June contract-hour quote-volume values with arbitrary-precision base-10
decimal arithmetic, ranks total descending with ASCII symbol ascending ties,
and selects the first `min(100, eligible_count)`. Every eligible symbol, exact
total, rank, and `SELECTED`/`REJECTED_BY_RANK` disposition is retained. No
later-month availability or outcome scoring participates, and no alternate N is
tested.
Emits `screen_universe.v1.json`, exhaustive compressed `source_manifest.v1.json`,
and `freeze.v1.json`. Development and holdout CSV members remain unopened.

```sh
"$S1T_ENGINE" screen --packet-root "$S1T_PACKET_ROOT"
```

**run** — creates `run_consumed.v1.json` with
`O_CREAT|O_EXCL|O_NOFOLLOW` *before* any development CSV member is opened, then
emits the event universe/opened-source ledger, values all twelve trials over the
development window, and applies every development gate.

```sh
"$S1T_ENGINE" run --packet-root "$S1T_PACKET_ROOT"
```

**verify** — recheck the chain and the digests. This is the only stage that is
safe to repeat.

```sh
"$S1T_ENGINE" verify --packet-root "$S1T_PACKET_ROOT"
cd "$S1T_PACKET_ROOT" && shasum -a 256 -c SHA256SUMS   # GNU: sha256sum -c
```

A source or semantic failure discovered *after* a marker exists does not earn a
retry: the run is consumed and the verdict is `UNMEASURED_RUN_CONSUMED_NO_RERUN`.

## Artifact chain

Each link binds the previous one by digest:

1. `preseal.v1.json` — exact Git lineage/blobs/raw digests + immutable static copies
2. `screen_consumed.v1.json` — binds preseal; `O_EXCL`, pre-open
3. `screen_universe.v1.json` — complete June-only eligibility, exact total,
   one-based rank, selection, and rejection ledger
4. `source_manifest.v1.json` — exhaustive selected-top-min(100, eligible count)
   compressed inventory
5. `freeze.v1.json` — binds preseal, screen marker, screen universe, manifest,
   and the prior header-only exposure
6. `run_consumed.v1.json` — binds freeze; `O_EXCL`, pre-outcome
7. `event_universe.v1.json`, `opened_source_ledger.v1.json`,
   `development.v1.json` — run-bound events, opened copies, full family/selection
8. `candidate_seal.v1.json`, `holdout_open.v1.json`, `holdout.v1.json` —
   conditional, see below
9. `result.v1.json`, `REPORT.md` — bind and explain the applicable terminal chain
10. `SHA256SUMS` — binds every final packet file except itself

## Artifact durability law

Every lifecycle JSON, consumed marker, `REPORT.md`, and `SHA256SUMS` is opened as
a new regular nonsymlink file with `O_WRONLY|O_CREAT|O_EXCL|O_NOFOLLOW` and mode
`0600`. The writer must fully write the exact bytes, fsync the file, fchmod the
same descriptor to `0444`, fsync it again, close it, and fsync its parent
directory. The path becomes a completed artifact only after that entire
sequence succeeds.

Any failure before that completion boundary leaves an incomplete path, not an
artifact or consumed marker. The stage fails closed. The writer must prove by
`lstat` that the path is the exact regular nonsymlink device and inode created
by that attempt, unlink it, and fsync the parent directory before making any
later successful-close or immutability claim. An incomplete path is never
parsed, hashed into the chain, accepted as a predecessor, reported, or verified.
If exact cleanup cannot be proved and completed, the stage remains terminally
failed. Once completed, no artifact may be overwritten, appended, renamed over,
or deleted. Static and source copies retain their existing exclusive read-only
copy and rehash laws.

## Holdout law

April–June 2026 outcome rows are sealed. Their compressed bytes may be hashed;
they may not be decompressed or read before the gate. One prior schema probe
opened only the first CSV header, with zero data rows, in the BTCUSDT June-2026
funding-rate, mark-price, and contract-kline members. Those three members are
truthfully `HEADER_ONLY_SCHEMA_EXPOSED`; every other member is
`SEALED_UNOPENED`. The three members' data rows remain outcome-sealed.

The seal opens only when **all** of the following hold: every development gate
passes; exactly one champion is sealed in `candidate_seal.v1.json`; and
`holdout_open.v1.json` is durably created with
`O_CREAT|O_EXCL|O_NOFOLLOW`. Development gates include
positive base and stress net, positive Bonferroni lower bounds in both scenarios,
Holm p ≤ 0.05 for the champion, White reality-check p ≤ 0.05 in both scenarios,
PBO ≤ 0.5, severe-scenario drawdown ≤ 10%, ≥ 30 active cohorts, ≥ 12 active
weeks, ≥ 12 distinct traded symbols, base capacity proxy ≥ 1000 USD, and survival
of both leave-one-out stresses (drop best month, drop best symbol).

If any development gate fails, the holdout stays closed and the run ends. There
is no reselection on the holdout, no second champion, and the holdout gates are
pointwise — the champion is not re-searched, only confirmed.

## Result semantics

`result.v1.json` must carry every field in `protocol.v1.json:result_contract`,
including the verdict, capital authority, net USD per 1000 by scenario, the
price/funding/fee/adverse attribution, bootstrap intervals, activity counters,
Holm and White p-values, PBO, severe drawdown, capacity proxy, leave-one-out
stress nets, custody state, and limitations.

Verdicts:

| Condition | Verdict |
| --- | --- |
| every public-proxy gate passes | `PUBLIC_PROXY_PASS_CAPITAL_NO_GO` |
| a development gate fails | `NO_GO_DEVELOPMENT_HOLDOUT_UNOPENED` |
| a holdout gate fails | `NO_GO` |
| source or semantic failure after a marker | `UNMEASURED_RUN_CONSUMED_NO_RERUN` |

The ceiling is `PUBLIC_PROXY_PASS_CAPITAL_NO_GO`. Capital authority is `NO_GO`
in every branch while account-effective costs and executable capacity are
`UNKNOWN` — a statistical pass is not a trading decision.

A missing or duplicated required bar is `INVALID_EVIDENCE_UNMEASURED`. Unmeasured
is never written as a zero. The unit is always net USD per fixed 1000 USD cohort;
statistics use a 4096-replicate circular seven-calendar-day block bootstrap,
α = 0.05, seed 20260729. Shared starts are generated as
the unsigned big-endian integer in the first eight raw digest bytes of
`SHA256("20260729|partition_id|replicate|block_draw")`, modulo `n_days`.
Daily grids contain every partition day and explicit zeros. Pointwise bounds use
nearest-rank uncentered resample sums; centered one-sided p-values use the
add-one rule. The selection bound uses `0.05/24` for the twelve trials times two
scenarios. Holm uses each trial's maximum base/stress p-value. White's check
uses the shared centered resample maximum across all trials, separately by
scenario. PBO uses all 924 six-of-twelve chronological-block splits and
worst-tie out-of-sample ranks, exactly as specified in `protocol.v1.json`.

For each member, `q=member_notional_usd/P0`, mark PnL is `s*q*(P1-P0)`, included funding is
`sum(-s*q*Mk*rk)`, adverse attribution is
`-q*adverse_rate*(P0+P1)`, and fees are charged on the two
adverse-adjusted fill proxies. Member net is mark PnL plus funding plus adverse
attribution minus fees. Severe drawdown is recomputed at every UTC hour from
fixed 1000 USD equity, realized cashflows, and open-position mark PnL; the
peak-to-trough dollar loss is divided by 1000.

## Authority boundary

Every authority field in this protocol is `NONE`: no live surface, no host, no
provider, no deployment, no canonical branch, no UI, no execution, no orders, no
transfers, no withdrawals, no private reads. `money_moved_usd` is 0.

S-1T is a sealed research packet whose only output is evidence for the N3
successor / final convergence consumer. Frozen N3 v1 and S-META1 remain
immutable: a later N3 version must exact-pin the clean Git producer commit,
tree, protocol blob, result blob, custody, verdict, limitations, and accepted
orchestrator-row digest. Nothing here authorizes an order.

## Files

| File | Role |
| --- | --- |
| `protocol.v1.json` | the frozen protocol; authoritative |
| `source_plan.v1.json` | partitions, custody, templates, artifact chain |
| `trial_ledger.v1.json` | the twelve trial ids and their parameters |
| `experiment.py` | preseal, screen, and one-run research engine |
| `verifier.py` | repeat-safe packet-chain verifier |
| `OFFICIAL_SOURCE_RESEARCH.md` | official-documentation basis and frozen interpretation |
| `DISTINCTNESS.md` | separation from S-1M/Q/R/S/U/V and S-2F |
