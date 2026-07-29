# V-G23 verification

## Frozen lineage

- Canonical base:
  `a169b123fb186d1943a75ad648552c4d95be1be1`
- Code freeze:
  `e79de7bb9d21637e135a105784cd443659f3c212`
- Code-freeze tree:
  `6f1d5176feebfe3b2e56d5e6cf98f6837186bc85`
- Source freeze:
  `164d1c72a7f85bc2ab3330559d3ccd0fd26d9a51`
- Source-freeze tree:
  `e787c7c13aebded5131082a7176f1b3d9abb2f7f`
- The code freeze is a direct child of the canonical base and changes exactly
  six static paths under `quant/research/vg23/**`.
- The source freeze is its direct child and adds only `freeze.v1.json`.

## Source and byte bindings

- Candidate universe: `605` symbols; SHA-256
  `a597d8339aafb74c40b8899cade9445150c3f431f4c2e7fe2bfac37d8d1b0592`
- Frozen target inventory: `6,680` present and `3,000` absent symbol-months;
  SHA-256
  `95b7f00860711f7c34bce775b518fc4f33fa1894f45b2599aacba04645ab177e`
- Discovery SHA-256:
  `b4a8f7abd36df19eff0510dfcc3c61fd0df9fdcab5f4d248892ee10010fb21c3`
- Acquisition SHA-256:
  `01f58272602e43bfb914b649adc00d8273b2d423492220a55f86443bb6441176`
- Freeze SHA-256:
  `aaced905476866fc343dc527b739def4180007187e4229cb7b2918bdf742a526`
- Result SHA-256:
  `eb95e27b8730c2a26893a4bcf3e07152b82ead17aa7a7541539cdad69d4ddf16`
- Run-receipt SHA-256:
  `17e5f4afef0919e5f11c373c5de99c6ee46e93603cab1f10b90e627a27553ecf`

## One-use lifecycle

The receipt embeds and byte-checks all four external evidence records:

- Run marker:
  `6764a3810a2d60018a5215bc170c970023ebf58dcec9568348a82a26eb8480ea`
- Candidate seal:
  `e1a2fe21f3313a639e8c33bf663497e200893bc7430fc3a8e8b7b4bf0c2a7484`
- Holdout-open marker:
  `3b2bab3acc7fbe5ae8734d524b2143fae28d3b19073686616db4cb6b59c24b6b`
- Terminal-result core:
  `0e480ce87e132f76dc7e02b0d602031f208b74d750db8d06fcaff6ab0cfc50d4`

The run and holdout counts are `1/1`. The candidate seal binds the exact
development evidence and champion before the holdout marker. The terminal core
binds every result field before the receipt; the result then binds both the
terminal core and receipt. Rerun, retune, runner-up substitution, repair, and
holdout reopening are forbidden.

## Focused proof

Pre-run proof on the exact code freeze:

```text
pytest: 32 passed
ruff check: PASS
ruff format --check: PASS
mypy --strict --explicit-package-bases: PASS
exact direct-parent/static-path review: PASS
metadata-only source-freeze review: PASS
```

Terminal acceptance requires both verifiers against the committed packet:

```sh
PYTHONHASHSEED=0 \
  /Users/cosmosgeek/Desktop/cosmos-merge/quant/.venv/bin/python \
  quant/research/vg23/experiment.py verify
PYTHONHASHSEED=0 \
  /Users/cosmosgeek/Desktop/cosmos-merge/quant/.venv/bin/python \
  quant/research/vg23/verify.py
```

The independent verifier enforces canonical JSON, finite values, exact packet
files and checksums, code/source/terminal Git allowlists, external marker byte
equality and semantics, candidate/champion binding, immutable result-core
reconstruction, headline derivation, public-cost/capacity truth boundaries, and
independent recomputation of all 27 frozen gate decisions.
