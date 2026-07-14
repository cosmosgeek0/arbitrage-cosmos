# Owner preparation drafts

Status: **DRAFT — OWNER SIGN-OFF REQUIRED — ZERO EXTERNAL ACTIONS**

These files prepare the owner-only work that remains after software acceptance. They grant no authority, contain no secret values, and record no action as executed. Every authorization instance is deliberately incomplete and ineffective until the owner binds exact targets, limits, times, permissions, commands, receipts, and a durable confirmation.

## Controlling evidence

- I00 §20 source: Git blob `58e6fbfb1369b4721e0fcd2f94495221ec67f30d`, raw SHA-256 `9d7a36da6a2e6e7b3e905c73161b5e998a2f92416dd557e498ade3e73d5e5ef5`, lines 1766–1804.
- Launch §7 L-A source: Git blob `587c1b83e8f9d32b9097d88df7fea40d9829b68e`, raw SHA-256 `26b1d5ce118982b4b3ba64b44b7fb3e88b0b7ded26a818a775a65bffaa0f2c06`, lines 275–291.
- L canary envelope source: Git blob `53fea2b71b06702b30527e807755a54683b2dbd2`, raw SHA-256 `40de1feb6678d8741bd38f7538b2c6f25304c0f64195a596961fdb2539a3b037`, lines 1639–1668.
- Accepted local authorization-template shape: `i00-product-assembly-20260713@139d2cf07ffd3167bd54a3c14c0fc6671c2f02e9:ops/templates/i00/external-authorization.json.template`.

## Permanent rules

1. One authorization grants exactly one action class. It never implies another class.
2. No wildcard, `ALL`, `ANY`, broad account, broad host, broad permission, or open-ended command is valid.
3. No secret value, token, private key, credential payload, webhook, or private endpoint parameter belongs in Git, a receipt, a prompt, a log, or these drafts.
4. Withdrawal and transfer-out authority are forbidden. Nothing here may be edited to add them.
5. Missing, stale, expired, mismatched, ambiguous, or unreconciled evidence means stop without mutation.
6. Software acceptance does not authorize deployment, private reads, signed validation, Margin actions, a live ticket, a capital increase, or an external message.

## Inventory

- `authorizations/`: one common template and eight class-pinned draft instances from I00 §20.
- `drills/`: five zero-capital game-day plans plus common safety law.
- `CAPITAL_EVIDENCE_LADDER_DRAFT.md`: owner-proposed `$10 → $50 → $200` thresholds with evidence gates and no automatic promotion.
- `KEY_ROTATION_CHECKLIST_DRAFT.md`: secret-free rotation preparation.
- `PAGING_DESTINATION_SETUP_DRAFT.md`: one out-of-band destination and delivery-proof plan.

## Owner activation sequence

After one candidate is independently verified, the owner may select one draft, bind every placeholder to the exact verified/deployed target, review the maximum effect and recovery plan, sign it durably, and execute only through the canonical authorized boundary. The result and reconciliation receipts must be distinct. Until then every file remains `DRAFT_OWNER_SIGNOFF_REQUIRED`, `authorizationEffective=false`, `result=NOT_RUN`, and `reconciliation=NOT_RUN`.
