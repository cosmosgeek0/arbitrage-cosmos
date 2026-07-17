# A5 port research basis

Status: `SHADOW_SPECULATIVE`. This note is implementation rationale, not acceptance evidence. The sealed shadow research was refreshed on `2026-07-16` before the landed-owner port was coded.

Researched on `2026-07-14` and rechecked on `2026-07-16` from current primary or project-authoritative sources:

- [OWASP Prompt Injection Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/LLM_Prompt_Injection_Prevention_Cheat_Sheet.html): treat all remote content as untrusted data, separate instructions from evidence, validate outputs, apply least privilege, and test typoglycemia and encoded attacks. Adopted in the investigation/effect-zone oracle and hostile fixtures.
- [OWASP LLM05 Improper Output Handling](https://genai.owasp.org/llmrisk/llm052025-improper-output-handling/): model output requires zero-trust validation before downstream use. Adopted in strict schemas, extra-property rejection, and the malformed-output oracle.
- [OWASP LLM06 Excessive Agency](https://owasp.org/www-project-top-10-for-large-language-model-applications/2_0_vulns/LLM06_ExcessiveAgency.html): minimize extensions, functionality, permissions, and autonomy. Adopted in the direct landed diagnostic-boundary conformance and the synthetic no-authority invariants.
- [OpenTelemetry Collector resiliency](https://opentelemetry.io/docs/collector/resiliency/): retry, queue, persistent queue/WAL, backpressure, and delivery failures require explicit observability. Adopted in queue, DLQ, WAL, telemetry-loss, and fail-closed traces.
- [Open Policy Agent bundle management](https://www.openpolicyagent.org/docs/management-bundles): bundle signature verification is an explicit activation control. The fixture's failed-activation/last-known-good rule is a stricter project policy, not an OPA guarantee.
- [Argo Rollouts analysis behavior](https://argo-rollouts.readthedocs.io/en/stable/features/analysis/): inconclusive analysis and measurement errors are distinct outcomes and must not be silently promoted. Adopted in no-data/non-finite canary handling.
- [etcd v3.6 API guarantees](https://etcd.io/docs/v3.6/learning/api/): monotonic revisions and compare-and-swap provide a fencing primitive. Adopted in the two-executor stale-epoch oracle.
- [NIST SP 800-207A](https://csrc.nist.gov/pubs/sp/800/207/a/final): access decisions bind identities and policies rather than network location. Adopted in endpoint identity, child authority, and credential-proxy checks.
- [Temporal workflow determinism](https://docs.temporal.io/workflow-definition): durable workflow code must replay deterministically and incompatible histories require explicit version handling. Adopted in replay hash equality, checkpoint resume, and workflow-version rejection.
- [Node.js v22.17 test runner](https://nodejs.org/download/release/v22.17.0/docs/api/test.html): the port uses the built-in runner's process-level isolation and explicit test discovery, wrapped by an OS network-deny policy because the root scripts do not yet mount A5.

No dependency or production design was adopted from these references. All endpoints, identities, signatures, credentials, and effects in these fixtures are synthetic. The harness performs no provider call, authentication, subscription login, deployment, or product mutation.
