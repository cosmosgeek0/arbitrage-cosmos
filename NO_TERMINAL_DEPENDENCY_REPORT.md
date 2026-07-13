# No-Terminal-Dependency Report — IP-PROOF prestage

Generated from `fixtures/i00/closure-evidence.json` at 2026-07-13T00:00:00Z. Scope is `FIXTURE_PRESTAGE`; all fixture-chain evidence is permanently `SYNTHETIC`. This report proves the prestage harness and named evidence only. It does not claim real-adapter integration, deployment, private truth, signed validation, or live execution.

A fixture control never earns `MOVED_TO_AUTHENTICATED_CONTROL`; that classification below is used only where the accepted convergence source already exposes an authenticated mutation/read path.

| Routine operation | Classification | Current mechanism | Command/API | Exact blocker |
| --- | --- | --- | --- | --- |
| START | DEFECT | shared start command pending | — | AWAITING_DIRECTOR_SHARED_COMPOSITION |
| STOP | DEFECT | graceful drain command pending | — | AWAITING_DIRECTOR_SHARED_COMPOSITION |
| PAUSE | MOVED_TO_AUTHENTICATED_CONTROL | system integration intake control | SET_INTAKE_PAUSED | — |
| RESUME | MOVED_TO_AUTHENTICATED_CONTROL | system integration intake control | SET_INTAKE_PAUSED | — |
| HALT_NEW_ENTRY | MOVED_TO_AUTHENTICATED_CONTROL | kill control | SET_KILL_SWITCH | — |
| RECONCILE | DEFECT | backend command pending | — | AWAITING_ACCEPTED_L_TIP |
| SAFE_RESTART | DEFECT | composition command pending | — | AWAITING_DIRECTOR_SHARED_COMPOSITION |
| INSPECT | MOVED_TO_AUTHENTICATED_CONTROL | supervisor read API | READ_SUPERVISOR | — |
| CLOSE | NOT_SUPPORTED | live positions absent | — | LIVE_EXECUTION_NOT_IMPLEMENTED |
| RECOVER | DEFECT | accepted L command pending | — | AWAITING_ACCEPTED_L_TIP |
| BACKUP | DEFECT | IP-OPS runbook pending | — | AWAITING_IP_OPS_BUNDLE |
| RESTORE | DEFECT | isolated restore runbook pending | — | AWAITING_IP_OPS_BUNDLE |
| RELEASE_VALIDATE | DEFECT | IP-OPS preflight pending | — | AWAITING_IP_OPS_BUNDLE |
| ROLLBACK | DEFECT | IP-OPS rollback artifact absent before later authorization | — | AWAITING_IP_OPS_BUNDLE; DEPLOYMENT_AUTHORIZATION_REQUIRED |
| INCIDENT_ACK | DEFECT | incident command pending | — | AWAITING_IP_CONTROL_BINDING |
| MODE_CHANGE | MOVED_TO_AUTHENTICATED_CONTROL | system integration control | SET_SAFE_MODE | — |
| COMPONENT_DESIRED_STATE | DEFECT | backend command exists but no cockpit lifecycle | SET_COMPONENT_STATE | AWAITING_IP_CONTROL_BINDING |
| CONFIG_REVISION | DEFECT | backend command exists but no cockpit lifecycle | APPLY_CONFIGURATION | AWAITING_IP_CONTROL_BINDING |
| APPROVAL_REVOKE | DEFECT | backend command exists but no cockpit lifecycle | REVOKE_APPROVAL | AWAITING_IP_CONTROL_BINDING |
| SOURCE_ISOLATE | DEFECT | IP-RUNTIME command pending | — | AWAITING_IP_RUNTIME_ADAPTER |
| DEPLOY_ACTIVATE | DEFECT | IP-OPS activation artifact absent before later authorization | — | AWAITING_IP_OPS_BUNDLE; DEPLOYMENT_AUTHORIZATION_REQUIRED |
