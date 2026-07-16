#!/usr/bin/env node
import { fail, parseArgs } from '../lib.mjs';
import { verifySimulationCommand } from '../simulation-safety.mjs';

const args = parseArgs(process.argv.slice(2));
if (!args.root || !args.command) fail('--root and --command are required');
try {
  process.stdout.write(`${verifySimulationCommand(args.root, args.command)}\n`);
} catch (error) {
  fail(error.message);
}
