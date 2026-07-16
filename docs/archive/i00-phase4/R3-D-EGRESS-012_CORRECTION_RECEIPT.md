# R3-D-EGRESS-012 correction receipt

**Finding:** `R3-D-EGRESS-012`

**Severity:** `Critical`

**Disposition:** `FIXED`

**Correction base:** `441584d2a17c72ede575d825b70de855cf33552b`

**Rejected candidate C:** `098f7b9449ab3b1c26bda19f51537bfea01d4c48`

**Role 3 receipt SHA-256:** `90613c8273e5c866603dbaa74106f2ff436c06e320a95a0cbdbc4c55c0d5ae1d`

## Exact reproduction

The verifier's production-style, loopback-only sandbox command was rerun with
`NODE_DEBUG=net,tls,http,https`. Before correction, one process boot emitted:

```text
connect: find host api.binance.com
connect: find host fapi.binance.com
```

The two attempts were the existing Spot and USD-M `exchangeInfo` requests.
They were blocked by the sandbox, the process still bound only
`127.0.0.1:41873`, and clean `SIGTERM` exited `0`. No WebSocket attempt followed
because the failed REST universe initialization stopped managed activation.

The focused real-process regression was made red before the source correction:

```sh
node --test --test-concurrency=1 --test-reporter=spec server/test/perimeter.mjs
```

Result: exit `1`; `1/2` passed. The failing assertion was:

```text
the application child must attempt zero external public network calls over its complete lifetime
```

The owner-level regression also failed before correction because
`MarketEngine.init()` invoked its injected universe-fetch spy without a positive
startup admission.

## Smallest safe correction

Static admission of the immutable seven-record public-source catalog remains
ownership evidence only. It no longer silently grants operational network
authority.

- `server/src/binance/publicSourceMode.ts` admits effectful startup only for
  exact `I00_PUBLIC_SOURCE_STARTUP_EGRESS=1`; absence is a fail-closed denial,
  malformed values fail startup, and deterministic-offline mode conflicts with
  positive live admission.
- `server/src/engine/marketData.ts` enforces the injected admission before both
  `init()` and `start()`, before REST, WebSocket, timers, or cache mutation.
- `server/src/index.ts` injects that one immutable process admission into the
  existing `MarketEngine`; no transport owner or client was added.
- The measured local-public performance campaign supplies the positive
  admission explicitly. Ordinary verifier-style boots do not.
- The process regression now omits the older deterministic-offline shortcut,
  exercises the real built server with the egress tripwire, requires truthful
  `WARMING / public-spot-source` blocker readback, and verifies that the network
  sentinel is never created over the complete process lifetime.

No release catalog, source identity, strategy owner, signed/private boundary,
money authority, D-LAUNCH-22 disposition, donor equality, disposition, or Q
ancestry rule changed.

## Focused green proof

```sh
npm run typecheck -w server
npm run build -w server
node --import tsx --test --test-concurrency=1 --test-reporter=spec \
  server/test/stream-lifecycle.mjs
node --test --test-concurrency=1 --test-reporter=spec \
  server/test/perimeter.mjs
node --test --test-concurrency=1 --test-reporter=spec \
  server/test/systemIntegration/composition/composition.test.mjs \
  server/test/systemIntegration/production/production-ports.test.mjs
npm run test:app:built
npm run test:focused:built
```

Measured results:

- server typecheck: exit `0`;
- server build: exit `0`;
- stream lifecycle: exit `0`, `8/8`;
- real-process perimeter: exit `0`, `2/2`;
- managed composition plus production ports: exit `0`, `32/32`;
- application gate: exit `0`, `82/82`, zero prohibited attempts;
- complete focused root family: exit `0`; financial safety `59/59`,
  storage/AWS `29/29`, Node focused `51/51`, stream lifecycle `8/8`, perimeter
  `2/2`.

The verifier-style sandbox command was then rerun against the built correction.
It exited `0` after clean `SIGTERM`, bound only loopback, and its complete debug
log contained zero occurrences of `api.binance.com`, `fapi.binance.com`,
`stream.binance.com`, or `fstream.binance.com`.

This receipt is committed atomically with the correction. The final Phase 4
closure receipt will bind its exact commit SHA.
