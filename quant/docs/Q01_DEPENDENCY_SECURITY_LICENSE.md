# Q01 dependency security and license evidence

Evidence cutoff and final vulnerability/license query date: 2026-07-12. The command did not emit a trustworthy query timestamp, so no finer timestamp is invented. This receipt covers the Q01 locked environment only. It is a reproducible observation, not a permanent security or legal guarantee.

## Locked supply-chain identity

| Artifact | Identity / SHA-256 |
| --- | --- |
| Python selection | CPython `3.13.14`; `.python-version` is the exact selection input |
| Managed interpreter observed | Astral `python-build-standalone` layout `cpython-3.13.14-macos-aarch64-none`; `BUILD` marker `20260623` |
| Observed interpreter binary | `091704d2238fa5d3d95299894a24d02fa0cf0f874d7b1cd019f9a19b767628ab` |
| Observed interpreter `BUILD` file | `2fc1c2297415471f79e52c0400795908954b120dda95fcef90e3941f8afbaa4c` |
| `uv` | `0.11.28` (`ebf0f43d7`, Apple arm64); downloaded release archive `33540eb7c883ab857eff79bd5ac2aa31fe27b595abecb4a9c003a2c998447232` |
| `pyproject.toml` | `a782bc239e433073409e893da7b6e806fbf30f90bea3820ca3f808e60e53d36a` |
| `uv.lock` | `3449f6eb892e2e5dd27dd48a735f9fe30d1ddfb38f16d858bba60202f5f4ed81` |
| Hashed requirements export | `106462422fbccb3de865849002dd6c50752641c84c41caaa48d88f44b3d3e751` |
| `pip-audit` JSON | `8559a6b1941a741515e22da636c2860c8f2c8f8d77cc5a6b0010d877d5ccb7cc` |
| `pip-licenses` JSON | `b3d9762b2607d10bfae630bcd8621972f7ab136884036b38decd781ddd940fd1` |
| Durable normalized audit | `generated/q01/dependency_audit_summary.v1.json`; `3284393f4c4d572dbb1ea4ec43f9953bda9a36274122f2487e9778fc1e74391e` |
| Durable normalized license inventory | `generated/q01/dependency_license_inventory.v1.json`; `1055ace0fc9bbd78c4be8930244da8c821a0dedba6df9d4b584571aa5c6ac834` |

The interpreter binary hashes are observations of the installed host artifact, not portable trust anchors. A clean host must verify the official `uv` release artifact and its selected managed-Python source independently. Q01 does not commit downloaded executables, wheels, caches or audit databases.

The lock resolves 51 distributions including the local project and platform-conditional entries. The vulnerability and license inventories contain 49 third-party distributions after excluding the local project. Direct runtime dependencies are exactly DuckDB `1.5.4`, Polars `1.42.1` and PyArrow `25.0.0`; every Q01 tool is an exact dev pin. Transitive versions and artifact hashes are frozen by `uv.lock`. The two canonical files under `generated/q01/` preserve every scanned package/version plus the observed finding/license fields; the larger raw scanner reports stay ephemeral and are cross-bound by SHA-256.

## Reproduction commands

Run from `quant/` with the pinned `uv 0.11.28`:

```bash
uv lock --check
uv export --locked --all-groups --no-emit-project --format requirements-txt --output-file /tmp/q01-requirements-audit.txt
uv run --locked --no-sync pip-audit --require-hashes --disable-pip --requirement /tmp/q01-requirements-audit.txt --format json --output /tmp/q01-dependency-audit.json
uv run --locked --no-sync pip-licenses --from=mixed --format=json --with-authors --with-urls --with-system --ignore-packages quant-edge-research --output-file=/tmp/q01-dependency-licenses.json
```

Observed results:

- lock check: exit `0`, 51 resolved entries;
- `pip-audit 2.10.1`: exit `0`, 49 dependencies examined, zero known vulnerabilities returned;
- `pip-licenses 5.5.5`: exit `0`, 49 dependencies inventoried, zero missing/`UNKNOWN` license fields;
- detected license expressions: Apache-2.0, BSD-2-Clause, BSD-3-Clause, MIT, MPL-2.0, PSF-2.0 and permissive dual/composite variants;
- no GPL-family dependency is in the Q01 lock. The MPL entries are `certifi`, `hypothesis` and `pathspec`; they remain unmodified third-party dependencies.

The repository does not declare a project-level license in Q01. The local `quant-edge-research` distribution is deliberately excluded from the third-party license scan; no license is invented for it.

## Security posture and limits

- `pip-audit` queried time-varying PyPI/OSV-backed advisory evidence. Zero returned findings means no indexed advisory matched this exact resolution at retrieval time; it does not prove absence of vulnerabilities, malicious packages, compromised releases, native-code defects or future disclosures.
- Hashed requirements constrain downloaded artifacts represented by the lock. They do not authenticate the package publisher, the Python/`uv` bootstraps, the operating system or a compromised upstream artifact already bearing the recorded hash.
- PyArrow and Arrow have had historical memory-safety/deserialization advisories; the locked version is newer than the cited fixed releases, but Q02 must still checksum, schema-check and reject corrupt/unadmitted files.
- DuckDB is restricted to future allowlisted local analytical use. Q02 must disable extension autoload/network/community extensions, reject arbitrary paths and use deterministic query settings in canonical tests.
- Polars lazy/streaming execution does not guarantee meaningful row order unless the Q transform specifies one. Q02 golden tests must make order, schema, nulls and decimal/timestamp units explicit.
- License metadata comes from installed distribution metadata and classifier normalization. It is an engineering inventory, not legal advice; source notices and distribution obligations require review before external distribution.
- Dev-only scanner dependencies increase the locked surface but do not enter advisory library runtime imports. No Q01 library code reads environment variables, opens network connections or dynamically loads foreign model artifacts.

## Maintenance rule

Do not silently update this lock. A dependency change needs current official version/security/license research, a regenerated lock, clean install, focused and accumulated tests, a new audit/license observation, and a phase receipt. Newly disclosed advisories are evidence for a bounded maintenance decision, not permission to bypass phase order or change frozen/shared code.
