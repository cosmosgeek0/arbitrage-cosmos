# D0004 — L01 conservative adapter policy

Status: `ACTIVE_LANE_POLICY`

Policy ID: `L_ADAPTER_POLICY_V1`

## Decision

Where frozen EDGE_PROTOCOL_V1 is intentionally silent, the L consumer uses explicit injected policy rather than inventing protocol law:

- strict canonical raw JSON frames with a pre-parse 262,144-byte ceiling;
- bounded depth, node count, validation issues, queue count/bytes, identity count, heartbeat age, request/dwell timeout and future skew;
- SHA-256 of canonical frame bytes for local assessment identity;
- `(assessmentId, revision)` duplicate/conflict checks with route identity fixed across higher revisions;
- every schema-valid higher assessment revision supersedes older queued work,
  including a higher revision that is already non-actionable or expired;
- unexpired identity entries are never evicted to admit new work;
- FIFO sequence-sensitive assessment queue with drop-new backpressure;
- effective expiry is the earlier of assessment and economic-context expiry; equality is expired;
- event, peer-receive, generation, economic-snapshot and remote-health times
  obey a skew-bounded causal order;
- only explicitly registered strategy families/regime keys can reach an advisory owner port;
- unknown/stale/incomplete/OOD/drifting/conflicting economics or regime remains non-actionable;
- one injected expected remote component identity is required; foreign,
  conflicting, stale, failed, blocked, unlineaged or time-incoherent health
  cannot enable advisory dispatch;
- remote brain `OK` is evidence only and cannot create system readiness;
- canonical recording failure degrades research recording truth/readiness but
  does not gate advisory dispatch and has no dependency edge to reconciliation
  or recovery;
- outbound outcome/feedback projections require canonical-owner origin,
  frozen-schema validation, canonical-body duplicate/conflict binding, bounded
  identity memory and allowlisted sanitized open projections;
- rejected raw frames expose no producer-supplied schema, correlation or
  envelope identity.

All capacities/TTLs/thresholds are validated constructor inputs. Production composition must bind reviewed values; tests use deterministic fixtures. Any behavior that Q must reproduce requires director promotion into a future frozen protocol revision.

## Authority effect

None. The policy creates no strategy proposal, Capital reservation, Risk verdict, control mutation, ticket, execution hand, exchange call, ledger or outcome owner. Production insertion remains director-owned.
