# R3-D-CLEAN-009 correction receipt

**Finding:** `R3-D-CLEAN-009`

**Severity:** High

**Outcome:** corrected inside the accepted verifier-packaging boundary

**Correction base:** `afed4d512b0ab46e0e0e81be1be472f9fb905a70`

**Correction-base tree:** `1b38958f29541d656b0c4a5a1f0d37077c4d670f`

**Governing verifier receipt:** `/Users/cosmosgeek/Desktop/role3-verify/ROLE3_VERIFICATION_RECEIPT.md`

## Reproduction

An isolated clean detached clone of the correction base, with dependencies
hydrated but none of the five protected root inputs copied into it, reproduced
both accepted failures:

- `bash ops/tests/i00/run-all.sh` exited `1`: `10` files passed, `2` failed,
  with `516` assertions. Both failures reached
  `make-complete-acceptance.mjs` and failed `ENOENT` on the first absent owner
  directive.
- `npm run test:i00:performance --
  --tested-sha=afed4d512b0ab46e0e0e81be1be472f9fb905a70` exited `1` before
  measurement with
  `PROTECTED_OWNER_DIRECTIVE_MISSING_OR_UNSAFE:I00_PRODUCT_ASSEMBLY_CONTROL_ROOM_AND_LIVE_BRINGUP.md`.
- The named additive regression failed before the resolver existed and passed
  only after clean-detached packaged resolution was implemented.

All five canonical root paths were absent before and after the reproduction.
The original worktree was not mutated.

## Immutable verifier package

The correction adds one non-extracting JSON package at
`test/i00/performance/protected-owner-directives.bundle.v1.json`:

- exact byte length: `130166`;
- whole-file SHA-256:
  `cd85e2aed5709650b3b39513a453f7a0e8374242fae452e02e75a1765e656f0a`;
- exact ordered member count: `5`;
- framed inventory SHA-256:
  `cb9534a94d5e9145cff76e16221ffdb4cec604f321abbc2d9c08fc0fee5d0bbe`;
- framed payload SHA-256:
  `ff4f46b07f5bfbe3da1adbf31595d40f0d7f84b1be2f3882da487bc857ca8abe`;
- exact limitations: `NOT_LIVE_OWNER_INPUT`, `VERIFIER_ONLY`, and
  `DOES_NOT_SATISFY_INTEGRATION_UNTRACKED_INPUT_LAW`.

The parser requires exact document/member keys and order, canonical pretty JSON
and base64, safe canonical basenames, regular-file kind, exact member sizes and
hashes, exact framed inventory/payload digests, the hard-pinned whole-file hash,
and a decoded-payload ceiling below `256 KiB`. There is no archive extraction,
path selection, or ambient-member lookup.

## Exact two-mode law

`INTEGRATION_UNTRACKED` remains unchanged in substance: it requires the exact
integration branch and the five physical root files as regular, nonsymlink,
hash-exact `??` inputs. It has no package fallback.

`CLEAN_DETACHED_PACKAGED` requires all of the following before package bytes
are admitted:

- repository root identity, detached `HEAD`, an explicit tested SHA equal to
  `HEAD`, and a real commit object with exact `HEAD^{tree}`;
- Git replacement objects disabled and local/system/global configuration
  isolated from the evidence calls;
- no assume-unchanged, skip-worktree, fsmonitor, untracked-cache, autocrlf, or
  file-mode ambiguity;
- no nonempty `.git/info/attributes`, and no effective attributes from the
  committed revision or the actual worktree, with system/global attribute
  sources disabled;
- zero porcelain status entries and no ambient canonical root directive;
- one exact `100644 blob` package entry read from the tested Git object, never
  from mutable worktree bytes.

The schema and semantic validator accept only coherent live or packaged source
tuples. Mixed row provenance, an attached packaged receipt, wrong SHA/tree,
wrong branch, and packaged provenance presented to the live complete-acceptance
validator fail closed.

Fixture generation may materialize the package members only below a distinct
temporary fixture root. It rejects the repository root, symlinks, non-regular
destinations, drifted existing bytes, and overwrites. Release assembly validates
the source package, copies it as a required verifier input, and validates the
staged bytes again.

## Hostile regression proof before commit

- named clean-detached package regression: exit `0`, `1/1`;
- full performance contract: exit `0`, `33/33`;
- clean-detached acceptance/topology contract: exit `0`, `10/10`;
- I00 scope-security: exit `0`, `7/7`;
- release/preflight: exit `0`, `119` assertions;
- delegation gates: exit `0`, `25` assertions;
- `git diff --check`: exit `0`.

The named regression rejects wrong tested identity, raw-tree `HEAD`, hidden
index flags, fsmonitor lies, committed and hidden worktree attributes,
`.git/info/attributes`, clean/smudge filters, dirt, ambient root directives,
wrong named branches, package tamper/removal/symlink mode, Git replacement
forgery, mixed provenance, and member inventory/path/kind/size/hash/base64
forgeries.

The clean committed aggregate and actual bounded performance measurement are
bound below to exact committed source. Final complete Phase 4 acceptance and
C2/S evidence remain separate and pending. No live/test order, private/signed exchange call,
deployment, push, merge, or current-main mutation was authorized or performed.

## Post-commit clean proof

The initial exact correction commit was
`11b42c52a0136b7e83ad8e9ce424e41bec114a71`. With empty Git status and all five
protected root paths still absent, `bash ops/tests/i00/run-all.sh` exited `0`:
`12` scripts passed, `0` failed, with `660` additive assertions. This receipt
update is the only amendment after that aggregate; the implementation and test
bytes exercised by it are unchanged.

The clean-detached performance measurement is recorded after this receipt-only
amendment so its tested SHA remains an independently reproducible Git object.
