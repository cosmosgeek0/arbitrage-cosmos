# PAGE
Settings

# WHAT WAS BROKEN
- The Account pane still read like a billboard: repeated "Settings" framing, oversized product title, and a tile grid before the actual settings controls.
- Account/API states were split between KPI tiles and icon checks instead of crisp account rows with label-over-value hierarchy.
- Several controls were implicit or dead-looking: keyboard shortcut state, API key entry, and withdrawal/transfer-out needed disabled-with-reason treatment.
- Dark mode still had too much glass/rim glare for a settings surface that should be calm and flat.
- The API/safety pane was too generic: it did not expose trading permission, key boundary, unknown withdrawal permission, and forbidden withdrawal path as honest current states.

# CHANGES
1. Rebuilt the first Account pane into a compact 1Password-style identity header plus four label-above-value posture rows.
2. Replaced the posture KPI tile grid with hairline-separated account rows for API keys, account link, user stream, and withdrawal posture.
3. Added disabled-with-reason controls for keyboard editing, browser API key entry, and withdraw/transfer-out.
4. Converted API/safety checks from decorative check icons into explicit status text: Not set, Blocked, Unknown, Risk-gated, External gate, Ledgered.
5. Tightened the left rail identity/status copy and kept rail links as working section anchors.
6. Added page-scoped rescue CSS under `/* ===== PAGE RESCUE: settings ===== */`, including dark-mode flat panels with no specular glare.
7. Added explicit `type="button"` on segmented/switch/reset controls to keep controls predictable.

# REFERENCES USED
1. 1Password Manage Account (Entry #0 quality bar) — borrowed the compact rail, centered account identity, label-above-value rows, two-weight typography, and crisp hairline separators. Local source: `design/TASTE_LOG.md` Entry #0.
2. macOS System Settings rows — borrowed grouped rows, left navigation, immediate modeless controls, and concise setting labels from Apple settings guidance: https://developer.apple.com/design/human-interface-guidelines/settings
3. Kraken settings / API security — borrowed explicit API key permissions, disabled capability language, and security-state separation from Kraken support: https://support.kraken.com/hc/en-us/articles/360000919966-How-to-create-an-API-key

# FILES TOUCHED
- `web/src/pages/Settings.tsx`
- `web/src/styles.css`
- `design/reports/settings.md`

# GATES RUN + RESULTS
- `npm run build -w web` — PASS.
- Browser render check on `http://localhost:5185/` against shared backend `:8080` — PASS: light/dark screenshots, no horizontal overflow, zero console errors.
- Control check — PASS: rail anchors, theme cards, density cards, motion, ticker tape, refresh, timezone, basis units, default page, Risk route, System Health route, disabled-with-reason controls, and reset preferences all verified.
- `npm test` — PASS, 50/50 gates.

# SCREENSHOTS
- Before light: `design/screenshots/2026-07-05-settings-before-light-1440.png`
- Before dark: `design/screenshots/2026-07-05-settings-before-dark-1440.png`
- After light 1440: `design/screenshots/2026-07-05-settings-after-light-1440.png`
- After dark 1440: `design/screenshots/2026-07-05-settings-after-dark-1440.png`
- After light 1920: `design/screenshots/2026-07-05-settings-after-light-1920.png`
- After dark 1920: `design/screenshots/2026-07-05-settings-after-dark-1920.png`
