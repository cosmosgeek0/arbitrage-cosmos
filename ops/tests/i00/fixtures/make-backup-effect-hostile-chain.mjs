#!/usr/bin/env node
import { createHash } from 'node:crypto';
import {
  lstatSync,
  readFileSync,
  realpathSync,
} from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const [
  contractInput,
  rootInput,
  baseRiskInput,
  scenario,
  scriptInput,
] = process.argv.slice(2);
if (!contractInput || !rootInput || !baseRiskInput || !scriptInput
    || !/^[a-z0-9-]{1,64}$/u.test(scenario ?? '')) {
  process.exit(2);
}
const contractPath = resolve(contractInput);
const root = resolve(rootInput);
const baseRiskPath = resolve(baseRiskInput);
const scriptPath = resolve(scriptInput);
if (root !== rootInput || baseRiskPath !== baseRiskInput
    || scriptPath !== scriptInput) {
  process.exit(2);
}

const {
  buildAuthorizationConsumption,
  buildTestDeploymentActionPreview,
  buildTestDeploymentRiskVersion,
  sha256Bytes,
  writeExactPrivateJson,
} = await import(pathToFileURL(contractPath).href);

const baseRisk = JSON.parse(readFileSync(baseRiskPath, 'utf8'));
if (baseRisk.binding?.actionClass !== 'BACKUP_CREATE'
    || baseRisk.artifactPolicy?.rootMode !== 'TEST'
    || baseRisk.artifactPolicy?.proofRoot !== root) {
  process.exit(2);
}
const scriptStat = lstatSync(scriptPath, { bigint: true });
if (!scriptStat.isFile() || scriptStat.isSymbolicLink()
    || scriptStat.nlink !== 1n || realpathSync(scriptPath) !== scriptPath
    || (scriptStat.mode & 0o111n) === 0n || (scriptStat.mode & 0o022n) !== 0n) {
  process.exit(2);
}
const scriptIdentity = [
  `device=${scriptStat.dev}`,
  `inode=${scriptStat.ino}`,
  `mode=${scriptStat.mode.toString(8)}`,
  `size=${scriptStat.size}`,
  `mtimeNs=${scriptStat.mtimeNs}`,
  `ctimeNs=${scriptStat.ctimeNs}`,
].join(',');
const endpoints = [...baseRisk.action.allowedEndpoints];
const replaceEndpoint = (prefix, value) => {
  const marker = `${prefix}:`;
  const matches = endpoints
    .map((endpoint, index) => ({ endpoint, index }))
    .filter(({ endpoint }) => endpoint.startsWith(marker));
  if (matches.length !== 1) process.exit(2);
  endpoints[matches[0].index] = `${marker}${value}`;
};
replaceEndpoint('effect-script-path', scriptPath);
replaceEndpoint(
  'effect-script-sha256',
  createHash('sha256').update(readFileSync(scriptPath)).digest('hex'),
);
replaceEndpoint('effect-script-identity', scriptIdentity);
replaceEndpoint(
  'effect-start-evidence',
  resolve(root, 'effects', `${scenario}.start.json`),
);
replaceEndpoint(
  'effect-finish-evidence',
  resolve(root, 'effects', `${scenario}.terminal.json`),
);
endpoints.sort();

const second = Math.floor(Date.now() / 1_000) * 1_000;
const issuedAtUtc = new Date(second - 60_000)
  .toISOString().replace('.000Z', 'Z');
const startsAtUtc = new Date(second - 30_000)
  .toISOString().replace('.000Z', 'Z');
const consumedAtUtc = new Date(second)
  .toISOString().replace('.000Z', 'Z');
const evidenceValidUntilUtc = new Date(second + 3_480_000)
  .toISOString().replace('.000Z', 'Z');
const expiresAtUtc = new Date(second + 3_500_000)
  .toISOString().replace('.000Z', 'Z');
const receiptRoot = resolve(root, 'receipts');
const request = {
  schemaVersion: 1,
  kind: 'DEPLOYMENT_ACTION_REQUEST',
  status: 'REQUESTED_NOT_AUTHORIZED',
  authorizationId: `df32-linux-backup-hostile-${scenario}`,
  operator: 'isolated-linux-operator',
  approver: 'isolated-linux-proof-owner',
  approvalReference: `isolated-linux-hostile-${scenario}`,
  startsAtUtc,
  expiresAtUtc,
  receiptTargets: {
    result: resolve(receiptRoot, `${scenario}.result.json`),
    reconciliation: resolve(receiptRoot, `${scenario}.reconciliation.json`),
  },
};
const risk = buildTestDeploymentRiskVersion(request, {
  actionClass: 'BACKUP_CREATE',
  deployedSha: baseRisk.binding.deployedSha,
  configVersion: baseRisk.binding.configVersion,
  account: baseRisk.binding.account,
  environment: baseRisk.binding.environment,
  host: baseRisk.binding.host,
  allowedEndpoints: endpoints,
  evidenceProvenance: baseRisk.evidenceProvenance,
  enforcementProvenance: baseRisk.enforcementProvenance,
}, {
  issuedAtUtc,
  evidenceValidUntilUtc,
  artifactPolicy: baseRisk.artifactPolicy,
  nonce: createHash('sha256').update(`df32:${scenario}`).digest('hex'),
  provenanceMode: 'TEST_FIXTURE_INJECTED',
});
const authorizationRoot = resolve(root, 'authorization');
const riskEvidence = writeExactPrivateJson(
  resolve(authorizationRoot, `${scenario}.risk.json`),
  risk,
  'hostile backup deployment risk',
);
const preview = buildTestDeploymentActionPreview(
  risk,
  riskEvidence.sha256,
  resolve(root, 'consumption'),
);
const previewEvidence = writeExactPrivateJson(
  resolve(authorizationRoot, `${scenario}.preview.json`),
  preview,
  'hostile backup action preview',
);
const authorization = {
  schemaVersion: 2,
  authorizationId: request.authorizationId,
  operator: request.operator,
  status: 'APPROVED',
  actionClasses: ['BACKUP_CREATE'],
  scope: preview.action.scope,
  deployedSha: risk.binding.deployedSha,
  configVersion: risk.binding.configVersion,
  riskVersion: risk.riskVersion,
  nonce: risk.binding.nonce,
  serverPreviewDigest: preview.serverPreviewDigest,
  account: risk.binding.account,
  environment: risk.binding.environment,
  host: risk.binding.host,
  issuedAtUtc: risk.authorizationWindow.issuedAtUtc,
  startsAtUtc: risk.authorizationWindow.startsAtUtc,
  expiresAtUtc: risk.authorizationWindow.expiresAtUtc,
  allowedCommands: [preview.action.command],
  allowedEndpoints: preview.action.allowedEndpoints,
  allowedProducts: preview.action.allowedProducts,
  allowedCredentials: preview.action.allowedCredentials,
  preconditions: preview.action.preconditions,
  maximumEffect: preview.action.maximumEffect,
  rollback: preview.action.rollback,
  recovery: preview.action.recovery,
  ownerApproval: {
    approver: request.approver,
    approvedAtUtc: issuedAtUtc,
    reference: request.approvalReference,
  },
  receiptTargets: preview.action.receiptTargets,
};
const authorizationEvidence = writeExactPrivateJson(
  resolve(authorizationRoot, `${scenario}.authorization.json`),
  authorization,
  'hostile backup authorization',
);
const consumption = buildAuthorizationConsumption({
  authorization,
  authorizationSha256: authorizationEvidence.sha256,
  risk,
  riskDocumentSha256: riskEvidence.sha256,
  preview,
  previewDocumentSha256: previewEvidence.sha256,
  consumedAtUtc,
});
const consumptionEvidence = writeExactPrivateJson(
  resolve(root, 'consumption', `${consumption.claimKey}.json`),
  consumption,
  'hostile backup authorization consumption',
);

process.stdout.write(`${JSON.stringify({
  authorization: authorizationEvidence.absolute,
  consumption: consumptionEvidence.absolute,
  effectFinish: resolve(root, 'effects', `${scenario}.terminal.json`),
  effectStart: resolve(root, 'effects', `${scenario}.start.json`),
  preview: previewEvidence.absolute,
  reconciliation: request.receiptTargets.reconciliation,
  result: request.receiptTargets.result,
  risk: riskEvidence.absolute,
})}\n`);
