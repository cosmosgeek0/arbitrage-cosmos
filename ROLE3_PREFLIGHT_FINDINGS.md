# ROLE-3 preflight findings — D-LAUNCH-29 source snapshot

## Scope and authority boundary

This is read-only preflight evidence for the active integrator and the later independent verifier. It is not the independent verification, it does not certify or refuse a frozen candidate, and it emits no formal candidate outcome token.

The inspected source object is fixed independently of this findings commit:

| Fact | Exact value |
| --- | --- |
| Worktree | `/Users/cosmosgeek/Desktop/role3-preflight` |
| Branch at scout start | `role3-preflight-20260715` |
| Source commit | `03857dcdaff8d8b12627d27ddcc97505da1f2f86` |
| Source tree | `92a2ec21b060eb0da3c98e3d6b16fad9843bbf89` |
| Source parent | `76387ec47d14b7b8dead28928de8dc4487133f73` |
| Initial worktree state | clean |
| Node | `v22.23.1` |
| npm | `10.9.8` (matches `packageManager`) |
| Git | `2.50.1` |
| Date / timezone | `2026-07-14`, `Asia/Kolkata` |

Only this file was written. No source file, sibling worktree, integration worktree, ref, merge, or remote was modified.

### Controlling inputs reconstructed before inspection

| Authority input | Location | SHA-256 / cut used | Material law applied |
| --- | --- | --- | --- |
| Final integration and independent-verification order | `/Users/cosmosgeek/Desktop/preverify/FINAL_INTEGRATION_AND_INDEPENDENT_VERIFICATION_ORDER.md` | `73615984fa0403a4c0d7ea0db9893292d57ea18614714398684cf9a3062fb05c` | Exact Git-backed donor equality; no duplicate authority/lifecycle; clean-install complete tests; reproducible findings only; scout does not repair. |
| Post-I00 AI operations activation, §0 | `/Users/cosmosgeek/Desktop/POST_I00_EVENT_DRIVEN_AI_OPERATIONS_ACTIVATION.md:17` | `cbc523fd18578641f6fcc02a5efb564ac861ca1320fcc189948a0725b41b5195` | Until an immutable accepted landing exists, inventory/collision mapping is read-only and shared seams are untouched. |
| Main director state, D-LAUNCH-1 through D-LAUNCH-29 | `/Users/cosmosgeek/Desktop/Main/QL_DIRECTOR_STATE.md` | `db90f7165ec577e19bab0dd4abca29b647ffb7b2d5be677c9b7f4faa5de80878`; D-LAUNCH-29 cutoff | D-LAUNCH-19 candidate-receipt obligations; D-LAUNCH-20 denominator law; D-LAUNCH-22 one known socket-attempt disposition; D-LAUNCH-27 any other egress/private/signed attempt boundary; D-LAUNCH-29 findings-file-only scout role. A later D-LAUNCH entry was outside the requested cutoff. |
| AI-Ops authority resolution receipt | `/Users/cosmosgeek/Desktop/Main/AI_OPS_AUTHORITY_RESOLUTION_RECEIPT.md` | `51d9343f747c7f652bbcd53137b06dec2f760268a9799ea57fbe077eaef898f0` | Named authorities resolve to real repository objects; no dummy owner; pre-landing posture remains read-only. |

The final-order document is not present in source commit `03857dc`; it was consumed from the immutable preverify evidence path above. The two protected owner directives are also absent from this clean scout worktree by design; their accepted sealed SHA-256 fallbacks were used by the repository proof code.

## Ranked likely acceptance blockers

| Rank | ID | Severity | Finding | Direct proof |
| ---: | --- | --- | --- | --- |
| 1 | PF-001 | P0 / critical | The deterministic app gate passes only when it observes external-network attempts; this run observed 13 attempts beyond the single dispositioned Binance socket. The root perimeter separately requires two startup REST attempts. | `npm run test:app:built` exit `0`, `78/78`, with `13 blocked before transport`; `server/test/gates.mjs:879`; `server/test/perimeter.mjs:268`. |
| 2 | PF-002 | P0 / critical | Production admits two physical sockets for the identical USD-M liquidation stream, contradicting the canonical single-producer map; the proof harness blesses both and no receipt dispositions the duplication. | `ARCHITECTURE.md:230`; `server/src/engine/marketData.ts:206`; `server/src/binance/liquidations.ts:379`; `server/src/systemIntegration/production/factory.ts:848`. |
| 3 | PF-003 | P0 / critical | The mandatory aggregate and standalone I00 proof commands fail from the clean snapshot because committed proof evidence is not reproducible in a clean verification worktree. | `npm run test:all` exit `1`; `npm run test:i00:proof` exit `1`, `45/46`; `server/test/i00Acceptance/closure-evidence.test.mjs:274`. |
| 4 | PF-004 | P1 / high | A nonempty mutation-journal registry hides unrelated orphan reserved Ledger rows and projects `AVAILABLE` plus `reconstructionProven:true`; focused tests remain green. | `server/src/systemIntegration/persistence/liveEdgeMutationJournalAdapter.ts:678`; hostile reproduction below. |
| 5 | PF-005 | P1 / high | The eventual candidate-receipt generator/validator cannot encode the required Q C17→A17 mapping or the two explicit money-path dispositions. | `test/i00/performance/local-acceptance.mjs:2961`; exact-key validator at `:3200`; D-LAUNCH-19. |
| 6 | PF-006 | P2 / medium | Root state overstates quantity-bridge provenance. The revision is self-derived structural binding, not source authority; arbitrary valid-looking metadata passes when the caller recomputes the revision. | `I00_PRODUCT_BUILD_STATE.md:110`; `server/src/systemIntegration/adapters/foundationQuantityBridge.ts:170`. |
| 7 | PF-007 | P2 / medium | The semantic-source duplicate detector exists but is not production-wired, which permits PF-002 to survive while static proof reports authority convergence. | `server/src/systemIntegration/adapters/sourceRegistry.ts:46`; `live-edge-receipts/L00_AUTHORITY_REUSE_MAP.md:35`. |

## PF-001 — green deterministic gates require external-network attempts

**Invariant.** Deterministic tests are network-free. D-LAUNCH-22 dispositions one known preexisting unconditional Binance **socket** attempt and queues an intrinsically offline startup seam. D-LAUNCH-27 maps only that attempt to the written disposition; any other egress or any private/signed attempt is a finding. The immutable patch request requires zero forbidden attempts and a nonzero result for even one attempt.

**Actual.** The freshly built app gate returned success only because `blockedPublicEgress.length > 0`:

```text
✓ all deterministic-gate public network calls are blocked before transport — 13 blocked before transport: EXTERNAL_NETWORK_REQUEST api.binance.com/api/v3/exchangeInfo, EXTERNAL_NETWORK_REQUEST fapi.binance.com/fapi/v1/exchangeInfo, EXTERNAL_NETWORK_REQUEST api.binance.com/api/v3/ticker/bookTicker, EXTERNAL_NETWORK_REQUEST api.binance.com/api/v3/ticker/bookTicker, EXTERNAL_NETWORK_REQUEST fapi.binance.com/fapi/v1/ticker/bookTicker, EXTERNAL_NETWORK_REQUEST fapi.binance.com/fapi/v1/ticker/24hr, EXTERNAL_NETWORK_REQUEST api.binance.com/api/v3/depth, EXTERNAL_NETWORK_REQUEST api.binance.com/api/v3/trades
78/78 gates passed
```

The gate at `server/test/gates.mjs:879-886` requires a positive attempt count and validates only a generic sentinel-line regex. The root perimeter at `server/test/perimeter.mjs:268-274` explicitly requires these two startup REST attempts:

```text
EXTERNAL_NETWORK_REQUEST api.binance.com/api/v3/exchangeInfo
EXTERNAL_NETWORK_REQUEST fapi.binance.com/fapi/v1/exchangeInfo
```

Both false-green assertions were introduced by `9e233798e159d369e180825b9289dea1799a4563` (`git blame -L 268,274 server/test/perimeter.mjs` and `git blame -L 879,886 server/test/gates.mjs`).

The 13 observed attempts are:

1. startup Spot exchange info;
2. startup USD-M exchange info;
3. Spot symbol book ticker;
4. Spot all-symbol book ticker;
5. USD-M all-symbol book ticker;
6. USD-M 24-hour ticker;
7. Spot depth;
8. Spot trades;
9. futures klines;
10. funding history;
11. Spot time;
12. Spot klines;
13. CoinGecko icon search.

The tripwire prints only the first eight, so items 9–13 were mapped from the exercised route lines and exact REST/icon call sites. A repeated Spot detail quote is suppressed by the negative cache and does not create a fourteenth attempt.

**Affected paths.** `server/test/gates.mjs:257-291,320,630,643,707-711,740,841,870,879-886`; `server/test/perimeter.mjs:268-274`; `server/src/index.ts:137,1766-1789,1857-1872,2105-2111,2256-2292,2313-2355,2646-2652`; `server/src/binance/rest.ts:182-186,278-337,411-424,496-508,536-545,565-574,719-725`; `server/src/binance/icons.ts:161-171,190-234`; `server/src/systemIntegration/application/facade.ts:583-590`; `server/src/systemIntegration/production/factory.ts:844-853`.

**Reproduction.** From the hydrated source snapshot:

```sh
npm run test:app:built
node --test --test-concurrency=1 server/test/perimeter.mjs
git blame -L 879,886 server/test/gates.mjs
git blame -L 268,274 server/test/perimeter.mjs
git show a0c7b6e:fixtures/productAssurance/systemic/formal/drafts/D_LAUNCH_20_ROOT_TEST_OFFLINE_PATCH_REQUEST.DRAFT.md | sed -n '52,76p'
```

Observed: app gate exit `0`, `78/78`, 13 blocked attempts; perimeter exit `0`, `2/2`, and requires two startup REST attempts. Expected by the immutable request: zero forbidden attempts; any single attempt produces a nonzero test result.

No private/signed construction or call was observed in this preflight. PF-001 is public egress beyond the one dispositioned socket, not a private-call allegation.

## PF-002 — two production owners open the same liquidation socket

**Invariant.** `ARCHITECTURE.md:230-241` names `MarketEngine` as the single physical producer for USD-M mark/funding/liquidation and forbids a duplicate tiered socket. The final integration order likewise forbids duplicate socket and lifecycle authority.

**Actual.** After successful market initialization, the managed lifecycle calls both `market.start()` and `auxiliary.start()` at `server/src/systemIntegration/production/factory.ts:848-854`. They open the exact same stream URL:

- `server/src/engine/marketData.ts:206-210` constructs the `MarketEngine` `futures-liquidations` stream at `wss://fstream.binance.com/market/ws/!forceOrder@arr`.
- `server/src/index.ts:176-184` injects `startLiquidationCollector` as `marketAuxiliary`.
- `server/src/binance/liquidations.ts:379-392,457-465` independently constructs the same URL and its own reconnect/maintenance lifecycle.

The contradiction is proof-blessed:

- `server/test/i00Acceptance/harness.mjs:112-129` classifies both source files as accepted existing physical producers.
- `server/test/gates.mjs:226-231` declares success when the collector is admitted through the managed market lifecycle.
- `server/test/systemIntegration/production/production-ports.test.mjs:366-397` passes while asserting paired `marketStart:2` and `marketAuxiliaryStart:2` restart admission.

A receipt search found no explicit disposition for both physical producers and no override of Architecture Part II. The only matching receipt, `SYSTEM_CONVERGENCE_RECEIPT.md:443-449`, reiterates the no-duplicate requirement.

**Reproduction.**

```sh
rg -n '!forceOrder@arr|startLiquidationCollector|marketAuxiliary' \
  server/src/engine/marketData.ts \
  server/src/binance/liquidations.ts \
  server/src/index.ts \
  server/src/systemIntegration/production/factory.ts
node --test --test-concurrency=1 \
  server/test/systemIntegration/production/production-ports.test.mjs
rg -n -i '(liquidation collector|liquidations\.ts|forceorder|duplicate (tiered )?socket|physical producer)' \
  --glob '*RECEIPT*' --glob '*receipt*' .
```

Observed: focused lifecycle proof exits `0`, `14/14`, while admitting both producers. Expected: one physical producer for the semantic stream, or an explicit authority-map amendment and receipt that removes the conflict.

## PF-003 — committed I00 proof is not clean-worktree reproducible

**Invariant.** The existing mandatory proof command must pass from a clean hydrated snapshot, and committed machine evidence must equal fresh deterministic reconstruction.

**Actual.** `npm run test:all` exited `1`. Its first and only failing family was the I00 proof after all preceding families completed successfully. `npm run test:i00:proof` independently exited `1`, with `45` pass and `1` fail out of `46`. The failing assertion is `server/test/i00Acceptance/closure-evidence.test.mjs:274-300`, specifically the deep equality at line 299.

The exact fresh-versus-committed differences are:

```text
frozenInputs[0].evidenceMode: LIVE_OWNER_FILE -> SEALED_CANDIDATE_HASH
frozenInputs[1].evidenceMode: LIVE_OWNER_FILE -> SEALED_CANDIDATE_HASH
historicalFrozenInputs[0].evidenceMode: LIVE_OWNER_FILE -> SEALED_CANDIDATE_HASH
historicalFrozenInputs[1].evidenceMode: LIVE_OWNER_FILE -> SEALED_CANDIDATE_HASH
livingDirectorInputAcceptance.liveSourceTip:
  d78be24f4da14632c857ee250b62e3fec33c2743
  -> 2b32317dbf89907bcf529231247f1f9a63235d49
livingDirectorInputAcceptance.directiveResults[0..4].evidenceMode:
  LIVE_OWNER_FILE -> SEALED_CANDIDATE_HASH
```

`test/i00/sealed-owner-evidence.mjs:141-191` intentionally supports both modes: protected owner files present as exact untracked inputs, or absent in a clean snapshot with their sealed hashes. Both modes pass individually, but the committed report serializes the worktree-local mode and the proof then requires byte-equivalent reconstruction.

`test/i00/git-provenance.mjs:225-326` also serializes the current moving `current-main` ref as `liveSourceTip`. The cutoff remains reachable and the acceptance check passes, but the drift-prone tip is included in the equality-bound evidence body.

**Reproduction.**

```sh
npm run test:i00:proof
node --input-type=module <<'NODE'
import { readFileSync } from 'node:fs';
import { buildMachineEvidence } from './test/i00/render-reports.mjs';
const committed = JSON.parse(readFileSync('./integration/reports/i00-proof-evidence.json', 'utf8'));
delete committed.evidenceSha256;
const current = buildMachineEvidence();
const diffs = [];
function walk(a, b, path = '') {
  if (Object.is(a, b)) return;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) diffs.push([`${path}.length`, a.length, b.length]);
    for (let i = 0; i < Math.max(a.length, b.length); i += 1) walk(a[i], b[i], `${path}[${i}]`);
    return;
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      walk(a[key], b[key], path ? `${path}.${key}` : key);
    }
    return;
  }
  diffs.push([path, a, b]);
}
walk(committed, current);
console.log(JSON.stringify(diffs, null, 2));
NODE
```

Observed: exit `1`, `45/46`, with the ten differences above. Expected: exit `0`, `46/46`, with no differences when verified in a clean worktree.

## PF-004 — hidden orphan Ledger rows produce false-green canonical evidence

**Invariant.** Reserved mutation-journal and audit rows without a canonical registry snapshot are persistence corruption and must make canonical inventory/reconstruction unavailable.

**Actual.** `LiveEdgeMutationJournalPersistenceAdapter.inspectInventory()` performs a global orphan check only when `registry.journals.length === 0` (`server/src/systemIntegration/persistence/liveEdgeMutationJournalAdapter.ts:678-708`). When at least one valid registry row exists, lines 710-729 reconstruct only configured IDs and do not discover unrelated reserved-kind rows. `#assertNoOrphanEvents` exists at lines 493-500 but is not invoked globally in that branch.

A valid configured journal plus a copied orphan journal/audit pair returned:

```json
{
  "state": "AVAILABLE",
  "journalCount": 1,
  "entryCount": 1,
  "reconstructionProven": true,
  "followOn": "COMMITTED_NEW",
  "directOrphanRead": "PERSISTENCE_CORRUPT:mutation-journal Ledger events exist without their canonical registry snapshot"
}
```

The result reaches canonical supervisor evidence through `server/src/systemIntegration/adapters/canonicalOwnerEvidence.ts:351-385,541-560`, construction at `server/src/index.ts:188`, supervisor composition at `server/src/systemIntegration/application/facade.ts:940`, and delivery at `server/src/index.ts:3451`.

Existing hostile coverage at `server/test/systemIntegration/persistence/live-edge-mutation-journal-adapter.test.mjs:703-726` tests only the empty/deleted-registry case. Focused suites still pass: Ledger CAS `9/9`, exit `0`; mutation-journal adapter `16/16`, exit `0`.

**Exact hostile reproduction.** Requires the server build produced by the mandated test sequence.

```sh
node --input-type=module <<'NODE'
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Ledger } from './server/dist/ledger.js';
import { LiveEdgeMutationJournalPersistenceAdapter } from './server/dist/systemIntegration/persistence/liveEdgeMutationJournalAdapter.js';
import { prepareInitialMutationAppend, preparePreflightMutationAppend } from './server/dist/liveEdge/adapters/durableMutationJournal/index.js';
import { inputFixture } from './server/test/liveEdge/mutationJournal/fixtures.mjs';

const T = 1_700_000_000_000;
const input = (n) => inputFixture({
  identity: { assessmentId: `assessment:orphan-${n}` },
  preflightResult: { evaluatedAtMs: T - 100, instrumentValidUntilMs: T + 10_000 },
  bindings: {
    sourceExchangeEventAtMs: T - 400,
    sourceLocalReceiveAtMs: T - 390,
    featuresReadyAtMs: T - 300,
    decisionAtMs: T - 250,
    approvalAtMs: T - 150,
    preflightEvaluatedAtMs: T - 100,
    privateEvaluatedAtMs: T - 50,
    validUntilMs: T + 10_000,
  },
  createdAtMs: T,
});

const primaryDir = mkdtempSync(path.join(tmpdir(), 'role3-l06-primary-'));
const donorDir = mkdtempSync(path.join(tmpdir(), 'role3-l06-orphan-donor-'));
const primary = new Ledger(primaryDir);
const donor = new Ledger(donorDir);
try {
  const adapter = new LiveEdgeMutationJournalPersistenceAdapter(primary, { nowMs: () => T + 2 });
  const first = prepareInitialMutationAppend(input(1));
  adapter.append(first.request);
  const current = adapter.read(first.request.mutationId);

  const donorAdapter = new LiveEdgeMutationJournalPersistenceAdapter(donor, { nowMs: () => T + 2 });
  const orphan = prepareInitialMutationAppend(input(2));
  donorAdapter.append(orphan.request);
  const orphanRows = donor.recentEvents(10, undefined, orphan.request.mutationId)
    .sort((a, b) => a.id - b.id);
  primary.logEventsAtomically(orphanRows.map(({ kind, symbol, data }) => ({ kind, symbol, data })));

  const inventoryAfterOrphan = adapter.inspectInventory();
  const followOn = adapter.append(preparePreflightMutationAppend(current, T + 1).request);
  let directOrphanRead;
  try {
    adapter.read(orphan.request.mutationId);
    directOrphanRead = 'NOT_DETECTED';
  } catch (error) {
    directOrphanRead = `${error.code}:${error.message}`;
  }
  console.log(JSON.stringify({ inventoryAfterOrphan, followOn: followOn.disposition, directOrphanRead }, null, 2));
} finally {
  primary.close();
  donor.close();
  rmSync(primaryDir, { recursive: true, force: true });
  rmSync(donorDir, { recursive: true, force: true });
}
NODE
```

Expected: inventory fails closed on any orphan reserved-kind row. Actual: global inventory remains `AVAILABLE`, asserts reconstruction, and accepts a follow-on append.

## PF-005 — candidate receipt cannot encode mandatory dispositions or Q mapping

**Invariant.** D-LAUNCH-19 requires the eventual immutable candidate receipt to include:

1. regenerated donor-inventory equality;
2. the Q C17→A17 ancestry mapping `4cc83f43edd9a50ff2d3e20970a57e2d0a57e92a` → `02b4eccc8d2ef53b830cafae06e5175715fa6ebb`;
3. an explicit written disposition for the Ledger CAS request; and
4. an explicit written disposition for the Foundation quantity-bridge request.

**Actual.** `buildIntegrationCandidateReceiptDocument()` at `test/i00/performance/local-acceptance.mjs:2961-3018` emits donor equality and donor proof, but no explicit Q activation-parent mapping and no records for the two money-path dispositions. `candidateReceiptShapeValid()` at lines 3200-3248 enforces exact top-level keys, so adding disposition or ancestry sections fails the current contract.

`externalBoundary.moneyPaths` at lines 182-202 and 2903-2919 says only that live/test orders, borrow/repay, leverage, transfer, and withdrawal were not exercised. It does not disposition either requested implementation. The expected limitations mention the missing quantity production consumer but contain no Ledger CAS disposition.

The current preflight snapshot correctly has no candidate receipt yet; absence is not the finding. The finding is that the only receipt renderer/validator cannot produce the receipt content required at freeze.

**Reproduction.**

```sh
rg -n '4cc83f|C17|A17|ledger CAS|quantity bridge|money-path|moneyPath' \
  test/i00/performance/local-acceptance.mjs \
  test/i00/donor-equality.mjs
sed -n '2961,3018p' test/i00/performance/local-acceptance.mjs
sed -n '3200,3248p' test/i00/performance/local-acceptance.mjs
```

Observed: no explicit Q C17→A17 field and no named disposition rows; exact-key validation rejects new top-level fields. Expected: the renderer and validator can encode and verify all four D-LAUNCH-19 obligations.

### Money-path implementation/object facts that do reconcile

- Both patch requests originate at `a288657d98d6aa8615abd11879e2a097189a3be3`.
- Ledger CAS request blob/SHA-256: `494cfc87083103b345e82e11726b8c89d09d07b6` / `79740ff5ef2951e96b5e3ea26acdc4aa786425ca3341335e55cef23d230c4f6f`.
- Quantity request blob/SHA-256: `697abdc548f3975247244062a79bc176c797be2d` / `9db092975a34c001f04412ef94644078009f90e5efc62ed258ced00aa38c4cb0`.
- L06 receipt blob/SHA-256: `1d3aef217b06b2c6ca6ab381ba5f396d704330eb` / `88005addf21d964f056fb20742b714046ac43a58851a1084443ac9f78abf516c`.
- L receipt `3e2cc9882aa05bb2ad38cc495c7f55534a7a4146`, sealed L tip `df6b472993ca9659ce09cf5f72004981c6835f0d`, and L merge `ec82bc51d5311dfb3f505216bfb3fa41733f038c` reconcile by ancestry.
- Ledger CAS retains exact canonical strings and one immediate SQLite transaction for state plus journal/audit events; listeners run post-commit.
- The quantity bridge retains exact decimal originals, derives the binary64 expansion, and rejects exponent forms, nonfinite values, negative zero, overflow/underflow, non-roundtrip values, invalid tolerance, and off-grid quantities.
- Neither path grants exchange action; exposed evidence remains `sendAuthorized:false` and `externalActionAuthorization:"NONE"`. No production quantity consumer or mutation-journal `.append()` caller was found.

## PF-006 — quantity provenance label exceeds the implemented guarantee

**Invariant.** A provenance claim must be anchored in an owner/source credential or immutable owner evidence; self-consistent caller input is not independent provenance.

**Actual.** `I00_PRODUCT_BUILD_STATE.md:110` says provenance attacks fail closed. The implementation itself says the revision is deterministic structural binding, “not a signature or a source-authority grant” (`server/src/systemIntegration/adapters/foundationQuantityBridge.ts:170-173`). A caller may choose arbitrary canonical instrument metadata and compute the matching exported revision; the bridge accepts it. Existing substitution coverage at `server/test/systemIntegration/adapters/foundation-quantity-bridge.test.mjs:166-190` mutates fields while retaining the old revision, but does not model a malicious/self-consistent producer recomputing it.

**Reproduction.**

```sh
node --input-type=module <<'NODE'
import {
  compareJournalToFoundationQuantity,
  deriveFoundationQuantityInstrumentEvidenceRevision,
} from './server/dist/systemIntegration/adapters/foundationQuantityBridge.js';
const instrumentId = 'MARGIN:EVILUSDT';
const instrumentStep = '0.1';
const instrumentTolerance = '0.00000000000000001';
const instrumentEvidenceRevision = deriveFoundationQuantityInstrumentEvidenceRevision(
  instrumentId,
  instrumentStep,
  instrumentTolerance,
);
const result = compareJournalToFoundationQuantity({
  exactJournalQuantity: '0.1',
  foundationQuantity: 0.1,
  instrumentId,
  instrumentStep,
  instrumentTolerance,
  instrumentEvidenceRevision,
});
console.log(JSON.stringify({
  comparison: result.comparison,
  instrumentId: result.instrumentId,
  instrumentEvidenceRevision: result.instrumentEvidenceRevision,
}, null, 2));
NODE
```

Observed: `comparison:"WITHIN_TOLERANCE"` for the caller-selected identity. Expected: the state wording is limited to content integrity, or the revision is bound to canonical owner/source evidence before a provenance guarantee is asserted. Impact is bounded because no production consumer exists.

## PF-007 — duplicate-source enforcement is proof-only, not production admission

**Invariant.** A semantic stream has exactly one physical producer, and composition must reject a duplicate before either source starts.

**Actual.** `buildSystemSourceRegistry()` at `server/src/systemIntegration/adapters/sourceRegistry.ts:46-85` correctly rejects `DUPLICATE_SEMANTIC_PRODUCER`, but no production caller was found. `live-edge-receipts/L00_AUTHORITY_REUSE_MAP.md:35` explicitly records that it is not production-wired. This makes the static registry unable to stop PF-002 while the proof harness reports authority convergence.

**Reproduction.**

```sh
rg -n 'buildSystemSourceRegistry' server/src server/test live-edge-receipts
rg -n 'DUPLICATE_SEMANTIC_PRODUCER' server/src server/test
```

Observed: production definition/export but no production composition caller; test callers only. This is an enforcement gap. Apart from PF-002, the bounded static scan found no additional competing integration socket/cache/store/scanner/risk gate/control plane.

## Donor, receipt, and ancestry reconstruction

No donor-inventory or Git-object mismatch was found at source commit `03857dc`.

### Exact equality and receipt hashes

- `I00_PRODUCT_BUILD_STATE.md`, `fixtures/i00/closure-evidence.json`, and `fixtures/i00/receipt-provenance.json` each resolve to the same 16 unique Phase-2 donor tips.
- All 16 recorded donor tip objects are commits and all 16 recorded tree IDs match Git.
- Fifteen donors are exact second-parent integration ancestors.
- Dashboard is the intentional equivalence exception: `21/21` exact subtree entries at cut `d04fdc71ffbd9c8266c969524a56e325ec68b1f8`.
- `33/33` receipt-hash assertions match across 29 unique files: 17 acceptance receipts plus 16 integration-receipt assertions.
- The dashboard's current subtree has intentionally evolved after the equivalence cut; no current byte-equality claim is made.

| Donor | Donor tip | Recorded tree | Integration/equivalence cut |
| --- | --- | --- | --- |
| F-BRIDGE | `a0c0c2e5ef3180aa720488463643433cefeb65e5` | `b29f0b50…` | `0670f533840f415b612fb290d2c944f94af50d82` |
| SI-RECON | `f03ed786a8c5cab50ef27ad33026a74f79f7df87` | `c88cb7a5…` | `ba965fb0fbb5e10819d5a704e99153892fe94031` |
| Q-LANE | `02b4eccc8d2ef53b830cafae06e5175715fa6ebb` | `5c86cebf…` | `042dc9897d04bed2b0de3043cbdcbac408251412` |
| DASHBOARD | `69250158…` | `61d0c5a3…` | `d04fdc71ffbd9c8266c969524a56e325ec68b1f8` (receipted equivalence) |
| L15-INFRA | `2cec412927fa2f64f05a0b2774b18e45f8ce4fa5` | `e401435d…` | `35672dcc448d2ca55b17c24344fb413b4d1e14a7` |
| IP-RUNTIME | `8058ab8febb639839333d4e2c604068a0c7390ea` | `dd255f23…` | `f5523e63efcb0a5434341cf9328162be1482fc38` |
| IP-CONTROL | `56c47dad398c485b6653036c8b90c53f11061b1e` | `e335fc95…` | `d50de1dd1b23a40b3895b29fee5486bc069597af` |
| IP-OPS | `6bfd543afb693ea18f4baf08e962e6d698f140fb` | `572adc3c…` | `a6a12b943c77c54e60072f755beca984432bffa8` |
| IP-PROOF | `23e985c17b9b860fee26be397fa05b26f3daf8f2` | `1329fe73…` | `1d9b1a3a5e859501c4c0c47e6b2c8d0d82bc4698` |
| A-CORE | `08a0a09780727e2b4ba59017b5701998abe29b77` | `b904ca0f…` | `3ee0eda6b0da01b6fae441c684fa53829cab15be` |
| A-HAZARD | `ab33b3712cddd67c3ec91cfa1dd232c75226cd9f` | `e33224d4…` | `bfb813ba1c15a23c7f4f0bff6a8da2f13d5c2729` |
| A-COCKPIT | `d4ff9c94c9fec9477481223c4b33d8f671a34f6d` | `bda9b452…` | `0204687d8c65875c99d17ae7bee1c61707f0be0f` |
| A-AGENT | `97e87bd7045d2883ef8c4bd3cdb7f5daf83e0437` | `e68ef10d…` | `251d901e2a38c7b3b9634ab1728098655f0104bb` |
| A-STABILITY | `d35674e7f9621320c35e0bc0270efd515cc64dbd` | `16c92923…` | `332208e64fb9b54ef2b6320c7609e53833da469f` |
| A-CASE-S4 | `b4d8a446cb4cd6e77e7fbaf38f927b7513dc316c` | `3c773878…` | `86ee3b5f81c73c64eccf1d10b14a1f3bdf8a4bf1` |
| L-LANE | `df6b472993ca9659ce09cf5f72004981c6835f0d` | `1add5ee4…` | `ec82bc51d5311dfb3f505216bfb3fa41733f038c` |

Tree IDs abbreviated in this presentation were compared at full 40-hex width by the audit.

### L exactly last

```text
L merge: ec82bc51d5311dfb3f505216bfb3fa41733f038c
tree:    7192a94883f6ac43d0c7d06b2a0f24275a7feef8
P1:      139d2cf07ffd3167bd54a3c14c0fc6671c2f02e9
P2:      df6b472993ca9659ce09cf5f72004981c6835f0d
```

Seven one-parent serial-spine commits follow L. There are zero later first-parent merges. L merge is an ancestor of the source snapshot; the L donor tip is not an ancestor of pre-L P1.

```sh
git show -s --format='%H%n%T%n%P' ec82bc51d5311dfb3f505216bfb3fa41733f038c
git rev-list --first-parent --count \
  ec82bc51d5311dfb3f505216bfb3fa41733f038c..03857dcdaff8d8b12627d27ddcc97505da1f2f86
git rev-list --first-parent --merges \
  ec82bc51d5311dfb3f505216bfb3fa41733f038c..03857dcdaff8d8b12627d27ddcc97505da1f2f86
```

Observed: count `7`; later merge output empty.

### Q C17→A17 mapping

```text
C17:  4cc83f43edd9a50ff2d3e20970a57e2d0a57e92a
tree: 1aec7711f64419d50770d9c515d012173e982240
P1:   ba7323e0ac1f5013d9309b5b73998b84bdffbae5

A17:  02b4eccc8d2ef53b830cafae06e5175715fa6ebb
tree: 5c86cebf0966cedd7ba01c56a01704b4f7bd0224
P1:   4cc83f43edd9a50ff2d3e20970a57e2d0a57e92a
```

C17 is the immediate parent of A17; A17 is Q merge `042dc9897d04bed2b0de3043cbdcbac408251412` P2; each is an ancestor of source commit `03857dc`. Q17 acceptance receipt blob/SHA-256 is `3dad68c9dc52e97aadaec173930388e3404769e7` / `9cfa0356228d7f48674df2d9db523f0f0d53dab1a4e4255b6ba9676e463ec5dc`.

```sh
git rev-parse \
  02b4eccc8d2ef53b830cafae06e5175715fa6ebb^1 \
  4cc83f43edd9a50ff2d3e20970a57e2d0a57e92a^1 \
  042dc9897d04bed2b0de3043cbdcbac408251412^2
```

### A-FORMAL and S2 exclusions

- A-FORMAL `b491893416006cf529aef02e5dd4a25d6475e7b8`, tree `c48e7ddb5572a01190cf94cef2b2426a8df2f056`, is not an ancestor of the source snapshot; ancestry command exit `1`.
- S2 `ca30adf5e97b6697afec49f13073024d953b117b`, tree `1637f682c97d8fcbd4cd955afe0e48542bcb90d3`, is not an ancestor; exit `1`.
- Their four exclusive formal/action-evidence source and test subtrees are absent.
- Neither appears in the 16-donor table, closure donor set, or receipt-provenance donor set.
- Their recorded status is post-landing-only, director-controlled re-entry. The objects and matching refs resolve exactly.

```sh
git merge-base --is-ancestor b491893416006cf529aef02e5dd4a25d6475e7b8 03857dc
git merge-base --is-ancestor ca30adf5e97b6697afec49f13073024d953b117b 03857dc
```

Both commands are expected to exit `1` for the recorded exclusions.

## Fresh hydration and mandatory test ledger

Before hydration, `node_modules` was absent. `package-lock.json` SHA-256 was and remains `3c97820f912390fcad3dab57b436319b95c15bc7877384dd98032d7751ec2fcf`.

Raw stdout/stderr were captured outside the worktree under `/tmp/role3-preflight-03857dc.4UWb0x/`. The paths are ephemeral; the content hashes below make each captured stream identifiable.

| Command | Exit | Exact measured result | stdout SHA-256 | stderr SHA-256 |
| --- | ---: | --- | --- | --- |
| `npm ci` | `0` | 229 packages added; 232 audited; 0 vulnerabilities; one deprecation warning | `f917fb5d113652e5f93cc288e33b126daab632c9aeee6768e36abda3f9045c57` | `fe49a93af7f6a5072c3a3ef65019009ce521808d6b5a32810ad9a6a433f4524d` |
| `npm test` | `0` | Basis 107/107; Volume 124 checks; financial safety 59/59; storage/config/AWS 29/29; focused Node 51/51; stream lifecycle 7/7; perimeter 2/2; Product Assurance 802 behavior + 4 provenance, operation scan 515 files / 207 discovered / 207 covered / 0 uncovered; I00 acceptance contracts 38/38 | `72260a1c25672754532587b3a0bc25a0c60f680f708fd27201ccb913d4a9a637` | `ccb6bf354a0674eeb1e49df9a880a000b75240079fdb849282bb899d81eeb58c` |
| `npm run test:all` | `1` | All families through Product Control passed; I00 proof 45/46 failed; shell short-circuited before I00 commands and Live Edge | `b01d85bb967935cd9dfeec9736b82627cd1acbad1d62e09961aeffbdf5aa7080` | `ccb6bf354a0674eeb1e49df9a880a000b75240079fdb849282bb899d81eeb58c` |
| `npm run test:protocol` | `0` | 22/22 | `d195efa54c35b87389eaf93d24ccab920f73ded85bf917e9fa3c0328255bc15f` | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `npm run test:i00:proof` | `1` | 45 pass / 46; committed-vs-rebuilt machine-evidence mismatch | `56a460aad57e8010d1f666f4db58e5d3420999eea3a04768f87a5e5b817117b3` | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `node test/i00/product-assurance-operation-overlay.mjs --fail-on-uncovered` | `0` | 515 scanned / 207 discovered / 207 registered / 0 uncovered | `268d51af32d208d6040278d52232a60afe2e6cf340f0b1d3552b465f7db676e3` | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `npm run test:i00:commands` | `0` | 28/28; run separately because aggregate short-circuited | `ac4705de356c05f01932258fdf81da33ffcecabbd0f2e2500051758f4cfd66f0` | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `npm run test:live-edge:built` | `0` | 1618/1618; run separately because aggregate short-circuited | `5a2c314c309290029d0f7d017bbaa2840dff1dda1c7f22450fe7a20df4872725` | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `node --test --test-concurrency=1 server/test/perimeter.mjs` | `0` | 2/2; confirms the two required startup REST attempts | `712439fa0b7025e30eb896acb3aadc7a0bb6535fe5342ec44f8968c0b4f1bc28` | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |

The aggregate completed these additional family counts before its proof failure:

- app gate `78/78`, but with PF-001;
- Intelligence Foundation `152` dot-reporter tests;
- Intelligence Runtime `394`;
- Capital Foundation `433`;
- System Integration `374/374`;
- protocol `22/22`;
- Product Integration `108/108`;
- Product Control `72/72`.

The Foundation runner is a sequence of custom scripts rather than one TAP total; every script before the integration family exited `0`. Material reported counts include borrow 179/179 plus import-purity 31/31, control 97/97, Binance USD-M 251/251 plus import-purity 59/59, execution 178/178 plus import-purity 30/30, compatibility 131/131 plus import-purity 29/29, reconciliation 75/75 plus import-purity 27/27, replay 132/132 plus import-purity 34/34, risk 884/884, and scenarios 80/80 plus import-purity 33/33.

## Authority and import-purity negative evidence

These bounded checks found no additional authority/import-purity defect beyond PF-002 and PF-007:

- System Integration static, import, and passive-port gates: `1/1` each, exits `0`.
- System Integration owner adapters: `3/3`, exit `0`.
- Product Integration static and import purity: `1/1` each, exits `0`.
- Live Edge source/import gate: `2/2`, exit `0`.
- Foundation contracts: `78/78`; all ten purity scripts exit `0`.
- Intelligence Runtime import purity: `15/15`, exit `0`.
- Product Assurance agent boundary: `2/2`, exit `0`.
- Static scans found zero forbidden signed/private System Integration imports, zero new System/Product Integration sockets or databases, and zero pure-domain ambient environment, filesystem, network, timer, randomness, or wall-clock use.
- Existing scanners, proposal stores, risk, Ledger, and control constructs remain confined to their documented owner families.

## Evidence limitations

- This source snapshot predates the frozen candidate and contains no runtime/browser/performance acceptance receipt. This scout did not run owner-gated private reads, signed validation, deployment, cloud mutation, or any money path.
- No sibling worktree was read or modified. Donor equality was reconstructed from committed Git objects, recorded hashes, and ancestry, not from sibling worktree cleanliness.
- `fixtures/i00/proof-catalog.json` remains bound to baseline `18a0b9d1153a5f4bb6c8b42909362c6a295475bb` with a null candidate commit. It corroborates the donor tuple but is not independent proof bound to source commit `03857dc`.
- Root state uses `POSTLANDING_EXCLUDED` while closure/resource evidence uses `NOT_CONFIGURED` for A-FORMAL/S2 with the same tips and reasons; candidate normalization explicitly handles this representation difference.
- Frozen A-CORE generated artifacts still contain pre-landing satellite-missing wording. That wording is stale globally but consistent with the candidate-local exclusion.
- No claim in this document transfers to a later candidate SHA. The real verifier must rerun critical classes against the exact frozen candidate.
