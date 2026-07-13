#!/usr/bin/env node
import { fail, parseArgs } from '../lib.mjs';
import { validateSimulationRoot } from '../simulation-safety.mjs';

const args = parseArgs(process.argv.slice(2));
if (!args.root) fail('--root is required');
try {
  process.stdout.write(`${validateSimulationRoot(args.root)}\n`);
} catch (error) {
  fail(error.message);
}
