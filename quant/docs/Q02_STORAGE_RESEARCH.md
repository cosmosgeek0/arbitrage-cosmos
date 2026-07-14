# Q02 immutable storage research

Evidence cutoff: 2026-07-12. This note records the implementation facts used by Q02; it admits no external market source and makes no portability, authenticity, standards-conformance or trading claim.

## Locked execution identity

Q02 adds no dependency. It uses the accepted Q01 lock:

| Component | Exact identity |
| --- | --- |
| Python | CPython `3.13.14` |
| `uv` / build backend | `0.11.28` / `0.11.28` |
| PyArrow | `25.0.0` |
| DuckDB | `1.5.4` |
| Polars | `1.42.1` (not required by the Q02 storage boundary) |
| Lock | `uv.lock` SHA-256 `3449f6eb892e2e5dd27dd48a735f9fe30d1ddfb38f16d858bba60202f5f4ed81` |
| Accepted platform evidence | `cpython-3.13.14-macos-aarch64-none`, build marker `20260623` |

The accepted macOS arm64 PyArrow wheel SHA-256 is `8831a3ba52fa7cdb78d368d968b1dcd06171e6dff5461e16d90de91d371e47bc`; the DuckDB wheel SHA-256 is `0f32ad7e0286c1c29ab6c73b29118c86101f8eee46aae54f54d0b50916f542f6`. These are replay identities, not publisher authentication.

## Arrow and Parquet findings

PyArrow's `write_table` API exposes format version, timestamp coercion, dictionary/statistics/compression, row-group and page sizing, page checksums, page index, sorting declarations and Arrow-schema persistence. A sorting declaration is metadata only; Q02 must sort and validate rows itself. Parquet `version="2.6"` supports nanosecond logical types, so Q02 preserves explicit source integer/unit semantics plus normalized `timestamp[ns, UTC]` without coercion or truncation. Arrow `decimal128` represents fixed-point decimals as an integer coefficient plus a declared scale with precision from 1 through 38; Q02 stores the coefficient as `decimal128(38, 0)` and preserves its declared `uint8` scale separately after integer-bound validation. It never accepts a float.

Canonical rows are sorted by the unique total key `(event_time_ns, receive_wall_time_ns NULLS LAST, session_id, stream_id, sequence_first NULLS LAST, record_id)` before table construction. Schema field order and metadata key order are fixed. Duplicate record IDs or full total-order keys fail before encoding. Each raw clock carries and validates its own explicit unit: event/trade fields may therefore be microseconds while a local receive clock is milliseconds or nanoseconds without coercion or false ambiguity. Nulls remain null; unavailable values are never replaced by zero.

This `ReferenceMarketEvidenceRowV1` is deliberately an **event-timestamped-only reference schema**, which is bound in its Arrow metadata. It requires an authoritative exchange event time and refuses to substitute a local receive time. It therefore does not accept Spot `bookTicker` messages that lack `E`/`T`. Q02 stores no such source. Before Q03 captures book ticker, Q03 must introduce a separate versioned nullable-source-time schema whose manifest declares an explicit deterministic partition/order clock basis (for example, receive wall time when source event time is unavailable), with null-safe bounds and tests. Until that contract exists, book-ticker source-event time is `UNAVAILABLE`, not fabricated.

The Q02 writer profile is fully specified:

| Setting | Bound value |
| --- | --- |
| Parquet format / data page | `version="2.6"`; `data_page_version="1.0"` |
| Ordering | physically sorted by the canonical six-field key above with nulls last; matching sorting columns declared |
| Row group / hard page row cap / write batch / target data page | `4096` / `1024` / `1024` / `65,536` bytes |
| Compression | `"NONE"`; `compression_level=None` |
| Dictionary / byte-stream split | disabled |
| Statistics / page checksum / page index | enabled / enabled / disabled |
| Timestamp handling | `coerce_timestamps=None`; `allow_truncated_timestamps=False`; no deprecated INT96 |
| Schema / nested convention | Arrow schema stored; compliant nested type enabled |
| Decimal physical shortcut | `store_decimal_as_integer=False` |
| Encoding / remaining optional features | explicit `PLAIN`; encryption, Bloom filters and content-defined chunking disabled |

`flavor`, `filesystem`, `encryption_properties`, `bloom_filter_options` and `compression_level` are `None`; `dictionary_pagesize_limit=1_048_576` is fixed even though dictionaries are disabled; `write_time_adjusted_to_utc=False` and `use_content_defined_chunking=False`. `data_page_size` is an approximate byte target, while `max_rows_per_page=1024` supplies the hard row bound. The numeric values are Q02 policy, not Apache performance recommendations.

The reader first bounds and hashes the manifest bytes, proves they are canonical JSON and matches a caller-pinned expected manifest SHA-256. It then bounds and hashes the payload and checks manifest identity, derived path, byte count, schema identity and provenance fields before Parquet decoding. It opens a `pyarrow.BufferReader` through `ParquetFile` with `memory_map=False`, `pre_buffer=False`, `buffer_size=0`, `page_checksum_verification=True`, `arrow_extensions_enabled=False`, `thrift_string_size_limit=1_048_576` and `thrift_container_size_limit=65_536`; table reads use `use_threads=False`. After decode it rechecks exact schema/metadata, row count and order, time/session bounds, quality counts, hashes and numeric/null round trips before returning a nominal validated object. That wrapper rejects assignment, binds an internal seal to the exact table/manifest/row identities and immutable contents, verifies the seal at every accessor, and is accepted by the query boundary only as the exact validator result type—not an arbitrary subclass.

Identical input produced identical bytes in the local PyArrow `25.0.0` probe, but byte stability is claimed only for the exact Q01 lock, writer profile, schema and accepted platform represented by the committed golden vector. A dependency, Arrow C++ build, schema metadata, writer setting or platform change requires a new decision and golden proof. Parquet compatibility does not imply byte identity across implementations.

Primary references:

- [PyArrow `write_table`](https://arrow.apache.org/docs/python/generated/pyarrow.parquet.write_table.html)
- [PyArrow `ParquetFile`](https://arrow.apache.org/docs/python/generated/pyarrow.parquet.ParquetFile.html)
- [Arrow `decimal128`](https://arrow.apache.org/docs/python/generated/pyarrow.decimal128.html)

## DuckDB boundary

DuckDB can query an explicitly registered Arrow table without a file scan. Q02 creates a fresh private `:memory:` connection per call and passes these settings at connection creation:

```text
threads=1
memory_limit=64MB
max_temp_directory_size=0B
enable_external_access=false
autoinstall_known_extensions=false
autoload_known_extensions=false
allow_unsigned_extensions=false
allow_community_extensions=false
python_enable_replacements=false
enable_external_file_cache=false
enable_http_metadata_cache=false
allow_persistent_secrets=false
allow_unredacted_secrets=false
scalar_subquery_error_on_multiple_rows=true
lock_configuration=true
```

All settings above were accepted by locked DuckDB `1.5.4` and read back from `duckdb_settings()` on 2026-07-12. `memory_limit` reported `61.0 MiB`, DuckDB's binary rendering of the `64MB` input. `max_temp_directory_size=0B` prevents query spill, and configuration locking prevents a later statement from re-enabling disabled facilities. `enable_global_s3_configuration` is not a valid connection configuration in this lock and is not used. `enable_object_cache` is a legacy no-op in current DuckDB and is not represented as a control.

The public helper accepts only a validator-returned Arrow object plus a versioned query enum and typed scalar parameters. It never accepts SQL, identifiers, expressions, filter fragments, paths, URIs, a connection or a replacement-scan object. It registers one fixed `q_input` table, selects from fixed generated SQL, binds values as parameters, applies a unique total `ORDER BY` and a bounded limit, returns exact Arrow/Python values, unregisters and closes. File readers, `COPY`, `ATTACH`, `INSTALL`, `LOAD`, secrets and extension APIs are outside the helper.

These controls are defense in depth, not a process sandbox. An in-process native database can still consume CPU or contain defects; therefore the small fixed query set, validated input, memory/result bounds and timeout at the outer test/process boundary remain necessary. No network or filesystem access is needed by deterministic tests.

Primary references:

- [DuckDB extension security](https://duckdb.org/docs/stable/operations_manual/securing_duckdb/securing_extensions)
- [DuckDB configuration](https://duckdb.org/docs/stable/configuration/overview)
- [DuckDB Python Arrow integration](https://duckdb.org/docs/stable/guides/python/sql_on_arrow)

## Manifest and provenance model

The manifest is canonical JSON using the accepted Q01 serializer. Its core records dataset and immutable revision identities, schema ID/fingerprint, a typed partition key, derived relative path, payload SHA-256/bytes/rows, time and session bounds, every quality-state count, lineage parents, code/config/lock/input identities, the fixed writer-profile identity and retention metadata. The manifest ID hashes the canonical core. The SHA-256 of the complete manifest envelope is an external trust anchor supplied by the caller or an accepted parent receipt; a digest stored only inside or beside a substitutable manifest is not sufficient.

Q02 adopts a narrow W3C PROV-DM mapping: stored partition/manifest and input hashes are entities, the deterministic build is an activity, the package/config identity is the software agent, and generation/derivation links express lineage. It does not emit PROV-N, PROV-XML, RDF or JSON-LD and does not run a PROV validator, so it claims conceptual alignment only, not W3C PROV conformance.

Q02 also adopts RFC 8493 BagIt concepts: an inventory enumerates payload identity, completeness distinguishes missing payloads, and validity additionally requires checksum agreement. It does not create a BagIt directory, `bagit.txt`, tag manifests or BagIt serialization, so it makes no BagIt conformance claim. SHA-256 detects accidental or adversarial byte substitution relative to a trusted digest; it does not prove source authenticity, license, completeness of upstream evidence or truth of content.

Primary references:

- [W3C PROV-DM](https://www.w3.org/TR/2013/REC-prov-dm-20130430/)
- [RFC 8493: The BagIt File Packaging Format](https://www.rfc-editor.org/rfc/rfc8493.html)

## Publication, paths and retention

All path components are derived from validated ASCII identifiers; `.` and `..`, separators, backslashes, NULs, absolute paths, Unicode confusables and empty segments are rejected. The store opens the pre-existing non-symlink root once and holds that directory descriptor for its lifetime. Every later traversal, creation, link, unlink, read and identity check is descriptor-relative with no-follow directory/file opens. Publication compares the revision and partition directory device/inode identities before and after linking the manifest marker, so replacing a pathname or racing in a symlink cannot divert writes outside the originally verified root.

The bounded layout is derived rather than caller-selected:

```text
datasets/{dataset_id}/revisions/{revision_id}/
  partitions/{schema_version}/{venue}/{product}/{event_kind}/{utc_date}/{symbol_shard}.parquet
  manifest.json
```

Publication uses exclusive creation and never `replace`: write the payload staging file through a held read/write descriptor, make it read-only, `fsync` it, link it to its non-existing final name, and verify the linked device/inode, size and exact bytes against both the still-open staged descriptor and final no-follow descriptor. The staged descriptor remains open until after the canonical manifest is published last through the same sequence. Final payload and manifest identities/bytes are rechecked after the marker and directory-identity checks, then directories are `fsync`ed. This closes staged-name replacement races before a successful acknowledgement; it does not claim protection from a privileged or same-owner process deliberately mutating accepted files after publication. Newly created parent-directory entries are also followed by a parent-directory `fsync`. Existing destinations, staging collisions or symlinks fail closed. A failure before the manifest-link attempt leaves an `INCOMPLETE` revision. Any failure from the link attempt onward—including a concurrently pre-created final marker—is reported as an indeterminate acknowledgement, never falsely classified as incomplete; a caller must resolve it through the external manifest digest and anchored read/state check. `UNVERIFIED` is reserved for a structurally complete, internally self-consistent revision that lacks the caller's external digest. Malformed/empty markers, missing/corrupt payloads and identity/checksum/schema mismatches are `CORRUPT`. Readers return neither. Q02 never silently repairs, overwrites or deletes them. The store is an explicit context manager and closes its held root descriptor idempotently; all operations fail closed after close.

Corrections create a new revision with an explicit parent manifest SHA-256, parent artifact binding and nondecreasing publication chronology; the parent manifest and payload must pass a complete externally anchored read at publication time. They never mutate or derive from an incomplete/corrupt accepted revision. A later derivation kind requires a new contract version instead of being implied here. Retention is a deterministic plan only. It accepts at most 4,096 manifests in an exact immutable tuple and returns engine-derived, immutable decisions with a canonical payload path, controlled action/reason pair and both manifest/lineage preservation flags fixed true. Payload expiry may be proposed only when the declared retention class permits it and permission/dependency preservation are proven; Q02 performs no deletion.

## Admission and annotation separation

`DataSourceCardV1` is immutable evidence for the eight launch Q-C gates: official/licensed access, stable identity mapping, timestamp/sequence semantics, retention permission, resource/rate budget, explicit hypothesis value, canonical producer ownership and observable failure state. A pure evaluator compares the card's owner reference with a caller-supplied canonical authority reference, then returns eligibility plus explicit failed gates; it neither assigns ownership nor registers or starts a producer. Q02 supplies no durable passing card and admits no source.

`OwnerAnnotationV1` is a separate weak-supervision channel for acted, rejected and missed event cohorts. Its identity binds annotation time and schema, an opaque annotator ID, the event/evidence target, evidence visible at tagging with availability times, evidence cutoff, outcome visibility (`HIDDEN`, `PARTIAL` or `KNOWN`), controlled tags and bounded rationale. `HIDDEN` structurally forbids visible outcome references; `PARTIAL` and `KNOWN` require bounded evidence references that were available by the annotation cutoff. The immutable annotation does not contain a later objective outcome record or modify an objective label.

Later objective outcomes are joined only through a new append-only `OwnerAnnotationOutcomeLinkV1` that binds annotation hash, objective outcome ID/hash, outcome availability/link times and linkage-method version. This preserves the original blinding record. Neither record conveys confidence/probability semantics, strategy truth, order/capital/risk authority or model admissibility; incremental out-of-sample value remains a later measured gate.
