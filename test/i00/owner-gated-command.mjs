#!/usr/bin/env node

const CAPABILITIES = Object.freeze({
  PRIVATE_READ: 'PRIVATE_READ_AUTHORIZATION_REQUIRED',
  SIGNED_TEST: 'SIGNED_TEST_AUTHORIZATION_REQUIRED',
});

function writeResult(result, stream = process.stdout) {
  stream.write(`${JSON.stringify({
    schemaVersion: 'i00.command-status.v1',
    ...result,
    mutationPerformed: false,
  })}\n`);
}

const [capability, ...unexpected] = process.argv.slice(2);
if (!Object.hasOwn(CAPABILITIES, capability) || unexpected.length > 0) {
  writeResult({
    status: 'BLOCKED',
    capability: capability === undefined ? 'UNSPECIFIED' : 'UNSUPPORTED',
    reasonCode: 'INVALID_OWNER_GATED_COMMAND',
  }, process.stderr);
  process.exitCode = 1;
} else {
  writeResult({
    status: 'OWNER_GATED',
    capability,
    reasonCode: CAPABILITIES[capability],
  });
  process.exitCode = 2;
}
