import {
  ACTION_EVIDENCE_USE_SCHEMA_VERSION,
  AUTHORITY_USE_PURPOSES,
  deepFreeze,
} from '../contracts/index.mjs';
import { buildActionEvidenceEnvelope, clonePlain } from './baseline.mjs';

export function buildAuthorityUseAttempts(recordId = 'PA-S2-RECORD-OI-001') {
  return deepFreeze(AUTHORITY_USE_PURPOSES.map((purpose) => ({
    attemptId: `PA-S2-REFUSAL-${purpose}`,
    request: {
      schemaVersion: ACTION_EVIDENCE_USE_SCHEMA_VERSION,
      purpose,
      consumerId: 'PA-S2-HOSTILE-AUTHORITY-CONSUMER',
      recordId,
      canonicalOwnerDecisionIds: [],
    },
    expectedErrorCode: 'ACTION_EVIDENCE_NOT_AUTHORITY',
  })));
}

const forgedEnvelope = (field, value) => {
  const envelope = clonePlain(buildActionEvidenceEnvelope('ORDER_INTENT'));
  envelope.revision = `PA-S2-FORGED-${field.toUpperCase()}`;
  envelope.record[field] = value;
  return deepFreeze(envelope);
};

export const buildForgedApprovalEnvelope = () => forgedEnvelope('approved', true);
export const buildForgedBlockingEnvelope = () => forgedEnvelope('blocked', true);
export const buildForgedRankingEnvelope = () => forgedEnvelope('rank', 1);
export const buildForgedAuthorizationEnvelope = () => forgedEnvelope('authorizationToken', 'forbidden');

export const buildForgedAuthorityEffectEnvelope = () => {
  const envelope = clonePlain(buildActionEvidenceEnvelope('ORDER_INTENT'));
  envelope.revision = 'PA-S2-FORGED-AUTHORITY-EFFECT';
  envelope.authorityEffect = 'EXECUTE';
  return deepFreeze(envelope);
};

export const AUTHORITY_REFUSAL_FIXTURES = buildAuthorityUseAttempts();
