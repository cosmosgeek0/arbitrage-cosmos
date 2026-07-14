# Cloudflare operator boundary — configuration templates

Templates only. **Nothing in this directory touches Cloudflare.** Creating
the tunnel, DNS route, and Access application is a separately
owner-authorized activation step (launch file §10; proof spec §24).

## Shape (§24.2)

```text
operator browser
  -> Cloudflare Access (identity, operator-only policy)
  -> Cloudflare Tunnel (private hostname, outbound-only connector)
  -> cloudflared.service on the instance
  -> http://127.0.0.1:8080  (app binds loopback ONLY)
       └─ origin re-validates the Access JWT (CF_ACCESS_TEAM_DOMAIN /
          CF_ACCESS_AUD in cosmos-app.env) + its own operator authorization
```

- No public app ingress, no public SSH; administration is SSM Session
  Manager. The instance security group needs **no inbound rules at all**
  (see `../aws/README.md`).
- The tunnel alone is never trusted: the origin validates the Access JWT on
  every request (already implemented in the server; see
  Access JWT validation reference in the proof spec §24.1).
- Tunnel/Access failure must be **shown, not hidden**: the watchdog raises
  `TUNNEL_DOWN` while the app itself keeps running loopback-only.

## Files

| file | installs as | filled when |
|---|---|---|
| `cloudflared-config.yml.template` | `/etc/cloudflared/config.yml` | activation (tunnel UUID + hostname) |
| `access-app.json.template` | dashboard/API input, not a file on the box | activation (hostname + operator email) |

## Activation checklist (owner-authorized; NOT part of this artifact's tests)

1. Create the tunnel; store its credentials JSON at
   `/etc/cloudflared/<uuid>.json`, mode 0600, owner `cloudflared`.
2. Fill `config.yml` from the template; route DNS for the private hostname
   to the tunnel.
3. Create the Access application + operator-only policy from
   `access-app.json.template`.
4. Copy the Access AUD tag and team domain into `/etc/cosmos/cosmos-app.env`
   (`CF_ACCESS_AUD`, `CF_ACCESS_TEAM_DOMAIN`).
5. `systemctl enable --now cloudflared.service` (unit template in
   `../systemd/cloudflared.service`).
6. Verify: app unreachable from the internet directly; reachable through
   Access; origin rejects requests without a valid Access JWT.
