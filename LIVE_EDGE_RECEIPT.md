# L17 immutable receipt — final worker scope and lane evidence boundary

Receipt status: `VERIFIED_IMPLEMENTATION_COMMIT`

Lane disposition: `ACCEPTABLE_BUILT_AND_TESTED_UNWIRED`

Integrated acceptance: `NO` — immutable receipt acceptance, production
composition, deployment, private truth, external fault operations and combined
Q/L fan-in remain outside this receipt.

## Commit and ruling chain

- D-LAUNCH-16 ruling commit:
  `a4a8ebd349e638e047a9ebf20bf6ec170376d08e`.
- Latest canonical director-state commit, including D-LAUNCH-17:
  `7ff1fd05584779672690f5058a01b1de573b4ccd`.
- Worker scope baseline / latest qualifying first-parent two-parent exact
  `director:` merge:
  `3a8e17be71d21df14f6b236a563cb0595f9eb824`.
- L17 implementation parent / L16 accepted-state handoff:
  `304b2fd428573ec4eef4846afd1e6578d7c7f93b`.
- L17 implementation commit:
  `25d364e5b9862abf24d918740d6b781f558390c7`.
- L17 implementation tree:
  `69e27343b31ac395a5c774c93e04b6335b1bc8e7`.
- Branch: `live-execution-control-proof-20260712`.

D-LAUNCH-16 exempts the canonical integrated tree at the selected director
merge. The scope gate checks only later worker commits and current worktree
changes against §3.3. Its classifier is structural: the qualifying director
commits are unsigned and use no cryptographically distinct author identity, so
the exact `director:` plus two-parent rule does not authenticate authorship.
This receipt names the implementation commit and cannot contain the SHA of its
own containing commit.

## Hash-locked implementation artifacts

- Source aggregate SHA-256:
  `f5a86653ec54c22b7a868d342b8f46914656e7a1c4ad3f4a219b2ef4c6b587bb`.
- Test aggregate SHA-256:
  `bd35fed14b18d6a142acfaf44f882260e80f6b1a09eff7d2efb95df10f27ec52`.
- Combined source/test aggregate SHA-256:
  `1a08d7d9030caf9d989f400424cd3429c4419183bd1487d8adda91912393218c`.
- Scope-gate aggregate SHA-256:
  `2244123f6f2fedc553db1a6a892c9d3de3a599bbd8ae48b5eaee29451f8d5ffe`.
- Combined source/test/scope aggregate SHA-256:
  `b726cc2fbe012791c0dcf4358f1ff376e58d470d5636a627775ef319ce8263eb`.
- Exact 13-path implementation-phase aggregate SHA-256:
  `c9d00395d61b3209d4f231a550f0fc1b31f914d8e4b1f4f4b4530b3bc22054b7`.

The aggregate values hash path-sorted `shasum -a 256` manifests, including
their trailing newlines.

### Scope gate

| File | SHA-256 |
| --- | --- |
| `ops/tests/lane-worker-scope-gate.sh` | `f167e2921e627709f0de80332e92314e654a19002f356fe31487858dd28d57c3` |
| `ops/tests/test-lane-worker-scope-gate.sh` | `99edbc4c71b25c4794c8318a62315db8d99abdcfa722dd73dc02f995df2633ee` |

### Source files

| File | SHA-256 |
| --- | --- |
| `index.ts` | `55e0186897614e0c5f94b7b4998552e33a2fd6c4a4966206245c5115e3721e85` |
| `projection.ts` | `82b6701096944d5fafd5105c99147429a4cf587241d576c2142af9b2c5096569` |
| `types.ts` | `d62de1db7fc0095753f500e740f46ab6f3dfc78730590e81bd47a29b094b6aaa` |

### Test files

| File | SHA-256 |
| --- | --- |
| `adversarial.test.mjs` | `dc6cc0e7875b97fd120707c4fc22cb46ee44d114bbf0d4280a162f3d90de4b2f` |
| `fixtures.mjs` | `f7e678682946dc603be0d0e7a2929cfca1c1391eb9da7013e2b79129a4199722` |
| `lineage.test.mjs` | `912a07a481ba386b6d994e439addc240643716cbe3623dc7dca5600d4d75bd9e` |
| `projection.test.mjs` | `57b69dce3ce47dab3ed343b64047b75f2607d32d9a99c57d17be4910e30f22e2` |
| `purity.test.mjs` | `5541a304a434b95d8f95765333ecb7bb2d21e88c681da1eaa3591c1bbd90aef0` |

### Implementation manifests

| File | SHA-256 |
| --- | --- |
| `LIVE_EDGE_COMPONENTS.md` | `d691fc9a0020e47693ad96c568847ddd09d2d210d1c67146d1616f4ce76c3c68` |
| `LIVE_EXECUTION_BUILD_STATE.md` | `2b6a070ba10f16045a6eaf870d73954f1517274c36283f63091d531c89bf07a5` |
| `live-edge-receipts/TASKS/L17.md` | `b2607c11093a9ca55b332becf754e8c829c12bb084fd3ff81a1fab2fb64bbfd4` |

## Worker-only scope evidence

The hostile gate suite passed `35/35`. It proves dynamic baseline selection on
the first-parent spine, exact two-parent and case-sensitive `director:`
qualification, future-baseline advancement, per-commit and per-parent worker
inspection, revert persistence, side-history rejection, rename source and
destination visibility, NUL-safe hostile filenames, branch and ancestry
binding, replace-object isolation, alternate-index isolation, graft rejection,
HEAD-race detection, protected-input integrity and strict final cleanliness.

The committed implementation gate returned:

```text
L_WORKER_SCOPE_OK baseline=3a8e17be71d21df14f6b236a563cb0595f9eb824 head=25d364e5b9862abf24d918740d6b781f558390c7 worker_commits=12 committed_path_observations=77 staged_paths=0 unstaged_paths=0 untracked_paths=2 protected_inputs=2 mode=FINAL
```

Every later worker commit is inspected individually with no rename folding;
every parent-relative path of a worker merge is observed. The final worktree
contains no tracked change and no non-protected untracked path.

## Delivered final evidence contract

- Revalidates the exact accepted L16 snapshot and full L12/L13 lineage, binds
  all accepted L12/L13/L16 implementation, receipt and acceptance identities,
  and retains the exact L15 satellite identities and 347 local assertions.
- Binds the exact scope-gate script/test hashes, 35 hostile assertions,
  selected baseline, committed revision, 12 worker commits, 77 committed path
  observations and the two exact protected inputs.
- Requires all 18 measured commands in canonical order on one implementation
  revision and one exact seal instant. Caller-supplied success cannot vary the
  command, exit, count, chronology or source revision.
- Covers the exact ordered 18-subject final catalog and four exact operational
  non-performance facts. A caller cannot provide a classification.
- Keeps protocol and security `UNPROVEN` in the injected snapshot pending
  immutable receipt acceptance. Synthetic fault replay stays synthetic;
  restart/private truth stays owner-gated; rollback, backup/restore and both
  canary classes stay not performed; signed test orders, Margin borrow/repay
  and live execution stay prohibited.
- L15 stays `ACCEPTED_SATELLITE`, lane runtime stays `UNWIRED`, and combined
  Q/L stays `DEFERRED_TO_I00`.
- `FILTER_BLOCKED` is inherited only through an exact validated current L16/L04
  owner replay. The ordinary receipt snapshot has no current owner verdict and
  therefore remains `UNPROVEN`.
- Rejects missing, extra, duplicate, inherited, accessor, symbol, sparse,
  cyclic, oversized, secret-shaped, stale and revision-incoherent input. Output
  is deterministic, detached, plain and deeply frozen.

The frozen implementation snapshot is:

```text
evaluatedAtMs=1783980111000
snapshotRevision=l17_1e982dfbc440a97f0e91d4e9a5065ce6
evidenceDisposition=LOCAL_GATE_EVIDENCE_COMPLETE
acceptanceState=PENDING_IMMUTABLE_RECEIPT_ACCEPTANCE
evidenceTrust=INJECTED_UNATTESTED
measurementAuthority=INJECTED_RECORD_ONLY
classificationAuthority=CLOSED_FINAL_MAPPING_ONLY
releaseState=SYNTHETIC_ONLY
laneReadyProof=false
readinessAuthority=NONE
externalCalls=false
credentialAccess=NONE
runnerAuthority=NONE
deploymentAuthority=NONE
actionAuthority=NONE
sendEligible=false
liveExecution=LIVE_EXECUTION_NOT_IMPLEMENTED
```

The adapter itself never mints `LANE_READY`. Local lane acceptance, if granted,
is a later immutable receipt ruling and does not change this snapshot's
unattested, synthetic and unwired authority posture.

## Exact snapshot classifications

| Subject | Classification | Receipt interpretation |
| --- | --- | --- |
| Protocol conformance | `UNPROVEN` | injected command record pending immutable acceptance |
| Security boundary | `UNPROVEN` | injected command record pending immutable acceptance |
| Synthetic fault replay | `SYNTHETIC_REPLAY` | offline synthetic tests only |
| Service restart | `OWNER_GATED` | authorization absent; not run |
| Rollback | `NOT_PERFORMED` | no rollback proof |
| Backup/restore | `NOT_PERFORMED` | no backup/restore proof |
| Canary preflight | `NOT_PERFORMED` | no external canary preflight |
| Real canary | `NOT_PERFORMED` | no real canary |
| AWS/Cloudflare deployment | `UNPROVEN` | application/origin/access proof absent |
| Public runtime observation | `NOT_PERFORMED` | no external observation |
| Private account/reconciliation | `OWNER_GATED` | authorization absent |
| Signed test orders | `PROHIBITED` | repository policy block |
| Margin borrow/repay | `PROHIBITED` | repository policy block |
| Live execution | `PROHIBITED` | `LIVE_EXECUTION_NOT_IMPLEMENTED` |
| L15 deployment satellite | `ACCEPTED_SATELLITE` | exact satellite receipt only |
| Lane runtime wiring | `UNWIRED` | no production composition |
| Q/L combined chain | `DEFERRED_TO_I00` | director-owned fan-in |
| Current filter admission | `UNPROVEN` | current owner verdict absent |

Every subject keeps integrated, deployed, private, trade-ready, live,
production-readiness and money-mutation proof false.

## Final verification evidence

- `ops/tests/test-lane-worker-scope-gate.sh`: `35/35`, exit `0`.
- `ops/tests/lane-worker-scope-gate.sh`: exit `0`; pre-commit worktree
  checkpoint selected the same baseline with 11 worker commits and 64
  committed path observations.
- `npm run build -w server`: exit `0`.
- Focused final-lane evidence: `23/23`, exit `0`.
- LiveEdge import purity: `4/4`, exit `0`.
- Accumulated LiveEdge: `1,618/1,618`, exit `0`.
- Frozen edge protocol: `22/22`, exit `0`.
- Foundation Risk: `884/884`, Control: `97/97`, Execution: `178/178`,
  Reconciliation: `75/75`, Observability: `130/130`, read model: `72/72`;
  all exit `0`.
- Built System Integration: `180/180`, exit `0`.
- `npm test`: exit `0`; deterministic repository battery `377/377`.
- `npm run test:all`: exit `0`, `2,479/2,479`; deterministic `377`, app gates
  `72`, Intelligence Foundation `152`, Intelligence Runtime `394`, Capital
  `433`, Foundation `871`, System Integration `180`.
- `git diff --check` and staged whitespace checks: pass.
- Strict committed-revision scope gate: exit `0`; 12 worker commits, 77
  committed path observations, zero tracked dirt and exactly two protected
  untracked inputs.

The accumulated LiveEdge suite is separate from `test:all` and is recorded
independently. All final owner and repository suites were run serially and
uncontended. The only build warning is the existing Vite chunk-size advisory.

Independent scope, contract, security and test audits returned `ACCEPT`,
`ACCEPT_SECURITY` and `ACCEPT_TESTS`. Hardening closed replace-object,
alternate-index, graft, HEAD-race, hostile filename and unattested-readiness
false greens. No remaining P0/P1 was reported.

## Scope, safety and protected inputs

- The implementation commit changes exactly 13 §3.3-allowed paths: two gate
  artifacts, three adapter sources, five focused tests, one task and two lane
  manifests.
- No `STATE.md`, mission, architecture, protocol, package, shared
  Foundation/Capital/System Integration owner, route, UI, service or deployment
  file changed.
- Protected untracked inputs remain regular, non-symlink, unignored,
  unstaged and byte-identical:
  - `DIRECTOR_Q_L_TWO_LANE_LAUNCH.md`:
    `26b1d5ce118982b4b3ba64b44b7fb3e88b0b7ded26a818a775a65bffaa0f2c06`;
  - `LIVE_EXECUTION_REALISM_CONTROL_PROOF_12H.md`:
    `40de1feb6678d8741bd38f7538b2c6f25304c0f64195a596961fdb2539a3b037`.
- The scope gate reads only local repository metadata and worktree paths. It
  has no network, credential or external-action authority.
- The pure adapter has no Git, filesystem, environment, process, network,
  timer, clock, randomness, credential, persistence, deployment, restart,
  control-dispatch or money-action seam.
- Secret values inspected, logged or recorded: none. Withdrawal or transfer
  capability added: none.

## Dated current-source evidence

Official primary guidance checked before implementation on `2026-07-14`:

- Git `diff-tree` documents merge-parent comparison, NUL path termination and
  disabling rename detection:
  `https://git-scm.com/docs/git-diff-tree`;
- Git revision traversal documents `--first-parent` for the canonical spine:
  `https://git-scm.com/docs/rev-list-options`;
- Git revision parsing documents exact object verification:
  `https://git-scm.com/docs/git-rev-parse/2.39.3.html`;
- AWS EC2 status checks distinguish infrastructure reachability from
  application correctness:
  `https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/monitoring-system-instance-status-check.html`;
- Cloudflare Tunnel connector health does not establish application or Access
  authorization proof:
  `https://developers.cloudflare.com/tunnel/troubleshooting/`,
  `https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/`;
- Binance Spot and USD-M test-order routes are signed TRADE requests that
  validate without matching-engine execution:
  `https://developers.binance.com/docs/binance-spot-api-docs/rest-api/trading-endpoints`,
  `https://developers.binance.com/docs/derivatives/usds-margined-futures/trade/rest-api/New-Order-Test`.

No remote repository, endpoint, credential store, instance, tunnel, service or
exchange account was contacted by the implementation or verification gates.

## Explicit non-claims and unresolved boundary

- This receipt does not prove combined, integrated, wired, deployed, private,
  trade-ready, production-ready or live acceptance.
- It does not prove cryptographic director authorship, application/cockpit
  behavior, Cloudflare Access, service restart/degradation, rollback,
  backup/restore, canary behavior, private reconciliation or exchange filter
  admission.
- No private read, signed request, test/live order, borrow/repay,
  transfer/withdrawal, leverage/capital mutation, deployment, restart, rollback,
  backup/restore, canary, merge or push was performed.
- L15 remains accepted only on its exact satellite. I00 retains canonical
  production composition, combined Q/L proof and external-action authority.

`LIVE_EXECUTION_NOT_IMPLEMENTED` remains mechanically enforced. L17 is
acceptable only as local built/tested/unwired evidence pending the separate
immutable acceptance record.
