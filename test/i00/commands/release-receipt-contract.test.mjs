import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const ROOT = resolve(import.meta.dirname, '../../..');

test('release receipt validation rejects obsolete label-only success before evidence binding', () => {
  const temp = mkdtempSync(resolve(tmpdir(), 'i00-command-release-'));
  try {
    const receipt = resolve(temp, 'tested.json');
    writeFileSync(receipt, `${JSON.stringify({
      schemaVersion: 1,
      status: 'PASS',
      testedSha: 'a'.repeat(40),
      gitDirty: false,
      commands: [
        { command: 'npm test', exitCode: 0 },
        { command: 'npm run test:all', exitCode: 0 },
        { command: 'bash ops/tests/i00/run-all.sh', exitCode: 0 },
      ],
      completedAtUtc: '2026-07-14T00:00:00Z',
      sourceTree: 'SIMULATION_FIXTURE',
      packageLockSha256: 'b'.repeat(64),
      runtimeDepsDigestSha256: 'c'.repeat(64),
      serverDistDigestSha256: 'd'.repeat(64),
      webDistDigestSha256: 'e'.repeat(64),
    })}\n`);
    const moduleUrl = pathToFileURL(resolve(ROOT, 'ops/i00/complete-acceptance-receipt.mjs')).href;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
      import { validateCompleteAcceptanceReceipt } from ${JSON.stringify(moduleUrl)};
      validateCompleteAcceptanceReceipt({
        receiptPath: process.argv[1],
        expectedSha: ${JSON.stringify('a'.repeat(40))},
        expectedTree: ${JSON.stringify('b'.repeat(40))},
        evidenceRoot: process.argv[2],
        verifyReferencedArtifacts: true,
      });
    `, receipt, temp,
    ], { cwd: ROOT, encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /complete local-acceptance receipt\.truthClass is required/);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});
