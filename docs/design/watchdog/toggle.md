# Watchdog — Control toggle bound to server readback

> **STATUS: ROUND 2.** Sections 1–4 stand. **§§5–11 are superseded by §§12–18** (the panel round,
> at the bottom of this file). The Round-1 winner — a `role="switch"` bound to intent — was killed
> by panel defect #9: `aria-checked` carries one boolean and this control has two that may disagree,
> so a screen reader announced `"Kill switch, switch, on"` while the machine was CLEAR. The shipped
> element is **Variant F: a non-interactive readout rail plus explicit verb buttons.** The freshness
> field Round 1 invented (`readbackRevision`) does not exist; the shipped design binds to the
> **lease** that does (`opsReadback.observedAtUtc` / `validUntilUtc`). Read §13 first.

Element owner notes. One element: the control-state surface for a real gated control where
**DESIRED** and **EFFECTIVE** can disagree and **the server owns truth**.

Must solve, without ever optimistically rendering the new state:
`desired != effective` · `in-flight` · `denied-with-reason` · `gated-needs-preview`.

---

## 1. House tokens — read, quoted, not assumed

Source of truth: `/Users/cosmosgeek/Desktop/Main/web/src/styles.css` (the root sheet — **there is no
`web/src/index.css`**; the work order's path was wrong and I verified it), plus
`web/src/pages/Health.css`, `web/src/pages/Dashboard.css` (both live inside `styles.css`'s cascade),
and `web/src/features/productControlRoom/styles/productControlRoom.css`.

The sheet opens with its own doctrine, which I extend rather than replace:

```
/* Arbitrage Control Room — design system ported from CG Signal Lab.
   Surfaces, not boxes: structure = whitespace + hairlines. Tinted tiles only
   where Coinbase uses them. Color is reserved for data (up/down/accent). */
```

### Tokens that bind me

```css
:root, [data-theme="light"] {
  --panel:#fff; --tile:#f5f6f8; --tile-hover:#eff1f4; --hover:#f7f8fa;
  --line:#eef0f3; --line-2:#e4e7ec; --line-strong:#d3d7df;
  --text:#0b0e14; --text-2:#2c313a; --muted:#697180; --muted-2:#858e9b; --faint:#9aa3b2;
  --accent:#2f6bff; --accent-ink:#1d4ed8; --accent-soft:rgba(47,107,255,.13);
  --up:#0a9b64; --down:#e0414b;
  --r-sm:8px; --r-md:12px; --r-lg:16px; --r-pill:999px;
  --font:"InterVariable",...; --mono:"SF Mono","JetBrains Mono",ui-monospace,...;
}
[data-theme="dark"] {
  --panel:#15181d; --tile:#1b1f26; --line-2:#262d38; /* razor-thin visible edge in dark (owner 2026-07-09) */
  --text:#e8edf4; --text-2:#aeb7c4; --muted:#717b8a; --faint:#4d5664;
  --up:#2ebd85; --down:#f6465d;
  --depth: 0 0 0 0 rgba(0,0,0,0);   /* dark is FLAT. no shadows. */
}
body { font-size:13.5px; line-height:1.5; }
.num { font-variant-numeric: lining-nums tabular-nums; }
```

### The radius truth (the sibling chip doc got this half wrong, and it matters to me)

```css
.cta-pill  { height:42px; padding:0 22px; border-radius:12px; }   /* NOT --r-pill, despite the name */
.chip      { height:31px; padding:0 13px; border-radius:var(--r-pill); }  /* filter, not action */
.seg       { border-radius:var(--r-pill); }                        /* filter */
.healthx-button        { min-height:32px; padding:0 12px; border:1px solid var(--line-2);
                         border-radius:7px; font:500 12px/16px; }  /* newest page's action button */
.pcr-trace-lookup button { min-height:28px; padding:0 9px; border-radius:7px; font:520 9.75px/1 var(--font); }
.healthx-frame { border:1px solid var(--line-2); border-radius:12px; background:var(--panel); }
```

So the live house is: **12px = primary CTA · 7px = compact row action · 12px = data frame ·
999px = filters and switches.** I introduce no fourth radius (§7.2).

### The three switches that already ship — all 999px, all lying

```css
/* styles.css:4324 */
.switch { width:42px; height:24px; border-radius:999px; background:var(--line-2); transition:background .15s; }
.switch::after { top:2px; left:2px; width:20px; height:20px; border-radius:50%; background:#fff;
                 box-shadow:var(--shadow-sm); transition:transform .15s; }
.switch.on { background:var(--accent); }
.switch.on::after { transform:translateX(18px); }
.switch.on.danger { background:var(--up); }        /* "danger" is GREEN. */

/* styles.css:10496 */
.toggle { ... } .toggle.on { background:var(--accent); } .toggle.on .knob { transform:translateX(16px); }

/* styles.css:19837 — "the owner's borrow kill-switch" */
.bwx-switch2 { width:42px; height:25px; border-radius:999px; background:var(--line-2); }
.bwx-switch2 span { top:3px; left:3px; width:19px; height:19px; border-radius:50%; background:#fff;
                    box-shadow:0 1px 2px rgba(15,23,42,.25); }   /* hardcoded shadow, off-token */
.bwx-switch2.blocked { background:var(--down); }
```

**All three move the knob on click.** All three therefore assert the new state before any server has
said anything. All three are the exact defect this element exists to delete. `.switch.on.danger`
being `--up` (green) is the drift L10 forbids, in one line.

### The idiom I steal from the house — `.ghost-tile`

```css
/* styles.css:4371 */
.ghost-tile { border: 1.5px dashed var(--line-2); border-radius:14px; color:var(--muted); }
```
**In this house a 1.5px dashed `--line-2` edge already means "there is nothing real here yet."**
That is exactly what I need for "this reading is not canonical." I inherit it verbatim rather than
inventing a hatch, a stripe or an opacity.

### The real domain model (this is not a hypothetical control)

`web/src/lib/productIntegration/model.ts:475`:

```ts
export interface ProductControlRegistryEntry {
  readonly controlId: string; readonly backendCommandId: string;
  readonly wiringState: ControlWiringState;
  readonly currentDesiredValue: string;      // <- the two facts my element exists for
  readonly currentEffectiveValue: string;    // <-
  readonly currentStateRevision: string;     // <- Kubernetes `metadata.generation`, by another name
  readonly authority: string; readonly requiredPosture: string;
  readonly expiryPolicy: string; readonly reversibility: string;
  readonly effect: 'IMMEDIATE'|'DRAIN'|'RESTART'|'DEPLOYMENT';
  readonly disabledReason: string | null;
  readonly preview: Readonly<ProductControlPreview> | null;
  readonly latestResult: Readonly<ProductControlResult> | null;
}

export type ControlWiringState =
  | 'WIRED_LIVE' | 'WIRED_FIXTURE' | `PENDING_BACKEND:${string}` | 'OWNER_GATED' | `UNAVAILABLE:${string}`;

export type ControlResultStatus =
  | 'APPLIED' | 'ACCEPTED_ASYNC'
  | 'REJECTED_SCHEMA' | 'REJECTED_BOUNDS' | 'REJECTED_AUTHORITY' | 'REJECTED_STALE_REVISION'
  | 'REJECTED_STATE' | 'REJECTED_DEPENDENCY' | 'REJECTED_EXPOSURE' | 'REJECTED_NOT_SUPPORTED'
  | 'EXPIRED' | 'ALREADY_APPLIED' | 'FAILED_RECOVERABLE' | 'FAILED_ATTENTION_REQUIRED';

// commandResultState.ts:29
export type ProductCommandResultReconciliation =
  | { state:'NONE'; reasonCode:null } | { state:'PENDING'; reasonCode:null }
  | { state:'TERMINAL'; reasonCode:null }
  | { state:'AMBIGUOUS'; reasonCode:string } | { state:'INVALID_DURABLE_STATE'; reasonCode:string };
```

And the flow that already exists in `ControlRegistryPanel.tsx`, which my element must serve
without changing one line of its logic:

- `preview(control)` → `ProductControlPreview { previewId, digest, expectedRevision, expiresAtMs, synthetic }`
- a **revision watchdog** effect that kills a held preview the moment `currentStateRevision` moves:
  `setError('Control revision changed. Request a new preview before confirming.')`
- `submit()` re-checks `pending.expiresAtMs <= Date.now()` → `'Control preview expired.'`
- `prepareDurableCommandSubmission()` writes the identity to `localStorage` **before** the network
  call, so a crash mid-flight is recoverable; a `storage` event re-reconciles across tabs
- `reconciliationBlocksCommands(...)` — **an unresolved durable result on ANY control blocks EVERY
  control.** This is a global gate my element must render locally.
- integrity assertions that throw: `LIVE_CONTROL_RETURNED_SYNTHETIC_PREVIEW`,
  `LIVE_CONTROL_RESULT_IDENTITY_MISMATCH`
- `controlResultTruthLabel()` → `'NO_RESULT_TRUTH' | 'SYNTHETIC' | 'CANONICAL'`

The current render of these two facts, in full, is:

```tsx
<div><dt>Desired / Effective</dt><dd>{control.currentDesiredValue} / {control.currentEffectiveValue}</dd></div>
```

A slash. That is the thing I am replacing.

---

## 2. References — the specific mechanic taken from each

1. **WAI-ARIA APG — Switch Pattern.** https://www.w3.org/WAI/ARIA/apg/patterns/switch/
   Two rules taken as hard constraints, and one taken as a *prohibition that shapes the whole design*:
   (a) *"It is critical the label on a switch does not change when its state changes."* → my switch's
   accessible name is the control noun (`Kill switch`) forever; the **verb** lives on the separate
   action button, which is allowed to change. (b) `Space` toggles, `Enter` optional — I implement
   both because operators expect Enter. (c) **The switch pattern defines only `aria-checked`
   `true|false`. There is no `mixed`.** So when the server cannot tell us the position,
   `role="switch"` is *unrepresentable* — the element must stop being a switch. That is not a
   stylistic call; the a11y contract forces it (§4, `AMBIGUOUS`).

2. **Home Assistant — `assumed_state`.**
   https://community.home-assistant.io/t/after-2022-4-some-switches-transformed-from-toggle-to-2-button/418980
   Taken, exactly: *"When set to true, this will make the Home Assistant frontend show buttons for
   both ON and OFF actions, instead of hiding one of them."* HA ships, in production, at enormous
   scale, the rule **no readback ⇒ no toggle**. A device whose state cannot be read renders as two
   explicit push-buttons, because a knob at either end would be a claim. I take the rule and
   re-derive the *replacement* from this app's own doctrine rather than copying HA's two buttons
   (§7.5 — here, an unresolved result **blocks commands**, so the legal replacement is `Recheck`).

3. **Home Assistant frontend — Design review: Confirmation for toggles.**
   https://github.com/home-assistant/frontend/discussions/8905
   Taken, the maintainer's ruling verbatim: *"A toggle should toggle, you should not change that
   behavior"* and *"if a user adds a confirmation dialog to a switch, we should swap that with a
   button."* This is the sharpest statement of the trap I am in. My resolution (§3) is the only one
   that satisfies it: **the toggle really does toggle — it toggles _intent_, immediately and
   locally.** Effect is a separate fact on a separate mark. Nobody's contract is broken.

4. **NN/g — Toggle-Switch Guidelines.** https://www.nngroup.com/articles/toggle-switch-guidelines/
   Taken: *"Toggle switches should take immediate effect and should not require the user to click
   Save or Submit to apply the new state."* and *"Ensure toggle switches look like sliders and
   utilize visual cues (i.e. movement and color)"* and *"If immediate results aren't achievable, use
   radio buttons or a single checkbox."* Taken partly as a constraint I satisfy (intent flips
   immediately) and partly as a **rejected alternative I must beat**: I keep slider geometry because
   position at 40px of travel is the strongest pre-attentive binary encoding available, and I refuse
   the colour half because colour is spent elsewhere on this page (§7.4).

5. **Carbon Design System — Toggle usage.** https://carbondesignsystem.com/components/toggle/usage/
   Taken: *"Avoid using toggles if the action requires immediate feedback or confirmation"* and the
   read-only/disabled state split. Carbon separates *disabled* (you may not) from *read-only*
   (you may not **here**) — I use that split directly for `GATED` vs `BLOCKED_BY_OTHER`.

6. **Argo CD — Sync status vs Health status.**
   https://argo-cd.readthedocs.io/en/stable/faq/ and
   https://oneuptime.com/blog/post/2026-02-26-argocd-sync-status-vs-health-status/view
   The single most load-bearing reference. Taken: *"Sync status answers: 'Does the cluster match what
   is in Git?' Health status answers: 'Is the application actually working?'"* — two **independent
   dimensions**, and *"Treating them as a single status would obscure critical operational
   information."* Also taken: `Synced` / `OutOfSync` / **`Unknown`**, where Unknown means Argo
   *"cannot determine the sync status"* — i.e. drift itself can be unknowable, which is a third value
   my design must carry, not two. And the warning that collapsing them yields *"dashboards that look
   'green' when they should not."* My dual-mark track is that separation made geometric: the knob is
   health, the ring is sync.

7. **Kubernetes — `metadata.generation` vs `status.observedGeneration`.**
   https://alenkacz.medium.com/kubernetes-operator-best-practices-implementing-observedgeneration-250728868792
   Taken, the exact staleness test: *"observedGeneration is your controller's promise: 'I have seen
   generation = N and the conditions below describe that version of the spec.'"* and *"If
   ObservedGeneration is less than metadata.generation, the condition is stale."* This app already
   has both halves — `control.currentStateRevision` is `generation`, and
   `preview.expectedRevision` / the readback's revision is `observedGeneration`. So the rule
   **`readbackRevision !== currentStateRevision ⇒ the knob's position is not proven`** is not a UI
   guess, it is a comparison of two fields that already exist. This is what turns "stale" from a
   timer into evidence.

8. **AWS RDS console — `pending-reboot`.**
   https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_WorkingWithParamGroups.Modifying.html
   Taken: RDS splits parameters into *dynamic* (apply immediately) and *static* (apply only on
   reboot), and the console shows the parameter group *"with a status of pending-reboot"* — a
   first-class, persistent, per-resource state meaning **"we accepted your desire and it is
   genuinely not in effect."** Crucially it *"doesn't result in an automatic reboot"* — the console
   refuses to imply the gap will close by itself. That is my `ACCEPTED_ASYNC` / drift state, and it
   is the direct precedent for binding it to `control.effect` (`IMMEDIATE|DRAIN|RESTART|DEPLOYMENT`)
   so the drift line can say *what will close the gap*.

9. **Vercel Geist — Destructive Action Modal.** https://vercel.com/geist/destructive-action-modal
   Taken, three mechanics: (a) the **type-to-confirm gate** — *"Enter submits only when the gate is
   open; it's a no-op otherwise"*; (b) the loading contract — *"Both buttons disable; a spinner
   appears on the primary action while the API call proceeds"*; (c) the copy law —
   *"'Deleting my-project cannot be undone' is stronger than generic phrasing like 'This cannot be
   undone'"*, and *omitting* the irreversible band is how you signal reversibility. I bind (c) to a
   field that already exists: `control.reversibility` (`"Not reversible; restart is asynchronous."`).
   Real string, real gate — the gate turns on when that field starts with `Not reversible`.

10. **Vercel Geist — Switch, and StatusDot.** https://vercel.com/geist/switch ·
    https://vercel.com/geist/status-dot
    From Switch, taken as a **naming discipline**: Geist reserves the word *Switch* for a segmented
    selector and sends booleans to `Toggle` — *"For a boolean on/off setting, use `Toggle`. Switch
    implements radio semantics."* I keep the ARIA role `switch` (the W3C word) but name the CSS/
    component `ControlToggle`, so nobody wires this into a segmented control. From StatusDot, taken:
    *"the dot animates while BUILDING or QUEUED and goes static once the deployment reaches a
    terminal state"* — **motion means non-terminal**. My ring rotates only while an outcome is
    genuinely unresolved, and stops the instant the server speaks, at the same 1.6s rate the sibling
    status chip uses so the two elements read as one system.

11. **Rauno Freiberg — Web Interface Guidelines.** https://github.com/raunofreiberg/interfaces
    Five rules taken literally, one of which is a direct attack on my element:
    - *"Toggles should immediately take effect, not require confirmation"* — the attack. Answered in
      §3 and §5, not dodged.
    - *"Buttons should be disabled after submission to avoid duplicate network requests"* → the
      Confirm button disables on press, and the switch itself becomes `aria-disabled` in flight.
    - *"Disabled buttons should not have tooltips, they are not accessible"* → **no reason in this
      element is ever a tooltip**, and where no action is legal I render **no button at all** rather
      than a dead grey one.
    - *"Box shadow should be used for focus rings, not outline which won't respect radius"* → forced,
      because `styles.css:146` sets a global `:focus-visible { outline:2px solid var(--accent-line);
      border-radius:4px }` that would square the corners off a 999px capsule.
    - *"Animation duration should not be more than 200ms"* → knob travel is 160ms.

12. **LaunchDarkly — Approvals & Pending changes.**
    https://launchdarkly.com/docs/home/releases/approval-requests ·
    https://launchdarkly.com/docs/home/releases/scheduled-changes
    Taken: the *"Pending changes"* panel renders **the requested state of the flag alongside the
    current one** while approval is outstanding, with a count badge on the tab. Production proof that
    an operator audience reads "requested" and "live" simultaneously without confusing them —
    provided the requested value is visibly *not yet* the live one. Also taken: *"approved and
    applied changes take precedence over pending or requested changes"*, which is my conflict rule
    when `currentStateRevision` moves under a held preview.

13. **Emil Kowalski — Great Animations / practical tips.** https://emilkowal.ski/ui/great-animations ·
    https://emilkowal.ski/ui/7-practical-animation-tips
    Taken: `ease-out` for anything entering, keep UI motion **under 300ms**, and *"if users trigger an
    interaction hundreds of times daily... animations should be removed entirely."* Consequence: the
    knob animates (it moves rarely and the movement is the news); the ring does **not** fade in (it
    appears the instant intent exists — a fade would delay a truth); nothing loops on a settled
    control.

14. **Atlassian Statuspage — component status vocabulary.**
    https://support.atlassian.com/statuspage/docs/show-service-status-with-components/
    Taken: *"Under maintenance"* is a **peer** of the failure states, not a failure. A control being
    deliberately held by its owner is a different fact from a control being broken — which is why
    `OWNER_GATED` gets `--accent` (a decision, with an owner who can act) and never `--down`. Kept
    identical to the sibling status-chip's ruling so the two elements do not drift (L10).

15. **Grafana — No Data / Error states.**
    https://grafana.com/docs/grafana/latest/alerting/fundamentals/alert-rule-evaluation/nodata-and-error-states/
    Taken as a **negative** reference: Grafana renders absence-of-data using the base threshold
    colour, so a gap is indistinguishable from a value. My equivalent failure would be a knob resting
    at `OFF` because we have no reading. Closed by construction: **no reading ⇒ no knob.**

---

## 3. The structural finding, before any pixels

> Rauno: *"Toggles should immediately take effect, not require confirmation."*
> Home Assistant: *"A toggle should toggle."*
> NN/g: *"If immediate results aren't achievable, use radio buttons or a single checkbox."*
> This app: nothing takes effect immediately, ever. `preview → confirm → submit → durable readback`.

Three of the best sources on earth say I should not ship a toggle. The lazy readings are (a) ship one
anyway and lie, or (b) delete it and ship two lines of text. Both are wrong, and the reason is that
all three sources assume the switch has **one** state. This control has two, and the app already
names them: `currentDesiredValue` and `currentEffectiveValue`.

**A conventional switch is a single mark on a single axis. It has exactly one degree of freedom, so
it can express exactly one fact. Wherever you put the knob, you have made one claim. When there are
two facts, one mark must lie.**

Every conventional fix keeps one mark and decorates it — a spinner over the knob, the knob parked
mid-travel, the knob greyed. All of them still leave the knob *somewhere*, and wherever it is, it
reads as the answer.

So: **two marks on one axis.**

| mark | what it is | who owns it | when drawn |
|---|---|---|---|
| **knob** — filled disc | `currentEffectiveValue` | the **server**, only via readback | always, except when the position is unknowable |
| **ring** — hollow disc | intent (staged → requested → `currentDesiredValue`) | the **operator**, then the server | only when intent ≠ effect |

The distance between them **is** the disagreement, at full slider travel. When they agree the ring is
not drawn at all, so a settled control costs exactly the ink of a plain toggle and a wall of settled
controls is silent.

This resolves the contradiction cleanly. Pressing the toggle **does** take effect immediately —
it flips *intent*, which is a real, local, instantly-representable fact, and ARIA's
`aria-checked` binds to it. It never claims effect. `aria-describedby` carries effect as real text.
Rauno's rule, HA's rule, NN/g's rule and the truth doctrine all hold simultaneously.

And the three orthogonal questions get three orthogonal channels — Argo CD's separation, made
geometric:

| question | channel | encoding |
|---|---|---|
| Where is it? | **knob position** | left / right, 40px of travel |
| What was asked? | **ring position + ring stroke** | absent / dashed / dashed+rotating / solid |
| Do we trust the reading at all? | **track border** | solid hairline = canonical & fresh · `1.5px dashed` = not canonical |

Three channels, three questions. No channel encodes two things. No question needs two channels.

---

## 4. The state machine (derived from the code, not invented)

One `posture` enum computed **at the boundary**, never in render. 14 members, every one traceable to
a real field or a real code path in `ControlRegistryPanel.tsx` / `model.ts` / `commandResultState.ts`.

| posture | source condition | knob | ring | track | action button |
|---|---|---|---|---|---|
| `SETTLED` | `desired === effective`, readback rev matches, wiring `WIRED_LIVE` | at effective, filled | — | solid | — |
| `DRIFTED` | `desired !== effective`, no command in flight | at effective | **solid**, at desired | solid | `Preview` |
| `STAGED` | operator flipped intent; no preview yet | at effective | **dashed static**, at intent | solid | `Preview` |
| `ARMED` | `preview !== null`, unexpired, `expectedRevision === currentStateRevision` | at effective | dashed static | solid | `Confirm · 0:24` |
| `IN_FLIGHT` | `submit()` running / `reconciliation.state === 'PENDING'` | at effective | **dashed rotating** | solid | `Sending…` disabled |
| `ACCEPTED_ASYNC` | `latestResult.status === 'ACCEPTED_ASYNC'` | at effective | **solid**, at desired | solid | `Re-read` |
| `DENIED` | `latestResult.status` starts `REJECTED_` / `EXPIRED` | at effective | — (withdrawn) | solid | `Preview again` |
| `FAILED` | `FAILED_RECOVERABLE` / `FAILED_ATTENTION_REQUIRED` | at effective | — | solid | `Retry` / — |
| `AMBIGUOUS` | `reconciliation.state === 'AMBIGUOUS'` | **absent** | — | **dashed** | `Recheck result` |
| `INVALID_DURABLE` | `reconciliation.state === 'INVALID_DURABLE_STATE'` | **absent** | — | **dashed** | `Recheck result` |
| `STALE_READBACK` | readback revision ≠ `currentStateRevision` (K8s rule, ref 7) | at last-known, **`--muted`** | as applicable | **dashed** | `Re-read` |
| `SYNTHETIC` | `wiringState === 'WIRED_FIXTURE'` / `result.synthetic` | at effective | as applicable | **dashed** | as applicable |
| `GATED` | `wiringState === 'OWNER_GATED'`; `expiryPolicy: "No preview is issued."` | at effective | — | solid | **none** |
| `UNWIRED` | `PENDING_BACKEND:*` / `UNAVAILABLE:*` | **absent** | — | **dashed** | **none** |
| `BLOCKED_BY_OTHER` | `reconciliationBlocksCommands(reconciliation)` for a *different* control | at effective | as applicable | solid | **none** |

Three invariants hold across all fifteen rows:

1. **The knob's position is a pure function of `currentEffectiveValue`.** No posture moves it. There
   is no code path from a click to a knob translation. The optimistic bug is not "avoided" — it is
   *unrepresentable*.
2. **The knob is absent, not parked, whenever the position is unknowable.** An empty dashed capsule
   cannot be misread as either value, because there is nothing at either end.
3. **`DENIED` has no revert animation, because nothing ever moved.** The single best argument for
   the whole design: in every optimistic toggle the denial path is a visible snap-back that the
   operator must interpret. Here, denial withdraws a *ring* — a mark that only ever meant
   "requested" — and the knob has not twitched. Nothing to un-see.

---

## 5. Four variants — the variables I actually moved

### Variant A — "Instant switch with rollback" (the default answer, and what ships today)
**Variables moved:** optimism → **yes** · marks → 1 · motion → high (knob travel on press, spinner
overlay, snap-back on failure) · disclosure → toast · chrome → low · hierarchy → hue (`--accent` on) ·
truth channels → 0.

`.switch` / `.bwx-switch2` as they exist. Click → knob slides → spinner over the knob → on success it
stays, on failure it slides back and a toast says why. Every consumer product does this.

### Variant B — "Two-lane ledger" (delete the toggle)
**Variables moved:** geometry → **none, pure typography** · marks → 0 · density → 2–3 lines per
control · hierarchy → typographic weight · disclosure → always-on · alignment → label-left /
value-right on a numeric column (Screen 4's ledger) · state encoding → the sibling status chip ·
motion → none.

```
Kill switch                     Desired    ENGAGED
foundation/control              Effective  CLEAR      [ Blocked ]  [Preview]
```
Two right-aligned label/value rows plus a status chip. No switch at all. This is what the current
`<dt>Desired / Effective</dt>` wants to grow into.

### Variant C — "Dual-mark track" (the candidate)
**Variables moved:** marks → **2 on one axis** · optimism → **structurally impossible** ·
hierarchy → **fill weight** (filled disc = proven, hollow ring = requested) · trust → a **third
channel** on the track border · colour → **zero hue in every normal state**, luminance flip only ·
disclosure → progressive: the ring only exists when there is disagreement, the third text line only
exists when there is something true to say · motion → knob only, 160ms, only on readback ·
degradation → **stops being a switch** when the position is unknowable (forced by ARIA, ref 1).

### Variant D — "Hold-to-commit switch" (confirmation folded into the gesture)
**Variables moved:** input model → **gesture / dwell** · confirmation → **inside** the control ·
marks → 1 + a fill-progress arc · motion → **required** (the dwell progress *is* the affordance) ·
chrome → medium · disclosure → none until commit.

Press and hold the knob; a fill sweeps the track over 800ms; release early = nothing happened;
completion submits. Travel is the confirmation. (Refs: hold-to-confirm literature, and Geist's
type-to-confirm as the alternative gate.)

### Variant E — "Three-position segmented control"
**Variables moved:** geometry → **segmented, `.seg`** · positions → 3 (`Off` · `Transitioning` · `On`) ·
state encoding → which segment is lit · chrome → high (a permanent 3-cell frame).

The middle segment is the in-flight/drift state. Uses the house `.seg` idiom directly.

---

## 6. The fight

Density budget: the Control Registry renders `.pcr-control` articles with a 12-row `<dl>` each, and
the Watchdog page must show **8–20 controls at once** plus a global posture control in the header.
`.pcr-surface` rows are `min-height: 50px`; `.healthx-source-row` is `min-height: 70px`.

**A loses on doctrine, in one sentence.** It renders a state the server has not confirmed. Every
other criticism is secondary. But the secondary ones are damning too: the failure path is a
*snap-back*, which is the single most confusing micro-interaction in software — the operator sees the
new state, then sees it undone, and must reconstruct from a toast that has already begun to fade
whether the command applied and was reverted, or never applied at all. In this app that ambiguity is
not hypothetical: `AMBIGUOUS` is a real reconciliation state with a real `reasonCode`, and A has
nowhere to put it. A also cannot express `desired !== effective` **at rest** — the drift RDS calls
`pending-reboot` and Argo calls `OutOfSync`, which here is a persistent server-reported fact, not a
transient. A has exactly one mark and the state space has at minimum three values. It is
under-determined by construction. Dead.

**E loses next, and it loses on honesty of a different kind.** A three-position segment implies
`Transitioning` is a *place the system can be*, adjacent to Off and On. It is not — it is a statement
about our *knowledge*, and it composes with both positions: you can be transitioning *from* Off *to*
On while the effective value is still, definitively, Off. E throws that away and asserts the system
is in a third physical state. It also cannot express drift-at-rest (drift is not a transition;
nothing is moving), cannot express `AMBIGUOUS` (there is no segment for "we don't know"), and burns
a permanent 3-cell frame of chrome per row so that a wall of settled controls is a wall of boxes —
Screen 1's "hierarchy from fill alone" inverted into "hierarchy from a permanent container." And
`.seg` is the house's **filter** idiom (`.seg button.on.buy`), so it reads as a view switcher, not a
mutation. Affordance lie. Dead.

**D loses on accessibility and on touch, and it loses irrecoverably.** A dwell gesture has no
keyboard equivalent that is not a fabrication — "hold Space for 800ms" is not in any pattern, is not
discoverable, and collides with the browser's own key-repeat. It has no screen-reader story at all:
`role="switch"` promises Space *changes the state*, and D's Space does nothing for 800ms and then
mutates production. On touch it is indistinguishable from a scroll-start. And the fatal one: D solves
only the *confirmation* problem. After the dwell completes, the command is in flight, and D still has
one mark and still must decide where to put the knob — the original problem, untouched, now with a
gesture bolted on. It also cannot use Geist's type-to-confirm gate for the `"Not reversible"` controls
because there is nowhere to type. It is a confirmation mechanism masquerading as a state display.
Dead.

**B loses on density and on pre-attentiveness — but it donates the row's skeleton.** B is *honest*;
that is not the problem. The problem is that it takes 2–3 text lines per control to say what a
position says instantly, and at 20 controls that is a 60-line wall of prose in which nothing is
scannable. A slider position is **pre-attentive**: the eye resolves left-vs-right across twenty rows
in a single fixation without reading a word. `ENGAGED` vs `CLEAR` — two words of similar length,
similar shape, same weight, same colour — is not; it costs a saccade and a read per row, O(n) every
glance, and the operator who needs this page most is reading it at 3am under pressure. B also has no
way to show *the relationship* between the two values: it prints them on separate rows and leaves
"do these agree?" as a comparison the reader performs, twenty times. **What B donates and I keep:**
the ledger discipline for the text that survives — label-left, value in the second column, tabular
figures, and the rule that the truth line is real selectable DOM text, never a tooltip.

**C wins.** The deciding argument is that it is the only variant in which the defect is
*unrepresentable* rather than *avoided*.

There is no code path in C from a user event to a knob translation. `knobPosition = f(currentEffectiveValue)`
is a pure function of a server-owned field; the press handler cannot reach it. In A, D and E, the
correct behaviour is a discipline that a future contributor can break with one line. In C, breaking
it requires deleting the component's structure. That is the difference between a convention and an
invariant, and on an evidence-gated surface only the invariant is worth anything.

Ink budget, 20 controls, 1460px viewport:

| scenario | C draws | A draws | B draws |
|---|---|---|---|
| 20 settled | 20 plain capsules, **no rings, no hue, no third line** | 20 capsules in `--accent` fill | 40 lines of prose |
| 18 settled + 2 drifted | 2 rings + 2 third-lines — the **only** two rows with an extra mark | identical to settled; drift is invisible | 40 lines; drift found by reading |
| 1 ambiguous | 1 **empty dashed capsule** — the only row with no knob on the whole page | knob parked at a guessed value | 2 lines of prose |

The ambiguous row in C is the loudest thing on the page **because it is the emptiest**. That is the
truth doctrine expressed as ink, and no other variant can do it.

### C against the DNA laws

- **L1 — hierarchy from fill and weight.** Filled disc (proven) vs hollow ring (requested) is a fill
  ladder. `ON` vs `OFF` is a luminance flip of the track fill — Screen 1's "Continue" button law
  verbatim: *hierarchy comes from FILL alone*. Size, radius and weight are constant across all
  fifteen postures; a posture change never reflows a row.
- **L2 — one radius language for actions, one for data.** I introduce **no** radius. The capsule is
  999px because all three existing house switches are, and because a capsule with a circular knob is
  a *geometry*, not a radius choice. The action button takes `--r-sm`; the confirm bar takes
  `--r-md`, the same 12px as `.healthx-frame`. (Open question 1 — the two nearest neighbours ship a
  `7px` literal. One of us has to move.)
- **L3 — one accent per surface, spent deliberately.** The toggle spends **zero** colour in every
  normal state — `SETTLED`, `DRIFTED`, `STAGED`, `ARMED`, `IN_FLIGHT`, `ACCEPTED_ASYNC`,
  `AMBIGUOUS`, `STALE`, `SYNTHETIC` are all neutral. `--down` appears on **denial text only**, never
  on the track. `--accent` appears on **`OWNER_GATED` text only**, matching the sibling status chip's
  ruling exactly. The page's one accent stays the page's one accent.
- **L4 — everything on a scale.** §9 is a line-by-line audit; the whole geometry derives from two
  inherited literals (`20px` chip height, `3px` `.bwx-switch2` inset).
- **L5 — tabular figures, aligned numbers.** The countdown, ages and revisions are `tabular-nums`,
  and the countdown gets a fixed `min-width` in `ch` so `0:24 → 0:09` cannot resize its button.
- **L6 — marks carry meaning, on a fixed gutter.** The 60px track is a fixed left gutter; every row's
  knob and ring share two exact x-positions across the whole table. Zero icons, zero emoji. The only
  non-text pixels in the element are the capsule, the knob and the ring.
- **L7 — consequence, not platitude.** §8's denial table maps every `REJECTED_*` code to a sentence
  that names what happened, what is required, and — always — **"Nothing was applied."**
- **L8 — middle truncation.** `currentStateRevision`, `previewDigest`, `commandId` and
  `idempotencyKey` are identifiers an operator pastes into an incident ticket. All four are
  middle-truncated in `--mono` so both ends stay verifiable: `4c1f…8e02`, `ui:global.kill-…c7d1e9`.
- **L9 — subordinate context on its own line.** Effect gets its own line under the name. The reason
  gets a third line, and only exists when there is one. Nothing is crammed into the switch.
- **L10 — same semantic level, same weight.** The truth line and the reason line are the same size,
  weight and colour, because they are the same class of fact. The ring's rotation rate (1.6s linear)
  and the accent/adverse assignments are taken **verbatim from the sibling status chip** so the two
  elements read as one vocabulary.

---

## 7. Adversarial pass 1 — hunting the decorative and the generic

**7.1 The drift bar — cut.** The draft drew a 2px bar along the centreline spanning knob→ring, to
"make the pair read as one relationship." It is a third mark that restates a gap the eye already
measures, it is the only purely-graphic element in the design, and at settled-heavy walls it is one
more thing to render. **Cut.** Two marks, one filled one hollow, at opposite ends of 40px of travel,
is already the complete statement and it survives greyscale unaided.

**7.2 Am I inventing a radius? No — and the reasoning matters.** The house has `12px` (`.cta-pill`,
`.healthx-frame`), `7px` (`.healthx-button`, `.pcr-trace-lookup button`), `999px`
(`.chip`, `.seg`, and all three existing switches). A capsule track is not a radius decision; a
switch is a capsule the way a checkbox is a square. I inherit 999px from `.switch`/`.toggle`/
`.bwx-switch2` and choose nothing. My action button and confirm bar take `--r-sm` / `--r-md`, both
existing tokens. **Net new radii: zero.**

**7.3 Height must be derived, not decreed.** Per Nord's rule (via the sibling doc): the track height
is `20px` because that is the sibling status chip's derived height (`16px` line-height + `2 × 2px`),
and the two elements **sit in the same row and must have identical optical weight** (L10). Knob =
`calc(track − 2 × inset)`; travel = `2 × track-height`; width = `knob + travel + 2 × inset`. Two
inherited inputs, four derived outputs, zero magic numbers.

**7.4 Why the ON track is `--text` and not `--accent`.** Three reasons, and the third is the real one.
(a) L3: the page's accent is already spent by the sibling chip on `OWNER_GATED`; a wall of blue
capsules would spend it twenty more times. (b) The house's own `.switch.on.danger { background: var(--up) }`
proves what happens when a switch tries to carry semantic hue: green means "danger". (c) **For a
posture control, ON is not "good."** Kill-switch `ENGAGED` is ON and is protective-but-adverse;
intake `PAUSED` is ON and is a held state; safe-mode is ON and is neither. There is no hue that is
correct for "ON" across this registry, so **hue is the wrong channel** and luminance is the right
one. `ON` = track `--text`, knob `--bg`. `OFF` = track `--tile` + `--line-2` hairline, knob `--panel`
+ hairline. A pure luminance flip: survives protanopia, deuteranopia, tritanopia, achromatopsia,
greyscale print, and a 40%-zoomed wall display.

**7.5 `AMBIGUOUS` is where the design earns its keep — and ARIA decides it, not taste.** The APG
switch pattern defines `aria-checked` as `true|false`; **there is no `mixed`**. So when
`reconciliation.state === 'AMBIGUOUS'` there is no legal value to write, and `role="switch"` is
literally unrepresentable. The element must degrade. Home Assistant's `assumed_state` gives the
production precedent (two explicit push-buttons); this app's own rule gives the correct replacement,
which is *not* two buttons: `reconciliationBlocksCommands()` means **no command may be issued while a
durable result is unresolved**, so rendering On/Off buttons would offer an action the domain forbids.
The legal degradation is:

```
role="group"  →  [ empty dashed capsule, aria-hidden ]  "Position unknown"
                 "Command ui:global.kill-…c7d1e9 was sent; its result could not be read.
                  It may or may not have applied. No other control can be commanded until this resolves."
                 [ Recheck result ]
```

The capsule stays visible and stays empty. An empty capsule is the only rendering that cannot be
misread, and it keeps the row's 60px gutter aligned with every other row (L6).

**7.6 The reason is never a tooltip, never a toast.** Rauno's *"disabled buttons should not have
tooltips"* generalised: a truth-bearing reason must survive screenshot, print, touch, screen reader
and copy-paste into an incident channel. It is a DOM sibling in reading order, `user-select: text`,
ellipsised by CSS on overflow with the **full string still in the DOM** — never a JS-truncated
string, which destroys evidence rather than hiding it. Toasts are banned in this element outright.

**7.7 No shadows, no glows, no gradients, no scale transforms.** `.bwx-switch2 span` ships
`box-shadow: 0 1px 2px rgba(15,23,42,.25)` — an off-token hardcoded shadow — and `.switch::after`
ships `var(--shadow-sm)`. Both are dropped. In dark, the house sets `--depth: 0 0 0 0` and the sheet
says *"Zero specular/glass glare"*; a shadowed knob would contradict the sheet's own doctrine on half
the app. The knob is separated from the track by luminance alone, which is the same mechanism as
everything else in this element.

**7.8 Weight and size are constant across all fifteen postures.** Rauno: *"Font weight should not
change on hover or selected state to prevent layout shift."* Generalised to state: a live poll
flipping `SETTLED → DENIED` must not nudge the row. Only the *third line's existence* changes row
height, and that is the point — a row grows only when there is a new fact in it.

---

## 8. Adversarial pass 2 — the pass that changed the design

**8.1 "Stale" was a timer. It must be a comparison. (This changed the component's props.)**
The draft demoted a readback to `--muted` after an age threshold — a UI guess, i.e. exactly the thing
the truth doctrine exists to prevent. Kubernetes (ref 7) supplies the real test, and this app already
has both fields:

> **`readback.revision !== control.currentStateRevision` ⇒ the knob's position is not proven.**

`currentStateRevision` is `metadata.generation`; the readback's revision is `observedGeneration`. If
they differ, the spec moved after the last observation and the observation describes a **previous**
version of the control. Age is then *reported* (`last proven 41m ago`) but it is not what *decides*.
Consequence: the component takes `readbackRevision` as a **required** prop. If a caller cannot supply
it, the caller does not have proof, and the correct render is `STALE_READBACK` — never `SETTLED`.
This also closes the case the code already knows about: the revision-watchdog effect in
`ControlRegistryPanel.tsx` kills a held preview when the revision moves; my toggle now shows *why*
in the same instant, on the same row, instead of a page-level error string.

**8.2 A stale or synthetic knob may never render the proven fill.** Copied verbatim in spirit from
the sibling chip's governing law (*"a stale chip may never render the affirmative tone"*). Here:
`STALE_READBACK` and `SYNTHETIC` render the knob in `--muted` on a **dashed** track, and the truth
line leads with the demotion — `Effective CLEAR · last proven at rev 4c1f…8e02, 41m ago · current
rev 9a2b…11c4`. Evidence that describes a superseded revision is not evidence of the current one.
Demotion never promotes: a `DENIED` result does not become less true with age.

**8.3 Synthetic is not a decoration on top of live — it is a different track.** `WIRED_FIXTURE`
controls return `synthetic: true`, and `ControlRegistryPanel` *throws* if a live control returns a
synthetic result (`LIVE_CONTROL_RETURNED_SYNTHETIC_PREVIEW`). The app treats the distinction as an
integrity invariant, so the UI must too. Both `SYNTHETIC` and `STALE_READBACK` take the dashed track
because they answer the same question identically — *"is the knob's position canonical production
truth?"* — with the text saying which. That is **one** fact on **one** channel, not an overload.

**8.4 Dashed-static vs dashed-rotating fails `prefers-reduced-motion`.** The draft distinguished
`ARMED` (staged, not sent) from `IN_FLIGHT` (sent, unresolved) by rotation alone. Under
`prefers-reduced-motion: reduce` those two collapse into one mark, and the difference between
"nothing has left this browser" and "a mutation is in flight against production" is the most
important distinction in the entire element. Fixed: the **state word is always present** and always
carries it (`Armed` vs `Sending…`), the button label carries it a second time (`Confirm · 0:24` vs
`Sending…`), and rotation is a **third, redundant** cue that may be removed without loss. Motion is
never the only channel — which is the same rule that made the sibling chip forbid a glyph-only mode.

**8.5 Focus ring — the house global would square my capsule.** `styles.css:146` ships
`:focus-visible { outline: 2px solid var(--accent-line); outline-offset: 2px; border-radius: 4px; }`.
On a 999px capsule that paints a 4px-radius rectangle around a pill. I override with a box-shadow
ring (`0 0 0 2px var(--panel), 0 0 0 4px var(--accent-line)`), which is exactly Rauno's reason for
preferring box-shadow: *"outline… won't respect radius."* This is a **real defect in the house
sheet** that every pill-shaped focusable element in the app currently has — flagged in Open
Questions.

**8.6 The confirm gate must be bound to a field, not to a vibe.** Geist: omitting the irreversible
band is how you signal reversibility, and *"'Deleting my-project cannot be undone' is stronger than
generic phrasing."* `control.reversibility` is a real string on every entry
(`"Not reversible; restart is asynchronous."` · `"Reversible; release never resumes intake."`).
Rule: if it matches `/^Not reversible/`, the confirm bar mounts the **type-to-confirm** input
(the phrase is `control.label` lowercased) and renders the irreversibility line quoting the field
verbatim. Otherwise, plain Confirm and **no band at all**. The gate is data-driven and auditable.
The confirm bar also shows `previewDigest` middle-truncated — the operator confirms a digest, and a
digest that is fully elided cannot be checked against the receipt afterwards (L8).

**8.7 Denial copy — the table. Every line states the consequence and says whether anything applied.**

| `ControlResultStatus` | rendered reason |
|---|---|
| `REJECTED_AUTHORITY` | `Denied. This control requires {requiredPosture}; your authority is {authority}. Nothing was applied.` |
| `REJECTED_STALE_REVISION` | `Denied. The control changed to rev {new} while you were confirming. Nothing was applied — preview again.` |
| `REJECTED_EXPOSURE` | `Denied. Capital is exposed and {requiredPosture} is required. Nothing was applied.` |
| `REJECTED_DEPENDENCY` | `Denied. A dependency is not in a state that permits this. Nothing was applied.` |
| `REJECTED_BOUNDS` | `Denied. The value is outside {safeBounds}. Nothing was applied.` |
| `REJECTED_STATE` | `Denied. The control is not in a state that accepts this command. Nothing was applied.` |
| `REJECTED_SCHEMA` / `REJECTED_NOT_SUPPORTED` | `Denied. The backend rejected the command shape ({backendCommandId}). Nothing was applied. This is a wiring defect, not an operator error.` |
| `EXPIRED` | `Preview expired before you confirmed. Nothing was applied.` |
| `ALREADY_APPLIED` | `No change. The effective value was already {value} — the command was idempotent.` |
| `FAILED_RECOVERABLE` | `Failed. The command reached the backend and did not complete. Effective value is unchanged. Retry is safe — the idempotency key is reused.` |
| `FAILED_ATTENTION_REQUIRED` | `Failed. Attention required — {reasonCode}. The effective value below may not reflect the system. Do not retry; escalate to {owner}.` |
| `ACCEPTED_ASYNC` | `Accepted. Not yet in effect — this control's effect is {effect}. Nothing closes this gap automatically.` |

The last line is AWS's `pending-reboot` lesson (*"doesn't result in an automatic reboot"*) bound to
`control.effect`. Never *"please wait"* — always *what must happen for the gap to close*.

**8.8 States I had forgotten.**
- **`BLOCKED_BY_OTHER`.** `reconciliationBlocksCommands()` is global: one control's unresolved
  durable result freezes every control. Every affected row must say so **and name the blocker**, or
  the operator sees twenty controls with no buttons and no explanation. Carbon's *read-only* (you may
  not **here**), not *disabled* (you may not).
- **Cross-tab.** The panel listens for `storage` events on `PRODUCT_COMMAND_RESULT_STORAGE_KEY_PREFIX`.
  A second tab confirming a command must move this tab's ring/knob. So the component is a pure
  function of props with no internal mirror of server state — the only internal state is
  `stagedIntent`, which is cleared whenever `currentStateRevision` changes.
- **Reload mid-flight.** The identity is written to `localStorage` **before** the fetch. On mount,
  `readDurableCommandResultIdentity()` may return `PENDING` → the correct first paint is
  `IN_FLIGHT`, **not** `SETTLED`. Enforced by making `reconciliation` a required prop with no
  default.
- **`forced-colors: active`.** Windows High Contrast drops backgrounds, killing the luminance flip.
  Handled: the track keeps a `1px solid` border, `ON` takes `background: Highlight` with the knob at
  `Canvas`, `OFF` takes `background: Canvas` with the knob at `CanvasText`, and the ring uses
  `currentColor`. The state word is present regardless, which is why the encoding survives.
- **Text selection inside an interactive row.** `.healthx-source-row` is a `<button>`. Where the
  toggle sits inside one, `user-select: none`; standalone, `user-select: text` so the truth line can
  be pasted into a ticket.
- **First paint must not animate.** Twenty knobs sliding in on mount would be a wall of motion and
  would imply twenty state changes. Knob transition is gated on a previous-value ref.
- **Zero-height reasons.** A posture that requires a reason but receives none renders
  `Reason missing`, `--down`, plus a dev-time console error. The doctrine is a runtime invariant, not
  a review convention.

**8.9 Final sweep for anything generic.** Removed in this pass: the drift bar (7.1), the knob shadow
(7.7), a `--accent` ON fill (7.4), a fade-in on the ring (a truth appearing must not be delayed), a
progress bar under the `Confirm · 0:24` countdown (a second encoding of a number that is already on
screen), a `title` attribute anywhere (7.6), and an `opacity: .5` disabled treatment on the switch
(opacity reduces the contrast of a *truth display*; `aria-disabled` + `cursor: default` + the state
word carry it instead — and per Rauno the dead-button case is solved by rendering **no button**).

---

## 9. Value audit — every number, and where it came from

| value | source |
|---|---|
| `20px` track height | the sibling status chip's derived height (`16px` line-height + `2 × 2px`) — the two elements share a row and must share optical weight (L10) |
| `3px` inset | `.bwx-switch2 { top:3px; left:3px }` — inherited literal, the house's own switch |
| `14px` knob | **derived**: `calc(20px − 2 × 3px)` |
| `40px` travel | **derived**: `calc(2 × 20px)` — the knob traverses two track-heights, a ratio, not a number |
| `60px` width | **derived**: `calc(14px + 40px + 2 × 3px)`; 3:1 aspect. Wider than the house's 42px switch *because it carries two facts instead of one* — the extra width is the extra fact |
| `1.5px` ring stroke / dashed track | `.ghost-tile { border: 1.5px dashed var(--line-2) }` — the house's existing "nothing real here yet" idiom |
| `1px` track hairline | `--line-2`, the house hairline everywhere |
| `12.5px / 510 / 16px` name | `.healthx-source strong` |
| `11.5px / 420 / 16px` truth + reason lines | `.healthx-evidence`, `.healthx-state` |
| `11.5px / 500` state word | `.healthx-current strong`, and identical to the sibling status chip |
| `10px` mono revisions | `.pcr-trace li code { font: 500 10px/14px var(--mono) }` |
| `10px` row gap | `.healthx-source { gap: 10px }` |
| `--r-sm` (8px) action button | token. (Neighbours ship `7px` — Open Question 1) |
| `--r-md` (12px) confirm bar | `.healthx-frame { border-radius: 12px }` |
| `999px` track | `.switch`, `.toggle`, `.bwx-switch2` — all three house switches |
| `160ms ease-out` knob | under Rauno's 200ms and Emil's 300ms; the house's own `.switch` uses `.15s` |
| `1.6s linear` ring rotation | **identical to the sibling status chip's in-flight rate** (L10 across elements) |
| `28px` button height | between `.pcr-trace-lookup button` 28px and `.healthx-button` 32px — the compact row-action size, and 28px is the exact live value in the panel I mount into |
| `5ch` countdown min-width | derived from the longest countdown string `0:59` + separator; prevents L5 jitter |

**No new hex literals. No new tokens outside the `--wdt-` namespace. No value chosen by eye.**

---

## 10. Implementation

- Component: `web/src/features/watchdog/ControlToggle.tsx`
- Styles: `web/src/features/watchdog/styles/controlToggle.css` (tokens are `--wdt-` prefixed and
  collide with nothing; they may equally be appended to the `:root, [data-theme="light"]` /
  `[data-theme="dark"]` blocks in `styles.css`)
- Posture is computed by a pure `controlTogglePosture(entry, reconciliation, readbackRevision)` in
  `web/src/features/watchdog/controlTogglePosture.ts` — **not** in render, and unit-testable against
  the fifteen rows of §4.
- The state word and reason text reuse the sibling status chip's ink assignments verbatim.
- Once migrated, delete `.switch` / `.switch.on.danger`, `.toggle`, `.bwx-switch2` and the
  `<dt>Desired / Effective</dt>` slash row in `ControlRegistryPanel.tsx`.

Full CSS and markup are in the structured deliverable.

---

## 11. Open questions for the fleet

1. **7px vs `--r-sm` (8px).** `.healthx-button` and `.pcr-trace-lookup button` both ship a `7px`
   literal; the token is `8px`. My action button sits directly beside both. A 1px drift between
   adjacent controls is exactly the L10 drift this fleet exists to kill — either those two migrate to
   `--r-sm`, or `--r-sm` becomes 7px. Someone must rule; I will not ship a third value.
2. **The global focus-ring defect.** `styles.css:146` forces `border-radius: 4px` on every
   `:focus-visible` outline, which squares the corners on every pill in the app (`.chip`, `.seg`,
   `.switch`, `.cta-pill`, my track). I override locally with box-shadow, but this should be fixed at
   the root instead of patched fifteen times.
3. **Who owns `readbackRevision`?** My design makes it a required prop and treats its absence as
   unproven. Something upstream must stamp every readback with the revision it observed. If the
   transport does not carry it today, that is a **backend** change, and until it lands every live
   control correctly renders `STALE_READBACK` — which will look like a regression and is not one.
4. **Row width.** The 60px track plus a 28px action button costs ~150px of the row. `.pcr-control`
   currently spends its width on a 12-row `<dl>`. If the Watchdog table cannot spare it, the fallback
   is travel = `1 × track-height` (40px total width, 6px mark separation) — but the drift becomes
   much harder to see at a glance, which is most of the design's value. Needs the table owner.
5. **Does the sibling status chip appear in the same row as this toggle?** If yes, the chip's
   `OWNER_GATED` accent and my `GATED` accent are the same fact rendered twice. My preference is that
   the toggle owns control posture and the chip owns component health, and the two never describe the
   same subject in the same row.

---
---

# ROUND 2 — the panel round

Round 1's winner (Variant C, the dual-mark **switch**) is **superseded**. It survived twenty-two of
the panel's twenty-four defects as repairs. It did not survive #9, and #9 killed it.

Everything below supersedes §§5–11 above where they conflict. §§1–4 (house tokens, the state
machine derived from the code) stand, with two corrections noted in §13.

---

## 12. Verification log — what I re-checked in the tree before answering

Every panel claim was re-run against the working tree. The panel was right about more than it knew,
and wrong about two things in ways that matter.

| # | claim | verdict |
|---|---|---|
| 1 | chip is `--r-sm`, toggle was `--r-pill`, same 20px box | **confirmed** — `status-chip.md:364-366` |
| 2 | ring rotation collides with the chip's ring | **obsolete** — the chip shipped Round 2 and *deleted* its rotation (see §13.2) |
| 3 | `readbackRevision` has zero hits in the tree | **confirmed** — and a better field already exists (§13.1) |
| 5 | `* { box-sizing: border-box }` at `styles.css:119`; the `-1px` fudge is real | **confirmed** |
| 6 | "zero spacing tokens exist" | **wrong now** — `tokens.md §7.1` ships `--sp-1..9`, and `statusChip.css` already consumes them |
| 8 | `.pcr-emergency-control` repaints my button solid red, and solid **green** when engaged | **confirmed verbatim**, `productControlRoom.css:200-203` |
| 12 | `AMBIGUOUS` and `UNWIRED` render identically | **confirmed** |
| 14 | `APPLIED` and `ALREADY_APPLIED` are real `ControlResultStatus` members with no posture | **confirmed**, `model.ts:86-100` |
| 15 | `receiptId` exists and my design dropped it | **confirmed**, `model.ts:441` |
| 17 | `.healthx-evidence` is `nowrap/ellipsis`; my rule was `overflow-wrap: anywhere` | **confirmed** |
| 24 | `targetType` is used only for prose | **confirmed** — and there are **four** values, not three: `SYSTEM · COMPONENT · TICKET · RECOVERY_PLAN` (`model.ts:1496,1529,1541,1557`) |

Two corrections to the panel, with evidence:

**Panel #2 is obsolete, and its lesson is bigger than it thought.** `statusChip.css` shipped its
Round 2 with a header that reads, verbatim: *"Motion is DELEGATED. motion.css owns every duration,
the row change mark, the poll-liveness rail and the focus ring. This file declares no duration and
no keyframe, and there is no `proving` prop: a fetch in flight is a property of the poll, not of the
state."* The collision is gone because the chip stopped rotating. The correct fix is therefore not
"pick a different motion" — it is **to declare no motion at all**, exactly as the chip did. This
element now ships **zero `@keyframes` and zero duration literals.** See §15.6.

**Panel #6 is out of date.** It quoted `tokens.md §1` finding (1) — a description of the *legacy*
house — as if it were the delivered scale. `tokens.md §7.1` ships `--sp-1: 2px … --sp-9: 48px`,
`§7.2` ships `--fs-*`/`--lh-*`/`--fw-*`, `§7.3` ships `--ink-1..3`/`--ink-mute`, and
`statusChip.css:37-52` already consumes all of them with fallbacks. The panel is right that my CSS
used raw literals; it is wrong that there was nothing to quantise to. Fixed by consumption, with the
same fallback idiom the chip uses so this ships before the migration lands and needs no edit after.

---

## 13. The two discoveries that rebuilt the element

### 13.1 The lease. `readbackRevision` does not exist — but something better already ships.

Round 1 invented `readbackRevision` and made it a required prop. Zero hits in the tree. The panel
correctly called that a design that cannot render its own normal state.

The replacement is not an invention. `model.ts:640-648`:

```ts
export interface CanonicalSupervisorOpsReadback {
  readonly source: 'CANONICAL_SUPERVISOR_READBACK';
  readonly observedAtUtc: string;
  readonly validUntilUtc: string;
  ...
}
```

and `model.ts:3074-3096` already *validates* it — `exactUtcSeconds(observedAtUtc)`,
`exactUtcSeconds(validUntilUtc)`, and a hard rejection when
`evaluatedAtValue - observedAtMs > 30_000`. `CanonicalOpsIntakeInterlock` carries the same shape
(`evaluatedAtUtc` + `readbackValidUntilUtc`).

**This is a lease.** The server does not merely stamp when it read; it declares how long its reading
remains its own claim. That is strictly stronger than Kubernetes' `observedGeneration` comparison I
took in Round 1, and it is the exact mechanic of `coordination.k8s.io/Lease`: `renewTime` plus
`leaseDurationSeconds`, where *"the Kubernetes control plane uses the time stamp of this field to
determine the availability of this Node."*

So the freshness test becomes:

```ts
const proofExpired = envelope.evaluatedAtMs >= Date.parse(opsReadback.validUntilUtc);
```

Two **server-stamped** numbers compared against each other. Consequences, all of them good:

- **The component never calls `Date.now()`.** Not once, outside the one preview countdown (§15.5).
  Round 1's `proven 12s ago` was a client-clock derivative and the panel was right to call it the
  age-based staleness my own anti-pattern list forbids. It is gone.
- The truth line prints **absolute wall clock** from `observedAtUtc`, which is already guaranteed
  exact-UTC-seconds by `model.ts:3074`. `read 14:22:31Z`. Static text. Nothing ticks.
- Freshness is not a UI judgement, a threshold, or a timer. It is the server's own published
  promise about its own reading, expiring on the server's own clock.
- The happy path renders. On day one. With today's transport.

Panel defects #3 and #4 are both closed by one field that was already in the envelope.

### 13.2 role=switch is unrepresentable for this control. Always. Not just for AMBIGUOUS.

This is the defect that ended Round 1, and it is the one I should have found myself.

Round 1's boast was that it derived the `AMBIGUOUS` degradation from the ARIA contract rather than
from taste: *there is no legal `aria-checked` for "we do not know", therefore `role=switch` is
unrepresentable, therefore this stops being a switch.* The panel simply ran that argument one step
further than I had the nerve to:

> Screen-reader users get Variant A. `aria-checked` binds to intent. The track is `aria-hidden`. So
> on a `DRIFTED` control, a screen reader announces *"Kill switch, switch, on"* while the machine is
> CLEAR.

That is correct, and it is fatal. Re-fetched this session, W3C APG says only: *"When `on`, the switch
element has state aria-checked set to `true`. When `off`, `false`."* **`aria-checked` carries one
boolean. This control has two booleans that are permitted to disagree.** A one-bit channel cannot
carry a two-bit fact. That is not a property of `AMBIGUOUS` — it is a property of *every* state of
this control. Round 1 applied its own strongest argument to one row and flinched from applying it to
the other fourteen.

Every downstream patch the panel proposed for #9 is a way of smuggling the second bit past a channel
that is defined to hold one. Putting `— effective CLEAR, requested ENGAGED` in the accessible name
fights APG's *"it is critical the label on a switch does not change when its state changes"* from the
other direction. There is no repair. There is only a different element.

And the moment you accept it, four other defects evaporate rather than get fixed:

| defect | how it dies |
|---|---|
| #1 radius war with the chip | a readout is a **data container** → `--r-sm`, agreeing with the chip instead of contradicting it |
| #9 screen readers get Variant A | there is no `aria-checked` to lie with |
| #13 `GATED` argued as disabled, never disabled | where no command is legal, **no button is rendered** — there is nothing to disable |
| #22 "no code path from a press to the mark" is a comment | there is **no press handler on the mark at all**. Not a convention. An absence. |

The two references I leaned on hardest in Round 1 were telling me this the entire time, and I quoted
them while doing the opposite. Home Assistant's `assumed_state`, verbatim from the developer docs:
*"Return True if the state is based on our assumption instead of reading it from the device."*
NN/g, verbatim: *"If immediate results are not achievable or seem ill-suited, an alternative should
be used instead."* Rauno: *"Toggles should immediately take effect, not require confirmation."*
This app has **no** immediate path — `previewCommand` → confirm → submit → durable readback, every
time, by design. The honest reading of all three references is not "reinterpret what the toggle
toggles." It is **do not ship a toggle.**

---

## 14. Round 2 variants — the variable is now the relationship between readout and command

Round 1 varied the *display*. That was the wrong axis; the display was never the problem. The
controlling variable this round is **where the command lives relative to the truth**.

### A′ — Bound switch (Round 1's winner, restated as the incumbent)
`role="switch"`, `aria-checked` = intent, dual marks, capsule at `--r-pill`.
**Loses on §13.2.** It renders Variant A into the accessibility tree — the exact optimistic claim
the whole design exists to make unrepresentable, reproduced verbatim in the one channel I did not
audit. Secondary: it must argue `--r-pill` against a sibling that already ruled `--r-sm` at the same
20px height, and it can never disable `GATED` without contradicting `role=switch`'s promise that
Space changes the state.

### G — Two-lane ledger (Round 1's B, re-run with the lease)
`Desired ENGAGED` / `Effective CLEAR` as right-aligned label/value rows, no geometry, buttons below.
**Still loses, for the same measured reason.** `ENGAGED` and `CLEAR` are two words of similar length,
similar shape, same weight, same ink — comparing them is a saccade and a read *per row*, O(n) on
every glance, at 3am. A mark at one of two x-positions is resolved pre-attentively across twenty rows
in one fixation. G also prints the two values on separate rows and leaves *"do these agree?"* as a
comparison the operator performs twenty times, which is precisely the failure Argo CD names:
*"Treating them as a single status would obscure critical operational information."* G donates its
text discipline, which I keep wholesale.

### J — Two buttons always (Home Assistant, verbatim)
Delete the geometry. Every control renders `Engage` and `Release` side by side plus a text value —
HA's literal `assumed_state` design.
**Loses, and losing is informative.** HA renders both buttons *because it cannot read the device*.
Here we usually **can** — the lease is valid, the readback is canonical, the effective value is
proven. Rendering both buttons unconditionally throws away a fact we hold, and it doubles the action
ink on every settled row so the page's chrome is dominated by commands nobody is issuing. But J is
right *inside its own precondition*, and that precondition is a real state here. The winner adopts
J's exact rule and fires it exactly when HA's condition holds — see §15.4. This is the variant the
panel said I never built; built, beaten, and partly absorbed.

### H — Command-log row
No persistent readout at all. The row is the last command: `APPLIED · receipt fixt…4b19 ·
CLEAR → ENGAGED · 14:22:31Z`, and the current value is inferred from `after`.
**Loses on the truth doctrine, subtly and badly.** `result.after` is what the command *reported*, not
what the system *is*. Inferring present state from the last receipt is exactly the drift Argo CD
splits sync from health to prevent — a control can apply successfully and then be changed by
something else, and H renders green forever. It also has no representation for a control that was
never commanded. It donates the receipt line, which Round 1 wrongly dropped (panel #15).

### F — Readout rail + explicit verb command **(WINNER)**
The capsule survives intact — same fixed gutter, same two marks on one axis, same pre-attentive
position, same trust channel. It stops being interactive. It has no `role`, no `aria-checked`, no
`tabIndex`, no `onClick`. It is a gauge. The command moves out to explicit, named, right-aligned
verb buttons whose labels are allowed to change because they are buttons.

*Variables moved vs A′:* interactivity of the mark (yes → **none**) · a11y contract (`switch` →
plain labelled text + buttons) · who owns the verb (the control → the button) · radius language
(action `--r-pill` → data `--r-sm`) · motion (owned → **delegated**) · number of hues (2 → 1) ·
blast radius (unencoded → a permanent neutral rule) · the invariant (a comment → the absence of a
handler).

**F keeps every argument that beat G and E in Round 1** — position is still pre-attentive, the two
marks still sit on one axis, the disagreement is still a visible distance — and pays for it with the
one thing that was already a fiction: that the toggle "toggles."

---

## 15. The winner, specified

### 15.1 It is a rail, not a pill — and that is what makes the affordance honest

Radius `--r-sm` on a 20px-tall rail reads as a superellipse. `status-chip.md:365` already argued
this at the identical height: *"`--r-sm` (8px) on a 20px box reads as a superellipse, unmistakably
not a pill."* The chip used it to avoid looking like the filter chips above it. I use it for the
same reason and one more: **a pill with a circular knob is the universal signifier of a thing you
press.** This is a thing you read. The marks are squircles at the same `--r-sm`, so the mark is a
miniature of its container — one radius, stated once, in an element that introduces none.

Two radii total: `--r-sm` for everything that displays, `--r-pill` for the action buttons. Exactly
the fleet's declared split. No third. My Round-1 open question about `7px` vs `--r-sm` is closed by
using the token; `.healthx-button`'s `7px` literal is now someone else's migration, not my problem
to replicate.

### 15.2 Geometry — derived, and provably border-independent

```
--wdt-h      = --lh-4 (16px) + 2 x --sp-1 (2px)          = 20px   <- identical derivation to the chip
--wdt-w      = 3 x --wdt-h                               = 60px   <- a ratio, not a literal
--wdt-mark   = --wdt-h - 2 x border - 2 x --sp-1         = 14px
--wdt-travel = --wdt-w - 2 x border - 2 x --sp-1 - --wdt-mark
```

Substituting: `travel = 3h - 2b - 2s - (h - 2b - 2s) = 2h`. **Travel is exactly two rail-heights,
and the border and inset terms cancel algebraically.** Panel #6 called `2 x height` a magic number
wearing a `calc()`; it is not — it is the derived consequence of "the rail is 3:1 and the mark is
inset symmetrically," and it stays correct if either term changes.

Panel #5's off-centre bug is closed twice over. First, marks are centred with `top: 50%` +
`translate: … -50%` against the padding box, so no border width can shift them. Second, **the rail's
border-width never changes** — only its *style*. `.ghost-tile` ships `1.5px dashed`; I deliberately
do not copy that literal, because a 0.5px width change on a 20px rail moves the mark by 1px, and the
chip's own §6.3 rule — *"all eight states occupy an identical box; a state transition must never
reflow a row"* — outranks matching a border-width from a 14px-radius tile. Style carries the meaning;
width is frozen.

### 15.3 Three channels, and a fourth silhouette that is the absence of the rail

| question | channel | values |
|---|---|---|
| Where did the server last prove it was? | **position of the effect mark** | near stop / far stop |
| What was asked, and is the server holding it? | **the intent mark** — drawn only on disagreement | absent · dashed (not established at the server) · solid (server holds it) |
| Is that proof still the server's claim? | **rail border style** | solid (in lease) · dashed (lease expired, or synthetic) |
| Is there a control here at all? | **the rail itself** | present · **absent** |

`dashed` means one thing in both places it appears: **not established as server truth.** Rail dashed
= this reading is not currently established. Intent mark dashed = this desire is not established at
the server. One rule, two sites (L10).

The fourth row is panel #12's fix, and it is grounded rather than asserted. Grafana's alerting model
— re-fetched this session — creates a `DatasourceNoData` alert instance and a `DatasourceError`
alert instance as **separate first-class objects**, not one grey box: *"the alert rule creates a new
`DatasourceNoData` alert instance"* / *"`DatasourceError` alert instance."* So:

- **rail solid, mark present** → live control, reading in lease.
- **rail dashed, mark present** → live control, the server's proof has expired. The mark stays
  **solid and at full ink** at its last proven position, because that is genuinely what was last
  proven. Round 1 muted it; that was wrong, and it violated `tokens.md`'s own rule that
  `--ink-mute` never carries truth. Demotion belongs on the container, not on the fact.
- **rail dashed, NO marks** → `AMBIGUOUS`. There is a control, we commanded it, we cannot read it.
  An empty rail cannot be misread as either position, because there is nothing at either end.
- **NO rail at all** → `UNWIRED` (`PENDING_BACKEND:*` / `UNAVAILABLE:*`). A control that does not
  exist does not draw a control. The gutter is blank, the whole row drops to `--ink-3`.

Four distinguishable silhouettes at a glance, for four categorically different facts. Round 1 had
two silhouettes for four facts and called the collision a victory lap.

**One more channel deleted.** Round 1 flipped the rail's *fill* between OFF and ON — a second
encoding of a fact position already carried. Cut. The rail is always a hairline container; only the
mark moves. This is quieter at twenty rows, it removes the ugly "a non-canonical reading must drop
the ON fill" special case entirely, and it frees ink weight to mean exactly one thing: **solid =
proven, hollow = requested.**

### 15.4 The command — one verb, or two, and the condition decides

Buttons are right-aligned and compact. Screen 4's law: alignment and width encode action weight.

| condition | rendered | why |
|---|---|---|
| in lease, position known | **one** button naming the transition: `Engage…` / `Release…` | we hold the fact; offering the no-op direction is noise |
| lease expired, or `WIRED_FIXTURE` | **`Engage…` and `Release…`, both** | Home Assistant's rule, fired exactly on Home Assistant's precondition: the state *is* "based on our assumption instead of reading it from the device" |
| `AMBIGUOUS` / `INVALID_DURABLE_STATE` | `Recheck result` only | `reconciliationBlocksCommands()` forbids every command; offering one would offer an illegal action |
| `GATED` (`OWNER_GATED`) | **nothing** | `expiryPolicy` is literally *"No preview is issued."* A decision you may not make is not a greyed button (Rauno: *"disabled buttons should not have tooltips, they are not accessible"*) |
| `BLOCKED_BY_OTHER` | **nothing** | Carbon's read-only, not disabled. The reason names the blocking command id |
| `UNWIRED` | **nothing** | the reason names the missing `backendCommandId`, so an engineer can act even though an operator cannot |

Using HA's two-button rule *conditionally* is strictly more informative than J's unconditional
version, and it is the same rule — I just also render the precondition.

The ellipsis is not decoration. Vercel's guidelines, verbatim: *"Menu options that open a follow-up
e.g. 'Rename…' … end with an ellipsis."* `Engage…` opens a preview; it does not engage. The
punctuation is the honest part of the label.

### 15.5 The clock column — and why exactly one number ticks on the whole page

`statusChip.css:43` reserves `--pc-clock-w: 76px` and its header calls it *"the page's one
right-aligned numeric column (L5), which is what finally makes twenty countdowns comparable."* I
join that column rather than mint one. Its contents:

- **at rest:** the lease, as absolute wall clock — `valid to 14:23:18Z`, tabular, right-aligned,
  **static**. No arithmetic, no ticking, no re-render.
- **while a preview is held:** the preview countdown `0:24`, counting.

Only one preview can be outstanding at a time. Therefore **at most one number on the page is ever
in motion.** That is the whole of panel #4's ticking objection, closed structurally.

The countdown is the single place this element reads a client clock, and it is explicitly *not* a
truth claim: expiry is also enforced server-side (`REJECTED_STALE_REVISION`, `EXPIRED`). The number
is an affordance; the server is the authority. Stated so nobody later "improves" it into evidence.

Panel #11: the Confirm button's label is **`Confirm`, immutable**. The countdown is a sibling
`aria-hidden` span on the same baseline with a `5ch` tabular min-width. A focused button whose
accessible name mutates once a second for twenty-four seconds is twenty-four interruptions from NVDA
while the operator is reading an irreversibility warning — and Round 1 quoted APG's label-stability
rule for the switch on one page and did exactly that to the button on the next. One polite
announcement fires at `0:10` and one at expiry. Nothing else.

### 15.6 Motion — this element declares none

`motion.css` owns `--mo-0…--mo-4`, the two house curves, `--mo-busy-appear/-min`, the
`[data-theme-switching]` kill switch and the focus ring. `statusChip.css` shipped Round 2 declaring
*"no duration and no keyframe."* This element does the same: **zero `@keyframes`, zero duration
literals, zero `animation`.**

The mark's travel is a `translate` transition consuming `--mo-2` (160ms) and `--mo-out` — the one
motion the fleet's motion owner has already ruled on, in `motion.md` soft-spot 4: *"The knob moves
only when the next evidence proves the mutation landed — the knob's motion IS the receipt."* Gated
on a previous-value ref so first paint never animates. `[data-theme-switching]` suppresses it
(Rauno: *"switching themes should not trigger transitions"* — Round 1's `background-color`
transition on the rail would have fired on every theme flip; it is gone with the fill flip).

In-flight has **no motion at all**. It is carried by the state word (`Sending…`, ellipsis per
Vercel) and the disabled Confirm button. Round 1 distinguished *staged* from *in-flight* by rotation
speed — which collapses under `prefers-reduced-motion`, taking with it the single most important
distinction in the element: *nothing has left this browser* versus *a mutation is in flight against
production*. Carrying it in a word instead of a rotation is not a compromise; it is the correct
carrier, and it makes `prefers-reduced-motion` a no-op that costs zero information.

### 15.7 The one hue, and where blast radius actually goes

Panel #24 is right that the element's scarce signal was spent on administrivia and that the row
which halts capital looks identical to the row that restarts a supervisor. It is wrong about the
fix.

The panel proposed a `--down` (`--bad`) left rule for `targetType === 'SYSTEM'`. I reject it, on the
element's own logic. `--bad` means *blocked / failed*. A system-scoped control is not failed — it is
**consequential**. Painting consequence in the failure hue conflates severity-of-state with
severity-of-scope, and it re-commits the exact sin this document opens by condemning:
`.switch.on.danger { background: var(--up) }` and `.pcr-emergency-control.engaged` painting an
**engaged kill switch green** — hue asserting a value judgement the evidence does not support.

Consequence is **mass**, not colour. `SYSTEM`-scoped controls get a permanent **2px left rule in
`--ink-1`** — the darkest neutral, always present in every posture, on a fixed gutter, so it can
never be confused with a state and it survives greyscale, protanopia and print. Four `targetType`
values exist (`SYSTEM · COMPONENT · TICKET · RECOVERY_PLAN`); only `SYSTEM` gets it.

That leaves the element with **exactly one hue**: `--bad`, on reason text only, for denial and
failure. `GATED` goes neutral `--ink-3` with the owner named in words — handing `--held` back to the
chip, which `status-chip.md:343` already spends exactly once on `OWNER_GATED`. My Round-1 open
question #5 is answered in the only direction that keeps L3 true across the pair.

### 15.8 The emergency cascade is mine to delete (panel #8 — blocking)

```css
/* productControlRoom.css:200-203, verified verbatim */
.pcr-emergency-control:not(.engaged) .pcr-control-action button:not(:disabled) { background: var(--down); color:#fff; font-weight:650 }
.pcr-emergency-control.engaged        .pcr-control-action button:not(:disabled) { background: var(--up);   color:#fff; font-weight:650 }
```

Specificity `(0,3,1)` beats `.wdt-action` `(0,1,0)`. On the emergency row my neutral `Engage…`
renders as a solid red 650-weight button, and once engaged, a solid **green** one. The panel is
right that this is not "outside my element" — it repaints my element, by inheritance, where no
reviewer of my diff would ever see it. Round 1's open question #8 spotted the left border and missed
the button rule entirely.

**Those four lines are deleted as part of this element's ticket**, and §15.7's neutral 2px rule
replaces them with something that does not claim an engaged kill switch is good news. The component
additionally refuses to render inside `.pcr-control-action`; it owns its own container.

---

## 16. Adversarial pass 3 — after the rebuild

**16.1 "You removed the switch. An operator will still try to click the rail."**
Real risk, and the mitigation must be structural, not a `cursor: default`. Three things: the rail is
a superellipse with squircle marks, not a pill with a knob (§15.1); it has no hover state, no focus
ring and no pointer cursor, so nothing rewards a hover; and the verb button sits on the same row with
a live, specific label. A control whose action is named in words two hundred pixels away does not
need the readout to be pressable. If usability testing still shows press attempts, the fix is a
larger verb button — never restoring the handler.

**16.2 "One button means the operator can only ever go one direction. What if they want to
re-assert the current value?"**
They cannot, and that is correct: `ALREADY_APPLIED` exists in `ControlResultStatus` precisely
because the backend treats a re-assert as a no-op. Offering an action whose defined outcome is "no
change" is offering nothing. When we genuinely do not know the position (lease expired), both
buttons appear — which is the only case where re-asserting has meaning.

**16.3 The reason line will reflow the table (panel #17).**
`.healthx-evidence` is `nowrap/ellipsis`; my Round-1 rule was `overflow-wrap: anywhere`, so the
`AMBIGUOUS` reason wraps to three lines and nudges every row beneath it on a poll. Fixed three ways:
the reason element is **always present** with `min-height: var(--lh-5)`, empty on settled rows, so
the row height is identical in every posture; it clamps to two lines; and the copy is authored to
fit two lines at the narrowest supported column, which I will prove at that width rather than assert.
The overflow goes to the row's existing detail disclosure — never a tooltip, never a toast.

**16.4 Identifiers: the CSS-only claim was false (panel #16).**
`text-overflow: ellipsis` clips at the *end*; there is no CSS middle-truncation, and Round 1 shipped
a JS-truncated literal in the same breath as forbidding one. Fixed with a two-span head/tail: the
**full identifier is in the DOM**, the head takes `overflow: hidden; text-overflow: ellipsis`, the
tail is `flex: none`. Copy-paste yields the complete string into the incident ticket; the eye gets
both ends (L8). Now the rule and the implementation agree.

**16.5 The posture union and the state table were two lists that had to be identical (panel #14).**
They were not: `REVISION_CHANGED_UNDER_PREVIEW` and `ALREADY_APPLIED` appeared in prose but not in
the enum, and `APPLIED` — a real `ControlResultStatus` — silently collapsed into `SETTLED`, which is
how `receiptId` got dropped (panel #15). One exhaustive union now, one `switch` with a
`never` default, and the doc's tables generated from it. `APPLIED` is its own posture carrying the
receipt: `Applied · receipt fixt…4b19 · CLEAR → ENGAGED · 14:22:31Z`, decaying to `SETTLED` when
`currentStateRevision` next changes — **not on a timer.**

**16.6 Screen readers, rebuilt from zero (panels #9, #10).**
There is no `role="switch"` and no `aria-checked` anywhere in this element, so there is nothing to
lie with. The rail is `aria-hidden` — it is a redundant rendering of text that is already in the DOM
in reading order. `aria-describedby` on each verb button points at a **spoken clause only**
(`Effective CLEAR, requested ENGAGED, not yet in effect`), with real punctuation instead of `·`
separators. The revisions, digests, receipt and idempotency key are visible, selectable DOM siblings
that **nothing references** — evidence for eyes, silence for ears. Round 1 read
`4c1f…8e02` aloud as *"four see one eff ellipsis eight ee zero two"* on every tab-through of every
one of twenty rows.

**16.7 `user-select: none` cancelled the feature I argued hardest for (panel #18).**
`:where(button) .wdt-truth { user-select: none }` existed to survive a structure that must never
exist — a `role="switch"` and an action button nested inside a `<button>` is invalid interactive
content. Rule deleted; the containment constraint is stated in the spec instead: `.wdt` may not be a
descendant of an interactive element.

**16.8 Both `!important`s deleted (panel #19)**, replaced by `p.wdt-confirm-irreversible`. An
`!important` inside a 200-line component sheet is an admission the local cascade was not traced.

**16.9 The invariant is now structural rather than asserted (panel #22).**
Round 1 claimed "there is no code path from a user event to a mark translation" while
`data-effective={optimistic ? intent : effective}` was a one-line regression away, and CSS cannot
police a data attribute's provenance. Three changes: the mark has **no press handler to regress
from**; `EffectiveValue` is a branded type mintable only in the transport layer, so `intent` is not
assignable and the regression is a compile error; and one test asserts the command reducer's output
is deep-equal to its input on every server-owned field. "Unrepresentable" is now true rather than
aspirational.

---

## 17. Adversarial pass 4 — is this the best possible version, or merely finished?

Four things I went looking for after everything above was resolved.

**17.1 Am I citing Rauno and Vercel selectively?** Yes, and I was. Re-fetched this session, Rauno
says *"optimistically update data locally and roll back on server error with feedback"* and Vercel's
guidelines say *"update the UI immediately when success is likely; reconcile on server response."*
The two most-cited interface guideline sets in the industry both prescribe the exact behaviour this
element refuses. Round 1 quoted their toggle lines and quietly skipped their optimism lines. Stated
plainly: **they are right for their domain and wrong for this one.** Optimism is a latency
optimisation whose premise is "success is likely." Here the *defined* outcomes include
`REJECTED_AUTHORITY`, `REJECTED_EXPOSURE`, `REJECTED_DEPENDENCY` and `AMBIGUOUS` — a state that
means the result is unreadable and every other control on the page is frozen. When denial is a
first-class expected outcome, optimism is not an optimisation; it is a false statement with a
rollback attached. Their rule, honestly applied to this domain, produces mine.

**17.2 Does the element still earn 60px of gutter now that it is not interactive?**
This is the strongest remaining attack, because a non-interactive rail is competing against plain
text for space, and text is cheaper. It earns it on one measurement: comparing two words per row is
O(n) saccades across the wall; comparing two mark positions is one fixation regardless of n. At the
registry's real size that is the difference between reading the page and scanning it. If the table
owner cannot spare the width, the correct fallback is **not** a narrower rail with less travel —
6px of separation is not pre-attentive and would be geometry as decoration. It is to drop to
Variant G's ledger and accept the density loss honestly. I would rather ship G than a decorative
rail.

**17.3 Drift has two causes and I was rendering one.** Terraform, fetched this session, separates
them: `terraform plan -refresh-only` reports *"Objects have changed outside of Terraform"* and states
*"this is a refresh-only plan, so Terraform will not take any actions to undo these."* That is a
different fact from a change we requested and are awaiting. My `DRIFTED` collapsed both. Split:
`ACCEPTED_ASYNC` (we asked, the server holds it, `control.effect` says what must happen) versus
`DRIFTED_EXTERNAL` (`desired !== effective` with no command of ours in the ledger — something else
moved it). Different reasons, different verbs, and the second one is the more alarming of the two
and previously had no voice at all. Both keep the AWS `pending-reboot` rule: never imply the gap
closes by itself.

**17.4 One citation in Round 1 was unverifiable and I am withdrawing it.** Round 1 attributed to
LaunchDarkly the rule *"approved and applied changes take precedence over pending or requested
changes."* Re-fetched this session, that page documents where pending changes are displayed (right
sidebar plus a count badge on the Targeting tab) and **says nothing about conflict resolution.** The
conflict rule stands on its own merits — when `currentStateRevision` moves under a held preview the
server's applied truth wins and the staged intent is dropped *with a stated reason, never silently*
— but it is now labelled as mine, not borrowed. A design document that launders its author's
judgement through a fabricated quote is worse than one that has no citation, and on an
evidence-gated surface that is not an irony I get to enjoy.

---

## 18. Open questions the fleet must still rule on

1. **`styles.css:146`** forces `border-radius: 4px` on every `:focus-visible` outline, squaring every
   pill in the app. I override locally with `box-shadow` **and** restore an `outline` inside
   `@media (forced-colors: active)`, where `box-shadow` is not painted at all — panel #7 was right
   that Round 1 left a production kill switch with **no focus indicator in High Contrast Mode**.
   This still belongs fixed at the root rather than patched by fifteen specialists.
2. **The lease's owner.** §13.1 binds freshness to `opsReadback.validUntilUtc`, which is
   envelope-scoped. Is one lease correct for all controls, or should a control carry its own? One
   lease is honest today and I ship it; per-control leases would be strictly better and are a
   backend question.
3. **Row width** — as §17.2. The rail costs 60px plus a button. If the table cannot spare it, rule
   for Variant G rather than for a shortened rail.
4. **`.healthx-button`'s `7px`** radius literal sits beside my `--r-pill` buttons. I no longer
   contribute to the drift, but it is still drift.
5. **`RECOVERY_PLAN`** is a fourth `targetType` nobody's spec mentions. It is not `SYSTEM`, so it
   gets no blast-radius rule under §15.7. Someone should confirm that is right.
