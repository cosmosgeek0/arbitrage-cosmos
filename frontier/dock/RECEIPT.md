# F0 Dock terminal receipt

## Seal identity

```text
programOrgan: F0 Dock
branch: f-dock-0715f
immutableBaseSha: f0168cb37bd04d21bc90591ab2256770de3b75bc
sourceAncestrySha: df9c52cd2a428e3d3675cf0260c0d30052a4bbff
directiveSha256: 4bb325b23c70e56103ee1553f0ea4396774ce0950d7abc9c73faa01f7006e1ad
buildState: PRESTAGE_READY
disposition: ACTIVE
terminalLabel: FRONTIER_CONTRACT_READY
```

`sourceAncestrySha` is the required first directive-pin commit. The final sealed source commit is the commit containing this receipt; its exact full SHA is resolved and printed after commit because a commit cannot embed its own hash.

## Directive gate

- Original: `/Users/cosmosgeek/Desktop/Frontier.md`
- Frozen copy: `frontier/directives/Frontier.md`
- Both sizes at pin: `83,408` bytes
- Byte comparison: `PASS`
- SHA-256 check: `PASS`
- Required first commit: `df9c52cd2a428e3d3675cf0260c0d30052a4bbff`
- First-commit path set: exactly `frontier/directives/Frontier.md` and `frontier/directives/Frontier.sha256`

## Dock-local verification

Environment: Node `v22.23.1`; npm `10.9.8`. No dependency install or product import was required.

Command:

```sh
node --test frontier/dock/tests/conformance.test.mjs
```

Result: exit `0`; `28` tests, `28` passed, `0` failed, `0` skipped, `0` cancelled.

| Case | Result | Proof subject |
|---:|:---:|---|
| 01 | PASS | Unsupported contract major fails closed |
| 02 | PASS | Unknown fields survive without changing known semantics |
| 03 | PASS | Missing required fields fail |
| 04 | PASS | Undeclared capability and egress fail |
| 05 | PASS | Self-granted authority fails |
| 06 | PASS | Deterministic canonicalization; external attestation excluded |
| 07 | PASS | Tamper, wrong signer, expiry, and revocation fail |
| 08 | PASS | Stale/silent/missing/unknown/provenance/uncertainty round-trip |
| 09 | PASS | Expected missing inventory is preserved |
| 10 | PASS | Exhaustion requests degradation; no canonical-state forgery |
| 11 | PASS | Fixture sandbox blocks out-of-sandbox write; source import boundary checked |
| 12 | PASS | Duplicate identity fails |
| 13 | PASS | Hash mismatch fails |
| 14 | PASS | Disable is idempotent |
| 15 | PASS | Rollback requires exact pinned version |
| 16 | PASS | Uninstall cannot delete canonical evidence |
| 17 | PASS | Fixture output cannot claim canonical exchange/account truth |
| 18 | PASS | Advisory output cannot reach deterministic effects |
| 19 | PASS | Fixture transport cannot become network transport |
| 20 | PASS | Port request names exactly all intended seams |
| 21 | PASS | All eight facets reject cross-class invocation |
| 22 | PASS | Disable/removal clears and checks module-owned dependencies |
| 23 | PASS | Resource dimensions are measured or explicitly unavailable |
| 24 | PASS | Envelope breach fails closed without false green |
| 25 | PASS | Every facet resolves exact owner/contract/version or insertion blocker |
| 26 | PASS | Scenario reference is immutable and cannot execute or mutate truth |
| 27 | PASS | Required declarations and canonical references are explicit |
| 28 | PASS | At-limit and beyond-limit load prove bounded backpressure |

Additional Dock-local checks before seal:

- every JSON contract, fixture, and example parses;
- all `39` embedded Git object/blob/raw-SHA evidence tuples resolve and match immutable repository objects;
- descriptor, adapter map, scenario, inventory projection, owner map, module map, and insertion request validate through the Dock reference implementation;
- `shasum -a 256 -c frontier/dock/CONTRACT_HASHES.sha256` passes;
- ESM syntax/import checks pass;
- Git whitespace check passes;
- base-to-seal changed paths remain within the exclusive directive pair and `frontier/dock/**`.

No browser acceptance, full-repository suite, replay campaign, fuzz campaign, product repair, wiring, refactor, merge, push, credential access, transport, or mutation was performed.

## Canonical-owner resolution

- `7` facets are `USABLE` against exact repository commits, contracts, versions, and object evidence.
- `ANNOTATION_ADAPTER` is `BLOCKED` with `CANONICAL_Q_ANNOTATION_REVISION_RETRACTION_CONTRACT_UNRESOLVED` and a precise insertion request.
- The exact module/facet matrix proves that only `F11 LabelForge` depends on the blocked facet.
- A blocked facet was not replaced with a private generic envelope.
- The companion shared-owner map binds exact Q, IP telemetry/inventory, packet-local AI-Ops agent/policy, and product-health references; `PRODUCT_INCIDENT` stays separately blocked by `INCIDENT_OWNER_NOT_CONFIGURED` without blocking an unrelated facet.

## Contract identities and examples

`CONTRACT_HASHES.sha256` freezes all seven contract records, three fixtures, and four generated examples. The examples are:

- `ExtensionDescriptorV1` with `descriptorHash` `3ce6aacadf14c172d768c03546f59ffbb0af41229595c0f66a5c801c5a0e4b67`;
- `CanonicalAdapterMapV1` with `adapterHash` `29383e6984c0a7748058ac3050e05ecb2b17f22fa692abb82975300711ee9aa2`;
- `ScenarioReferenceV1` with `scenarioHash` `c6fda794de08e979b4e47cd3d8372e9d28c724ea31ef15fb0cf6982c962dcbb7`;
- read-only `ModuleInventoryProjectionV1`.

## Honest boundary

This receipt proves deterministic fixture compatibility only. It does not prove production isolation, runtime safety, mounted behavior, canonical policy approval, product integration, edge, live readiness, or profit. All lifecycle and shared-system actions remain future canonical-owner work.
