#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const [mode, contractPath, rootInput, actionClass, output] = process.argv.slice(2);
if (!['request', 'authorization'].includes(mode)
    || !contractPath || !rootInput || !actionClass || !output) process.exit(2);
const root = resolve(rootInput);
if (!/(?:df32|ip-ops-i00)/u.test(root)) process.exit(2);
const { canonicalJsonBytes } = await import(pathToFileURL(resolve(contractPath)).href);

if (mode === 'request') {
  const runtimeFocused = process.env.DF32_RUNTIME_FOCUSED === '1';
  const currentSecond = Math.floor(Date.now() / 1_000) * 1_000;
  const startsAtUtc = runtimeFocused
    ? new Date(currentSecond - 1_000).toISOString().replace('.000Z', 'Z')
    : '2026-07-23T00:04:00Z';
  const expiresAtUtc = runtimeFocused
    ? new Date(currentSecond + 3_500_000).toISOString().replace('.000Z', 'Z')
    : '2026-07-23T00:20:00Z';
  writeFileSync(output, canonicalJsonBytes({
    schemaVersion: 1,
    kind: 'DEPLOYMENT_ACTION_REQUEST',
    status: 'REQUESTED_NOT_AUTHORIZED',
    authorizationId: `isolated-staging-${actionClass.toLowerCase().replaceAll('_', '-')}-001`,
    operator: 'isolated-staging-operator',
    approver: 'isolated-staging-owner-fixture',
    approvalReference: 'isolated-staging-fixture-only',
    startsAtUtc,
    expiresAtUtc,
    receiptTargets: {
      result: join(root, 'receipts', `${actionClass}.result.json`),
      reconciliation: join(root, 'receipts', `${actionClass}.reconciliation.json`),
    },
  }), { mode: 0o600 });
  process.exit(0);
}

const risk = JSON.parse(readFileSync(
  join(root, 'authorization', `${actionClass}.risk.json`),
  'utf8',
));
const preview = JSON.parse(readFileSync(
  join(root, 'authorization', `${actionClass}.preview.json`),
  'utf8',
));
const action = preview.action;
const binding = preview.binding;
const window = preview.authorizationWindow;
writeFileSync(output, canonicalJsonBytes({
  schemaVersion: 2,
  authorizationId: binding.authorizationId,
  operator: binding.operator,
  status: 'APPROVED',
  actionClasses: [binding.actionClass],
  scope: action.scope,
  deployedSha: binding.deployedSha,
  configVersion: binding.configVersion,
  riskVersion: binding.riskVersion,
  nonce: binding.nonce,
  serverPreviewDigest: preview.serverPreviewDigest,
  account: binding.account,
  environment: binding.environment,
  host: binding.host,
  issuedAtUtc: window.issuedAtUtc,
  startsAtUtc: window.startsAtUtc,
  expiresAtUtc: window.expiresAtUtc,
  allowedCommands: [action.command],
  allowedEndpoints: action.allowedEndpoints,
  allowedProducts: action.allowedProducts,
  allowedCredentials: action.allowedCredentials,
  preconditions: action.preconditions,
  maximumEffect: action.maximumEffect,
  rollback: action.rollback,
  recovery: action.recovery,
  ownerApproval: {
    approver: 'isolated-staging-owner-fixture',
    approvedAtUtc: window.issuedAtUtc,
    reference: 'isolated-staging-fixture-only',
  },
  receiptTargets: action.receiptTargets,
}), { mode: 0o600 });
