// The origin is loopback-only: Cloudflare Tunnel is the sole ingress. `??`
// does not catch an empty string, and systemd's EnvironmentFile= turns a bare
// `HOST=` line into '' — which Node binds as `::`, every interface,
// dual-stack, silently (proven reachable from the LAN by V3; whitespace fails
// closed via ENOTFOUND, the empty string was the only silent case). Absent and
// empty mean loopback; anything else must be an explicitly recognised loopback
// literal. An unrecognised value FAILS CLOSED (throws at boot) rather than
// defaulting: silently substituting 127.0.0.1 for a value an operator
// deliberately set would hide a real misconfiguration, and defaulting is how
// this class of bug is born. A non-loopback bind must be a conscious,
// code-level decision — the runtime must never be laxer than the repo's own
// validator (ops/i00/bin/validate-config.mjs refuses anything but 127.0.0.1).
const LOOPBACK_BIND_HOSTS = new Set(['127.0.0.1', '::1', 'localhost']);

export function resolveBindHost(raw: string | undefined): string {
  if (raw === undefined) return '127.0.0.1';
  const value = raw.trim();
  if (value === '') return '127.0.0.1';
  if (!LOOPBACK_BIND_HOSTS.has(value)) {
    throw new Error('HOST_BIND_ADDRESS_NOT_LOOPBACK');
  }
  return value;
}

// Same discipline for PORT: Number('') === 0, and listen(0) silently binds a
// random ephemeral port. Unset/empty mean the default; anything else must be
// an integer in 1024-65535 (matching validate-config.mjs) or boot fails.
export function resolveBindPort(raw: string | undefined): number {
  if (raw === undefined) return 8080;
  const value = raw.trim();
  if (value === '') return 8080;
  if (!/^\d+$/.test(value)) throw new Error('PORT_INVALID');
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) {
    throw new Error('PORT_INVALID');
  }
  return port;
}
