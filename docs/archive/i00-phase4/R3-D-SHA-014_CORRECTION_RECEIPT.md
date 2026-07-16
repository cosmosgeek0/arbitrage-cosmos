# R3-D-SHA-014 correction receipt

**Finding:** `R3-D-SHA-014`

**Severity:** `Critical`

**Disposition:** `FIXED`

**Correction base:** `003199ccd73672973bbe22513bac66d7a0a68a1d`

**Rejected candidate C:** `098f7b9449ab3b1c26bda19f51537bfea01d4c48`

**Role 3 receipt SHA-256:** `90613c8273e5c866603dbaa74106f2ff436c06e320a95a0cbdbc4c55c0d5ae1d`

## Exact reproduction

The verifier's two exact commands were rerun before correction. Both exited
`0` even though the tested SHA inside the evidence differed from rejected
candidate C:

```sh
node ops/i00/bin/verify-readback.mjs \
  --input /tmp/role3-sha-gate-098f7b9/raw-readback-tested-mismatch.json \
  --max-age-sec 60 --simulation-clock --now 2026-07-15T03:30:30Z

node ops/i00/bin/validate-receipt.mjs \
  --input /tmp/role3-sha-gate-098f7b9/receipt-target-tested-mismatch.json \
  --kind DEPLOYMENT \
  --evidence-root /tmp/role3-sha-gate-098f7b9/evidence
```

They printed `DEPLOYMENT_READBACK_VALID` and `RECEIPT_VALID`. A second hostile
fixture changed every mutually compared tested/deployed identity and every
affected evidence hash to one alternate full SHA. It also passed before the
correction, proving that another internal equality check would not establish
candidate identity.

The focused regressions were made red before source correction:

- `ops/tests/i00/test-probes-and-readback.sh` rejected the new missing-anchor
  assertion because the unanchored command unexpectedly passed;
- `ops/tests/i00/test-templates-and-schemas.sh` rejected the equivalent
  deployment-receipt assertion for the same reason.

## Smallest safe correction

- `verify-readback.mjs` requires a valid `--expected-sha`, binds `testedSha`
  and any non-null `deployedSha` to it, and returns those identities plus the
  observed release and timestamp in its validated JSON result.
- `validate-receipt.mjs` requires `--expected-sha` for `DEPLOYMENT` receipts
  only. It binds the receipt, release manifest, target readback, backup, and
  reconciliation chain to that independent candidate identity while retaining
  the existing hashed-file, semantic, chronology, and authorization checks.
- `release-switch.sh` passes the immutable release candidate SHA into the
  post-switch deployment-receipt validator. The owner activation request now
  shows the same required anchor for direct readback verification.
- Focused tests require the positive anchor and prove that a missing anchor, a
  mismatched tested SHA, and a completely self-consistent alternate SHA all
  fail closed.

No rollback identity rule, donor equality, disposition, Q ancestry, deployment
authority, money boundary, or protected owner input changed.

## Focused green proof

```sh
bash ops/tests/i00/test-probes-and-readback.sh
bash ops/tests/i00/test-templates-and-schemas.sh
```

Measured results:

- readback/probe coverage: exit `0`, `16/16`;
- receipt/template/schema coverage: exit `0`, `52/52`;
- verifier raw-readback command without the new independent anchor: exit `1`,
  `--expected-sha` required;
- the same raw readback anchored to exact C: exit `1`, tested-SHA mismatch;
- verifier deployment-receipt command without the anchor: exit `1`,
  `--expected-sha` required;
- the same receipt anchored to exact C: exit `1`, target-readback semantic
  mismatch;
- syntax and diff hygiene: exit `0`.

The wider release/preflight suite still reaches the separately accepted
pending `R3-D-CLEAN-009` boundary when its fixture tries to copy an intentionally
absent protected directive. That failure is not relabeled as SHA validation
proof and is not changed here.

This receipt is committed atomically with the correction. The final Phase 4
closure receipt will bind its exact commit SHA.
