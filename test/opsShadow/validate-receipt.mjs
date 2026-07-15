#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  REPO_ROOT,
  validateReceiptGit,
  validateReceiptShape,
} from './contract.mjs';

const args = process.argv.slice(2);
let receiptPath = null;
let sealedAt = null;
for (let index = 0; index < args.length; index += 1) {
  if (args[index] === '--receipt') receiptPath = args[++index];
  else if (args[index] === '--sealed-at') sealedAt = args[++index];
  else {
    process.stderr.write(`unknown argument: ${args[index]}\n`);
    process.exit(2);
  }
}
if (!receiptPath) {
  process.stderr.write('--receipt is required\n');
  process.exit(2);
}

let receipt;
try {
  receipt = JSON.parse(readFileSync(resolve(REPO_ROOT, receiptPath), 'utf8'));
} catch (error) {
  process.stderr.write(`${JSON.stringify({ status: 'OPS_SHADOW_RECEIPT_INVALID', issues: [{ code: 'RECEIPT_READ_FAILED', message: error.message }] })}\n`);
  process.exit(1);
}

const issues = [
  ...validateReceiptShape(receipt),
  ...validateReceiptGit(receipt, { sealedAt }),
];
if (issues.length > 0) {
  process.stderr.write(`${JSON.stringify({ status: 'OPS_SHADOW_RECEIPT_INVALID', issues }, null, 2)}\n`);
  process.exit(1);
}
process.stdout.write(`${JSON.stringify({
  status: 'OPS_SHADOW_RECEIPT_VALID',
  shadowStatus: receipt.shadowStatus,
  terminalState: receipt.terminalState,
  implementationCommitSha: receipt.implementationCommitSha,
  sealedAt: sealedAt ?? 'NOT_REQUESTED',
})}\n`);
