import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { BASE_SHA, ROOT } from './lib/constants.mjs';

function gitLines(...args) {
  const output = execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
  return output === '' ? [] : output.split('\n').filter(Boolean);
}

function listFiles(relativePath) {
  const output = [];
  for (const entry of readdirSync(path.join(ROOT, relativePath), { withFileTypes: true })) {
    const child = path.posix.join(relativePath, entry.name);
    if (entry.isDirectory()) output.push(...listFiles(child));
    else output.push(child);
  }
  return output.sort();
}

test('the complete base delta stays inside RUN-19 exclusive paths', () => {
  const changed = new Set([
    ...gitLines('diff', '--name-only', BASE_SHA),
    ...gitLines('ls-files', '--others', '--exclude-standard'),
  ]);
  assert(changed.size > 0);
  for (const file of changed) {
    assert(
      file.startsWith('fixtures/runbookShadow/') || file.startsWith('test/runbookShadow/'),
      `out-of-scope path ${file}`,
    );
  }
});

test('generated files are regular, dependency-free, and contain no ambient side effects', () => {
  const files = [...listFiles('fixtures/runbookShadow'), ...listFiles('test/runbookShadow')];
  for (const file of files) assert.equal(lstatSync(path.join(ROOT, file)).isSymbolicLink(), false, file);

  const executableSources = files.filter((file) => /\.mjs$/.test(file));
  for (const file of executableSources) {
    const source = readFileSync(path.join(ROOT, file), 'utf8');
    assert(!/--import\s+tsx|from\s+['"]tsx['"]|import\([^\n]*\.ts['"]\)/.test(source), file);
    assert(!/https?:\/\//.test(source), file);
    assert(!/AKIA[0-9A-Z]{16}|BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY|apiSecret\s*[:=]/i.test(source), file);
  }

  const runtimeFiles = executableSources.filter((file) => !file.endsWith('.test.mjs'));
  for (const file of runtimeFiles) {
    const source = readFileSync(path.join(ROOT, file), 'utf8');
    assert(!/node:child_process/.test(source), file);
    assert(!/\bprocess\.env\b|\bDate\.now\s*\(|\bMath\.random\s*\(|\bset(?:Timeout|Interval)\s*\(/.test(source), file);
  }
});
