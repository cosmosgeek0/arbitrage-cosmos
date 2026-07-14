# A5 shadow research basis

Status: `SHADOW_SPECULATIVE`. This note is implementation rationale, not acceptance evidence.

Researched on `2026-07-14` from primary or project-authoritative sources:

- [OWASP Prompt Injection Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/LLM_Prompt_Injection_Prevention_Cheat_Sheet.html): treat all remote content as untrusted data, separate instructions from evidence, validate outputs, apply least privilege, and test typoglycemia and encoded attacks. Adopted in the investigation/effect-zone oracle and hostile fixtures.
- [OWASP LLM05 Improper Output Handling](https://genai.owasp.org/llmrisk/llm052025-improper-output-handling/): model output requires zero-trust validation before downstream use. Adopted in strict schemas, extra-property rejection, and the malformed-output oracle.
- [OpenTelemetry Collector resiliency](https://opentelemetry.io/docs/collector/resiliency/): retry, queue, persistent queue/WAL, backpressure, and delivery failures require explicit observability. Adopted in queue, DLQ, WAL, telemetry-loss, and fail-closed traces.
- [Open Policy Agent bundle management](https://www.openpolicyagent.org/docs/management-bundles): signed bundles are verified before activation and failed activation must preserve a known policy state. Adopted in the invalid-signature and last-known-good policy oracle.
- [Argo Rollouts analysis behavior](https://argo-rollouts.readthedocs.io/en/stable/features/analysis/): inconclusive analysis and measurement errors are distinct outcomes and must not be silently promoted. Adopted in no-data/non-finite canary handling.
- [etcd v3.6 API guarantees](https://etcd.io/docs/v3.6/learning/api/): monotonic revisions and compare-and-swap provide a fencing primitive. Adopted in the two-executor stale-epoch oracle.
- [NIST SP 800-207A](https://csrc.nist.gov/pubs/sp/800/207/a/final): access decisions bind identities and policies rather than network location. Adopted in endpoint identity, child authority, and credential-proxy checks.
- [Temporal workflow determinism](https://docs.temporal.io/workflow-definition): durable workflow code must replay deterministically and incompatible histories require explicit version handling. Adopted in replay hash equality, checkpoint resume, and workflow-version rejection.

All endpoints, identities, signatures, credentials, and effects in these fixtures are synthetic. The harness performs no provider call, authentication, subscription login, deployment, or product mutation.
