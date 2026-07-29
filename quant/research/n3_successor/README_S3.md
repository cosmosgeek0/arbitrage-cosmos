# N3-S3 accepted-boundary profitability convergence

N3-S3 is a deterministic, offline successor to the accepted and durable N3-S2
commit `cf00db3f44c030dc393639b4ea7493797fe2aba6`. It does not rerun research.
It binds only six newer `run.md` acceptance records:

- V-G10 is one terminal economic origin with normalized verdict `UNMEASURED`,
  source verdict `UNMEASURED_CAPITAL_NO_GO`, no verified positive, and effective
  program-wide p-value 1/1.
- DQ-5, DQ-7, DQ-10, DQ-12, and DQ-13 are prospective intake/source validators.
  They contribute exact source bindings and limitations, but no economic
  origin, family, trial, p-value, profitability claim, or authority.

The sparse six-row allowlist is intentional. Unrelated intervening records are
not consumed. The accepted DQ-14 row remains the prior N3-S2 boundary, while
the compound DQ-10/N3-S2 row is the latest selected acceptance boundary. Every
selected row is bound by its exact LF-terminated SHA-256 digest and relative
chronology. Each validator also retains its accepted downstream consumer scope,
so a source binding cannot silently widen from N3/final-convergence intake to
an unrelated consumer.

S-1T is represented only by the orchestrator-published opaque suffix `fea0` and
state `ACTIVE_UNPUBLISHED`. Its branch, worktree, and outcome bytes are not
resolved, polled, or inspected. Missing profitability truth remains `PENDING`;
`UNKNOWN` and JSON `null` remain distinct from zero.

## Files

- `origin_spec.v3.json` is the exact input contract.
- `registry_tool_v3.py` freezes and verifies the registry from accepted Git
  objects and `run.md` row bytes.
- `current_profitability_registry.v3.json` is canonical JSON.
- `owner_verdict_card.v3.md` is the one-line FABLE5 owner card.
- `test_registry_v3.py` supplies deterministic and hostile-custody proof.

The registry preserves the exact N3-S2 origin, family, source-pin, legacy
exclusion, truth-policy, ledger, pending-input, and summary substructures by
hash before applying the overlay. It then produces:

- 49 accepted origins and 48 deduplicated families;
- 24 local `NO_GO` and 25 local `UNMEASURED` verdicts;
- zero accepted credible positives and `crediblePositiveCount: null`;
- 13 accepted source-only bindings;
- one active unpublished input, S-1T;
- global profitability `UNKNOWN`, owner `$1k` funding verdict `NO`,
  recommendation `NONE`, capital authority `NONE`, and effects `$0`.

The verifier has no network, clock, environment, provider, private API, host,
order, transfer, withdrawal, M0, or money capability. Git access is read-only.

## Focused proof

From the worktree root:

```sh
PYTHONPATH=quant/research/n3_successor python3 \
  quant/research/n3_successor/registry_tool_v3.py freeze \
  --spec quant/research/n3_successor/origin_spec.v3.json \
  --run /Users/cosmosgeek/Desktop/run.md \
  --repo . \
  --output-dir quant/research/n3_successor

PYTHONPATH=quant/research/n3_successor python3 \
  quant/research/n3_successor/registry_tool_v3.py verify \
  --spec quant/research/n3_successor/origin_spec.v3.json \
  --run /Users/cosmosgeek/Desktop/run.md \
  --repo . \
  --registry quant/research/n3_successor/current_profitability_registry.v3.json \
  --card quant/research/n3_successor/owner_verdict_card.v3.md

PYTHONPATH=quant/research/n3_successor python3 -m unittest -v \
  quant/research/n3_successor/test_registry_v3.py
```

The frozen card is a source artifact only. It is not landed, deployed, live,
or a current-profitability recommendation.
