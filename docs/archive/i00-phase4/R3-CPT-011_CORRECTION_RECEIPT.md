# R3-CPT-011 correction receipt

**Finding:** `R3-CPT-011`

**Severity:** High

**Outcome:** corrected inside the accepted read-only fact-projection boundary

**Correction base:** `e322935bb7c70f6a14839b3f8393a567d4f07360`

**Correction-base tree:** `9944a02c0ff03d8b61f4c9424cf487f34127b0ff`

**Governing verifier receipt:** `/Users/cosmosgeek/Desktop/role3-verify/ROLE3_VERIFICATION_RECEIPT.md`

## Reproduction

The accepted Role 3 artifact contained six canonical attention rows, one
`CRITICAL` and five `HIGH`, while its mounted read-only Control Room contained
zero Attention Queue sections and zero Attention Queue headings. Source
inspection at the correction base independently proved the suppression:
`ProductControlRoom` always supplied `readOnlyProjection`, and
`SystemDashboard` mounted `AttentionQueuePanel` only when that flag was not
true. The existing mount contract passed `9/9` while entrenching the omission.

The new focused render regression was first run against the pre-correction
browser presentation. It exited `1`, `0/1`: the browser's local
exposed-capital/severity sorter moved supplied marker two ahead of supplied
marker one. That adversarial input proves both defects without pinning a live
queue count: the read-only surface must render all supplied facts, and the
browser must not replace the server owner's canonical order.

## Smallest-boundary correction

- `SystemDashboard` now always mounts the existing `AttentionQueuePanel` from
  the canonical supervisor snapshot; the independent `ControlsPanel` remains
  behind the interactive-only gate.
- `AttentionQueuePanel` accepts optional mutation authority. It always renders
  component, root cascade, severity, reason codes, capital-exposure flag, and
  recommended action, but renders a restart button only when the caller
  supplies a real callback and the component publishes that exact control.
  Read-only mode receives no no-op callback and exposes no fake affordance.
- The retired browser-side attention sorter was removed. The panel consumes
  `snapshot.attentionQueue` in supplied order without recomputation,
  deduplication, or severity re-ranking.
- Empty canonical truth remains explicit: the panel states that nothing
  requires the operator instead of disappearing.

No server queue producer, ranking authority, component inventory, control
route, command owner, or execution boundary changed.

## Focused regression proof

The deterministic six-row SSR contract deliberately supplies a non-capital
`HIGH` entry before a capital-exposed `CRITICAL` entry, so the retired local
sort fails while exact source order passes. It proves one visible
`Attention Queue` heading, exact canonical-order metadata, six rows in supplied
order, every component/root/severity/reason/action fact, two exposed-capital
facts, and zero buttons without mutation authority. The same component with a
real callback proves the six mapped buttons remain available to the interactive
owner, and the empty projection proves honest empty truth.

- focused render plus mount contracts: exit `0`, `10/10`;
- web typecheck: exit `0`;
- complete Product Control family: exit `0`, `100/100`;
- `git diff --check`: exit `0`.

## Rendered proof

The actual Product Control preview was loaded through the existing synthetic,
no-live-authority fixture binding. In `RECOVERY_REQUIRED_ONE_LEG`, the mounted
read-only donor rendered one Attention Queue with three canonical rows
(`CRITICAL`, `HIGH`, and `MEDIUM`) and their reason/action facts. It rendered
zero restart buttons and zero Controls sections.

- Light and Dark at `2940×1200`: queue width `2899 px`, three rows, no document
  or panel horizontal overflow, and no action controls.
- Light at `1600×900`: no horizontal overflow and no read-only controls.
- Dark at `390×844`: queue width/client/scroll width `361/361/361 px`, three
  readable rows, no horizontal overflow, and no action controls.
- Console warnings/errors: `0/0`.

The preview was restored to `HEALTHY_OBSERVE` and Light, the viewport override
was reset, and the Browser tab was finalized. Final C2-bound browser acceptance
remains separate and pending.

No live/test order, private or signed exchange call, deployment, push, merge,
current-main mutation, or protected-owner-directive mutation was authorized or
performed.
