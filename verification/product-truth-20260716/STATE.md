# Product Truth Campaign State

Campaign status: `C9_SOURCE_READY_TO_FREEZE_AFTER_C8_CENSUS_IDEMPOTENCE_REJECTION`

Immutable required parent C2: `dea2d2a5c2b5e83d3aea75b0e368f0a478596561`

Rejected C5: `959a5f9900e25f53414710bbfb3464c3ccb67a5d`

Rejected immutable C6: `89cd7e066b97f2f33d730d1e0adf291ebe7c4f64` — exact clean canonical security gate rejected forbidden subprocess/environment access in the newly added campaign contract test; C6 was not amended.

Rejected immutable C7: `a283eb859ec1142aadecbd64e0b84959535f6216` — the exact payload inventory checksum was stale after structural rewrite, and landed-core provenance claimed 1,666 exact blobs where the candidate tree had 1,634; C7 was not amended, pushed, or evidence-bound.

Rejected immutable C8: `6ab02a82931ae8234456c0710cca41b94fdc12c9` — canonical and source clean-clone gates passed, but a post-evidence second generator pass rewrote mutable `truth-a` census identity and both manifests; C8 was not amended or pushed.

C9 source candidate: `ASSIGNED_BY_CONTAINING_SOURCE_COMMIT` — a commit cannot contain its own SHA.

Actor: `ACCOUNT_A_CANDIDATE_WRITER`

Gate: `PENDING_EXACT_C9_FREEZE`

Final verifier: `PENDING_FRESH_INDEPENDENT_VERIFICATION`

This file alone owns campaign status. Root `STATE.md` owns product state. The containing source commit is the one immutable C9 correction commit; it must have exactly one direct parent, and that parent must byte-equal C2. C3 through C8 and all earlier evidence descendants are excluded from C9 ancestry.

## Source correction contract

- The accepted C5 source and all VFINAL5 product corrections are preserved, including canonical WATCHMAN truth and the hostile local-success/still-outage regression.
- The C6 test-boundary correction is preserved without `child_process` or environment access in the campaign test.
- The C8 census-idempotence defect is corrected by validating the live custody descendant against the exact output allowlist, while serializing candidate-normalized `truth-a` HEAD/tree/status/diff and inventory identities.
- The exact payload generator emits an internally consistent v2 document: exact candidate/tree, exact generator identity, recomputed inventory checksum, independently recomputed payload-set checksum, and explicit source-preparation lineage.
- `MERGE_PROVENANCE.json` v3 remeasures lane changed paths, parent topology, donor matches/mismatches, candidate receipt blobs, aggregates, and every landed-core candidate blob from exact C9 rather than carrying seed counts forward.
- The exact verifier independently recomputes both payload checksums and the full provenance measurement; it rejects stale nested blobs or counts even when top-level candidate identity is correct.
- Twenty-three external lock inputs and two governing evidence objects are archived off-tree at `~/cosmos-campaign-archive/locked-input-payloads/`; the campaign metadata preserves their verified byte lengths, SHA-256 values, and Git blob OIDs. The archive confers no live-input or execution authority.
- `WORKTREE_LEDGER.md` owns the pre-freeze 96-live snapshot, including `truth-a` and `truth-b`, plus five complete `REMOVED_SAFE` tombstones for 101 durable entries.
- D-LAUNCH-65 remains explicitly bound by commit, tree, parent, and `QL_DIRECTOR_STATE.md` blob/hash/bytes; its payload copy is `ARCHIVED_OFF_TREE`. Ambient or moving `current-main` is not accepted as evidence.
- `LIVE_EXECUTION_NOT_IMPLEMENTED` remains enforced. This wave adds no private, signed, order, borrow, repay, transfer, withdrawal, leverage, margin, deployment, credential, or capital path.

## Exact evidence descendant contract

After C9 is frozen, the evidence generator must regenerate from exact candidate bytes:

- `INPUTS.lock`: exactly 61 unique rows, each with explicit source, disposition, and matrix linkage; exact candidate `STATE.md` blob/hash/bytes.
- `DIRECTIVE_COVERAGE_MATRIX.csv`: 153/153 exact-C9 candidate cells.
- `CAPABILITY_TRUTH_MATRIX.csv`: 23/23 exact-C9 candidate cells.
- `COCKPIT_BINDING_MATRIX.csv`: 178/178 exact-C9 candidate cells.
- `C2_PROOF_BINDING.json` and `EVIDENCE_SELECTION.json`: exact C9, tree, and sole C2 parent.
- `LOCKED_INPUT_PAYLOADS.json`: `ARCHIVED_OFF_TREE` storage truth with the existing inventory, payload-set, per-member SHA-256, Git blob, and byte-length bindings preserved.
- `MERGE_PROVENANCE.json`: exact C9 topology plus independently recomputable lane and landed-core blob measurements.
- `WORKTREE_CENSUS.json`: exact C9, 96 live rows, five complete tombstones, and 101 durable entries.
- `MANIFEST.json` and `MANIFEST.sha256`: deterministic hashes generated last and independently verified.

No exact-authority artifact may contain an unbound candidate token or predecessor `41752d6a87dc1cb1b933bb4460c9cabfc15ff694`. Evidence descendants may change only `verification/product-truth-20260716/**`; any source correction after C9 is C10, never an amendment.

## Freeze and handoff

The writer freezes the containing source commit once, asserts `C9^ == C2` and parent count one, runs the focused/canonical gates and clean-clone gates, normally self-pushes the campaign custody chain without touching `current-main`, verifies the exact evidence and live-remote clone, emits `BASELINE_TRUTH_ACCEPTED:<full-C9-SHA>`, then stops for the fresh final verifier.
