# Q17 integration instructions (advisory-only lane)

## Current truth

- Q17 is isolated proof evidence; product integration is `NOT_CONFIGURED`.
- The current action is `ABSTAIN_UNKNOWN`; health is `DEGRADED` and
  serviceability is `SAFE_ABSTAIN_ONLY`.
- There is no loadable accepted champion, real-market edge claim,
  capital/risk approval, order, transfer, withdrawal, borrow/repay or
  execution authority.

## Accepted local Q16 startup (no dedicated CLI exists)

Construct `build_serving_manifest(QUANT_ROOT)`, then
`load_serving_lineage(QUANT_ROOT, manifest)`,
`ProtocolContractV1.load(REPO_ROOT)`, and `LocalInferenceServiceV1`.
Create `create_unix_server(path=SOCKET_PATH, service=service,
fallback_now_ms=trusted_clock_ms)`, call
`handle.server.serve_forever()` inside `try`, and always call
`handle.close()` in `finally`.
The UDS parent/socket modes remain `0700`/`0600`; optional TCP is literal
loopback only. Treat timeout, malformed response, protocol error,
stale/gapped evidence or any blocker as no assessment.

## Director-owned future integration

1. Pin exact C17/A17 and all generated artifact hashes on a director integration branch.
2. Add only a narrow adapter into the existing systemIntegration composition
   root; do not create a second source, cache, model registry, risk gate,
   store or socket owner.
3. Preserve raw evidence/lineage and `ABSTAIN_UNKNOWN`; never translate it
   into an actionable proposal.
4. Re-run cross-language, stale, gap, timeout, restart, security, supervisor
   and cockpit truth gates before any wiring claim.
5. Keep `LIVE_EXECUTION_NOT_IMPLEMENTED`; Q17 authorizes no Main edit,
   deployment, process restart, signed/private call or money path.

`quant/scripts/q17_acceptance_campaign.py` generates evidence only. It is
not an inference-service startup command.
