# Q02-001 — immutable research lake boundary

Status: `ACCEPTED_FOR_Q02_IMPLEMENTATION`

Date: 2026-07-12

## Decision

Build Q02 as a bounded immutable research-evidence boundary on the accepted Q01 lock: CPython `3.13.14`, PyArrow `25.0.0` and DuckDB `1.5.4`. Encode one versioned Arrow schema into deterministic Parquet with a fixed writer profile, exact integer/decimal values, explicit source time/unit plus normalized UTC nanoseconds, explicit null/quality state and a unique total row order. Admit a partition only through a validator that is pinned to the expected complete-manifest SHA-256 supplied by an independent accepted reference.

The Q02 `ReferenceMarketEvidenceRowV1` is explicitly event-timestamped-only and binds that coverage limit in Arrow metadata. It rejects a null exchange event time and never substitutes receive time. This is a synthetic proof schema, not the universal Q03 normalization contract. Before capturing Spot `bookTicker` or another source without authoritative `E`/`T`, Q03 must add a separate versioned nullable-source-time schema with an explicit deterministic partition/order clock basis and null-safe manifest bounds.

Use a canonical manifest envelope whose core binds dataset/revision/schema identity, derived partition location, payload hash/size/rows, bounds, quality counts, lineage, producer/code/config/lock inputs, writer profile and retention class. Compute logical IDs from canonical bytes without a self-hash cycle. Payload and manifest hashes prove integrity relative to an external trust anchor; they do not prove publisher authenticity, licensing, upstream completeness or factual truth.

Publish exclusively and manifest-last beneath a pre-existing non-symlink root held open by directory descriptor. Derive every location from strict ASCII path segments; traverse and mutate only descriptor-relative with no-follow opens; keep staged descriptors open through hard-link and final verification; compare linked inode, size and exact bytes before and after the marker; verify directory identities across publication; reject traversal, symlinks, staged-name substitution, absolute paths and caller-selected paths; `fsync` staged bytes and parent entries; and publish without replacement. Failures before the manifest-link attempt are incomplete, while the link attempt and anything after it have an explicitly indeterminate acknowledgement that must be resolved from an external manifest anchor. `UNVERIFIED` requires structural and payload self-consistency; malformed markers or incomplete/corrupt payloads are `CORRUPT`. Corrections create artifact-bound lineage revisions whose publication time cannot precede the parent and whose parent manifest/payload passes a complete anchored read. Retention accepts a bounded immutable manifest tuple and emits only engine-derived plans with canonical paths, controlled reasons and manifest/lineage preservation fixed true; Q02 deletes nothing.

Expose DuckDB only as a fresh in-memory, single-thread query helper over the exact sealed validator result type. The nominal wrapper is assignment-closed and checks a seal over its exact table/manifest/row identities and contents at every accessor; subclasses are rejected. Disable external access, extension auto-install/autoload, unsigned/community extensions, Python replacement scans, file/HTTP caches and persistent/unredacted secrets; disable spill, bound memory/results, lock configuration, and accept only versioned fixed queries with bound scalar values and a unique total order. Never accept SQL, identifiers, fragments, paths, URIs, connections or foreign tables.

Represent launch Q-C source admission with immutable versioned source cards and a pure eight-gate evaluator that compares the card's owner reference with the canonical owner reference supplied by its caller. The contract records eligibility evidence but assigns no owner and owns no producer or registry; Q02 admits no source. Represent launch Q-E owner judgments as immutable annotations that bind evidence visible at tagging and outcome visibility. Join later objective outcomes only through a separate append-only link record; neither channel overwrites objective labels or authorizes action.

## Fixed storage profile

- Canonical sort: `(event_time_ns, receive_wall_time_ns NULLS LAST, session_id, stream_id, sequence_first NULLS LAST, record_id)`; duplicate IDs or full keys fail.
- Parquet: format `2.6`, data page `1.0`, row group `4096`, hard page cap `1024` rows, write batch `1024`, target page `65,536` bytes, no compression/dictionary/byte-stream split, explicit `PLAIN` encoding, statistics and page checksums on, page index off, stored Arrow schema, no timestamp coercion/truncation or INT96, compliant nested type, no decimal-as-integer shortcut, encryption/Bloom/content-defined chunking off.
- Reader: manifest size/hash/canonicality and caller-pinned expected manifest SHA first; then payload path/size/SHA/schema/provenance; then `BufferReader`/`ParquetFile` with no memory map, prebuffer or read threads, page checksum verification on, Arrow extensions off and Thrift string/container limits `1,048,576`/`65,536`; finally exact decoded invariants.
- DuckDB: `threads=1`, `memory_limit=64MB`, `max_temp_directory_size=0B`, `enable_external_access=false`, extension auto-install/autoload/unsigned/community disabled, replacement scans and external/HTTP caches disabled, persistent/unredacted secrets disabled, scalar multi-row errors enabled and configuration locked.
- Byte identity: claimed only for the exact lock, schema, writer profile and accepted platform golden vector. Any dependency/build/platform/profile change requires a new decision and golden proof.

## Quality and authority rules

Quality is derived conservatively from validated signals and reason codes into exactly `COMPLETE`, `PARTIAL`, `GAPPED`, `STALE`, `RECONSTRUCTING`, `SAMPLED`, `UNAVAILABLE`, `SYNTHETIC` or `UNKNOWN`; callers do not assert the resulting enum directly. The input cap reserves eight engine-owned reason slots, so every accepted facts object is derivable within the immutable 32-reason assessment bound. Contradictory signals fail. Each raw clock validates its own declared/inferred unit, so different event/trade/receive fields may preserve different explicit units without coercion while a single semantic column cannot mix units inside a partition. `UNAVAILABLE` and unknown values never become zero, and a synthetic reference partition is never described as market evidence.

This lake owns only immutable Q-lane research artifacts. Intelligence Runtime remains the public-source/socket/snapshot/rate-budget owner; Intelligence Foundation remains the operational evidence/feature/outcome owner; the existing ledger remains operational durability owner. Q02 creates no source manager, scanner, cache, current-universe authority, objective-label owner, experiment server, operational ledger or money/order/capital/risk path.

## Standards posture

Use W3C PROV-DM entity/activity/agent and derivation concepts for native lineage, and RFC 8493 BagIt completeness/validity concepts for inventory reasoning. Do not claim W3C PROV or BagIt conformance: Q02 emits neither their standard serializations nor a validated BagIt package. The bounded native contract is controlling.

## Basis

- PyArrow exposes the required explicit writer and checksum-verifying reader controls; exact local probes on `25.0.0` preserve decimal/null/schema values and produce stable bytes for identical inputs.
- A manifest that supplies its own only trust digest can be substituted with its payload. Requiring the expected complete-manifest hash from an accepted caller/parent creates the needed trust boundary.
- Descriptor-relative manifest-last exclusive publication gives one observable commit marker, contains pathname races, makes payload-only crashes explicit, and distinguishes an indeterminate post-link acknowledgement without overwrite or silent repair.
- DuckDB Arrow registration avoids filesystem parsing, while a fixed-query API removes the SQL/path/identifier injection surface. Settings are defense in depth, not a native-process sandbox.
- Separate append-only outcome links preserve whether an owner annotation was blinded when made; embedding a later outcome would mutate or contaminate that evidence.
- Source-card eligibility evidence can be tested before any producer exists, preserving canonical ownership and preventing Q02 from admitting a source by implication.

Research evidence and primary references are recorded in `docs/Q02_STORAGE_RESEARCH.md`.

## Rejected alternatives

- Trusting a manifest digest carried only by that manifest or its same untrusted directory: no independent substitution anchor.
- Random temporary names, `os.replace`, repair-on-read, mutable correction rows or destructive retention: nondeterministic identity or silent history loss.
- Caller paths, permissive IDs, symlink traversal or a manifest-derived path accepted without recomputation: path escape/substitution surface.
- Default Parquet settings, floating money/price values, implicit row order, fabricated zero/null fill or cross-version byte-stability claims: ambiguous or false evidence.
- Treating receive time as exchange event time, or claiming this event-timestamped proof schema covers sources whose source time is unavailable: fabricated chronology; Q03 requires a separate versioned contract.
- DuckDB file scans, arbitrary SQL, connection injection, replacement scans, extensions or unbounded queries: exceeds the validated-Arrow analytical seam.
- Treating hashes as authenticity/license proofs, native provenance as standards conformance, a source card as producer authority, or annotations as objective/probabilistic labels: unsupported claims.

## Consequences

- Q02 tests must prove separate-process golden byte identity, exact round trips, external-manifest substitution denial, corruption/truncation/schema/path/symlink/overwrite/incomplete failures, immutable correction lineage, non-destructive retention and closed DuckDB query/file/extension surfaces.
- Q02 materializes only a small synthetic reference partition. Historical downloads, forward capture, Event Atlas, book reconstruction, objective outcomes, features, models and external source admission remain later phases.
- The manifest and annotation structures are intentionally versioned. Any change creates a new schema/profile/version and migration decision; accepted bytes are never rewritten.
