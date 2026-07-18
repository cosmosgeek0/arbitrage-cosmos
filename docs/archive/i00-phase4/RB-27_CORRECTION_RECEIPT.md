# RB-27 correction receipt — latency benchmark absolute deadlines

Status: `CORRECTED_AND_REGRESSION_TESTED`

The owner-gated latency benchmark now enforces one absolute wall-clock budget
across each isolated DNS batch and one absolute lifecycle deadline for every
HTTP sample. DNS failures retain only bounded, validated error codes; raw
resolver and request messages are not copied into the report. The benchmark is
import-safe so deterministic injected never-settling DNS and HTTP doubles can
prove timeout settlement, cooperative abort, resource cleanup, and inert late
completion without network access. Settled phase data is copied into a frozen
snapshot, and hostile late response and socket events are regression-tested as
byte-inert after the absolute deadline. A response callback that arrives only
after timeout is destroyed with persistent error-channel containment for any
later emissions from that discarded response.

The donor-owned latency suite remains byte-identical. The correction is proved
by one additive I00 regression:

```text
bash ops/tests/i00/test-rb-27-latency-deadlines.sh
```

No network benchmark, deployment, private exchange call, signed action, or
money path was performed or authorized by this correction. Deployment and the
benchmark's live run remain `NOT_CONFIGURED` pending separate owner approval.
