#!/usr/bin/env node
import {
  readBoundJsonInput,
  recheckBoundJsonInput,
} from '../bound-json-input.mjs';
import {
  fail, hasPlaceholder, isUtc, parseArgs, requireKeys,
} from '../lib.mjs';

const args = parseArgs(process.argv.slice(2), new Set(['simulation-clock']));
if (!args.input || !args['max-age-sec'] || !args['expected-hostname'] || !args['expected-account']) fail('--input, --max-age-sec, --expected-hostname, and --expected-account are required');
if (args['simulation-clock'] !== true && args.now) fail('--now is accepted only with --simulation-clock');
if (args['simulation-clock'] === true && !isUtc(args.now)) fail('simulation clock requires exact --now UTC seconds');
const effectiveNow = args['simulation-clock'] === true ? args.now : new Date().toISOString();
const inputBinding = readBoundJsonInput(
  args.input,
  'Cloudflare boundary readback',
);
const value = inputBinding.document;
requireKeys(value, [
  'source', 'account', 'hostname', 'tunnelId', 'accessApplicationId', 'originHost', 'evidenceSha256',
  'tunnelState', 'directOriginReachable', 'unauthenticatedAccessStatus',
  'authenticatedAccessStatus', 'originRejectedMissingJwt', 'originValidatedJwt',
  'stableEgressRequired', 'expectedEgressIp', 'observedEgressIp', 'observedAtUtc',
], 'Cloudflare boundary readback');
if (value.source !== 'CLOUDFLARE_OWNER_READBACK') fail('Cloudflare proof is not owner readback');
if (value.account !== args['expected-account'] || value.hostname !== args['expected-hostname']) fail('Cloudflare readback target does not match the expected account/hostname');
for (const field of ['tunnelId', 'accessApplicationId', 'originHost']) {
  if (typeof value[field] !== 'string' || value[field].length < 3 || hasPlaceholder(value[field])) fail(`${field} is unresolved`);
}
if (!/^[0-9a-f]{64}$/.test(value.evidenceSha256)) fail('Cloudflare readback evidence hash is invalid');
if (hasPlaceholder(value.hostname) || !/^[a-z0-9.-]+$/.test(value.hostname)) fail('Cloudflare hostname is unresolved');
if (value.tunnelState !== 'HEALTHY') fail(`tunnelState=${value.tunnelState}`);
if (value.directOriginReachable !== false) fail('direct origin must not be internet reachable');
if (![302, 401, 403].includes(value.unauthenticatedAccessStatus)) fail('unauthenticated Access request did not fail closed');
if (value.authenticatedAccessStatus !== 200) fail('authenticated Access request did not reach the origin');
if (value.originRejectedMissingJwt !== true || value.originValidatedJwt !== true) fail('origin-side Access JWT validation is not proven');
if (value.stableEgressRequired === true && (!value.expectedEgressIp || value.expectedEgressIp !== value.observedEgressIp)) {
  fail('stable egress readback does not match the approved IP');
}
if (!isUtc(value.observedAtUtc)) fail('Cloudflare readback timestamp is invalid');
const ageMs = Date.parse(effectiveNow) - Date.parse(value.observedAtUtc);
const maxAgeMs = Number(args['max-age-sec']) * 1000;
if (!Number.isFinite(ageMs) || !Number.isFinite(maxAgeMs) || maxAgeMs <= 0 || ageMs < 0 || ageMs > maxAgeMs) fail('Cloudflare readback is stale or future-dated');
recheckBoundJsonInput(inputBinding, 'Cloudflare boundary readback');
process.stdout.write(`${JSON.stringify({ status: 'CLOUDFLARE_BOUNDARY_VERIFIED', hostname: value.hostname })}\n`);
