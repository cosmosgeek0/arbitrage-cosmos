import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  OWNER_DIRECTIVE_PATHS,
  sealedOwnerDirectiveSha256,
  verifySealedOwnerDirective,
} from './sealed-owner-evidence.mjs';

export {
  sealedOwnerDirectiveSha256,
  verifySealedOwnerDirective,
} from './sealed-owner-evidence.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const FULL_SHA = /^[a-f0-9]{40}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const SAFE_PATH = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._/-]+$/;
const LIVING_DIRECTOR_PATHS = Object.freeze(['QL_DIRECTOR_STATE.md', 'QL_PARALLEL_DAG.md']);

function git(args, encoding = 'utf8') {
  return execFileSync('git', args, { cwd: ROOT, encoding, stdio: ['ignore', 'pipe', 'pipe'] });
}

function gitExitZero(args) {
  try {
    git(args);
    return true;
  } catch {
    return false;
  }
}

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function safeGit(args, encoding = 'utf8') {
  try {
    return git(args, encoding);
  } catch {
    return null;
  }
}

function sameMembers(actual, expected) {
  return actual.length === expected.length && [...actual].sort().every((value, index) => value === [...expected].sort()[index]);
}

function exactKeys(value, expected) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && sameMembers(Object.keys(value), expected);
}

function regularUtf8Lines(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0 || bytes.at(-1) !== 0x0a || bytes.includes(0)) return null;
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    const lines = text.split('\n');
    if (lines.at(-1) !== '') return null;
    lines.pop();
    return lines;
  } catch {
    return null;
  }
}

export function compareQDirectiveInputLocks(donorBytes, currentBytes, transition) {
  const donorLines = regularUtf8Lines(donorBytes);
  const currentLines = regularUtf8Lines(currentBytes);
  const transitionShape = exactKeys(transition, ['donorLaunchRow', 'currentLaunchRow']);
  const inventoryShape = donorLines !== null && currentLines !== null
    && donorLines.length === 8 && currentLines.length === 8;
  const headersUnchanged = inventoryShape
    && donorLines[0] === currentLines[0] && donorLines[1] === currentLines[1];
  const remainingRowsUnchanged = inventoryShape
    && donorLines.slice(3).every((line, index) => line === currentLines[index + 3]);
  const launchRowExact = transitionShape && inventoryShape
    && donorLines[2] === transition.donorLaunchRow
    && currentLines[2] === transition.currentLaunchRow
    && donorLines[2] !== currentLines[2];
  return Object.freeze({
    inventoryRows: inventoryShape ? 6 : null,
    headersUnchanged,
    remainingRowsUnchanged,
    launchRowExact,
    passed: transitionShape && inventoryShape && headersUnchanged && remainingRowsUnchanged && launchRowExact,
  });
}

export function verifyQDirectiveInputSupersession(document) {
  const structuralChecks = Object.freeze({
    documentKeys: exactKeys(document, ['schemaVersion', 'status', 'donor', 'authority', 'current', 'transition']),
    schemaVersion: document?.schemaVersion === 'I00_Q_DIRECTIVE_INPUT_SUPERSESSION_V1',
    status: document?.status === 'AUTHORIZED_EXTERNAL_SUPERSESSION',
    donorKeys: exactKeys(document?.donor, ['tip', 'tree', 'lockPath', 'lockGitBlob', 'lockSha256', 'lockBytes']),
    authorityKeys: exactKeys(document?.authority, [
      'commit',
      'sourceRef',
      'lockPath',
      'parentLockGitBlob',
      'resultLockGitBlob',
      'ownerLaunchGitBlob',
      'ownerLaunchSha256',
      'ownerLaunchBytes',
      'commitMessageNeedles',
    ]),
    currentKeys: exactKeys(document?.current, ['lockPath', 'lockGitBlob', 'lockSha256', 'lockBytes']),
    transitionKeys: exactKeys(document?.transition, ['donorLaunchRow', 'currentLaunchRow']),
    donorTip: FULL_SHA.test(document?.donor?.tip ?? ''),
    donorTree: FULL_SHA.test(document?.donor?.tree ?? ''),
    authorityCommit: FULL_SHA.test(document?.authority?.commit ?? ''),
    sourceRef: document?.authority?.sourceRef === 'current-main',
    lockPath: document?.donor?.lockPath === 'quant/DIRECTIVE_INPUTS.lock'
      && document?.authority?.lockPath === 'quant/DIRECTIVE_INPUTS.lock'
      && document?.current?.lockPath === 'quant/DIRECTIVE_INPUTS.lock',
    blobs: FULL_SHA.test(document?.donor?.lockGitBlob ?? '')
      && FULL_SHA.test(document?.authority?.parentLockGitBlob ?? '')
      && FULL_SHA.test(document?.authority?.resultLockGitBlob ?? '')
      && FULL_SHA.test(document?.authority?.ownerLaunchGitBlob ?? '')
      && FULL_SHA.test(document?.current?.lockGitBlob ?? ''),
    digests: SHA256.test(document?.donor?.lockSha256 ?? '')
      && SHA256.test(document?.authority?.ownerLaunchSha256 ?? '')
      && SHA256.test(document?.current?.lockSha256 ?? ''),
    byteLengths: Number.isSafeInteger(document?.donor?.lockBytes) && document.donor.lockBytes > 0
      && Number.isSafeInteger(document?.authority?.ownerLaunchBytes) && document.authority.ownerLaunchBytes > 0
      && Number.isSafeInteger(document?.current?.lockBytes) && document.current.lockBytes > 0,
    messageNeedles: Array.isArray(document?.authority?.commitMessageNeedles)
      && document.authority.commitMessageNeedles.length === 3
      && document.authority.commitMessageNeedles.every((needle) => typeof needle === 'string' && needle.length > 0 && needle.length <= 160),
  });
  const structurePassed = Object.values(structuralChecks).every(Boolean);
  if (!structurePassed) return Object.freeze({
    status: 'BLOCKED',
    structuralChecks,
    structurePassed,
    transition: null,
    observations: null,
    passed: false,
  });

  const donorExists = gitExitZero(['cat-file', '-e', `${document.donor.tip}^{commit}`]);
  const authorityExists = gitExitZero(['cat-file', '-e', `${document.authority.commit}^{commit}`]);
  const headReachable = authorityExists && gitExitZero(['merge-base', '--is-ancestor', document.authority.commit, 'HEAD']);
  const sourceReachable = authorityExists && gitExitZero(['merge-base', '--is-ancestor', document.authority.commit, document.authority.sourceRef]);
  const donorTree = donorExists ? safeGit(['rev-parse', `${document.donor.tip}^{tree}`])?.trim() ?? null : null;
  const donorLockGitBlob = donorExists ? safeGit(['rev-parse', `${document.donor.tip}:${document.donor.lockPath}`])?.trim() ?? null : null;
  const donorBytes = donorExists ? safeGit(['show', `${document.donor.tip}:${document.donor.lockPath}`], null) : null;
  const authorityParentLockGitBlob = authorityExists
    ? safeGit(['rev-parse', `${document.authority.commit}^:${document.authority.lockPath}`])?.trim() ?? null
    : null;
  const authorityParentBytes = authorityExists
    ? safeGit(['show', `${document.authority.commit}^:${document.authority.lockPath}`], null)
    : null;
  const authorityResultLockGitBlob = authorityExists
    ? safeGit(['rev-parse', `${document.authority.commit}:${document.authority.lockPath}`])?.trim() ?? null
    : null;
  const authorityResultBytes = authorityExists
    ? safeGit(['show', `${document.authority.commit}:${document.authority.lockPath}`], null)
    : null;
  const authorityMessage = authorityExists ? safeGit(['show', '-s', '--format=%B', document.authority.commit]) : null;
  const ownerLaunchBytes = safeGit(['cat-file', 'blob', document.authority.ownerLaunchGitBlob], null);
  let currentBytes = null;
  try {
    currentBytes = readFileSync(path.join(ROOT, document.current.lockPath));
  } catch {
    currentBytes = null;
  }
  const currentLockGitBlob = currentBytes === null ? null : safeGit(['hash-object', document.current.lockPath])?.trim() ?? null;
  const transition = donorBytes === null || currentBytes === null
    ? null
    : compareQDirectiveInputLocks(donorBytes, currentBytes, document.transition);
  const observations = Object.freeze({
    donorExists,
    donorTree,
    donorLockGitBlob,
    donorLockSha256: donorBytes === null ? null : digest(donorBytes),
    donorLockBytes: donorBytes?.length ?? null,
    authorityExists,
    headReachable,
    sourceReachable,
    authorityParentLockGitBlob,
    authorityParentLockSha256: authorityParentBytes === null ? null : digest(authorityParentBytes),
    authorityResultLockGitBlob,
    authorityResultLockSha256: authorityResultBytes === null ? null : digest(authorityResultBytes),
    authorityMessageVerified: authorityMessage !== null
      && document.authority.commitMessageNeedles.every((needle) => authorityMessage.includes(needle)),
    ownerLaunchSha256: ownerLaunchBytes === null ? null : digest(ownerLaunchBytes),
    ownerLaunchBytes: ownerLaunchBytes?.length ?? null,
    currentLockGitBlob,
    currentLockSha256: currentBytes === null ? null : digest(currentBytes),
    currentLockBytes: currentBytes?.length ?? null,
  });
  const passed = donorTree === document.donor.tree
    && donorLockGitBlob === document.donor.lockGitBlob
    && observations.donorLockSha256 === document.donor.lockSha256
    && observations.donorLockBytes === document.donor.lockBytes
    && headReachable && sourceReachable
    && authorityParentLockGitBlob === document.authority.parentLockGitBlob
    && authorityParentLockGitBlob === document.donor.lockGitBlob
    && observations.authorityParentLockSha256 === document.donor.lockSha256
    && authorityResultLockGitBlob === document.authority.resultLockGitBlob
    && authorityResultLockGitBlob === document.current.lockGitBlob
    && observations.authorityResultLockSha256 === document.current.lockSha256
    && observations.authorityMessageVerified
    && observations.ownerLaunchSha256 === document.authority.ownerLaunchSha256
    && observations.ownerLaunchBytes === document.authority.ownerLaunchBytes
    && currentLockGitBlob === document.current.lockGitBlob
    && observations.currentLockSha256 === document.current.lockSha256
    && observations.currentLockBytes === document.current.lockBytes
    && transition?.passed === true;
  return Object.freeze({
    status: passed ? 'AUTHORIZED_EXTERNAL_SUPERSESSION' : 'BLOCKED',
    structuralChecks,
    structurePassed,
    transition,
    observations,
    passed,
  });
}

export function verifyLivingDirectorInputAcceptance(document) {
  const authorizedFreeze = Object.freeze({
    sourceCutoffCommit: '2a832750f83137a8912c9f70e0b634b856f10aab',
    sourceCutoffTree: '3d2b8889e2aaf4a590993467a5bb3ecdf13c119b',
    rulingCommit: 'bdb29e37fb9b152aa1b7e1063ca892cd405c6245',
    inputs: Object.freeze({
      'QL_DIRECTOR_STATE.md': Object.freeze({
        commit: '2a832750f83137a8912c9f70e0b634b856f10aab',
        blob: '20d2ab2f2e11c09a60ceb247ae14d9a80d7d93d5',
        sha256: '95d4c2766451b7e126dc9cb411d68667a0fd1d8736f95d5cdff86015448074fd',
      }),
      'QL_PARALLEL_DAG.md': Object.freeze({
        commit: 'e7e5acdc2b52f86e000b1498b5a6c6452db3149b',
        blob: '6ff4da20b0d0cf9fc375144977acfe94e449dcae',
        sha256: '89a13c8a6a6b00a834d3dc586cc45c29eb4f7f32b2106fb5dea10fd2be3742a0',
      }),
    }),
  });
  const structuralChecks = Object.freeze({
    schemaVersion: document?.schemaVersion === 'I00_LIVING_DIRECTOR_INPUT_ACCEPTANCE_V2',
    ruling: document?.ruling === 'D-LAUNCH-7',
    mode: document?.mode === 'LATEST_CURRENT_MAIN_TOUCH',
    sourceRef: typeof document?.sourceRef === 'string' && document.sourceRef === 'current-main',
    sourceCutoffCommit: document?.sourceCutoffCommit === authorizedFreeze.sourceCutoffCommit,
    sourceCutoffTree: document?.sourceCutoffTree === authorizedFreeze.sourceCutoffTree,
    rulingCommit: document?.rulingCommit === authorizedFreeze.rulingCommit,
    candidateFreezeAuthorization: document?.candidateFreezeAuthorization === 'D-LAUNCH-62',
    historicalDLaunch7Acceptance: document?.historicalDLaunch7Acceptance?.sourceCutoffCommit
        === 'd78be24f4da14632c857ee250b62e3fec33c2743'
      && Array.isArray(document.historicalDLaunch7Acceptance.livingDirectorInputs)
      && sameMembers(
        document.historicalDLaunch7Acceptance.livingDirectorInputs.map((entry) => entry.path),
        LIVING_DIRECTOR_PATHS,
      ),
    historicalPacketPinsPreserved: document?.historicalPacketPinsPreserved === true,
    finalRealAdapterRepinRequired: document?.finalRealAdapterRepinRequired === false,
    finalRealAdapterRepinCompleted: document?.finalRealAdapterRepinCompleted === true,
    assemblyCopiesRejected: document?.acceptAssemblyWorkingTreeCopies === false,
    livingPathSet: Array.isArray(document?.livingDirectorInputs)
      && sameMembers(document.livingDirectorInputs.map((entry) => entry.path), LIVING_DIRECTOR_PATHS),
    directivePathSet: Array.isArray(document?.ownerDirectives)
      && sameMembers(document.ownerDirectives.map((entry) => entry.path), OWNER_DIRECTIVE_PATHS),
  });
  const structurePassed = Object.values(structuralChecks).every(Boolean);
  const sourceTip = structuralChecks.sourceCutoffCommit ? document.sourceCutoffCommit : null;
  const rulingVerified = structuralChecks.rulingCommit
    && structuralChecks.historicalDLaunch7Acceptance;

  const livingResults = (Array.isArray(document?.livingDirectorInputs) ? document.livingDirectorInputs : []).map((entry) => {
    const safePath = LIVING_DIRECTOR_PATHS.includes(entry.path) && SAFE_PATH.test(entry.path);
    const historicalPinValid = SHA256.test(entry.historicalPacketSha256 ?? '');
    const authorized = authorizedFreeze.inputs[entry.path];
    const observedFieldsValid = entry.authorizedLatestCommit === authorized?.commit
      && entry.authorizedGitBlob === authorized?.blob
      && entry.authorizedSha256 === authorized?.sha256;
    const candidateBytes = safePath ? readFileSync(path.join(ROOT, entry.path)) : null;
    const candidateSha256 = candidateBytes === null ? null : digest(candidateBytes);
    const observationMatches = observedFieldsValid && candidateSha256 === entry.authorizedSha256;
    return Object.freeze({
      path: entry.path,
      historicalPacketSha256: entry.historicalPacketSha256,
      latestCommit: entry.authorizedLatestCommit ?? null,
      observedGitBlob: entry.authorizedGitBlob ?? null,
      observedSha256: candidateSha256,
      authorizedSha256: entry.authorizedSha256 ?? null,
      safePath,
      historicalPinValid,
      latestCommitReachable: 'SEPARATE_TRI_STATE_DIAGNOSTIC',
      observationMatches,
      passed: structurePassed && rulingVerified && safePath && historicalPinValid && observationMatches,
    });
  });

  const directiveResults = (Array.isArray(document?.ownerDirectives) ? document.ownerDirectives : []).map((entry) => {
    const safePath = OWNER_DIRECTIVE_PATHS.includes(entry.path) && SAFE_PATH.test(entry.path);
    const expectedSha256Valid = SHA256.test(entry.sha256 ?? '');
    const sealedSha256 = safePath ? sealedOwnerDirectiveSha256(entry.path) : null;
    let evidence = null;
    let evidenceError = null;
    try {
      evidence = safePath ? verifySealedOwnerDirective(ROOT, entry.path) : null;
    } catch (error) {
      evidenceError = error instanceof Error ? error.message : String(error);
    }
    return Object.freeze({
      path: entry.path,
      expectedSha256: entry.sha256,
      sealedSha256,
      observedSha256: evidence?.sha256 ?? null,
      evidenceMode: evidence?.evidenceMode ?? 'MISSING',
      evidenceError,
      safePath,
      passed: structurePassed && safePath && expectedSha256Valid
        && sealedSha256 === entry.sha256
        && evidence?.sha256 === sealedSha256,
    });
  });

  return Object.freeze({
    schemaVersion: document?.schemaVersion ?? null,
    ruling: document?.ruling ?? null,
    mode: document?.mode ?? null,
    sourceRef: document?.sourceRef ?? null,
    sourceCutoffCommit: document?.sourceCutoffCommit ?? null,
    sourceTip,
    sourceCutoffTree: document?.sourceCutoffTree ?? null,
    sourceRefDisposition: 'HISTORICAL_MOVING_REF_NOT_DEREFERENCED; AUTHORIZED_BYTES_VERIFIED_FROM_CANDIDATE',
    ambientCutoffProof: 'SEPARATE_TRI_STATE_DIAGNOSTIC',
    rulingCommit: document?.rulingCommit ?? null,
    structuralChecks,
    structurePassed,
    rulingVerified,
    livingResults: Object.freeze(livingResults),
    directiveResults: Object.freeze(directiveResults),
    passed: structurePassed && rulingVerified
      && livingResults.length === LIVING_DIRECTOR_PATHS.length && livingResults.every((entry) => entry.passed)
      && directiveResults.length === OWNER_DIRECTIVE_PATHS.length && directiveResults.every((entry) => entry.passed),
  });
}

export function verifyReceiptProvenanceSeal(document) {
  if (!FULL_SHA.test(document.verificationBase)) throw new TypeError('INVALID_VERIFICATION_BASE');
  const results = document.items.map((item) => {
    if (!FULL_SHA.test(item.sha) || !SAFE_PATH.test(item.receiptPath)) {
      throw new TypeError('INVALID_PROVENANCE_ITEM');
    }
    const currentReceipt = readFileSync(path.join(ROOT, item.receiptPath));
    const currentReceiptHashVerified = digest(currentReceipt) === item.receiptSha256;
    const currentReceiptNeedleVerified = currentReceipt.includes(Buffer.from(item.expectedNeedle));
    return Object.freeze({
      sha: item.sha,
      claimType: item.claimType,
      ancestorRequired: item.ancestorRequired === true,
      currentReceiptHashVerified,
      currentReceiptNeedleVerified,
      ambientGitObjectProof: 'SEPARATE_TRI_STATE_DIAGNOSTIC',
      passed: currentReceiptHashVerified && currentReceiptNeedleVerified,
    });
  });
  return Object.freeze({
    schemaVersion: 1,
    mode: 'TRACKED_RECEIPT_BYTES_ONLY',
    verificationBase: document.verificationBase,
    ambientGitObjectProof: 'NOT_SEALED; SEPARATE_TRI_STATE_DIAGNOSTIC',
    results: Object.freeze(results),
    passed: results.every((result) => result.passed),
  });
}

export function verifyReceiptProvenance(document) {
  if (!FULL_SHA.test(document.verificationBase)) throw new TypeError('INVALID_VERIFICATION_BASE');
  const baseExists = gitExitZero(['cat-file', '-e', `${document.verificationBase}^{commit}`]);
  const results = document.items.map((item) => {
    if (!FULL_SHA.test(item.sha) || !SAFE_PATH.test(item.receiptPath)) throw new TypeError('INVALID_PROVENANCE_ITEM');
    const commitExists = gitExitZero(['cat-file', '-e', `${item.sha}^{commit}`]);
    const ancestorVerified = !item.ancestorRequired
      || gitExitZero(['merge-base', '--is-ancestor', item.sha, document.verificationBase]);
    const currentReceipt = readFileSync(path.join(ROOT, item.receiptPath));
    const currentReceiptHashVerified = digest(currentReceipt) === item.receiptSha256;
    const receiptClaimVerified = item.claimType === 'COMMIT_CONTAINING_RECEIPT'
      ? (() => {
        const receiptPathAtCommit = item.receiptPathAtCommit;
        if (!SAFE_PATH.test(receiptPathAtCommit ?? '')) return false;
        try {
          const committedReceipt = git(['show', `${item.sha}:${receiptPathAtCommit}`], null);
          return digest(committedReceipt) === item.receiptSha256 && committedReceipt.includes(Buffer.from(item.expectedNeedle));
        } catch {
          return false;
        }
      })()
      : currentReceipt.includes(Buffer.from(item.expectedNeedle));
    return Object.freeze({
      sha: item.sha,
      claimType: item.claimType,
      commitExists,
      ancestorVerified,
      currentReceiptHashVerified,
      receiptClaimVerified,
      passed: baseExists && commitExists && ancestorVerified && currentReceiptHashVerified && receiptClaimVerified,
    });
  });
  return Object.freeze({
    verificationBase: document.verificationBase,
    baseExists,
    results: Object.freeze(results),
    passed: baseExists && results.every((result) => result.passed),
  });
}

const PRODUCT_ASSURANCE_SCHEMA = 'I00_PRODUCT_ASSURANCE_HARNESS_V1';
const PRODUCT_ASSURANCE_DONOR_IDS = Object.freeze([
  'A_CORE',
  'A_HAZARD',
  'A_COCKPIT',
  'A_AGENT',
  'A_STABILITY',
  'A_CASE_S4',
]);
const PRODUCT_ASSURANCE_SUITE_IDS = Object.freeze([
  'A_CORE_BEHAVIOR',
  'A_HAZARD_BEHAVIOR',
  'A_COCKPIT_BEHAVIOR',
  'A_OBSERVABILITY_BEHAVIOR',
  'A_AGENT_BEHAVIOR',
  'A_STABILITY_BEHAVIOR',
  'A_CASE_S4_BEHAVIOR',
]);
const PRODUCT_ASSURANCE_MANIFEST_KEYS = Object.freeze([
  'schemaVersion',
  'expectedBehaviorPasses',
  'expectedDonorBehaviorPasses',
  'expectedIntegrationReplacementPasses',
  'expectedProvenancePasses',
  'expectedSkippedCallbacks',
  'expectedGitObjectContextProofs',
  'expectedLiveContextReplacements',
  'expectedContextReplacementRows',
  'expectedPostIntegrationReplacementRows',
  'contextProofPolicy',
  'integrationReplacement',
  'operationScan',
  'donors',
  'suites',
]);
const PRODUCT_ASSURANCE_DONOR_KEYS = Object.freeze([
  'id',
  'deltaBase',
  'acceptedTip',
  'donorTree',
  'deltaPathCount',
  'deltaPathSetSha256',
  'mergeCommit',
  'mergeTree',
  'mergeParents',
  'donorReceipt',
  'integrationReceipt',
  'requiredAncestry',
  'requiredObjects',
  'postIntegrationReplacements',
]);
const PRODUCT_ASSURANCE_SUITE_KEYS = Object.freeze([
  'id',
  'donorId',
  'testRoot',
  'completeTestInventory',
  'runs',
  'excludedContextTests',
  'expectedPasses',
]);
const PRODUCT_ASSURANCE_POST_INTEGRATION_REPLACEMENT_KEYS = Object.freeze([
  'path',
  'donorBlob',
  'replacementCommit',
  'replacementBlob',
]);
const EXPECTED_PRODUCT_ASSURANCE_POST_INTEGRATION_REPLACEMENTS = Object.freeze([
  Object.freeze({
    donorId: 'A_CORE',
    path: 'server/src/productAssurance/catalog/core.ts',
    donorBlob: 'b777635f1eeb4d92882e86ae0789086425603653',
    replacementCommit: 'cd0aa64db48a9898192b3d886abb5546933064e9',
    replacementBlob: '643578ac1b39e3c9367348de22f74e7806c96f3a',
  }),
  Object.freeze({
    donorId: 'A_CORE',
    path: 'server/src/productAssurance/invariants/evaluator.ts',
    donorBlob: '36679b18792ff29fd0a09e481f22cbe3bc5d80f4',
    replacementCommit: 'cd0aa64db48a9898192b3d886abb5546933064e9',
    replacementBlob: 'e7a9c3e6d74d905fdec91f50af7dead2a85c9ee7',
  }),
  Object.freeze({
    donorId: 'A_CORE',
    path: 'server/test/productAssurance/core-policy-inventory.test.mjs',
    donorBlob: '77811cad3df93bc9cba432dbfee8ef8695470f57',
    replacementCommit: 'cd0aa64db48a9898192b3d886abb5546933064e9',
    replacementBlob: 'a89a3225969b4ba887695471ecd10fe4d3de2cd1',
  }),
  Object.freeze({
    donorId: 'A_CORE',
    path: 'test/productAssurance/production-operation-scan.mjs',
    donorBlob: 'fb702db91b56b68f20c91d94f91666b150e41bec',
    replacementCommit: '9a6ec938ef45716379d4f4f4972102ef85cb7271',
    replacementBlob: '4546f31b7d42e4a4e7d9d7e396f377bf010ac76e',
  }),
  Object.freeze({
    donorId: 'A_CORE',
    path: 'test/productAssurance/scope-purity.mjs',
    donorBlob: '382c9c00173467098a10a6d4a7e8e893026c05bf',
    replacementCommit: '9a6ec938ef45716379d4f4f4972102ef85cb7271',
    replacementBlob: '655a6fbe439034cd1770b52d7f898cced1f88368',
  }),
  Object.freeze({
    donorId: 'A_CASE_S4',
    path: 'test/productAssurance/systemic/assuranceCase/purity-scope.test.mjs',
    donorBlob: '6d278916093e54b0b2969a332fae1f5cc403ab5c',
    replacementCommit: '9a6ec938ef45716379d4f4f4972102ef85cb7271',
    replacementBlob: 'cdb8dc8bf0bb962991641e629204978768b99d87',
  }),
  Object.freeze({
    donorId: 'A_CASE_S4',
    path: 'test/productAssurance/systemic/assuranceCase/s1-provenance.test.mjs',
    donorBlob: 'cdea2f5a4c5a1517cdd7e16fbb5c1273ac99cdad',
    replacementCommit: '39ec378d4a7584f3c69436ef5c9f105c56bffb16',
    replacementBlob: '09d8bedb8b88f901f0ec345381205675be41aa9d',
  }),
]);

function compareAscii(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function uniqueStrings(values) {
  return Array.isArray(values)
    && values.every((value) => typeof value === 'string')
    && new Set(values).size === values.length;
}

function sortedStrings(values) {
  return [...values].sort(compareAscii);
}

function exactOrderedMembers(actual, expected) {
  return Array.isArray(actual)
    && actual.length === expected.length
    && actual.every((value, index) => value === expected[index]);
}

function addError(errors, condition, code) {
  if (!condition) errors.push(code);
}

function safeWorkspaceBytes(relativePath) {
  if (!SAFE_PATH.test(relativePath ?? '')) return null;
  try {
    return readFileSync(path.join(ROOT, relativePath));
  } catch {
    return null;
  }
}

export function listProductAssuranceTrackedTestFiles(relativeRoot, repositoryRoot = ROOT) {
  if (!SAFE_PATH.test(relativeRoot ?? '')) throw new TypeError('INVALID_TEST_ROOT');
  let raw;
  try {
    raw = execFileSync('git', [
      'ls-files',
      '--cached',
      '--stage',
      '-z',
      '--full-name',
      '--',
      relativeRoot,
    ], { cwd: repositoryRoot, encoding: null, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch {
    throw new TypeError(`TRACKED_TEST_INVENTORY_UNAVAILABLE:${relativeRoot}`);
  }

  let records;
  try {
    records = new TextDecoder('utf-8', { fatal: true }).decode(raw).split('\0').filter(Boolean);
  } catch {
    throw new TypeError(`TRACKED_TEST_INVENTORY_NOT_UTF8:${relativeRoot}`);
  }
  const prefix = `${relativeRoot}/`;
  const files = [];
  const seen = new Set();
  for (const record of records) {
    const match = /^([0-7]{6}) ([0-9a-f]{40,64}) ([0-3])\t(.+)$/u.exec(record);
    if (match === null) throw new TypeError(`TRACKED_TEST_ENTRY_INVALID:${relativeRoot}`);
    const [, mode, , stage, relativePath] = match;
    if (stage !== '0') throw new TypeError(`TRACKED_TEST_UNMERGED:${relativePath}`);
    if (!SAFE_PATH.test(relativePath) || !relativePath.startsWith(prefix)) {
      throw new TypeError(`TRACKED_TEST_PATH_INVALID:${relativePath}`);
    }
    if (mode !== '100644' && mode !== '100755') {
      throw new TypeError(`TRACKED_TEST_MODE_INVALID:${relativePath}`);
    }
    if (!relativePath.endsWith('.test.mjs')) continue;
    if (seen.has(relativePath)) throw new TypeError(`TRACKED_TEST_DUPLICATE:${relativePath}`);
    seen.add(relativePath);
    files.push(relativePath);
  }
  return Object.freeze(files.sort(compareAscii));
}

export function validateProductAssuranceManifest(document) {
  const errors = [];
  addError(errors, exactKeys(document, PRODUCT_ASSURANCE_MANIFEST_KEYS), 'MANIFEST_KEYS');
  addError(errors, document?.schemaVersion === PRODUCT_ASSURANCE_SCHEMA, 'SCHEMA_VERSION');
  addError(errors, document?.expectedBehaviorPasses === 802, 'BEHAVIOR_TOTAL');
  addError(errors, document?.expectedDonorBehaviorPasses === 801, 'DONOR_BEHAVIOR_TOTAL');
  addError(errors, document?.expectedIntegrationReplacementPasses === 1, 'INTEGRATION_REPLACEMENT_TOTAL');
  addError(errors, document?.expectedProvenancePasses === 4, 'PROVENANCE_TOTAL');
  addError(errors, document?.expectedSkippedCallbacks === 6, 'SKIPPED_CALLBACK_TOTAL');
  addError(errors, document?.expectedGitObjectContextProofs === 6, 'GIT_OBJECT_CONTEXT_PROOF_TOTAL');
  addError(errors, document?.expectedLiveContextReplacements === 1, 'LIVE_CONTEXT_REPLACEMENT_TOTAL');
  addError(errors, document?.expectedContextReplacementRows === 7, 'CONTEXT_REPLACEMENT_ROW_TOTAL');
  addError(errors, document?.expectedPostIntegrationReplacementRows === 7,
    'POST_INTEGRATION_REPLACEMENT_TOTAL');
  addError(errors, document?.contextProofPolicy
    === 'SIX_GIT_OBJECT_PROOFS_REPLACE_FIVE_DONOR_CONTEXT_CALLBACKS_ONE_LIVE_OPERATION_POLICY_REPLACES_THE_A_CORE_DENOMINATOR_CALLBACK',
  'CONTEXT_PROOF_POLICY');
  addError(errors, exactKeys(document?.integrationReplacement, ['id', 'testFile', 'exactName', 'expectedPasses'])
    && document.integrationReplacement.id === 'LIVE_OPERATION_POLICY'
    && document.integrationReplacement.testFile === 'test/i00/product-assurance-live-operation.test.mjs'
    && document.integrationReplacement.exactName
      === 'assembled production operation scan matches the final manifest denominator with zero uncovered sites'
    && document.integrationReplacement.expectedPasses === 1, 'INTEGRATION_REPLACEMENT');

  const operationScan = document?.operationScan;
  addError(errors, exactKeys(operationScan, [
    'schemaVersion', 'scriptPath', 'filesScanned', 'discovered', 'covered', 'uncovered',
  ]), 'OPERATION_SCAN_KEYS');
  addError(errors, operationScan?.schemaVersion === 'production-operation-scan.v1', 'OPERATION_SCAN_SCHEMA');
  addError(errors, operationScan?.scriptPath === 'test/productAssurance/production-operation-scan.mjs', 'OPERATION_SCAN_PATH');
  addError(errors, Number.isSafeInteger(operationScan?.filesScanned) && operationScan.filesScanned > 0, 'OPERATION_FILE_COUNT');
  addError(errors, Number.isSafeInteger(operationScan?.discovered) && operationScan.discovered > 0
    && operationScan.covered === operationScan.discovered
    && operationScan.uncovered === 0, 'OPERATION_COUNTS');

  const donors = Array.isArray(document?.donors) ? document.donors : [];
  addError(errors, donors.length === PRODUCT_ASSURANCE_DONOR_IDS.length, 'DONOR_COUNT');
  addError(errors, uniqueStrings(donors.map((donor) => donor?.id))
    && sameMembers(donors.map((donor) => donor.id), PRODUCT_ASSURANCE_DONOR_IDS), 'DONOR_IDS');
  const postIntegrationReplacements = [];
  for (const donor of donors) {
    const prefix = `DONOR_${donor?.id ?? 'UNKNOWN'}`;
    addError(errors, exactKeys(donor, PRODUCT_ASSURANCE_DONOR_KEYS), `${prefix}_KEYS`);
    for (const [field, value] of [
      ['DELTA_BASE', donor?.deltaBase],
      ['ACCEPTED_TIP', donor?.acceptedTip],
      ['DONOR_TREE', donor?.donorTree],
      ['MERGE_COMMIT', donor?.mergeCommit],
      ['MERGE_TREE', donor?.mergeTree],
    ]) addError(errors, FULL_SHA.test(value ?? ''), `${prefix}_${field}`);
    addError(errors, Number.isSafeInteger(donor?.deltaPathCount) && donor.deltaPathCount > 0, `${prefix}_PATH_COUNT`);
    addError(errors, SHA256.test(donor?.deltaPathSetSha256 ?? ''), `${prefix}_PATH_HASH`);
    addError(errors, Array.isArray(donor?.mergeParents) && donor.mergeParents.length === 2
      && donor.mergeParents.every((value) => FULL_SHA.test(value))
      && donor.mergeParents[1] === donor.acceptedTip, `${prefix}_MERGE_PARENTS`);
    addError(errors, exactKeys(donor?.donorReceipt, ['path', 'gitBlob', 'sha256', 'terminalNeedle'])
      && SAFE_PATH.test(donor.donorReceipt.path ?? '')
      && FULL_SHA.test(donor.donorReceipt.gitBlob ?? '')
      && SHA256.test(donor.donorReceipt.sha256 ?? '')
      && typeof donor.donorReceipt.terminalNeedle === 'string'
      && donor.donorReceipt.terminalNeedle.length > 0, `${prefix}_DONOR_RECEIPT`);
    addError(errors, exactKeys(donor?.integrationReceipt, ['commit', 'path', 'gitBlob', 'sha256', 'statusNeedle'])
      && FULL_SHA.test(donor.integrationReceipt.commit ?? '')
      && SAFE_PATH.test(donor.integrationReceipt.path ?? '')
      && FULL_SHA.test(donor.integrationReceipt.gitBlob ?? '')
      && SHA256.test(donor.integrationReceipt.sha256 ?? '')
      && typeof donor.integrationReceipt.statusNeedle === 'string'
      && donor.integrationReceipt.statusNeedle.length > 0, `${prefix}_INTEGRATION_RECEIPT`);
    addError(errors, Array.isArray(donor?.requiredAncestry)
      && donor.requiredAncestry.every((entry) => exactKeys(entry, ['ancestor', 'descendant'])
        && FULL_SHA.test(entry.ancestor ?? '') && FULL_SHA.test(entry.descendant ?? '')), `${prefix}_REQUIRED_ANCESTRY`);
    addError(errors, uniqueStrings(donor?.requiredObjects)
      && donor.requiredObjects.every((value) => FULL_SHA.test(value)), `${prefix}_REQUIRED_OBJECTS`);
    const replacements = Array.isArray(donor?.postIntegrationReplacements)
      ? donor.postIntegrationReplacements : [];
    addError(errors, Array.isArray(donor?.postIntegrationReplacements)
      && replacements.every((entry) => exactKeys(entry, PRODUCT_ASSURANCE_POST_INTEGRATION_REPLACEMENT_KEYS)
        && SAFE_PATH.test(entry.path ?? '')
        && FULL_SHA.test(entry.donorBlob ?? '')
        && FULL_SHA.test(entry.replacementCommit ?? '')
        && FULL_SHA.test(entry.replacementBlob ?? ''))
      && uniqueStrings(replacements.map((entry) => entry.path))
      && exactOrderedMembers(replacements.map((entry) => entry.path), sortedStrings(replacements.map((entry) => entry.path))),
    `${prefix}_POST_INTEGRATION_REPLACEMENTS`);
    postIntegrationReplacements.push(...replacements.map((entry) => ({ donorId: donor.id, ...entry })));
  }
  addError(errors, postIntegrationReplacements.length === document?.expectedPostIntegrationReplacementRows
    && JSON.stringify(postIntegrationReplacements)
      === JSON.stringify(EXPECTED_PRODUCT_ASSURANCE_POST_INTEGRATION_REPLACEMENTS),
  'POST_INTEGRATION_REPLACEMENTS_EXACT');

  const suites = Array.isArray(document?.suites) ? document.suites : [];
  addError(errors, suites.length === PRODUCT_ASSURANCE_SUITE_IDS.length, 'SUITE_COUNT');
  addError(errors, uniqueStrings(suites.map((suite) => suite?.id))
    && sameMembers(suites.map((suite) => suite.id), PRODUCT_ASSURANCE_SUITE_IDS), 'SUITE_IDS');
  const ownedFiles = new Map();
  let behaviorTotal = 0;
  let contextReplacementRows = 0;
  let gitObjectContextProofs = 0;
  let liveContextReplacements = 0;
  const skippedCallbacks = new Set();
  for (const suite of suites) {
    const prefix = `SUITE_${suite?.id ?? 'UNKNOWN'}`;
    addError(errors, exactKeys(suite, PRODUCT_ASSURANCE_SUITE_KEYS), `${prefix}_KEYS`);
    addError(errors, PRODUCT_ASSURANCE_DONOR_IDS.includes(suite?.donorId), `${prefix}_DONOR`);
    addError(errors, SAFE_PATH.test(suite?.testRoot ?? ''), `${prefix}_ROOT`);
    const inventory = Array.isArray(suite?.completeTestInventory) ? suite.completeTestInventory : [];
    addError(errors, uniqueStrings(inventory)
      && exactOrderedMembers(inventory, sortedStrings(inventory))
      && inventory.every((file) => SAFE_PATH.test(file) && file.endsWith('.test.mjs')
        && file.startsWith(`${suite.testRoot}/`)), `${prefix}_INVENTORY`);
    for (const file of inventory) {
      if (ownedFiles.has(file)) errors.push(`${prefix}_DUPLICATE_OWNER:${file}`);
      else ownedFiles.set(file, suite.id);
    }

    const runs = Array.isArray(suite?.runs) ? suite.runs : [];
    addError(errors, runs.length > 0 && uniqueStrings(runs.map((run) => run?.id)), `${prefix}_RUNS`);
    const runFiles = new Set();
    let suiteTotal = 0;
    for (const run of runs) {
      const runPrefix = `${prefix}_RUN_${run?.id ?? 'UNKNOWN'}`;
      const files = Array.isArray(run?.files) ? run.files : [];
      const exactNames = Array.isArray(run?.exactNames) ? run.exactNames : [];
      addError(errors, exactKeys(run, ['id', 'files', 'selection', 'exactNames', 'expectedPasses']), `${runPrefix}_KEYS`);
      addError(errors, uniqueStrings(files) && files.length > 0
        && files.every((file) => inventory.includes(file)), `${runPrefix}_FILES`);
      for (const file of files) {
        if (runFiles.has(file)) errors.push(`${runPrefix}_DUPLICATE_FILE:${file}`);
        runFiles.add(file);
      }
      addError(errors, run?.selection === 'ALL' || run?.selection === 'EXACT_NAMES', `${runPrefix}_SELECTION`);
      addError(errors, uniqueStrings(exactNames), `${runPrefix}_NAMES`);
      addError(errors, run?.selection === 'ALL'
        ? exactNames.length === 0
        : files.length === 1 && exactNames.length > 0
          && exactNames.every((name) => typeof name === 'string' && name.length > 0 && name.length <= 512), `${runPrefix}_NAME_POLICY`);
      addError(errors, Number.isSafeInteger(run?.expectedPasses) && run.expectedPasses > 0, `${runPrefix}_PASS_COUNT`);
      if (Number.isSafeInteger(run?.expectedPasses)) suiteTotal += run.expectedPasses;
    }

    const exclusions = Array.isArray(suite?.excludedContextTests) ? suite.excludedContextTests : [];
    contextReplacementRows += exclusions.length;
    gitObjectContextProofs += exclusions.filter((entry) => entry.replacementKind === 'GIT_OBJECT_PROVENANCE').length;
    liveContextReplacements += exclusions.filter((entry) => entry.replacementKind === 'LIVE_OPERATION_POLICY').length;
    addError(errors, exclusions.every((entry) => exactKeys(entry, ['file', 'exactName', 'replacementKind', 'replacementProofId'])
      && inventory.includes(entry.file)
      && typeof entry.exactName === 'string' && entry.exactName.length > 0 && entry.exactName.length <= 512
      && ((entry.replacementKind === 'GIT_OBJECT_PROVENANCE'
        && /^[A-Z0-9_]+_GIT_OBJECT_PROVENANCE$/u.test(entry.replacementProofId ?? ''))
        || (entry.replacementKind === 'LIVE_OPERATION_POLICY'
          && entry.replacementProofId === 'A_CORE_LIVE_OPERATION_POLICY_ASSEMBLED_SCAN'))), `${prefix}_EXCLUSIONS`);
    const exclusionKeys = exclusions.map((entry) => `${entry.file}\0${entry.exactName}\0${entry.replacementProofId}`);
    addError(errors, new Set(exclusionKeys).size === exclusionKeys.length, `${prefix}_DUPLICATE_EXCLUSION`);
    for (const exclusion of exclusions) {
      skippedCallbacks.add(`${exclusion.file}\0${exclusion.exactName}`);
      for (const run of runs) {
        const files = Array.isArray(run?.files) ? run.files : [];
        const exactNames = Array.isArray(run?.exactNames) ? run.exactNames : [];
        if (files.includes(exclusion.file) && exactNames.includes(exclusion.exactName)) {
          errors.push(`${prefix}_CONTEXT_SELECTED:${exclusion.file}`);
        }
      }
    }
    addError(errors, inventory.every((file) => runFiles.has(file)
      || exclusions.some((entry) => entry.file === file)), `${prefix}_UNCLASSIFIED_FILE`);
    addError(errors, suiteTotal === suite?.expectedPasses, `${prefix}_SUBTOTAL`);
    if (Number.isSafeInteger(suite?.expectedPasses)) behaviorTotal += suite.expectedPasses;
  }
  addError(errors, behaviorTotal === 801 && behaviorTotal === document?.expectedDonorBehaviorPasses, 'DONOR_BEHAVIOR_AGGREGATE');
  addError(errors, behaviorTotal + document?.expectedIntegrationReplacementPasses === 802
    && behaviorTotal + document?.expectedIntegrationReplacementPasses === document?.expectedBehaviorPasses,
  'EFFECTIVE_BEHAVIOR_AGGREGATE');
  addError(errors, contextReplacementRows === 7
    && contextReplacementRows === document?.expectedContextReplacementRows, 'CONTEXT_REPLACEMENT_ROW_AGGREGATE');
  addError(errors, gitObjectContextProofs === 6
    && gitObjectContextProofs === document?.expectedGitObjectContextProofs, 'GIT_OBJECT_CONTEXT_PROOF_AGGREGATE');
  addError(errors, liveContextReplacements === 1
    && liveContextReplacements === document?.expectedLiveContextReplacements, 'LIVE_CONTEXT_REPLACEMENT_AGGREGATE');
  addError(errors, skippedCallbacks.size === 6
    && skippedCallbacks.size === document?.expectedSkippedCallbacks, 'SKIPPED_CALLBACK_AGGREGATE');
  addError(errors, PRODUCT_ASSURANCE_DONOR_IDS.every((donorId) => suites.some((suite) => suite.donorId === donorId)),
    'UNUSED_DONOR');

  return Object.freeze({
    schemaVersion: document?.schemaVersion ?? null,
    donorBehaviorTotal: behaviorTotal,
    integrationReplacementBehavior: document?.expectedIntegrationReplacementPasses ?? null,
    effectiveBehaviorTotal: Number.isSafeInteger(document?.expectedIntegrationReplacementPasses)
      ? behaviorTotal + document.expectedIntegrationReplacementPasses
      : null,
    skippedCallbacks: skippedCallbacks.size,
    gitObjectContextProofs,
    liveContextReplacements,
    contextReplacementRows,
    postIntegrationReplacementRows: postIntegrationReplacements.length,
    errors: Object.freeze(errors),
    passed: errors.length === 0,
  });
}

export function verifyProductAssuranceSuiteInventory(document) {
  const validation = validateProductAssuranceManifest(document);
  if (!validation.passed) return Object.freeze({
    validation,
    suites: Object.freeze([]),
    integrationReplacement: null,
    passed: false,
  });
  const results = document.suites.map((suite) => {
    let actualFiles = [];
    let scanError = null;
    try {
      actualFiles = listProductAssuranceTrackedTestFiles(suite.testRoot);
    } catch (error) {
      scanError = error instanceof Error ? error.message : String(error);
    }
    const inventoryMatches = scanError === null
      && exactOrderedMembers(actualFiles, suite.completeTestInventory);
    const nameResults = [];
    for (const run of suite.runs.filter((entry) => entry.selection === 'EXACT_NAMES')) {
      const bytes = safeWorkspaceBytes(run.files[0]);
      for (const name of run.exactNames) nameResults.push(Object.freeze({
        file: run.files[0],
        name,
        found: bytes !== null && bytes.includes(Buffer.from(name)),
      }));
    }
    for (const exclusion of suite.excludedContextTests) {
      const bytes = safeWorkspaceBytes(exclusion.file);
      nameResults.push(Object.freeze({
        file: exclusion.file,
        name: exclusion.exactName,
        found: bytes !== null && bytes.includes(Buffer.from(exclusion.exactName)),
        excluded: true,
      }));
    }
    return Object.freeze({
      id: suite.id,
      scanError,
      actualFiles: Object.freeze(actualFiles),
      inventoryMatches,
      nameResults: Object.freeze(nameResults),
      passed: inventoryMatches && nameResults.every((entry) => entry.found),
    });
  });
  const integrationReplacementBytes = safeWorkspaceBytes(document.integrationReplacement.testFile);
  const integrationReplacement = Object.freeze({
    id: document.integrationReplacement.id,
    file: document.integrationReplacement.testFile,
    name: document.integrationReplacement.exactName,
    fileExists: integrationReplacementBytes !== null,
    nameFound: integrationReplacementBytes?.includes(Buffer.from(document.integrationReplacement.exactName)) === true,
  });
  return Object.freeze({
    validation,
    suites: Object.freeze(results),
    integrationReplacement,
    passed: results.every((result) => result.passed)
      && integrationReplacement.fileExists && integrationReplacement.nameFound,
  });
}

function gitTreeBlobs(ref) {
  if (!FULL_SHA.test(ref ?? '') && ref !== 'HEAD') return null;
  const output = safeGit(['ls-tree', '-r', '-z', '--full-tree', ref], null);
  if (output === null) return null;
  const entries = new Map();
  for (const record of output.toString('utf8').split('\0').filter(Boolean)) {
    const tab = record.indexOf('\t');
    const header = tab < 0 ? '' : record.slice(0, tab);
    const relativePath = tab < 0 ? '' : record.slice(tab + 1);
    const fields = header.split(' ');
    if (fields.length === 3 && fields[1] === 'blob' && FULL_SHA.test(fields[2]) && SAFE_PATH.test(relativePath)) {
      entries.set(relativePath, fields[2]);
    }
  }
  return entries;
}

function gitDeltaPaths(base, tip) {
  if (!FULL_SHA.test(base ?? '') || !FULL_SHA.test(tip ?? '')) return null;
  const output = safeGit(['diff', '--name-only', '--no-renames', '-z', `${base}..${tip}`, '--'], null);
  if (output === null) return null;
  const paths = output.toString('utf8').split('\0').filter(Boolean).sort(compareAscii);
  return paths.every((entry) => SAFE_PATH.test(entry)) ? Object.freeze(paths) : null;
}

function pathSetDigest(paths) {
  return digest(Buffer.from(`${paths.join('\n')}\n`, 'utf8'));
}

function verifyProductAssurancePostIntegrationReplacement(donor, replacement, paths, donorBlobs, headBlobs) {
  const relativePath = replacement?.path ?? '';
  const replacementCommit = replacement?.replacementCommit ?? '';
  const safePath = SAFE_PATH.test(relativePath);
  const replacementExists = FULL_SHA.test(replacementCommit)
    && gitExitZero(['cat-file', '-e', `${replacementCommit}^{commit}`]);
  const replacementParents = replacementExists
    ? safeGit(['show', '-s', '--format=%P', replacementCommit])?.trim().split(/\s+/u).filter(Boolean) ?? []
    : [];
  const donorBlob = safePath ? donorBlobs?.get(relativePath) ?? null : null;
  const headBlob = safePath ? headBlobs?.get(relativePath) ?? null : null;
  const predecessorBlob = replacementExists && replacementParents.length === 1 && safePath
    ? safeGit(['rev-parse', `${replacementCommit}^:${relativePath}`])?.trim() ?? null
    : null;
  const committedReplacementBlob = replacementExists && safePath
    ? safeGit(['rev-parse', `${replacementCommit}:${relativePath}`])?.trim() ?? null
    : null;
  const latestTouch = safePath
    ? safeGit(['log', '-1', '--format=%H', 'HEAD', '--', relativePath])?.trim() || null
    : null;
  const mergeReachableToReplacement = replacementExists
    && gitExitZero(['merge-base', '--is-ancestor', donor?.mergeCommit ?? '', replacementCommit]);
  const replacementReachableToHead = replacementExists
    && gitExitZero(['merge-base', '--is-ancestor', replacementCommit, 'HEAD']);
  const passed = exactKeys(replacement, PRODUCT_ASSURANCE_POST_INTEGRATION_REPLACEMENT_KEYS)
    && safePath
    && paths?.includes(relativePath) === true
    && FULL_SHA.test(replacement?.donorBlob ?? '')
    && FULL_SHA.test(replacement?.replacementBlob ?? '')
    && replacement.donorBlob !== replacement.replacementBlob
    && donorBlob === replacement.donorBlob
    && replacementParents.length === 1
    && predecessorBlob === replacement.donorBlob
    && committedReplacementBlob === replacement.replacementBlob
    && headBlob === replacement.replacementBlob
    && latestTouch === replacementCommit
    && mergeReachableToReplacement
    && replacementReachableToHead;
  return Object.freeze({
    path: relativePath || null,
    donorBlob,
    declaredDonorBlob: replacement?.donorBlob ?? null,
    replacementCommit: replacementCommit || null,
    replacementParents: Object.freeze(replacementParents),
    predecessorBlob,
    committedReplacementBlob,
    declaredReplacementBlob: replacement?.replacementBlob ?? null,
    headBlob,
    latestTouch,
    mergeReachableToReplacement,
    replacementReachableToHead,
    passed,
  });
}

export function verifyProductAssuranceDonor(donor) {
  const baseExists = FULL_SHA.test(donor?.deltaBase ?? '') && gitExitZero(['cat-file', '-e', `${donor.deltaBase}^{commit}`]);
  const donorExists = FULL_SHA.test(donor?.acceptedTip ?? '') && gitExitZero(['cat-file', '-e', `${donor.acceptedTip}^{commit}`]);
  const mergeExists = FULL_SHA.test(donor?.mergeCommit ?? '') && gitExitZero(['cat-file', '-e', `${donor.mergeCommit}^{commit}`]);
  const donorTree = donorExists ? safeGit(['rev-parse', `${donor.acceptedTip}^{tree}`])?.trim() ?? null : null;
  const mergeTree = mergeExists ? safeGit(['rev-parse', `${donor.mergeCommit}^{tree}`])?.trim() ?? null : null;
  const mergeParents = mergeExists
    ? safeGit(['show', '-s', '--format=%P', donor.mergeCommit])?.trim().split(/\s+/u).filter(Boolean) ?? []
    : [];
  const donorMerged = donorExists && mergeExists
    && gitExitZero(['merge-base', '--is-ancestor', donor.acceptedTip, donor.mergeCommit]);
  const mergeReachable = mergeExists && gitExitZero(['merge-base', '--is-ancestor', donor.mergeCommit, 'HEAD']);
  const paths = baseExists && donorExists ? gitDeltaPaths(donor.deltaBase, donor.acceptedTip) : null;
  const donorBlobs = donorExists ? gitTreeBlobs(donor.acceptedTip) : null;
  const mergeBlobs = mergeExists ? gitTreeBlobs(donor.mergeCommit) : null;
  const headBlobs = gitTreeBlobs('HEAD');
  const replacementRows = Array.isArray(donor?.postIntegrationReplacements)
    ? donor.postIntegrationReplacements : [];
  const replacementPathSet = new Set(replacementRows.map((entry) => entry?.path));
  const replacementRowsValid = replacementPathSet.size === replacementRows.length;
  const postIntegrationReplacements = replacementRows.map((replacement) => (
    verifyProductAssurancePostIntegrationReplacement(donor, replacement, paths, donorBlobs, headBlobs)
  ));
  const replacementsByPath = new Map(postIntegrationReplacements.map((entry) => [entry.path, entry]));
  const blobResults = (paths ?? []).map((relativePath) => {
    const donorBlob = donorBlobs?.get(relativePath) ?? null;
    const mergeBlob = mergeBlobs?.get(relativePath) ?? null;
    const headBlob = headBlobs?.get(relativePath) ?? null;
    const replacement = replacementsByPath.get(relativePath) ?? null;
    return Object.freeze({
      path: relativePath,
      donorBlob,
      mergeBlob,
      headBlob,
      headDisposition: replacement === null ? 'DONOR_IDENTICAL' : 'AUTHORIZED_POST_INTEGRATION_REPLACEMENT',
      replacementCommit: replacement?.replacementCommit ?? null,
      passed: donorBlob !== null && donorBlob === mergeBlob
        && (replacement === null ? donorBlob === headBlob : replacement.passed),
    });
  });

  const donorReceiptPath = donor?.donorReceipt?.path ?? '';
  const donorReceiptBytes = donorExists && SAFE_PATH.test(donorReceiptPath)
    ? safeGit(['show', `${donor.acceptedTip}:${donorReceiptPath}`], null)
    : null;
  const currentDonorReceiptBytes = safeWorkspaceBytes(donorReceiptPath);
  const donorReceipt = Object.freeze({
    gitBlob: donorBlobs?.get(donorReceiptPath) ?? null,
    donorSha256: donorReceiptBytes === null ? null : digest(donorReceiptBytes),
    currentSha256: currentDonorReceiptBytes === null ? null : digest(currentDonorReceiptBytes),
    terminalAtDonor: donorReceiptBytes?.includes(Buffer.from(donor?.donorReceipt?.terminalNeedle ?? '')) === true,
    terminalAtHead: currentDonorReceiptBytes?.includes(Buffer.from(donor?.donorReceipt?.terminalNeedle ?? '')) === true,
  });
  const donorReceiptPassed = donorReceipt.gitBlob === donor?.donorReceipt?.gitBlob
    && donorReceipt.donorSha256 === donor?.donorReceipt?.sha256
    && donorReceipt.currentSha256 === donor?.donorReceipt?.sha256
    && donorReceipt.terminalAtDonor && donorReceipt.terminalAtHead;

  const integrationReceiptCommit = donor?.integrationReceipt?.commit ?? '';
  const integrationReceiptPath = donor?.integrationReceipt?.path ?? '';
  const integrationReceiptCommitExists = FULL_SHA.test(integrationReceiptCommit)
    && gitExitZero(['cat-file', '-e', `${integrationReceiptCommit}^{commit}`]);
  const integrationReceiptReachable = integrationReceiptCommitExists
    && gitExitZero(['merge-base', '--is-ancestor', integrationReceiptCommit, 'HEAD']);
  const integrationReceiptBlobs = integrationReceiptCommitExists ? gitTreeBlobs(integrationReceiptCommit) : null;
  const integrationReceiptBytes = integrationReceiptCommitExists && SAFE_PATH.test(integrationReceiptPath)
    ? safeGit(['show', `${integrationReceiptCommit}:${integrationReceiptPath}`], null)
    : null;
  const currentIntegrationReceiptBytes = safeWorkspaceBytes(integrationReceiptPath);
  const integrationReceipt = Object.freeze({
    commitExists: integrationReceiptCommitExists,
    reachable: integrationReceiptReachable,
    gitBlob: integrationReceiptBlobs?.get(integrationReceiptPath) ?? null,
    headBlob: headBlobs?.get(integrationReceiptPath) ?? null,
    committedSha256: integrationReceiptBytes === null ? null : digest(integrationReceiptBytes),
    currentSha256: currentIntegrationReceiptBytes === null ? null : digest(currentIntegrationReceiptBytes),
    statusAtCommit: integrationReceiptBytes?.includes(Buffer.from(donor?.integrationReceipt?.statusNeedle ?? '')) === true,
    statusAtHead: currentIntegrationReceiptBytes?.includes(Buffer.from(donor?.integrationReceipt?.statusNeedle ?? '')) === true,
  });
  const integrationReceiptPassed = integrationReceipt.commitExists && integrationReceipt.reachable
    && integrationReceipt.gitBlob === donor?.integrationReceipt?.gitBlob
    && integrationReceipt.headBlob === donor?.integrationReceipt?.gitBlob
    && integrationReceipt.committedSha256 === donor?.integrationReceipt?.sha256
    && integrationReceipt.currentSha256 === donor?.integrationReceipt?.sha256
    && integrationReceipt.statusAtCommit && integrationReceipt.statusAtHead;

  const requiredAncestry = (Array.isArray(donor?.requiredAncestry) ? donor.requiredAncestry : []).map((entry) => Object.freeze({
    ...entry,
    passed: FULL_SHA.test(entry?.ancestor ?? '') && FULL_SHA.test(entry?.descendant ?? '')
      && gitExitZero(['merge-base', '--is-ancestor', entry.ancestor, entry.descendant]),
  }));
  const requiredObjects = (Array.isArray(donor?.requiredObjects) ? donor.requiredObjects : []).map((object) => Object.freeze({
    object,
    passed: FULL_SHA.test(object ?? '') && gitExitZero(['cat-file', '-e', `${object}^{commit}`]),
  }));
  const mergeShapePassed = mergeParents.length === 2
    && exactOrderedMembers(mergeParents, donor?.mergeParents ?? [])
    && mergeParents[1] === donor?.acceptedTip;
  const pathSetPassed = paths !== null
    && paths.length === donor?.deltaPathCount
    && pathSetDigest(paths) === donor?.deltaPathSetSha256;
  const diffCheckPassed = mergeExists && gitExitZero(['diff', '--check', `${donor.mergeCommit}^1`, donor.mergeCommit, '--']);
  const passed = baseExists && donorExists && mergeExists
    && donorTree === donor?.donorTree && mergeTree === donor?.mergeTree
    && mergeShapePassed && donorMerged && mergeReachable && pathSetPassed
    && blobResults.length === donor?.deltaPathCount && blobResults.every((entry) => entry.passed)
    && replacementRowsValid
    && postIntegrationReplacements.length === replacementRows.length
    && postIntegrationReplacements.every((entry) => entry.passed)
    && donorReceiptPassed && integrationReceiptPassed && diffCheckPassed
    && requiredAncestry.every((entry) => entry.passed)
    && requiredObjects.every((entry) => entry.passed);
  return Object.freeze({
    id: donor?.id ?? null,
    baseExists,
    donorExists,
    mergeExists,
    donorTree,
    mergeTree,
    mergeParents: Object.freeze(mergeParents),
    donorMerged,
    mergeReachable,
    pathCount: paths?.length ?? null,
    pathSetSha256: paths === null ? null : pathSetDigest(paths),
    pathSetPassed,
    blobsChecked: blobResults.length,
    blobMismatches: Object.freeze(blobResults.filter((entry) => !entry.passed)),
    donorIdenticalHeadBlobs: blobResults.filter((entry) => entry.headDisposition === 'DONOR_IDENTICAL').length,
    postIntegrationReplacements: Object.freeze(postIntegrationReplacements),
    donorReceipt,
    donorReceiptPassed,
    integrationReceipt,
    integrationReceiptPassed,
    requiredAncestry: Object.freeze(requiredAncestry),
    requiredObjects: Object.freeze(requiredObjects),
    diffCheckPassed,
    passed,
  });
}

export function verifyProductAssuranceDonors(document) {
  const validation = validateProductAssuranceManifest(document);
  if (!validation.passed) return Object.freeze({ validation, donors: Object.freeze([]), passed: false });
  const donors = document.donors.map((donor) => verifyProductAssuranceDonor(donor));
  const mergeCutBlobCount = donors.reduce((total, donor) => total + donor.blobsChecked, 0);
  const donorIdenticalHeadBlobCount = donors.reduce((total, donor) => total + donor.donorIdenticalHeadBlobs, 0);
  const postIntegrationReplacements = donors.flatMap((donor) => donor.postIntegrationReplacements);
  return Object.freeze({
    validation,
    donors: Object.freeze(donors),
    mergeCutBlobCount,
    donorIdenticalHeadBlobCount,
    postIntegrationReplacementCount: postIntegrationReplacements.length,
    postIntegrationReplacements: Object.freeze(postIntegrationReplacements),
    passed: donors.length === PRODUCT_ASSURANCE_DONOR_IDS.length
      && donors.every((donor) => donor.passed)
      && mergeCutBlobCount === 193
      && donorIdenticalHeadBlobCount === 186
      && postIntegrationReplacements.length === 7
      && postIntegrationReplacements.every((entry) => entry.passed),
  });
}

export function verifyProductAssuranceOperationReport(document, report) {
  const expected = document?.operationScan;
  const checks = Object.freeze({
    manifestValid: validateProductAssuranceManifest(document).passed,
    schemaVersion: report?.schemaVersion === expected?.schemaVersion,
    scannedRoot: report?.scannedRoot === 'server/src',
    filesScanned: report?.filesScanned === expected?.filesScanned,
    discovered: report?.discovered === expected?.discovered,
    covered: report?.covered === expected?.covered,
    uncovered: report?.uncovered === expected?.uncovered && report?.uncovered === 0,
    conservation: report?.discovered === report?.covered + report?.uncovered,
    sites: Array.isArray(report?.sites) && report.sites.length === report?.discovered,
    uncoveredSites: Array.isArray(report?.uncoveredSites) && report.uncoveredSites.length === 0,
  });
  return Object.freeze({ checks, passed: Object.values(checks).every(Boolean) });
}
