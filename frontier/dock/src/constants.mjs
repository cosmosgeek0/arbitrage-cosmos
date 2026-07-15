export const DOCK_CONTRACT_VERSION = '1.0.0';
export const DESCRIPTOR_CANONICALIZATION_ID = 'RFC8785-JCS-WITH-RESERVED-ATTESTATION-EXCLUSION-V1';
export const HASH_ALGORITHM = 'SHA-256';

export const BUILD_STATES = Object.freeze([
  'PLANNED',
  'CONTRACT_PINNED',
  'BUILDING',
  'LOCAL_PROOF_GREEN',
  'PRESTAGE_READY',
  'PARKED',
  'PORT_CANDIDATE',
  'INTEGRATION_TESTING',
  'ACCEPTED',
  'QUARANTINED',
  'RETIRED',
]);

export const DISPOSITIONS = Object.freeze([
  'ACTIVE',
  'ALREADY_OWNED',
  'BLOCKED',
  'REJECTED',
  'NOT_LAUNCHED',
]);

export const FACET_CLASSES = Object.freeze([
  'EVIDENCE',
  'DERIVED_FEATURE',
  'ADVISORY_ASSESSOR',
  'REPLAY_ADAPTER',
  'COCKPIT_PROJECTION',
  'EXPERIMENT_PROVIDER',
  'SCENARIO_REFERENCE',
  'ANNOTATION_ADAPTER',
]);

export const FACET_OPERATIONS = Object.freeze([
  'DESCRIBE',
  'VALIDATE_FIXTURE',
  'EVALUATE_FIXTURE',
  'PROJECT_FIXTURE',
]);

export const FACET_OPERATION_BY_CLASS = Object.freeze({
  EVIDENCE: 'VALIDATE_FIXTURE',
  DERIVED_FEATURE: 'EVALUATE_FIXTURE',
  ADVISORY_ASSESSOR: 'EVALUATE_FIXTURE',
  REPLAY_ADAPTER: 'PROJECT_FIXTURE',
  COCKPIT_PROJECTION: 'PROJECT_FIXTURE',
  EXPERIMENT_PROVIDER: 'VALIDATE_FIXTURE',
  SCENARIO_REFERENCE: 'VALIDATE_FIXTURE',
  ANNOTATION_ADAPTER: 'VALIDATE_FIXTURE',
});

export const EXTENSION_DESCRIPTOR_V1_FIELDS = Object.freeze([
  'extensionId',
  'displayName',
  'extensionVersion',
  'dockContractVersion',
  'owner',
  'purpose',
  'capabilityClass',
  'immutableBaseSha',
  'sourceSha',
  'buildState',
  'disposition',
  'authorityClass',
  'canonicalInputContractRefs',
  'canonicalOutputContractRefs',
  'canonicalPolicyRefs',
  'adapterMapRefs',
  'requestedCapabilities',
  'requiredCapabilityRefs',
  'optionalCapabilityRefs',
  'hardDenialRefs',
  'latencyClass',
  'freshnessRequirement',
  'completenessRequirement',
  'determinismClass',
  'replayClass',
  'egressDeclaration',
  'networkMode',
  'secretMode',
  'resourceBudgetClaim',
  'maxSafeRateClaim',
  'dataSourceRefs',
  'dataClassifications',
  'licenseAndTermsRefs',
  'retentionRequest',
  'failureModes',
  'degradationBehavior',
  'healthContractRef',
  'cockpitProjectionRef',
  'testEntryPointRefs',
  'testReceiptRef',
  'knownLimitations',
  'insertionRequestRef',
  'disablePlan',
  'rollbackPlan',
  'uninstallPlan',
  'descriptorHash',
]);

export const CANONICAL_ADAPTER_MAP_V1_FIELDS = Object.freeze([
  'adapterId',
  'extensionId',
  'localFixtureSchema',
  'canonicalOwner',
  'canonicalContractId',
  'canonicalContractVersion',
  'fieldMap',
  'unitMap',
  'timeSemantics',
  'unknownPropagation',
  'lossy',
  'unsupportedFields',
  'testVectors',
  'adapterHash',
]);

export const EXTENSION_ATTESTATION_V1_FIELDS = Object.freeze([
  'descriptorCanonicalizationId',
  'descriptorHashAlgorithm',
  'descriptorHash',
  'signatureAlgorithm',
  'signerKeyId',
  'trustPolicyRef',
  'issuedAt',
  'expiresAt',
  'revocationRef',
  'signature',
  'attestationHash',
]);

export const PROVIDER_FACET_BINDING_V1_FIELDS = Object.freeze([
  'providerId',
  'extensionId',
  'facetClass',
  'canonicalOwnerRef',
  'canonicalContractRef',
  'canonicalContractVersion',
  'extensionProviderRef',
  'fixtureRequestSchemaRef',
  'fixtureResponseSchemaRef',
  'canonicalAdapterMapRef',
  'operation',
  'readOnly',
  'networkMode',
  'authorityClass',
  'unknownPropagation',
  'resourceBudgetClaimRef',
  'provenanceRef',
  'bindingStatus',
  'blockedReason',
  'bindingHash',
]);

export const SCENARIO_REFERENCE_V1_FIELDS = Object.freeze([
  'scenarioId',
  'scenarioVersion',
  'scenarioHash',
  'extensionProviderRef',
  'fixtureSchemaRef',
  'seed',
  'clockRef',
  'lineageRefs',
  'expectedCanonicalPostureRefs',
]);

export const RESERVED_ATTESTATION_FIELDS = Object.freeze([
  ...EXTENSION_ATTESTATION_V1_FIELDS,
  'attestation',
]);

export const HARD_DENIALS = Object.freeze([
  'NO_EXTERNAL_MUTATION',
  'NO_CANONICAL_STATE_WRITE',
  'NO_CREDENTIAL_OR_SECRET_ACCESS',
  'NO_LIVE_OR_TEST_ORDER',
  'NO_BORROW_REPAY_TRANSFER_WITHDRAWAL',
  'NO_RISK_OR_CAPITAL_AUTHORITY',
  'NO_MODEL_PROMOTION_OR_TREATMENT_ASSIGNMENT',
  'NO_CANARY_ROLLBACK_OR_DEPLOYMENT_CONTROL',
  'NO_COCKPIT_MUTATION',
  'NO_NETWORK_TRANSPORT',
  'NO_SCENARIO_EXECUTION',
  'NO_RUNTIME_MOUNTING',
]);

export const FORBIDDEN_TRUTH_CLASSES = Object.freeze([
  'CANONICAL_EXCHANGE_TRUTH',
  'CANONICAL_ACCOUNT_TRUTH',
  'CANONICAL_RISK_TRUTH',
  'CANONICAL_CAPITAL_TRUTH',
]);

export const FIXTURE_OUTPUT_CLASSES = Object.freeze([
  'EXTENSION_OBSERVATION',
  'ADVISORY',
  'FIXTURE_PROJECTION',
  'FIXTURE_VALIDATION',
  'FIXTURE_DESCRIPTION',
]);
