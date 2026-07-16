#!/usr/bin/env bash
# ops/live/bin/alert-log.sh — default ALERT_CMD: structured local logging.
#
# Arguments: SEVERITY CODE MESSAGE
#
# This default keeps every alert on the box (stderr -> journald under
# systemd; plus `logger` when available). To route alerts externally,
# point ALERT_CMD at an operator-provided script that forwards these three
# arguments to your paging/webhook system. Never embed webhook URLs or
# tokens in scripts or units — keep them in /etc/cosmos/*.env (0600) as
# documented placeholders.
set -u
severity="${1:-unknown}"
code="${2:-UNSPECIFIED}"
message="${3:-}"
line="cosmos-alert severity=$severity code=$code message=$message"
printf '%s\n' "$line" >&2
if command -v logger >/dev/null 2>&1; then
  logger -t cosmos-alert -- "$line" 2>/dev/null || true
fi
exit 0
