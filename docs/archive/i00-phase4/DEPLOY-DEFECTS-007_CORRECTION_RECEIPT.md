# DEPLOY-DEFECTS-007 correction receipt

| item | expected | found | status |
|---|---|---|---|
| date | director-authorized correction date | `2026-07-23` | PASS |
| authorization | T3 source correction and reseal; no gate weakening | recorded owner directive | PASS |
| branch | isolated correction branch | `fix/production-deploy-defects` | PASS |
| base | exact sealed source | `67d8750ece8991cf334179a052c331c2c6cb6397` | PASS |
| source candidate | one local implementation commit | `0365d5be82481bf3b9e2e5b3cd332c2f34e67568` | PASS |
| source candidate tree | exact Git tree | `3f1499b7cbd3707d9336ed3dca9c5d51140b4e91` | PASS |
| candidate parent | exact base only | `67d8750ece8991cf334179a052c331c2c6cb6397` | PASS |
| remote push | disabled | `DISABLED`; no push performed | PASS |
| host/provider action | none | none | PASS |
| deployment/reseal | director landing required first | not run | HELD |

## Corrected rows

| item | expected | base red | candidate green | status |
|---|---|---|---|---|
| first-host authorization | evidence exists before authorization and is consumed unchanged | exit `1`; `/private/tmp/deploy-defects-007-red-first-host.log` | `9` ordering assertions plus `102` delegated prepare/consume assertions; `/private/tmp/deploy-defects-007-green-first-host.log`; `/private/tmp/deploy-defects-007-green-delegation.log` | PASS |
| Gate-5 completion | only Gate-5 facts are required | exit `1`; `/private/tmp/deploy-defects-007-red-gate5.log` | `49` receipt, health, donor, race, chronology, and later-release assertions; `/private/tmp/deploy-defects-007-green-gate5.log` | PASS |
| immutable ops execution | root-owned, non-writable, service-traversable install | exit `1`; `/private/tmp/deploy-defects-007-red-bundle-mode.log` | installed root mode `0511`; `177` assertions; `/private/tmp/deploy-defects-007-green-bundle-mode.log` | PASS |
| backup coverage | backup-unit-only read on mandated non-secret configuration | exit `1`; `/private/tmp/deploy-defects-007-red-backup-access.log` | exact two-path ACL and unit drop-in; `14` assertions; `/private/tmp/deploy-defects-007-green-backup-access.log` | PASS |
| watchdog rotation | outside the four-row authorization | unchanged | unchanged | OUT_OF_SCOPE_BLOCKED |
| watchdog rotation — director extension | rotation identity and replacement ownership match the root writer; top-level cosmos contract and owner-only mode retained | exit `1`; `/private/tmp/deploy-defects-007-red-watchdog-rotation.log` | exact root/root stanza; `8` assertions; `/private/tmp/deploy-defects-007-green-watchdog-rotation.log` | PASS |

## Base-red evidence

| defect | exit | log | SHA-256 | status |
|---|---:|---|---|---|
| first-host ordering | 1 | `/private/tmp/deploy-defects-007-red-first-host.log` | `ccbef09af0fb5a71b5d7249da7863af2a9dd2f837efa6fe31e45e2c9510dc5c1` | RED_PROVED |
| Gate-5 ownership | 1 | `/private/tmp/deploy-defects-007-red-gate5.log` | `f28113feb08fda78a8771afc990588b650efafe4376b8952fa49b6108ea113ce` | RED_PROVED |
| installed bundle mode | 1 | `/private/tmp/deploy-defects-007-red-bundle-mode.log` | `3647af17f8130c87fedd94d8923f860e3c6fe93d929f1a2adf279f163b57092b` | RED_PROVED |
| backup access | 1 | `/private/tmp/deploy-defects-007-red-backup-access.log` | `d6cc05d34557bd8737357aac8168612d09eac958901bea4ada16f152de6184f7` | RED_PROVED |

## First-host and Gate ownership

| gate | required evidence | disposition | status |
|---|---|---|---|
| pre-authorization | retained four-file first-host bundle; exact digest; clean baseline; live SQLite identity | `--prepare-first-host-evidence`; no authorization, receipt, donor switch, or service mutation | PASS |
| authorization | exact prepared evidence digest and existing release/config/operator bindings | created only after preparation | PASS |
| Gate 5 | release and artifact manifest; authorization digest; conditional first-host digest; current/previous link readback; active service; donor exit `0`; loopback live/ready `200` | closed `RELEASE_SWITCH` receipt | PASS |
| Gates 6–7 | edge route, Access, UI/API/WebSocket boundary | not required or read at Gate 5 | PRESERVED |
| later operations | watchdog, backup, isolated restore, reconciliation | retained under owning later gates | PRESERVED |
| final acceptance | all later evidence | unchanged closed `DEPLOYMENT` receipt | PRESERVED |

## Permission boundary

| item | expected | found | status |
|---|---|---|---|
| installed ops root | root-owned; no write; known-path traversal | mode `0511`; child integrity unchanged | PASS |
| backup runtime group | unit-scoped only | exact `SupplementaryGroups=cosmos-backup`; global `cosmos` membership forbidden | PASS |
| ACL paths | only mandated non-secret files | `/etc/cosmos/cosmos-deploy.env`; `/etc/cosmos/cosmos-watchdog.env` | PASS |
| ACL value | read only; no world access | `user::rw-`, `group::r--`, named backup group `r--`, mask `r--`, other `---` | PASS |
| ordinary config modes | unchanged | `root:cosmos 0640` where specified; two ACL files remain `root:root 0640` | PASS |
| secret-bearing modes | never widened | `root:root 0600`; no named ACL | PASS |
| stale ACL state | replaced, not merged | exact tmpfiles `a` rules | PASS |

## Focused evidence

| test | exit | result | log | SHA-256 |
|---|---:|---|---|---|
| first-host ordering | 0 | `9` assertions | `/private/tmp/deploy-defects-007-green-first-host.log` | `ac4132f25325fdee3ec7287ca42bed6ade3f8b335fd89fa54427067874a7a32b` |
| release-switch receipt | 0 | `49` assertions | `/private/tmp/deploy-defects-007-green-gate5.log` | `0a4f1cc3a64978da716c331a40c479691c464ae3a884c6d814a9ab67ee257aa7` |
| installed bundle mode | 0 | `177` assertions | `/private/tmp/deploy-defects-007-green-bundle-mode.log` | `604230969331a481ac3be2b6f90623704dca389b5397d09a618c7211d77a2f8f` |
| backup access | 0 | `14` assertions | `/private/tmp/deploy-defects-007-green-backup-access.log` | `1dd3f80a8ba74ca83d0586551e8e23056b6f2654fa973553cbae909c3c1d9b35` |
| delegated prepare/consume | 0 | `102` assertions | `/private/tmp/deploy-defects-007-green-delegation.log` | `82d8081f4564dd257684bbf2cc49b49dc79d8071bd8a7a5eed522dd10109c31f` |

## Aggregate evidence

| gate | exit | result | log | SHA-256 |
|---|---:|---|---|---|
| `bash ops/tests/i00/run-all.sh` | 0 | `22` passed; `0` failed; `1,179` assertions | `/private/tmp/deploy-defects-007-i00.log` | `0021b8e42ba69692a32b40b52e433922ded3cde1a208407c4bc010bceb55c60e` |
| `bash ops/tests/run-all.sh` | 0 | `12` passed; `0` failed | `/private/tmp/deploy-defects-007-ops.log` | `3be87839f37fbcfea57ad72e9d9cfbc67ff00548421d6bfd98234ec529c6adc8` |
| `npm test` | 0 | root lane green; AI Ops `456/456` | `/private/tmp/deploy-defects-007-npm-test.log` | `429626bff4534429f14f12be61ef67eb70a1b7da6da6e117e2ee5c51637354cc` |
| locked Quant hydration | 0 | exact locked environment | `/private/tmp/deploy-defects-007-uv-sync.log` | `642a6d5d76320f42f307cda0c2a8cb9bb56dd14eb8aab64e6ed17eaccc3f6659` |
| `npm run test:all` | 0 | Quant pass; coverage pass; canonical pass | `/private/tmp/deploy-defects-007-test-all.log` | `c782da08e0a8e1518f0e7f8d5b69d65b29641c66313f62b16fcdc034e1f3405f` |
| integrated donor verification | 0 | working bytes exact | `/private/tmp/deploy-defects-007-donor.log` | `8c482ebb3c4b3354812929609a0401204984dd61334044579db2e336fa70b6a7` |
| `git diff --check` | 0 | clean | none | PASS |

## Source scope

| path | disposition | status |
|---|---|---|
| `ops/docs/i00/RELEASE_AND_RECOVERY_RUNBOOK.md` | ordering, Gate ownership, backup access procedure | CHANGED |
| `ops/i00/bin/install-ops-bundle.sh` | immutable root traversal | CHANGED |
| `ops/i00/bin/release-switch.sh` | prepare/consume and Gate-5 receipt owner | CHANGED |
| `ops/i00/bin/record-release-switch-receipt.mjs` | closed receipt writer and live readback | ADDED |
| `ops/i00/bin/validate-receipt.mjs` | `RELEASE_SWITCH` semantics | CHANGED |
| `ops/i00/lib.mjs` | shared immutable-install manifest mode | CHANGED |
| `ops/i00/schemas/release-switch-receipt.schema.json` | closed Gate-5 schema | ADDED |
| `ops/templates/i00/systemd/cosmos-backup-config-read.conf.template` | unit-only supplementary group | ADDED |
| `ops/templates/i00/tmpfiles/cosmos-backup-config-access.conf.template` | exact two-path ACL | ADDED |
| `ops/tests/i00/test-delegation-gates.sh` | dynamic prepare/consume and freshness | CHANGED |
| `ops/tests/i00/test-deploy-defects-007-first-host-order.sh` | focused defect 1 | ADDED |
| `ops/tests/i00/test-deploy-defects-007-release-switch-receipt.sh` | focused defect 2 | ADDED |
| `ops/tests/i00/test-release-and-preflight.sh` | focused defect 3 | CHANGED |
| `ops/tests/i00/test-deploy-defects-007-backup-access.sh` | focused defect 4 | ADDED |
| `ops/tests/i00/test-templates-and-schemas.sh` | schema inventory | CHANGED |
| `ops/live/**` | no byte changed | L15_NOT_TRIGGERED |
| `docs/archive/i00-phase4/DEPLOY-DEFECTS-007_CORRECTION_RECEIPT.md` | evidence-only descendant | ADDED |
| `STATE.md` | current-state pointer | CHANGED |

## Independent review

| review | expected | found | status |
|---|---|---|---|
| Gate-5 receipt security | no overwrite, link race, mode drift, chronology, or false health | final re-audit | PASS |
| backup access security | unit-only, exact ACL, no secret or world widening | final re-audit | PASS |
| donor amendment | required only for `ops/live/**` change | no donor path changed | NOT_TRIGGERED |

## Absolute boundaries

| boundary | expected | found | status |
|---|---|---|---|
| validate-only/keyless | preserved | no credential path added or used | PASS |
| secrets | no value in source, logs, receipt, or chat | none | PASS |
| money/account/provider authority | none | none | PASS |
| working rollback path | retained | distinct frozen previous release remains required | PASS |
| gate weakening | none | later evidence retained at owning gates and final receipt | PASS |
| deployment | director landing and reseal first | not performed | HELD |
| push | director-owned | not performed | HELD |
| completion time | exact UTC seconds | `2026-07-23T07:42:48Z` | PASS |
