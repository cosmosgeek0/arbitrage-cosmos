import {
  FINAL_LANE_ACCEPTED_IDENTITIES,
  FINAL_LANE_BRANCH,
  FINAL_LANE_COMMAND_SPECS,
  FINAL_LANE_DIRECTOR_ANCHOR,
  FINAL_LANE_PROTECTED_INPUTS,
  FINAL_LANE_SCOPE_GATE_ARTIFACTS,
} from '../../../dist/liveEdge/adapters/finalLaneEvidence/index.js';
import {
  projectExternalProofEvidence,
} from '../../../dist/liveEdge/adapters/externalProofEvidence/index.js';
import {
  completeInput as completeL16Input,
  withCanonicalFilter,
} from '../externalProofEvidence/fixtures.mjs';

export const L17_IMPLEMENTATION_REVISION = '2'.repeat(40);
export const DEFAULT_FOCUSED_ASSERTIONS = 23;
export const DEFAULT_SCOPE_GATE_ASSERTIONS = 35;

export function acceptedL16Chain({ filterBlocked = false } = {}) {
  const input = filterBlocked
    ? withCanonicalFilter(completeL16Input())
    : completeL16Input();
  input.implementationRevision = FINAL_LANE_ACCEPTED_IDENTITIES.l16ImplementationCommit;
  for (const index of [0, 1, 2]) {
    input.evidence[index].sourceRevision = FINAL_LANE_ACCEPTED_IDENTITIES.l16ImplementationCommit;
  }
  const localChecks = input.evidence[0].checks;
  localChecks.find(({ check }) => check === 'L16_FOCUSED').assertions = 21;
  localChecks.find(({ check }) => check === 'IMPORT_PURITY').assertions = 4;
  localChecks.find(({ check }) => check === 'ACCUMULATED_LIVE_EDGE').assertions = 1_595;
  localChecks.find(({ check }) => check === 'PROTOCOL').assertions = 22;
  localChecks.find(({ check }) => check === 'NPM_TEST').assertions = 377;
  localChecks.find(({ check }) => check === 'TEST_ALL').assertions = 2_479;
  return {
    l12Snapshot: input.l12Snapshot,
    l13Snapshot: input.l13Snapshot,
    l16Snapshot: projectExternalProofEvidence(input),
  };
}

export function buildCommandEvidence({
  implementationRevision,
  verifiedAtMs,
  focusedAssertions = DEFAULT_FOCUSED_ASSERTIONS,
  scopeGateAssertions = DEFAULT_SCOPE_GATE_ASSERTIONS,
  assertionOverrides = {},
  verificationTimes = {},
}) {
  const defaults = {
    SCOPE_GATE_TESTS: scopeGateAssertions,
    L17_FOCUSED: focusedAssertions,
    IMPORT_PURITY: 4,
    ACCUMULATED_LIVE_EDGE: 1_595 + focusedAssertions,
    PROTOCOL: 22,
    FOUNDATION_RISK: 884,
    FOUNDATION_CONTROL: 97,
    FOUNDATION_EXECUTION: 178,
    FOUNDATION_RECONCILIATION: 75,
    FOUNDATION_OBSERVABILITY: 130,
    FOUNDATION_READ_MODEL: 72,
    INTEGRATION_BUILT: 180,
    NPM_TEST: 377,
    TEST_ALL: 2_479,
  };
  return FINAL_LANE_COMMAND_SPECS.map(({ check, command, assertionRule }, index) => ({
    check,
    command,
    sourceRevision: implementationRevision,
    verifiedAtMs: verificationTimes[check]
      ?? verifiedAtMs - (FINAL_LANE_COMMAND_SPECS.length - 1 - index),
    exitCode: 0,
    assertions: assertionOverrides[check]
      ?? defaults[check]
      ?? (assertionRule === null ? null : undefined),
  }));
}

export function buildScopeGateEvidence({
  checkedAtMs,
  checkedRevision = L17_IMPLEMENTATION_REVISION,
  selectedBaseline = FINAL_LANE_DIRECTOR_ANCHOR,
  workerCommitCount = 12,
  committedPathObservations = 74,
} = {}) {
  return {
    schema: 'L_WORKER_SCOPE_GATE_V1',
    command: 'ops/tests/lane-worker-scope-gate.sh --final',
    mode: 'FINAL',
    branch: FINAL_LANE_BRANCH,
    knownAnchor: FINAL_LANE_DIRECTOR_ANCHOR,
    selectedBaseline,
    checkedRevision,
    gateScriptSha256: FINAL_LANE_SCOPE_GATE_ARTIFACTS.gateScriptSha256,
    gateTestSha256: FINAL_LANE_SCOPE_GATE_ARTIFACTS.gateTestSha256,
    anchorIsAncestor: true,
    baselineOnFirstParent: true,
    baselineHasTwoParents: true,
    baselineSubjectHasExactDirectorPrefix: true,
    classifierCryptographicallyAuthenticatesAuthorship: false,
    workerCommitCount,
    committedPathObservations,
    trackedDirtyPathCount: 0,
    nonProtectedUntrackedPathCount: 0,
    violations: [],
    protectedInputs: FINAL_LANE_PROTECTED_INPUTS.map(({ path, sha256 }) => ({
      path,
      sha256,
      regularFile: true,
      symlink: false,
      untracked: true,
      unstaged: true,
    })),
    checkedAtMs,
    exitCode: 0,
  };
}

export function buildOperationalEvidence(checkedAtMs) {
  return [
    {
      subject: 'ROLLBACK_PROOF', kind: 'OPERATION_NOT_PERFORMED', proofState: 'ABSENT',
      performed: false, checkedAtMs, reasonCodes: ['ROLLBACK_NOT_PERFORMED'],
    },
    {
      subject: 'BACKUP_RESTORE_PROOF', kind: 'OPERATION_NOT_PERFORMED', proofState: 'ABSENT',
      performed: false, checkedAtMs, reasonCodes: ['BACKUP_RESTORE_NOT_PERFORMED'],
    },
    {
      subject: 'CANARY_PREFLIGHT_PROOF', kind: 'OPERATION_NOT_PERFORMED', proofState: 'ABSENT',
      performed: false, checkedAtMs, reasonCodes: ['CANARY_PREFLIGHT_NOT_PERFORMED'],
    },
    {
      subject: 'REAL_CANARY_PROOF', kind: 'OPERATION_NOT_PERFORMED', proofState: 'ABSENT',
      performed: false, checkedAtMs, reasonCodes: ['REAL_CANARY_NOT_PERFORMED'],
    },
  ];
}

// Receipt tooling may pass the exact post-commit implementation revision,
// measured scope counts and command counts here without weakening the adapter.
export function buildFinalLaneInput({
  implementationRevision = L17_IMPLEMENTATION_REVISION,
  evaluatedAtMs,
  focusedAssertions = DEFAULT_FOCUSED_ASSERTIONS,
  scopeGateAssertions = DEFAULT_SCOPE_GATE_ASSERTIONS,
  assertionOverrides = {},
  verificationTimes = {},
  selectedBaseline = FINAL_LANE_DIRECTOR_ANCHOR,
  workerCommitCount = 12,
  committedPathObservations = 74,
  filterBlocked = false,
  acceptedChain,
} = {}) {
  const chain = acceptedChain ?? acceptedL16Chain({ filterBlocked });
  const at = evaluatedAtMs ?? chain.l16Snapshot.evaluatedAtMs + 10_000;
  return {
    evaluatedAtMs: at,
    implementationRevision,
    l12Snapshot: chain.l12Snapshot,
    l13Snapshot: chain.l13Snapshot,
    l16Snapshot: chain.l16Snapshot,
    identities: structuredClone(FINAL_LANE_ACCEPTED_IDENTITIES),
    scopeGate: buildScopeGateEvidence({
      checkedAtMs: at,
      checkedRevision: implementationRevision,
      selectedBaseline,
      workerCommitCount,
      committedPathObservations,
    }),
    commands: buildCommandEvidence({
      implementationRevision,
      verifiedAtMs: at,
      focusedAssertions,
      scopeGateAssertions,
      assertionOverrides,
      verificationTimes,
    }),
    operationalEvidence: buildOperationalEvidence(at),
  };
}

export const completeInput = buildFinalLaneInput;
