# Q00-002 — launch-file identity mismatch is blocking

Status: `BLOCKED_EXTERNAL` pending director action.

## Evidence

- Required/locked SHA-256: `0cc192e348f51f7ab372b0245568bbf88f3ccbf23d3f0c581e853dd9f30cd3cc`.
- Observed SHA-256 from both `shasum -a 256` and the locked Git blob bytes: `26b1d5ce118982b4b3ba64b44b7fb3e88b0b7ded26a818a775a65bffaa0f2c06`.
- Observed Git blob: `587c1b83e8f9d32b9097d88df7fea40d9829b68e`, exactly matching `quant/DIRECTIVE_INPUTS.lock`.
- `git cat-file blob 587c1b83… | cmp DIRECTOR_Q_L_TWO_LANE_LAUNCH.md` exits 0.
- LF/CRLF normalization does not produce the required hash.

## Decision

Do not claim the SHA-256 gate passed and do not edit the frozen lock. Finish a bounded Q00 evidence/checkpoint commit, leave Q00 unaccepted, and wait for a director-owned corrected lock/acceptance record or authentic replacement bytes.

## Non-equivalence to the known L typo

The L-directive transposition is separately documented and accepted in lock line 5 using its matching MD5. It does not waive the launch file's own inconsistent lock row.

## Resume rule

After director correction, rerun exact input hashes, branch/HEAD/ancestry, protocol 22/22, scope guard and accumulated tests. Reuse this audit if its recorded source hashes are unchanged; do not redo completed inspection for appearance's sake.
