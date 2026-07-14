# Region / full-chain latency benchmark harness (amendment L-B)

`../bin/latency-bench.mjs` is a **runnable-later** artifact. It makes no
network connection unless BOTH gates are passed at invocation time:

1. `--confirm-network` on the command line, **and**
2. `OPS_ALLOW_NETWORK=1` in the environment.

Default mode is `--plan`, which only reads the targets file and prints what
would be measured. The committed `targets.json.template` contains
placeholders only — real endpoints are filled at the owner-authorized run.

```sh
# Safe anywhere (no sockets):
node ops/live/bin/latency-bench.mjs --plan --targets ops/live/bench/targets.json.template

# Owner-authorized measurement run, executed per candidate region:
OPS_ALLOW_NETWORK=1 node ops/live/bin/latency-bench.mjs \
  --run --confirm-network --targets /etc/cosmos/bench-targets.json --out report.json
```

## What it measures

Per target, sampled distributions (min/p50/p90/p99/max/mean) of: DNS lookup,
TCP connect, TLS handshake, TTFB, total. Failures are counted per target.

## What it deliberately does NOT decide

The report's `chainStages` section names all seven L-B stages
(`exchange event -> local receive` … `acknowledgement -> private-stream
confirmation`) and marks which are network-leg proxies measured here versus
app-internal instrumentation to be merged at integration. Disconnect
behavior, rate-limit posture, stable outbound identity, cost, and
operational constraints are listed in the plan output as run-time work.
Region moves happen only through a reviewed deployment decision with
rollback proof — never automatically from a benchmark report.
