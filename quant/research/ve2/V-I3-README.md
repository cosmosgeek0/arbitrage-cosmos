# V-I3 detector-to-capture terminal runner

V-I3 is an additive, pre-activation successor to the accepted V-I2 packet. It
does not alter the V-I2 measurement policy, activation schema, evidence schema,
replay, manifest, or outcome-open contract.

Current state is `PROSPECTIVE_NOT_ACTIVATED` and `UNMEASURED`. Running
`node quant/research/ve2/terminal-runner.mjs --status` performs no network,
capture, filesystem mutation, outcome access, or authority-bearing action.

## Executable path

1. `VolumeEngine.tick(true)` exports the exact current detector evaluation cut
   before KILL-ON suppresses the production proposal store. The default call
   `tick()` returns no forward cut and performs no V-I3 hashing.
2. `VolumeRuntime` exposes that sanitized cut only when an explicit synchronous
   `forwardMeasurementObserver` is supplied at construction. The production
   composition supplies none, so V-I3 remains OFF.
3. After an independent exact-hash acceptance, `terminal-runner.mjs` preserves
   the exact raw UTF-8 acceptance receipt inside the handoff, verifies its
   caller-held SHA-256, validates the unchanged V-I2 activation, binds the
   exact-schema terminal metrics policy, and copies the exact 4-hour warm-up,
   30-day admission interval, and 62-second maturity. It never self-dates.
4. Before inspection or arming, the loader requires separately held receipt
   and handoff-file hashes, verifies the clean local checkout is the exact
   accepted commit/tree with direct parent `…1c83` and base tree `…05ef`, and
   verifies the V-I3 checksum inventory plus unchanged V-I2 measurement-policy
   bytes. A merely self-consistent JSON file cannot arm capture.
5. `armScheduledCapture` accepts only an in-process trusted handoff, repeats
   exact candidate/tree/packet validation at the arm boundary, and loads only
   the checksum-bound core bundle and fixed `accepted-capture-owner.mjs`.
   Caller-supplied callbacks or module paths cannot become capture authority.
   The fixed owner exclusive-creates the physical evidence root, binds its
   custody receipt, persists detector evidence and runner checkpoints, and
   emits idempotent public-lifecycle capture requests.
6. The runner observes all 7,200 warm-up detector cuts, then exactly 1,296,031
   scored-to-maturity cuts. The handoff derives a 99,998-cut segment size so
   `POLICY` and `TERMINAL_SEAL` keep every physical chain within V-I2's
   100,000-record and 268,435,456-byte limits. Cut digests bind rotations,
   warm-up/duplicate signal correlations are excluded, and at most one shadow
   record-only lifecycle is scheduled per newly accepted detector signal.
7. `armScheduledCapture` returns immutable `volumeRuntimeOptions`; passing that
   exact object to `VolumeRuntime` wires detector cuts to the runner and binds
   a persisted capture generation. Restart requires `resume: true`, the exact
   custody root/checkpoint, and the next capture generation. No scheduler is
   installed by this source-only candidate.

The public capture owner remains restricted to the V-I2 allowlist:
`https://data-api.binance.vision` GET `exchangeInfo`/`depth` and
`wss://data-stream.binance.vision:443` `depth@100ms`, `aggTrade`, `trade`, and
`bookTicker`. Binance diff-depth bootstrap, generation/reconnect evidence,
local monotonic receive clocks, raw-first checksummed evidence, and
deterministic network-free replay remain V-I2-owned.

## Activation handoff

The handoff can only be prepared after V-I3 itself is independently accepted:

```text
node quant/research/ve2/terminal-runner.mjs \
  --prepare-handoff \
  --acceptance-receipt /absolute/outside-repo/vi3-acceptance.json \
  --expected-acceptance-receipt-sha256 <independently-held-raw-file-sha256> \
  --activation /absolute/outside-repo/ve2-activation.json \
  --evidence-root /absolute/outside-repo/volume-forward-evidence \
  --output /absolute/outside-repo/vi3-handoff.json
```

The raw receipt and its independently held digest must bind the accepted V-I3
commit/tree, direct parent
`…1c83`/tree `…05ef`, accepted time, implementation/policy/source hashes,
detector chain key, terminal-metrics policy hash, and V-I3 checksum-file hash.
The activation time must equal the receipt time. Preparation requires that the
local checkout is that exact clean candidate. The output is exclusive-create,
cannot be written inside the repository, and reports its raw-file hash for
separate custody.

Loading the handoff later requires both separately held hashes:

```text
node quant/research/ve2/terminal-runner.mjs \
  --inspect-handoff \
  --handoff /absolute/outside-repo/vi3-handoff.json \
  --expected-handoff-sha256 <independently-held-raw-file-sha256> \
  --expected-acceptance-receipt-sha256 <independently-held-raw-file-sha256>
```

No acceptance receipt, activation, or handoff instance is committed here. The
durable handoff plus fixed arm adapter is the scheduled-capture boundary for
the post-acceptance activation consumer; no scheduler is installed and no long
capture is run in V-I3.

## Frozen terminal boundary

The terminal result reports exact lifecycle mean edge per $1k for gross,
public 10-bp-per-side, and public 12-bp-per-side stress scenarios; a seeded
7-UTC-day circular block-bootstrap 95% interval; opportunity-sequence
drawdown; exact lifecycle sample counts; `$10.00` modeled-full-fill posture;
and account-fee/capacity truth.

- `UNMEASURED`: any activation/manifest/outcome/acceptance/hash/coverage/
  lifecycle gate is incomplete, any accepted lifecycle is blocked, fewer than
  30 exact terminal lifecycles exist, or a required metric/bootstrap replicate
  is invalid.
- `NO_GO`: after a complete V-I2 terminal manifest, one-time outcome-open
  receipt, exact lifecycle bijection, and all metrics gates pass, the public
  12-bp stress 95% lower bound is `<= 0`.
- `GO`: only after those same terminal validations pass, that lower bound is
  strictly `> 0`.

Drawdown is reported but has no invented decision threshold. Account-effective
fees, account-effective verdict, capacity beyond `$10.00`, and support for
`$1,000` remain `UNKNOWN`/`UNMEASURED` even for a public-scenario `GO`.
V-I3 deliberately exposes no pre-terminal GO/NO_GO classifier: until the full
validated terminal bundle exists, its executable status is only `UNMEASURED`.
Execution, submit, CAS, private-data, key, provider, host, order, transfer,
withdrawal, and money authority remain `NONE`.
