# L09 immutable blocked receipt — emergency checkpoint audit

Receipt status: `BLOCKED_UNRESOLVED_ACCEPTANCE_GAPS`

Lane phase disposition: `BLOCKED_AFTER_CHECKPOINT_AUDIT`

Implementation acceptance: `NO`

Integrated acceptance: `NO`

Accepted L09 SHA: `NONE`

The surviving correction is built and tested but is not phase acceptance.
This receipt becomes immutable in its containing commit. A following
state-only seal records that exact commit and these content bytes.

## Frozen chain

- Prior L09 implementation:
  `36d5e2a39b013b51d2b932f902ec272c9217c23c`
- Director F-BRIDGE integration merge:
  `ecd800679ded1fe21e3d9e97774bbfcaa9341070`
- F-BRIDGE accepted implementation/test cut:
  `1e9d28a565935d3cb1aa6c98a209697d9fabdf05`
- F-BRIDGE acceptance documentation:
  `a0c0c2e5ef3180aa720488463643433cefeb65e5`
- F-BRIDGE director merge and current-main merge-base:
  `c9009079b0c27c2a7e2d1a0111a022bceb2e61db`
- Surviving L09 correction:
  `a7a0f7c8f154539b05b7fb9845f1a4a3dec60eb8`
- Correction tree:
  `27c688759a74026a15ea63c3300545c191c10cc2`
- Rejected emergency acceptance checkpoint:
  `2fdb6806e35da404134dbc537695f2860a369078`
- Frozen protocol SHA:
  `73e1a1ff7daa48df8dac45713fc5f106842edafc`

## Hash-locked surviving implementation

- Six-file source aggregate SHA-256:
  `e541485191e43df3bb1dcde0756cc5f04640953a9d3acf7a75affce1c6bcb848`
- Four-file test-namespace aggregate SHA-256:
  `79a32ba6d067b44874944b6d416830613cf135435ce2db92bb053b89a699595d`
- Ten-path correction aggregate SHA-256:
  `4b48e80b7f2cc21d71436de61f5086396719566ee8ac319ec26f972656664a20`

Each value recomputes from the code-unit-sorted `shasum -a 256` manifest.
The four files under the test namespace are three `*.test.mjs` modules and one
fixture module.

## Surviving behavior

- Existing Basis, Capital, Foundation Risk, policy and Foundation execution/
  reconciliation owners remain authoritative.
- Canonical checkpoint hydration, terminal opening-fill hedge sizing, fresh-port
  restart ordering and canonical reconciliation consumption are present.
- Mutation identity and owner/recovery lineage are exact and fail closed under
  the tested substitutions.
- L06 evidence remains injected, synthetic and non-persistent; no production
  Ledger or send authority is claimed.
- No production wiring, second lifecycle/reconciler, network or money surface
  was added.

## Blocking audit result

The emergency checkpoint attempted to accept L09 after presenting technical
evidence for groups 1–4 of L09-003. It did not resolve or explicitly supersede:

1. conflict-free one-way USD-M position/open-order ownership;
2. fee-adjusted Spot exposure when commission is charged in base asset;
3. end-to-end `reduceOnly`/`positionSide` binding to runtime twin request
   evidence;
4. venue-arrival expiry against the accepted policy/proposal cut;
5. exact-decimal partial-close residual agreement across Foundation and venue
   owner truth;
6. `REJECTED`/`EXPIRED_IN_MATCH` vocabulary and terminal-partial preservation;
7. terminal agreement for `FAILED`; and
8. partial/rejected/terminal-partial close plus close/recovery cold-restart
   matrix rows.

The earlier deep-copy/freeze finding is materially resolved by the surviving
correction and is not included in this remaining set.

The exact findings and rejected documentation claims are frozen in
`live-edge-receipts/DECISIONS/L09-005-EMERGENCY-CHECKPOINT-AUDIT-BLOCKERS.md`.

## Measured recovery verification

Fresh, keyless and network-free checks during the audit:

- `npm run build -w server`: exit `0`.
- Focused normal Basis: `23/23`, exit `0`.
- Exchange twin: `78/78`, exit `0`.
- Execution policy: `49/49`, exit `0`.
- Foundation execution: `173/173`, exit `0`.
- Frozen edge protocol: `22/22`, exit `0`.
- Import purity: `4/4`, exit `0`.
- `npm test`: `377/377`, exit `0`.
- Current System Integration group: `179/180`, exit `1`; expected `PARTIAL`,
  actual `DIVERGED` at
  `server/test/systemIntegration/verticalSlice/authority.scenarios.test.mjs:521`.
- `git diff --check`: pass.

The System Integration mismatch has no normalBasis import and its test plus
relevant shared blobs are unchanged from `ecd8006`. It is a real shared
baseline exception, not a correction regression, but no durable director
ruling accepts the red mandatory System Integration gate for L09. The prior
accumulated LiveEdge `1,246/1,246` result remains historical checkpoint
evidence; it was not rerun to completion during this recovery audit and is not
used to manufacture acceptance.

## Current primary-source check

Official Binance documentation was refreshed on `2026-07-13`; no endpoint was
called. It confirms client-order identity, cumulative order fills/status and
one-way USD-M `positionSide=BOTH`/`reduceOnly` semantics, but does not prove the
missing local ownership, fee or lifecycle invariants:

- `https://developers.binance.com/en/docs/catalog/core-trading-spot-trading/api/rest-api/trade`
- `https://developers.binance.com/en/docs/products/spot/user-data-stream`
- `https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/trade#new-order`

## Scope and hard boundary

- The implementation correction remains exactly inside the exclusive six-source
  and four-test-file normalBasis cut.
- This audit changes L09 documentation only and removes the unfinished false
  acceptance drafts from the current tree.
- The two owner inputs remain untracked and unstaged; their SHA-256 values match
  `live-edge-receipts/DIRECTIVE_INPUTS.lock`.
- No secret was inspected, retained, logged or committed.
- No private read, signed/test/live order, send/query/cancel, Margin mutation,
  capital action, cloud/deployment/process action, merge or push occurred.

`LIVE_EXECUTION_NOT_IMPLEMENTED` remains mechanically enforced.

## Exact resume condition

Resume only after the director issues the explicit group 5–6 ruling described
in L09-005 or authorizes owner-scoped corrections with exact path ownership.
Until that event, L09 is `BLOCKED`, not `LANE_READY` or `ACCEPTED`.
