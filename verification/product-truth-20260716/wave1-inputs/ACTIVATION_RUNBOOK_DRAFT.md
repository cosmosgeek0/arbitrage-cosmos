# 10-USDT activation runbook draft and preparation receipt

Status: `DRAFT_OWNER_SIGNOFF_REQUIRED`

Authorization effective: `false`

Result: `NOT_RUN`

Reconciliation: `NOT_RUN`

External action authorization: `NONE`

Preparation authority: `NON_BINDING_PREP_ONLY`

This is the single narrative receipt for the P4 activation-preparation shard. Its sole companion artifact is `CANARY_PRECHECK.json`. Nothing in either file authorizes a private read, signed call, test order, live order, Margin action, credential use, deployment, service mutation, capital allocation, withdrawal, or transfer. This shard does not issue `VERIFIED_ACCEPTED`; only the post-baseline fresh verifier may do that.

## Receipt identity and boundary

| Field | Exact value |
| --- | --- |
| Required input | `41752d6a87dc` |
| Observed full HEAD | `41752d6a87dc1cb1b933bb4460c9cabfc15ff694` |
| Observed tree | `a770f9f393e6229252731cd5247e9a1abfd2e509` |
| Worktree | `/Users/cosmosgeek/Desktop/prep-act` |
| Git posture | detached HEAD; no branch |
| Preparation UTC | `2026-07-16T12:25:57Z` |
| OwnerPrep ref | `preverify-20260714` |
| OwnerPrep commit | `46b2f1e31edf9f75aec7203e952a56f9869a2971` |
| OwnerPrep commit tree | `ad11b333ca412093d55c5e26560ce4b3b9792c1b` |
| OwnerPrep subtree | `7adaeb40bbdf40397c791f12e3c033c800ffb9f3` |
| Preparation result | `ACTIVATION_PREP_READY` |
| Activation/canary state | `BLOCKED_OWNER_GATES_NOT_RUN` |

The preparation result means only that the requested unsigned drafts exist and passed local read-only validation. It does not mean the baseline, deployment, private account truth, signed validation, venue minimums, dispatcher, test order, live ticket, or economic edge is accepted.

## Governing inputs

The ownerPrep files were consumed from Git objects through `git show preverify-20260714:<path>`; they were not checked out or copied into a tracked path.

| Input | Git blob | Raw SHA-256 |
| --- | --- | --- |
| `ownerPrep/README.md` | `4290dd0f612b656e3a11ca256ab9f933e79226cd` | `56ae114a6f93e22b631be49e7428d29fb9c5adfa2c175cad89ff60aeae4823e1` |
| `ownerPrep/CAPITAL_EVIDENCE_LADDER_DRAFT.md` | `240783721986564a5cfa803f04574d1fb9b66bfb` | `29e92bcb0c90316f28c10f35516cd71cae13007293772522244a1e397770aed6` |
| `ownerPrep/authorizations/EXTERNAL_ACTION_AUTHORIZATION_TEMPLATE.md` | `cc0543321760946c8d0830708e326d7319e6389e` | `726c08e8e1d396f9546e4b1d48b79a1b2b4c6f3147f8f5dcac18c4b262f4e7b9` |
| `ownerPrep/authorizations/01-private-read-only-account-proof.md` | `f49b83fcf829f832e415c8ffc3c3c6fe4732145e` | `b3e39a9b888a6cf4f709d7a0e324d313115308c6a9e4c889251d4bde544ff1d4` |
| `ownerPrep/authorizations/04-signed-spot-test-order.md` | `219b5468a1b4fb400341faab52c52c15a5208f45` | `f7be40b6240ddc118f3d7a369d3e8d127195ef660fbf38ca567b9a57b0f3d419` |
| `ownerPrep/authorizations/05-signed-usdm-test-order.md` | `85f5d0d100ca07a3081e8e000c8f0233d82a3efa` | `f01c38e6a1db75d9d41d369f2f2d9369384cfc8073b83be47d8cf3576f8ab2c0` |
| `ownerPrep/authorizations/06-margin-read-maximum-borrowable-proof.md` | `83739fdc13941072e3076319764545b693f43123` | `a3287c73fbd6e2c81efd91bd0bf1cb44a7fb2b2b2ea758cddeb339f380fcffd5` |
| `ownerPrep/authorizations/08-owner-approved-tiny-live-ticket.md` | `a925bf417d73c06b0b66634dab7afcc4e7e6cc1c` | `720f7b39c6b7d29711f0b7bcd275315c534c350b53190a3d662134236d72ab02` |
| `ownerPrep/drills/00-zero-capital-common-safety.md` | `8369633ff30910c0f17c51f28d38f54157773e63` | `0c27e238ee34e15289576f0380fbbe9e2de3dcdc607979373c19948c6699e4ea` |
| `ownerPrep/drills/02-recovery-required.md` | `8c43443b9f412fb35f17386a974a6c87ef9b8ad1` | `0be21cd13a4203c9423caec42f0e112f550e4365689562d7df4c80dac66d737a` |
| `ownerPrep/drills/03-canary-loss-cap.md` | `eff50b3eb1aeaec2d6b30539364fab191802004a` | `f1a54f70fe0c6fe40987c93f1b4e204280eaf735f208813fe460b914a97b16fb` |

Candidate law also came from `STATE.md`, `MISSION.md`, `ARCHITECTURE.md`, the accepted L06 journal decision, Foundation reconciliation/identity contracts, the current instrument-sizing owner, and the current private-truth/signed-kernel owner seams. Repository vendor facts dated 2026-07-13 are reference-only here. Current official venue documentation and live filters were deliberately not refreshed because this shard permits zero external calls.

## Frozen canary envelope

Every later activation artifact must preserve this envelope exactly:

```text
maximum total allocated capital: 10 USDT equivalent aggregate
maximum active strategy tickets: 1
maximum automatic repeat entries after closure: 0 until owner re-arm
maximum aggregate live loss in current canary epoch: 2 USDT
withdrawal/internal/external transfer actions: impossible
unknown/stale/reconciliation mismatch: no new entry
```

The 10-USDT ceiling is not per leg, strategy, stage, sizing invocation, or retry. The 2-USDT loss total includes realized loss, negative unrealized PnL, fees, funding, borrow interest, and conservative recovery cost. Cash/collateral committed, Spot notional, Futures gross notional and leverage, Margin collateral and principal-plus-interest liability, aggregate gross notional, net/unhedged exposure, recovery reserve, valuation source/time/haircut, and the loss epoch must be displayed separately.

## Activation entry gate

Every item is mandatory. `UNKNOWN`, missing, stale, expired, mismatched, ambiguous, incomplete, unreconciled, or unsigned means stop without mutation.

- [ ] A fresh verifier has independently issued the baseline acceptance token for the exact candidate; this shard has not.
- [ ] Exact candidate SHA/tree and exact deployed SHA/release/config/risk/model/envelope revisions are equal to the owner-bound values.
- [ ] Current official Spot, USD-M, and Margin contracts needed by the chosen ticket have been reverified, timestamped, and hashed after this draft.
- [ ] The selected account fingerprint, account realm, host, environment, stable egress, product modes, symbol permissions, and credential permission readbacks are exact.
- [ ] Distinct durable owner authorizations exist for every required class: private read, Spot signed validation, USD-M signed validation, Margin read or mutation when applicable, and the one tiny-live ticket. One class never implies another.
- [ ] Private account truth is current, complete enough for the selected posture, and reconciled by Foundation against the same account/product/source cuts.
- [ ] Current public filter snapshots and reference prices prove the complete ticket fits the 10-USDT aggregate envelope after exact rounding and reserve.
- [ ] Recovery, restart, reconciliation, halt, loss-cap, source-loss, and no-blind-resend proofs bind the deployed revision.
- [ ] A separately audited canonical dispatcher exists. It atomically gates one send on a committed durable intent; the current synthetic journal projection with `sendAuthorized=false` is not enough.
- [ ] `LIVE_EXECUTION_NOT_IMPLEMENTED` has been reconciled only through a separately reviewed owner/director change and independent proof. It must never be bypassed by a runbook.
- [ ] There are zero unresolved P0/P1 safety findings, zero unknown exposure/liability, and zero false-green readiness claim.
- [ ] One exact preview digest and single-use nonce are bound, current, unused, and within the authorization window.
- [ ] The owner reviews the final exact ticket and signs the gate in this runbook durably.

## Runbook A — private-read reconciliation

This runbook creates account truth only. It has maximum capital `0`, maximum notional `0`, and no mutation authority.

### A1. Bind one private-read authorization

Bind exactly one `private read-only account proof` record to:

- the full verified candidate SHA/tree and deployed revisions;
- one account fingerprint and account realm;
- one host/environment/stable-egress identity;
- exact read commands, endpoints, products, symbols/assets, query modes, and maximum response bounds;
- a short ordered UTC start/expiry window;
- exact credential types and read permissions, never values;
- a result receipt path and a different reconciliation receipt path;
- rollback to `NOT_CONFIGURED` and preservation of last-good facts as stale, never live.

The permission readback must show reading enabled and every unnecessary capability disabled. In particular, withdrawal, internal/universal transfer, live trading, borrow/repay, leverage mutation, and any product not selected by the authorization must be unavailable. Fixed-IP restriction and deployed-egress match must be exact, not assumed.

### A2. Capture the pre-read cut

Before materializing any read session, record and hash:

- candidate/deployed/config identities;
- authorization ID, scope, expiry, and nonce;
- account fingerprint reference and account/product modes;
- current canonical Ledger head and reconciliation revision;
- local balances, positions, orders, liabilities, ambiguities, and recovery state as currently known, preserving unknowns;
- public source revisions, timestamps, freshness, sequence/coverage, and selected symbol set;
- clock calibration and bounded `recvWindow` policy;
- the approved exact endpoint set and expected fact kinds.

Abort before the first request on any identity, permission, egress, time, source, Ledger, exposure, or authorization mismatch.

### A3. Perform one bounded read session

Only a later authorized operator may perform this step. The exact argv is `OWNER_MUST_BIND_EXACT_ARGV`; this draft intentionally contains no credential-bearing or executable request command.

For a Spot + USD-M posture, capture the exact required subset of permissions, account/balance, positions, open orders, trade/fill history, account configuration, position mode, and product status. For reverse basis, separately authorize and capture Margin account/mode, inventory, liabilities, max-borrowable amount, interest/rate, open orders, history, collateral realm, and validity interval. Never substitute zero for a missing balance, position, order, liability, rate, or borrow value.

Every fact records product, realm, accountRealmId, profile fingerprint, contract ID, query scope, symbol/asset/mode, receipt ID, source/receive times, max age, completeness, schema revision, content/evidence revision, and sanitized value hash. Secret values and raw signed material never enter evidence.

### A4. Reconcile through the canonical owner

1. Normalize the bounded private facts through the existing private-truth contracts; do not create a second account owner.
2. Prove exact read and execution permission revisions are distinct and account-realm bound.
3. Bind Spot, USD-M, and Margin lifecycle witnesses separately. Spot has no universal global sequence proof; a current owner REST cut must cover any connection break and the retained private-event cut.
4. Build the selected posture projection for the exact target symbol and validity window.
5. Pass only a comparison input to Foundation reconciliation. The private-truth adapter cannot author a reconciliation verdict.
6. Require a same-cut Foundation result binding the exact source-cut revision and product lifecycle cuts.
7. Compare exchange-observed balances, positions, orders, fills, liabilities, permissions, product modes, and account status to local Ledger intent/history.
8. Preserve every mismatch. `PARTIAL`, `AMBIGUOUS`, `DIVERGED`, `STALE`, `UNAVAILABLE`, incomplete history, missing product cuts, or an expired validity window blocks new/increasing exposure.
9. Restart/readback proof must reproduce the same unresolved truth before readiness. Existing exposure and recovery remain visible.

### A5. Close the session

Write distinct sanitized result and reconciliation receipts, revoke or unmaterialize the read session, retain only opaque fingerprints and hashes, and mark all facts stale after their TTL. `PRIVATE_READ_PROVED` may be claimed only by the later authorized program with exact evidence; this draft records `OWNER_GATED_NOT_RUN`.

## Runbook B — signed non-matching test calls

Spot and USD-M are separate action classes. A pass for one never authorizes or proves the other. Both remain zero-capital validation requests and cannot enter a matching engine.

### B1. Shared prerequisites

- Bind one exact single-use signed-test authorization to the verified/deployed identities, account fingerprint, product, host, route, symbol, side, order type, time in force, position side/reduce-only fields when applicable, exact quantity/price, filter snapshot revisions, payload digest, deterministic client ID, request identity, nonce, start/expiry, and two distinct receipt targets.
- Reverify current official non-matching semantics, authentication, parameters, weights, error/timeout behavior, and host/route. The candidate's 2026-07-13 matrix is not activation-time proof.
- Confirm the request builder is pinned to the test route and mechanically cannot substitute a live order route.
- Confirm current private-read reconciliation, account/position modes, clock calibration, rate budget, filter preview, and zero unknown exposure.
- Persist the authorization/preview audit record before the call. Do not mislabel that record as a live-order submission intent.
- Perform exactly one call. Automatic resend and retry are `false`.

### B2. Spot procedure

The dated candidate contract identifies `POST /api/v3/order/test`. At activation time, bind the current official host and the exact Spot test fields including symbol, side, type, quantity or quote quantity, price, time in force when applicable, deterministic client ID when supported by the current contract, timestamp, bounded `recvWindow`, and signature profile. The later operator sends the one prehashed request through the separately authorized signed-test boundary only.

### B3. USD-M procedure

The dated candidate contract identifies `POST /fapi/v1/order/test`. At activation time, bind the current official host and exact USD-M fields including symbol, side, position side, type, quantity, price, time in force, reduce-only/close-position compatibility, deterministic client ID, timestamp, bounded `recvWindow`, and signature profile. Current weight and response semantics must be reverified; an older dormant-client constant is not authority.

### B4. Classify and reconcile the result

- A complete expected success response proves only that the signed validation request was accepted. It proves no order, fill, position, or live authority.
- A deterministic pre-dispatch block proves no request left the process and is recorded as a failed validation, not a retry invitation.
- A non-408 4xx response is a rejected validation. Preserve exact sanitized error evidence; do not resend under the same authorization.
- Timeout, disconnect, HTTP 408, HTTP 5xx, abort after possible dispatch, or malformed/incomplete response is `UNKNOWN`. Never classify it as success or failure and never blindly resend.
- Because a correctly routed test endpoint should create no queryable order, an ambiguous test response remains `SIGNED_TEST_NOT_PROVED`. Prove the exact route and audit trace, reconcile current open-order/account truth for unexpected effects, expire the nonce/authorization, and require a new authorization for any later validation attempt.
- Any evidence that a live endpoint was reached is a critical stop: set `HALTED`/`RECOVERY_REQUIRED`, query/reconcile exchange truth, preserve all evidence, and do not send anything else.

`SIGNED_TEST_PROVED` may be claimed only by the later authorized program with current contract and exact request/result evidence. This draft records both product classes `OWNER_GATED_NOT_RUN`.

## Runbook C — venue-minimum and 10-USDT lifecycle check

### Current preparation verdict

`NOT_EVALUABLE_CURRENT_FILTERS` with blocking flag `TEN_USDT_MAY_BE_INVALID`.

No symbol, structure, order type, current exchangeInfo snapshot, current reference price, account mode, existing leverage, borrow truth, or recovery reserve was owner-bound in this shard. Therefore 10 USDT is not declared valid. The eventual exact result is either `CANARY_FILTERS_FIT` or `BLOCKED_BY_MIN_NOTIONAL`; unknown cannot become pass.

The candidate provides a useful static per-invocation sizing owner, but that owner caps one sizing result at 10 USDT and always returns `sendEligible=false`. Two per-leg `PASS` results do not prove the owner-required aggregate capital ceiling. Existing tests also show that step rounding can reduce a nominal 10-USDT request to 9.99 and fail a 10-USDT minimum, and that a 10.1 minimum blocks without increasing capital.

### C1. Capture current immutable inputs

After authorization, capture and hash fresh current venue metadata separately for each selected product and symbol. Do not copy Spot filters into USD-M or Margin.

- symbol/product/realm and trading status;
- `PRICE_FILTER` tick/min/max;
- `LOT_SIZE` min/max/step;
- `MARKET_LOT_SIZE` where applicable;
- Spot `MIN_NOTIONAL` or `NOTIONAL`, including market applicability and reference-price window;
- USD-M minimum-notional field and any current maximum-notional or quantity rules;
- percent-price and side-specific price bounds for limit orders;
- selected order type/TIF capability;
- current exact bid/ask, mark, weighted-average, or other contract-required validation price with source time/TTL;
- Margin mode, inventory, max borrow, interest, collateral, liability, and repayment/recovery constraints when applicable;
- current account position/multi-asset/leverage state. Never mutate leverage to make the canary fit.

All arithmetic uses canonical decimal strings. Binary floating-point and pre-round notional are not acceptance evidence.

### C2. Calculate each leg and the complete ticket

1. Start from one owner-approved strategy ticket and its exact maximum total allocated capital of 10 USDT.
2. Reserve a positive conservative recovery amount before sizing entry legs. Include estimated fees, slippage, funding, borrow interest, adverse movement during maximum unhedged time, and emergency unwind cost.
3. For each leg, select its contract-required conservative validation price.
4. Derive a candidate base quantity, floor it to every applicable quantity grid without increasing size, then re-evaluate minimum quantity, maximum quantity, price, and post-round notional.
5. For hedged legs, find an exact quantity intersection or explicitly bound the residual unhedged exposure. Do not assume different Spot and USD-M grids align.
6. Recheck active minimum/maximum notional after all rounding and price-bound transformations.
7. Compute and display:

```text
spot_cash_committed
futures_collateral_committed
margin_collateral_committed
margin_principal_plus_interest_liability
fees_funding_borrow_slippage_reserve
recovery_reserve
total_allocated_capital
spot_notional
futures_gross_notional
aggregate_gross_notional
net_exposure
maximum_unhedged_exposure_and_time
worst_case_canary_loss
```

8. Require `total_allocated_capital <= 10 USDT`, `worst_case_canary_loss <= 2 USDT`, one ticket, zero repeat, every leg within current filters, and all per-leg/gross/liability limits within the owner-bound envelope.
9. If any leg is below a post-round minimum, if grids cannot form the approved hedge, if reserve makes total allocation exceed 10, or if any required fact is unknown, emit exact `BLOCKED_BY_MIN_NOTIONAL` or the narrower blocking code with full math. Never increase capital, leverage, liability, or risk automatically.
10. Selecting another symbol requires a new approved proposal, new filter capture, new preview digest, and owner review.

For a two-leg structure, if the sum of the two current leg minimums plus nonzero collateral/fee/recovery requirements cannot fit inside the 10-USDT allocation, the canary is invalid by arithmetic even if each leg separately passes a per-order 10-USDT ceiling.

## Runbook D — deterministic identity, durable intent, and ambiguity

This checklist applies to any later real mutation. It does not grant the missing dispatcher or live authority.

### Before any network byte

- [ ] Freeze the exact approved plan ID, leg ID, and bounded attempt number. Automatic repeats remain zero.
- [ ] Derive the canonical client order ID from `(planId, legId, attempt)`. The same tuple must produce the same `cx-<24 hex>-<attempt>` ID forever; never derive it from time, array position, or randomness.
- [ ] Bind product, environment, account realm, contract, symbol, operation, payload digest, filter/reference revisions, Capital mandate/reservation, Risk verdict, authorization ID, preview digest, nonce, and expiry to that identity.
- [ ] Persist aliases among proposal, mandate, ticket/plan, leg, request, deterministic client order ID, and any later exchange IDs.
- [ ] Append `SUBMISSION_INTENT`/`SUBMITTING` through the canonical Ledger's atomic compare-and-set transaction. Require exact expected prior state, committed checkpoint, dedicated journal and audit events, positive Ledger event ID, lineage/state digests, commit time, and post-commit readback.
- [ ] Missing, failed, stale, conflicting, malformed, partial, capacity-exhausted, or lineage-mismatched persistence acknowledgment means no dispatch.
- [ ] Require a separately audited atomic consume/lease/fence that can authorize one dispatcher exactly once. The present pure synthetic boundary is repeatable evidence with `sendAuthorized=false`; it is not this permit.
- [ ] Re-read kill/intake state, authorization validity, source freshness, private reconciliation, filters, Capital/Risk limits, and loss envelope immediately before the one send.

### After possible dispatch

- [ ] Persist the submission observation and sanitized transport outcome without fabricating venue effect.
- [ ] HTTP success is not a fill; acknowledgment is not working; requested quantity is not filled quantity; terminal order is not reconciled position truth.
- [ ] Timeout, disconnect, HTTP 408, HTTP 5xx, abort after possible dispatch, malformed/incomplete response, mixed cancel/replace result, or post-dispatch persistence degradation becomes `UNKNOWN` or `PARTIAL_MIXED`.
- [ ] Immediately block duplicate send and all new/increasing exposure for the affected ticket.
- [ ] Query the exact product/account/mode/symbol order truth by the original deterministic client order ID through the canonical read/reconciliation owner. Preserve any exchange order ID returned.
- [ ] Query-not-found alone is not universal proof of no effect; respect product retention windows, account modes, stream gaps, and query time. Combine exact query, private events, fills, balances/positions/liabilities, and the durable journal in Foundation reconciliation.
- [ ] Never blindly resend. Reuse of the same identity must return the prior result or deterministic conflict, never a second mutation. A new attempt requires proven no effect, closed recovery, a new bounded attempt identity, and new owner authorization when the prior scope/nonce is consumed or expired.
- [ ] Any ambiguous or divergent state remains `RECOVERY_REQUIRED`; restart must restore it before readiness. Exit/recovery stays available while new risk remains blocked.

## Exact owner-approval gate wording

The controlling ownerPrep template says exactly:

> Do not mark it `APPROVED` until every placeholder is exact, the independently verified candidate is bound, the owner signs durably, and the canonical validator accepts the record.

The current required owner-confirmation value is exactly:

```text
UNSIGNED — OWNER_ID, UTC, DURABLE_REFERENCE REQUIRED
```

When every prerequisite is actually complete, the owner must bind and durably sign the following whole block without widening it. Until every placeholder is replaced and validated, it is ineffective.

```text
OWNER APPROVAL — EXACTLY ONE TINY-LIVE TICKET

I, <OWNER_ID>, at <APPROVED_AT_UTC>, approve exactly one owner-approved tiny-live
strategy ticket bound to authorization <AUTHORIZATION_ID>, verified candidate
41752d6a87dc1cb1b933bb4460c9cabfc15ff694 with tree
a770f9f393e6229252731cd5247e9a1abfd2e509, deployed identity
<DEPLOYED_SHA_RELEASE_CONFIG_RISK_MODEL_ENVELOPE_REVISIONS>, account
<ACCOUNT_FINGERPRINT>, host/environment <HOST_ENVIRONMENT>, strategy/symbols/legs
<EXACT_TICKET_SCOPE>, request identities and preview digest <IDENTITIES_AND_DIGEST>,
and the UTC window <START_UTC> through <EXPIRY_UTC>.

This approval permits only the canonical executor to attempt that one exact ticket.
Maximum total allocated capital is 10 USDT equivalent aggregate; maximum active
tickets is one; maximum automatic repeat entries is zero until owner re-arm; maximum
aggregate canary-epoch loss is 2 USDT including realized loss, negative unrealized
PnL, fees, funding, borrow interest, and conservative recovery cost. Every leg must
pass the bound current exchange-filter and post-round minimum math. A structure that
does not fit stops as BLOCKED_BY_MIN_NOTIONAL; capital, leverage, liability, or scope
must not increase automatically.

Timeout, disconnect, HTTP 408/5xx, incomplete response, or any exchange/local
ambiguity becomes UNKNOWN and RECOVERY_REQUIRED. The system must query and reconcile
truth by the deterministic client order identity and must never blindly resend.
Reaching the loss cap, expiry, stale or mismatched truth, permission/mode drift,
deployed-identity drift, or failed recovery immediately halts new exposure and
requires a new owner authorization to re-arm.

This approval does not authorize any other ticket, retry, repeat, symbol, product,
account, host, deployment, service mutation, Margin borrow/repay, leverage mutation,
withdrawal, transfer, or authorization class. Withdrawal and transfer-out remain
impossible. The result receipt is <RESULT_RECEIPT>; the distinct reconciliation
receipt is <RECONCILIATION_RECEIPT>; rollback/recovery is <EXACT_ROLLBACK_RECOVERY>.

owner: <OWNER_ID>
approved_at_utc: <APPROVED_AT_UTC>
durable_reference: <DURABLE_REFERENCE>
status: APPROVED
```

Current sign-off remains:

```text
owner: UNSET
approved_at_utc: UNSET
durable_reference: UNSET
status: DRAFT_OWNER_SIGNOFF_REQUIRED
```

## Stop, rollback, and re-arm law

- Before dispatch: any failed gate expires the attempt without mutation.
- Minimum/filter failure: `BLOCKED_BY_MIN_NOTIONAL`; preserve exact math; do not raise capital or leverage.
- Ambiguous possible effect: `HALTED` plus `RECOVERY_REQUIRED`; no new exposure; query/reconcile; never resend.
- Private truth, permission, mode, source, deployed-SHA, or authorization drift: halt and require revalidation.
- Aggregate loss at exactly 2 USDT: effective `HALTED`, zero new entry/addition/repeat, new durable owner authorization required.
- Restart, closure, recovery, config change, deployment, mismatch, expiry, or hard loss never inherits an old approval outside its exact scope.
- Existing exposure, liabilities, ambiguity, exit, and recovery stay visible. No rollback may erase them or fabricate flatness.
- Withdrawal and transfer-out remain permanently forbidden.

## Primary exact commands executed for this receipt

All commands were read-only except creation of the two explicitly permitted untracked root artifacts.

```text
pwd
git rev-parse HEAD
git symbolic-ref -q HEAD
git status --short --branch
git rev-parse HEAD^{tree}
git rev-parse preverify-20260714^{commit}
git rev-parse preverify-20260714^{tree}
git rev-parse preverify-20260714:ownerPrep
git ls-tree -r -l preverify-20260714 ownerPrep
git show preverify-20260714:ownerPrep/README.md
git show preverify-20260714:ownerPrep/CAPITAL_EVIDENCE_LADDER_DRAFT.md
git show preverify-20260714:ownerPrep/authorizations/EXTERNAL_ACTION_AUTHORIZATION_TEMPLATE.md
git show preverify-20260714:ownerPrep/authorizations/01-private-read-only-account-proof.md
git show preverify-20260714:ownerPrep/authorizations/04-signed-spot-test-order.md
git show preverify-20260714:ownerPrep/authorizations/05-signed-usdm-test-order.md
git show preverify-20260714:ownerPrep/authorizations/06-margin-read-maximum-borrowable-proof.md
git show preverify-20260714:ownerPrep/authorizations/08-owner-approved-tiny-live-ticket.md
git show preverify-20260714:ownerPrep/drills/00-zero-capital-common-safety.md
git show preverify-20260714:ownerPrep/drills/02-recovery-required.md
git show preverify-20260714:ownerPrep/drills/03-canary-loss-cap.md
git --version
node --version
npm --version
jq --version
rg --version
shasum --version
uname -srm
jq -e . CANARY_PRECHECK.json
git diff --quiet --exit-code
git diff --cached --quiet --exit-code
git status --porcelain=v1 --untracked-files=all
shasum -a 256 CANARY_PRECHECK.json
git hash-object --no-filters CANARY_PRECHECK.json
wc -l -c ACTIVATION_RUNBOOK_DRAFT.md CANARY_PRECHECK.json
```

Two bounded inline Node validators also ran locally: one checked the companion schema/count/authority/safety invariants, and one scanned both artifacts for private-key, AWS, GitHub, Slack, and OpenAI-style secret signatures. Their exact measured outputs are recorded below; neither performed I/O beyond reading these two files.

## Tool versions

| Tool | Version |
| --- | --- |
| Git | `git version 2.50.1 (Apple Git-155)` |
| Node.js | `v22.23.1` |
| npm | `10.9.8` |
| jq | `jq-1.7.1-apple` |
| ripgrep | `15.1.0 (rev af60c2de9d)` |
| shasum | `6.02` |
| platform | `Darwin 25.5.0 arm64` |

## Validation and skip accounting

Final preparation-validation counts:

```text
PASS: 10
FAIL: 0
SKIP: 9
```

| Validation | Result | Exact evidence |
| --- | --- | --- |
| Candidate identity | `PASS` | `git rev-parse HEAD` returned `41752d6a87dc1cb1b933bb4460c9cabfc15ff694` |
| Detached posture | `PASS` | `git symbolic-ref -q HEAD` returned no symbolic ref |
| OwnerPrep object/hash capture | `PASS` | 11 relevant blobs were read from `preverify-20260714` and independently SHA-256 hashed |
| Companion JSON syntax | `PASS` | `jq -e . CANARY_PRECHECK.json` exit `0` |
| Companion JSON invariants | `PASS` | Node validator exit `0`; internal activation prechecks measured `PASS 3 / FAIL 2 / SKIP 11`, activation `BLOCKED`, result token `ACTIVATION_PREP_READY` |
| Secret-signature scan | `PASS` | Node scan exit `0`; 2 files scanned; 0 private-key/AWS/GitHub/Slack/OpenAI-style signature hits |
| Tracked worktree | `PASS` | `git diff --quiet --exit-code` exit `0` |
| Index | `PASS` | `git diff --cached --quiet --exit-code` exit `0` |
| Untracked scope | `PASS` | final status contains exactly the two permitted root artifacts |
| Companion hash/object | `PASS` | raw SHA-256 and Git blob ID below were independently emitted |

Mandatory external gates are intentionally skipped, never passed:

- `POST_BASELINE_FRESH_VERIFIER`: `SKIP_NOT_THIS_ACTOR`; only the fresh verifier may issue acceptance.
- `CURRENT_OFFICIAL_DOC_REFRESH`: `SKIP_ZERO_EXTERNAL_CALLS`.
- `CURRENT_VENUE_FILTER_CAPTURE`: `SKIP_ZERO_EXTERNAL_CALLS_AND_NO_OWNER_BOUND_SYMBOL`.
- `PRIVATE_ACCOUNT_READ`: `SKIP_ZERO_CREDENTIALS_ZERO_PRIVATE_CALLS`.
- `SIGNED_SPOT_TEST`: `SKIP_ZERO_CREDENTIALS_ZERO_SIGNED_CALLS`.
- `SIGNED_USDM_TEST`: `SKIP_ZERO_CREDENTIALS_ZERO_SIGNED_CALLS`.
- `DEPLOYED_RUNTIME_READBACK`: `SKIP_NO_DEPLOYMENT_OR_EXTERNAL_TARGET`.
- `CANARY_EXECUTION`: `SKIP_NO_OWNER_AUTHORIZATION_AND_LIVE_EXECUTION_NOT_IMPLEMENTED`.
- `FULL_REPOSITORY_BATTERY`: `SKIP_ZERO_MUTATION_DOCUMENT_ONLY_SHARD`; build/test commands can create ignored build or dependency artifacts and are not proportionate to two untracked documentation artifacts.

No full repository battery was run: this shard changes no tracked source, and build/test commands can create ignored build/dependency artifacts contrary to the zero-mutation constraint. Local artifact syntax, invariant, secret-pattern, Git scope, and hash checks are the proportionate gate.

## Forbidden-path non-touch assertion

At start, tracked worktree and index were clean. This shard did not write, stage, commit, merge, push, reset, clean, switch, or modify any tracked path, any other worktree, or `current-main`. It did not access credentials or make an external/network call. The only permitted writes are the two untracked files at this worktree root:

```text
ACTIVATION_RUNBOOK_DRAFT.md
CANARY_PRECHECK.json
```

Final Git scope, counts, and the companion artifact hashes appear in the sealed validation block below.

## Final artifact seal

| Artifact | Raw SHA-256 | Git blob ID | Size at seal |
| --- | --- | --- | --- |
| `CANARY_PRECHECK.json` | `02c4181f49385a2f8d9620babeead4a4a94506e7586dae1e6613ae944d623f92` | `6dc2b74e408742c93a068ec7d1e669d4ce0f94bd` | 273 lines; 10,577 bytes |

The Markdown receipt intentionally does not embed a self-hash, which would be circular. Its final raw hash is to be computed directly from the untracked file by the consumer. At seal, HEAD remained exact and detached; tracked worktree and index remained clean; `git status --porcelain=v1 --untracked-files=all` listed only `ACTIVATION_RUNBOOK_DRAFT.md` and `CANARY_PRECHECK.json`.

ACTIVATION_PREP_READY
