# ⚡ PARALLEL RESCUE ACTIVE: you are ONE of several agents, each owning ONE page.
# - Touch ONLY your assigned page's files + append page-scoped CSS at the END of the
#   shared stylesheet under a marker: /* ===== PAGE RESCUE: <page> ===== */
# - NEVER edit shared components (header/nav/footer/lib) unless they ARE your page.
# - NEVER edit shared state files (CURRENT_STATE/TASTE_LOG/FEATURE_QUEUE/SITE_MAP/
#   PHOTO_QUEUE). Write design/reports/<page-slug>.md instead (format: reports/README.md).
# - Use the port assigned in your task card so parallel servers never collide.
# - Director runs the merge pass + full gates afterwards.

# ⚠ RESCUE MODE ACTIVE — polish mode SUSPENDED until the rescue queue in FEATURE_QUEUE.md is done.
# Every run = rescue ONE full page: before/after screenshots, kill dashes/dead panels/repeated
# status spam, rebuild hierarchy (title→subtitle→filters→primary→secondary→footer), ≥5 visible
# page-level changes, missing data = compact honest chip never a fake panel. A run that only
# touches state files/one widget, or leaves dead panels, FAILED. Light gates per run (npm test +
# render check); read FEATURE_QUEUE.md for page order. Internal baseline: signal of quality =
# clear title, grouped sections, no gimmicks. Reference wall in DESIGN_CONTEXT.md.

# DESIGN LOOP — arbitrage (private real-money trading cockpit). ONE RUN = ONE PHOTO.
# READ arbitrage AGENTS.md FIRST — its safety laws override everything here.

## READ ORDER (before anything): PROJECT_CONTEXT.md → engine/ENGINE_CONTEXT.md
(READ-ONLY: the engine is built by Fable 5 in separate sessions — engine/ is a
FORBIDDEN ZONE for you) → design/DESIGN_CONTEXT.md → the state files. The UI is
the ENGINE'S TOOL SET: every surface exists to show what the engine watches,
why it cares, what it rejected/proposed, what happened. Design for that.

## MEMORY DISCIPLINE (short truth beats long history)
Read ../CURRENT_STATE.md FIRST every run — it is the current truth (≤80 lines).
TASTE_LOG.md is the archive: read ONLY its last entry unless investigating.
At run end: update CURRENT_STATE.md (your section + Next 5) AND append to TASTE_LOG.md.

## STEP 0 — PURPOSE PASS (before any photo, every run)
Re-read the purpose files fresh. Find the ONE surface most misaligned with what
PROJECT_CONTEXT/ENGINE_CONTEXT actually need (e.g. a whole tab for system-health
noise while strategy/orderbook surfaces starve) and restructure it FIRST —
add/remove/merge per purpose. Photo craft comes after purpose, never instead.

## WHERE THE PHOTO COMES FROM — OWNER ONLY. NEVER SELF-SERVE.
A photo exists for this run ONLY if the owner attached one to this chat, and the
owner's words about it are the brief (law on top of all rules).
NO PHOTO ATTACHED = NO PHOTO WORK. Do a pure RECOVERY RUN instead:
purpose pass → reference comparison → restructure/shuffle what the purpose bible
says is broken → hill-climb (keep or revert) → alive check → gates. That IS the
run. Do NOT open "example photos/" uninvited — it is reference material for when
the owner cites it, never a queue to pull from.
(historic header:)
1. Owner-attached photo in this chat = the run's photo; owner's words = the BRIEF
   (law on top of these rules, never a replacement).
3. Log every processed photo in design/PHOTO_QUEUE.md as `[x] name — where applied`.
Memory = files listed in READ ORDER above. You see ONLY this project; there is no outside.

## FORBIDDEN ZONES (touch = failed run)
server/src orders/loans/risk/ledger/execution/keys/env/mode/kill-switch/withdrawal
logic, and the ENTIRE engine/ folder (Fable 5's territory — read its context, never
write). UI layer + read-only endpoints only. Ignore dist/ and node_modules/.

## IDENTITY
A private cockpit for ONE trader with real money. Reference photos teach CRAFT only;
the product stays a trading control room — the bar is the best of professional
terminals (Binance pro, Backpack, TradingView) with 1Password-grade settings craft.
Account truth, orders, risk, PnL — readable in one glance, alive, never decorative.

## THE RUN (token system is the base — components use semantic tokens only)
STEP 1 — STUDY: taste-spec into TASTE_LOG.md (+ restate the brief). New token
learned → TOKENS.md + web/src/tokens.css.
STEP 2 — REGION GRIND (fixed order, verdict per region, never skip): sidebar
top-to-bottom → topbar left/center/right → each page section-by-section (Dashboard,
Markets, TokenDetail, ManualTrade, Orders, Positions, Fills, PnL, Loans, Strategies,
Opportunities, Risk, Ledger, SystemHealth, Settings) → every modal/ticket/table.
Ask per region: excellent, or improvable by photo/brief? Every word, number, border
deliberate? Apply everywhere it fits — judge, don't scatter.
STEP 3 — LAYOUT SHUFFLE (mandatory): restructure at least one thing per run
(move/merge/remove/reorder; e.g. settings modal → full page with left rail). Try 2-3
arrangements, keep the winner. Full-page rebuilds allowed — paper mode + gates
protect behavior. Replaced legacy CSS is deleted the same run; styles.css shrinks.
STEP 4 — RESEARCH (mandatory): search how the best terminals present today's
surface; apply one finding; log it.
STEP 5 — ALIVE CHECK: everything works and moves — real server data, states,
tick/flash, hover/press, subtle transitions. No dead slabs. Motion subtle, purposeful.
STEP 6 — MIRROR TEST at 200% zoom vs photo + brief. Photo wins → another round NOW.
Then [x], update SITE_MAP.md + TASTE_LOG.md, stop.

## PERFECTION LAWS (supreme)
1. PIXEL PERFECTION at 200% zoom: hairline borders, exact type scale, grid alignment.
2. NO WHATSAPP LINES: designed labels only; hierarchy by layout, never dot-soup.
3. REAL FEATURES ONLY: wired to the real server API or not built. Never fake.
4. MATERIAL RESTRAINT: whitespace + hairlines carry structure; gloss/glass is a rare
   accent; rectangles are fine; dark AND light must both look deliberate every run.
5. PATIENCE: no deadline; obsess per element; sameness after a run = failure.

## GATES BEFORE DONE
npm test all green (update stale gates honestly, never delete) + screenshots of
changed regions light + dark + plain-words headers on every touched file.
No commits unless asked.

## ADDITIONAL LAWS (owner-ordered, supreme)
6. NO WATERMARK SPAM. Source attribution appears ONCE per surface, quiet, in the
   designated source line or footer — never scattered TradingView/CoinGecko
   watermarks across cards. Remove existing watermark litter on sight.
7. THIN TYPE. Default to light/regular weights; thickness is reserved for the one
   number that matters. Vary the type across hierarchy levels — one thick font
   everywhere is the disease. Slim reads professional.
8. HILL-CLIMB. Every run: try at least one deliberate variation (spacing, order,
   size, placement). Keep it if the mirror test says better; REVERT if not —
   reverting is success, not failure. Fifty runs of keep/revert = the redesign.
9. REFERENCE COMPARISON (mandatory, replaces aimless reshuffling). Before
   restructuring a surface, actually look at how Binance / Coinbase / TradingView /
   Uniswap / Coinglass / DefiLlama present that same thing (web search or their
   site), write one line of what they do better, then apply. Never reshuffle blind.
