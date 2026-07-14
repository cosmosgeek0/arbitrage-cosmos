# Key-rotation checklist draft

Status: **DRAFT — OWNER SIGN-OFF REQUIRED — ZERO EXTERNAL ACTIONS — NO SECRET VALUES**

Use this checklist when any Binance, Alchemy, AWS, Cloudflare, paging, build-signing or other credential may have appeared in source, ZIPs, logs, screenshots, prompts, receipts or an untrusted host. Record only credential family, opaque identifier/fingerprint, account/realm, permission set, timestamps and receipt hashes—never the value.

## 1. Declare the rotation incident

- [ ] Bind exact verified/deployed SHA, environment and affected credential family.
- [ ] Record exposure source, earliest/latest possible exposure, affected account/realm and owner without copying the credential.
- [ ] Search approved evidence locations for secret-pattern exposure and preserve a redacted incident receipt.
- [ ] Set affected capability `NOT_CONFIGURED` or blocked. Keep withdrawal/transfer impossible.
- [ ] Decide whether immediate revocation is safer than overlap; document service and capital impact.

## 2. Inventory and least privilege

- [ ] Record old credential opaque fingerprint/ID and exact owner account.
- [ ] Enumerate exact required products, hosts, IP restrictions and permissions.
- [ ] Prove withdrawal and transfer-out permissions are absent.
- [ ] Separate read-only, signed validation, Margin, deployment, paging and build-signing credentials; never let one imply another.
- [ ] Record expiry/rotation policy and whether the provider supports staged overlap.

## 3. Prepare a replacement

- [ ] Obtain the separate I00 §20 authorization for the exact creation/materialization/deployment action class.
- [ ] Create the replacement only in the owner-controlled provider; never paste it into this file, Git, chat, shell argv, logs or screenshots.
- [ ] Bind the new opaque ID/fingerprint, exact permissions, network scope and provider readback.
- [ ] Store it only through the canonical server-side secret provider with least-privilege access and 0600/runtime-credential semantics where applicable.
- [ ] Keep old and new values out of environment examples and receipts.

## 4. Validate before cutover

- [ ] Reconcile target account/realm/host fingerprints.
- [ ] Validate read-only behavior under the private-read class when applicable.
- [ ] Validate signed test semantics only under the separate Spot/USD-M class when applicable.
- [ ] Verify no withdrawal, transfer, live-order, borrow/repay or vendor mutation is reachable beyond the exact class.
- [ ] Prove application logs, cockpit, traces and error paths redact all values.
- [ ] Capture distinct result and reconciliation receipts with only IDs/fingerprints/hashes.

## 5. Cut over and revoke

- [ ] Bind exact release/config revision and short authorization window.
- [ ] Materialize/switch only the named credential family; do not combine unrelated rotations.
- [ ] Read back the active opaque ID/fingerprint and capability state.
- [ ] Revoke/disable the old credential at the first safe point; verify it no longer authenticates.
- [ ] Remove old encrypted material/version only under provider retention law; do not destroy incident evidence.
- [ ] Reconcile private source, service, watchdog/paging and operator visibility as applicable.

## 6. Closeout

- [ ] Re-run secret-pattern scans over tracked source, release artifacts, logs, screenshots and prepared receipts.
- [ ] Record exact permissions and no-withdrawal proof for the new ID.
- [ ] Record rotation result, reconciliation, provider readback, revocation proof and unresolved exposure locations.
- [ ] Keep capability blocked if any target, permission, readback, receipt or old-key revocation is uncertain.
- [ ] Owner signs the closeout durably.

```text
credential_family: UNSET
old_opaque_id_or_fingerprint: UNSET
new_opaque_id_or_fingerprint: UNSET
permission_readback_sha256: UNSET
result_receipt: NOT_RUN
reconciliation_receipt: NOT_RUN
owner_signoff: UNSIGNED
```
