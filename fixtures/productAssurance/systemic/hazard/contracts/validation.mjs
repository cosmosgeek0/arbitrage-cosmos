import {
  ASSUMPTION_REASON_CODES,
  HAZARD_ASSURANCE_SCHEMA,
  HAZARD_VIEW_MODEL_SCHEMA,
  OPERATION_CLASSES,
  REQUIRED_FAILURE_FAMILY_IDS,
  REQUIRED_UNACCEPTABLE_LOSS_IDS,
} from './schema.mjs';

const FORBIDDEN_KEY = /(?:^|_)(?:api_?key|api_?secret|password|passphrase|private_?key|credential|signature|listen_?key|withdrawal_?token)(?:$|_)/i;

const issue = (path, code, message) => Object.freeze({ path, code, message });
const issueSort = (left, right) => (
  left.path.localeCompare(right.path)
  || left.code.localeCompare(right.code)
  || left.message.localeCompare(right.message)
);

const typeOf = (value) => {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (Number.isSafeInteger(value)) return 'integer';
  return typeof value;
};

export function canonicalStringify(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalStringify(value[key])}`).join(',')}}`;
  }
  if (typeof value === 'number' && !Number.isFinite(value)) throw new TypeError('non-finite number');
  return JSON.stringify(value);
}

export function computeAtlasDenominatorFingerprint(liveOperationClasses, coverageDecisions) {
  const normalized = {
    liveOperationClasses: [...(Array.isArray(liveOperationClasses) ? liveOperationClasses : [])].sort(),
    coverageDecisions: (Array.isArray(coverageDecisions) ? coverageDecisions : [])
      .map((decision) => ({
        decisionId: decision?.decisionId ?? null,
        operationClass: decision?.operationClass ?? null,
        failureFamilyId: decision?.failureFamilyId ?? null,
        disposition: decision?.disposition ?? null,
        rationale: decision?.rationale ?? null,
      }))
      .sort((left, right) => canonicalStringify(left).localeCompare(canonicalStringify(right))),
  };
  const serialized = canonicalStringify(normalized);
  let hash = 0x811c9dc5;
  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= serialized.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `PA-S1-DENOM-FNV1A-${hash.toString(16).padStart(8, '0').toUpperCase()}`;
}

function assertPlainJson(value, seen = new WeakSet()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('numbers must be finite');
    return;
  }
  if (typeof value !== 'object') throw new TypeError('plain JSON data required');
  if (seen.has(value)) throw new TypeError('cyclic data forbidden');
  seen.add(value);
  if (Array.isArray(value)) {
    for (const entry of value) assertPlainJson(entry, seen);
  } else {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw new TypeError('plain object required');
    const descriptors = Object.getOwnPropertyDescriptors(value);
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) throw new TypeError(`accessor/non-enumerable field forbidden: ${key}`);
      assertPlainJson(descriptor.value, seen);
    }
    if (Reflect.ownKeys(value).some((key) => typeof key !== 'string')) throw new TypeError('symbol keys forbidden');
  }
  seen.delete(value);
}

function resolveRef(rootSchema, ref) {
  if (typeof ref !== 'string' || !ref.startsWith('#/')) throw new TypeError(`unsupported schema ref ${String(ref)}`);
  let current = rootSchema;
  for (const part of ref.slice(2).split('/')) {
    current = current?.[part.replace(/~1/g, '/').replace(/~0/g, '~')];
  }
  if (!current) throw new TypeError(`unresolved schema ref ${ref}`);
  return current;
}

function validateNode(rootSchema, schema, value, path, issues) {
  if (schema.$ref) {
    validateNode(rootSchema, resolveRef(rootSchema, schema.$ref), value, path, issues);
    return;
  }
  if (schema.anyOf) {
    const branches = schema.anyOf.map((branch) => {
      const branchIssues = [];
      validateNode(rootSchema, branch, value, path, branchIssues);
      return branchIssues;
    });
    if (!branches.some((branch) => branch.length === 0)) {
      issues.push(issue(path, 'SCHEMA_ANY_OF', 'value matches no allowed schema branch'));
    }
    return;
  }
  if (Object.hasOwn(schema, 'const') && value !== schema.const) {
    issues.push(issue(path, 'SCHEMA_CONST', `expected ${JSON.stringify(schema.const)}`));
  }
  if (schema.enum && !schema.enum.includes(value)) {
    issues.push(issue(path, 'SCHEMA_ENUM', `unexpected value ${JSON.stringify(value)}`));
  }
  if (schema.type) {
    const actualType = typeOf(value);
    const allowedTypes = Array.isArray(schema.type) ? schema.type : [schema.type];
    const matches = allowedTypes.includes(actualType)
      || (allowedTypes.includes('number') && actualType === 'integer');
    if (!matches) {
      issues.push(issue(path, 'SCHEMA_TYPE', `expected ${allowedTypes.join('|')}, got ${actualType}`));
      return;
    }
  }
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) issues.push(issue(path, 'SCHEMA_MIN_LENGTH', 'string is too short'));
    if (schema.maxLength !== undefined && value.length > schema.maxLength) issues.push(issue(path, 'SCHEMA_MAX_LENGTH', 'string is too long'));
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) issues.push(issue(path, 'SCHEMA_PATTERN', 'string format is invalid'));
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) issues.push(issue(path, 'SCHEMA_MINIMUM', `value is below ${schema.minimum}`));
    if (schema.maximum !== undefined && value > schema.maximum) issues.push(issue(path, 'SCHEMA_MAXIMUM', `value is above ${schema.maximum}`));
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) issues.push(issue(path, 'SCHEMA_MIN_ITEMS', `array needs at least ${schema.minItems} entries`));
    if (schema.maxItems !== undefined && value.length > schema.maxItems) issues.push(issue(path, 'SCHEMA_MAX_ITEMS', `array exceeds ${schema.maxItems} entries`));
    if (schema.uniqueItems) {
      const keys = value.map(canonicalStringify);
      if (new Set(keys).size !== keys.length) issues.push(issue(path, 'SCHEMA_UNIQUE_ITEMS', 'array entries must be unique'));
    }
    if (schema.items) value.forEach((entry, index) => validateNode(rootSchema, schema.items, entry, `${path}[${index}]`, issues));
  } else if (value && typeof value === 'object') {
    for (const required of schema.required ?? []) {
      if (!Object.hasOwn(value, required)) issues.push(issue(path ? `${path}.${required}` : required, 'SCHEMA_REQUIRED', 'required field is missing'));
    }
    for (const [key, child] of Object.entries(value)) {
      const childPath = path ? `${path}.${key}` : key;
      if (schema.properties && Object.hasOwn(schema.properties, key)) {
        validateNode(rootSchema, schema.properties[key], child, childPath, issues);
      } else if (schema.additionalProperties === false) {
        issues.push(issue(childPath, 'SCHEMA_UNKNOWN_FIELD', 'field is not allowed'));
      } else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
        validateNode(rootSchema, schema.additionalProperties, child, childPath, issues);
      }
    }
  }
}

export function validateAgainstSchema(schema, value) {
  const issues = [];
  try {
    assertPlainJson(value);
  } catch (error) {
    return Object.freeze([issue('$', 'PLAIN_JSON_REQUIRED', error instanceof Error ? error.message : 'plain JSON data required')]);
  }
  validateNode(schema, schema, value, '$', issues);
  return Object.freeze(issues.sort(issueSort));
}

export function findSecretLikePaths(value, path = '$') {
  const hits = [];
  if (Array.isArray(value)) {
    value.forEach((entry, index) => hits.push(...findSecretLikePaths(entry, `${path}[${index}]`)));
  } else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      const childPath = `${path}.${key}`;
      if (FORBIDDEN_KEY.test(key)) hits.push(childPath);
      hits.push(...findSecretLikePaths(child, childPath));
    }
  }
  return Object.freeze(hits.sort());
}

function indexUnique(records, idField, path, issues) {
  const index = new Map();
  if (!Array.isArray(records)) return index;
  records.forEach((record, position) => {
    const id = record?.[idField];
    if (typeof id !== 'string') return;
    if (index.has(id)) issues.push(issue(`${path}[${position}].${idField}`, 'DUPLICATE_ID', `${id} is duplicated`));
    else index.set(id, record);
  });
  return index;
}

function requireIds(requiredIds, index, path, code, issues) {
  for (const requiredId of requiredIds) {
    if (!index.has(requiredId)) issues.push(issue(path, code, `required ID ${requiredId} is missing`));
  }
}

function validateSemanticPacket(packet, issues) {
  const lossIndex = indexUnique(packet.unacceptableLossFamilies, 'lossId', '$.unacceptableLossFamilies', issues);
  const hazardIndex = indexUnique(packet.hazards, 'hazardId', '$.hazards', issues);
  const assumptionIndex = indexUnique(packet.assumptions, 'assumptionId', '$.assumptions', issues);
  const consumerIndex = indexUnique(packet.assumptionConsumers, 'consumerId', '$.assumptionConsumers', issues);
  const fixtureIndex = indexUnique(packet.fixtureRegistry, 'fixtureId', '$.fixtureRegistry', issues);
  const failureFamilyIndex = indexUnique(packet.failureFamilies, 'failureFamilyId', '$.failureFamilies', issues);
  indexUnique(packet.atlasManifest?.coverageDecisions, 'decisionId', '$.atlasManifest.coverageDecisions', issues);
  const atlasRowIndex = indexUnique(packet.atlasRows, 'atlasRowId', '$.atlasRows', issues);
  const hazardCockpitIndex = new Map();
  packet.hazards.forEach((hazard, position) => {
    const projectionId = hazard.cockpitProjection.projectionId;
    if (hazardCockpitIndex.has(projectionId)) {
      issues.push(issue(`$.hazards[${position}].cockpitProjection.projectionId`, 'DUPLICATE_ID', `${projectionId} is duplicated`));
    } else {
      hazardCockpitIndex.set(projectionId, hazard);
    }
  });

  requireIds(REQUIRED_UNACCEPTABLE_LOSS_IDS, lossIndex, '$.unacceptableLossFamilies', 'REQUIRED_LOSS_FAMILY_MISSING', issues);
  requireIds(REQUIRED_FAILURE_FAMILY_IDS, failureFamilyIndex, '$.failureFamilies', 'REQUIRED_FAILURE_FAMILY_MISSING', issues);

  packet.hazards?.forEach((hazard, hazardPosition) => {
    if (hazard.active && hazard.capitalCritical && hazard.assumptionIds.length === 0) {
      issues.push(issue(`$.hazards[${hazardPosition}].assumptionIds`, 'CAPITAL_CRITICAL_CONSUMER_WITHOUT_ASSUMPTION', hazard.hazardId));
    }
    hazard.unacceptableLossIds?.forEach((lossId, position) => {
      const loss = lossIndex.get(lossId);
      if (!loss) {
        issues.push(issue(`$.hazards[${hazardPosition}].unacceptableLossIds[${position}]`, 'LOSS_REFERENCE_UNKNOWN', lossId));
      } else if (!hazard.affectedBoundaries.some((boundary) => loss.affectedBoundaries.includes(boundary))) {
        issues.push(issue(`$.hazards[${hazardPosition}].unacceptableLossIds[${position}]`, 'LOSS_BOUNDARY_INCOHERENT', `${hazard.hazardId}|${lossId}`));
      }
    });
    hazard.assumptionIds?.forEach((assumptionId, position) => {
      const assumption = assumptionIndex.get(assumptionId);
      if (!assumption) {
        issues.push(issue(`$.hazards[${hazardPosition}].assumptionIds[${position}]`, 'ASSUMPTION_REFERENCE_UNKNOWN', assumptionId));
      } else if (!assumption.dependents.hazardIds.includes(hazard.hazardId)) {
        issues.push(issue(`$.hazards[${hazardPosition}].assumptionIds[${position}]`, 'DEPENDENT_REVERSE_REFERENCE_MISSING', `${assumptionId}|${hazard.hazardId}`));
      } else if (!assumption.dependents.cockpitProjectionIds.includes(hazard.cockpitProjection.projectionId)) {
        issues.push(issue(`$.hazards[${hazardPosition}].assumptionIds[${position}]`, 'DEPENDENT_COCKPIT_REFERENCE_MISSING', `${assumptionId}|${hazard.cockpitProjection.projectionId}`));
      }
    });
    const ownerIds = hazard.canonicalOwners?.map((owner) => owner.ownerId) ?? [];
    if (new Set(ownerIds).size !== ownerIds.length) issues.push(issue(`$.hazards[${hazardPosition}].canonicalOwners`, 'DUPLICATE_OWNER', 'canonical owners must be unique'));
    if (hazard.proof?.kind === 'DETERMINISTIC_FIXTURE') {
      if (hazard.proof.referenceId === null || hazard.proof.gapCode !== null) issues.push(issue(`$.hazards[${hazardPosition}].proof`, 'FIXTURE_PROOF_INCOHERENT', 'fixture proof requires a reference and no gap code'));
      if (hazard.proof.assertionLevel !== 'SCHEMA_AND_PROJECTION_ONLY') issues.push(issue(`$.hazards[${hazardPosition}].proof.assertionLevel`, 'FIXTURE_PROOF_OVERCLAIM', 'packet fixture cannot claim composed behavior'));
      const registration = fixtureIndex.get(hazard.proof.referenceId);
      if (!registration) {
        issues.push(issue(`$.hazards[${hazardPosition}].proof.referenceId`, 'FIXTURE_REFERENCE_UNKNOWN', String(hazard.proof.referenceId)));
      } else if (registration.fixtureKind !== 'HAZARD_PROJECTION' || registration.targetId !== hazard.hazardId) {
        issues.push(issue(`$.hazards[${hazardPosition}].proof.referenceId`, 'FIXTURE_REFERENCE_MISMATCH', `${registration.fixtureKind}|${registration.targetId}`));
      }
    }
    if (hazard.proof?.kind === 'PROOF_GAP' && (hazard.proof.gapCode === null || hazard.proof.referenceId !== null)) {
      issues.push(issue(`$.hazards[${hazardPosition}].proof`, 'PROOF_GAP_INCOHERENT', 'proof gap requires a gap code and no fixture reference'));
    }
  });

  packet.assumptions?.forEach((assumption, assumptionPosition) => {
    if (assumption.firstValidAtMs > assumption.lastVerifiedAtMs || assumption.lastVerifiedAtMs > assumption.expiresAtMs) {
      issues.push(issue(`$.assumptions[${assumptionPosition}]`, 'ASSUMPTION_TIMELINE_INVALID', 'first-valid, last-verified, and expiry times are incoherent'));
    }
    if (assumption.result === 'PASS' && assumption.reasonCode !== 'VALIDATED') {
      issues.push(issue(`$.assumptions[${assumptionPosition}].reasonCode`, 'ASSUMPTION_RESULT_REASON_INCOHERENT', 'PASS requires VALIDATED'));
    }
    if (assumption.result !== 'PASS' && assumption.reasonCode === 'VALIDATED') {
      issues.push(issue(`$.assumptions[${assumptionPosition}].reasonCode`, 'ASSUMPTION_RESULT_REASON_INCOHERENT', `${assumption.result} cannot use VALIDATED`));
    }
    if (!ASSUMPTION_REASON_CODES.includes(assumption.reasonCode)) {
      issues.push(issue(`$.assumptions[${assumptionPosition}].reasonCode`, 'ASSUMPTION_REASON_UNKNOWN', assumption.reasonCode));
    }
    assumption.dependents?.hazardIds?.forEach((hazardId, position) => {
      const hazard = hazardIndex.get(hazardId);
      if (!hazard) {
        issues.push(issue(`$.assumptions[${assumptionPosition}].dependents.hazardIds[${position}]`, 'HAZARD_REFERENCE_UNKNOWN', hazardId));
      } else if (!hazard.assumptionIds.includes(assumption.assumptionId)) {
        issues.push(issue(`$.assumptions[${assumptionPosition}].dependents.hazardIds[${position}]`, 'DEPENDENT_FORWARD_REFERENCE_MISSING', `${assumption.assumptionId}|${hazardId}`));
      }
    });
    assumption.dependents?.cockpitProjectionIds?.forEach((projectionId, position) => {
      if (!hazardCockpitIndex.has(projectionId)) {
        issues.push(issue(`$.assumptions[${assumptionPosition}].dependents.cockpitProjectionIds[${position}]`, 'COCKPIT_PROJECTION_REFERENCE_UNKNOWN', projectionId));
      }
    });

    const modeledDependents = [
      ...assumption.dependents.hazardIds.filter((hazardId) => hazardIndex.get(hazardId)?.active && hazardIndex.get(hazardId)?.capitalCritical),
      ...Object.entries(assumption.dependents)
        .filter(([field]) => field !== 'hazardIds' && field !== 'cockpitProjectionIds')
        .flatMap(([, ids]) => ids)
        .filter((dependentId) => consumerIndex.get(dependentId)?.active && consumerIndex.get(dependentId)?.capitalCritical),
    ];
    if (assumption.capitalCritical && modeledDependents.length === 0) {
      issues.push(issue(`$.assumptions[${assumptionPosition}].dependents`, 'CAPITAL_CRITICAL_ASSUMPTION_ORPHANED', assumption.assumptionId));
    }
  });

  const dependentFieldByConsumerKind = {
    INVARIANT: 'controlIds',
    ASSURANCE_CLAIM: 'claimIds',
    RECOVERY_PATH: 'actionIds',
    DEPLOYMENT_CLAIM: 'claimIds',
    MODEL_USE_CLAIM: 'modelIds',
    EXTERNAL_OPERATION_POLICY: 'actionIds',
  };

  packet.assumptionConsumers?.forEach((consumer, consumerPosition) => {
    const dependentField = dependentFieldByConsumerKind[consumer.kind];
    consumer.assumptionIds?.forEach((assumptionId, position) => {
      const assumption = assumptionIndex.get(assumptionId);
      if (!assumption) {
        issues.push(issue(`$.assumptionConsumers[${consumerPosition}].assumptionIds[${position}]`, 'ASSUMPTION_REFERENCE_UNKNOWN', assumptionId));
      } else if (!assumption.dependents[dependentField].includes(consumer.consumerId)) {
        issues.push(issue(`$.assumptionConsumers[${consumerPosition}].assumptionIds[${position}]`, 'DEPENDENT_REVERSE_REFERENCE_MISSING', `${assumptionId}|${consumer.consumerId}`));
      }
    });
  });

  packet.assumptions?.forEach((assumption, assumptionPosition) => {
    for (const [field, dependentIds] of Object.entries(assumption.dependents)) {
      if (field === 'hazardIds' || field === 'cockpitProjectionIds') continue;
      dependentIds.forEach((dependentId, position) => {
        if (!dependentId.startsWith('PA-S1-CONS-')) return;
        const consumer = consumerIndex.get(dependentId);
        if (!consumer) {
          issues.push(issue(`$.assumptions[${assumptionPosition}].dependents.${field}[${position}]`, 'CONSUMER_REFERENCE_UNKNOWN', dependentId));
          return;
        }
        if (dependentFieldByConsumerKind[consumer.kind] !== field) {
          issues.push(issue(`$.assumptions[${assumptionPosition}].dependents.${field}[${position}]`, 'DEPENDENT_KIND_MISMATCH', `${dependentId}|${consumer.kind}`));
        }
        if (!consumer.assumptionIds.includes(assumption.assumptionId)) {
          issues.push(issue(`$.assumptions[${assumptionPosition}].dependents.${field}[${position}]`, 'DEPENDENT_FORWARD_REFERENCE_MISSING', `${assumption.assumptionId}|${dependentId}`));
        }
      });
    }
  });

  const manifest = packet.atlasManifest;
  const computedDenominatorFingerprint = computeAtlasDenominatorFingerprint(
    manifest.liveOperationClasses,
    manifest.coverageDecisions,
  );
  if (manifest.denominatorFingerprint !== computedDenominatorFingerprint) {
    issues.push(issue('$.atlasManifest.denominatorFingerprint', 'DENOMINATOR_FINGERPRINT_MISMATCH', computedDenominatorFingerprint));
  }
  if (manifest.releaseId !== packet.release?.releaseId) issues.push(issue('$.atlasManifest.releaseId', 'RELEASE_ID_MISMATCH', 'manifest release must match packet release'));
  if (manifest.review?.state === 'OWNER_REVIEWED') {
    if (
      manifest.review.reviewerId === null
      || manifest.review.reviewedAtMs === null
      || manifest.review.evidenceId === null
      || manifest.review.reviewedManifestVersion === null
      || manifest.review.reviewedDenominatorFingerprint === null
      || manifest.review.reviewedOperationPolicyRevision === null
      || manifest.review.reviewedReleaseId === null
    ) {
      issues.push(issue('$.atlasManifest.review', 'OWNER_REVIEW_EVIDENCE_MISSING', 'owner-reviewed manifest needs reviewer, time, and evidence'));
    }
    if (manifest.review.evidenceState === 'UNTESTED') {
      issues.push(issue('$.atlasManifest.review.evidenceState', 'OWNER_REVIEW_EVIDENCE_UNTESTED', 'UNTESTED cannot prove owner review'));
    }
    if (
      manifest.review.reviewedManifestVersion !== manifest.version
      || manifest.review.reviewedDenominatorFingerprint !== manifest.denominatorFingerprint
      || manifest.review.reviewedOperationPolicyRevision !== packet.release?.operationPolicyRevision
      || manifest.review.reviewedReleaseId !== packet.release?.releaseId
    ) {
      issues.push(issue('$.atlasManifest.review', 'OWNER_REVIEW_BINDING_MISMATCH', 'review must bind the exact manifest, denominator, and operation-policy revisions'));
    }
  } else if (manifest.review?.state === 'OWNER_REVIEW_MISSING') {
    if (
      manifest.review.reviewerId !== null
      || manifest.review.reviewedAtMs !== null
      || manifest.review.evidenceId !== null
      || manifest.review.reviewedManifestVersion !== null
      || manifest.review.reviewedDenominatorFingerprint !== null
      || manifest.review.reviewedOperationPolicyRevision !== null
      || manifest.review.reviewedReleaseId !== null
    ) {
      issues.push(issue('$.atlasManifest.review', 'OWNER_REVIEW_STATE_INCOHERENT', 'missing review cannot carry approval evidence'));
    }
  }

  for (const operationClass of OPERATION_CLASSES) {
    if (!manifest.liveOperationClasses.includes(operationClass)) {
      issues.push(issue('$.atlasManifest.liveOperationClasses', 'REQUIRED_OPERATION_CLASS_MISSING', operationClass));
    }
  }

  const decisionPairs = new Set();
  manifest.coverageDecisions?.forEach((decision, position) => {
    const pair = `${decision.operationClass}|${decision.failureFamilyId}`;
    if (decisionPairs.has(pair)) issues.push(issue(`$.atlasManifest.coverageDecisions[${position}]`, 'COVERAGE_PAIR_DUPLICATE', pair));
    decisionPairs.add(pair);
    if (!manifest.liveOperationClasses.includes(decision.operationClass)) issues.push(issue(`$.atlasManifest.coverageDecisions[${position}].operationClass`, 'OPERATION_CLASS_NOT_LIVE', decision.operationClass));
    if (!failureFamilyIndex.has(decision.failureFamilyId)) issues.push(issue(`$.atlasManifest.coverageDecisions[${position}].failureFamilyId`, 'FAILURE_FAMILY_REFERENCE_UNKNOWN', decision.failureFamilyId));
    if (decision.disposition === 'NOT_APPLICABLE' && (typeof decision.rationale !== 'string' || decision.rationale.trim().length === 0)) {
      issues.push(issue(`$.atlasManifest.coverageDecisions[${position}].rationale`, 'NOT_APPLICABLE_RATIONALE_MISSING', pair));
    }
  });

  packet.atlasRows?.forEach((row, rowPosition) => {
    if (row.releaseId !== packet.release?.releaseId) issues.push(issue(`$.atlasRows[${rowPosition}].releaseId`, 'RELEASE_ID_MISMATCH', row.releaseId));
    if (!failureFamilyIndex.has(row.failureFamilyId)) issues.push(issue(`$.atlasRows[${rowPosition}].failureFamilyId`, 'FAILURE_FAMILY_REFERENCE_UNKNOWN', row.failureFamilyId));
    const hasFixture = row.reproduction?.fixtureId !== null;
    const hasGap = row.reproduction?.exactGap !== null;
    if (hasFixture === hasGap) issues.push(issue(`$.atlasRows[${rowPosition}].reproduction`, 'REPRODUCTION_XOR_REQUIRED', 'provide exactly one fixture or exact gap'));
    if (hasGap && (typeof row.reproduction.exactGap !== 'string' || row.reproduction.exactGap.trim().length === 0)) {
      issues.push(issue(`$.atlasRows[${rowPosition}].reproduction.exactGap`, 'EXACT_GAP_MISSING', 'exact gap must contain a bounded reason'));
    }
    if (hasFixture) {
      const registration = fixtureIndex.get(row.reproduction.fixtureId);
      if (!registration) {
        issues.push(issue(`$.atlasRows[${rowPosition}].reproduction.fixtureId`, 'FIXTURE_REFERENCE_UNKNOWN', row.reproduction.fixtureId));
      } else if (registration.fixtureKind !== 'ATLAS_REPRODUCTION' || registration.targetId !== row.atlasRowId) {
        issues.push(issue(`$.atlasRows[${rowPosition}].reproduction.fixtureId`, 'FIXTURE_REFERENCE_MISMATCH', `${registration.fixtureKind}|${registration.targetId}`));
      }
    }
  });

  packet.fixtureRegistry?.forEach((registration, registrationPosition) => {
    if (registration.fixtureKind === 'HAZARD_PROJECTION') {
      const hazard = hazardIndex.get(registration.targetId);
      if (!hazard) {
        issues.push(issue(`$.fixtureRegistry[${registrationPosition}].targetId`, 'FIXTURE_TARGET_UNKNOWN', registration.targetId));
      } else if (hazard.proof.kind !== 'DETERMINISTIC_FIXTURE' || hazard.proof.referenceId !== registration.fixtureId) {
        issues.push(issue(`$.fixtureRegistry[${registrationPosition}]`, 'FIXTURE_REGISTRATION_ORPHANED', `${registration.fixtureId}|${registration.targetId}`));
      }
    } else if (registration.fixtureKind === 'ATLAS_REPRODUCTION') {
      const row = atlasRowIndex.get(registration.targetId);
      if (!row) {
        issues.push(issue(`$.fixtureRegistry[${registrationPosition}].targetId`, 'FIXTURE_TARGET_UNKNOWN', registration.targetId));
      } else if (row.reproduction.fixtureId !== registration.fixtureId) {
        issues.push(issue(`$.fixtureRegistry[${registrationPosition}]`, 'FIXTURE_REGISTRATION_ORPHANED', `${registration.fixtureId}|${registration.targetId}`));
      }
    }
  });
}

export function validateHazardAssurancePacket(packet) {
  const issues = [...validateAgainstSchema(HAZARD_ASSURANCE_SCHEMA, packet)];
  if (issues.length === 0) {
    validateSemanticPacket(packet, issues);
    for (const path of findSecretLikePaths(packet)) issues.push(issue(path, 'SECRET_LIKE_FIELD', 'secret-bearing fields are forbidden'));
  }
  return Object.freeze(issues.sort(issueSort));
}

export function validateHazardViewModel(viewModel) {
  return validateAgainstSchema(HAZARD_VIEW_MODEL_SCHEMA, viewModel);
}
