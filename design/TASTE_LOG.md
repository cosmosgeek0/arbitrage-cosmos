## ENTRY #0 — THE QUALITY BAR (owner-supplied comparison, permanent)
Reference: "example photos/1password-manage-account-REFERENCE.png" (real 1Password
Manage Account) vs our previous settings modal. What the reference does that we did not:
- Left rail: 4 items, each a colored rounded-square icon chip + ONE short label,
  generous vertical rhythm, selected state = soft filled pill. Nothing else.
- Right pane: big app icon with razor-thin border, centered name, then ONE card of
  rows; each row = small colored label (link-blue, 11px) above the value (black,
  regular weight). No dots-separated word soup under the title.
- Text: two weights only (semibold titles, regular values), one grey, one black,
  one accent. Every border hairline-crisp. Nothing bold-heavy, nothing fuzzy.
- Layout lesson: settings deserve a real PAGE/pane structure (rail + detail),
  not a cramped popup. LAYOUT COURAGE LAW exists because of this comparison.
Standard: every surface we ship must survive the same side-by-side without shame.

## ENTRY #2 — STRATEGIES TRUTH REBUILD (2026-07-05)
Brief: no owner brief this run. Purpose pass found the Strategies page dressing FOUR
"strategy monitors" (one real strategy + three context lanes) in invented client-side
"readiness"/score meters while the engine's real per-symbol status (idle/watching/signal
on every /api/markets row), its verbatim reason strings, and the persistence gate were
barely surfaced. That is the exact disease PROJECT_CONTEXT bans: the engine hidden
behind abstract decoration.
Photo: "Screenshot 2026-07-02 at 10.52.49 PM.png" — a macOS menu bar crop. Taste-spec:
a status cluster earns trust by being QUIET — monochrome micro-icons, identical optical
sizing, even gaps, one hairline, the clock as the only wide element. Nothing blinks for
attention; hierarchy comes from position, not weight.
Applied: rebuilt Strategies around the scanner's real funnel (pairs scanned → pass
liquidity → watching → proposing, each with its gate written under it), proposal cards
that quote the engine's ledger reason verbatim with net edge as the one thick number,
a 62px-row truth board (basis / net-of-fees / funding / volume / scanner status pill),
funding+borrow demoted to labeled "context, not a strategy" rail lenses, and an honest
"Not built yet" roadmap card. Same score-removal applied to Opportunities (net edge
after fees replaces the invented Score cell; ranking is the engine's own number).
Menu-bar taste landed in the pipeline panel + its hairline status foot.
Research: Coinglass funding-arbitrage tables never show a raw rate without its economic
consequence (APR, predicted next rate). Transferable rule applied: every basis figure is
paired with net-after-fees using the scanner's own formula — no invented composites.
Rejected variation (hill-climb): pipeline as a full-width horizontal strip under the
hero (B) vs right-panel vertical funnel (A). B read nicely left-to-right but left a dead
zone beside the hero copy and pushed proposals below the fold; A kept the funnel at eye
level with zero dead space. Reverted to A.
One-source rule learned: never render the same fact from two feeds — pipeline "watching"
now counts the same market rows whose status pills are visible on the board, and the
"proposing" stage equals the proposal cards below it.

## ENTRY #1 — SETTINGS WORKBENCH PASS (2026-07-05)
Brief: Purpose pass picked Settings because the feature queue named it and the page still read as a long local-preferences stack, not a private account-control settings pane.
Photo/reference: `1password-manage-account-REFERENCE.png` was queued but missing on disk, so this run used the permanent TASTE_LOG #0 reading of that reference: four-item left rail, colored square icons, centered app/account identity, one crisp account facts card, thin type.
Reference comparison: 1Password's 2026 release notes emphasize configurable default settings panes; Binance request-security docs separate API key permission types and say trading is not enabled by default; macOS settings guidance favors immediate/modeless settings grouped into clear categories.
Applied: rebuilt Settings as a full-page workbench with a compact left rail, account posture facts, local appearance/data controls, and an API/safety pane. The rail source line appears once; no watermark/source spam.
Rejected variation: keeping the old oversized hero above a card stack. It looked bigger, but it repeated the same "Settings" billboard problem and delayed the controls.

## ENTRY #3 — SYSTEM HEALTH IMPACT BOARD (2026-07-05)
Brief: no owner-attached photo this run, so this was a recovery run. Purpose pass picked System Health because the old page was a generic uptime component list; PROJECT_CONTEXT needs it to tell whether account truth, market streams, risk gating, order cache, and ledger writes can be trusted before a manual trading decision.
Reference comparison: Binance's current Spot/Futures docs make stream connection limits, 24h reconnects, user streams, and request-weight headers operational trading inputs. Current status-page guidance favors graded, plain-language impact states over binary up/down badges. Applied rule: show freshness, budget, and trading consequence first; keep raw component status as supporting evidence.
Applied: rebuilt System Health into a source-monitor workspace with a posture hero, four impact cards, a component impact board, trade preflight rail, rate-budget bar, safe route buttons, and one quiet source line. Every page button routes to a real cockpit surface or refreshes `/api/system`.
Hill-climb: rejected the single wide grouped-list variation because it preserved the old "system noise" hierarchy. Kept the split impact-board + preflight rail because it keeps the account/risk/ledger trust questions visible above the raw feed list at 1440px and 1920px.
Verification: web build green; browser screenshots light and dark; console errors zero; no horizontal overflow at 1440px or 1920px; all System Health action buttons clicked and routed to the expected real pages.

## ENTRY #4 — DASHBOARD PURPOSE PASS (2026-07-05)
Brief: no owner-attached photo this run, so this was a recovery run. Purpose pass picked Dashboard because the first screen still showed the exact billboard disease named in DESIGN_CONTEXT: "Control room" as the display title and oversized "No account data" inside the hero. That made the private account cockpit feel like a landing page instead of an operator's account state.
Reference comparison: Binance's current spot-trading guidance keeps open orders, order history, trade history, and funds close to the trading interface; TradingView's positions/orders guidance keeps active trades visible against the current market so the trader does not switch context. Applied rule: the first viewport should show account posture, next decision, and live-safe routes before decorative metrics.
Applied: renamed the Dashboard first-screen language to Account cockpit, changed the empty account headline to the smaller state label "Sync waiting", compacted the command-posture rail, moved the decision stack above the metric strip, and updated the shared topbar crumb. Header, hero, and decision buttons still route to real Account/Wallets/Orders/Ledger/Risk/Manual Trade/Opportunities/Fills/Token Detail surfaces.
Hill-climb: rejected keeping the metric strip immediately after the hero. The old order kept the next decision below the fold at 1440px and preserved a dashboard-for-dashboard's-sake hierarchy. Kept hero -> decision stack -> metrics because the owner can see setup, kill switch, proposal review, fill-history, and market inspection before scrolling.
Verification: web build green; browser screenshots light and dark; no console errors; 1440px and 1920px checks had no horizontal overflow; hero/header actions and decision cards were clicked through to their real routes.

## ENTRY #5 — POSITIONS EXPOSURE WORKBENCH (2026-07-05)
Brief: no owner-attached photo this run, so this was a recovery run. Purpose pass picked Positions from the unfinished trading-surface queue because the old surface was a plain holdings table; PROJECT_CONTEXT needs it to explain account exposure, cost-basis truth, missing fill history, and why futures/perp risk is not active yet.
Reference comparison: TradingView keeps active positions and orders visible against the current market so management does not require context switching; Coinbase's order-management guidance puts status, filled amount, cancelability, and market filtering first; Binance's July 2026 API changelog adds `CANCEL_ONLY` as a symbol status, a reminder that execution surfaces must show account/exchange readiness explicitly. Applied rule: the position page must lead with exposure, readiness, and safe routes, then the blotter.
Applied: rebuilt Positions into a workbench: hero with account-sync posture, exposure/cost-basis/perp-risk metric strip, spot-position blotter with honest empty state, readiness rail, and working routes to Manual Trade, Fills, Ledger, Wallets, and Risk. Patched the metric subcopy to wrap instead of hiding the futures/testnet warning behind an ellipsis.
Hill-climb: kept the hero -> metrics -> blotter + readiness rail arrangement because it keeps account truth and missing prerequisites visible above the fold at 1440px. Rejected clipping the risk metric text to preserve identical tile heights; the clipped copy hid the most important limitation, so wrapping won.
Verification: web build green before patch; browser screenshots light and dark at 1440px; no horizontal overflow; dark mode toggled through the real header control. Final build/test gates recorded with this run.

## ENTRY #6 — LOANS BORROW PREFLIGHT (2026-07-05)
Brief: no owner-attached photo this run, so this was a recovery run. Purpose pass picked Loans because reverse-basis proposals need borrowability, margin permission, LTV, and risk posture before any manual ticket; the old first viewport still led with a broad Flexible Loan catalog/setup shell.
Reference comparison: Binance margin docs say borrow/repay requests can fail from insufficient inventory, max-borrowable limits, banned assets, pending transactions, and missing margin permissions; Flexible Loan v2 docs put borrow, ongoing orders, collateral, repay, and LTV management behind signed SAPI endpoints. Applied rule: the page must lead with borrow-required proposals and blockers, not a generic loan catalog.
Applied: renamed the surface to Borrow Preflight, moved reverse-basis proposals and blocker count into the first viewport, added a compact preflight chain rail, demoted Flexible Loan/Cross Margin tables to operational views below, and kept every button wired to real routes or source refresh. No backend, risk, order, ledger, key, withdrawal, or engine code was touched.
Hill-climb: rejected keeping the old hero plus readiness strip because it spent the first screen on abstract setup state. Kept preflight hero -> proposal queue + blocker rail because it shows the actual borrowed-spot queue, missing keys, margin visibility, kill switch, and risk gate at 1440px and 1920px.
Verification: web build green; browser screenshots saved for light/dark at 1440px and 1920px in `design/screenshots/`; changed controls clicked (borrowability tab, refresh, Risk, Ledger, Settings, Opportunities); console errors zero; no horizontal overflow; `npm test` 50/50 green.

## ENTRY #7 — DESIGN LOOP PURPOSE PASS AUDIT (2026-07-05)
Brief: no owner-attached photo this run, no owner brief. Purpose pass selected `Orders` as the next highest-impact trading surface to satisfy DESIGN_LOOP STEP 0 before any structural edits this run.
Research: no UI reference screenshot applied; this was process-only state-pass only.
Result: no UI files changed. Purpose target for next run is `Orders` execution surface. Added run state + map updates.

## ENTRY #8 — DESIGN LOOP PURPOSE PASS AUDIT (2026-07-05)
Brief: no owner-attached photo and no owner-directed brief this run. STEP 0 purpose pass selected `Orders` as the top priority execution surface.
Reference comparison: no reference screenshot applied this run; process-only state audit.
Result: no code/UI files changed. Run recorded in CURRENT_STATE and SITE_MAP, and TASTE_LOG updated.

## ENTRY #9 — TOP-BAR COMPACT PASS (2026-07-05)
Brief: owner-attached photo `top.png` in repo root. OCR indicates a menu-bar style strip with date/time and minimal control density; project purpose asks every top surface to be instantly readable and kill-switch reachable.
Photo: `top.png` (menu-row crop).
Reference comparison: top-bars from Binance and TradingView collapse into dense operational telemetry on a single row; TradingView keeps the kill controls and health posture close together, while the time readout remains lightweight.
Applied: tightened `Topbar` height and control paddings to a compact 44px strip, added a local date/time chip (`Thu Jul 2 10:52PM`-style format) next to UTC time, preserved a single-row status control cluster, and reduced icon/button heights for top-level consistency.
Research: mobile-first cockpit patterns prefer immediate status, one-tap risk posture, and an explicit kill route over large hero text at the bar level.
Hill-climb: kept this pass intentionally top-only; no Orders content refactor yet because the image target maps to the shared top strip.

## ENTRY #10 — TOP-BAR FORMAT REFINEMENT (2026-07-05)
Brief: follow-up pass to align time format details to the same owner photo's typography.
Photo: `top.png` (menu-row crop).
Applied: reformatted local clock to `Thu Jul 2 10:52PM`-style output, retained UTC seconds output for operational timing, and kept the same compact strip layout with one-click kill and live status controls.

## ENTRY #11 — TOP-BAR MENU-ROW FINISH (2026-07-05)
Brief: owner-directed one-photo run using repo-root `top.png`. Purpose pass kept `Orders`
as the next full content surface, but the owner image is explicitly a top strip, so the
implementation stayed on shared Topbar only.
Photo: `top.png` — macOS menu-row crop. Taste-spec: one shallow 42px row, monochrome
controls, equal optical centers, and the local date/time as the calm right anchor.
Reference comparison: Apple HIG menu/status guidance keeps persistent top controls compact
and recognizable; TradingView's charting-library toolbar docs describe the top toolbar as
the primary strip for symbol/search/resolution controls; Binance futures UI guidance keeps
positions/open-orders controls close to the trading workspace. Applied rule: top chrome
should be dense operational telemetry, not a second hero.
Applied: moved the local `Sun Jul 5 5:15AM`-style clock to the far-right edge, collapsed
System Health into a single-line chip, kept UTC as secondary timing on wide screens only,
left kill/resume in the same row, added aria labels to icon-only topbar buttons, and kept
the local clock visible in the 200%-equivalent responsive pass.
Hill-climb: rejected hiding both clocks below desktop width. It matched the old responsive
cleanup but failed the photo's strongest cue; kept local-time persistence and hid only UTC.
Verification: build green; screenshots saved for light/dark at 1440px, 1920px, and
zoom200-1440; console errors zero; no horizontal overflow.

## ENTRY #12 — TOP-BAR STATUS DENSITY (2026-07-05)
Brief: repeated owner instruction to read repo-root `top.png` and implement exactly one
run. Purpose pass again names `Orders` as the next full execution surface, but this photo
is still top-strip craft, so the run stayed on shared Topbar.
Photo: `top.png` — menu-row crop. Taste-spec refinement: the reference row is glyph-first;
text appears only for the clock. Status should be readable by position, icon, color, and
tooltip before it becomes words.
Reference comparison: Apple toolbar guidance says controls in a bar should be grouped by
function; TradingView's top toolbar is a compact primary command strip; Binance keeps live
positions/open-orders state near the trading workspace. Applied rule: keep safety controls
visible, but compress passive telemetry into a status cluster.
Applied: collapsed Market/Account/Stream labels into a three-dot cluster with titles and
aria labels preserved, shortened Health secondary copy from a sentence to the current
blocker (`keys absent`), kept UTC as secondary and local time as the far-right anchor, and
left Resume/HALT as explicit text because it is safety-critical.
Hill-climb: kept the dot cluster after comparing against the previous labeled cluster. The
previous version was clearer but consumed ~914px of topbar width at 1440; the kept version
uses ~713px and reads closer to the photo without hiding the kill path.
Verification: build green; screenshots saved for light/dark at 1440px, 1920px, and
zoom200-1440; Search opens the palette, Health routes to System Health, Resume routes to
Risk; console errors zero; no horizontal overflow.

## ENTRY #13 — ORDERS EXECUTION DESK (2026-07-05)
Brief: no owner-attached photo this run, so this was a recovery run. Purpose pass selected
`Orders` because it is the next full execution surface and the page must show working
orders, cancelability, fill progress, held notional, and audit trail before any manual
trading decision.
Reference comparison: TradingView keeps active positions/orders visible near the market so
management does not require context switching; Coinbase order management calls out funds
held by open orders, partial fills, and cancel/edit from the open-orders panel; Binance
spot activity surfaces date, pair, side, type, price, amount, filled percent, total, and
history; Binance's current order-status guidance says REST snapshots and user streams are
complementary and open vs terminal states are the decision split. Applied rule: Orders
must lead with working state, held notional, source freshness, cancel path, and ledger
truth, not a generic table below a hero.
Applied: replaced the separate Orders hero, metric strip, status strip, and command deck
with one compact Order desk. It now shows held-by-open-orders, open limit usage, flow
sample, history state, working-vs-terminal state, and four real action cards: Account
feed, Manual order path, History request, Cancel review. Added remaining quantity context
to the inspector progress panel and one quiet source line.
Hill-climb: rejected the first merged-desk variation because it duplicated account/risk/
cancel facts in both a guardrail row and an action row, pushing the blotter below the
first viewport. Kept the compact variation with one action row; at 1440 the tools begin
around 663px and the blotter enters the first viewport around 898px.
Verification: web build green; light/dark screenshots saved at 1440px and 1920px plus
720px 200%-equivalent checks; tabs route correctly, history load is disabled without
server keys, all four action cards route to Account/Risk/Ledger as expected; console
errors zero; no horizontal overflow.

## MERGE PASS 2026-07-05 (director)
5/5 parallel rescues merged. npm test 50/50. CSS markers clean. All reports cite 3 refs.
