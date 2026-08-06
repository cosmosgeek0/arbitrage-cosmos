/* =============================================================================
   Watchdog — the route module for /watchdog (page id 'watchdog').

   BOTH ARE PINNED BY AN ACCEPTANCE LEDGER. `App.tsx:19` imports the NAMED
   export `Watchdog`; `store.tsx` maps page id 'watchdog' to path '/watchdog'.
   Neither the export name, the page id, nor the route may be renamed here.

   ---------------------------------------------------------------------------
   WHAT THIS FILE IS, AND WHY IT IS SHORT

   It is the route mount, and nothing else. The page's shell — the single read
   spine, the four clusters and six sections, the three page singletons (one
   live region, one sticky object per scroll container, one roving-tabindex
   focus model per table) and the two shared kill switches — lives in
   `./watchdog/WatchdogSurface.tsx`, which is the file the composition graph
   names as its owner.

   That split is load-bearing, not cosmetic. A route module that also owned the
   polling, the derivation and the layout is exactly what this page was before:
   ~1,300 lines in which a dead control, a false green and an unreachable code
   path could all hide from each other. Fourteen files with named owners and one
   frozen type module cannot hide them, because every seam between them is a
   compile error.

   ---------------------------------------------------------------------------
   WHERE THE OLD BEHAVIOUR WENT (this file used to carry all of it)

     the five lanes and the operator clock ...... ./watchdog/watchdogEvidence.ts
     the canonical verdict + the re-read control  ./watchdog/VerdictHeader.tsx
     the owner verdicts and the intake interlock  ./watchdog/PostureBand.tsx
     the owner census and its expansions ........ ./watchdog/OwnerLedger.tsx
                                                  ./watchdog/OwnerRow.tsx
                                                  ./watchdog/OwnerEvidence.tsx
     dependencyEdges (the page's ONLY topology) . ./watchdog/ConnectionPathChain.tsx
     the control registry + its audit trail ..... ./watchdog/ControlLedger.tsx
     preview -> confirm -> commit -> receipt .... ./watchdog/ControlCommit.tsx
     POST /api/refresh and the cadence ledger ... ./watchdog/RecoveryConsole.tsx
     loop lag, transport lanes, the transcript .. ./watchdog/ObserverEvidence.tsx

   ---------------------------------------------------------------------------
   WHAT WAS CUT RATHER THAN MOVED, and why each is a defect and not a
   preference. Every one of these was reachable code on this route:

   1. `liveControlDisposition` and the entire arm/apply apparatus. Its two gates
      were mutually exclusive against the real registry — one refused any control
      whose `payloadEnumeration.length !== 2`, the other mapped only four
      commands, and all four publish a ONE-value enumeration. The intersection
      was empty, so the `<button>` branch was unreachable and 100% of rows
      rendered the observe-only `<span>`. That is literally "you can select two
      or three and nothing happens". Replaced by ControlCommit, whose arming is
      the SERVER's `POST /v1/commands/preview` and whose receipt is a durable
      one — never a five-second local double-click timer, which is the exact
      substitution `CONTROL_PREVIEW_REQUIRED` exists to refuse.
   2. `mutateSystemControl` / `POST /api/system-integration/controls`. It accepts
      no previewId, no previewDigest and no expiresAtMs, and has no durable
      result readback route, so it cannot satisfy the preview contract and must
      never become a second mutation path.
   3. The switch on/off comparison, which compared a display string
      (ENGAGED/CLEAR/PAUSED/OPEN/READ_ONLY) against `String(payloadEnumeration[i])`
      ('true'/'false'/'ISOLATE'). The vocabularies never intersect, so `engaged`
      was always null and every switch rendered `.unknown`.
   4. The page `tone` computation — the live FALSE GREEN. Its own comment claimed
      "only a proven read with current lanes is green" and the code checked
      neither: zero transport samples (i.e. first paint) fell through to
      'healthy', and only BLOCKED continuity was treated as bad, so UNPROVEN
      rendered green.
   5. The inert `<img className="healthx-page-mark" src="/connection-reset-mark.svg"
      aria-hidden="true">` — the deleted Connection Watchman launcher's exact
      asset, sitting at the operator's trained click target, bound to nothing.
      It is a real `<button>` in VerdictHeader now: it re-reads every lane and
      renders the MEASURED readback, including the case where the assessed stamp
      did not advance.
   6. The toolbar refresh-target select. Three of its six options are statically
      refused by `canonicalRefreshTargetPosture` and 409'd by the server, so they
      existed only to be chosen and then disable the button. The six targets live
      in RecoveryConsole now, where a blocked target is labelled "· Preview
      Required" INSIDE the menu — gated with a stated reason instead of silently
      inert.
   7. The Edge Compression tile (no operator decision follows from the gzip ratio
      of one supervisor sample) and the standalone Published Cut tile (an
      8-character digest with no comparand answers nothing). The digest survives
      inside ObserverEvidence, where it is compared against the server's own
      `cache.digestPrefix8` and therefore proves something.
   8. The free-floating layered DAG. The operator's question is never "show me
      the architecture", it is "what is upstream of the broken thing" — which
      OwnerEvidence's ego view answers at any scale with no layout engine. Two
      topology surfaces was the duplication that made this page portray more
      while proving less.
   9. `GET /api/system` polling and the transition timeline built on it. Its
      `connections.watchman` aggregate is a second census competing with the
      canonical envelope, its `ok:true` is self-labelled
      `okSemantics:'TRANSPORT_ONLY'`, and reading it drives server-side
      transition detection that WRITES `connection_alert` /
      `connection_recovered` ledger events. A monitoring page must not
      manufacture the alerts it displays.
  10. `import './Health.css'` and the `healthx-page` root class. `.healthx-frame`
      is border + radius + shadow + overflow:hidden — precisely the inset
      container Law 4 forbids, because it gives the page an interior right edge
      and then no two numeric columns can share an x. Health.css itself is
      untouched; it is simply no longer imported here, and no `healthx-*` rule is
      redefined anywhere on this page.
  11. `import './Watchdog.css'`, and the file with it. Every rule in it styled a
      component that no longer exists — including two blocks
      (`button.wdogx-switch.armed`, `.wdogx-control.live`) that only ever styled
      the unreachable arm path, and a 7-track `grid-template-columns` declared
      against 8 rendered cells. The page's layout is
      `./watchdog/WatchdogSurface.css`, imported by the file that owns the
      layout. A stylesheet kept alive for its shape is the same box-filling this
      rebuild exists to remove.

   ---------------------------------------------------------------------------
   FOR ANYONE GREPPING THIS MODULE FOR BEHAVIOUR

   Three pinned tests used to read this file as SOURCE TEXT. They now read the
   files that carry the behaviour, with each assertion's substance preserved:

     `component.canonicalPresentation` ..... ./watchdog/watchdogEvidence.ts
     the /api/refresh posture gate ......... ./watchdog/RecoveryConsole.tsx
     the browser socket projection ......... ./watchdog/ObserverEvidence.tsx

   The joined-source guard in `canonical-presentation.test.mjs` (the
   `assert.doesNotMatch` run over every consumer at once) now includes every
   file under `web/src/pages/watchdog/`, so moving code out of here did not
   shrink that guard's coverage — it widened it.
   ========================================================================== */

import { WatchdogSurface } from './watchdog/WatchdogSurface';

export function Watchdog() {
  return <WatchdogSurface />;
}
