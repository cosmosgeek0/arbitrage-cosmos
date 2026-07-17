# D-LAUNCH-20 root-test offline patch request — DRAFT

Status: `BLOCKED / OWNER ACTION REQUIRED`. This is a packet-local request only.
It authorizes no edit outside the S3 exclusive roots, no merge, no push, no
external call, and no entry into an assembly or candidate worktree.

## Defect and ownership ruling

The historical exit 127 is not a missing S3 dependency. A clean `npm ci`
installs the already-declared and locked TypeScript binary, after which root
`npm test` exits 0. The remaining D-LAUNCH-20 acceptance blocker is instead an
out-of-scope root-test effect:

1. root `package.json` includes `server/test/perimeter.mjs` in
   `test:focused:built`;
2. `server/test/perimeter.mjs` spawns `server/dist/index.js` with a keyless
   environment, but no offline effect boundary;
3. `server/src/index.ts` unconditionally starts the liquidation collector and
   the composed public-market runtimes;
4. those owners construct external Binance WebSockets under
   `server/src/binance/liquidations.ts` and
   `server/src/engine/marketData.ts`;
5. connection failure is non-fatal, so the root test can remain green after an
   external egress attempt.

The shared root script, perimeter harness, production startup, and server test
infrastructure are outside the two S3 write roots. S3 therefore cannot repair
or wire this seam.

Pinned at repair input `89c783bd9e55ce83c21ed1181757122d88e4c980`:

- `package.json:26,28,45` routes root test through the perimeter harness;
- `server/test/perimeter.mjs:91-103` spawns the production child with no
  offline effect seam;
- `server/src/index.ts:3644` starts the liquidation collector unconditionally;
- `server/src/binance/liquidations.ts:377-384,455-462` immediately constructs
  the external liquidation WebSocket;
- `server/src/engine/marketData.ts:192-213` declares the additional external
  public-market WebSockets;
- `server/package.json:8,26` and `package-lock.json:3575-3583,4264-4270`
  prove that `tsc` was already declared and locked.

## Requested owner patch

```text
owner: director-assigned root acceptance / server runtime test owner
target: package.json test seam, server/test/perimeter.mjs, and the narrowest
        owner-approved server startup dependency seam needed for offline boot
scope: outside S3; land separately before any S3 re-entry decision
```

Provide an intrinsically offline perimeter boot, not merely a machine-level
firewall workaround:

- construct the production HTTP/WebSocket perimeter with injected, inert
  public-source effect ports, or add an equivalently narrow owner-approved
  offline startup seam;
- preload or install a loopback-aware egress tripwire in the spawned child that
  covers `fetch`, WebSocket/EventSource, HTTP/HTTPS, DNS, raw TCP, and TLS;
- permit only the loopback listener and loopback client traffic required by the
  perimeter assertions;
- surface every forbidden attempt to the parent and force a non-zero test exit;
- retain keyless startup, no money paths, no secrets, and all existing
  perimeter assertions;
- do not classify a denied connection, caught exception, retry, or background
  failure as zero attempted egress.

## Required proof

1. From a clean accepted tree, `npm ci` exits 0 and installs the locked local
   toolchain.
2. Root `npm test` exits 0 with the loopback-only tripwire active in every
   effectful child and reports exactly zero forbidden egress attempts.
3. The HTTP and WebSocket perimeter test still exercises real loopback traffic.
4. A hostile control that attempts one external DNS/TCP/TLS/WebSocket/fetch
   operation makes the root gate fail non-zero and reports the channel.
5. The S3 focused command remains `43 / 43` green and network-free.
6. The director records exact commands, exits, counts, accepted patch SHA, and
   tripwire evidence before reconsidering this donor.

An OS sandbox may be used as defense in depth, but a passing run under denied
external traffic is not a substitute for the zero-attempt proof above.

## Re-entry boundary

This branch remains non-candidate. Even after the owner patch lands, the S3 tip
may re-enter only through a director-controlled post-landing wave. This request
does not authorize touching `i00-assembly`, another worktree, another branch,
or `current-main`.
