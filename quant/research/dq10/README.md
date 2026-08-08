# DQ-10 research-result truth-semantics validator

DQ-10 is a portable, network-free validator for one declared research-result
envelope. It prevents missing evidence, verified zero, failed gates, and
positive-looking point estimates from collapsing into the same meaning.

It validates declarations only. It does not calculate a strategy result,
discover omitted trials, open a holdout, inspect evidence bodies, reconstruct a
research sample, or grant capital or execution authority.

## Two-input contract boundary

Validation requires two independent byte inputs:

1. one caller-supplied regular file with schema `DQ10ResultPolicyV1`; and
2. one result with schema `DQ10ResearchResultV1`, supplied as a regular file or
   through standard input.

The policy is mandatory. There is no embedded default, ambient lookup, or path
inference. Unknown or extra keys in either input fail closed.

The exact policy file declares:

- `policyId`;
- the exact consumer `N3 successor/final convergence`;
- metric `NET_ECONOMIC_RETURN`;
- one supported `economicsUnit`;
- rule `ALL_MANDATORY_PASS_AND_LOWER_BOUND_GT_ZERO`;
- sorted, unique, nonempty `mandatoryGateIds`; and
- sorted, unique `optionalGateIds` disjoint from the mandatory inventory.

The result binds:

- a stable `resultId`;
- the policy identity and SHA-256 of the exact supplied policy bytes;
- the policy-declared consumer;
- one declared sample denominator;
- one estimate and two interval bounds;
- the complete policy-declared gate inventory, exact mandatory/optional
  classification, and mandatory-gate summary;
- one tri-state credible-positive declaration;
- one `GO`, `NO_GO`, or `UNMEASURED` measurement verdict;
- explicit capital and execution non-authority;
- sorted, unique limitation codes.

The policy SHA-256 binds raw bytes, not a reserialized JSON value. Whitespace,
line endings, member order, or any other byte change produces a different
digest even when a JSON parser would assign the same meaning. The result's
`policy.id` and `policy.sha256` must match the supplied policy exactly.

Evidence identifiers are opaque references. DQ-10 checks their presence,
ordering, uniqueness, and required joins; it does not open or authenticate the
referenced artifacts. The policy pin lets a consumer bind the exact upstream
rules that produced the declarations.

## Strict JSON and portability

The validator supports Python 3.9 or newer and uses the Python standard library
only. The policy is always read from a regular file. The result is read from a
regular file or standard input. Parsing is strict UTF-8 JSON:

- duplicate object names, trailing syntax, `NaN`, and infinities are rejected;
- negative zero is rejected, while positive numeric zero remains representable;
- integer counts must stay within the interoperable exact-integer range;
- numbers must be finite and inside the supported binary64 magnitude range;
- input bytes, nesting, node count, strings, objects, arrays, gates, and token
  lists are bounded;
- validation paths use structural indexes rather than caller object names, and
  report paths and messages have fixed output bounds;
- every object has one closed key set.

Regular-file reads reject links and non-regular objects. DQ-10 binds the opened
device, inode, size, modification time, and change time; checks them again after
reading; and confirms that the caller's path retains the same measured
identity. Path replacement and same-inode rewrites with restored modification
time fail with `INPUT_CHANGED`. These checks detect ordinary races but are not
an atomic filesystem snapshot or protection against a privileged actor that
can forge metadata; N3 must keep supplied artifacts immutable and compare both
report digests with its intended bytes.

Decimal range and comparison checks do not depend on ambient Decimal precision,
rounding, traps, or flags. Validation neither consumes nor changes caller
Decimal context state.

The output is canonical compact JSON using `DQ10ValidationReportV1`. It binds:

- `policySha256`, the exact supplied policy bytes;
- `inputSha256`, the exact supplied result bytes; and
- a normalized `result` projection containing result/policy IDs,
  `measurementVerdict`, tri-state `crediblePositive`, fixed capital verdict,
  and fixed capital/execution authorities.

When standard output is writable, invalid reports keep `result: null` and
expose available input digests only for bytes successfully read. An unavailable
input or output stream fails closed without a traceback; no program can emit a
report to an unwritable destination. Short writes are completed before success;
a zero-progress, partial-then-blocked, or failed write returns non-green. Exit
code `0` means that the envelope is internally valid under the supplied DQ-10
policy and its complete report was written. Exit code `1` means invalid policy,
input, declarations, or unavailable/incomplete report output. Exit code `2`
means invalid command usage. A valid report or matching digest is not proof
that the underlying research is correct.

## Policy ownership and N3 admission

DQ-10 proves that a result matches the policy bytes supplied in that invocation.
It does not prove that the caller supplied an approved policy.

Before consuming a DQ-10 projection, N3 must:

1. preapprove one exact policy SHA-256 through its own convergence process;
2. supply that exact policy file to DQ-10;
3. compare the report's `policySha256` with the preapproved digest; and
4. compare the report's `inputSha256` with the exact result artifact it intends
   to consume.

Supplying a new policy and a matching new result can produce a structurally
valid DQ-10 report, but it cannot replace N3 policy approval. Policy approval,
registry completeness, and final convergence remain N3-owned.

## Truth objects

Numeric and boolean truth use the same two-state envelope:

| state | value | evidence IDs | reason codes | meaning |
|---|---:|---|---|---|
| `UNKNOWN` | `null` | blocker references may be present | at least one | the value was not established |
| `VERIFIED` | number or boolean | at least one | empty | the declared value was established by named evidence |

`null` is not zero. Numeric `0` is accepted only as `VERIFIED` with evidence.
An unknown value carrying `0`, and a verified value carrying `null`, both fail.

Unknown primary economics are all-or-none: `estimate`, `lowerBound`, and
`upperBound` must all be `UNKNOWN` with `null` values and a `null` unit.
Verified economics require all three numeric values, a unit, evidence, and
`lowerBound <= estimate <= upperBound`.

The policy accepts only these net-economic-return units:

```text
BPS_NET_RETURN
PERCENT_NET_RETURN
USD_PER_1K
USDT_PER_1K
```

A non-economic unit such as a p-value is rejected. Verified result economics
must use the exact policy unit; unknown economics retain `unit: null`.

## Sample and gate denominators

`sampleDenominator` is either:

- `UNKNOWN` with `count: null` and a reason; or
- `VERIFIED` with an evidenced non-negative integer count.

A verified count of zero remains truthful zero, but it is not an analyzable
sample and therefore cannot produce a measured decision verdict.

Every gate declares a stable ID, whether it is mandatory, and either an
`UNKNOWN/null` or `VERIFIED/boolean` result. Gate IDs are sorted and unique.
The result must contain exactly the union of policy `mandatoryGateIds` and
`optionalGateIds`: no missing or extra gate is accepted, and each `mandatory`
boolean must match the policy classification. DQ-10 recomputes the mandatory
summary and requires both denominator identities:

```text
mandatoryTotal = mandatoryVerified + mandatoryUnknown
mandatoryVerified = mandatoryPassed + mandatoryFailed
```

The summary is therefore a complete partition of the declared mandatory
gates. It cannot treat unknown gates as failures, omit failed gates from the
denominator, or use the passing count as the total.

## Measurement verdict

Decision inputs are complete only when:

- the sample count is verified and greater than zero;
- estimate and both interval bounds are verified;
- at least one mandatory gate exists; and
- no mandatory gate is unknown.

The verdict is then derived, not trusted:

| condition | `crediblePositive` | measurement verdict |
|---|---|---|
| any decision input incomplete | `UNKNOWN` / `null` | `UNMEASURED` |
| all mandatory gates pass and the verified lower bound is strictly above zero | `VERIFIED` / `true` | `GO` |
| decision inputs complete, but a mandatory gate fails or the lower bound is zero or negative | `VERIFIED` / `false` | `NO_GO` |

For `UNMEASURED`, primary economics must remain unknown/null and
`crediblePositive` must be `UNKNOWN/null`, have no supporting evidence IDs,
and include `DECISION_INPUT_UNMEASURED`. This blocks a positive point estimate
from surviving beside an unmeasured verdict.

For a measured result, credible-positive evidence must equal the sorted union
of sample evidence, all three economics evidence sets, and every mandatory-gate
evidence set. Optional gates do not enter the verdict.

`crediblePositive` is a contract-specific evidence state, not a probability,
confidence score, trading signal, or independent statistical test. The
upstream policy remains responsible for interval construction, multiplicity,
holdout, costs, and every gate definition.

## Capital and execution semantics

Every valid DQ-10 envelope requires:

```text
capitalVerdict = NO_GO
capitalAuthority = NONE
executionAuthority = NONE
limitations includes CAPITAL_AUTHORITY_NOT_GRANTED
```

These values remain fixed even when `measurementVerdict` is `GO`. DQ-10 can
make a research declaration structurally consumable by N3; it cannot authorize
funding, allocation, orders, transfers, withdrawals, or any other account
action.

## DQ-10 versus DQ-11

DQ-11 owns stage-by-stage sample admission: stable row or event identities,
eligibility, exclusions, stage counts, exclusion reasons, and construction of
the final analysis denominator.

DQ-10 does not repeat that work. It validates only the declared
`sampleDenominator` state/count/evidence shape inside the result envelope and
the algebra of declared gate counts. A DQ-10 pass cannot prove that upstream
admission identities were complete or that a denominator was constructed
correctly. Future integration should require the independently accepted DQ-11
receipt where the policy calls for it.

## Focused proof

Run from the repository root:

```text
python3 quant/research/dq10/validator.py POLICY.json RESULT.json
python3 quant/research/dq10/validator.py POLICY.json - < RESULT.json
python3.9 -m unittest discover -s quant/research/dq10 -p 'test_*.py'
python3.13 -m unittest discover -s quant/research/dq10 -p 'test_*.py'
python3.9 -m py_compile quant/research/dq10/validator.py
python3.13 -m py_compile quant/research/dq10/validator.py
```

Library callers use the same two-input boundary:

```text
projection = validate_bytes(policy_raw_bytes, result_raw_bytes)
```

The frozen candidate proof was executed with CPython 3.9.6 and 3.13.14.
Interpreter command names may be replaced by their local absolute paths.
Focused proof contains six valid fixtures and runs 65 tests.

- `valid_go.json`;
- `valid_no_go_verified_zero.json`;
- `valid_no_go_failed_gate.json`;
- `valid_no_go_nonpositive_lower_bound.json`;
- `valid_unmeasured.json`; and
- `valid_unmeasured_verified_zero_sample.json`.

The 65-test proof covers both CLI and API inputs, exact raw-policy SHA binding,
policy/result identity, exact mandatory/optional gate inventory and
classification, optional-gate verdict/evidence exclusion, supported units,
`GO`/`NO_GO`/`UNMEASURED`, verified numeric zero, unknown/null values, zero and
unknown sample denominators, failed and unknown mandatory gates, inconsistent
summaries, non-positive lower bounds, incomplete credible-positive evidence,
fixed non-authority and explicit capital limitation, duplicate keys,
non-finite numbers, negative zero, closed keys, bounded non-echo diagnostics,
bounded inputs, unavailable and short-write streams, file kind, path
replacement, same-inode rewrite detection, digest-bound projections,
deterministic errors across Decimal implementations, Python 3.9 and 3.13
execution, and ambient Decimal-context independence.

## Consumer and limits

Consumer: `N3 successor/final convergence`.

Known limits:

- no evidence body or digest is dereferenced;
- no caller policy is approved by DQ-10;
- no admission identity or denominator is constructed;
- no data custody, trial registry, statistical method, interval, multiplicity,
  holdout, fee, capacity, or economic calculation is verified;
- no prior research packet is changed or retroactively accepted;
- regular-file race checks are bounded metadata/identity checks, not an atomic
  snapshot guarantee;
- no UI, runtime, host, provider, private-account, order, transfer, withdrawal,
  or money state is touched.

Research consumption authority is limited to an internally valid declaration.
Capital and execution authority are always `NONE`.
