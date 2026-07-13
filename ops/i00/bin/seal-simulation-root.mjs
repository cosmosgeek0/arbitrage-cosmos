#!/usr/bin/env node
import { fail, parseArgs } from '../lib.mjs';
import { sealSimulationCommands } from '../simulation-safety.mjs';

const args = parseArgs(process.argv.slice(2));
if (!args.root || !args.commands) fail('--root and comma-separated --commands are required');
try {
  const manifest = sealSimulationCommands(args.root, args.commands.split(',').filter(Boolean));
  process.stdout.write(`${manifest}\n`);
} catch (error) {
  fail(error.message);
}
