import { sha256 } from '../../dock/src/canonical.mjs';
import { fail } from './errors.mjs';

export const OWNER_EVIDENCE_STATUS = 'UNACCEPTED_SYNTHETIC_OWNER_OUTPUT_STUBS';
export const OWNER_EVIDENCE_HASH = 'cdad6dd37b19304e0c6876cd8f5813bac7feac1b79d2a622aa5738d69fa89984';

export const ALLOWED_SNAPSHOT_OWNER_CLAIM_HASHES = Object.freeze([
  '2078716849b74e930fe48824b22414aad5a34be2528c46af038427ffe1db28bd',
  '79fe52b4ec0cea63d19f6bd79b97279b967916bfb8a4d98b209f3c2f376b298c',
  '86e23b2d2d1a47466fde56d0b5f0d67bafaaa9d44f049c4d2d805bdeae5619e3',
  'd6d889a192d70cd248cd8bd5f5657dec7f5412593eff4ee299984f6cf8c80d6d',
  'f396c96f6cc96bad7eddff3f3c09c73787a9abc9573b47420fa9d379f5825f1f',
]);

export const ALLOWED_SCENARIO_OWNER_CLAIM_HASHES = Object.freeze([
  '026e7c2ff1181a54e1eae3740945a2457274a745c594815992b4a0027c4a8c44',
  '046bded82df964a6b6f8c70840a35dc88e5dc31be1c6986d4516cb69b912697b',
  '06fdce61b6d265732a55b7219e5c2c92ba6a8fcf7a03bb535bb2b3e93921d904',
  '09d6cac5a294cd7f5f46ca6c7e7ac431881a62cb0afa3d86fb691ba76d1f49a3',
  '11d537b3a05f90e20c5fe7e31ad30c005fa406199c5997e984f094c610acae91',
  '18dbcae4c50131405f44532dc939864d90a52e723a548fbf64fd3d2b7170cece',
  '20b67b4d4b950f45afe4173bff45c4235a4539385e6d214cab26af75bab28c25',
  '247bd7a8ccf3ed00a35bfcd324d11b47555ba9e0b150e107d58ae4a89720c992',
  '25750da5b77836c89cabf999de5adda06e0cde264e19ef63d1ca9afb2ff57d71',
  '2cb9ea07ddf3994e197526a97a06e14ee3ab826f51a5d225559e492c2294fb35',
  '3599150aca410725eba5bd0988704584b966b4800c3ecca19afee40b098777a3',
  '386583d4d1f2bf84c53941a7c1a6492b5be4a66623bdae4642354a29105b5629',
  '38e6fb4e39157f12678e2b5ee7304b7ecf2b0f9f2b7bda2d9ed536e309f9d6b2',
  '3a966d70b3b7e52ec252466dd20c2c3ec046895dc6ee13d6b10944e76b4bcf21',
  '3e470d0c180a173cf7abf4f61b54937bc0fe3fad551332eb51c3ced6189cda1a',
  '787be6adf1730b55dfc0888b666757d1d9c523a5cb7ecdd714254113e6d9c4ac',
  '8687918ccd45060bab16409b2b9cbd8b182f66e9d659c923784a17f836e396e0',
  '8b994bfb4c530df8023b5d9011848d4d4e330b56b99ed2f944615d197c224d7f',
  '8eb251013bdc8b8e09f5e104c325bd84162651d746ecd7a5330203d02bc85f8b',
  '8f78458b2cfc5c12c24a2eac7c5628d2f9e722ddbccd5802a04cf46b9f453853',
  '9a8b806ef90f30a67266a0a2fa97440657b6a0b44306d8bd88944f6de5637f10',
  'a1ed032f643f3710f525e4a45490cd7a35d179c91b828d3b55d1f5f3b704a50b',
  'a4f7596ba6da6c5bea16273fa93e70450dd3bceb56abd104e0d079f4d00ffb1b',
  'b3cbd5cffaf9191a8dbbcfa1d7ce8b9b9c5722e093789b7e7ece856a02a4d922',
  'd9077b8478772a25a6a5f41781ac60e9847a20dd183746414fb3b4a7341b703f',
  'e775a43dc28bfd9d8dba4be72b72ee2f5db0424adb0fe5306e2e058632feab99',
  'f70297675e42ced1549f47f46ff0a438325b72bc28a636c7317cc24844561886',
]);

const ALLOWED_SNAPSHOT_CLAIMS = new Set(ALLOWED_SNAPSHOT_OWNER_CLAIM_HASHES);
const ALLOWED_SCENARIO_CLAIMS = new Set(ALLOWED_SCENARIO_OWNER_CLAIM_HASHES);

export const FIXED_OWNER_BINDINGS = Object.freeze([
  Object.freeze({
    ownerKey: 'CAPITAL',
    fixtureOutputRef: 'fixture://portfolio-lab/owner-output/capital-budget-r1?sha256=b2b000b9dc204aed7615128b9669da3dfab884edf768ff41a03ed9a88c41e3e3',
    canonicalOwnerContractRef: 'git:f0168cb37bd04d21bc90591ab2256770de3b75bc:server/src/capitalFoundation/budgets/types.ts#PortfolioBudgetSnapshot',
  }),
  Object.freeze({
    ownerKey: 'RISK',
    fixtureOutputRef: 'fixture://portfolio-lab/owner-output/risk-verdict-r1?sha256=c99e707b9c6206d5bd4b53c473cbf9f31961ffd8c8f2ae85fbddb2a975c2f6d9',
    canonicalOwnerContractRef: 'git:f0168cb37bd04d21bc90591ab2256770de3b75bc:server/src/foundation/contracts/risk.ts#RiskVerdict',
  }),
  Object.freeze({
    ownerKey: 'Q',
    fixtureOutputRef: 'fixture://portfolio-lab/owner-output/q-cost-stress-r1?sha256=bd5577db50408d41f811d87f8167cc3ba7ebb58c167c4128d08cf490cbfd4887',
    canonicalOwnerContractRef: 'git:02b4eccc8d2ef53b830cafae06e5175715fa6ebb:quant/src/quant_edge/validation/stress.py#CostStressReportV1',
  }),
  Object.freeze({
    ownerKey: 'L_TWIN',
    fixtureOutputRef: 'fixture://portfolio-lab/owner-output/l-twin-state-r1?sha256=2bab3d8b6fe3f358e7e2763ad1577c4417f9029ea0b551cb4d7309195a39c79a',
    canonicalOwnerContractRef: 'git:df6b472993ca9659ce09cf5f72004981c6835f0d:server/src/liveEdge/adapters/exchangeTwin/types.ts#TwinScenarioState',
  }),
  Object.freeze({
    ownerKey: 'L_RECOVERY',
    fixtureOutputRef: 'fixture://portfolio-lab/owner-output/l-recovery-r1?sha256=c9890b01df076fd346aa1fb2039b0dbe63baca7cb9492c0c5fdabb997b779580',
    canonicalOwnerContractRef: 'git:df6b472993ca9659ce09cf5f72004981c6835f0d:server/src/liveEdge/adapters/exposureRecoveryProjection/types.ts#L12SupervisorSnapshot',
  }),
]);

export const FIXED_OWNER_OUTPUT_REFS = Object.freeze(FIXED_OWNER_BINDINGS.map((row) => row.fixtureOutputRef));
export const FIXED_OWNER_CONTRACT_REFS = Object.freeze(FIXED_OWNER_BINDINGS.map((row) => row.canonicalOwnerContractRef));
export const FIXED_OWNER_OUTPUT_REF_BY_KEY = Object.freeze(Object.fromEntries(
  FIXED_OWNER_BINDINGS.map((row) => [row.ownerKey, row.fixtureOutputRef]),
));

const OWNER_CONTRACT_BY_OUTPUT_REF = new Map(FIXED_OWNER_BINDINGS.map((row) => [
  row.fixtureOutputRef,
  row.canonicalOwnerContractRef,
]));

const OWNER_BINDING_BY_KEY = new Map(FIXED_OWNER_BINDINGS.map((row) => [row.ownerKey, row]));

function sameOrdered(left, right) {
  return Array.isArray(left) && left.length === right.length
    && left.every((value, index) => value === right[index]);
}

export function validateOwnerEvidenceAnchor(record, name) {
  if (record.ownerEvidenceStatus !== OWNER_EVIDENCE_STATUS
    || record.ownerEvidenceHash !== OWNER_EVIDENCE_HASH) {
    fail('OWNER_EVIDENCE_ANCHOR_MISMATCH', `${name} must bind the exact unaccepted packet-local owner evidence manifest`);
  }
}

export function validateFixedOwnerReferenceSets(ownerSnapshotRefs, canonicalOwnerContractRefs) {
  if (!sameOrdered(ownerSnapshotRefs, FIXED_OWNER_OUTPUT_REFS)
    || !sameOrdered(canonicalOwnerContractRefs, FIXED_OWNER_CONTRACT_REFS)) {
    fail('OWNER_REFERENCE_SET_MISMATCH', 'owner fixture and contract references must equal the frozen packet-local evidence order');
  }
}

export function validateFixedOwnerKeyMap(ownerRefs, ownerContractRefs) {
  for (const [ownerKey, binding] of OWNER_BINDING_BY_KEY) {
    if (ownerRefs[ownerKey] !== binding.fixtureOutputRef
      || ownerContractRefs[ownerKey] !== binding.canonicalOwnerContractRef) {
      fail('OWNER_KEY_BINDING_MISMATCH', `${ownerKey} must bind its exact packet-local fixture output and schema-lineage contract reference`);
    }
  }
}

export function validateOwnerReferencePair(ownerSnapshotRef, canonicalOwnerContractRef, name) {
  if (OWNER_CONTRACT_BY_OUTPUT_REF.get(ownerSnapshotRef) !== canonicalOwnerContractRef) {
    fail('OWNER_REFERENCE_PAIR_MISMATCH', `${name} mixes fixture output and contract references from different owners`);
  }
}

function snapshotClaimPayload(record) {
  const {
    ownerEvidenceStatus: _ownerEvidenceStatus,
    ownerEvidenceHash: _ownerEvidenceHash,
    ownerClaimHash: _ownerClaimHash,
    snapshotHash: _snapshotHash,
    ...claim
  } = record;
  return claim;
}

function scenarioClaimPayload(record) {
  return {
    evaluationId: record.evaluationId,
    scenarioKind: record.scenarioKind,
    snapshotHash: record.snapshotHash,
    snapshotOwnerClaimHash: record.snapshotOwnerClaimHash,
    scenarioReference: record.scenarioReference,
    scenarioDefinitionStatus: record.scenarioDefinitionStatus,
    origin: record.origin,
    seed: record.seed,
    horizon: record.horizon,
    reproducibilityInputs: record.reproducibilityInputs.filter((entry) => !entry.startsWith('history-')),
    assumptions: record.assumptions,
    sweepInputs: record.sweepInputs,
    impacts: record.impacts,
    callerFacts: record.callerFacts,
    stateChanges: record.stateChanges,
    missingDependencies: record.missingDependencies,
    uncertainty: record.uncertainty,
    outputMode: record.outputMode,
    whyNotLiveSizing: record.whyNotLiveSizing,
    authorityClass: record.authorityClass,
    networkMode: record.networkMode,
  };
}

export function snapshotOwnerClaimHash(record) {
  return sha256(snapshotClaimPayload(record));
}

export function scenarioOwnerClaimHash(record) {
  return sha256(scenarioClaimPayload(record));
}

export function validateAllowedSnapshotOwnerClaim(claimHash) {
  if (!ALLOWED_SNAPSHOT_CLAIMS.has(claimHash)) {
    fail('OWNER_SNAPSHOT_CLAIM_NOT_ALLOWLISTED', 'snapshot values are not one of the hash-pinned packet-local owner fixture claims');
  }
}

export function validateAllowedScenarioOwnerClaim(claimHash) {
  if (!ALLOWED_SCENARIO_CLAIMS.has(claimHash)) {
    fail('OWNER_SCENARIO_CLAIM_NOT_ALLOWLISTED', 'scenario values and context are not one of the hash-pinned packet-local owner fixture claims');
  }
}

export function bindOwnerEvidenceAnchor(record) {
  record.ownerEvidenceStatus = OWNER_EVIDENCE_STATUS;
  record.ownerEvidenceHash = OWNER_EVIDENCE_HASH;
  return record;
}
