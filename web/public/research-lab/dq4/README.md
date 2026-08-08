# DQ-4 portable origin-proof validator

DQ-4 validates one sealed research packet from immutable Git objects, explicit refs,
ancestry, exact tree rosters, blob object IDs, and byte digests. It is a network-free
intake gate for future N3 research. It does not run an experiment, inspect a holdout,
or grant trading, deployment, provider, private-data, or money authority.

## Contract

Run the validator against any complete ordinary or bare clone containing the
required objects and refs:

```sh
python3 quant/research/dq4/origin_validator.py \
  --repo . \
  --manifest /operational/path/to/origin-proof.v1.json
```

The manifest path and `--repo` value are runtime inputs only. The proof JSON itself
must contain no POSIX, Windows-drive, UNC, or `file://` absolute path. Its
`packetPath` is below `quant/research/`, and it plus every file path is a normalized
repository-relative POSIX path without control characters. That separation lets
the same manifest validate after relocation without depending on the producing
checkout.

The exact manifest schema is:

```json
{
  "schema": "cosmos.dq4.origin-proof.v1",
  "objectFormat": "sha1",
  "packetPath": "quant/research/example",
  "baseCommit": "<full object ID>",
  "preRun": {
    "commit": "<full object ID>",
    "tree": "<full object ID>",
    "anchorRef": "refs/tags/example-pre-run"
  },
  "sealed": {
    "commit": "<full object ID>",
    "tree": "<full object ID>"
  },
  "origin": {
    "remote": "origin",
    "sourceRef": "refs/heads/research/example",
    "trackingRef": "refs/remotes/origin/research/example",
    "expectedCommit": "<same full object ID as sealed.commit>"
  },
  "files": [
    {
      "path": "quant/research/example/protocol.v1.json",
      "stage": "pre_run",
      "blobOid": "<full object ID>",
      "sha256": "<64 lowercase hex>"
    },
    {
      "path": "quant/research/example/result.v1.json",
      "stage": "post_run",
      "blobOid": "<full object ID>",
      "sha256": "<64 lowercase hex>"
    }
  ]
}
```

`files` is sorted by `path`. The pre-run commit must contain exactly the `pre_run`
roster under `packetPath`; the sealed commit must contain exactly the full roster.
Pre-run files must retain their object ID and executable mode. Symlinks, gitlinks,
unlisted inputs, unlisted outputs, abbreviated IDs, unknown keys, duplicate JSON
keys, non-finite numbers, and malformed UTF-8 fail closed.

The pre-run tag must be a direct lightweight ref that binds the exact pre-run
commit. The configured positive fetch refspec must map the full source ref to the
full remote-tracking ref, no negative refspec may exclude it, and that tracking ref
must bind the exact sealed commit. Validation is intentionally offline: callers
must fetch through their own controlled intake before invoking DQ-4. A local
remote-tracking ref proves the object/ref state supplied to the validator, not
remote-server freshness, authorship, signing, wall-clock order, data custody,
economic validity, or holdout integrity.

The ancestry invariant is strict:

```text
baseCommit -> preRun.commit -> sealed.commit
```

Missing pre-run objects, missing or moved pre-run tags, amended sibling topologies,
generic non-ancestor histories, shallow repositories, grafts, replacement refs,
external object alternates, symlinks anywhere below the object store, symlinked
or external Git directory, Git-file indirection, symlinked common/worktree config
files, and common or worktree-scoped config includes are rejected. For a non-bare
repository, the effective Git and common directories must remain inside one real
top-level `.git` directory; for a bare repository, the supplied repository path must
be the complete Git/common directory it owns.
The amendment code is a structural same-parent-lineage classification; it does not
claim author intent. Origin fetch mappings are read only from common local config
with includes disabled. Git is invoked with inherited `GIT_*` repository selectors
removed, replacement objects disabled, system/global config disabled, lazy fetching
disabled, locale fixed, terminal prompts disabled, and no write locks. The manifest
is opened without following a final symlink and read through a bounded
`1 MiB + 1 byte` window.

## Output and frozen reason codes

The command emits exactly one compact, key-sorted JSON line:

- exit `0`: `PASS` with `ORIGIN_PROOF_VALID` and only portable proof fields;
- exit `1`: `REJECTED` with one exact reason code;
- exit `2`: `ERROR` for invalid invocation or an unsafe/unavailable environment.

The complete reason-code set and deterministic precedence are frozen in
[`policy.v1.json`](policy.v1.json). Receipts contain no timestamp, checkout path,
remote URL, raw Git stderr, or host details.

## Focused verification

```sh
python3 -m unittest quant.research.dq4.test_origin_validator
python3 -m compileall -q quant/research/dq4
ruff check quant/research/dq4
ruff format --check quant/research/dq4
mypy --strict --explicit-package-bases \
  quant/research/dq4/origin_validator.py \
  quant/research/dq4/test_origin_validator.py \
  quant/research/dq4/__init__.py
```

The fixture matrix is frozen in
[`fixtures/cases.v1.json`](fixtures/cases.v1.json). It creates only disposable
temporary repositories. It includes a relocated valid proof under hostile inherited
Git environment variables plus a complete bare clone and hostile absolute-worktree,
shared-alternate, external Git-directory symlink/gitfile, external-pack symlink,
common-config symlink, common/worktree absolute-config-include, missing-object,
wrong-type, amended-sibling, replacement-ref, missing/moved-ref, path-escape,
packet symlink, unbound-roster, precedence, oversized/deep JSON, and byte-tamper
cases. It never reads, changes, or reruns a prior research packet.

## Git semantics used

The implementation follows current primary Git documentation for exact revision
verification, commit ancestry, full ref verification, object inspection, and
replacement-object behavior:

- [git-rev-parse](https://git-scm.com/docs/git-rev-parse)
- [git-merge-base](https://git-scm.com/docs/git-merge-base)
- [git-show-ref](https://git-scm.com/docs/git-show-ref)
- [git-cat-file](https://git-scm.com/docs/git-cat-file)
- [git-replace](https://git-scm.com/docs/git-replace)
