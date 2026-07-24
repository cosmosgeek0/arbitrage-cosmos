# I00 local performance and complete-acceptance harness

This directory owns one bounded, keyless, loopback-only measurement campaign and the serial local-acceptance runner that consumes its immutable receipt. The performance receipt is also the runtime/restart receipt; there is no second runtime artifact.

## Explicit modes

Nothing effectful runs without `--run`.

```text
node test/i00/performance/local-proxy-soak.mjs --plan
node test/i00/performance/local-proxy-soak.mjs --run
node test/i00/performance/local-proxy-soak.mjs --validate-only "$PERFORMANCE_RECEIPT"

node test/i00/performance/local-acceptance.mjs --plan
node test/i00/performance/local-acceptance.mjs --run --uv "$UV" --q-venv "$ACCEPTED_Q_VENV" --browser-receipt "$BROWSER_RECEIPT"
node test/i00/performance/local-acceptance.mjs --render-candidate-receipt --candidate-sha "$CANDIDATE_SHA" --performance-receipt "$PERFORMANCE_RECEIPT" --browser-receipt "$BROWSER_RECEIPT" --complete-receipt "$COMPLETE_RECEIPT" --out docs/archive/i00-phase2/INTEGRATION_CANDIDATE_READY_RECEIPT.md
node test/i00/performance/local-acceptance.mjs --validate-only --candidate-sha "$CANDIDATE_SHA" --seal-sha "$SEAL_SHA" --performance-receipt "$PERFORMANCE_RECEIPT" --browser-receipt "$BROWSER_RECEIPT" --complete-receipt "$COMPLETE_RECEIPT"
```

`UV` must be an exact absolute path to an existing regular executable file. The other path variables above must contain exact absolute or repository-relative paths. `CANDIDATE_SHA` and `SEAL_SHA` must be full 40-hex Git commit IDs. Never resolve either identity from a moving branch during rendering or verification.

The default measured performance window is 60 seconds split across three process boots: a canonical restart-gate attempt followed by graceful `SIGTERM`, a distinct `SIGKILL` boot, and an application-first recovery boot. Before each measured phase, the harness polls for at most 60 seconds for one exact canonical baseline: live public source/engine ownership, Q `ABSTAIN_UNKNOWN`, honest non-readiness, ops/reconciliation interlock truth, and populated owner timestamps. Cold-start observations remain outside process SLO summaries; failure to establish the baseline still fails closed through the existing exact snapshot invariants. `--long` selects 900 measured seconds; `--duration-seconds` is bounded to 60–3600. The default load is 24 HTTP requests/second with concurrency 8, four local WebSocket clients, and bounded BTCUSDT subscribe/unsubscribe bursts. The app binds only to `127.0.0.1` and receives an allowlisted keyless child environment.

An hourly RSS slope is not a truthful claim from the default 20-second per-boot windows. It remains `NOT_CONFIGURED` unless a post-baseline phase supplies at least four minutes of telemetry, which the 900-second long campaign does. Absolute RSS, heap, CPU, event-loop, HTTP, WebSocket, and storage gates remain measured in the default campaign.

Event-loop p99 is a direct cumulative histogram for each measured load window, not a percentile of periodic interval percentiles. After the canonical baseline is hydrated and local WebSocket clients are open, the parent harness uses an inherited private control pipe to reset and arm a dedicated `monitorEventLoopDelay` histogram at an explicit 10 ms resolution and waits for the child acknowledgement before starting load. It disables and snapshots that histogram immediately when load completes, before restart/readback and shutdown work. Periodic CPU/RSS samples continue on their own cadence with a separate 20 ms interval histogram; those interval delay fields remain diagnostic and cannot substitute for the direct phase measurement. The SLO evaluates the maximum of the three direct phase p99 values and fails closed if any reset, snapshot, count, or ordered histogram statistic is missing or invalid. Resolution changes do not alter the fixed 50/200 ms bounds, load, or worst-of-three rule.

## Frozen-source law

Run mode admits exactly two source classes. Integration/pre-seal mode requires the integration branch, an exact HEAD/tree binding, and no dirty source. Its sole exceptions are immutable evidence outputs plus these five untracked owner directives, each verified against its pinned SHA-256 and recorded as live owner-input provenance:

- `I00_PRODUCT_ASSEMBLY_CONTROL_ROOM_AND_LIVE_BRINGUP.md`
- `IP_CONTROL.md`
- `IP_OPS.md`
- `IP_PROOF.md`
- `IP_RUNTIME.md`

Clean-detached verifier mode requires an explicit full `--tested-sha` equal to detached `HEAD`, the exact candidate tree, zero Git-status entries, and absence of all five ambient root files. It reads only the candidate-committed `protected-owner-directives.bundle.v1.json` Git blob. That bounded canonical JSON package has an exact five-member regular-file inventory, byte lengths, SHA-256 hashes, base64 payloads, inventory/payload digests, and a hard-pinned whole-file hash. Its receipt rows are labeled `CANDIDATE_COMMITTED_VERIFIER_INPUT`; packaged bytes are verifier-only and never satisfy or impersonate the integration branch's untracked owner-input law. An attached non-integration branch, malformed package, non-`100644` Git entry, wrong HEAD/tree, mixed provenance, or ambient-file fallback fails closed.

Candidate-receipt rendering is the pre-S step: HEAD must equal exact candidate C on the integration branch, the five owner directives must still be exact untracked inputs, and every other working change must belong to the bounded seal/document/evidence allowlist. The receipt path must not already exist. The command validates the working proof catalog, closure limitations, browser artifacts, performance receipt, complete receipt, source/evidence manifests, and the Git-backed donor proof. The v2 receipt must encode regenerated exact `16/16/16/16` expected/discovered/accepted/integrated equality; every donor tip/tree and receipt; the receipted dashboard equivalence cut; the exact merge window; explicit A-FORMAL and A-ACTION-EVIDENCE-S2 post-landing exclusions; Q C17 `4cc83f43edd9a50ff2d3e20970a57e2d0a57e92a` as the direct parent of A17 `02b4eccc8d2ef53b830cafae06e5175715fa6ebb`; explicit no-send-authority dispositions for the Ledger CAS and Foundation quantity bridge requests; and the required-last L merge with no later donor merge. The command then creates the one canonical receipt with exclusive create-only semantics. Commit the bounded seal set exactly once as sole-child S.

Independent validate-only runs in a different fresh session from a separate clean detached worktree at exact C. It requires explicit exact S, proves S is C's unique direct child, independently regenerates the Git-backed donor proof for C, and reads the proof catalog, receipt, browser/performance/complete evidence, browser artifacts, closure inputs, and generated reports from S Git objects. It also regenerates the five reports and machine evidence from S and requires byte parity. It does not require or create the five untracked owner files: their exact hashes are sealed in the C source-manifest contract and S candidate receipt. Extra unbound evidence in S is rejected. A Role 2 integrator may exercise the harness but may not use it to certify its own candidate; only Role 3 returns the Phase 3 verdict.

The harness sets `I00_TESTED_SHA` to the exact source HEAD. A caller-provided `--tested-sha` must equal that HEAD. It never sets or infers `I00_DEPLOYED_SHA`. All three boots share one isolated temporary `DATA_DIR`; the deployment-freeze marker inside `DATA_DIR/ops-state` must be absent and canonical readback must report `NOT_FROZEN` (`false`).

## Measured runtime evidence

The combined receipt requires:

- an authenticated, server-derived loopback preview and submit for `component.engine-supervisor.restart`; under the required keyless boundary the canonical owner must return `REJECTED_STATE`, persist the redacted rejection audit, withhold a durable command receipt, leave control/runtime effect generations unchanged, and keep managed-restart acceptance `OWNER_GATED` / `NOT_PROVEN`;
- graceful process restart evidence through `SIGTERM`, WebSocket shutdown code 1012, and the next boot generation without relabeling the rejected managed control as accepted;
- a separate `SIGKILL` phase with abnormal WebSocket closure, a non-empty WAL left without a clean boot marker, then an application-first recovery open that preserves the crash-pending generation, passes SQLite quick/full-integrity and foreign-key checks, and completes the recovery boot cleanly;
- public Spot and USD-M source timestamps advancing through the Basis and Volume owner projections;
- the Q component present only as `ABSTAIN_UNKNOWN`, with `NOT_CONFIGURED`/`UNAVAILABLE` truth, no controls, no capital relevance, and no money authority;
- canonical ops readback, reconciliation state, the intake interlock, and external-action authorization `NONE`;
- `/health/ready` and `/health/trade-ready` returning honest 503 responses, plus canonical non-green visibility;
- process CPU, RSS/heap, event-loop delay, HTTP latency/error/byte rate, WebSocket behavior, and database/WAL growth against the documented initial local-proxy gates.

Unexposed, owner-gated, or unexercised metrics remain explicit `NOT_CONFIGURED`, `OWNER_GATED`, or `UNKNOWN`; the receipt never invents a numeric value. Keyless local runtime truth is intentionally `UNKNOWN`/`UNAVAILABLE`, so canonical strong-zero and reconciliation prerequisites are not proven and a managed restart receipt/effect must not be claimed. In particular, the accepted simulation-only backup owner exists, but this soak does not run a concurrent backup and makes no production-backup or production-capacity claim.

## Browser evidence contract

The browser receipt remains `i00.local-browser-acceptance.v2` and is independently produced, immutable evidence. Its one hash-bound capture transcript is `i00.in-app-browser-mcp-capture.v3`; adding raw route truth to that existing JSON does not widen the fixed 194-artifact inventory. The receipt requires six unique runs: light and dark at `390x844@1`, `1600x900@1`, and `2940x1200@1.25`. Every run must cover all 21 operational pages, including BTCUSDT detail, with a deterministic logical path mapping. The app itself uses navigation state and keeps the document URL at `/`; the logical paths in the receipt identify the exact audited surface without pretending the SPA has a URL router.

Each route row proves rendering, source-timestamp handling, canonical state labels, control mapping, zero console errors, zero overflow failures, zero fake/control failures, and a screenshot digest. The v3 transcript contains exactly 146 screenshot captures and 126 route observations. Each route observation brackets the DOM read and raw screenshot with canonical supervisor API reads, binds bounded response bytes and hashes, records exact visible DOM selectors/geometry/attributes, and records ordered before/after in-app Browser error-log queries. The validator owns the expected route and selector sets, requires the stable owner projection to remain unchanged across the bracket, compares that stable projection to the rendered route and execution identity, and derives non-green/no-false-green truth instead of trusting transcript booleans. The rendered envelope's `evaluatedAtMs` and `sha256:` digest are retained as timely provider provenance; because every independent API read intentionally receives a fresh evaluation timestamp and digest, this contract does not claim that those two volatile values equal either bracketing response. The first error ledger must be empty and every prior after-query must exactly equal the next before-query, so pre-existing or between-route errors cannot disappear into a common prefix. This is bounded Browser console-log evidence only; it does not claim a separate unsupported page-error channel.

Every capture is bound to that one immutable `IN_APP_BROWSER_MCP` transcript and enumerates the exact subject, path, digest, dimensions, screenshot mode, and `derived: false` declaration. Screenshot validation parses the complete PNG chunk stream, checks CRCs, inflates the IDAT zlib stream, unfilters scanlines, rejects visually blank or cross-subject duplicate captures, and requires exact viewport dimensions. Topbar evidence is always a complete `1600x900` viewport with the panel open (`FULL_VIEWPORT_WITH_OPEN_PANEL`); cropped or derived `398x486` panel images are forbidden. The separate DOM measurement strictly proves the 398x486 shell and 70px/84px header. The sole cross-subject digest exception is the exact same-run Account/Wallets alias because both logical paths intentionally render `Account view="overview"`; every other subject must have distinct captured bytes. The immutable inventory remains exactly 126 route PNGs, 20 topbar PNGs, 26 bottom-up measurement JSONs, 20 topbar measurement JSONs, one restart JSON, and one capture transcript JSON: 194 artifacts total.

The receipt also proves reduced motion, canonical API comparison, and visible non-green/no-false-green behavior. Restart proof cannot be a boolean: it binds an immutable DOM-read artifact from `#i00-ws-close-diagnostic` to the exact candidate commit/tree, app origin, in-app Browser session, and capture transcript. That strict artifact must report `OBSERVED`, code 1012, reason `service restart`, `wasClean: true`, a positive reconnect generation, and a post-restart render. `bottomUpAudit` is mandatory in the exact 13-surface DESIGN order and binds its 1600x900 Light/Dark screenshots to measured frame and role-specific computed-style evidence for the frame, title, summary label/value, and primary/secondary rows. `topbarAudit` is mandatory in the exact ten-panel DESIGN order and proves the 398x486 shell, 70px/84px headers, exact shared typography roles, truth/control checks, zero overflow, and zero footer bars in both themes.

## Complete local acceptance order

The serial runner executes each layer once: frozen Q donor byte/history and environment proof followed by the current canonical Quant gate, `npm test`, `npm run test:all`, both ops aggregate commands, generated-report parity, this performance campaign, browser-receipt validation, source freeze, and `git diff --check`. The Q donor is extracted from the pinned Git object into a clean archive; Git metadata is refused and the complete pinned inventory is verified before current execution. `--run` requires both an explicit accepted virtualenv for the preserved archive proof and an explicit `--uv` absolute path whose basename is `uv` (`uv.exe` on Windows). Uv preflight requires an existing regular executable target before any child step. The receipt binds the resolved uv path SHA-256 and binary SHA-256 alongside the virtualenv path and Python binary plus the accepted interpreter/distribution manifest, `pyproject.toml`, lockfile, `pip check`, and explicit pytest-plugin policy. The runner prepends only the explicit uv path's directory to the sealed child `PATH`, so PATH lookup resolves the same validated target; every other sealed environment field remains unchanged. The active `q_current_gate` runs `node test/run-quant-gates.mjs` against the clone's current `quant/.venv`, including locked sync and dependency integrity; archive-era pytest execution remains historical evidence rather than a current-machine gate. Validate-only additionally requires exact C, exact S, and the committed complete-acceptance receipt so the independent session can prove the detached-candidate/seal topology.

Run mode resolves and executes the accepted `uv`, Q virtualenv, Node, and
other command paths on the acceptance host and records their exact strings or
digests as provenance. Later sealed-release validation treats that recorded
command provenance only as immutable receipt evidence: it checks syntax,
command identity, and digest bindings but never resolves or executes an
acceptance-host path against the deployment host. A clean Linux host therefore
validates the unmodified receipt without needing the macOS filesystem layout
that produced it.

No private reads, signed calls, money paths, AWS/Cloudflare mutation, deployment, push, or generated mission-report rewrite is part of this harness.
