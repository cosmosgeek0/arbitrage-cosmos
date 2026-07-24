#!/bin/bash -p
# Closed-environment launcher for the privileged, directly invoked I00 gates.
set -euo pipefail
umask 077

unset BASH_ENV ENV CDPATH GLOBIGNORE NODE_OPTIONS NODE_PATH \
  NODE_REPL_EXTERNAL_MODULE NODE_EXTRA_CA_CERTS NODE_V8_COVERAGE NODE_ICU_DATA \
  NODE_DEBUG NODE_DEBUG_NATIVE NODE_REDIRECT_WARNINGS NODE_COMPILE_CACHE \
  NODE_DISABLE_COMPILE_CACHE NODE_PRESERVE_SYMLINKS NODE_PRESERVE_SYMLINKS_MAIN \
  NODE_TLS_REJECT_UNAUTHORIZED NODE_USE_ENV_PROXY NODE_USE_SYSTEM_CA \
  LD_PRELOAD LD_LIBRARY_PATH LD_AUDIT LD_PROFILE LD_ORIGIN_PATH \
  DYLD_INSERT_LIBRARIES DYLD_LIBRARY_PATH DYLD_FRAMEWORK_PATH \
  OPENSSL_CONF OPENSSL_MODULES SSL_CERT_FILE SSL_CERT_DIR \
  HTTP_PROXY HTTPS_PROXY NO_PROXY ALL_PROXY \
  http_proxy https_proxy no_proxy all_proxy
SAFE_PATH=/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin
PATH="$SAFE_PATH"
export PATH

case "$0" in
  /*) _I00_ENTRY_DIR="${0%/*}" ;;
  */*) _I00_ENTRY_DIR="$PWD/${0%/*}" ;;
  *) printf 'I00_OPS_BLOCKED: fixed Node launcher requires an explicit script path\n' >&2; exit 1 ;;
esac
[ -n "$_I00_ENTRY_DIR" ] || _I00_ENTRY_DIR=/
SCRIPT_DIR="$(cd -P -- "$_I00_ENTRY_DIR" && builtin pwd -P)" \
  || { printf 'I00_OPS_BLOCKED: fixed Node launcher directory is unavailable\n' >&2; exit 1; }
unset _I00_ENTRY_DIR

[ "$#" -gt 0 ] \
  || { printf 'I00_OPS_BLOCKED: one closed I00 gate name is required\n' >&2; exit 1; }
ATTEST_TREE_ONLY=0
if [ "$1" = --attest-tree ]; then
  [ "$#" -eq 1 ] \
    || { printf 'I00_OPS_BLOCKED: tree attestation accepts no gate arguments\n' >&2; exit 1; }
  ATTEST_TREE_ONLY=1
  GATE=inspect-executable.mjs
  shift
else
  GATE="$1"
  shift
fi
case "$GATE" in
  app-entrypoint.mjs|assemble-release.mjs|create-private-temp.mjs|\
  create-simulation-root.mjs|exposure-from-app.mjs|first-host-readback.mjs|\
  inspect-app-unit.mjs|inspect-backup-source.mjs|inspect-executable.mjs|\
  preflight.mjs|probe.mjs|produce-deployment-action-preview.mjs|\
  produce-deployment-risk-version.mjs|publish-install-receipt.mjs|\
  publish-install-tree.mjs|record-authorized-action-outcome.mjs|\
  record-release-switch-receipt.mjs|sanitize-donor-env.mjs|\
  seal-simulation-root.mjs|secrets-provider.mjs|validate-authorization.mjs|\
  validate-config.mjs|validate-receipt.mjs|validate-release.mjs|\
  validate-simulation-env.mjs|validate-simulation-path.mjs|\
  validate-simulation-root.mjs|verify-build-attestation.mjs|\
  verify-cloudflare-readback.mjs|verify-donor-root.mjs|verify-donor.mjs|\
  verify-readback.mjs|verify-simulation-command.mjs|\
  verify-sqlite-version.mjs) ;;
  *) printf 'I00_OPS_BLOCKED: gate is outside the fixed Node launcher allowlist\n' >&2; exit 1 ;;
esac

select_privileged_node() {
  local bootstrap candidate path metadata owner mode trusted
  [ "$EUID" -eq 0 ] \
    || { printf 'I00_OPS_BLOCKED: fixed Node launcher requires root\n' >&2; return 1; }
  for bootstrap in /usr/bin/stat /usr/bin/env; do
    [ -f "$bootstrap" ] && [ ! -L "$bootstrap" ] && [ -x "$bootstrap" ] \
      && [ -O "$bootstrap" ] \
      || { printf 'I00_OPS_BLOCKED: fixed root-owned system bootstrap is unavailable\n' >&2; return 1; }
  done
  for candidate in /usr/bin/node; do
    [ -f "$candidate" ] && [ ! -L "$candidate" ] && [ -x "$candidate" ] || continue
    trusted=1
    for path in / /usr /usr/bin /usr/bin/stat /usr/bin/env "$candidate"; do
      metadata="$(/usr/bin/stat -c '%u:%a' -- "$path" 2>/dev/null)" \
        || { trusted=0; break; }
      owner="${metadata%%:*}"
      mode="${metadata#*:}"
      case "$owner:$mode" in
        0:[0-7][0-7][0-7]|0:[0-7][0-7][0-7][0-7]) ;;
        *) trusted=0; break ;;
      esac
      [ $((8#$mode & 8#22)) -eq 0 ] || { trusted=0; break; }
    done
    [ "$trusted" = 1 ] || continue
    printf '%s\n' "$candidate"
    return 0
  done
  return 1
}

NODE_PATH="$(select_privileged_node)" || NODE_PATH=""
[ -n "$NODE_PATH" ] \
  || { printf 'I00_OPS_BLOCKED: fixed root-owned Node runtime is unavailable\n' >&2; exit 1; }

LAUNCHER_NAME="${0##*/}"
[ "$LAUNCHER_NAME" = run-fixed-node-gate.sh ] \
  || { printf 'I00_OPS_BLOCKED: fixed Node launcher name is invalid\n' >&2; exit 1; }
LAUNCHER_PATH="$SCRIPT_DIR/$LAUNCHER_NAME"
I00_ROOT="$(cd -P -- "$SCRIPT_DIR/.." && builtin pwd -P)" \
  || { printf 'I00_OPS_BLOCKED: fixed I00 tree is unavailable\n' >&2; exit 1; }

require_bootstrap_path() {
  local target="$1" kind="$2" metadata owner mode
  case "$kind" in
    file) [ -f "$target" ] && [ ! -L "$target" ] && [ -O "$target" ] ;;
    directory) [ -d "$target" ] && [ ! -L "$target" ] && [ -O "$target" ] ;;
    *) return 1 ;;
  esac || return 1
  metadata="$(/usr/bin/stat -c '%u:%a' -- "$target" 2>/dev/null)" || return 1
  owner="${metadata%%:*}"
  mode="${metadata#*:}"
  case "$owner:$mode" in
    0:[0-7][0-7][0-7]|0:[0-7][0-7][0-7][0-7]) ;;
    *) return 1 ;;
  esac
  [ $((8#$mode & 8#7022)) -eq 0 ]
}

for trusted_directory in "$I00_ROOT" "$SCRIPT_DIR"; do
  require_bootstrap_path "$trusted_directory" directory \
    || { printf 'I00_OPS_BLOCKED: I00 launcher directory is not root-owned and immutable\n' >&2; exit 1; }
done
for trusted_file in "$LAUNCHER_PATH" "$SCRIPT_DIR/$GATE"; do
  require_bootstrap_path "$trusted_file" file \
    || { printf 'I00_OPS_BLOCKED: I00 launcher file is not root-owned and immutable\n' >&2; exit 1; }
done

ancestor="$I00_ROOT"
while :; do
  metadata="$(/usr/bin/stat -c '%u:%a' -- "$ancestor" 2>/dev/null)" \
    || { printf 'I00_OPS_BLOCKED: I00 launcher ancestor is unavailable\n' >&2; exit 1; }
  owner="${metadata%%:*}"
  mode="${metadata#*:}"
  case "$owner:$mode" in
    0:[0-7][0-7][0-7]|0:[0-7][0-7][0-7][0-7]) ;;
    *) printf 'I00_OPS_BLOCKED: I00 launcher ancestor owner or mode is invalid\n' >&2; exit 1 ;;
  esac
  if [ $((8#$mode & 8#22)) -ne 0 ] && [ $((8#$mode & 8#1000)) -eq 0 ]; then
    printf 'I00_OPS_BLOCKED: I00 launcher ancestor is replaceable\n' >&2
    exit 1
  fi
  [ "$ancestor" != / ] || break
  ancestor="${ancestor%/*}"
  [ -n "$ancestor" ] || ancestor=/
done

trusted_executable_snapshot() {
  "$NODE_PATH" -e '
    const { createHash } = require("crypto");
    const fs = require("fs");
    const input = process.argv[1];
    const stat = fs.lstatSync(input, { bigint: true });
    const mode = stat.mode & 0o7777n;
    if (!stat.isFile() || stat.isSymbolicLink()
        || fs.realpathSync.native(input) !== input || stat.uid !== 0n
        || (mode & 0o7022n) !== 0n || (mode & 0o111n) === 0n) process.exit(1);
    process.stdout.write(JSON.stringify({
      path: input,
      sha256: createHash("sha256").update(fs.readFileSync(input)).digest("hex"),
      device: stat.dev.toString(),
      inode: stat.ino.toString(),
      mode: stat.mode.toString(8),
      links: stat.nlink.toString(),
      size: stat.size.toString(),
      mtimeNs: stat.mtimeNs.toString(),
      ctimeNs: stat.ctimeNs.toString(),
    }));
  ' "$1"
}

trusted_i00_tree_snapshot() {
  "$NODE_PATH" -e '
    const { createHash } = require("crypto");
    const fs = require("fs");
    const path = require("path");
    const root = process.argv[1];
    if (fs.realpathSync.native(root) !== root) process.exit(1);
    const rows = [];
    let files = 0;
    let bytes = 0;
    const visit = (entry, relative) => {
      const stat = fs.lstatSync(entry, { bigint: true });
      const mode = stat.mode & 0o7777n;
      if (stat.isSymbolicLink() || stat.uid !== 0n || (mode & 0o7022n) !== 0n) {
        process.exit(1);
      }
      const row = {
        path: relative,
        device: stat.dev.toString(),
        inode: stat.ino.toString(),
        mode: stat.mode.toString(8),
        links: stat.nlink.toString(),
        size: stat.size.toString(),
        mtimeNs: stat.mtimeNs.toString(),
        ctimeNs: stat.ctimeNs.toString(),
      };
      if (stat.isDirectory()) {
        row.kind = "directory";
        rows.push(row);
        for (const name of fs.readdirSync(entry).sort()) {
          visit(path.join(entry, name), relative ? `${relative}/${name}` : name);
        }
      } else if (stat.isFile()) {
        files += 1;
        bytes += Number(stat.size);
        if (files > 512 || bytes > 64 * 1024 * 1024) process.exit(1);
        row.kind = "file";
        row.sha256 = createHash("sha256").update(fs.readFileSync(entry)).digest("hex");
        rows.push(row);
      } else {
        process.exit(1);
      }
    };
    visit(root, "");
    process.stdout.write(JSON.stringify(rows));
  ' "$I00_ROOT"
}

NODE_INITIAL="$(trusted_executable_snapshot "$NODE_PATH")" \
  || { printf 'I00_OPS_BLOCKED: fixed Node runtime is not trusted\n' >&2; exit 1; }
ENV_INITIAL="$(trusted_executable_snapshot /usr/bin/env)" \
  || { printf 'I00_OPS_BLOCKED: fixed environment launcher is not trusted\n' >&2; exit 1; }
I00_TREE_INITIAL="$(trusted_i00_tree_snapshot)" \
  || { printf 'I00_OPS_BLOCKED: fixed I00 gate tree is not trusted\n' >&2; exit 1; }

[ "$(trusted_executable_snapshot "$NODE_PATH")" = "$NODE_INITIAL" ] \
  || { printf 'I00_OPS_BLOCKED: fixed Node runtime identity changed\n' >&2; exit 1; }
[ "$(trusted_executable_snapshot /usr/bin/env)" = "$ENV_INITIAL" ] \
  || { printf 'I00_OPS_BLOCKED: fixed environment launcher identity changed\n' >&2; exit 1; }
[ "$(trusted_i00_tree_snapshot)" = "$I00_TREE_INITIAL" ] \
  || { printf 'I00_OPS_BLOCKED: fixed I00 gate tree identity changed\n' >&2; exit 1; }

if [ "$ATTEST_TREE_ONLY" = 1 ]; then
  "$NODE_PATH" -e '
    const { createHash } = require("crypto");
    process.stdout.write(createHash("sha256").update(process.argv[1]).digest("hex"));
  ' "$I00_TREE_INITIAL"
  exit 0
fi

exec /usr/bin/env -i \
  PATH="$SAFE_PATH" HOME=/ TMPDIR=/tmp LANG=C LC_ALL=C TZ=UTC \
  "$NODE_PATH" "$SCRIPT_DIR/$GATE" "$@"
