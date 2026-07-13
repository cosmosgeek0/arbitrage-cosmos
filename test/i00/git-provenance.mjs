import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const FULL_SHA = /^[a-f0-9]{40}$/;
const SAFE_PATH = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._/-]+$/;

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
