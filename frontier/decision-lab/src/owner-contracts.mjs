import { deepFreeze, sha256 } from '../../dock/src/index.mjs';

export const MAIN_SHA = 'f0168cb37bd04d21bc90591ab2256770de3b75bc';
export const Q_SHA = '02b4eccc8d2ef53b830cafae06e5175715fa6ebb';
export const L_SHA = 'df6b472993ca9659ce09cf5f72004981c6835f0d';

export const OWNER_CONTRACTS = deepFreeze({
  MAIN_DECISION: {
    owner: 'MAIN_ENGINE', contractId: 'MainDecisionV0', contractVersion: 'accepted-main@f0168cb',
    ownerContractRef: `git:${MAIN_SHA}:server/src/engine/v0/types.ts#Decision,DecisionKind`, ownerCommitSha: MAIN_SHA,
    ownerContractContentHash: 'bdb99ede2e5aaf6a01b28c805681aa8ce4594553708e2e6f974f17aac8a1efd0',
  },
  MAIN_INFORMATION: {
    owner: 'MAIN_INTELLIGENCE', contractId: 'FrozenPreEventRecord', contractVersion: 'accepted-main@f0168cb',
    ownerContractRef: `git:${MAIN_SHA}:server/src/intelligenceFoundation/contracts/types.ts#FeatureValue,FrozenPreEventRecord,OutcomeMetrics,OutcomeLabel`, ownerCommitSha: MAIN_SHA,
    ownerContractContentHash: '7eb6b169cdf3a2d59e2ceccc000c8c9668d79a3b2aac6fbbe21c32e836f5d60d',
  },
  MAIN_FEATURE: {
    owner: 'MAIN_INTELLIGENCE', contractId: 'FeatureValue', contractVersion: 'accepted-main@f0168cb',
    ownerContractRef: `git:${MAIN_SHA}:server/src/intelligenceFoundation/contracts/types.ts#FeatureValue`, ownerCommitSha: MAIN_SHA,
    ownerContractContentHash: '7eb6b169cdf3a2d59e2ceccc000c8c9668d79a3b2aac6fbbe21c32e836f5d60d',
  },
  MAIN_OUTCOME: {
    owner: 'MAIN_INTELLIGENCE', contractId: 'OutcomeLabel', contractVersion: 'accepted-main@f0168cb',
    ownerContractRef: `git:${MAIN_SHA}:server/src/intelligenceFoundation/contracts/types.ts#OutcomeLabel,OutcomeMetrics`, ownerCommitSha: MAIN_SHA,
    ownerContractContentHash: '7eb6b169cdf3a2d59e2ceccc000c8c9668d79a3b2aac6fbbe21c32e836f5d60d',
  },
  CAPITAL_ECONOMICS: {
    owner: 'CAPITAL_ECONOMICS', contractId: 'EconomicReport', contractVersion: 'accepted-main@f0168cb',
    ownerContractRef: `git:${MAIN_SHA}:server/src/capitalFoundation/economics/types.ts#EconomicReport`, ownerCommitSha: MAIN_SHA,
    ownerContractContentHash: '0234aa421140ddab58436756b72d254599944dd85d49a745013aac026f4f265a',
  },
  Q_DISPOSITION: {
    owner: 'Q_RESEARCH', contractId: 'DispositionRecordV1', contractVersion: 'Q05DispositionRecordV1@1',
    ownerContractRef: `git:${Q_SHA}:quant/src/quant_edge/labels/disposition.py#DispositionRecordV1`, ownerCommitSha: Q_SHA,
    ownerContractContentHash: '3998cfe32649f527a6bdba064d029cb292a26208781269b1ff4bfdff705275f1',
  },
  Q_ABSTENTION: {
    owner: 'Q_RESEARCH', contractId: 'BoundAssessmentDecisionV1', contractVersion: 'Q12BoundAssessmentDecisionV1@1',
    ownerContractRef: `git:${Q_SHA}:quant/src/quant_edge/ensemble/abstention.py#AdvisoryAction,BoundAssessmentDecisionV1`, ownerCommitSha: Q_SHA,
    ownerContractContentHash: '7d45cfd8b96df1d2b9affb80c19f0f7745315dd20aa0615727c3b6ff09257f5e',
  },
  Q_EXPERIMENT: {
    owner: 'Q_RESEARCH', contractId: 'Q15ExperimentCardV1', contractVersion: 'Q15ExperimentCardV1@1',
    ownerContractRef: `git:${Q_SHA}:quant/src/quant_edge/registry_ops/contracts.py#ExperimentCardV1`, ownerCommitSha: Q_SHA,
    ownerContractContentHash: 'c0fa30ec2fed7d72ff75d3a05d9699bb7ce37a3d755cfcfb2b0cca690ea538dc',
  },
  Q_OUTCOME: {
    owner: 'Q_RESEARCH', contractId: 'CostedOutcomeV1', contractVersion: 'Q05CostedOutcomeV1@1',
    ownerContractRef: `git:${Q_SHA}:quant/src/quant_edge/labels/outcomes.py#CostScenarioV1,CostedOutcomeV1`, ownerCommitSha: Q_SHA,
    ownerContractContentHash: 'bc4ed86fd972d3f2bdd637b28187b7ae99d715f3b719d9e62aeaec9b233f2150',
  },
  Q_COST_SCENARIO: {
    owner: 'Q_RESEARCH', contractId: 'CostScenarioV1', contractVersion: 'Q05CostScenarioV1@1',
    ownerContractRef: `git:${Q_SHA}:quant/src/quant_edge/labels/outcomes.py#CostScenarioV1`, ownerCommitSha: Q_SHA,
    ownerContractContentHash: 'bc4ed86fd972d3f2bdd637b28187b7ae99d715f3b719d9e62aeaec9b233f2150',
  },
  Q_EXCURSION: {
    owner: 'Q_RESEARCH', contractId: 'ExcursionOutcomeV1', contractVersion: 'Q05ExcursionOutcomeV1@1',
    ownerContractRef: `git:${Q_SHA}:quant/src/quant_edge/labels/outcomes.py#ExcursionOutcomeV1`, ownerCommitSha: Q_SHA,
    ownerContractContentHash: 'bc4ed86fd972d3f2bdd637b28187b7ae99d715f3b719d9e62aeaec9b233f2150',
  },
  Q_FEATURE: {
    owner: 'Q_RESEARCH', contractId: 'FeatureValueV1', contractVersion: 'Q06FeatureValueV1@1',
    ownerContractRef: `git:${Q_SHA}:quant/src/quant_edge/features/values.py#FeatureValueV1`, ownerCommitSha: Q_SHA,
    ownerContractContentHash: '44fc57eeda5d4fc0ecf45b79bb45c01a4570831d72b89f4ac8cd6a5a4c17ebfb',
  },
  Q_COMPARISON: {
    owner: 'Q_RESEARCH', contractId: 'ComparisonReportV1', contractVersion: 'Q14ComparisonReportV1@1',
    ownerContractRef: `git:${Q_SHA}:quant/src/quant_edge/validation/comparison.py#ComparisonReportV1`, ownerCommitSha: Q_SHA,
    ownerContractContentHash: 'ab385e3ff957e17c184062d0e9b857941fdc81911f5606caa323889429e7b01f',
  },
  Q_MARKET_EVIDENCE: {
    owner: 'Q_RESEARCH', contractId: 'ReferenceMarketEvidenceRowV1', contractVersion: 'Q02ReferenceMarketEvidenceRowV1@1',
    ownerContractRef: `git:${Q_SHA}:quant/src/quant_edge/lake/contracts.py#ReferenceMarketEvidenceRowV1`, ownerCommitSha: Q_SHA,
    ownerContractContentHash: 'b190ec64068e8a1d7b79c49c75c74304b770688d86eba03c6454108a93c3d32a',
  },
  L_MARKET_PATH: {
    owner: 'L_EXCHANGE_TWIN', contractId: 'TwinScenarioInput', contractVersion: 'L07TwinScenarioInput@1',
    ownerContractRef: `git:${L_SHA}:server/src/liveEdge/adapters/exchangeTwin/types.ts#TwinScenarioInput`, ownerCommitSha: L_SHA,
    ownerContractContentHash: 'c3bf70a72a5d87d6899e0cc21a7dcd106842e6de57002c8fcbd08decdea097f9',
  },
  L_EXECUTION_POLICY: {
    owner: 'L_EXECUTION_POLICY', contractId: 'ExecutionPolicyCandidate', contractVersion: 'L08ExecutionPolicyCandidate@1',
    ownerContractRef: `git:${L_SHA}:server/src/liveEdge/adapters/executionPolicy/types.ts#ExecutionPolicyCandidate,ExecutionPolicyDecision`, ownerCommitSha: L_SHA,
    ownerContractContentHash: 'da466c08356b6707f69f3df85501661d3d985082feddb4127b7e7974cdf54402',
  },
  L_RECOVERY: {
    owner: 'L_RECOVERY', contractId: 'L12RecoveryEvidence', contractVersion: 'L12RecoveryEvidence@1',
    ownerContractRef: `git:${L_SHA}:server/src/liveEdge/adapters/exposureRecoveryProjection/types.ts#L12RecoveryEvidence`, ownerCommitSha: L_SHA,
    ownerContractContentHash: 'bbf281353b6010ed6fd5b67a7ddbb8f4301d816cb578fba11d1eba0ac6a7e649',
  },
});

export function acceptedOwnerContract(contract) {
  return Object.values(OWNER_CONTRACTS).some((accepted) => (
    accepted.owner === contract.owner
    && accepted.contractId === contract.contractId
    && accepted.contractVersion === contract.contractVersion
    && accepted.ownerContractRef === contract.ownerContractRef
    && accepted.ownerCommitSha === contract.ownerCommitSha
    && accepted.ownerContractContentHash === contract.ownerContractContentHash
  ));
}

export function ownerFixtureRef(
  contractKey,
  fixtureRecordId,
  fixtureTruthClass,
  fixtureRevision = 'v1',
  fixtureContentHash = null,
) {
  const contract = OWNER_CONTRACTS[contractKey];
  if (!contract) throw new TypeError(`unknown DecisionLab owner contract ${String(contractKey)}`);
  const core = {
    ...contract,
    fixtureRecordId,
    fixtureRevision,
    fixtureRecordRef: contractKey === 'Q_EXPERIMENT' && fixtureRecordId === 'q15-card:decision-lab-fixture'
      ? 'frontier/decision-lab/fixtures/factory.mjs#Q15_EXPERIMENT_FIXTURE'
      : 'frontier/decision-lab/fixtures/factory.mjs#makeDecisionLabFixture',
    fixtureTruthClass,
    fixtureContentHash,
  };
  return deepFreeze({ ...core, fixtureIdentityHash: sha256(core) });
}
