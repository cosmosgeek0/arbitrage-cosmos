#!/usr/bin/env bash
set -euo pipefail

if [ "${1:-}" = "${VALIDATE_RELEASE_PATH:?}" ]; then
  "${REAL_NODE:?}" "$@"
  if [ ! -e "${MUTATION_FLAG:?}" ]; then
    if [ "${MUTATION_KIND:?}" = precreated-staging-symlink ]; then
      ln -s "${STAGING_TARGET:?}" "${STAGING_DESTINATION:?}.partial.$PPID"
    else
      "${REAL_NODE:?}" --input-type=module -e '
        import {readFileSync,writeFileSync} from "node:fs";
        import {resolve} from "node:path";
        import {pathToFileURL} from "node:url";
        const [releaseRoot,libPath,mutationKind]=process.argv.slice(1);
        const {typedTreeDigest}=await import(pathToFileURL(resolve(libPath)).href);
        if (mutationKind==="reserved-receipt") {
          writeFileSync(resolve(releaseRoot,"ops/i00/install-receipt.json"),"forged\n");
        } else if (mutationKind==="self-declared-cohort") {
          writeFileSync(resolve(releaseRoot,"ops/i00/post-validation-forgery"),"forged\n");
          const releasePath=resolve(releaseRoot,"release.json");
          const release=JSON.parse(readFileSync(releasePath,"utf8"));
          release.l15OpsProvenance.i00EnforcementTreeDigestSha256=
            typedTreeDigest(resolve(releaseRoot,"ops/i00"));
          writeFileSync(releasePath,`${JSON.stringify(release,null,2)}\n`);
        } else {
          process.exit(2);
        }
      ' "${MUTABLE_RELEASE:?}" "${TRUSTED_I00_LIB:?}" "$MUTATION_KIND"
    fi
    : > "$MUTATION_FLAG"
  fi
  exit 0
fi

exec "${REAL_NODE:?}" "$@"
