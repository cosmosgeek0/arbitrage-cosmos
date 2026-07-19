#!/usr/bin/env node
import { fail, parseArgs } from '../lib.mjs';

const args = parseArgs(process.argv.slice(2));
if (!args.version) fail('--version is required');
const match = /^(\d+)\.(\d+)\.(\d+)(?:\D|$)/.exec(args.version);
if (!match) fail('SQLite version is not parseable');
const version = match.slice(1).map(Number);
const atLeast = (minimum) => {
  for (let index = 0; index < 3; index += 1) {
    if (version[index] > minimum[index]) return true;
    if (version[index] < minimum[index]) return false;
  }
  return true;
};
const safe = atLeast([3, 51, 3])
  || (version[0] === 3 && version[1] === 50 && version[2] >= 7)
  || (version[0] === 3 && version[1] === 44 && version[2] >= 6);
// F-109: this is a BRANCH allowlist, not a floor - state the rule and the
// trap, or an operator on Ubuntu 24.04's 3.45.1 will reasonably conclude a
// "newer" version is fine.
if (!safe) fail(`SQLite ${version.join('.')} is on a branch without the WAL-reset fix; accepted: >=3.51.3, or the 3.50.x branch from 3.50.7, or the 3.44.x branch from 3.44.6. NOTE: 3.45.x through 3.49.x are NOT accepted even though they are newer than 3.44.6`);
process.stdout.write(`${JSON.stringify({ status: 'SQLITE_WAL_VERSION_SAFE', version: version.join('.') })}\n`);
