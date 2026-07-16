# Q15 acceptance receipt — registry, lifecycle, drift and retirement

Acceptance status: `ACCEPTED`

Date: 2026-07-13

Acceptance authority: shard builder under director order D-LAUNCH-5.

## Accepted commits

- Implementation C15: `6b18928c282f19128a033ed33910754cbdc2cbe0`
- C15 tree: `04f78c5100f12979311cfb0c0608c2baab753863`
- C15 exact parent/shard base:
  `f756f3b582f24857811e6ec4c0d08a3a61026b74`
- Receipt/evidence R15: `e1e1238b4af4be01b875a29667b76f1b8a81e565`
- R15 tree: `693fc2b4f2c9a7f125258afc401fc6efb1bd9fb4`
- R15 exact parent: C15
- Immutable implementation receipt SHA-256:
  `baa20476a37867bb5d6fcef062918d50f80c5058d1be4a63ba6163ace24f346a`
- Immutable implementation receipt Git blob:
  `2abab0e7e4be2bcb098b25914f77647bf5750465`

The acceptance commit A15 is the commit that first contains this acceptance
receipt and generation-3 state. It is intentionally non-self-referential.

## Independent exact-commit verification

All checks passed against R15:

- R15 parent is exactly C15; C15 parent is exactly the shard base; R15 descends
  from frozen protocol ancestor `73e1a1ff7daa48df8dac45713fc5f106842edafc`.
- Base-to-R15 inventory contains exactly 26 paths. Every path is under
  `quant/src/quant_edge/registry_ops/**`, `quant/tests/q15/**`,
  `quant/generated/q15/**` or `quant/TASKS|RECEIPTS|DECISIONS/Q15*`.
- All changed entries are regular mode `100644`; `git diff-tree --check` passed.
- Current tracked files are byte-identical to R15. The only worktree extras are the
  two protected untracked owner directives, whose SHA-256 values remain
  `26b1d5ce…0f2c06` and `198f131d…aafa5ab4`.
- Generated experiment `codeCommit` is exactly C15; all 48 Q10 trial identities are
  present. Regeneration under `TZ=Pacific/Kiritimati` and
  `PYTHONHASHSEED=987654` was byte-identical to all committed generated files.
- Generated SHA-256 values exactly match `quant/RECEIPTS/Q15.md`: manifest
  `c5f0d7e7…85f79e`, cards `0457f22f…a08fb5`, campaign JSON
  `24debb2a…bd11b`, campaign Markdown `ef8de841…a4066`, synthetic report
  `12042d41…1f3c`.

## Exact R15 verification results

- Focused Q15: `59 passed`.
- Quant unit + Q15: `1207 passed`.
- Q10/Q11/Q14 dependency selection: `340 passed`.
- Complete quant: `2241 passed`, `4` documented Q08 shard-scope skips, 98.07%
  branch coverage; 95% threshold passed.
- Ruff lint and format-check: clean, 265 files. Strict mypy: clean, 265 files.
- Hypothesis registry: exit 0, 8 families. Protocol: `22/22`. Q00 scope:
  `6/6`. `npm test`: exit 0, 377/377 deterministic checks.

## Acceptance conditions

- Restart restores the exact champion and complete immutable lineage.
- SIGKILL before commit restores the exact prior champion; SIGKILL after commit
  restores the exact committed champion.
- Critical drift demotes to `ABSTAIN_UNKNOWN` without changing the champion artifact
  and without promoting a challenger.
- Promotion is forbidden while abstaining; explicit recovery invalidates pre-drift
  shadow evidence through generation/transition binding.
- Q14's unrelated `IMPROVES` report cannot promote Q10/Q11.
- Score/outcome digests, matured feedback, recomputed comparison metrics, report
  identity, lifecycle projection, monotonic transition time, retirement evidence
  and owner annotation chronology all fail closed under the committed adversarial
  fixtures.
- Producer-neutral target/score compatibility permits a generic future model family
  without any Q12 import, stub or reimplementation.
- No operational or money authority was added; all campaign truth is
  `SYNTHETIC_ONLY` and `HYPOTHETICAL`.

Q15 is `ACCEPTED`. This shard stops. The director alone owns any merge; nothing was
pushed.
