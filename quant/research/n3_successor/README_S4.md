# N3-S4 final accepted-boundary profitability state

N3-S4 is a deterministic, offline successor to the accepted and durable N3-S3
commit `88d2c06350e3387ab810010f6027d9d52191f3fe`. It performs no experiment,
repair, rerun, archive read, or holdout opening.

It consumes exactly four newer orchestrator-accepted records:

- S-1T is one terminal economic origin. Its run was consumed once and stopped
  `UNMEASURED_RUN_CONSUMED_NO_RERUN` on
  `FUNDING_SURVEILLANCE_GAP_INVALID`. The holdout remains unopened; source
  p-values and economics remain JSON `null`; account-effective fees and
  executable capacity remain `UNKNOWN`; its effective program-wide p-value is
  conservatively 1/1; capital remains `NO_GO`; authority remains `NONE`.
- DQ-1 is already the first exact source-only binding in N3-S3. N3-S4 binds its
  newer durability acceptance without duplicating or economically promoting the
  policy artifact.
- LIQ-CUSTODY1 and BORROW-CUSTODY1 are accepted pre-worktree state-only stops.
  Each contributes one conservative attempt p-value of 1/1 and no product
  bytes, source artifact, economic origin, family, trial, profitability claim,
  or authority.

The selected receipt set is intentionally sparse and ordered from oldest to
newest: LIQ terminal support, BORROW terminal support, DQ-1 durability, S-1T
acceptance, LIQ acceptance, then BORROW acceptance. The two terminal rows bind
the detailed custody limitations without adding another p-value or economic
contribution. Every row is bound by its unique exact LF-terminated SHA-256
digest. All six rows are newer than the accepted N3-S3 boundary. The selected
boundary is not represented as a complete global ledger.

## Frozen result

The current accepted-boundary state contains:

- 50 accepted economic origins and 49 deduplicated families;
- 24 local `NO_GO` and 26 local `UNMEASURED` verdicts;
- 13 unchanged source-only bindings, including DQ-1 exactly once;
- two accepted state-only stops;
- zero accepted or verified credible positives;
- `crediblePositiveCount: null`;
- six unresolved truth gates and no active profitability task;
- global profitability `UNKNOWN`;
- owner `$1,000` funding verdict `NO`;
- positive-edge claim `NOT_MADE`, recommendation `NONE`, capital authority
  `NONE`, and effects `$0`.

`UNKNOWN` is not rewritten as `NO_GO`, and `null` is not rewritten as zero. The
result is the final profitability state for this accepted evidence boundary, not
a current profitability recommendation, canonical landing, deployment, or
capital authorization.

## Files

- `origin_spec.v4.json` is the exact accepted-input contract.
- `registry_tool_v4.py` transitively reproduces N3-S3, pins accepted Git objects
  and ledger bytes, freezes the registry, and verifies all invariants.
- `current_profitability_registry.v4.json` is canonical JSON.
- `owner_verdict_card.v4.md` is the terse one-row FABLE5 owner card.
- `test_registry_v4.py` supplies deterministic and hostile-custody proof.

N3-S4 adds only these six sibling files. It does not modify any v1-v3 byte.

## Focused proof

From the worktree root:

```sh
PYTHONPATH=quant/research/n3_successor python3 \
  quant/research/n3_successor/registry_tool_v4.py freeze \
  --spec quant/research/n3_successor/origin_spec.v4.json \
  --run /Users/cosmosgeek/Desktop/run.md \
  --repo . \
  --output-dir quant/research/n3_successor

PYTHONPATH=quant/research/n3_successor python3 \
  quant/research/n3_successor/registry_tool_v4.py verify \
  --spec quant/research/n3_successor/origin_spec.v4.json \
  --run /Users/cosmosgeek/Desktop/run.md \
  --repo . \
  --registry quant/research/n3_successor/current_profitability_registry.v4.json \
  --card quant/research/n3_successor/owner_verdict_card.v4.md

PYTHONPATH=quant/research/n3_successor python3 -m unittest -v \
  quant/research/n3_successor/test_registry_v4.py
```

The verifier has no network, clock, environment, provider, private API, host,
order, transfer, withdrawal, M0, or money capability. Git access is read-only.
