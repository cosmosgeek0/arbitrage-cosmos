# AWS identity & secrets — templates and invariants

Templates only. **Nothing in this directory executes against AWS.** All AWS
mutations (roles, policies, secrets, instances) are separately
owner-authorized activation steps (launch file §10; proof spec §24.4).

## Invariants (§24.2)

- **EC2 instance profile, no static AWS credentials.** No access keys on
  disk, in env files, or in this repository — ever.
- **Least-privilege Secrets Manager access to one exact ARN**
  (`iam-secrets-policy.json.template`). No wildcard resources.
- **No public app/SSH ingress.** The security group has zero inbound rules;
  administration is SSM Session Manager; the only ingress path is the
  Cloudflare Tunnel's outbound connector (see `../cloudflare/README.md`).
- **Stable outbound identity** (Elastic IP or NAT with fixed EIP) where
  Binance IP allowlisting is used.
- **Secret values never transit this repository, chat, receipts, or logs.**
  §24.4: code and templates may reference the secret container; retrieving
  or printing values is out of scope here. If the real ARN/value must be
  supplied, only that external activation step stops — everything in
  `ops/` remains testable without it.

## What the app expects at runtime

The server reads its configuration from `/etc/cosmos/cosmos-app.env`
(template in `../env/`). The mechanism that materializes the Binance
credentials from Secrets Manager into the service environment is part of
the separately authorized live-activation work owned by the L spine —
deliberately NOT included in this artifact set, so that nothing in this
repository can fetch a real secret even by accident.

## References (proof spec §24.1)

- Secrets Manager JS retrieval, EC2 IAM roles, Elastic IP, security groups,
  CloudWatch agent, composite alarms, Session Manager, AWS Backup — see the
  links pinned in `LIVE_EXECUTION_REALISM_CONTROL_PROOF_12H.md` §24.1.
