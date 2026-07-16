# S3 formal packet immutable receipt

This receipt seals the collision-free amendment §4 packet. It is immutable
after its containing Git commit; any correction requires a new sibling receipt.

```text
schema: ip-assurance.s3.formal-receipt.v1
terminal_status: BLOCKED_NO_NETWORK_BOUNDARY_VIOLATED
artifact_semantics: CLEAN
artifact_build: COMPLETE
artifact_runtime_authority: SUPPORTING_EVIDENCE_ONLY
runtime_claim_closure: NOT_PERMITTED
branch: ip-assur-formal-20260713
base_commit: 9785c93102b00389847b77c2f9348c06abc4344b
implementation_commit: bb2581a4f6ef950dbc4b321a3e9d09778fa46e00
implementation_tree: 4a8e525313072dc790e397b1b4d892a064473d40
binding_ip_assurance_sha256: 5f6d4b3b70e384f6123e9ccc01891faf04aef9da7f7cfd1e0c63be5c3ba68803
binding_amendment_sha256: 0f42ded02e9f751b9f6c077579378d83131faa8ef23fc4f3286616008259f86e
dedup_matrix_sha256: 22686d2cd1c54bbc39af56399298a0ed9563bbc8643ad4f0e498718de83cb2cd
protected_parent_i00_sha256: 9d7a36da6a2e6e7b3e905c73161b5e998a2f92416dd557e498ade3e73d5e5ef5
model_manifest_sha256: ace6777a0c71cdd0f08efbb7eb012027a4812986791a4581e9fed85077af4f04
sealed_date: 2026-07-13
```

## Model bundles

| Model | Bundle SHA-256 |
| --- | --- |
| `S3-M01-AMBIGUOUS-MUTATION` | `b402150c2b791c53c8ed00675c587bc3910efdc29f851e7f70e63563e070f01d` |
| `S3-M02-TWO-LEG-RECOVERY` | `ea509199bb9db54c7857e88520d36aac7a00a3ff2331d9db8c44a44e70220b28` |
| `S3-M03-EXECUTION-FENCING` | `b6b07edef27284eae28432fcff34544bc502645c2c39ae1d3bb242aa868e2f6e` |
| `S3-M04-REPAIR-CAMPAIGN` | `1ef82b7e3bd460310484e6fdc3cff3e057f3cef89682cda12fe2233d0d19457c` |
| `S3-M05-BORROW-LIABILITY` | `f794e6c70b3ebd5232e28bdc0c1ba19abaed9cb802d9e9725aad22161b7edf79` |
| `S3-M06-HALT-RISK-REDUCTION` | `381fbadf60f865db29df624dfbb1943953e58ab9a583c19dd5b5d9ea4c7d5702` |
| `S3-M07-CANCELLATION-BOUNDARY` | `3a0008bf988f3a7e89ad22ae38c5a8bc4a8b44e18c5315d2583dcd6cfb7ee85c` |

## Evidence

- Seven canonical models passed exhaustive exploration within their declared
  bounds: 1,323 reachable states, 1,631 transitions, 505 terminal states, zero
  non-terminal deadlocks, and 43 model-property checks covering all 16 §4.3
  properties plus two model-specific strengthening invariants.
- All seven hostile profiles failed as required. Their 13 failed property
  traces are exactly authenticated, triaged, and non-promotable.
- Conformance remains fail-closed at `MISMATCH` for two models and `UNKNOWN`
  for five; zero counterexamples are eligible for the runtime corpus.
- The deterministic focused command passed twice on the final source bytes:
  `PASS 43 / FAIL 0 / SKIP 0`.
- All 26 packet `.mjs` files passed syntax checks; all three JSON schemas
  parsed; the 47-file implementation path set passed whitespace, scope,
  ambient authority, executable-payload, and secret-pattern checks.
- Seven TLA+ modules and seven TLC configurations passed independent manual
  source/assignment/config alignment review. They were not executed because
  TLC, PlusCal, Apalache, and a usable JVM are not configured.
- Root `npm test` was attempted and failed before packet discovery with exit
  127: `tsc: command not found`. No install was authorized or performed.

## Boundary disposition

One delegated read-only research task invoked a web lookup despite the explicit
no-network boundary. Its result was discarded and was not written, cited, or
used in the packet. No secret, package, repository state, external system, or
money path was mutated by that lookup. The access itself is irreversible and
prevents a truthful `FORMAL_PRESTAGE_READY` claim; therefore the exact terminal
status is `BLOCKED_NO_NETWORK_BOUNDARY_VIOLATED`.

Only these authorized roots are present in the implementation commit and this
receipt seal:

- `fixtures/productAssurance/systemic/formal/**`
- `test/productAssurance/systemic/formal/**`

The protected parent I00 input remained untracked and unstaged. No production,
shared generated, shared receipt, Q/L/other-IP, package, lockfile, root artifact,
merge, push, or `current-main` operation occurred.
