# IP_PROOF_STATE.md — durable IP-PROOF packet state

Updated: 2026-07-13T01:04:58Z

## State

`PROOF_PRESTAGE_READY`

This state applies only to the deterministic, fixture-only I00 prestage harness. The product verdict remains `AWAITING_REAL_ADAPTERS`. It is not `INTEGRATED_ACCEPTED`, deployed, private-read proven, signed-validation proven, canary-ready, or live.

## Git identity

- Branch: `ip-proof-20260713`
- Director-created base and starting HEAD: `420cc83e5512d54ca1b1c064c1041d89b23914a0`
- Implementation commit: `88430c6a0e4850823f631c6b72afbfe2b6bb8b37`
- Launch evidence commit: `c418bbe7026bdec843b1d74424f5de1fb1265866`; its `QL_PARALLEL_DAG.md` diff records D-LAUNCH-6 and the IP-PROOF branch/base
- Protocol commit: `73e1a1ff7daa48df8dac45713fc5f106842edafc`
- Push: not authorized and not performed

The final documentation-seal commit cannot record its own SHA. Its exact full SHA is the final branch HEAD reported by the worker after the seal.

## Protected inputs

The two owner directives remain untracked, read-only, byte-identical inputs:

| Path | SHA-256 |
| --- | --- |
| `IP_PROOF.md` | `e59d516ba9acb9a7bb1ce63ca149ce662f308a0fd0900b72db3d2fe2e8bb93b6` |
| `I00_PRODUCT_ASSEMBLY_CONTROL_ROOM_AND_LIVE_BRINGUP.md` | `9d7a36da6a2e6e7b3e905c73161b5e998a2f92416dd557e498ade3e73d5e5ef5` |

The executable frozen-input gate also anchors the protocol schema, fixtures, runner, protocol document, Mission, Architecture Part II, Dashboard Truth, Q/L director state and DAG, directive lock, What-i-want, and the accepted convergence receipt. All 14 hashes pass.

## Prestaged proof inventory

- 83 mission/owner/Q/L/I15/architecture/dashboard requirement rows
- 20 autonomy layers
- 21 no-terminal operation classifications
- 19 resource/backpressure metrics with a deterministic synthetic measurement plan
- 15 dated official-interface rows with explicit pin/block status
- 9 no-surprises answers
- 19 operational pages discovered exactly from `web/src/App.tsx`
- 1 required absent surface: Control Room, `MISSING`, blocked on `AWAITING_IP_CONTROL_BINDING`
- 14 full control-registry entries, with missing cockpit wiring disabled rather than presented as functional
- 10 fixture-only capabilities
- 22 deterministic I00 scenarios
- 13 canonical authority concepts, 6 semantic stream records, and 38 source-discovered transport candidates
- 7 accepted SHAs proven by Git commit existence, ancestry to the verification base, receipt hash, and receipt claim/content checks

Machine evidence canonical digest: `83f730e10b73e1c7a0ab098b9f0d32a97d90424c14625359acc7d344c4889ab2`.

## Verification

| Command | Result |
| --- | --- |
| `node packages/edge-protocol-tests/protocol.test.mjs` | PASS, 22/22 |
| `node test/i00/run.mjs` | PASS, 30/30 |
| `npm test` | PASS, exit 0 |
| `npm run test:all` | PASS, exit 0; includes 72/72 app gates and 180/180 system-integration tests |
| `git diff --cached --check` | PASS |
| staged §2 scope verifier | PASS, 22/22 implementation paths before the state/receipt seal |
| IP-owned egress/secret/fixture scanner | PASS, zero findings |

The final state/receipt seal reruns the focused, protocol, `npm test`, and `npm run test:all` gates before handoff.

## Honest unresolved product blockers

- Accepted immutable Q `LANE_READY` tip, receipts, generated client, inference, and feedback are absent.
- Accepted immutable L `LANE_READY` tip, receipts, private truth, journal, exchange twin, strategy lifecycles, reconciliation, and recovery are absent.
- IP-RUNTIME, IP-CONTROL, and IP-OPS accepted tips are absent from this packet.
- Machine authority field: `authorityConverged=false`. The scan reports the legacy `/api/live`, `/api/trade/send`, loan-mutation route, TokenDetail UI-local socket review, and missing generated Q client for director classification.
- Private read, signed validation, deployed readback, browser acceptance, performance/soak, backup/restore target proof, and any canary remain pending or separately owner-gated.
- `LIVE_EXECUTION_NOT_IMPLEMENTED` remains enforced. No withdrawal or transfer-out capability was added.

## Exact next integration command

Run only from the director's final integration root after every immutable Q/L/IP tip and receipt named in `IP_PROOF_SHARED_INSERTION_REQUEST.md` has been recorded and every fixture seam has been replaced by its accepted adapter:

```bash
node packages/edge-protocol-tests/protocol.test.mjs && \
npm run build -w server && \
node --test --test-concurrency=1 --test-reporter=spec "server/test/i00Acceptance/**/*.test.mjs" && \
npm test && \
npm run test:all
```

That command is still not `INTEGRATED_ACCEPTED` evidence by itself. The director must then run actual local runtime, public smoke, rendered-browser, ops preflight, isolated-restore, and no-surprises readback gates.
