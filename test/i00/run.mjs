#!/usr/bin/env node
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { run } from 'node:test';
import { spec } from 'node:test/reporters';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const testDirectory = path.join(root, 'server/test/i00Acceptance');
const files = readdirSync(testDirectory)
  .filter((name) => name.endsWith('.test.mjs'))
  .sort()
  .map((name) => path.join(testDirectory, name));

let failed = false;
const stream = run({ files, concurrency: 1, cwd: root });
stream.on('test:fail', () => { failed = true; });
await pipeline(stream, spec(), process.stdout);
process.exitCode = failed ? 1 : 0;
