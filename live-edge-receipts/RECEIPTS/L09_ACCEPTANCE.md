# L09 immutable acceptance receipt — normal Basis lifecycle

Receipt status: `LANE_READY`

Lane phase disposition: `ACCEPTED_BUILT_AND_TESTED_UNWIRED`

Integrated acceptance: `NO`

## Commit and input chain

- Prior L09 implementation:
  `36d5e2a39b013b51d2b932f902ec272c9217c23c`
- Director rebase:
  `ecd800679ded1fe21e3d9e97774bbfcaa9341070`
- Accepted F-BRIDGE seam cut and current-main merge-base:
  `c9009079b0c27c2a7e2d1a0111a022bceb2e61db`
- Accepted L09 correction:
  `a7a0f7c8f154539b05b7fb9845f1a4a3dec60eb8`
- Correction tree:
  `27c688759a74026a15ea63c3300545c191c10cc2`
- Branch: `l09-normal-basis-20260712`

This receipt references the preceding implementation commit and cannot include
the SHA of its own containing commit. A following state-only seal records the
acceptance-documentation commit.

## Hash-locked implementation artifacts

- Six-file source aggregate SHA-256:
  `e541485191e43df3bb1dcde0756cc5f04640953a9d3acf7a75affce1c6bcb848`
- Four-file test aggregate SHA-256:
  `79a32ba6d067b44874944b6d416830613cf135435ce2db92bb053b89a699595d`
- Ten-path correction aggregate SHA-256:
  `4b48e80b7f2cc21d71436de61f5086396719566ee8ac319ec26f972656664a20`

Each aggregate hashes the code-unit-sorted `shasum -a 256` manifest of the
named file set.

## Surviving implementation

- Existing Basis and Capital owners create proposal, allocation, reservation,
  staged-plan and mandate truth; Foundation Risk evaluates the bound intent.
- An injected canonical Foundation hydrator restores checkpoint bytes. The
  adapter independently binds the exact envelope, checksum, replayed plan,
  revision, event stream and leg definitions.
- Exact submission checkpoints prove each leg. Terminal opening Spot truth
  sizes the dependent hedge; close/recovery legs use owner residual truth.
- Product-specific L05 private truth and complete canonical Foundation
  reconciliation are required. No local reconciliation reducer remains.
- Observation checkpoints must be exact ancestors of final owner state, with
  one observation per submitted leg.
- Recovery evidence retains complete plan/phase/leg/client-order/reason and
  checkpoint/owner/reconciliation/recommendation revision lineage.
- All six L06 mutation fields are exact and unique for the four semantic legs;
  zero sequence and every field substitution fail closed.
- Partial fill proves terminal lookup before hedge. Cold restart uses a fresh
  port instance and proves lookup, reconciliation, then hedge without an
  in-memory pre-crash progression shortcut.
- All returned agreement/checkpoint evidence is bounded, deeply copied and
  frozen. Domain time and owner APIs remain injected.

## Dated research evidence

Current official Binance Spot REST, Spot user-data-stream and USD-M Futures
trade documentation was checked on `2026-07-13` before implementation. It was
used only to confirm client-order identity, order-state/cumulative-fill and
one-way `positionSide` evidence fields. No exchange endpoint was called.

## Verification evidence

- `npm run build -w server`: exit `0`.
- Focused normal Basis: `23/23`, exit `0`.
- Exchange twin: `78/78`, exit `0`.
- Execution policy: `49/49`, exit `0`.
- Foundation execution: `173/173`, exit `0`.
- Accumulated LiveEdge: `1,246/1,246`, exit `0`.
- Frozen edge protocol: `22/22`, exit `0`.
- `npm test`: `377/377`, exit `0`.
- Import-purity: `4/4`, exit `0`.
- Typecheck, build and diff-whitespace gates pass.
- Three fresh independent verification passes: `ACCEPT`.

`npm run test:all` was executed and exits `1` only in the unchanged System
Integration group at `179/180`. The single expected-`PARTIAL`, actual-`DIVERGED`
fixture mismatch reproduces from a clean build of `ecd8006` at isolated
`28/29`; it has no normalBasis import, and the relevant shared blobs are
unchanged. The full repository battery is not claimed green. This exact
baseline exception is retained rather than hidden or repaired outside scope.

## Scope and authority verification

- Correction `a7a0f7c` contains exactly ten paths inside the two authorized
  normalBasis implementation namespaces.
- No Foundation, Ledger, System Integration, package manifest, production
  route, UI, root LiveEdge barrel, reverse-Basis or Volume file changed.
- The two owner-supplied launch files remain untracked, unstaged and retain
  their locked SHA-256 identities.
- Source import-purity checks found no execution/reconciliation owner import,
  environment, network, filesystem, timer, randomness, signer, credential,
  private read, external action or money path.

## Explicit non-claims

- No production wiring, route, service, socket, scheduler, dispatcher, store
  or new lifecycle/reconciliation authority exists in L09.
- No private/account read, credential access, signed request, test/live order,
  real order query/cancellation, Margin mutation, capital change or recovery
  execution was performed.
- No AWS/Cloudflare/Secrets mutation, deployment, process restart, merge, push,
  withdrawal or transfer occurred.
- No secret was inspected, retained, logged or committed.
- The full repository `test:all` battery is not claimed green at this base.

`LIVE_EXECUTION_NOT_IMPLEMENTED` remains mechanically enforced. L09 is
accepted only as a built, tested, unwired injected-port proof.
