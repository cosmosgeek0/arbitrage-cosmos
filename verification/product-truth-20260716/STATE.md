# Product Truth Campaign State

Status: `BLOCKED`

Actor: `ACCOUNT_A`

This file is the sole campaign-status authority. Root `STATE.md` remains the product-state document and is presently `CONFLICTING`; its atomic candidate-bound rewrite is still required by campaign §2.1 item 3 and repository law.

## Exact working cut

- Account A integration tip: `995904ada86e86ef4214bea596331b978a332da0`.
- Integration tree: `b9e1c4da19b68b907c83ce64e78dff70e672b303`.
- Canonical Main/director tip: `2ae812624f20b9bc93fc4ad66cb568929101110f` (`D-LAUNCH-60`).
- Branch: `truth-campaign-20260716`.
- This cut is mutable and is not frozen candidate C.

## Integration rulings

- Egress receipt `8db67eee261ea4b8964b5b9c64b22fc3a0c7fbc6`: source `INTEGRATED`; bounded-capacity correction and regression proof remain `BLOCKED`.
- CI hotfix #2 `53c6da817d92049c7628aa9f94466a0e1882e801`: `REFERENCE_ONLY`, `SUPERSEDED_SAFE`, not merged. D-LAUNCH-56 candidate-local clean-checkout repair remains `BLOCKED`.
- AI-Ops A1/A2/A3/A4/A5/OBS/OPS/REPLAY/RUNBOOK: source `INTEGRATED`, including A4 receipt `720d2fe74be83d0d2d83f448637e087c32cafc5b`. The candidate contains 161 exact `aiOps` namespace paths. Provider, production lifecycle, product route, owner signatures, external sentinel/paging, and effective control authority remain `NOT_CONFIGURED` or `UNWIRED`. Account B must verify exact frozen C.
- A-FORMAL `b491893416006cf529aef02e5dd4a25d6475e7b8`: source `INTEGRATED`; runtime claim `REFERENCE_ONLY`; TLA tooling `NOT_CONFIGURED`.
- S2 action evidence `ca30adf5e97b6697afec49f13073024d953b117b`: source `INTEGRATED`; semantics `SUPPORTING_EVIDENCE_ONLY`; production consumer `UNWIRED`.
- Frontier: `ABANDONED_SAFE` for this campaign; no Frontier source is admitted.

## Current evidence

- Registered worktrees: 96.
- Census classifications at this cut: `MERGED_RETAINED=41`, `SUPERSEDED_SAFE=33`, `ABANDONED_SAFE=20`, `BLOCKED=2`, all others 0; `UNKNOWN=0`.
- Tracked dirty paths observed across all registered worktrees: 0.
- Account A typecheck: exit 0 at integration tip `55b456e19dbbd97548d9beb601dfc8cc7d3c57b7`.
- Account A production build: exit 0 at the same integration tip; this is builder evidence, not independent verification.
- Product Assurance execution reached its historical suites but stopped on protected-owner fallback because Account A campaign artifacts were untracked. That run is `BLOCKED`, not candidate evidence.

## Blocking evidence

1. P0 item 9 is `BLOCKED`: candidate-HEAD, tracked-content-only sealed-report parity and a genuinely fresh single-branch checkout are not yet proved.
2. The D-LAUNCH-55 CPU finding requires a bounded capacity correction. Read-only isolation disproved the original Worker attribution: the 64-record and 512-KiB journal-capacity cases consume the main thread; Worker message/exit awaits remain a separate latent boundedness defect.
3. Included AI-Ops tests and the A-FORMAL/S2 suites require one clean-clone-safe canonical root mount. Branch-name/ref-dependent lane assertions cannot be copied into the root denominator unchanged.
4. Product Assurance production scan must be regenerated for the exact integrated source; provisional measurement is 555 scanned production files, 205 covered operations, 0 uncovered.
5. D-LAUNCH-60 findings remain to adjudicate: invariant families 15/17; cockpit slots 141/178 `MISSING` or `NOT_CONFIGURED`; tracked Role-3 C2 verdict copy absent from campaign artifacts; money-path no-send fields not yet derived from exact implementation blobs.
6. Required campaign artifacts are incomplete and `INPUTS.lock` cannot bind a candidate until source C is frozen.
7. Root `STATE.md` remains `CONFLICTING` and must be rewritten atomically at the source-candidate freeze.

## Exact next action

Implement the two bounded candidate fixes, mount the admitted tests without branch/ref dependence, close or explicitly disposition every D-LAUNCH-60 finding, regenerate Product Assurance denominators from tracked candidate content, commit the source candidate, and run the fresh single-branch clean-clone gate against that immutable SHA. No source change may occur after that source SHA is handed to Account B.
