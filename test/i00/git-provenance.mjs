import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const FULL_SHA = /^[a-f0-9]{40}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const SAFE_PATH = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._/-]+$/;
const LIVING_DIRECTOR_PATHS = Object.freeze(['QL_DIRECTOR_STATE.md', 'QL_PARALLEL_DAG.md']);
const OWNER_DIRECTIVE_PATHS = Object.freeze([
  'I00_PRODUCT_ASSEMBLY_CONTROL_ROOM_AND_LIVE_BRINGUP.md',
  'IP_RUNTIME.md',
  'IP_CONTROL.md',
  'IP_OPS.md',
  'IP_PROOF.md',
]);

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

export function verifyLivingDirectorInputAcceptance(document) {
  const structuralChecks = Object.freeze({
    schemaVersion: document?.schemaVersion === 'I00_LIVING_DIRECTOR_INPUT_ACCEPTANCE_V1',
    ruling: document?.ruling === 'D-LAUNCH-7',
    mode: document?.mode === 'LATEST_CURRENT_MAIN_TOUCH',
    sourceRef: typeof document?.sourceRef === 'string' && document.sourceRef === 'current-main',
    rulingCommit: FULL_SHA.test(document?.rulingCommit ?? ''),
    historicalPacketPinsPreserved: document?.historicalPacketPinsPreserved === true,
    finalRealAdapterRepinRequired: document?.finalRealAdapterRepinRequired === true,
    assemblyCopiesRejected: document?.acceptAssemblyWorkingTreeCopies === false,
    livingPathSet: Array.isArray(document?.livingDirectorInputs)
      && sameMembers(document.livingDirectorInputs.map((entry) => entry.path), LIVING_DIRECTOR_PATHS),
    directivePathSet: Array.isArray(document?.ownerDirectives)
      && sameMembers(document.ownerDirectives.map((entry) => entry.path), OWNER_DIRECTIVE_PATHS),
  });
  const structurePassed = Object.values(structuralChecks).every(Boolean);
  const sourceTip = structuralChecks.sourceRef ? safeGit(['rev-parse', document.sourceRef])?.trim() ?? null : null;
  const rulingExists = structuralChecks.rulingCommit && gitExitZero(['cat-file', '-e', `${document.rulingCommit}^{commit}`]);
  const rulingReachable = rulingExists && sourceTip !== null
    && gitExitZero(['merge-base', '--is-ancestor', document.rulingCommit, sourceTip]);
  const rulingText = rulingExists ? safeGit(['show', `${document.rulingCommit}:QL_DIRECTOR_STATE.md`]) : null;
  const rulingVerified = rulingReachable && rulingText?.includes('D-LAUNCH-7') === true
    && rulingText.includes('LIVING director-owned state') && rulingText.includes('latest commit of current-main touching them');

  const livingResults = (Array.isArray(document?.livingDirectorInputs) ? document.livingDirectorInputs : []).map((entry) => {
    const safePath = LIVING_DIRECTOR_PATHS.includes(entry.path) && SAFE_PATH.test(entry.path);
    const historicalPinValid = SHA256.test(entry.historicalPacketSha256 ?? '');
    const observedFieldsValid = FULL_SHA.test(entry.observedLatestCommit ?? '')
      && FULL_SHA.test(entry.observedGitBlob ?? '') && SHA256.test(entry.observedSha256 ?? '');
    const latestCommit = safePath && sourceTip !== null
      ? safeGit(['log', '-1', '--format=%H', document.sourceRef, '--', entry.path])?.trim() || null
      : null;
    const latestCommitReachable = latestCommit !== null && sourceTip !== null
      && gitExitZero(['merge-base', '--is-ancestor', latestCommit, sourceTip]);
    const observedGitBlob = latestCommit !== null && safePath
      ? safeGit(['rev-parse', `${latestCommit}:${entry.path}`])?.trim() || null
      : null;
    const bytes = latestCommit !== null && safePath ? safeGit(['show', `${latestCommit}:${entry.path}`], null) : null;
    const observedSha256 = bytes === null ? null : digest(bytes);
    const observationMatches = observedFieldsValid && latestCommit === entry.observedLatestCommit
      && observedGitBlob === entry.observedGitBlob && observedSha256 === entry.observedSha256;
    return Object.freeze({
      path: entry.path,
      historicalPacketSha256: entry.historicalPacketSha256,
      latestCommit,
      observedGitBlob,
      observedSha256,
      safePath,
      historicalPinValid,
      latestCommitReachable,
      observationMatches,
      passed: structurePassed && rulingVerified && safePath && historicalPinValid
        && latestCommitReachable && observationMatches,
    });
  });

  const directiveResults = (Array.isArray(document?.ownerDirectives) ? document.ownerDirectives : []).map((entry) => {
    const safePath = OWNER_DIRECTIVE_PATHS.includes(entry.path) && SAFE_PATH.test(entry.path);
    const expectedSha256Valid = SHA256.test(entry.sha256 ?? '');
    const absolute = safePath ? path.join(ROOT, entry.path) : null;
    let observedSha256 = null;
    try {
      observedSha256 = absolute === null ? null : digest(readFileSync(absolute));
    } catch {
      observedSha256 = null;
    }
    return Object.freeze({
      path: entry.path,
      expectedSha256: entry.sha256,
      observedSha256,
      safePath,
      passed: structurePassed && safePath && expectedSha256Valid && observedSha256 === entry.sha256,
    });
  });

  return Object.freeze({
    schemaVersion: document?.schemaVersion ?? null,
    ruling: document?.ruling ?? null,
    mode: document?.mode ?? null,
    sourceRef: document?.sourceRef ?? null,
    sourceTip,
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
