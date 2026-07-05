## 2026-07-05 — Strategies truth rebuild

No new runtime semantic token. The rebuilt Strategies/Opportunities surfaces reuse
`--line`, `--tile`, `--hover`, `--accent`, `--accent-ink`, `--muted`, `--faint`,
`--up`/`--down` and the `.card` material; the old 834-line strategy CSS block was
replaced by a 292-line token-driven one (styles.css shrank ~540 lines).

## 2026-07-05 — Settings workbench

No new runtime semantic token was introduced. The Settings rebuild reused the existing
glass/material tokens (`--panel`, `--tile`, `--glass-border`, `--accent-soft`,
`--line`, `--text`, `--muted`, `--up`, `--down`) and added only scoped layout
classes for the rail/pane structure.

## 2026-07-05 — System Health impact board

No new runtime semantic token was introduced. The System Health rebuild reused the
existing status/material tokens (`--panel`, `--tile`, `--line`, `--text`,
`--muted`, `--up`, `--down`, `--accent`, `--hover`) and added only scoped
`sys-*` layout classes.

## 2026-07-05 — Dashboard purpose pass

No new runtime semantic token was introduced. The Dashboard pass reused the existing
account/status/material tokens (`--panel`, `--tile`, `--line`, `--line-2`,
`--text`, `--text-2`, `--muted`, `--accent`, `--accent-soft`, `--up`, `--down`)
and only tightened scoped `dash-*` layout/type rules.

## 2026-07-05 — Positions exposure workbench

No new runtime semantic token was introduced. The Positions pass reused the existing
account/status/material tokens (`--panel`, `--tile`, `--line`, `--line-2`,
`--text`, `--text-2`, `--muted`, `--accent`, `--accent-soft`, `--up`, `--down`)
and kept the changes scoped to `positions-*` / `position-*` layout classes.

## 2026-07-05 — Loans borrow preflight

No new runtime semantic token was introduced. The Loans pass reused the existing
account/status/material tokens (`--panel`, `--tile`, `--line`, `--glass-border`,
`--text`, `--muted`, `--accent`, `--accent-soft`, `--up`, `--down`) and replaced
the old `loan-hero` / readiness-strip CSS with scoped `loan-preflight-*` layout
classes.

## 2026-07-05 — Topbar menu-row finish

No new runtime semantic token was introduced. The topbar pass reused existing
chrome/status tokens (`--bg`, `--panel`, `--line`, `--line-2`, `--text`,
`--muted`, `--up`, `--down`, `--accent`) and only tightened scoped `hdr-*` /
`tb-*` layout rules.

## 2026-07-05 — Topbar status density

No new runtime semantic token was introduced. The density pass reused existing
chrome/status tokens (`--panel`, `--line`, `--line-2`, `--text`, `--muted`,
`--up`, `--down`, `--accent`) and only tightened scoped `conn-*` / `hdr-*`
layout rules.

## 2026-07-05 — Orders execution desk

No new runtime semantic token was introduced. The Orders pass reused existing
material/status tokens (`--panel`, `--tile`, `--line`, `--line-2`, `--text`,
`--text-2`, `--muted`, `--faint`, `--accent`, `--accent-soft`, `--up`, `--down`)
and replaced the old Orders hero/metric/status slab CSS with scoped `orders-desk-*`
and `orders-command-*` layout classes.
