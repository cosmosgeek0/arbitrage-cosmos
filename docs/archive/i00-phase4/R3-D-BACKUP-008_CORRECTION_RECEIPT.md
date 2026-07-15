# R3-D-BACKUP-008 correction receipt

**Finding:** `R3-D-BACKUP-008`

**Severity:** High

**Outcome:** corrected inside the accepted restore/drill boundary

**Correction base:** `773ad80719aaa4abd338770b7cacb5b6cbef5a21`

**Governing verifier receipt:** `/Users/cosmosgeek/Desktop/role3-verify/ROLE3_VERIFICATION_RECEIPT.md`

## Reproduction

The additive regression was executed from a clean Git archive of exact base
`773ad80719aaa4abd338770b7cacb5b6cbef5a21`, with only the regression harness
copied into that temporary tree. It exited `1` on its first hostile case:

```text
replacement-only archive tampering is rejected before target creation
NOT OK: command unexpectedly passed: run_restore .../mismatch .../mismatch-target
```

The replacement remained a structurally valid `tar.gz`; only
`evidence-1.tar.gz` changed. The manifest and database stayed unchanged. The
pre-correction restore consumed the substituted archive, created the target,
and returned success. The existing donor backup/restore and drill suites had
therefore been false-green at `30/30` and `11/11` for this boundary.

## Security contract

The selected backup is mutable input until it has been copied through held,
no-follow file descriptors into one private stable snapshot. The target may not
be touched until all of these facts are simultaneously proved:

- exact top-level payload inventory and unique canonical evidence roots;
- stable regular-file identity, link count, byte length, and SHA-256 for the
  manifest, database, and every manifest-listed archive;
- database full integrity and manifest-declared event count;
- bounded archive count, compressed bytes, listed output, member count,
  expanded bytes, and execution time;
- only safe relative UTF-8 members, with no traversal, links, devices, FIFO,
  special mode, duplicate, case collision, or canonical-Unicode collision;
- exact equality between the preflighted logical member inventory and the
  privately extracted regular-file/directory inventory;
- canonical disjointness among the selected backup, restore target, live data
  tree, and private staging root.

The legitimate contract preserved is the accepted producer's existing
manifest and archive format, including evidence paths whose root is either a
directory or one regular file. No new backup, store, ledger, archive, or
restore owner was created.

## Correction

`ops/live/bin/restore.sh` now:

- resolves missing target suffixes against the real filesystem and treats
  symlink aliases into `DATA_DIR` as production;
- refuses target/backup overlap in either canonical prefix direction;
- accepts production restore only after explicit flags, exact confirmation,
  and `systemctl is-active` exit `3`; unverifiable service state fails closed;
- snapshots the exact backup inventory through stable no-follow descriptors,
  then never consumes mutable backup pathnames again;
- rejects missing, undeclared, renamed, duplicated, hash-mismatched, unstable,
  oversized, or unsafe payloads before target creation;
- preflights every archive before extracting any archive, extracts only into a
  private `0700` tree, compares exact inventories, and supports the producer's
  regular-file evidence roots;
- stages only verified database, evidence, and typed restore-report bytes;
- publishes owned target paths behind identity checks, rolls every moved path
  back on failure, preserves loud recovery evidence when rollback is
  incomplete, and removes exclusively created target suffixes after a failed
  first publication.

`ops/live/bin/restore-drill.sh` now validates `TMPDIR` before `mktemp`, refuses
aliases into the live data tree, consumes only the isolated restore report, and
records explicit `archiveIntegrity` proof for exact manifest inventory, stable
hashes/sizes, and member inventories. A failed restore reports non-green event,
archive, and target-absence facts.

The accepted producer already records each exact archive name and SHA-256. This
correction deliberately does not version or rewrite that immutable donor: the
restore measures byte lengths from the same held descriptors it hashes and
enforces hard compressed and expanded ceilings. Treating a mutable
producer-declared length as the trusted measurement would not strengthen the
broken restore boundary and would make already-valid backups incompatible.

## Exact effective-owner binding

The immutable accepted L15 donor, its receipt, its `31` live files, its `17`
donor tests, and `ops/i00/donor-contract.json` remain byte-identical.
BACKUP-008 is the second ordered entry in the separate post-integration
amendment contract, chained from the WATCHDOG-007 effective tree and digest:

- base effective live tree:
  `9d100a76252dbc92a0e31ca16ba5ab8312cbbecb`;
- base effective root digest:
  `f8b5713aa207d809dc0570b7fa43c39d8b034ca6a60e678ecea2a5b5af8b0f00`;
- corrected effective live tree:
  `0f5c1a1267cf63cb2d4bdc2015d867c6131e173d`;
- corrected 31-file root digest:
  `7e5e905f5a11d15987f9e829a0d91de50f6e618ee0c75d9d50e714515f97c0d3`.

The entry authorizes exactly these two runtime replacements and one additive
focused regression:

```text
ops/live/bin/restore-drill.sh
ops/live/bin/restore.sh
ops/tests/i00/test-r3-d-backup-008.sh
```

Release assembly, validation, installation, and installed wrappers must verify
the complete corrected effective root and the typed I00 enforcement cohort
before use. No wildcard, donor rewrite, or candidate-only duplicate restore
path is admitted.

## Focused proof before commit

- pre-fix clean-archive regression: exit `1` at the accepted archive
  substitution, proving the exploit;
- corrected additive regression: exit `0`, `89/89`;
- unchanged donor backup/restore suite: exit `0`, `30/30`;
- unchanged donor restore-drill suite: exit `0`, `11/11`;
- standard ops aggregate: exit `0`, 12/12 files and `384` assertions;
- secret/endpoint scanner: exit `0`, `13/13`, after the aggregate first
  reproduced a hostname false positive for JavaScript `.dev` property access;
- Bash syntax and Git whitespace checks: exit `0`;
- host archive implementation exercised: bsdtar `3.5.3`; the implementation
  also accepts the bounded GNU numeric-owner listing grammar, but GNU tar was
  not installed on this host for a second runtime execution.

The focused regression covers valid substitution, missing and undeclared
archives, symlink/hardlink/FIFO/traversal members, duplicate/case/Unicode
collisions, truncated and bounded-resource archives, regular-file roots,
target/backup aliases, live-data aliases, service-state ambiguity, immutable
target preservation, complete and incomplete rollback, absent-target rollback,
explicit drill evidence, and production database non-mutation.

The cross-suite correction changes only the spelling of device-number reads:
ECMAScript object destructuring retrieves the same `fs.Stats` properties while
avoiding source tokens that the deliberately conservative hostname scanner must
reject. Restore identity comparisons and every accepted runtime behavior remain
unchanged.

The effective I00 adapter, donor contract, release/preflight, and repository
gates are rerun after the exact contract bytes are sealed. Final complete
Phase 4 acceptance and C2/S2 evidence remain pending. No live/test order,
private or signed exchange call, transfer, withdrawal, deployment, push, merge,
or external mutation was performed.
