# MANUAL.md — the owner's operating manual

Canonical preface: this file moved into Git on 2026-07-19; `origin/current-main`
is truth; `Desktop/cosmos-merge` owns the branch and `Desktop/Main` is a
detached viewer; private, signed, and money capabilities remain unimplemented
or separately owner-gated; `STATE.md` owns current posture.

## Source: /Users/cosmosgeek/Desktop/MANUAL.md (2026-07-19)

# MANUAL.md — the owner's manual

## The one idea that makes everything simple
The product does NOT need any AI to run. Your trading code is plain code (node + python) kept alive by a small service on a rented computer, 24/7, for almost nothing. The AI (Claude/Codex) is a VISITOR you summon when you want to look at or change something — it works, then it leaves. Two things are alive: the product (always, cheap) and you (bringing a visitor when needed).

## If you ever feel lost — do exactly this
1. Open GitHub → repo `arbitrage-cosmos` → confirm the green check on `current-main`. That green = the whole product is proven.
2. Open `Desktop/FIX_WAVES.md`, top section — that is what is running right now.
3. Need a director? Open a fresh chat in `Desktop/Main` and paste the one-line boot from `DIRECTOR.md` §6. That's the entire recovery — it has worked through two director deaths already.

## Where things are
- **The product:** GitHub `current-main` (master copy) = `Desktop/Main` (your local window) = `Desktop/cosmos-merge` (the director's working seat). The green Code button on GitHub always downloads the latest final code.
- **Backups:** SSD `Mac 4TB/cosmos-backup/` — the full-repo bundle (the project survives even if GitHub is lost), the archive, the EC2 runbook (DEPLOY_READINESS.md), your old key files, and the future AI-console build order.
- **Steering files:** DIRECTOR.md (the director's brain), FIX_WAVES.md (live log), FRESH_DIRECTOR_FINAL_TRANSITION.md (the deployment script), this file.

## How deployment goes (when you say "start transition")
1. Rent an EC2 box; get onto it with AWS Session Manager — a text window into the box with NO open ports, no SSH.
2. Code arrives by git clone; node/python/sqlite installed; your real keys go into ONE protected file on the box — never in code, never in git.
3. The keep-alive service (already built, `ops/` folder) starts it; Cloudflare Tunnel + Access makes your dashboard a login-gated web address only your email can open.
4. First run is VALIDATE-ONLY: zero trading capital wired, mechanically proven before start. The only thing at risk is the EC2 bill.
5. Expect 5–15 small errors the first days — that's the test flight, with no money attached. Fix each. When steady: wire $10. Real fills are the real test.

## How you watch it live — two kinds of eyes
- **Front eyes:** your web address in any browser — the real live dashboard, from anywhere.
- **Back eyes:** Session Manager into the box → read logs, the database, and `curl localhost:PORT/api/...`. The back eyes see MORE than the website; the website is a summary of what the backend computed.
A problem is only understood when both eyes agree.

## How you change things once live
Summon Claude Code or Codex directly on the box (through Session Manager) or on your Mac. It edits, rebuilds, restarts in the box's text window; git push is your undo button. For looks ("dashboard is ugly"), you look at the live page and tell it in plain words. Always-on AI watchers under a subscription are not reliable (logins expire overnight) — the wake-work-sleep visitor pattern IS the correct model, not a limitation. The automatic incident-watcher built into the code stays OFF until you explicitly promote it.

## The cost reality
Product 24/7: cheap, no AI bills. AI only when summoned. Cloud: one small EC2 + Cloudflare free tier. Set a billing alarm at deploy time.

## The stop rule (most important line you own)
No more scans, hunts, or hardening waves. Scans always find more — that is their nature, not a sign the product is broken. It passed independent verification and full CI on the deployment OS. New work comes only from reality: a runtime incident, something you see wrong, a failed gate, or a promotion you sign. Convergence means choosing to finish. Reality is the next hunter, and a better one than any chat.

## Only YOU can do these (the true critical path)
1. Authorize AWS (account, region, instance) and set the billing alarm.
2. Provide the Cloudflare zone/tunnel/access identity and one paging destination.
3. Rotate old keys; place real keys in the one protected file on the box.
4. Sign each capability promotion when its gate arrives (first private read, first signed test order, watcher activation).
5. Decide each capital step: $10 → $50 → $200. Watch between steps.

## The future AI-console (parked, on the SSD)
A full build order exists for an in-website AI area (watch every AI action + chat with Codex from the browser, attach the live page, approve fixes). Deliberately parked: it must never delay deployment or the $10 test. When the product has been live and steady and you want it, tell the director: "build the AI console — the order pair is on the SSD in cosmos-backup/future-ai-console/".

## Source: DIRECTOR_FINAL_ASSURANCE_HANDOFF.md — retained owner-operation clauses

These must be visible as owner actions/configuration and must not be invented by an agent:

- weekly labeling/outcome-review commitment;
- three to five zero-capital operator game-day drills before real capital: source loss, reconciliation/recovery-required state, canary loss cap, watchdog/page delivery, and rollback/restore.

Failure to supply an owner input becomes an explicit owner gate. It is never filled with a guessed value and never hidden behind green.
