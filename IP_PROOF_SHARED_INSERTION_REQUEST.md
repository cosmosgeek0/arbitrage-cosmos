# IP-PROOF real-adapter insertion request

**Packet state:** fixture prestage only

**Requested owner:** I00 serial integration director
**External authority:** none; this request authorizes no private read, signed call, deployment, service restart, or money action

## Immutable prerequisites

Do not execute this request until the director has recorded full 40-character, immutable, accepted tips and receipts for:

- Q `LANE_READY` (generated client, model/feature registry, outcome feedback);
- L `LANE_READY` (journal, exchange twin, normal/reverse Basis, Volume lifecycle, private truth, reconciliation, position/recovery);
- IP-RUNTIME accepted tip;
- IP-CONTROL accepted tip;
- IP-OPS accepted tip;
- this IP-PROOF implementation commit and receipt.

The D-LAUNCH-6 snapshot intentionally has no final Q or L lane-ready tip. Do not substitute a moving branch, current worktree HEAD, screenshot, or post-snapshot shard for an accepted immutable tip.

## Exact replacement map

| Fixture seam | Replace only with | Required gate |
| --- | --- | --- |
| `public-evidence` | accepted IP-RUNTIME public evidence adapter | one semantic producer registry passes |
| `q-assessment` | accepted Q generated client plus exact protocol/schema-hash handshake | generated-client parity and v1 fail-closed tests pass |
| `basis-volume-decision` | canonical existing Basis/Volume snapshot adapters | no score or proposal authority is recreated |
| `capital-risk-ticket-twin` | accepted L Capital/Risk/ticket/exchange-twin adapters | exact decimals and `LIVE_EXECUTION_NOT_IMPLEMENTED` remain enforced |
| `private-reconciliation-recovery` | accepted L private truth/reconciliation/recovery adapters | private smoke remains separately owner-authorized |
| `outcome-feedback` | existing Ledger outcome projection plus accepted Q feedback adapter | dedupe, lineage, revision, content hash, and cohort parity pass |
| `supervisor-cockpit` | canonical systemIntegration supervisor fed by accepted IP-RUNTIME adapters plus IP-CONTROL binding | `docs/DASHBOARD_TRUTH.md` browser gate passes |
| `deployment-restore` | IP-OPS preflight and isolated restore evidence | no external mutation without §20 authorization |

The machine-readable version is `fixtures/i00/proof-catalog.json#adapterInsertionPoints`.

## Requested shared-file edits (director only)

1. Add a root package command equivalent to:

   ```text
   test:i00:proof:built = node --test --test-concurrency=1 --test-reporter=spec "server/test/i00Acceptance/**/*.test.mjs"
   ```

2. Add the frozen protocol command before the I00 proof command in the combined acceptance lane:

   ```bash
   node packages/edge-protocol-tests/protocol.test.mjs
   ```

3. Include the resulting I00 proof command in the director-owned complete acceptance command only after the real adapters above replace fixtures.
4. Register no route, startup hook, package dependency, database migration, page, store, or production import from this packet directly. The director mounts accepted runtime/control/ops owners; IP-PROOF remains tests, fixtures, evidence, and reports.
5. Preserve the existing authenticated `/api/system-integration/{supervisor,graph,events,controls,traces/:correlationId}` contracts or record an explicit compatibility migration with tests.
6. Replace every `SYNTHETIC_ONLY` fixture binding in the combined run. Fixture files may remain as deterministic regression inputs but must never enter production startup, route, store, or page imports.

## Exact director fan-in command

Run from the final I00 integration root after recording all immutable tips:

```bash
node packages/edge-protocol-tests/protocol.test.mjs && \
npm run build -w server && \
node --test --test-concurrency=1 --test-reporter=spec "server/test/i00Acceptance/**/*.test.mjs" && \
npm test && \
npm run test:all
```

Then run the actual local runtime, public smoke, rendered browser sweep, ops preflight, isolated restore drill, and no-surprises readback. Do not mark `INTEGRATED_ACCEPTED` from the command above alone.

## Mandatory post-replacement gates

- protocol schema digest remains `229af0ff13d600c7d305c6deb7f57b61bdb6f8a35f6f2349d91f5ab1b4972f1c` or a separately accepted protocol change replaces this request;
- generated-client parity is real, not handwritten duplication;
- no production file imports `fixtures/i00/**`, `server/test/i00Acceptance/**`, or `test/i00/**`;
- one semantic producer, one Capital owner, one Risk owner, one exchange hand, one Ledger, one control authority;
- no `/api/live`, legacy trade-send, or legacy loan mutation can bypass the final journal/Capital/Risk/ticket/reconciliation chain;
- unknown, stale, incomplete, replay, synthetic, dry-run, and live remain distinct;
- Q failure yields `ABSTAIN_UNKNOWN` and never upgrades strategy/capital authority;
- reconciliation completes before readiness after restart;
- active exposure/recovery outranks optional research and remains visible under kill;
- Dashboard cold-open owner test passes without terminal archaeology;
- external activation and signed validation remain separate durable authorizations.

## Completion boundary

This request is satisfied only by the director's real-adapter I00 run and immutable acceptance receipt. This packet may reach `PROOF_PRESTAGE_READY`; it can never mark itself `INTEGRATED_ACCEPTED`.
