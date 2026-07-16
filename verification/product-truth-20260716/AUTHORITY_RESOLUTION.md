# Authority Resolution

Campaign baseline status: `INTEGRATED`

Next-gate status: `BLOCKED` — Account B exact-C verification

Gate: `BASELINE_TRUTH_ACCEPTED:41752d6a87dc1cb1b933bb4460c9cabfc15ff694`

Candidate source: `41752d6a87dc1cb1b933bb4460c9cabfc15ff694`

Candidate tree: `a770f9f393e6229252731cd5247e9a1abfd2e509`

## Controlling authority

- The campaign directive at `/Users/cosmosgeek/Desktop/INDEPENDENT_PRODUCT_TRUTH_AND_LIVE_READINESS_CAMPAIGN_20260716.md`, SHA-256 `ae9638ba0b8539711d9dc67bab7ef0cd7b3539b0636fc5d78dd172a6c96c4d1b`, controls this campaign.
- The durable D-LAUNCH-61 director custody record is commit `b4d9f22d3732003f2cc5cec1f11a87833a933209`, `QL_DIRECTOR_STATE.md` blob `bf7e7c09aa84af046dc8ff1750098da5e89e8076`, SHA-256 `0d39a06b622f67a455d461bc033d6e7ef4bcc78f063c7cf6a6ad61e989db546e`, lines 70–72.
- Root `STATE.md` at blob `9546d70fdc942cd07fd3a04f0a3bebc3927c9120` controls current product state.
- This directory's `STATE.md` alone controls campaign state.
- `MISSION.md` controls mission and permanent money boundaries. `ARCHITECTURE.md` Part II controls concept ownership. `DESIGN.md` controls UI acceptance. `DIRECTOR.md` and `AGENTS.md` control operating discipline.
- `DIRECTOR_HANDOFF_TRUTH_CAMPAIGN.md` is a `REFERENCE_ONLY` transition record. Historical receipts under `docs/archive/` are immutable evidence, not current-state authorities.
- Briefings, older blueprints, parked Frontier work, C2/C2R acceptance, hotfix #2, A4 fixture screens, and the copied Role-3 C2 receipt are `REFERENCE_ONLY` wherever they describe a different SHA.

## One concept, one owner

| Concept | Canonical owner | Candidate state | Ruling |
|---|---|---|---|
| Basis and Volume strategy | existing Basis/Volume engines | `INTEGRATED` | No duplicate scanner or strategy authority admitted. |
| Evidence and public-source truth | intelligenceFoundation and intelligenceRuntime | `INTEGRATED` | Runtime configuration remains separately measured. |
| Capital and positions | capitalFoundation | `INTEGRATED` | No AI or cockpit fallback may recompute capital truth. |
| Risk, control, execution, reconciliation | foundation | `INTEGRATED` | Validate-only source does not imply money authority. |
| Durable history and CAS | existing Ledger | `WIRED_LOCAL` | Local SQLite authority only; no external send authority. |
| Supervisor and composition | systemIntegration | `WIRED_LOCAL` | It composes owners and projects their truth. |
| AI diagnostics | subordinate AI-Ops plane | `INTEGRATED` | Provider, worker lifecycle, product route, and paging remain `NOT_CONFIGURED` or `UNWIRED`. |
| Formal assurance | Product Assurance formal satellite | `INTEGRATED` | Runtime claim remains `REFERENCE_ONLY`; TLA execution is `NOT_CONFIGURED`. |
| Action evidence | Product Assurance S2 satellite | `INTEGRATED` | Supporting evidence only; production consumer is `NOT_CONFIGURED`. |
| Frontier | no admitted campaign owner | `REFERENCE_ONLY` | Parked and excluded from C. |

## P0 contradiction rulings

1. **CI hotfix — `INTEGRATED` plus `REFERENCE_ONLY`.** Main `2ae812624f20b9bc93fc4ad66cb568929101110f` and C contain first-hotfix merge `6c6d1edd3e7bd7aecb3330d4cca3df087659f5dd`. Hotfix #2 tip `53c6da817d92049c7628aa9f94466a0e1882e801` is an ancestor of neither Main nor C and is `REFERENCE_ONLY`/`SUPERSEDED_SAFE`. Candidate correction `cd0aa64db48a9898192b3d886abb5546933064e9` supplies full-history checkout and candidate-HEAD parity without admitting hotfix #2.
2. **Active writers — `INTEGRATED`.** The refreshed census records 101 registered worktrees, `ACTIVE_DIRTY=0`, `SEALED_UNMERGED=0`, `UNKNOWN=0`, and zero unexplained dirty source paths. The five D-LAUNCH-61 shards are detached at exact C with zero tracked/source changes; authorized untracked advisory outputs are preserved and censused without being read by Account A. They have no candidate-write or acceptance authority. A4 `720d2fe74be83d0d2d83f448637e087c32cafc5b` and egress `8db67eee261ea4b8964b5b9c64b22fc3a0c7fbc6` are clean and in C ancestry. CI hotfix #2 is clean and `REFERENCE_ONLY`.
3. **Canonical state — `INTEGRATED`.** C atomically rewrote root `STATE.md`; it controls product truth. Campaign `STATE.md` controls this campaign and binds C. The stale pre-freeze campaign state is superseded.
4. **AI-Ops state — `INTEGRATED`.** Exact Git trees contain 0 `aiOps`-segment paths on Main `2ae81262…` and 161 on C. Source is explicitly included; activation is not inferred.
5. **A4 and egress durability — `INTEGRATED`.** A4 merge `2787ebf3665c1efe32af9c426504af6b871898f1` has exact second parent `720d2fe7…`; its receipt blob is `caa4049eb59cb77551f15dff77e4d33dc1d2c2b2`, SHA-256 `b374039188eb1b2a7f016fd88ef0048163812050639c0362590016f32966027c`. Egress merge `c1a4b835a15aa60152b2ecfa9ae8087f6e159ce6` has exact second parent `8db67eee…`; its receipt blob is `70a37855632b0aac5e731ba8d88a5a4fd9031b94`, SHA-256 `94d67d13051645f019ad7bdb2ada8c0a977de3be0efd8472259651fea2cee424`. Both historical receipts remain `BLOCKED`; later authorized source admission is `INTEGRATED`.
6. **Owner-signature ordering — `DEFERRED_OWNER_GATE`.** Inert, unsigned, fake-provider source may be integrated before signatures. Provider or worker start, product-route activation, operational controls, paging, deployment, and real-provider shadow require owner-signed manifests and their later gates. No source merge grants those authorities.
7. **Ledger CAS — `WIRED_LOCAL`.** Exact acceptance citation: `cf3416bed284ffcd596f451a091985755f5e239b:docs/archive/i00-phase2/INTEGRATION_CANDIDATE_READY_RECEIPT.md`, blob `49cacfc4c67ec264dd445209d435d0d262cd8542`, SHA-256 `ce1d7d386a017bb1359a17d139e1d126200d85f9d2c0cd674be7f3081c028ecc`, lines 1663–1677. It binds request blob `494cfc87083103b345e82e11726b8c89d09d07b6`, SHA-256 `79740ff5ef2951e96b5e3ea26acdc4aa786425ca3341335e55cef23d230c4f6f`, and disposition `IMPLEMENTED_EXISTING_LEDGER_NO_SEND_AUTHORITY`. Current Ledger blob is `2d16cf8a…`; current adapter blob is `730e0260…`. The adapter is mounted for read inventory only; the production append producer is `NOT_CONFIGURED`.
8. **Foundation quantity bridge — `INTEGRATED`.** The same receipt, lines 1678–1690, binds request blob `697abdc548f3975247244062a79bc176c797be2d`, SHA-256 `9db092975a34c001f04412ef94644078009f90e5efc62ed258ced00aa38c4cb0`, and disposition `IMPLEMENTED_CONTRACT_NO_AUTHORIZED_PRODUCTION_CONSUMER`. Current bridge blob is `5e4ffff82e77fa32045192142b0ebbd7365a163d`, SHA-256 `3888d68bc41e7d636479dbb7d94e75ccbd2dc9ab591bf57115bdac16dcfee22a`. The closed comparison has no production caller; its consumer is `NOT_CONFIGURED` and it grants no action authority.
9. **Clean-checkout CI — `INTEGRATED` Account-A evidence.** A new non-shallow, single-branch, no-tags clone was detached at C, installed from `package-lock.json`, and ran `npm test` with exit 0. This resolves the contradiction for Pass 0. It does not issue `CLEAN_CLONE_ACCEPTED` or `VERIFIED_ACCEPTED`; those later gates remain `BLOCKED` for Account B.

## Pass 0 custody resolution outside §2.1

The D-LAUNCH-61 director custody receipt confirms the pushed GitHub campaign ref as completed off-machine custody. Independent probes resolve `refs/heads/truth-campaign-20260716` to `d2c4f43caf9ad7a84cfde8da8760cc9895384538`; a fresh single-branch remote clone proves exact C is reachable and passes `git fsck --full --strict`. Both post-C commits are evidence-only. The separate local full-repository bundle is `SEALED` at SHA-256 `775c55d26474578100b03d0cb45575b9cf95cc6ab012c709c963e4dd6b8ffe37`, 154,783,860 bytes, and complete history. Therefore Pass 0 is `INTEGRATED` and Account A issues only `BASELINE_TRUTH_ACCEPTED:41752d6a87dc1cb1b933bb4460c9cabfc15ff694`.

The custody push left `current-main` at candidate-freeze Main `2ae812624f20b9bc93fc4ad66cb568929101110f`. The D-LAUNCH-61 receipt and later director-only coordination subsequently advanced `current-main` without merging C; those objects are `REFERENCE_ONLY` for candidate source.

## Receipt fields

- Command/operator action: D-LAUNCH-61 custody, Git ancestry, tree, receipt, remote clone, and 101-worktree reconciliation against immutable C.
- Environment/toolchain digest: `8261c1fcbc27b3a2384abc506a285768333d4f4d5350fec83cd5364211a763ca`.
- Dependency lock SHA-256: `3c97820f912390fcad3dab57b436319b95c15bc7877384dd98032d7751ec2fcf`.
- Start/end UTC: `2026-07-16T12:16:57Z` / `2026-07-16T12:17:05Z` for custody probes; census timestamps are separate.
- Exit code: `0`; evidence assertions: `9/9` contradiction rulings, `12/12` admitted donor lanes, 101/101 census rows, and 10 custody probes; new test count `0`.
- Artifact hashes: `MANIFEST.sha256` is generated last and excludes itself.
- Actor: `ACCOUNT_A`; candidate source write permission after freeze: `false`.
- Deviations/skips/unavailable: Account B material not read; the bundle remains local and GitHub is the off-machine medium; later director coordination moved `current-main` without merging C; an auxiliary audit imported one bundle pack without changing refs/index/worktrees; no independent or later-gate token issued.
