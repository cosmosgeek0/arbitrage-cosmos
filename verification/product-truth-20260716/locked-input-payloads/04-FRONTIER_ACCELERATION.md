# OWNER CONTINUOUS-FRONTIER ACCELERATION DIRECTIVE

## Purpose

This is an orchestration amendment to the **existing** product-completion and truth-verification campaign. It is not a new product, new architecture, new authority, or permission to bypass evidence. Preserve all accepted work, current authority, exact-SHA laws, one-writer rules, security boundaries, and the current truth-A/truth-B split **only if current Git and durable state still show that split is valid**.

The objective is to minimize wall-clock time from the current state to:

1. one frozen candidate;
2. independently verified acceptance of that exact candidate;
3. exact landing and runnable/deployable product truth;
4. private/account activation readiness;
5. one owner-gated, hard-capped 10-USDT live canary.

Reduce time through state-aware parallelism, continuous scheduling, test sharding, and defect-wave fan-out. Do not reduce time by skipping evidence, weakening gates, fabricating green, or allowing conflicting writers.

## Authority and state discovery

Do not blindly execute phase names, filenames, SHAs, estimates, worktree names, or branch names from this file. The director knows the newer state and must first reconstruct current truth from:

- Git objects, branches, worktrees, ancestry, dirty paths, and remote equality;
- the canonical current authority map and director ledger;
- current build-state files, receipts, coverage matrices, and accepted SHAs;
- active processes and their measured heartbeats;
- current controlling directives and precedence.

Repository truth wins. Reuse the actual canonical files; never create substitute files merely because an old directive names a path that no longer exists. Do not redo accepted work.

## Permanent anti-idle law

The recurring failure mode is forbidden: launch a batch of workers, leave one long chat running, and answer "wait until it finishes."

Maintain a live dependency DAG and a continuously refilled runnable frontier from now until the terminal result. Whenever any worker:

- completes;
- blocks;
- fails;
- produces a receipt;
- changes the candidate SHA;
- frees a worktree or compute slot;

immediately re-read durable state, recompute the frontier, and launch every newly ready collision-free task that available compute can support.

Do not wait for the owner to ask "what next." Pre-write the conditional next-wave worker orders and fire them as soon as their Git/state predicates become true.

A response containing `WAIT`, `NOTHING ELSE`, or `LET THE LONG CHAT FINISH` is valid only if it includes a machine-derived **FRONTIER_EMPTY_PROOF** listing:

- every unfinished requirement;
- its exact dependency edge and blocking artifact/SHA;
- why it cannot be prepared, investigated, sharded, dry-assembled, or verified now;
- every active process heartbeat and measured progress;
- all available compute slots and why each cannot perform useful independent work.

If that proof cannot be produced, issue more bounded worker assignments immediately.

## Scheduler model

Maintain three pools:

### Pool 1 — candidate mutator

Exactly one current candidate owner/integrator may mutate or freeze the candidate. Preserve the current owner if valid. No second writer may touch the same candidate, shared composition roots, shared types, package files, migrations, canonical state, startup, routes, deployment state, or other overlapping paths.

### Pool 2 — exact-SHA verifiers

Use every genuinely independent verifier slot available. Verifiers use detached clean worktrees or clones of one exact committed SHA and cannot modify the candidate. Split verification by real independence: build/type/lint, Node suites, Python suites, property tests, browser/UI, security, secret/egress, provenance, expected inventory/no-false-green, ledger, execution/recovery, cockpit truth, AI-Ops, deployment/rollback, performance, and directive coverage.

Use official runner sharding where supported instead of launching duplicate full-repository runs. Give every shard isolated ports, browser profiles, temporary directories, output directories, caches, databases/schemas, process namespaces, and fixture state. Never call parallel-collision output a product defect. Never shard a suite whose correctness genuinely depends on ordered shared state.

### Pool 3 — preparation and investigation

Use spare slots for work that does not mutate the candidate:

- requirement-to-code/test/runtime/receipt coverage extraction;
- worktree, receipt, ancestry, dirty-path, and accepted-SHA census;
- test-map and shard-manifest generation;
- defect reproduction and root-cause analysis;
- disjoint patch proposals in isolated worktrees;
- browser/deployment/rollback/canary fixture preparation;
- cockpit/telemetry expected-inventory checks;
- private-read, signed-test, filter, and reconciliation runbook preparation with no credentials or external mutation;
- downstream landing and activation dry assembly;
- independent aggregation tooling and receipt validation.

Preparation against a moving candidate is non-binding. Mark it honestly and rebind or rerun every affected proof against the frozen SHA.

## Runnable-node contract

Every DAG node must record:

- prerequisite nodes and trigger predicate;
- exact input SHA;
- critical-path priority;
- read-only or mutating mode;
- exclusive writable paths;
- isolated resources and expected resource cost;
- exact command/test selector or bounded deliverable;
- acceptance condition and required receipt;
- invalidation rule when an upstream SHA or contract changes;
- next nodes unblocked by success, failure, or a specific blocker.

Parallelize by dependency and ownership, never by arbitrary phase number or by the number of chats the owner can open.

## Resource law

Use all available **independent** account and machine capacity, but do not confuse model slots with CPU, RAM, disk, browser, database, or port capacity.

- Across separate machines or isolated execution environments, scale read-only exact-SHA shards aggressively.
- On one host, measure throughput and cap CPU-heavy concurrency at the fastest observed level; keep remaining model slots on I/O-light analysis and preparation.
- Never run several copies of the same monolithic full suite merely to look parallel.
- Reserve premium Fable/director reasoning for orchestration, adjudication, semantic conflicts, acceptance, and exact landing. Use builders/test workers for long mechanical work.
- A long irreducible test may continue once, while every independent surrounding task remains occupied.

## Continuous verification and defect waves

Do not serialize the loop as `find one defect -> fix one defect -> rerun everything`.

1. Run all independent finding shards against the same exact SHA.
2. Aggregate and deduplicate findings by root cause.
3. Cut disjoint fix packets concurrently from that same base.
4. Let only the candidate owner review and integrate accepted patches.
5. Freeze one new candidate per coherent defect wave.
6. Rerun all invalidated/affected shards in parallel.
7. Run each binding non-shardable/global acceptance gate once on the final repaired SHA.
8. Repeat only when measured evidence identifies a real defect.

No worker self-merges, self-lands, self-deploys, or self-declares final acceptance.

## Receipt and aggregation law

Every worker returns a machine-checkable receipt containing:

- exact input SHA and tested tree identity;
- branch/worktree identity;
- command, selector, shard, and random seed where relevant;
- environment and tool versions;
- isolated resources used;
- pass/fail/skip totals and an honest reason for each skip;
- start/end timestamps and duration;
- output/log/artifact hashes;
- dirty-path inventory;
- forbidden-path non-touch assertion;
- result and exact next dependency token.

The aggregator rejects missing, stale, duplicate, incomplete, wrong-SHA, silent-skip, or unverifiable evidence. Green is impossible when an expected component, instrument, runtime surface, or receipt is absent.

## One coordinated closure campaign

Before final acceptance, mechanically map every current controlling requirement to:

`requirement -> canonical owner -> implementation -> test/evidence -> runtime/cockpit surface -> receipt -> exact status`

Shard this coverage proof across all directive families found in the actual repository, then aggregate it. It must include every currently authorized product, Q, L, protocol, integration, assurance, IP, AI-operations, cockpit, recovery, security, deployment, rollback, and canary requirement. A prior directive that has been superseded must map to the superseding authority rather than being rebuilt. Anything silently missing blocks acceptance.

This is the mechanism that prevents a later sequence of "one more forgotten audit." It does not promise that future live operation can never reveal a new defect.

## What must remain serial

Serialize only the physically irreducible tail:

- final candidate freeze;
- integration of overlapping/shared-path fixes;
- final receipt aggregation and acceptance decision for one exact SHA;
- exact landing and deployed-artifact SHA equality;
- shared destructive migration or fixture work that cannot be isolated;
- private account reconciliation;
- the final signed test/live mutation and outcome reconciliation chain.

Everything else must be tested for safe extraction into the parallel frontier before being declared serial.

## Terminal sequence

Continue without a planning-only stop until the current Git-derived campaign reaches one of these states:

- `VERIFIED_ACCEPTED` for one exact SHA, exact landing, activation/canary ready;
- a precise owner-only blocker that cannot be resolved by code, evidence, configuration preparation, or another independent worker.

The director must publish observed critical-path timing from actual task durations, not guesses, and refresh it after every wave.

After exact landing, run all safe startup, deployment, browser, telemetry, watchdog, rollback, recovery, and configuration checks concurrently. Keep external mutations disabled until the binding gates pass.

## Owner canary amendment

There is no owner-required 24-hour paper/shadow delay. This statement is the owner's durable amendment to any plan that treated a 24-hour soak as mandatory. Preserve quick replay, deterministic tests, exchange-supported signed test/non-matching validation, current-filter validation, restart/recovery proof, and private reconciliation; do not invent a clock-only waiting period.

Once the exact landed/deployed SHA is verified, private account truth reconciles, current venue filters and account/product modes are loaded, and the signed test path passes, expose one explicit owner approval for one hard-capped live lifecycle:

- total owner-defined exposure cap: **10 USDT**;
- no automatic increase or second lifecycle;
- no withdrawal, transfer, or leverage/margin-mode change;
- persist intent before send;
- deterministic unique client identity;
- timeout/`UNKNOWN` means query exchange truth before any retry;
- never blind-resend;
- reconcile order, fill, balance, position, fee, ledger, risk, and cockpit truth;
- stop and report after the lifecycle.

If current venue minimums make the 10-USDT lifecycle invalid, return a precise blocker; never silently raise the cap. Do not place the real order until the owner performs the final approval action.

## Required director behavior now

Do not return another static plan and do not wait for truth-A merely because it is the longest chat.

1. Reconstruct current truth.
2. Write/update the durable DAG, frontier, worker ledger, and coverage matrix.
3. Preserve the valid current candidate writer and verifier roles.
4. Issue all currently runnable bounded worker prompts in the same response, grouped by account/machine and resource class.
5. Pre-write the next conditional waves so they launch immediately when their predicates are satisfied.
6. Keep all safe worker slots occupied and refill them after every receipt.
7. Aggregate findings into coherent defect waves instead of serial micro-loops.
8. Keep the candidate owner, verifier, and director focused on their unique high-judgment roles.
9. Continue to exact acceptance, landing, runnable activation, and 10-USDT-canary-ready status.

Do not add unrelated features to the moving candidate. Truly spare compute may prepare isolated, non-merging post-candidate work, but it cannot alter or delay the current finish line.

