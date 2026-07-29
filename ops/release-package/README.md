# Deterministic off-host release packaging

This cohort turns one exact, clean Git commit into a Linux release input and
then into a byte-reproducible, create-only ustar package. It does not install,
activate, deploy, restart, contact a provider, or grant deploy authority.

The build is deliberately split into three gates:

1. `prepare-linux-release.mjs` exports only the frozen Git tree, runs the
   repository-pinned Node 22/npm 10.9.8 build, installs Linux production
   dependencies from the lockfile, and rejects native addons unless they are
   ELF64 for the requested Linux architecture.
2. `build-release-package.mjs` owns that preparation step in production (a
   caller-supplied release root is forbidden), rejects links and special files,
   normalizes archive timestamps/owners/modes, and creates a tar, canonical
   manifest, and two-entry SHA-256 file.
3. `preflight-release-package.mjs` parses ustar itself and proves the exact
   SHA, archive bytes, embedded manifests, Linux native identity, and
   root-owned/service-group-readable target mode plan without extracting or
   mutating a target.

The package modes are directories and executable files `0550`, regular files
`0440`, owner `root`, and a named service group resolved later by the installer.
No member has world access or owner/group write access. The archive uses numeric
uid/gid zero; it does not bake a machine-specific numeric service gid.

Example (all output roots must already exist with mode `0700`):

The standalone preparation command is a diagnostic. Production packaging
repeats and owns that build rather than trusting the diagnostic directory.

```sh
node ops/release-package/bin/prepare-linux-release.mjs \
  --source-root /absolute/frozen-worktree \
  --input-sha FULL_LOWERCASE_SHA \
  --output-root /absolute/private-build-output \
  --target-arch x64 \
  --npm-cli /absolute/npm-10.9.8/bin/npm-cli.js

node ops/release-package/bin/build-release-package.mjs \
  --source-root /absolute/frozen-worktree \
  --input-sha FULL_LOWERCASE_SHA \
  --output-root /absolute/private-package-output \
  --target-arch x64 \
  --npm-cli /absolute/npm-10.9.8/bin/npm-cli.js \
  --service-user cosmos \
  --service-group cosmos

node ops/release-package/bin/preflight-release-package.mjs \
  --archive /absolute/private-package-output/cosmos-release-FULL_LOWERCASE_SHA.tar \
  --manifest /absolute/private-package-output/cosmos-release-FULL_LOWERCASE_SHA.manifest.json \
  --digest /absolute/private-package-output/cosmos-release-FULL_LOWERCASE_SHA.sha256 \
  --expected-input-sha FULL_LOWERCASE_SHA \
  --expected-service-user cosmos \
  --expected-service-group cosmos \
  --expected-target-root /opt/cosmos/releases/cosmos-release-FULL_LOWERCASE_SHA
```

Run the build twice into different private output roots and compare all three
digests before a package is eligible for the later install gate.
