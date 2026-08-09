# DQ-14 source-access replay validator

DQ-14 is one portable, deterministic validator for replaying explicit source-access evidence and checking terminal claims. It starts from a declared pre-run inventory, replays a canonical hash-chained ledger, derives source scope and holdout state, and accepts a terminal verifier claim only when every binding is exact.

The replay core is pure: it receives immutable values, with strict canonical-JSON helpers for persisted projections, and does not access the filesystem, open or decompress archives, use the network, consult clocks or environment variables, launch subprocesses, or install Python audit hooks. An integration must record events at its controlled source-access facade and then pass those records to DQ-14.

## Contract

The pre-run inventory fixes the complete run, archive, and member identities before access. Archive members are distinguished by archive identity, member ordinal, member name, declared byte count, and content digest; duplicate names therefore remain distinct. Portable references and member names use a frozen printable-ASCII subset. Each source also carries its declared role, including holdout status, and identical archive or member content digests may not straddle roles.

The ledger records an explicit, irreversible sequence for each access:

1. archive-open attempt, then success or failure;
2. decompression attempt, then success or failure;
3. read attempt, then complete success or failure.

Every event is canonicalized and SHA-256 hash-chained to the previous event. Sequence gaps, reordering, duplicate transitions, unknown inventory entries, identity or digest drift, skipped stages, cross-access substitution, and stale terminal anchors after appended events fail closed. An attempt is itself access evidence: after an open attempt, the source cannot truthfully be claimed `UNOPENED`, even when the operation fails. Conversely, `OPENED`, `DECOMPRESSED`, and `READ_COMPLETE` require their corresponding successful transitions.

DQ-14 derives the terminal `sourceScope` from the inventory plus replayed events; it does not trust a copied scope. Archive/member stages are monotone high-water marks across access IDs, while an independent `failed` coordinate preserves every witnessed failure without erasing an earlier successful read. It also derives exact overall and holdout failure counts. Any holdout access attempt defeats an untouched or sealed claim. The supplied terminal claim must exactly equal those derived values.

A passing verifier claim is bound to the exact inventory digest, event-ledger terminal digest, derived source-scope digest, derived holdout-state/failure coordinates, terminal-claim digest, and declared validator-source digest. Missing, stale, or mismatched bindings fail closed. Hash agreement establishes deterministic consistency only; it is not a signature or an external trust decision.

`UNOPENED` has one narrow meaning: no eligible access attempt appears after the pre-run seal. It is never a claim that acquisition, custody, or inventory preparation did not access the source historically.

## Hostile proof boundary

Tests use neutral synthetic archives and include both directions of false reporting:

- a pre-run all-unopened scope copied forward after synthetic development-source open, decompress, and read transitions;
- an opened or read claim with no supporting transitions;
- attempted or failed access mislabeled untouched;
- reordered, interior-omitted, duplicated, cross-bound, or stale-post-terminal events;
- duplicate member names, partial reads, digest or size drift, and stale verifier bindings.

These fixtures reproduce the shape of the failure class without importing, opening, decompressing, reading, modifying, or retrovalidating any shared archive or the preserved V-G38 packet.

## Focused proof

Run from `quant/` after the module, command entry point, and tests exist:

```bash
uv run --locked --no-sync python -m research.dq14 --help
uv run --locked --no-sync python -m research.dq14 --verify-known-answer
PYTHONPATH=. uv run --locked --no-sync pytest research/dq14 -q
uv run --locked --no-sync ruff check research/dq14
MYPYPATH=. uv run --locked --no-sync mypy --strict -p research.dq14
```

The proof is deterministic, local, synthetic, and money-free.

## Limits

DQ-14 proves explicit-facade consistency only.

- Bypass around the instrumented facade cannot be detected.
- If a caller deletes or edits any ledger events and rebuilds every unauthenticated terminal and verifier claim over that altered ledger, DQ-14 cannot discover the missing or changed history. Detecting that requires an independently held or authenticated final count/tip.
- Inventory role labels are declarations; DQ-14 does not prove role correctness.
- Inventory content digests are checked for internal consistency; DQ-14 does not independently establish source content.
- `validator_source_sha256` is a frozen declaration carried through every binding; the pure core does not read its own module bytes to authenticate that declaration.
- The ledger and verifier claim are not authenticated provenance. Digital signatures and an external root of trust are out of scope.
- No existing packet, including V-G38, is retrovalidated.
- No profitability conclusion follows from replay acceptance.
- No UI, host, provider, private-data, order, transfer, withdrawal, money, deployment, or operational authority is granted.

See [REFERENCES.md](REFERENCES.md) for the primary specifications behind the boundary.
