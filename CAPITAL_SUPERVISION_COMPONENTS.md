# Capital Supervision Component Manifest

Status: **DORMANT / NOT WIRED**

This manifest describes a pure Opportunity-to-Position Operating Kernel. It has
no runtime composition, route, timer, network transport, database adapter, order
sender, borrow/repay operation, or live automation authority.

## Repository identity

- Repository: `/Users/cosmosgeek/Desktop/Main-capital-supervision-20260711`
- Branch: `capital-supervision-main-20260711`
- Accepted base: `c4ae7a9aee51050da2076bf4a454988b1d372bc4`
- Accepted Market Intelligence ancestor: `3340f75270049de96846d153672b91f065844eef`

## Mandatory source ownership and reuse audit

| Concept | Existing owner | This sprint's role | Future adapter seam | Duplication avoided |
| --- | --- | --- | --- | --- |
| Basis proposal and lifecycle | `server/src/engine/basis/**`; public barrel `basis/index.ts`; `BasisProposal` and `BasisEngine.openProposals()` | Preserve the child ID, correlation, direction, timestamps, validity, expiry and exact-loss report; never rescore or revive a rejected/expired proposal | Read-only `BasisProposal` translator into a canonical intake port | No second Basis scanner, score, proposal store, or invalidation engine |
| Volume proposal and lifecycle | `server/src/engine/volume/**`; public barrel `volume/index.ts`; exported `EngineProposal` reads | Preserve child facts and keep directional Volume advisory/validate-only unless an explicit calibration policy permits capital consideration | Read-only `EngineProposal` translator plus caller-supplied TTL/config provenance | No second Volume detector, confidence model, proposal store, or private-rule cast |
| Canonical cross-engine proposal projection | `server/src/foundation/contracts/opportunity.ts` and `foundation/readModel/ports.ts` | Consume `CanonicalProposal` as the core proposal reference and add only capital eligibility facts | `ProposalIntakePort` supplies immutable canonical proposals | No parallel canonical proposal vocabulary |
| Normalized evidence and source truth | `server/src/intelligenceFoundation/contracts/**` and `evidence/**` | Reference evidence IDs/kinds/truth; omit floating financial payloads and require separately correlated exact decimals | `IntelligenceEvidencePort` with explicit completeness/loss reporting | No second normalizer, evidence store, source-quality engine, or fabricated evidence |
| Thesis and forensics | `server/src/intelligenceFoundation/thesis/**` and `forensics/**` | Consume evidence-only hypothesis/stage/reasons; own only the position's capital thesis revision and supervision policy | `IntelligenceThesisPort` keyed by packet ID | No second thesis classifier, probability, strategy score, or tradeability authority |
| Observed outcomes | `server/src/intelligenceFoundation/outcomes/**` | Accept outcome IDs as context only; never treat theoretical floating outcome metrics as position PnL | `OutcomeReferencePort` | No second intelligence outcome engine and no outcome/PnL conflation |
| Intelligence topology | `server/src/intelligenceFoundation/topology/**` | Build a separate read projection for active-capital state and optionally map it later with declared semantic loss | Future render adapter | No second Market Intelligence component registry or fake component health |
| Structured operational failures | `server/src/foundation/contracts/failures.ts` | Reuse `StructuredFailure` and `ContractResult` at every authority boundary | Direct type/value import from `foundation/contracts/index.js` | No parallel error envelope |
| Source authority and freshness | `server/src/foundation/contracts/authority.ts` and `time.ts` | Reuse `DataAuthority`, `SourcedTimestamp`, `FreshnessReport`, and `evaluateFreshness`; conservatively project the broader capital truth states | Truth-bearing input ports | No second source clock or freshness calculator |
| Final multi-leg risk verdict | `server/src/foundation/risk/**` and frozen `RiskVerdict` | Emit `AWAITING_RISK`; consume only a bound external verdict reference. A bare verdict is insufficient and Capital never calls the evaluator | `RiskDecisionPort` binding verdict ID, mandate digest/revision, plan reference, correlation and expiry | No second risk gate or self-approval |
| Execution mechanics and lifecycle | `server/src/foundation/execution/**`; frozen `PlanLifecycle`, `LegLifecycle`, correlation IDs | Emit economic targets and consume external lifecycle/reference slices only | `ExecutionStatePort` | No order plan mechanics, retry/cancel sequencing, client-order IDs, or executor |
| Reconciliation | `server/src/foundation/reconciliation/**`; frozen `ReconciliationStatus` | Consume the canonical status/reference and preserve ambiguity/divergence as unknown or recovery-required | `ReconciliationStatePort` | No exchange/local comparison, reconciliation engine, or false-flat projection |
| Runtime pause/kill posture | `server/src/foundation/control/**` and runtime contracts | Consume a read-only posture projection; block open/add while preserving reduce/exit/recovery | `ControlPosturePort` | No second control plane or supervisor |
| Borrow availability and rate truth | `server/src/foundation/borrow/**`; exported `BorrowTruth` exact strings | Consume read-only borrow truth for account eligibility and Basis supervision | `BorrowTruthPort` | No second borrow evidence derivation or risk-lane borrow vocabulary |
| Venue account DTOs and risk account snapshot | Foundation USD-M boundary and `foundation/risk/**` | Translate exact-string venue facts or narrow semantic references; reject floating financial fields at Capital boundaries | Future signed-account read adapters | No private exchange client and no claim that a risk snapshot is allocatable-capital truth |
| Aggregate allocatable capital | No canonical existing owner; legacy account/loan services are runtime-bound and float-based | **BUILD** conservative multi-source projection with explicit unavailable/unknown amounts | Caller-supplied account, position, liability, valuation and commitment ports | Does not replace account services, venue reads, or Foundation risk evidence |
| Portfolio budgets and reservations | No existing portfolio reservation owner; legacy order notional holds in `services/orders.ts` are execution commitments | **BUILD** deterministic economic budgets/reservations while consuming existing holds as commitments | Commitment port plus persistence event/checkpoint port | No reuse of random order reservation IDs and no double allocation |
| Position PnL/cost attribution | Existing UI/account PnL is partial/float-based; Foundation calibration is outcome-specific | **BUILD** exact-decimal component accounting with explicit missing/estimated/divergent states | Ledger/fill/funding/borrow/valuation input ports | No second ledger, no forced residual, and no incomplete economics presented as profit |
| Durable events/database | Existing ledger/database | Define serializable payloads and a persistence port only | Future ledger adapter | No file, SQLite, or database write |

## Reuse decisions and known contract loss

- Foundation money/quantity fields in risk, execution, and reconciliation use
  JavaScript numbers. Capital consumes only their identifiers, lifecycles,
  statuses, reasons and authority references; every Capital financial value is
  an exact decimal string.
- Market Intelligence financial evidence also uses numbers. Compatibility
  adapters preserve evidence identity/truth and report numeric payload omission;
  exact financial values must be supplied separately and correlated to evidence.
- `CanonicalProposal` has no true engine source revision. Capital records the
  source revision as unknown and may derive a separate immutable intake digest;
  it never relabels `updatedTs` or a content hash as an engine revision.
- Basis exposes a machine expiry. Volume does not expose its private TTL rule;
  a Volume expiry requires caller-supplied versioned policy provenance or remains
  unknown/advisory.
- Foundation `RiskVerdict` is intentionally not bound to a plan. Capital wraps
  it only in a reference envelope that proves the exact mandate/revision/digest;
  it does not copy or widen the verdict.

## Required integration order

```text
Market evidence / engine proposal
  -> Capital Supervision eligibility and allocation
  -> staged capital mandate + operator approval
  -> Backend Foundation multi-leg risk
  -> Backend Foundation execution coordinator
  -> future signed exchange adapters
  -> Backend Foundation reconciliation
  -> Capital Supervision active-position policy and economics
  -> existing ledger / canonical read model / cockpit
```

Component/file inventory, public exports, ports, invariants, tests, measured
counts, integration ownership, and deliberate deferrals are completed after the
implementation checkpoints. Nothing in this document changes the status from
**DORMANT / NOT WIRED**.
