const SHA256 = /^[0-9a-f]{64}$/u;
const GIT_SHA = /^[0-9a-f]{40}$/u;

export const EXACT_TRUSTED_COHORT = 'EXACT_TRUSTED_COHORT';
export const PINNED_LEGACY_VALIDATION_ONLY = 'PINNED_LEGACY_VALIDATION_ONLY';
export const PINNED_LEGACY_AMENDMENT_CONTRACT_SHA256 = 'd60fdff586c1af91bfd92727ba49403bc0fd57210c4e76f1f5ee99391ee52581';

const PINNED_LEGACY_L15_COMPATIBILITY = Object.freeze({
  amendmentContractSha256: PINNED_LEGACY_AMENDMENT_CONTRACT_SHA256,
  requiresAuthorizedEffectRuntime: false,
  requiresBoundFileMode: false,
});
// The generic L15 loader cannot enable this shape with a caller-supplied flag.
// Only an exact pinned release tuple mints an object retained by this module.
const PINNED_LEGACY_PROOFS = new WeakSet();

const PINNED_LEGACY = Object.freeze({
  testedSha: 'cff3440a99ec004c0a6b66cf98ff04cdc0a921a0',
  sourceTree: '775b17b8ca2a1642b63a5487213428f912b36926',
  releaseI00EnforcementTreeDigestSha256: '2c75bfe8513e64ea2a56f29c760e634789c2d95308e044e8708de9378851405a',
  artifactManifestSha256: 'ce81a09061e52fd526b7a9171bf92714e32cc4de2b35295434d38f832f01771b',
  testedReceiptSha256: 'daaaaa01b361b7a772b34e50947b1f5e52c52b06c9c07812aef108d8bf95034d',
  browserReceiptSha256: 'b86dea69af5d3501ee63fd1048061afa1767c2f4b0d568cd0b0e156dfbb4cbe0',
  performanceReceiptSha256: '412711953df3d65762e3d65e2349d6046e21aabf37c202edcfb4c4b4d26f53ee',
  attestationSha256: 'f2f77545700197d4907a7e13767390a5b4c30aec551918d28d05e1ada1ad3867',
  signatureSha256: 'fc4cba011220123f78fee4a12a47667cd2874a397d113c8cdc393813114a6582',
  publicKeySha256: '5ffe041cca812b0911a834ee97cbbb5448bdc9054fc11d67fbc13da42502ab1c',
});
export const PINNED_LEGACY_VALIDATION_TUPLE = PINNED_LEGACY;

const LEGACY_KEYS = Object.freeze(Object.keys(PINNED_LEGACY));

function exactLegacyTuple(candidate) {
  return candidate !== null
    && typeof candidate === 'object'
    && !Array.isArray(candidate)
    && Object.keys(candidate).length === LEGACY_KEYS.length
    && LEGACY_KEYS.every((key) => candidate[key] === PINNED_LEGACY[key]);
}

export function classifyValidatorCohort({
  trustedI00EnforcementTreeDigestSha256,
  releaseI00EnforcementTreeDigestSha256,
  testedSha,
  sourceTree,
  artifactManifestSha256,
  testedReceiptSha256,
  browserReceiptSha256,
  performanceReceiptSha256,
  attestationSha256,
  signatureSha256,
  publicKeySha256,
}) {
  if (![trustedI00EnforcementTreeDigestSha256, releaseI00EnforcementTreeDigestSha256]
    .every((value) => SHA256.test(value ?? ''))) return null;
  if (trustedI00EnforcementTreeDigestSha256 === releaseI00EnforcementTreeDigestSha256) {
    return EXACT_TRUSTED_COHORT;
  }
  if (![artifactManifestSha256, testedReceiptSha256, browserReceiptSha256,
    performanceReceiptSha256, attestationSha256, signatureSha256,
    publicKeySha256].every((value) => SHA256.test(value ?? ''))
      || ![testedSha, sourceTree].every((value) => GIT_SHA.test(value ?? ''))) return null;

  return exactLegacyTuple({
    testedSha,
    sourceTree,
    releaseI00EnforcementTreeDigestSha256,
    artifactManifestSha256,
    testedReceiptSha256,
    browserReceiptSha256,
    performanceReceiptSha256,
    attestationSha256,
    signatureSha256,
    publicKeySha256,
  }) ? PINNED_LEGACY_VALIDATION_ONLY : null;
}

export function provePinnedLegacyValidatorCohort(candidate) {
  if (classifyValidatorCohort(candidate) !== PINNED_LEGACY_VALIDATION_ONLY) return null;
  const proof = Object.freeze({});
  PINNED_LEGACY_PROOFS.add(proof);
  return proof;
}

export function pinnedLegacyL15ContractCompatibility(proof) {
  return proof !== null
    && typeof proof === 'object'
    && PINNED_LEGACY_PROOFS.has(proof)
    ? PINNED_LEGACY_L15_COMPATIBILITY
    : null;
}

export function selectExpectedL15AmendmentContractSha256(
  validatorCohortMode,
  exactTrustedCohortSha256,
) {
  if (!SHA256.test(exactTrustedCohortSha256 ?? '')) return null;
  if (validatorCohortMode === EXACT_TRUSTED_COHORT) {
    return exactTrustedCohortSha256;
  }
  if (validatorCohortMode === PINNED_LEGACY_VALIDATION_ONLY) {
    return PINNED_LEGACY_AMENDMENT_CONTRACT_SHA256;
  }
  return null;
}
