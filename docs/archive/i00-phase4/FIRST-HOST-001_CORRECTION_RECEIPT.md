# FIRST-HOST-001 correction receipt — first-host release authorization

Status: `T3_ACCEPTED_INTEGRATED`

Candidate: `dcd1ffa33efbdc9a70797e08d1f9cf7b29ec066c`

Candidate tree: `a0f28da280bb78a060daefaa629f63b7d2d4eae0`

Base: `01cf1792d1f340199f4e2ca783dabaabe727e4e8`

This receipt records the bounded `FIRST-HOST-001` implementation ratified in
`D0_FIRST_HOST_PACKET.md` Part 1 §5. The I00 release wrapper now owns the
bootstrap readback, accepts only the exact `NO_PRIOR_RELEASE_FIRST_HOST`
sentinel for deploy, proves a clean first-host baseline, and delegates with a
wrapper-only under-lock refusal marker. Normal canonical deploy and rollback
remain on `CANONICAL_SUPERVISOR_READBACK`.

Every real switch now requires one explicit, canonical, non-writable SQLite
executable. Its path, digest, and live version are bound through the wrapper
gate, authorization, delegation, and result evidence. A claimed host SQLite
version that differs from the live pinned executable is rejected.

## Donor amendment and byte containment

`ops/live/bin/deploy.sh` checks `I00_REQUIRE_FIRST_HOST_NO_CURRENT` immediately
after the existing deploy/rollback lock is acquired and its cleanup trap is
installed, before host sanity or mutation. When the marker is exact `1`, both
`CURRENT_LINK` and `PREVIOUS_LINK` must satisfy `! -e && ! -L`; valid symlinks,
dangling symlinks, regular files, and directories are all occupied. Any set
marker other than exact `1` also refuses. An absent marker preserves existing
donor behavior.

- Base effective live tree:
  `fd2e76085fdf98c892e3e9cca2f0f085adfd2b9f`
- Effective live tree:
  `a90d108fe7614a00de87e6280089fe0201c8dc3d`
- Base effective root digest:
  `f4dafa650326c67e254c2c798721324709bee182a7b9f4d4a249f54324bdd3d5`
- Effective root digest:
  `c37e5a80b9591a31ff41af7e07f66bb75a99d13f2d6e6edbcb8726dae7243cc0`
- Effective live inventory: exactly 31 regular files.
- Changed live path: `ops/live/bin/deploy.sh` only.
- Changed donor-test path: `ops/tests/test-deploy.sh` only.
- Deploy before blob/SHA-256:
  `2385c1652f5c36f81bf741509b6a6fc752f39f4b` /
  `43fe7f3834387edd2f6268730911bfd092a9362aa322ae97d8e31894130c9599`.
- Deploy after blob/SHA-256:
  `3c4eaf5c445ffd716216e9c27815d0cffee3ef8b` /
  `9424f10b73fab8b0fa98eb135b758b80282d6c529831b7e7fba3002f3014c02a`.
- Donor test before blob/SHA-256:
  `700ad6fb184315895672de58ed151ff3c07273fe` /
  `e2dc8e1c8e714c75ae49052a2f168687ab2d06ff38bf13a8c2d7aadc85c121dd`.
- Donor test after blob/SHA-256:
  `90aa4f17e7f8f1854f9c7ec9ef541d6f66548bb2` /
  `4bdd6c5a75c57b35c4e8f71391d9e331a84fcc8413ae0c1be5840058cabd3db8`.

The L15 amendment contract chains `FIRST-HOST-001` after
`DEPLOY-READINESS-001`. Its dedicated byte regression binds guard ordering,
closed marker/link predicates, and the corresponding donor regression markers.

## Focused red reproduction

The unmodified base was exercised with an honest owner host readback, a
distinct supervisor source `FIRST_HOST_BOOTSTRAP_READBACK`, exact deploy mode,
an absent `current` proven by `lstat(...)=ENOENT`, and a sealed release fixture:

```text
node ops/i00/bin/preflight.mjs --release <sealed-fixture> --host <owner-host.json> --supervisor <bootstrap-supervisor.json> --mode deploy --now 2026-07-20T00:00:01Z --max-host-age-sec 300 --max-supervisor-age-sec 300 --required-supervisor-window-sec 120
exit: 1
I00_OPS_BLOCKED: supervisor source is not canonical readback
```

This is the required base red: bootstrap evidence could not be accepted even
when the honest first-host `current` observation was `ENOENT`.

## Candidate proof

All commands below ran from candidate
`dcd1ffa33efbdc9a70797e08d1f9cf7b29ec066c`. Exit codes are the real command
exits; output was not piped through a masking consumer.

| Command | Exit | Recorded result |
| --- | ---: | --- |
| `bash ops/tests/i00/test-first-host-readback.sh` | 0 | `OK (61 assertions)`; canonical producer bytes, exact-create permissions, live disk/unit/SQLite/state matrix |
| `bash ops/tests/i00/test-release-and-preflight.sh` | 0 | `OK (173 assertions)`; exact deploy/token/clean-baseline acceptance plus single-predicate negatives and unchanged gates |
| `bash ops/tests/i00/test-delegation-gates.sh` | 0 | `OK (86 assertions)`; first/second deploy, rollback, all real-switch SQLite equality, authorization/result binding, deterministic TOCTOU, containment/reinstall |
| `bash ops/tests/test-deploy.sh` | 0 | `OK (158 assertions)`; donor occupied-path matrix, marker matrix, under-lock race, first-host post-switch freeze |
| `bash ops/tests/test-rollback.sh` | 0 | `OK (27 assertions)`; real-release rollback and existing safety barriers |
| `bash ops/tests/i00/test-first-host-001-l15-bytes.sh` | 0 | `OK (15 assertions)` |
| `bash ops/tests/i00/test-donor-contract.sh` | 0 | `OK (25 assertions)` |
| `bash ops/tests/i00/run-all.sh` | 0 | 19 passed, 0 failed, 1,080 additive assertions |
| `bash ops/tests/run-all.sh` | 0 | 12 passed, 0 failed |
| `npm test` | 0 | deterministic root lane green; AI Ops aggregate 456 passed, 0 failed |
| `npm run test:all` (initial) | 1 | environment prerequisite only: missing `quant/.venv/bin/python`; source suites before gate coverage passed |
| `/Users/cosmosgeek/.local/bin/uv sync --project quant --locked --all-groups --all-extras --python 3.13.14` | 0 | exact CI bootstrap; ignored locked Quant environment hydrated |
| `npm run test:all` (rerun) | 0 | `CANONICAL_TEST_ALL PASS`; Quant 3,242 passed, 1 allowed Linux-only golden-byte skip, 0 failures; gate coverage passed |
| `node ops/i00/bin/verify-donor.mjs --repo . --integrated` | 0 | `INTEGRATED_ACCEPTED_DONOR_WITH_AUTHORIZED_CORRECTIONS_VERIFIED`; `FIRST-HOST-001` present; `workingBytesExact=true` |

Candidate log SHA-256 values:

- I00 aggregate:
  `bcfa3a97ab9f47b1e590533ed292f92db653cafc0d3fcfbc81ac4f95c8091eb4`.
- Ops aggregate:
  `5bba5530c4f98bbc794c03ad19352e9dcadb331bc0b09a86d9c76d2c6881afec`.
- Root `npm test`:
  `2c00dd5c2dc095f3ca4857c994adc0b896c28f8e459789fc5579a8677f6e9c2c`.
- Successful canonical `npm run test:all` rerun:
  `71a8f90cb3241539ac42b8f6d1a5647de1b452e9a49daf0a3528ae194cd4e9fa`.

## Sealed staging and evidence bindings

The delegation suite assembled and verified immutable simulated staging
releases, invoked the installed I00 wrapper with live-derived bootstrap
evidence, and exercised the real donor scripts behind the wrapper. No
production host or money-capable surface was contacted.

- Sealed artifact manifest SHA-256:
  `95043a35fb4d108391ca874ad6bab4e77f14d711fc646560395e567dac12ae03`.
- Direct focused-run first-host evidence SHA-256:
  `d532fc271e52872389194db0fb26c6efda114a590e28487c5a4fe711fff8ea3e`.
- I00 aggregate-run first-host evidence SHA-256:
  `9fb2401c2f2c4e7be32289c1e60412eed32cf7e250c68e1462670e4a98805497`.

The first request installed sealed release A with `previous` absent. A second
bootstrap request refused without changing A. A later canonical deploy
installed sealed release B and maintained `previous -> A`; canonical rollback
selected a real release and restored A. The sentinel was never passed to the
rollback donor.

The deterministic race held the donor on its real shared lock, let wrapper
preflight complete, created `current`, then released the lock. The donor's
under-lock check refused before release installation, link switching, probe,
or service mutation and cleaned its lock.

The receipted containment case stopped the simulated donor-proved frozen first
host, removed only the simulation links/releases/data/ops state, reproved the
clean baseline, and reinstalled the same sealed release A. The retained
four-file evidence bundle was reverified after reinstall.

## Independent verifier sign-off

`/root/independent_audit` independently reviewed candidate
`dcd1ffa33efbdc9a70797e08d1f9cf7b29ec066c`. It verified the exact 18-path
§5.3 allowlist; no rollback, historical-receipt, application, private,
signing, order, transfer, withdrawal, capital, or AI path changes; exact
producer/preflight/sanitizer/wrapper/authorization/result-evidence bindings;
F-110 live SQLite equality; the occupied-path and deterministic under-lock
TOCTOU matrix; first/second deploy and real rollback behavior; and
clean-baseline/reinstall containment.

Independent reruns passed producer 61, preflight 173, delegation 86, donor
158, and L15 bytes 15. The independent verifier also inspected the aggregate
logs: I00 19/19 with 1,080 assertions, ops 12/12, and the final canonical
matrix exit 0. Sign-off: `PASS`, 2026-07-20.

## Absolute boundaries

`rollback-switch.sh`, `ops/live/bin/rollback.sh`, historical donor receipts,
application readiness, private credentials, signing, orders, transfers,
withdrawals, live execution, capital authority, AI/model authority, and host
bootstrap/provisioning remain unchanged. No deployment, external message,
signed/private exchange call, order, borrow/repay, transfer, withdrawal,
leverage/margin mutation, or other money action was performed or authorized.
