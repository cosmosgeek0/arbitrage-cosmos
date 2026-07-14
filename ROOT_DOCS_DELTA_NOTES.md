# Root-document landing delta notes — D-LAUNCH-24

Status: **DRAFT-UNTIL-CANDIDATE-SHA / NON-DONOR / ADVISORY ONLY**

Evidence cutoff: `i00-product-assembly-20260713@18a0b9d1153a5f4bb6c8b42909362c6a295475bb`, tree `135ec02a6615741307c323b561bf999e2d71ab20`

These are landing edits for existing root owners only. Do not add either landing draft as a new canonical root document. Fold the authority table into `ARCHITECTURE.md` Part II, fold the capability map/current counts into `STATE.md`, preserve `README.md` as quickstart/access, and preserve `MISSION.md` as stable purpose.

## `README.md` — deltas required

- Replace the current posture paragraph with candidate-bound wording. Suggested landing text:

  > **Current posture:** one composed public/read-only and validate-only system. Basis and Volume remain the sole strategy authorities. Product Integration and the Product Control Room project canonical System Integration/Ledger truth; Q, LiveEdge realism, Product Assurance and operations/proof families retain their exact advisory, synthetic, test-only, unwired or owner-gated boundaries. Live execution remains mechanically blocked (`LIVE_EXECUTION_NOT_IMPLEMENTED`), and withdrawal/transfer-out capability is absent.

- Correct the `npm test` comment. On the observed integrated tree it now includes the Product Assurance source/operation gate through `test:product-assurance:built`; it is no longer only “typecheck, build, engines, safety.” Use the exact frozen-candidate command graph and result.

- Correct the `npm run test:all` comment. The observed script includes protocol, Product Integration, Product Control Room and I00 proof suites in addition to the existing families. Do not copy receipt-era counts; cite `[CANDIDATE_TEST_ALL_RESULT]` only after freeze.

- Optionally add the following focused commands to the existing Commands block because they are stable operator/developer entry points in the observed `package.json`:

  ```bash
  npm run test:protocol             # frozen Edge Protocol conformance
  npm run test:product-integration  # Product runtime/projection/routes
  npm run test:product-control      # Product Control Room contracts/mounts
  npm run test:product-assurance    # source/operation assurance gate
  npm run test:i00:proof            # integration acceptance proof harness
  ```

  Recheck these script names at `[CANDIDATE_SHA]`; omit any command that is not in the frozen candidate.

- Replace the entire “Safe local Binance setup” section. Its present claim that adding a server-side key makes the cockpit show real balances, permissions, orders and fills is false for the observed integrated tree: `server/src/index.ts` constructs no private client (`unavailablePrivateBinanceClient()` returns `null`) even if ambient credentials exist. Suggested landing replacement:

  ```markdown
  ## Private Binance posture

  The accepted local runtime is keyless and public-only. Private account reads,
  private streams, signed Spot/USD-M validation, Margin reads and every money
  mutation are `NOT_CONFIGURED` or owner-gated. Do not add credentials to make
  the current release appear connected; a future private-read adapter requires
  separate owner authorization, least-privilege proof, canonical wiring and an
  updated state/receipt. Keys must never reach the browser, repository, logs or
  prompts.
  ```

- Correct “Operator access boundary.” Remove the stale bearer-token exception. The AWS ingress URL remains mounted only as a pre-admission `OWNER_GATED` 503 stub that performs no intake or persistence; every capability-bearing API route uses the canonical operator-access boundary, and state-changing remote routes require exact HTTPS same-origin. External operations remain owner-gated.

- Qualify the declared EC2/Cloudflare target as intended configuration, not current deployed truth. Use `[DEPLOYED_SHA_OR_NOT_CONFIGURED]` and `[TARGET_READBACK_RECEIPT_OR_NONE]`; software acceptance cannot imply deployment.

- Keep the hard-law bullets, especially no withdrawal/transfer-out, server-side secrets, fail-closed kill switch and ledgered outcomes. Do not broaden them to describe dormant LiveEdge signed-kernel or ops artifacts as active capabilities.

- Keep the documentation table at one file per purpose. Do not list `ARCHITECTURE_PART_II_LANDING_DRAFT.md`, `CAPABILITY_MAP_LANDING_DRAFT.md`, `ROOT_DOCS_DELTA_NOTES.md`, preverify artifacts, donor state files or packet receipts as canonical root docs.

## `MISSION.md` — no content delta required

- The observed integration changes implementation state, evidence tooling and ownership detail; it does not change the destination, two initial edge hypotheses, economic objective, permanent safety boundaries or product identity.
- Q remains a research second opinion, LiveEdge remains non-sendable realism/evidence, Product Assurance remains verification without authority, and the Control Room remains a renderer/controller of canonical backend truth. All fit the current mission without a mission-version or pinned-date change.
- Do not add donor names, lane phases, component counts, test counts, routes, package scripts, candidate SHAs, deployment state or release labels to `MISSION.md`; those belong in `STATE.md`, `ARCHITECTURE.md`, `README.md` or archived receipts.
- Do not rewrite the Binance research anchors merely because documentary contract matrices were integrated. Exact interfaces still require current official re-verification before a separately authorized implementation.
- Amend `MISSION.md` only if the owner actually changes the destination, economic objective, permanent safety boundary or fundamental identity before landing. If that happens, follow its existing change policy and reconcile subordinate docs in the same landing.

## Mechanical landing order

1. Freeze `[CANDIDATE_SHA]` and obtain exact independent verification for the same tree.
2. Apply the adjusted Part-II table to `ARCHITECTURE.md`; update Part I only for candidate-proved code-family/runtime posture.
3. Fold the adjusted capability map and measured current truth into `STATE.md`.
4. Apply the README corrections above using only candidate-proved routes/scripts/runtime/deployment facts.
5. Leave `MISSION.md` byte-identical unless the owner made a true mission change.
6. Archive final receipts under `docs/archive/`; do not land these advisory drafts as canonical root documents.
7. Commit the verified candidate bytes and all required root-document updates atomically; prove no bracketed placeholder or stale pre-candidate count remains.
