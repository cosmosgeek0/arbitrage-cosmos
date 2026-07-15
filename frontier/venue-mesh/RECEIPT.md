# F1 VenueMesh prestage receipt

## Terminal receipt

- `buildState: PRESTAGE_READY`
- `disposition: ACTIVE`
- `terminalLabel: VENUE_MESH_PRESTAGE_READY`
- `READ_ONLY`
- `UNWIRED`
- `FIXTURE_ONLY`
- `NO_CREDENTIALS`
- `NO_ORDER_AUTHORITY`

This receipt is compatibility and deterministic fixture evidence only. It is not a live, integrated, trade-ready, edge-proven, profitable, production-isolated, mounted, or deployable claim.

## Git and authority receipt

| Evidence | Exact value |
|---|---|
| branch | `f-venue-0715f` |
| immutable accepted Main / `FRONTIER_BASE_SHA` | `f0168cb37bd04d21bc90591ab2256770de3b75bc` |
| immutable accepted F0 Dock commit | `e0ace68de5d56bdfe51bb30cf74e44c6f109dfd5` |
| prebuild HEAD | `e0ace68de5d56bdfe51bb30cf74e44c6f109dfd5` |
| Dock/HEAD merge base before build | `e0ace68de5d56bdfe51bb30cf74e44c6f109dfd5` |
| Dock ancestry | `git merge-base --is-ancestor e0ace68de5d56bdfe51bb30cf74e44c6f109dfd5 HEAD` passed |
| directive path | `frontier/directives/Frontier.md` |
| directive blob | `089a57473f26b1731e55b583c3e9152edc546c79` |
| directive SHA-256 | `4bb325b23c70e56103ee1553f0ea4396774ce0950d7abc9c73faa01f7006e1ad` |
| F1 scout commit | `86b41ea0877e4c803854cfbc1a17eddf8e91f04f` |
| F1 scout blob / raw SHA-256 | `99a250ed68d05fd8db2280a3e94d8bc2e84b3c8a` / `39ef993dbde3e79bea6c9983ff5237afdb055b0c2e47925a9ec7f2dddeba670d` |
| owner adjudication | `APPROVED_REAL_DELTA`; Q/L and relevant product owners stable |
| accepted Q owner commit | `02b4eccc8d2ef53b830cafae06e5175715fa6ebb` |
| accepted L owner commit | `df6b472993ca9659ce09cf5f72004981c6835f0d` |

The exact final seal HEAD is the commit containing this receipt and is reported by the post-commit `git rev-parse HEAD` readback. Embedding a commit’s own SHA inside its tree is self-referential; the descriptor pins accepted Main as `immutableBaseSha` and the prebuild Dock/branch HEAD as `sourceSha`.

## Dock compatibility receipt

- required facets are exactly `EVIDENCE/VALIDATE_FIXTURE` and `DERIVED_FEATURE/EVALUATE_FIXTURE`;
- both inherited bindings are `USABLE`, `FIXTURE_ONLY`, `NO_AUTHORITY`, read-only;
- binding hashes are `69979efb8e2f01bee7d84d4e44cfeeb4116a268694112a44770da2b07460822d` and `8f2768ad7eac3e2a273c457a05810cff19ac4ca174fd8fb77ddf70b3ec18ce86`;
- the evidence adapter maps the exact `MarketEvidenceEnvelopeV1` root to that canonical contract; the derived adapter maps the exact Q `FeatureValueV1` root to that contract. Both are identity-only, preserve exact event/receive times under injected clocks, preserve units/unknowns, and round-trip real runtime materializations;
- unavailable evidence is not forced through either canonical map: it produces an explicit non-canonical adapter result with `canonicalEvidence: null`;
- no `COCKPIT_PROJECTION` facet exists for F1;
- descriptor hash: `e77a215486fc559f65261f24ab3138a48757d10fcbe4629eae54d02d36e2a1cd`.
- contract/research/honesty artifact SHA-256 values are sealed in `CONTRACT_HASHES.sha256` and verified by the isolation suite.

## Current-source research receipt

Official Coinbase, Kraken, and Deribit product/instrument, ticker/trade/book, and legal/terms sources were reviewed at `2026-07-15T19:49:03Z`. Exact URLs and retrieved content hashes are recorded in `RESEARCH.md`.

All documentation examples remain synthetic pinned fixtures. No legal conclusion, live entitlement, retention right, redistribution right, or production admission is inferred. Coinbase and Deribit terms retrieval returned HTTP 403 through `curl`; the pages were reviewed through the browser and their content hashes remain `UNAVAILABLE`. Every source card consequently remains review-only and market-data retention-ineligible.

## Focused test receipt

Command:

```sh
node --test --test-concurrency=1 --test-reporter=spec \
  frontier/venue-mesh/tests/venue-mesh.test.mjs \
  frontier/venue-mesh/tests/isolation.test.mjs
```

Latest pre-seal result:

- tests: `50`
- pass: `50`
- fail: `0`
- skipped: `0`
- todo: `0`
- duration: approximately `246 ms`

Only the two module-local test files were run. The full repository, `npm test`, `npm run test:all`, I00, browser ship, live transport, and integration batteries were intentionally not run.

Resource proof:

- fixture rate: 50 events per 1000 ms;
- maximum fixture queue depth: 8;
- measured deterministic-step latency: p50 2, p95 4, p99 6, within limits 3/5/7;
- storage growth: 1600 fixture bytes per window, within limit 2000;
- network bytes: 0;
- model calls: 0;
- beyond rate/queue envelope: `DEGRADATION_REQUESTED`, 0 accepted, no silent loss, no canonical state.

## Adversarial correction receipt

The first focused green was not accepted. A separate read-only adversarial review identified false-green paths, which were corrected and rerun:

- clean committed trees now satisfy the isolation suite;
- evidence/context use exact allowlists and reject nested effect fields;
- health and comparison recompute age at injected evaluation clocks;
- BTC-settled inverse perpetuals do not coerce to `USDM_PERP`;
- evidence legs bind to supplied venue identities;
- changed terms invalidate fixture eligibility;
- online-but-suspended/limit-only/cancel-only instruments are unavailable;
- adapters round-trip runtime materializations, not only hand-authored vectors;
- sequence overlap fails closed;
- leadership requires distinct venues, shared identity, direction, freshness, and source eligibility;
- canonical UTC minimum cannot be bypassed by zero;
- market decimals must arrive as exact strings;
- all proved-missing context classes are explicit.
- accepted Main base, Dock commit, prebuild HEAD, and final post-commit HEAD are distinct receipt fields;
- canonical adapter maps target the canonical roots they name, and unavailable evidence remains explicitly unmapped;
- licensed context is re-evaluated from the full source-card envelope at cutoff and bound to graph source/origin;
- derived projections and the exported JSON schema reject additional effect-shaped fields;
- REST/stream path classes and source provenance are enforced;
- non-primary dependence requires a real copy edge;
- Coinbase product IDs must agree with explicit base/quote metadata;
- health projection preserves every extension quality/state field while refusing to infer live canonical health;
- the checked sequence and honesty corpora are now executed/bound rather than merely counted.

The corrected focused run is the only result used for this receipt.

## Scope and mutation receipt

- all created files are under `frontier/venue-mesh/**`;
- no file under `frontier/dock/**` or any other repository path was edited;
- no other worktree, Main, candidate, integration worktree, Q, L, IP, AI-Ops, server, web, ops, shared package, root manifest/lock, route, persistence, deployment, or secret was changed;
- no merge, rebase, push, mount, wire, deployment, credential use, live transport, or external mutation occurred;
- post-seal worktree requirement: clean;
- post-seal ancestry requirement: exact Dock ancestor preserved;
- post-seal path requirement: `e0ace68de5d56bdfe51bb30cf74e44c6f109dfd5..HEAD` contains only `frontier/venue-mesh/**`.

## Limitations

VenueMesh remains fixture-only and unwired. It cannot claim canonical source truth, executable venue semantics, product health, a cockpit surface, a live opportunity, trade feasibility, edge, profit, or readiness for capital. Every future shared seam is owner-gated in `INSERTION.md`; no requested mutation has been implemented.
