#!/usr/bin/env node
import { lstatSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fail, parseArgs, readJson, sha256File } from '../lib.mjs';
import { loadL15AmendmentContract, verifyEffectiveL15Root } from '../l15-amendment.mjs';

const EXPECTED_DONOR_CONTRACT_SHA256 = '078cc2a3d8bc79026f1de6985284856794e53ba34ffd7fda5d1140e46e31a1b3';
const EXPECTED_AMENDMENT_CONTRACT_SHA256 = '187ef4af88744c252b95f2350b086f6321de590dea57732c1fede03a2ab6f7b9';
const args = parseArgs(process.argv.slice(2), new Set(['require-immutable', 'accepted-only']));
if (!args.root) fail('--root is required');
const here = dirname(fileURLToPath(import.meta.url));
const contractPath = resolve(args.contract ?? resolve(here, '../donor-contract.json'));
const amendmentPath = resolve(
  args['amendment-contract'] ?? resolve(dirname(contractPath), 'l15-amendment-contract.json'),
);
if (sha256File(contractPath) !== EXPECTED_DONOR_CONTRACT_SHA256) {
  fail('embedded donor contract does not match the exact accepted contract');
}
const contract = readJson(contractPath, 'donor contract');
const loadedAmendment = loadL15AmendmentContract(
  amendmentPath,
  EXPECTED_AMENDMENT_CONTRACT_SHA256,
);
const root = resolve(args.root);

function verifyAcceptedOnlyRoot() {
  let rootStat;
  try {
    rootStat = lstatSync(root);
  } catch {
    fail('executed donor root does not exist');
  }
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    fail('executed donor root must be a real directory');
  }
  if (args['require-immutable'] === true && (rootStat.mode & 0o222) !== 0) {
    fail('executed donor root is mutable');
  }
  for (const [relative, expected] of Object.entries(contract.criticalFiles ?? {})) {
    if (!/^[A-Za-z0-9._/-]+$/.test(relative) || relative.startsWith('/')
        || relative.split('/').includes('..')) {
      fail('embedded donor contract contains an unsafe critical path');
    }
    const path = resolve(root, relative);
    if (args['require-immutable'] === true) {
      let directory = root;
      for (const part of relative.split('/').slice(0, -1)) {
        directory = resolve(directory, part);
        const directoryStat = lstatSync(directory);
        if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()
            || (directoryStat.mode & 0o222) !== 0) {
          fail(`executed donor directory is mutable or unsafe: ${relative}`);
        }
      }
    }
    let stat;
    try {
      stat = lstatSync(path);
    } catch {
      fail(`executed donor file does not match accepted Git: ${relative}`);
    }
    if (!stat.isFile() || stat.isSymbolicLink() || sha256File(path) !== expected) {
      fail(`executed donor file does not match accepted Git: ${relative}`);
    }
    if (args['require-immutable'] === true && (stat.mode & 0o222) !== 0) {
      fail(`executed donor file is mutable: ${relative}`);
    }
  }
  return {
    status: 'EXECUTED_DONOR_ROOT_VERIFIED',
    root,
    acceptedCommit: contract.acceptedCommit,
    contractSha256: EXPECTED_DONOR_CONTRACT_SHA256,
    amendmentContractSha256: EXPECTED_AMENDMENT_CONTRACT_SHA256,
    immutableCriticalFiles: args['require-immutable'] === true,
  };
}

const result = args['accepted-only'] === true
  ? verifyAcceptedOnlyRoot()
  : {
      status: 'EXECUTED_EFFECTIVE_L15_ROOT_VERIFIED',
      ...verifyEffectiveL15Root({
        root,
        loadedContract: loadedAmendment,
        requireImmutable: args['require-immutable'] === true,
      }),
    };

process.stdout.write(`${JSON.stringify(result)}\n`);
