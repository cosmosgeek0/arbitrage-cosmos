# V-G36 frozen pre-run specification

## Signal

For symbol `i` and completed UTC day `t`:

```text
s[i,t] = TBQV[i,t] / QV[i,t]
c[t]   = (1 / 12) * sum_i s[i,t]
x[t]   = log(c[t] / (1 - c[t]))
dx[t]  = x[t] - x[t-1]
```

For trial lookback `L`, the baseline for `dx[t]` is the exact `L` innovations
ending at `dx[t-1]`. With median `m[t]`, median absolute deviation `mad[t]`,
and scale `1.4826 * mad[t]`:

```text
z[t] = (dx[t] - m[t]) / scale[t]
```

Zero MAD is a measurement defect, never a zero z-score. The same prior-only law
defines `z[t-1]`. A signal exists iff `z[t] <= -K` and `z[t-1] > -1`.

## Causal execution state machine

- A signal can be accepted only while flat and with no pending embargo/entry.
- `t+1` is a complete embargo day. Its open, high, low, close, volumes, and
  signal are unavailable to the accepted `t` decision.
- The cohort enters at `t+2` open, split equally after the entry-side scenario
  charge. Units remain fixed.
- It exits at the open exactly `H` UTC days after entry and pays the exit-side
  scenario charge.
- Signals observed after acceptance and through the exit open are ignored.
- A signal observed on the exit day is eligible only after that day's close and
  can therefore schedule a later entry without overlap.
- A trade is eligible only if its exact entry and exit opens are inside the
  partition. Its causal signal may precede the first scored open by at most two
  days. All other boundary-censored trades are discarded before simulation.

The comparator enters the identical static equal-weight cohort at the
partition's first scored open, holds fixed units, and exits at the partition's
final executable open under the identical cost scenario.

## Partitions and selection

- Warmup archives: 2025-03 through 2025-06.
- Development source: 2025-03 through 2026-02.
- Development scored opens: 2025-07-01 through 2026-02-28 inclusive.
- Holdout source: 2026-03 through 2026-06, opened only after the candidate seal.
- Holdout scored opens: 2026-03-01 through 2026-06-30 inclusive.
- The first/last scored opens are portfolio boundaries; no return is invented
  beyond the final available open.

Development selects by base-scenario excess one-sided 95% lower bound, then
base absolute lower bound, lower turnover, larger `K`, longer `L`, shorter `H`,
and lexicographically greatest trial ID. Selection occurs only if all
development gates pass.

## Inference and gates

Each trial/scenario reports absolute and always-on-cohort excess total USDT per
$1,000, mean USDT/day/$1,000, seven-day primary and fourteen-day sensitivity
90% intervals/one-sided 95% lower bounds, transitions, completed trades,
marked-open drawdown, and the lagged 30-day quote-volume capacity proxy.

Development requires, for the selected base-scenario path:

- at least four completed trades;
- positive base absolute and excess total and mean;
- positive seven-day absolute and excess 95% lower bounds;
- Holm-adjusted one-sided p-values at most 0.05 for both families;
- White centered max-stat family p-values at most 0.05 for both families;
- positive absolute and excess compound return in at least five of eight months;
- positive stress absolute and excess totals;
- stress marked-open drawdown at most 20%.

The single opened holdout requires:

- at least two completed trades;
- positive base absolute and excess total and mean;
- positive seven-day absolute and excess 95% lower bounds;
- raw one-sided absolute and excess p-values at most 0.05;
- positive absolute and excess compound return in at least three of four months;
- positive stress absolute and excess totals;
- stress marked-open drawdown at most 20%.

Fourteen-day intervals, severe costs, CSCV/PBO, and the public capacity proxy
are mandatory report fields but do not rescue or veto the frozen gates. The
eight-month choose-four PBO is explicitly a mean-excess family diagnostic: it
does not reproduce the gate-plus-LCB champion procedure and does not purge
multi-day holdings at month boundaries.

## Terminal truth

- Any custody/schema/timestamp/continuity/causality/exit/lifecycle defect:
  `UNMEASURED`, no repair or rerun.
- Valid development or holdout gate failure: local `NO_GO`.
- Valid local all-gates pass: `LOCAL_PUBLIC_GO`, but global
  `NO_GO_SHARED_HOLDOUT_INELIGIBLE`, capital authority `NONE`.
- Account-effective fees: `UNKNOWN`.
- Historical executable capacity and intraday drawdown: `UNMEASURED`.
- Causal identification: `NOT_CLAIMED`.
