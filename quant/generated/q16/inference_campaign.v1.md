# Q16 local inference campaign (synthetic only)

- Frozen protocol: `22/22` remains a separate required gate.
- Serving manifest SHA-256: `3ad7fcc3fd8b994230b693909c3b2c4d32432f80f1ebfb9d99f01a591e2b5523`.
- Assessment SHA-256: `10d4a858ac08c29b03ab3df6476b7eb6830359581d00791a229ccd765b369329`.
- Final action: `ABSTAIN_UNKNOWN`.
- Health: `DEGRADED`; process readiness is safe-abstain-only.
- Q15 champion payload: `UNAVAILABLE_NONLOADABLE`; no score was fabricated.

## Local startup (Python 3.13)

Create the service with `build_serving_manifest(QUANT_ROOT)`, then
`load_serving_lineage(QUANT_ROOT, manifest)`,
`ProtocolContractV1.load(REPO_ROOT)` and `LocalInferenceServiceV1`.
Create `create_unix_server(path=SOCKET_PATH, service=service,
fallback_now_ms=trusted_clock_ms)`, where `trusted_clock_ms` is an injected
callable returning current UTC milliseconds. Run `handle.server.serve_forever()`
inside `try`, and always call `handle.close()` in `finally`.
The socket parent must be owner mode `0700`; the socket is forced to `0600`.
Optional TCP may use only literal `127.0.0.1` or `::1`.

## Client calls

Python: import `python_client_v1.py` and call
`request_file(SOCKET_PATH, Path('request_assess.v1.json'))`.
Node: import `node_client_v1.mjs` and call
`await requestFile(socketPath, 'request_assess.v1.json')`.
Use the raw-file APIs for the committed request so nanosecond integers are not
rounded by JavaScript. Both clients default to a 2-second timeout.
Supported operations are ASSESS, BATCH_ASSESS, HEALTH, READINESS, LINEAGE and
METRICS. Treat ProtocolErrorV1, timeout, disconnect, malformed response or
anything other than a validated response as no assessment.

## Fail-closed posture

The generated assessment is synthetic and must remain `ABSTAIN_UNKNOWN` while
the accepted model/calibration payload is unavailable. Never convert health
`DEGRADED`, readiness `SAFE_ABSTAIN_ONLY`, unknown economics, stale evidence or
any blocker into actionable advice. Shared Node/product wiring remains a later
director integration action.
