# Clean Clone Gate — D-LAUNCH-62

Status: `PENDING_EXACT_C2`

Actor: `ACCOUNT_A_BUILDER`; independent acceptance authority: `false`.

## Sustained old-C defect

The durable clean-clone receipt for old C records `npm ci` exit `0`, `npm test` exit `0`, and `npm run test:all` exit `1` (`5889/5894`; I00 proof `42/47`). That result rejects old C for handoff.

## Implemented C2 correction

- Sealed machine evidence contains tracked-byte proof only.
- Moving refs and optional external Git objects are not written into sealed bytes; ambient provenance is a separate `VERIFIED`/`FAILED`/`UNKNOWN` diagnostic.
- Report parity compares all six generated artifacts as exact bytes and creates no synthetic `current-main` ref.
- Product Assurance Git subprocesses use the bounded shared Git-evidence runner.
- Root `npm test` now mounts `test:i00:proof:built`, so the I00 security scanner cannot remain red behind a green root gate.

Focused source proof after the correction: I00 proof `47/47`; acceptance contract `44/44`, including a sole-branch refs-absent exact-byte parity regression.

## Remaining exact-C2 gate

After the final source commit is frozen as C2, create a fresh `--no-hardlinks --single-branch --branch truth-campaign-20260716` clone from a local one-branch transport, detach exact C2, and run `npm ci`, `npm test`, and `npm run test:all`. Record real exits/counts and final clean status. Account A records builder evidence only and does not self-issue the independent `CLEAN_CLONE_ACCEPTED` token.
