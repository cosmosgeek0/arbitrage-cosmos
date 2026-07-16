# R3-D-BACKUP-008 independent fix-audit closure receipt

**Finding:** `R3-D-BACKUP-008`

**External audit SHA-256:** `31ef720ed5e031034415b0a1eeb32a509e7c05fbce01ec24c04a76c9b626ee28`

**Correction commit:** `bc39e9b989d37d12c77ed3854adca97a847f51de`

**Correction tree:** `5bae85adad0156dd0d5f6c0435b7e51e7987b8e7`

**Fix-coverage disposition:** `COVERED`

## Audit objection and boundary

The audit demonstrated that a same-inode staged database mutation could race
the old restore and yield exit `0` while published bytes disagreed with both
the manifest and restore report. Correction `bc39e9b9` binds every target-visible
database, evidence, and report object to the exact private-snapshot content
immediately before and after its atomic rename. Same-inode/same-size database,
evidence, and report mutations plus bounded sparse growth now fail before the
affected object is published.

This is exact per-object publication proof. It does not claim an atomic
multi-path snapshot or ongoing protection against a same-UID writer after an
object's completed publication proof. The amendment-bound correction receipt
remains byte-identical to the object pinned by
`ops/i00/l15-amendment-contract.json`; this independent disposition is separate
so audit evidence cannot silently change the accepted runtime contract.

## Post-commit evidence

| Command | Result |
| --- | --- |
| `bash ops/tests/i00/test-r3-d-backup-008.sh` | exit `0`; `109/109` assertions |
| `bash ops/tests/i00/test-donor-contract.sh` | exit `0`; `25/25` assertions |
| `bash ops/tests/run-all.sh` | exit `0`; `12/12` scripts; exact footer sum `384` |
| `bash ops/tests/i00/run-all.sh` | exit `0`; `12/12` scripts; `725` additive assertions |
| `npm test` | exit `0`; typecheck, build, deterministic, Product Assurance, and acceptance-contract gates pass |

The first `npm run test:all` run stopped only at unrelated stale generated
machine-evidence source anchors. After deterministic report regeneration, the
same full gate exited `0`, including I00 proof `47/47`, commands `28/28`,
Product Integration `111/111`, Product Control `102/102`, System Integration
`401/401`, and live-edge `1618/1618`.

No source, runtime, test, owner directive, amendment contract, live/test order,
private or signed exchange path, deployment, push, merge, or external mutation
is introduced by this independent audit receipt.
