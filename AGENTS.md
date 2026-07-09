# AGENTS.md - Project-Local Instructions For Future Agents

This repository is the durable source of truth. Do not depend on any external
Codex memory, chat history, or hidden assistant state to understand the product.

## Read Order Before Work

1. `PROJECT_MEMORY.md` - current state, active decisions, latest run log.
2. `DESIGN_PLAYBOOK.md` - mandatory UI quality bar, owner preferences, ship gates.
3. `UI_SURFACE_BASELINE.md` - current sidebar/topbar/search/profile baseline from the five-hour polish pass.
4. `BLUEPRINT.md` - product architecture and page responsibilities.
5. `ENGINE.md` - engine, scanner, risk, and ledger architecture.
6. `DIRECTOR_RULEBOOK.md` - operating discipline, merge/safety rules.

For UI work, read `DESIGN_PLAYBOOK.md` first, then inspect the actual rendered
app in the browser before making claims. For left sidebar, topbar icons,
global search, clock, notifications, kill switch, refresh, currency, basis,
appearance, or account profile work, also read `UI_SURFACE_BASELINE.md`.

## Non-Negotiable Operating Rules

- Search current external references before coding or redesigning anything.
  For UI, research relevant high-quality product references, then map the
  reference into this product instead of inventing decoration.
- Inspect the repo and the current browser state before editing. Screenshots
  from the owner are reference material, not optional context.
- Do not create fake buttons, fake toggles, fake guardrails, fake live badges,
  or controls that do not do real work. If it is not wired, mark it Planned,
  Disabled With Reason, or omit it.
- This is a premium arbitrage/trading control room, not a retail demo app.
  Optimize for observability, account truth, risk, health, real controls, and
  crisp operator-grade UI.
- Do not add manual money-action UI unless the owner explicitly asks. The app
  monitors and controls the bot; Binance remains the place for direct manual
  trading/borrowing actions.
- Preserve unrelated dirty files. Never revert work you did not make.

## UI Quality Rules

- Use project references, not vibes. The approved quality targets are Account,
  Markets, Token, Binance/Coinbase-style account surfaces, and the Flow-style
  sidebar typography lesson recorded in `DESIGN_PLAYBOOK.md`.
- Typography must be crisp: restrained weights, exact line-height, no random
  big/bold labels, no subpixel hover transforms on persistent text.
- Prefer real rows, hairline dividers, borderless tables, and consistent card
  chrome over random boxes. One page = one clear spacing system.
- Topbar triggers should stay icon-first. Useful words live inside popovers,
  not on every trigger.
- Motion must be subtle, slow, and purposeful. No constant toy-like spinning,
  no purple/blue glow mess, no decorative moving lines.
- Account/profile popovers show real connected exchange/key posture, real
  active/recent sessions/devices, and real logout. They are not generic nav
  menus.

## Verification Gate

Before calling UI work done:

- Run the relevant build/test command.
- Reload the local app in the browser.
- Inspect computed styles for the specific typography/spacing/motion issue.
- Click the controls you touched and verify real behavior or honest disabled
  state.
- Capture or inspect screenshots at the current browser size.
- Update `PROJECT_MEMORY.md` when a durable product lesson or state change is
  learned.
