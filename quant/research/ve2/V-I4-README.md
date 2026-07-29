# V-I4 default-OFF capture activation scheduler

V-I4 is a source-only successor overlay whose direct parent is the exact
accepted V-I3 commit
`a2754a53446aeb5ece3f490d2d72db4598e78f00` with tree
`342479d4eb3324130dab5536cd5d05d4fb8b8f59`. It preserves V-I3 as historical
evidence: `V-I3-SHA256SUMS` is unchanged and V-I4 verifies those hashes against
the accepted parent Git objects, not against successor files that V-I4
necessarily changes.

Current state remains `PROSPECTIVE_NOT_ACTIVATED` and `UNMEASURED`. This commit
does not contain an acceptance receipt, activation instance, handoff,
evidence root, lifecycle receipt, terminal manifest, or outcome-open receipt.
It performs no public capture, network access, provider/private access, host
action, order, transfer, withdrawal, or money action.

## Runtime seam

`forwardMeasurementScheduler.ts` is the only V-I4 scheduler. It accepts:

- an exact `volume.forward.capture-activation.v1` configuration;
- the already-armed V-I3 capture port (`observe`, `advanceTime`, `snapshot`,
  and `close`);
- an injected UTC clock;
- an injected one-shot timer port; and
- the existing `VolumeRuntime` detector tick callback.

Configuration absence is literal `OFF`: no scheduler instance, timer,
detector-source cut, hashing, runner observation, or capture-owner call occurs.
An active configuration uses `captureEnabled: true`; this is deliberately
separate from the immutable measurement strategy controls
`enabled: false`, `killSwitchEngaged: true`, `SHADOW_ONLY`, and `recordOnly`.
Capture activation never enables strategy or grants execution authority.

When capture is active, the scheduler replaces rather than duplicates
`VolumeRuntime`'s existing detector timer. It uses recursive one-shot timers
and absolute deadlines `warmupStartMs + n * 2000`. At most one timer and one
detector tick may be in flight. It never queues catch-up ticks: a missed
two-second slot, regressing/invalid clock, stale generation, missing forwarded
cut, asynchronous runner method, or runner failure terminally fails and
detaches the capture lane. Long timer delays are capped below Node's
32-bit-delay boundary, every returned Node timeout is `unref()`ed when that
method exists, and stop/dispose cancels and generation-fences stale callbacks.

Before every active capture cut, `VolumeRuntime` reapplies current operator
configuration and requires the actual Engine kill switch to remain ON and the
detector cadence to remain exactly 2,000 ms. Drift closes capture before
evidence can record the frozen KILL-ON posture. Runner failure closes the armed
owner exactly once and restores only the ordinary Volume detector cadence;
market observation does not inherit capture failure as strategy authority.
The scheduler passes its single admitted in-slot UTC reading through the tick
seam, and that exact admission time becomes `localReceivedAtMs`; a later wall
clock read cannot relabel an admitted cut as belonging to the next slot.

The scheduler exposes immutable `OFF`, `WAITING`, `WARMING`, `CAPTURING`,
`READY`, `FAILED`, and `STOPPED` snapshots with timer/in-flight state, absolute
next deadline, expected/forwarded cut counts, overlap prevention, failures,
close count, runner state, and reason codes. `VolumeRuntime.snapshot()` carries
that projection as `forwardMeasurementCapture`.

`v-i4-runtime-adapter.mjs` preserves the accepted V-I3 loader bytes while
owning the successor mapping. It remains inert until it receives separately
held raw-file hashes for both an independently accepted V-I4 receipt and the
accepted V-I3 handoff, plus the already-armed V-I3 capture result. It verifies
the V-I4 commit/tree/exactly-one-parent lineage, every accepted and current
V-I4 packet byte, a clean worktree, unchanged V-I3 validation dependencies,
the accepted V-I3 arm/close contract, V-I3 handoff/candidate/checksum custody,
and the runner cursor/generation before returning the exact activation and
capture port expected by `VolumeRuntime`. It creates no runner, store, timer,
network connection, or evidence root.

The V-I3 names `forwardMeasurementObserver` and
`forwardMeasurementRuntimeGeneration` are historical adapter/scanner inputs
only. `VolumeRuntime` rejects the presence of either legacy key, including an
`undefined` value, and accepts only the V-I4 activation plus capture-port
shape. The adapter recognizes the two names solely to validate the exact
accepted V-I3 arm-result contract before renaming it into the V-I4 seam.
Likewise, the authority scanner permits injected calls such as
`this.timers.setTimeout(...)` while rejecting ambient unqualified, dotted,
optional, and computed `globalThis`/`global` timer access.

## Official runtime basis

The implementation was designed against current Node 22 primary
documentation:

- [Node 22 timers](https://nodejs.org/download/release/v22.18.0/docs/api/timers.html)
  documents that timer callbacks are not exact-time guarantees, that
  `clearTimeout` cancels a scheduled timeout, that delays outside the supported
  range are coerced, and that `Timeout.unref()` prevents the timer alone from
  keeping the event loop active.
- [Node 22 test runner timers](https://nodejs.org/download/release/v22.18.0/docs/api/test.html#mocking-timers)
  documents deterministic timer and Date control for time-dependent tests.

V-I4 uses its own injected deterministic timer/clock port rather than ambient
mocking so the runtime contract itself remains explicit.

## Verify

After the containing V-I4 commit is frozen and the worktree is clean:

```sh
npm run typecheck -w server
npm run build -w server
node --test --test-concurrency=1 \
  server/test/volume-forward-measurement-authority.test.mjs \
  server/test/volume-forward-measurement-scheduler.test.mjs \
  server/test/volume-forward-measurement-runner.test.mjs
node --test --test-concurrency=1 \
  quant/research/ve2/v-i4-runtime-adapter.test.mjs
node quant/research/ve2/verify-v-i4.mjs
shasum -a 256 -c quant/research/ve2/V-I4-SHA256SUMS
```

Do not run `verify-v-i3.mjs` against the successor working tree and do not
rewrite `V-I3-SHA256SUMS`. V-I4's verifier proves the accepted V-I3 packet from
the parent Git objects, then proves the separate V-I4 current-tree overlay.

## Exact limitation and consumer

This exclusive slice cannot edit canonical composition. It therefore provides
a default-OFF Engine/runtime activation seam plus the acceptance-gated
successor adapter, but does not invoke either. Final non-UI convergence must
independently accept the exact V-I4 candidate, supply that receipt and the
accepted V-I3 arm result to the adapter, then pass the returned options into
`VolumeRuntime`.

The accepted V-I3 owner writes scheduled lifecycle request descriptors, but no
in-scope producer turns those descriptors into the required public lifecycle
receipts. Final convergence must bind that producer before one accepted
terminal Volume interval can run. Until the complete detector partition,
lifecycle receipts, terminal manifest, outcome-open receipt, and independent
terminal acceptance all exist, Volume remains `UNMEASURED`,
`BLOCKED_VE2_INTERVAL_NOT_TERMINAL_ACCEPTED`, with profitability false and all
execution, submit, CAS, private, signed, key, provider, host, order, transfer,
withdrawal, and money authority `NONE`.
