# S-1P / V-G9 distinctness binding

Reviewed V-G9 input:

- Path: `/Users/cosmosgeek/.codex/worktrees/cosmos-vg9-spot-usdm-volume-leadership-1be1-2f7c/quant/research/vg9/protocol.v1.json`
- Observed SHA-256: `d8539d23a46aface73bfc6a72c08fcd548a7c8590b0fc7e1c6210b31a8c94b66`
- Protocol: `vg9-binance-cross-venue-volume-share-level-spot-return-v1`

The observed protocols do not materially collide.

S-1P uses a closed 5-minute same-symbol relative-volume-intensity crossing only
to arm a distinct own-symbol event. Entry requires a new positive normal-basis
cross one to six completed bars later, followed by a paired long-Spot /
short-USD-M-perpetual convergence trade.

V-G9 instead uses a completed trailing cross-sectional Spot-share versus
USD-M-share level, forms weekly, and measures next-week long-Spot-only return.
Its USD-M series is signal-only. Its frozen `forbiddenSignalInputs` includes
`BASIS`, and its `notS1P` law says
`NO_OWN_SYMBOL_TEMPORAL_SEQUENCE_NO_BASIS_EVENT_NO_PAIRED_TRADE`.

The observed hash records one HIGH review input, not a moving dependency.
Before freezing S-1P, `experiment.py freeze-candidate` re-reads only the
supplied V-G9 protocol, rechecks those exact
basis/sequence/paired-trade exclusions, and records the then-current V-G9
SHA-256 in the immutable pre-outcome freeze candidate. That freeze-time digest,
not the earlier observation or any later sibling drift, is authoritative for
the sealed S-1P run.
