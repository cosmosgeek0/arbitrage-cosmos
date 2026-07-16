# S4 assurance-case insertion requests — DRAFT

These are director-owned fan-in requests. They are not commands, accepted wiring, or permission to edit shared/production paths.

| Request | Dedup class | Existing owner | Exact requested seam | Current state |
| --- | --- | --- | --- | --- |
| `PA-S4-IR-001` | `EXTENDED` | S1 hazard/assumption owner | After serial fan-in, bind the production IP-ASSURANCE adapter to accepted S1 `ab33b3712cddd67c3ec91cfa1dd232c75226cd9f` assumption results without changing S1 reverse links or reimplementing its evaluator. | `MISSING_OWNER_INTEGRATION` |
| `PA-S4-IR-002` | `EXTENDED` | `IP-ASSURANCE.invariant-atlas-owner` | Map the packet's closed claim/evidence contract into the accepted production invariant evaluator; preserve `PASS/FAIL/UNKNOWN`, expiry, independence, reciprocal evidence-to-basis certification, structured component drill-down, and no-authority behavior. | `MISSING_OWNER_INTEGRATION` |
| `PA-S4-IR-003` | `EXTENDED` | `I08.machine-supervisor` | Consume only the accepted production read projection; expose invalidator, dependent path, evidence and component binding, source identity, validator, producer, verifier, common-mode domains, assumptions, age, expiry, SLO, owner, and truth label. Do not recompute or mount this fixture module. | `MISSING_OWNER_INTEGRATION` |
| `PA-S4-IR-004` | `EXTENDED` | Shared report/catalog owners | Review and insert the three packet-local DRAFT row sets into their canonical generated outputs during director fan-in. | `MISSING_OWNER_INTEGRATION` |
| `PA-S4-IR-005` | `EXTENDED` | `I00.deployment-authority` and `I00.external-watchdog` | Supply actual deployment identity, independent sentinel/paging, and external-configuration evidence. The packet cannot fabricate these proofs. | `EXTERNAL_CONFIGURATION` |

All integration, runtime, shared-file, external-configuration, and acceptance work remains outside this satellite. An LLM may explain the read-only projection but cannot restore support. Neither this packet nor a future projection may issue halt, close, repair, demotion, deployment, capital, order, borrow, repay, transfer, or withdrawal commands.
