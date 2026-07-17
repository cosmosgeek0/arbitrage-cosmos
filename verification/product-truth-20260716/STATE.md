# Product Truth Campaign State

Campaign status: `C7_SOURCE_READY_TO_FREEZE_AFTER_C6_CANONICAL_REJECTION`

Immutable required parent C2: `dea2d2a5c2b5e83d3aea75b0e368f0a478596561`

Rejected C5: `959a5f9900e25f53414710bbfb3464c3ccb67a5d`

Rejected immutable C6: `89cd7e066b97f2f33d730d1e0adf291ebe7c4f64` — exact clean canonical security gate rejected forbidden subprocess/environment access in the newly added campaign contract test; C6 was not amended.

C7 source candidate: `ASSIGNED_BY_CONTAINING_SOURCE_COMMIT` — a commit cannot contain its own SHA.

Actor: `ACCOUNT_A_CANDIDATE_WRITER`

Gate: `PENDING_EXACT_C7_FREEZE`

Final verifier: `PENDING_FRESH_INDEPENDENT_VERIFICATION`

This file alone owns campaign status. Root `STATE.md` owns product state. The containing source commit is the one immutable C7 correction commit; it must have exactly one direct parent, and that parent must byte-equal C2. C3 through C6 and all earlier evidence descendants are excluded from C7 ancestry.

## Source correction contract

- The accepted C5 source and VFINAL5 corrections are preserved. The only post-C6 behavioral correction removes forbidden `child_process` and environment access from the campaign contract test while retaining pure fail-closed assertions; the other deltas relabel campaign artifacts and state for immutable C7.
- `RefreshDock` always derives health color, status, and readiness wording from canonical supervisor truth. Local `/api/refresh` success is neutral action acknowledgement only and cannot produce `Connections Recovered` or an operational/green class while canonical truth remains outage.
- The exact-candidate generator requires a full candidate SHA and immutable C2 parent, rejects merge candidates, and has no placeholder/source mode. Both predecessor generators fail closed.
- Twenty-three external lock inputs and two governing evidence objects have raw candidate-tracked payload copies with reproducible byte length, SHA-256, and Git blob OID. Those copies are rehash-only evidence and confer no live-input or execution authority.
- `WORKTREE_LEDGER.md` owns the pre-freeze 96-live snapshot, including `truth-a` and `truth-b`, plus five complete `REMOVED_SAFE` tombstones for 101 durable entries.
- D-LAUNCH-65 is explicitly bound by commit, tree, parent, `QL_DIRECTOR_STATE.md` blob/hash/bytes, and candidate-tracked payload. Ambient or moving `current-main` is not accepted as evidence.
- `LIVE_EXECUTION_NOT_IMPLEMENTED` remains enforced. This wave adds no private, signed, order, borrow, repay, transfer, withdrawal, leverage, margin, deployment, credential, or capital path.

## Exact evidence descendant contract

After C7 is frozen, the evidence generator must regenerate from exact candidate bytes:

- `INPUTS.lock`: exactly 61 unique rows, each with explicit source, disposition, and matrix linkage; exact candidate `STATE.md` blob/hash/bytes.
- `DIRECTIVE_COVERAGE_MATRIX.csv`: 153/153 exact-C7 candidate cells.
- `CAPABILITY_TRUTH_MATRIX.csv`: 23/23 exact-C7 candidate cells.
- `COCKPIT_BINDING_MATRIX.csv`: 178/178 exact-C7 candidate cells.
- `C2_PROOF_BINDING.json`, `EVIDENCE_SELECTION.json`, and `MERGE_PROVENANCE.json`: exact C7, tree, and sole C2 parent.
- `WORKTREE_CENSUS.json`: exact C7, 96 live rows, five complete tombstones, and 101 durable entries.
- `MANIFEST.json` and `MANIFEST.sha256`: deterministic hashes generated last and independently verified.

No exact-authority artifact may contain an unbound candidate token or predecessor `41752d6a87dc1cb1b933bb4460c9cabfc15ff694`. Evidence descendants may change only `verification/product-truth-20260716/**`; any source correction after C7 is C8, never an amendment.

## Freeze and handoff

The writer freezes the containing source commit once, asserts `C7^ == C2` and parent count one, runs the focused/canonical gates and clean-clone gates, normally self-pushes the campaign custody chain without touching `current-main`, verifies the exact evidence and live-remote clone, emits `BASELINE_TRUTH_ACCEPTED:<full-C7-SHA>`, then stops for the fresh final verifier.
