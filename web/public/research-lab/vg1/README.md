# V-G1 BTCUSDT hourly demand-pressure compression experiment

V-G1 is one public-only Binance Spot research experiment. It tests whether
abnormally buyer-initiated hourly quote volume that produces little immediate price
displacement predicts 12-hour or 24-hour upward continuation in BTCUSDT after
the current public generic standard-fee counterfactual and explicit
adverse-execution scenarios. The signal decision is followed by one full
intervening hour before the second-bar-open entry reference.

It is not a measurement of the accepted Volume engine. It does not use historical
books, receive time, private/account data, funding, borrowing, shorting, orders, or
money authority.

The sealed lifecycle is:

1. Freeze the source research, protocol, archive manifest, runtime, measured-result
   schema, terminal-failure schema, packet contract, evaluator, tests, and exact
   file hashes in Git. The
   machine-readable packet contract fixes the only allowed repository/state graph.
   A separate `freeze.v1.json` receipt commit binds the clean code commit before any
   target ZIP body opens.
2. Development acquisition downloads only the 15 January 2025–March 2026 monthly
   ZIP/sidecar pairs and verifies the exact frozen published checksums without
   reading a ZIP central directory or CSV member. Each raw file is staged
   exclusively in the destination directory, published by an atomic
   no-clobber hard link, then reduced durably to one final link; raced or
   pre-existing bytes are never replaced or deleted. Holdout ZIPs and sidecar
   files remain absent from state.
3. Development atomically consumes its durable run marker before the first warm-up
   or development member open, then opens only warm-up/development
   members, validates a continuous hourly grid, evaluates all 32 trials over 12
   monthly walk-forward folds, applies bootstrap/multiplicity/PBO gates, and seals at
   most one champion. Raw phase evidence retains exact daily and monthly
   net-liquidation coordinates plus the complete implicit-grid hourly
   net-liquidation vector for the base and stress gating scenarios; the four
   diagnostic scenarios carry a null hourly vector.
4. Only a sealed eligible champion permits holdout acquisition of April–June 2026.
   Holdout then atomically consumes one durable marker, opens each of the three
   sequestered members exactly once in one authorization cycle, and evaluates only
   that champion. The elapsed historical window is retrospective sequestered
   validation, not prospective confirmation.
5. `verify` authenticates the committed packet without network or archive-member
   access. It recomputes the hourly maximum drawdown, daily/monthly telescoping,
   7-day and 14-day block-bootstrap intervals, raw/Holm/maxT evidence, PBO,
   regime intervals, sample counts, matched-timing eligibility and unit-cash
   waterfalls, and all derived gates from the persisted phase coordinates. It
   binds trade starting cash at each entry and every flat or exit-hour NAV to the
   reconciled cash chain; entry-hour and other in-position marks remain persisted
   source coordinates. This authenticates the hash graph and internal coordinate
   consistency; it does not reopen the archives or independently prove that the
   persisted coordinates came from those source bars. Independent source-mapping
   reproduction requires a separate fresh-state run of the frozen evaluator
   against the checksum-pinned public archives.

External raw state is fixed at
`/private/tmp/cosmos-vg1-btc-demand-pressure-v1`; no alternate root, replay,
repair, or rerun is permitted, and no raw archive enters Git. A failure after a
one-use marker is terminal `UNMEASURED` with operational `NO_GO_CONSUMED`.
An exhausted acquisition or runtime-preflight failure before a marker is also
terminal `UNMEASURED`, with operational `NO_GO_NOT_CONSUMED`, a durable exact
blocker, and no rerun authority.
The evaluation runtime is also fail-closed against the frozen V-G1-owned
CPython/package-root fingerprint, exact host OS/build and direct Mach-O
load-command bindings, zero runtime-root symlinks/bytecode/startup path files,
and isolated interpreter flags before any one-use marker is consumed. Host dyld
shared-cache bytes are not vendored.

Focused commands are printed by `experiment.py --help`. A terminal measurement
verdict is only `GO`, `NO_GO`, or `UNMEASURED`. Even `GO` is research-only:
economics are synthetic USDT, while any USD/$1k presentation is explicitly the
unproven one-USDT-equals-one-USD convention. Account-effective fees, historical
total fees, exchange quantization, actual fills, executable depth/capacity, and
USDT/USD parity remain unknown or unmeasured; account profitability stays
`UNKNOWN`, capital stays `NO_GO`, and execution authority stays `NONE`.

Full hashes in packet files are `NON_DIRECTOR_MACHINE_EVIDENCE`. The terminal
director handoff is exactly five fields—commit | changed files | acceptance
evidence | focused tests | known limitation—with identifiers reduced to last four,
followed by exactly one FABLE5-safe `run.md` §5 row and then STOP.
