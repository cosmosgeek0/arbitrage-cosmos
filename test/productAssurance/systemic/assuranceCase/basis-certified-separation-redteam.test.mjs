import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ACCEPTED_S1_ASSUMPTION_PROJECTION_FIXTURE,
  COMPLETE_ASSURANCE_CASE_FIXTURE,
  FIXTURE_NOW_MS,
  buildAssuranceCaseViewModel,
  clonePlainData,
  evaluateAssuranceCase,
  validateAssuranceCasePacket,
} from '../../../../fixtures/productAssurance/systemic/assuranceCase/index.mjs';

const CERTIFIED_EVIDENCE_ID = 'PA-S4-EVIDENCE-001';
const BASIS_EVIDENCE_ID = 'PA-S4-INDEPENDENCE-BASIS-001';

const packetPair = () => {
  const packet = clonePlainData(COMPLETE_ASSURANCE_CASE_FIXTURE);
  return {
    packet,
    certified: packet.evidence.find((entry) => entry.evidenceId === CERTIFIED_EVIDENCE_ID),
    basis: packet.evidence.find((entry) => entry.evidenceId === BASIS_EVIDENCE_ID),
  };
};

const evaluationPair = () => {
  const evaluation = clonePlainData(evaluateAssuranceCase(
    COMPLETE_ASSURANCE_CASE_FIXTURE,
    ACCEPTED_S1_ASSUMPTION_PROJECTION_FIXTURE,
    FIXTURE_NOW_MS,
  ));
  return {
    evaluation,
    certified: evaluation.evidenceResults.find((entry) => entry.evidenceId === CERTIFIED_EVIDENCE_ID),
    basis: evaluation.evidenceResults.find((entry) => entry.evidenceId === BASIS_EVIDENCE_ID),
  };
};

const assertViewRejects = (evaluation) => {
  const view = buildAssuranceCaseViewModel(evaluation);
  assert.equal(view.status, 'UNKNOWN');
  assert.deepEqual(view.summary.reasonCodes, ['EVALUATION_INVALID']);
};

const aliasCases = [
  {
    name: 'source ID',
    issueCode: 'INDEPENDENCE_BASIS_CERTIFIED_SOURCE_ID_ALIAS',
    mutatePacket: ({ basis, certified }) => {
      basis.sourceIdentity.sourceId = certified.sourceIdentity.sourceId;
    },
    mutateEvaluation: ({ basis, certified }) => {
      basis.sourceIdentity.sourceId = certified.sourceIdentity.sourceId;
    },
  },
  {
    name: 'source digest',
    issueCode: 'INDEPENDENCE_BASIS_CERTIFIED_SOURCE_DIGEST_ALIAS',
    mutatePacket: ({ basis, certified }) => {
      basis.sourceIdentity.digest = certified.sourceIdentity.digest;
    },
    mutateEvaluation: ({ basis, certified }) => {
      basis.sourceIdentity.digest = certified.sourceIdentity.digest;
    },
  },
  {
    name: 'producer actor',
    issueCode: 'INDEPENDENCE_BASIS_CERTIFIED_ACTOR_ALIAS',
    mutatePacket: ({ basis, certified }) => {
      basis.producer.actorId = certified.producer.actorId;
    },
    mutateEvaluation: ({ basis, certified }) => {
      basis.producerId = certified.producerId;
    },
  },
  {
    name: 'verifier actor',
    issueCode: 'INDEPENDENCE_BASIS_CERTIFIED_ACTOR_ALIAS',
    mutatePacket: ({ basis, certified }) => {
      basis.verifier.actorId = certified.verifier.actorId;
    },
    mutateEvaluation: ({ basis, certified }) => {
      basis.verifierId = certified.verifierId;
    },
  },
  {
    name: 'producer actor cross-role alias',
    issueCode: 'INDEPENDENCE_BASIS_CERTIFIED_ACTOR_ALIAS',
    mutatePacket: ({ basis, certified }) => {
      basis.producer.actorId = certified.verifier.actorId;
    },
    mutateEvaluation: ({ basis, certified }) => {
      basis.producerId = certified.verifierId;
    },
  },
  {
    name: 'verifier actor cross-role alias',
    issueCode: 'INDEPENDENCE_BASIS_CERTIFIED_ACTOR_ALIAS',
    mutatePacket: ({ basis, certified }) => {
      basis.verifier.actorId = certified.producer.actorId;
    },
    mutateEvaluation: ({ basis, certified }) => {
      basis.verifierId = certified.producerId;
    },
  },
  {
    name: 'verifier owner',
    issueCode: 'INDEPENDENCE_BASIS_CERTIFIED_VERIFIER_OWNER_ALIAS',
    mutatePacket: ({ basis, certified }) => {
      basis.verifier.ownerId = certified.verifier.ownerId;
    },
    mutateEvaluation: ({ basis, certified }) => {
      basis.verifierOwnerId = certified.verifierOwnerId;
    },
  },
  {
    name: 'validator identity',
    issueCode: 'INDEPENDENCE_BASIS_CERTIFIED_VALIDATOR_ALIAS',
    mutatePacket: ({ basis, certified }) => {
      basis.validator = clonePlainData(certified.validator);
    },
    mutateEvaluation: ({ basis, certified }) => {
      basis.validator = clonePlainData(certified.validator);
    },
  },
  {
    name: 'producer failure-domain identity',
    issueCode: 'INDEPENDENCE_BASIS_CERTIFIED_COMMON_MODE_FAILURE_DOMAIN',
    mutatePacket: ({ basis, certified }) => {
      basis.producer.failureDomains[0] = clonePlainData(certified.producer.failureDomains[0]);
    },
    mutateEvaluation: ({ basis, certified }) => {
      basis.producerFailureDomains[0] = clonePlainData(certified.producerFailureDomains[0]);
    },
  },
  {
    name: 'verifier failure-domain identity',
    issueCode: 'INDEPENDENCE_BASIS_CERTIFIED_COMMON_MODE_FAILURE_DOMAIN',
    mutatePacket: ({ basis, certified }) => {
      basis.verifier.failureDomains[0] = clonePlainData(certified.verifier.failureDomains[0]);
    },
    mutateEvaluation: ({ basis, certified }) => {
      basis.verifierFailureDomains[0] = clonePlainData(certified.verifierFailureDomains[0]);
    },
  },
  {
    name: 'producer failure-domain cross-leg alias',
    issueCode: 'INDEPENDENCE_BASIS_CERTIFIED_COMMON_MODE_FAILURE_DOMAIN',
    mutatePacket: ({ basis, certified }) => {
      basis.producer.failureDomains[0] = clonePlainData(certified.verifier.failureDomains[0]);
    },
    mutateEvaluation: ({ basis, certified }) => {
      basis.producerFailureDomains[0] = clonePlainData(certified.verifierFailureDomains[0]);
    },
  },
  {
    name: 'verifier failure-domain cross-leg alias',
    issueCode: 'INDEPENDENCE_BASIS_CERTIFIED_COMMON_MODE_FAILURE_DOMAIN',
    mutatePacket: ({ basis, certified }) => {
      basis.verifier.failureDomains[0] = clonePlainData(certified.producer.failureDomains[0]);
    },
    mutateEvaluation: ({ basis, certified }) => {
      basis.verifierFailureDomains[0] = clonePlainData(certified.producerFailureDomains[0]);
    },
  },
];

for (const { name, issueCode, mutatePacket } of aliasCases) {
  test(`packet rejects independence basis reuse of certified evidence ${name}`, () => {
    const pair = packetPair();
    mutatePacket(pair);
    const issueCodes = validateAssuranceCasePacket(pair.packet).map((entry) => entry.code);
    assert(issueCodes.includes(issueCode), JSON.stringify(issueCodes));
  });
}

for (const { name, mutateEvaluation } of aliasCases) {
  test(`view rejects independence basis reuse of certified evidence ${name}`, () => {
    const pair = evaluationPair();
    mutateEvaluation(pair);
    assertViewRejects(pair.evaluation);
  });
}
