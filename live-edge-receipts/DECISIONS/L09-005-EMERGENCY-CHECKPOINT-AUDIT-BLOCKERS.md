# L09-005 — emergency checkpoint acceptance-audit blockers

Decision status: `BLOCKED_UNRESOLVED_ACCEPTANCE_GAPS`

Decision date: `2026-07-13`

Emergency checkpoint reviewed:
`2fdb6806e35da404134dbc537695f2860a369078`

Implementation reviewed:
`a7a0f7c8f154539b05b7fb9845f1a4a3dec60eb8`

## Decision

Do not seal the emergency checkpoint as L09 acceptance.

Correction `a7a0f7c` survives as a bounded, deterministic and non-sendable
implementation of the assigned owner-checkpoint, canonical-reconciliation and
mutation-lineage work. The checkpoint's acceptance verdict does not survive.
It presents accepted F-BRIDGE evidence for shared groups 1–2 and materially
addresses assigned groups 3–4, but silently leaves the independently blocking
group 5 and acceptance-significant group 6 unresolved.

The emergency checkpoint's state file explicitly marked its acceptance record
unfinished, and neither new acceptance artifact received a containing-commit/
content-hash seal. They are removed from the current tree rather than promoted
to immutable evidence; their exact bytes remain preserved in Git history at
the emergency checkpoint.

## Authority reconciliation

L09-003 states that any one of blocker groups 1–5 prevents acceptance and that
group 6 remains acceptance-significant. D-LAUNCH-9 authorized F-BRIDGE for
shared groups 1–2 and described L09 groups 3–4 as the remaining shard-side
correction. D-LAUNCH-11 widened only the F-BRIDGE fixture allowlist. The later
L09-FINAL block in director commit
`e3f9021ca678bcd2a108b44f21730d99161dbdcd` assigned groups 3–4, but contains
no explicit finding, proof or waiver that individually supersedes groups 5–6.

A narrower implementation assignment cannot silently convert an immutable
safety blocker into acceptance. Either those groups must be closed in an
authorized correction or the director must issue a precise durable ruling that
disposes each finding and the non-green mandatory System Integration gate.

## Surviving correction evidence

- F-BRIDGE accepted implementation/test cut
  `1e9d28a565935d3cb1aa6c98a209697d9fabdf05`, acceptance documentation
  `a0c0c2e5ef3180aa720488463643433cefeb65e5`, and director merge
  `c9009079b0c27c2a7e2d1a0111a022bceb2e61db` close shared groups 1–2.
- `a7a0f7c` uses the injected canonical Foundation checkpoint hydrator, requires
  terminal opening Spot owner truth before hedge sizing, consumes the complete
  canonical reconciliation result, and preserves owner/recovery lineage.
- The six mutation-lineage fields are cross-bound exactly. Request sequence,
  request ID, intent fingerprint and sanitized-request hash are distinct across
  the four semantic legs; zero sequence and one-field substitutions fail.
- The correction changes exactly six source files, three test modules and one
  fixture under the exclusive normalBasis paths. No shared owner changed.
- All artifacts remain PAPER/synthetic, non-sendable, `NONE_RECORD_ONLY`, with
  external action authorization `NONE`.

## Remaining blocker group 5 — one-way and fee-adjusted exposure truth

The positive L05 fixture still presents an existing `+0.01` USD-M position and
an active `BUY` order for the target symbol at
`server/test/liveEdge/normalBasis/l05-fixture.mjs`. Validation in
`server/src/liveEdge/adapters/normalBasis/twinAdapter.ts` proves one-way
`positionSide=BOTH`, but does not prove a conflict-free baseline position/open
order set or ownership isolation. A planned SELL and later reduce-only BUY can
therefore be interpreted against unrelated net account truth.

The adapter sizes Spot exposure from gross cumulative fills and contains no
base-asset commission adjustment. A Spot fill charged in base asset can leave
residual exposure while gross Spot and perpetual quantities appear equal.

The accepted L07 TwinOrderFixture carries neither `reduceOnly` nor
`positionSide`. NormalBasis derives those stage labels and test-built request
parameters locally instead of binding them to complete runtime twin request
evidence, so the required request semantics are not proved end to end.

## Remaining blocker group 6 — expiry and lifecycle matrix

- The adapter extracts one venue-arrival timestamp but does not compare it with
  the accepted policy/proposal expiry before admitting the synthetic mutation.
- A legitimate partial close can expose Foundation's binary64 residual
  `0.060000000000000005` while the venue owner reports the exact decimal
  `0.06`; the adapter compares the request strings exactly and rejects that
  matching residual.
- The accepted L07 vocabulary contains neither `REJECTED` nor
  `EXPIRED_IN_MATCH`, so those terminal exchange outcomes are not proved.
- A canceled or expired order with a fill is classified as
  `PARTIALLY_FILLED`; the owner-outcome projection does not retain its terminal
  status, so Foundation can receive a non-terminal partial.
- Owner agreement accepts only `CLOSED`, `HEDGED_OPEN`, `ONE_LEG_EXPOSED` and
  `RECOVERY_REQUIRED`; the tested first-leg `FAILED` state has no terminal
  agreement representation.
- The 23-case focused suite proves opening partial/rejection/ambiguity, opening
  cold restart, a full close and ambiguous-close lookup/resume. It does not
  prove partial close, rejected close, terminal-partial close or close/recovery
  cold-restart rows required by the prior blocker matrix.

The prior deep-copy/freeze finding is materially resolved: accepted checkpoint,
observation, reconciliation and agreement boundaries structured-clone and
recursively freeze retained values. It is not a remaining blocker.

## Rejected checkpoint claims

- Items 3–4 were assigned under D-LAUNCH-9, not D-LAUNCH-11.
- F-BRIDGE accepted, documented and merged identities are three distinct SHAs;
  `c900907` is the merge cut, not the accepted branch SHA.
- Only four mutation identity fields are distinct across every semantic leg;
  all six fields are exact, but the two owner revisions need not be unique.
- The correction changed three test modules plus one fixture, not four tests.
- L06 provides accepted injected synthetic mutation evidence; it does not prove
  production persistence (`persistenceProven=false`, authority `NONE`).
- Local bounds cover checkpoint bytes and selected arrays/reason codes, not
  every injected owner string or reconciliation reason.
- The asserted three independent ACCEPT passes have no separate durable review
  identities or findings outside the rejected checkpoint.
- `ecd8006` is a two-parent director merge. Any no-merge statement must be
  limited to actions performed by the correction worker after that cut.

## Required resolution

The director must choose and durably record one of two paths:

1. authorize owner-scoped Foundation/L07 corrections for their shared findings
   and a bounded normalBasis source/test correction for the remaining adapter
   findings, with exact path ownership, then rerun the focused, accumulated,
   protocol, standard and full-repository gates plus independent review; or
2. issue an explicit evidence-backed ruling that individually supersedes every
   remaining finding and accepts the unchanged System Integration baseline
   exception.

This emergency resume explicitly prohibited implementation changes. No code is
altered to work around the missing ruling. L09 therefore stops `BLOCKED`.

## Preserved boundary

No private/account read, credential access, signer call, signed/test/live order,
real send/query/cancel, Margin action, capital change, network call, cloud
mutation, deployment, process restart, merge, push, withdrawal or transfer was
performed. `LIVE_EXECUTION_NOT_IMPLEMENTED` remains enforced.
