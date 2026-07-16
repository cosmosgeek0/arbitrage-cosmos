# D0005 — L02 Binance documentary contract policy

Status: `ACCEPTED_FOR_LANE_L02`

Date: `2026-07-12`

Authority: L-lane documentary adapter decision only. This does not amend
`ARCHITECTURE.md` Part II, grant external action, or supersede Binance's dated
official documentation.

## Decision

- Freeze the L02 matrix at schema `BINANCE_CONTRACT_MATRIX_V1`, revision
  `L02-BINANCE-2026-07-12`, with every source evidence set and the complete
  matrix independently SHA-256 locked.
- Select Spot `userDataStream.subscribe.signature` with an HMAC key and JSON
  text as the lane's later implementation target. The authenticated Ed25519
  session method and SBE 3:5 remain documented current alternatives, not the
  selected path.
- Select the simple routed USD-M private listen-key stream contract while
  retaining its query/raw and combined current alternatives.
- Keep Margin trade/account user data unresolved: the successor listen-token
  path is named by the changelog, but its exact destination, security, weight,
  TTL, renewal and close contract remain `UNKNOWN`.
- Treat `/sapi/v1/margin/listen-key` as the separate Cross Margin risk-data
  stream. POST/PUT are current; DELETE stays an official-document conflict for
  listen-key parameter semantics. Risk events never stand in for order,
  balance or complete private-account truth.
- Preserve the Margin max-borrow 750 UID versus 50 IP conflict and the Margin
  order IP-heading versus UID-value conflict without selecting an effective
  budget.
- Model proved absence as `NOT_APPLICABLE`, unresolved documentation as
  `UNKNOWN`, removed routes as `REMOVED`, and official contradictions as
  `OFFICIAL_DOC_CONFLICT`. None may match a current fixture.
- Default to separate `READ_KEY` and `EXECUTION_KEY` profiles. A combined key
  requires an owner exception; withdrawals must be disabled, transfers
  disabled where exposed, and the fixed-IP restriction must be proved to match
  deployed egress before later live entry can even be considered.
- Require exact documentary status and mode truth before later live-entry
  consideration: account status `Normal`, API trading unlocked,
  `multiAssetsMargin=false` and `dualSidePosition=false`. Missing or unproved
  permission, account/realm fingerprint, status or supported mode truth blocks
  entry; L02 grants no authority to perform the signed reads.

## Safety and ownership

The matrix is inert plain data. L02 contains no signer, client, credential,
socket, private read, test order, real order, Margin action, capital change,
runtime acquisition, deployment or process-control capability. Intelligence
Runtime remains public acquisition owner; existing Strategy, Capital,
Foundation control/risk/execution/reconciliation, Ledger and System
Integration owners remain canonical.

`LIVE_EXECUTION_NOT_IMPLEMENTED` remains unchanged.
