# Activation and boundary verification

All steps are placeholders until the owner supplies the exact authorization.
No step in this document was executed by IP-OPS.

## Host and identity

- Use an EC2 instance role; reject static access keys and profiles.
- Security group inbound rules remain empty. Administration uses SSM Session
  Manager. App origin binds `127.0.0.1` only.
- Secrets policy grants `GetSecretValue` on one exact fully suffixed ARN. Add
  exact-key KMS decrypt only for a customer-managed key and constrain it to
  Secrets Manager plus the exact secret ARN.
- Install an SQLite build containing the WAL-reset fix before any persistent
  multi-connection WAL workload or backup proof.

## Credentials

The provider reads the exact secret through the instance role, writes one
0600 JSON file below `/run`, and emits no value. The app unit consumes that
file through fatal absolute `LoadCredential=` and the Node entrypoint imports
the application in the same process. `EnvironmentFile=` contains non-secret
configuration only. Minimum credential-capable systemd version is 247.

## Cloudflare

- Keep the accepted L15 tunnel service owner. Do not create a second tunnel.
- End every ingress list with `http_status:404`; preserve TLS verification.
- Merge the current `originRequest.access` overlay after resolving team/AUD.
- The origin still validates `Cf-Access-Jwt-Assertion` signature, exact issuer,
  exact audience, time claims, subject, and operator email against remote JWKS.
- Run offline ingress validation before activation. Real tunnel, DNS, and Access
  creation require owner authorization.
- Boundary acceptance requires captured proof that direct origin ingress is
  absent, unauthenticated Access is denied/redirected, authenticated Access is
  200, missing origin JWT is rejected, and a valid JWT is accepted.

## Monitoring

- Install the unified CloudWatch agent, not the deprecated logs-only agent.
- The agent remains at its default root identity because accepted ops JSONL is
  0600 across mixed root/cosmos writers; it receives only the exact policy in
  the template and no application secret permissions.
- Set 30-day retention for ops JSONL and keep donor journald bounds.
- Alarm actions remain disabled in the template. Enable exact destinations only
  under owner authorization after alarm readback.
- Missing continuous heartbeat and canonical `TradeReady` data is breaching.
  Ops never recomputes trade readiness.
- The accepted external watchdog keeps restart budget and readiness alert-only
  policy. It never performs a trading action or automatic liquidation.

## Stable egress

When Binance IP restriction is used, the owner supplies expected stable egress
identity. Acceptance compares it with target readback; missing or mismatched
identity blocks private/signed readiness without altering the network.

## Capacity and soak prerequisite

Deployment authorization does not imply capacity acceptance. Before target
activation, the owner must attach a hashed capacity/soak receipt for the exact
EC2 size (or a documented local proxy) covering the parent §23 workload set.
The receipt must include p50/p95/p99 where meaningful for event-loop lag, Q and
engine latency, database writes, queues, fan-out, memory, CPU, disk/WAL/log
growth, reconnect/rate-limit behavior, backup-during-observation, and load
shedding. Missing evidence or silent loss keeps activation `BLOCKED_EXTERNAL`.
IP-OPS does not synthesize an SLO from host metrics.

## Tiny-live boundary

AWS/Cloudflare/service activation grants no trading authority. A future canary
requires a separate parent §20 owner authorization and canonical runtime
readback of the inherited envelope: aggregate capital at most 10 USDT, one
active strategy ticket, zero automatic repeats until owner re-arm, aggregate
canary loss at most 2 USDT, exact revision and expiry, and no new entry on any
unknown/stale/mismatch. The runtime owner must return exact
`BLOCKED_BY_MIN_NOTIONAL` math when exchange minimums do not fit. Ops only
checks the hashed owner readback; it never recomputes or expands this policy.
