# IP Assurance core-scaffold evidence seal

Updated: 2026-07-13. This is the resumable A-CORE evidence seal before director fan-in. It is not director acceptance and does not claim full prestage readiness.

## Current step

Step **7/7 is complete** for the core scaffold. The D-LAUNCH-13 repair pass, exact-commit evidence loop, deterministic two-pass generation, and receipt sealing are complete. No A-CORE blocker remains before the I00 director's serial satellite fan-in.

## Governing identities

- Branch: `ip-assurance-20260713`.
- Frozen base: `9785c93102b00389847b77c2f9348c06abc4344b`.
- D-LAUNCH-13 ruling commit: `c57610cb5f7d56efb61e53ae27057fbe92a6a2f6`.
- Governing `c57610c:IP_ASSURANCE.md` SHA-256: `49dcd690275ff35cb32566af307ad572d2a527e06d7388885f98826560968e84`.
- Governing `c57610c:QL_DIRECTOR_STATE.md` SHA-256: `ec61e1678dcb108a92b9dda5503233c76b35fa5301c36077e04bdaead7b44307`.
- Historical local packet SHA-256, preserved unchanged: `5f6d4b3b70e384f6123e9ccc01891faf04aef9da7f7cfd1e0c63be5c3ba68803`.
- Implementation and tested commit: `f67db03293b184473f7f8e79b8872c6f6697f264`.
- Injected closure evaluation time: `1783952981020` UTC milliseconds.

## D-LAUNCH-13 dispositions completed

1. Exact owner/release/subject/digest tuple binding is enforced with tuple-digest conjunction, trusted consumer expectations, canonical deep snapshots, and hostile owner, release, subject, digest, algorithm, splice, malformed-shape, prototype-key, and post-verification mutation proofs. Missing owner input remains `WAITING / UNKNOWN`; it is never pre-converted to `UNAVAILABLE`.
2. Duplicate authority for assurance-case, action-evidence, governance, coverage, and rate-budget was removed. A-CORE now exposes only canonical-owner adapters or `WAITING` seams. Rate-budget priority, reserve, cooldown allocation, and projection truth are not locally authored.
3. The existing `newsContext` dynamic fetch is registered as `PURE_READ / KEEP_CANONICAL`, owner `EXISTING_NEWS_CONTEXT_SERVICE`, operation `OP_NEWS_CONTEXT_PUBLIC_READ`, reviewed site `OPSITE_FD086559819579DF346A`. The shared service file was not edited. `AIR-NEWS-CONTEXT-DYNAMIC-METHOD` records the I00 GET-policy hardening insertion request without blocking core readiness.

## Exact-commit evidence loop

- Server typecheck: PASS, exit `0`.
- Server build: PASS, exit `0`.
- Focused Product Assurance suite: PASS **32/32**, exit `0`.
- Production operation scan: PASS **143/143** mapped, **0** uncovered across **368** source files, exit `0`.
- Scope/import/secret purity: PASS; **37** considered changed paths, **0** purity findings, **0** secret findings, exit `0`.
- Edge protocol conformance: PASS **22/22**, exit `0`.
- `npm test`: PASS, exit `0`.
- `npm run test:all`: PASS, exit `0`, including server/web typecheck and build plus deterministic, app, intelligence, intelligence-runtime, capital, foundation, and system-integration families.
- Synthetic fault harness: PASS **103/103**, truth `SYNTHETIC_ONLY`; this is not live, deployed, soak, recovery, or authority evidence.
- Independent final false-green review: PASS after corrections; no remaining P1 finding in tuple consumers, gate selection, or cockpit owner provenance.

The non-fatal Vite large-chunk warning is outside this packet's source scope and does not change any test exit code.

## Two-pass byte-identity seal

The closure generator ran twice with identical branch, commit, timestamp, ruling, and disposition inputs. Both invocations reported **12 outputs**, **68 insertion requests**, scanner **143/143**, and synthetic fault harness **103/103**. Every output SHA-256 was byte-identical across the two runs.

Sorted manifest SHA-256: `95fb5f731116bd1671c6efad65d9d6402cdfe478814bff86592480e9f27717c7`.

| SHA-256 | Output |
| --- | --- |
| `10f32bcbe45a4dce9f46abf5ebacbbc79eb9715a3d42d78bd066c6f4b6708776` | `fixtures/productAssurance/fixtures-root/core-assurance-evidence.json` |
| `a39b031bf19d1d027e504233e6d4ebbd3b7fe35bcb90183dd70aae13da552c1e` | `fixtures/productAssurance/fixtures-root/fault-harness-synthetic.json` |
| `949f6ac7209315601be0dd874961668f068d608d831c899acd7fab38f4baeb2f` | `fixtures/productAssurance/generated/AGENTIC_DIAGNOSTIC_BOUNDARY.md` |
| `899f8aea317ebe4c9c5144ae9f04b1f8eb68703632b208de4fe0ac29edd6a1b1` | `fixtures/productAssurance/generated/ASSURANCE_INSERTION_REQUEST.md` |
| `85378bd1c58aba3c6dc3120e8361d49d0057f8702c1024f7884241eb098be69c` | `fixtures/productAssurance/generated/FAULT_INJECTION_AND_SOAK_REPORT.md` |
| `32ca295d30c9c1c9822ebcc7d176916718d26fc6f8d7af06b9d9683cf1772914` | `fixtures/productAssurance/generated/OPERATIONAL_FAILURE_ATLAS.md` |
| `e7cb05da115e3e946a475ae0775f9a7a8bd7dda23739d80ad879989c45de60b5` | `fixtures/productAssurance/generated/OUT_OF_BAND_RECOVERY_REPORT.md` |
| `4c3dd83174aaeecd210d91d0aa8b45c026a00307b8226384dccaaf4b60eaa3ea` | `fixtures/productAssurance/generated/Q_ASSURANCE_COVERAGE_MATRIX.md` |
| `727363acf2f38b07b97a7ad2f9dfbf8394578f1f375cd82cedfd01003fde4898` | `fixtures/productAssurance/generated/RELIABILITY_POLICY_REGISTRY.md` |
| `d06319be01c66745064ec5bb614570d5f5ef2861519c782ac9f0b0d166a05cb0` | `fixtures/productAssurance/generated/SAFETY_INVARIANT_CATALOG.md` |
| `1ea1062c7c2cd53b817e69ffa5e525f1f7278981ea4e5898bb468115a83fe9f3` | `fixtures/productAssurance/generated/TELEMETRY_COVERAGE_MATRIX.md` |
| `93b1f6283d48ddeadf9b7205e47f3ccfc698d4f79f98b8e82ecad1d7aa4a302e` | `fixtures/productAssurance/receipts/IP_ASSURANCE_RECEIPT.md` |

## Protected inputs and authority boundary

- Protected untracked I00 SHA-256: `9d7a36da6a2e6e7b3e905c73161b5e998a2f92416dd557e498ade3e73d5e5ef5`.
- Protected dedup matrix SHA-256: `22686d2cd1c54bbc39af56399298a0ed9563bbc8643ad4f0e498718de83cb2cd`.
- Canonical news service SHA-256: `38aa196200f1325cd135f2a8a00f46ace5caa1d2fcf0811c357c52f80f47bede`; Git blob `670fb04152632db6d8a3569ff483b6a8f3ad1e4d`.
- `LIVE_EXECUTION_NOT_IMPLEMENTED` remains binding. No live/test order, private/signed exchange call, borrow, repay, transfer, withdrawal, leverage/margin mutation, deployment, push, merge, or `current-main` write was performed.

## Exact next owner

Only the I00 director may serially fan in accepted satellite commits, perform shared wiring, update root state, rerun the accumulated acceptance battery, and decide whether the later full-prestage terminal is justified. A-CORE stops here.

## Terminal

`CORE_SCAFFOLD_READY`
