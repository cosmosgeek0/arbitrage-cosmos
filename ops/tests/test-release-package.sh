#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
node ops/tests/release-package-hostile.mjs
