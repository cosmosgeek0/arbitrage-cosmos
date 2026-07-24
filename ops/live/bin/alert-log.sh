#!/bin/bash -p
# ops/live/bin/alert-log.sh — descriptor-bound structured local logging.
#
# Arguments: SEVERITY CODE MESSAGE
#
# The authorized release/rollback path opens and verifies these exact bytes
# before the effect and invokes them only through the retained descriptor.
# Output stays local (stderr -> journald under systemd). External paging is not
# an authorized donor capability; never embed webhook URLs or tokens here.
set -eu
unset BASH_ENV ENV CDPATH GLOBIGNORE
PATH=/usr/bin:/bin:/usr/sbin:/sbin
export PATH
readonly PATH
severity="${1:-unknown}"
code="${2:-UNSPECIFIED}"
message="${3:-}"
line="cosmos-alert severity=$severity code=$code message=$message"
printf '%s\n' "$line" >&2
exit 0
