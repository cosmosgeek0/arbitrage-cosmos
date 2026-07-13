#!/usr/bin/env node
import { fail, parseArgs } from '../lib.mjs';
import { isWithinSimulationRoot } from '../simulation-safety.mjs';

const args = parseArgs(process.argv.slice(2));
if (!args.root || !args.path) fail('--root and --path are required');
try {
  if (!isWithinSimulationRoot(args.root, args.path)) fail('path is outside the marked simulation root');
  process.stdout.write(`${args.path}\n`);
} catch (error) {
  fail(error.message);
}
