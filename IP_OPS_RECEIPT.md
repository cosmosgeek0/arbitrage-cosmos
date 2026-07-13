# IP-OPS receipt

## Acceptance

Status: `OPS_READY`

This receipt accepts an artifact-only operations packet. It does not claim a
deployment, configured vendor boundary, materialized real secret, running
service, capacity proof, production restore, or trading authority.

## Director assignment and branch identity

- Branch: `ip-ops-20260713`
- Packet base / pre-work HEAD: `420cc83e5512d54ca1b1c064c1041d89b23914a0`
- Work commit: `ea32285237c1cee29e4b9efe0de0dbae6f5ed810`
- Work tree: `dc252802a4feebe8675d81cdb59d786bb9219cb9`
- D-LAUNCH-6 proof: `c418bbe7026bdec843b1d74424f5de1fb1265866`
  updates `QL_PARALLEL_DAG.md`; its parent is the packet base. The proof commit
  establishes the IP-OPS assignment but is not falsely claimed as an ancestor
  of this packet branch.
- Closure commit: the commit containing this receipt; its required parent is
  the exact work commit above. This avoids a circular self-hash.

## Protected director inputs

The two root directives stayed untracked, unstaged, and byte-stable.

- `IP_OPS.md`: `2af8348906f9306765a0d0d57f21b01349767e6115f04f43ce00fa6328f1b779`
- `I00_PRODUCT_ASSEMBLY_CONTROL_ROOM_AND_LIVE_BRINGUP.md`:
  `9d7a36da6a2e6e7b3e905c73161b5e998a2f92416dd557e498ade3e73d5e5ef5`

## Exact donor proof

- Branch label: `l15-deploy-infra-20260712`
- Accepted commit: `2cec412927fa2f64f05a0b2774b18e45f8ce4fa5`
- Implementation commit: `9a82d4715c73ebe4156638c2bf5e8a2c02373bbf`
- Donor base: `0f2bb884daf5b67981ea04f38298d89c1a980de7`
- `ops/live` Git tree: `584163858a0333cb1ccb9eff756e91a851b1cb71`
- `ops/tests` Git tree: `f3348a74ef22d9ca2faee431ea8cc5df63f552af`
- I00 donor contract SHA-256:
  `078cc2a3d8bc79026f1de6985284856794e53ba34ffd7fda5d1140e46e31a1b3`
- Critical donor file hashes were verified against accepted Git before every
  fake-service delegation. Installed bundles embed an immutable copy and never
  infer a sibling deployment owner.
- `ops/live/**` and donor tests were consumed read-only from Git; no accepted
  donor path was edited or duplicated as a competing owner.

## Work packet inventory

- Files: 69
- Insertions: 4,279
- Path-set SHA-256 (sorted newline-delimited paths):
  `cb53fcd1f9f9917fcdc4d0c208dfa235a8b60969558e5bf87d35a4efe3ebdc11`
- `ops/i00` tree: `85e5feb1b4f07893221a8c8477280229b299d1a9`
- `ops/tests/i00` tree: `e38d4f3409844b256f0f835b04d35581e69b5655`
- `ops/templates/i00` tree: `820ea9d5e36ffe0c7c0fbe46676576c463ac16ab`
- `ops/docs/i00` tree: `194900c2a585fcc9251a908135bf9adb1b56ed43`
- `IP_OPS_STATE.md` SHA-256:
  `e1b6c3f6d07437ec4e76dc89e8ec61b7a794933d98c1abffe288243819d68ad6`
- `IP_OPS_ACTIVATION_REQUEST.md` SHA-256:
  `c9a1131b9d144504a1a6bd81e31503e6b53d293201472a105ae8471ee154ca1b`

All changed paths are confined to IP_OPS §3. The protected prompt files are the
only intentional untracked paths after closure.

## Verification receipt

Every command below completed with real exit code 0 after the final code change.

| Command | Result |
|---|---|
| `bash ops/tests/i00/run-all.sh` | 8/8 additive suites, 304 assertions; embedded read-only donor 11/11 suites, 347 assertions; combined 651 assertions, zero failures |
| `npm test` | exit 0; log SHA-256 `caf92596af62e4a4d1e1af5493190a0e7df3f3fe66cd22db6ef20b57fc2e0275` |
| `npm run test:all` | exit 0; typecheck and server/web builds passed; final systemIntegration group 180/180; log SHA-256 `a7ab0accc5e601c6d03a843b9ff97d5ce5ab5cd889837d8927b02589d8032966` |

Measured `test:all` groups include Basis 107/107, Volume 124/124,
financial-safety 59/59, storage/config/AWS 29/29, focused Node TAP 50+7+1,
application gates 72/72, intelligence 152, intelligence runtime 394, capital
433, foundation/risk/replay/scenario groups with zero reported failures, and
system integration 180/180. No count was inferred from source lines.

## Current reviewed fixture hashes

- app systemd drop-in: `ebe470bd952270af90482f5134d5fae1df79051a50c9fae4dac79fe5b330713f`
- secret-provider unit: `62167777d85f1c798e823b4e2df2a7ef57157492ff48ade1de003fd0c09037b3`
- secret-provider config: `4702c4b0a7d21809dbe28550eb6c53ebbb621cde5cff9ae9be54b701d83fdf23`
- exact Secrets IAM: `0923c6dbf5c0559d8b8ed439989d831c0b56ae8d75e099982a775c8bdbbf9476`
- customer-KMS IAM: `78b724f4db2526e125ea46d13b3a362699c8131ae8b65bbc0be801b36c792357`
- CloudWatch agent: `32424c3a4cf9f865fcff40d62646b5fd451fab7cb59fe6cedc4d15d08f1ee926`
- CloudWatch alarms: `017eb188a37d053dbd68561afda3ddb8b9312794953c2fa039a6cc29713715ea`
- Cloudflare overlay: `35524166849b1ef110f27dfc6573bb44b4dfff8e547e665a03a829fd3f2f9c3c`
- backup/restore adapter proof: `d1a8686b9c251da2944e002c9600194f561ed9aae5aa869693c2ae153c85c6f7`
- probe/boundary proof: `800dd4ba7bf77cd49488565cc7fa5a7d43c88c7f6728359ecc8263fc702deb76`

## Safety and limitations

- Production build bytes require an externally trusted Ed25519 builder
  attestation; simulation releases are explicitly unattested and rejected by
  production validation.
- Simulation accepts only exact inert built-in fixture programs under a marked
  private OS temp root. Hooks are sealed and verified before delegation.
- Real mutation authorization binds the trusted key, release/manifest/path,
  sanitized donor environment digest, account/host/environment, exact effect,
  and result/reconciliation receipt targets.
- Deployment/rollback success receipts require hashed semantic evidence; the
  wrappers cannot claim success without validation.
- Local SQLite `3.51.0` is deliberately blocked for production. A fixed target
  build and exact host readback are external inputs.
- Production restore is not implemented by I00 and remains blocked until the
  accepted donor owner supplies the required atomic staged-swap amendment.
- Capacity/soak, Q runtime, real vendor configuration, target service readback,
  and the parent §24 canary envelope remain honest external/owner gates.

## External-action attestation

IP-OPS performed zero AWS, EC2, Cloudflare, DNS, Secrets Manager, systemd,
remote-host, or production-service actions. It used Git reads, local builds,
network-free tests, exact inert fake services, loopback probes, and temporary
directories only. No push was performed.
