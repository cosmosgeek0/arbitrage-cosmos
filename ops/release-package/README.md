# Deterministic off-host release packaging

This cohort builds and packages one exact clean Git commit without installing,
activating, deploying, restarting, contacting a provider, or granting deploy
authority.

There are two deliberately distinct package contracts:

- `cosmos.release-package.v1` is the accepted preliminary source-build package.
  Its `cosmos.release-input.v1` metadata and normalized `0550`/`0440` modes are
  `PREP_ONLY`; it is not an I00 immutable release and must not be renamed into
  one.
- `cosmos.i00-release-package.v1` wraps one already assembled `i00-<sha>`
  release. It preserves every inner byte and POSIX mode, validates the exact
  trusted I00 cohort before packaging, and privately reconstructs and validates
  it again during preflight.

The final package flow is:

1. `prepare-linux-release.mjs` exports the frozen tree, runs the pinned Node
   22/npm 10.9.8 build, prunes to link-free Linux production dependencies, and
   rejects native addons that are not ELF64 for the requested architecture.
2. The unchanged `ops/i00/bin/assemble-release.mjs` consumes that one dependency
   tree plus exact same-SHA acceptance evidence and Ed25519 attestation inputs.
3. `build-i00-release-package.mjs` requires the resulting `i00-<sha>` root to
   pass the external trusted `validate-release.mjs --require-exact-cohort`,
   then creates a deterministic ustar, canonical manifest, and two-entry
   SHA-256 file without rewriting I00 metadata or modes.
4. `preflight-i00-release-package.mjs` parses the archive, reconstructs it only
   beneath an owner-private scratch directory, reruns the external trusted
   validator, proves exact byte/mode/member parity, and removes the scratch
   tree.

The I00 package archive uses numeric uid/gid zero as transport metadata, while
preserving the assembled release modes recorded by the inner artifact manifest.
Ownership assignment and immutable publication remain downstream I00 installer
work. Every outer manifest remains `NOT_INSTALLED` with deploy authority
`NONE`.

Example (all output roots must already exist with mode `0700`):

```sh
node ops/release-package/bin/prepare-linux-release.mjs \
  --source-root /absolute/frozen-worktree \
  --input-sha FULL_LOWERCASE_SHA \
  --output-root /absolute/private-build-output \
  --target-arch x64 \
  --npm-cli /absolute/npm-10.9.8/bin/npm-cli.js

node ops/i00/bin/assemble-release.mjs \
  --source-root /absolute/frozen-worktree \
  --runtime-deps /absolute/private-build-output/release-input-FULL_LOWERCASE_SHA/node_modules \
  --output-root /absolute/private-i00-output \
  --tested-sha FULL_LOWERCASE_SHA \
  --tested-receipt /absolute/complete-local-acceptance.json \
  --built-at-utc YYYY-MM-DDTHH:MM:SSZ \
  --config-revision EXACT_CONFIG_REVISION \
  --model-revision EXACT_MODEL_REVISION \
  --build-attestation /absolute/build-attestation.json \
  --build-attestation-signature /absolute/build-attestation.sig \
  --build-attestation-public-key /absolute/build-attestation-public-key.pem

node ops/release-package/bin/build-i00-release-package.mjs \
  --source-root /absolute/frozen-worktree \
  --input-sha FULL_LOWERCASE_SHA \
  --release-root /absolute/private-i00-output/i00-FULL_LOWERCASE_SHA \
  --output-root /absolute/private-package-output \
  --target-arch x64 \
  --service-user cosmos \
  --service-group cosmos \
  --trusted-build-public-key /absolute/external-trusted-build-public-key.pem

node ops/release-package/bin/preflight-i00-release-package.mjs \
  --archive /absolute/private-package-output/i00-FULL_LOWERCASE_SHA.tar \
  --manifest /absolute/private-package-output/i00-FULL_LOWERCASE_SHA.manifest.json \
  --digest /absolute/private-package-output/i00-FULL_LOWERCASE_SHA.sha256 \
  --expected-input-sha FULL_LOWERCASE_SHA \
  --expected-target-arch x64 \
  --expected-service-user cosmos \
  --expected-service-group cosmos \
  --trusted-build-public-key /absolute/external-trusted-build-public-key.pem
```

Run the I00 package build twice into different private output roots and compare
all three outputs before handing one frozen triplet to the later install gate.
Production assembly requires fresh evidence and attestation for the final
combined SHA; historical or preliminary-package evidence cannot be reused.
