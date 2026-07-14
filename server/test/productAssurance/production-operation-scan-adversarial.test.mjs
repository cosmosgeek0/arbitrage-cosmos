import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  OPERATION_KINDS,
  OPERATION_MAPPING_REGISTRY,
  REVIEWED_OPERATION_DISPOSITIONS,
  mapOperationSite,
  scanProductionOperations,
} from '../../../test/productAssurance/production-operation-scan.mjs';

function adversarialRepository() {
  const root = mkdtempSync(join(tmpdir(), 'ip-assurance-operation-scan-'));
  const sourceRoot = join(root, 'server', 'src');
  mkdirSync(sourceRoot, { recursive: true });
  writeFileSync(join(sourceRoot, 'adversarial.ts'), String.raw`
import httpDefault from 'node:http';
import { get as httpsGet, request as httpsRequest } from 'node:https';
import axiosAlias, { request as importedAxiosRequest } from 'axios';
import { SendCommandCommand, SSMClient } from '@aws-sdk/client-ssm';

declare const dynamicInit: RequestInit;
declare const dynamicMethod: string;
declare const hiddenOptions: RequestInit;
declare const command: unknown;

const fetchAlias = globalThis.fetch.bind(globalThis);
const httpAlias = httpDefault;
const requestAlias = httpAlias.request;
const api = axiosAlias.create({ baseURL: 'https://example.test' });
const ssm = new SSMClient({});
const awsAlias = ssm;
const sendAlias = awsAlias.send.bind(awsAlias);
const knownCommand = new SendCommandCommand({});

void fetch('https://example.test/dynamic-init', dynamicInit);
void fetch('https://example.test/dynamic-method', { method: dynamicMethod });
void fetch('https://example.test/spread-overridden', { ...hiddenOptions, method: 'GET' });
void fetchAlias('https://example.test/alias', { method: 'POST' });
void httpsRequest({ hostname: 'example.test', method: 'DELETE' });
void httpAlias.request({ hostname: 'example.test', method: dynamicMethod });
void requestAlias('https://example.test/read', { method: 'GET' });
void httpsGet('https://example.test/read');
void axiosAlias.post('/mutation', {});
void api.delete('/mutation');
void api.request({ url: '/dynamic', method: dynamicMethod });
void axiosAlias.get('/read');
void importedAxiosRequest({ url: '/mutation', method: 'PATCH' });
void ssm.send(command);
void awsAlias.send(knownCommand);
void sendAlias(command);
`, 'utf8');
  return root;
}

test('scanner fails closed across dynamic HTTP methods, aliases, axios, node HTTP, and unresolved AWS sends', () => {
  const repositoryRoot = adversarialRepository();
  try {
    const report = scanProductionOperations({ repositoryRoot, registry: [] });
    assert.equal(report.filesScanned, 1);
    assert.equal(report.discovered, 17);
    assert.equal(report.covered, 0);
    assert.equal(report.uncovered, 17);

    const countKind = (kind) => report.sites.filter((site) => site.kind === kind).length;
    assert.equal(countKind(OPERATION_KINDS.DEPLOYMENT_CLIENT), 1);
    assert.equal(countKind(OPERATION_KINDS.DEPLOYMENT_COMMAND), 3);
    assert.equal(countKind(OPERATION_KINDS.MUTATION_CALL), 9);
    assert.equal(countKind(OPERATION_KINDS.NETWORK_HTTP_REQUEST), 4);

    const symbols = report.sites.map((site) => site.symbol);
    assert.ok(symbols.includes('fetch:DYNAMIC_INIT'));
    assert.ok(symbols.includes('fetch:DYNAMIC_METHOD'));
    assert.ok(symbols.includes('fetch:POST'));
    assert.ok(symbols.includes('node-http-request:DELETE'));
    assert.ok(symbols.includes('node-http-request:DYNAMIC_METHOD'));
    assert.ok(symbols.includes('axios:POST'));
    assert.ok(symbols.includes('axios:DELETE'));
    assert.ok(symbols.includes('axios:DYNAMIC_METHOD'));
    assert.ok(symbols.includes('axios:PATCH'));
    assert.equal(symbols.filter((symbol) => symbol === 'send:UNRESOLVED_AWS_COMMAND').length, 2);
    assert.ok(symbols.includes('send:SendCommandCommand'));
  } finally {
    rmSync(repositoryRoot, { recursive: true, force: true });
  }
});

test('reviewed news disposition rejects every tuple substitution and duplicate', () => {
  const disposition = REVIEWED_OPERATION_DISPOSITIONS[0];
  const site = Object.freeze({
    siteId: disposition.siteId,
    path: disposition.path,
    line: disposition.line,
    column: disposition.column,
    kind: disposition.rawKind,
    symbol: disposition.rawSymbol,
    sourceSha256: disposition.sourceSha256,
  });
  const canonical = mapOperationSite(site, OPERATION_MAPPING_REGISTRY, REVIEWED_OPERATION_DISPOSITIONS);
  assert.equal(canonical.operationId, 'OP_NEWS_CONTEXT_PUBLIC_READ');
  assert.equal(canonical.effectiveKind, 'NETWORK_HTTP_REQUEST');

  for (const mutation of [
    { siteId: 'OPSITE_SUBSTITUTED' },
    { path: 'server/src/services/other.ts' },
    { line: disposition.line + 1 },
    { column: disposition.column + 1 },
    { kind: 'NETWORK_HTTP_REQUEST' },
    { symbol: 'fetch:POST' },
    { sourceSha256: '0'.repeat(64) },
  ]) {
    assert.equal(mapOperationSite({ ...site, ...mutation }, OPERATION_MAPPING_REGISTRY, REVIEWED_OPERATION_DISPOSITIONS).operationId, null);
  }

  for (const mutation of [
    { rulingCommit: 'a'.repeat(40) },
    { ownerId: 'FORGED_OWNER' },
    { disposition: 'REPLACE_CANONICAL' },
    { operationClass: 'NON_IDEMPOTENT_MUTATION' },
    { operationId: 'OP_PUBLIC_HTTP_READ' },
    { sourceDigestAlgorithm: 'sha512' },
    { sourceSha256: 'f'.repeat(64) },
    { effectiveKind: 'MUTATION_CALL' },
    { effectiveSymbol: 'fetch:POST' },
    { observedSemantics: { ...disposition.observedSemantics, maximumAttempts: 3 } },
  ]) {
    const hostileRegistry = [{ ...disposition, ...mutation }];
    assert.equal(mapOperationSite(site, OPERATION_MAPPING_REGISTRY, hostileRegistry).operationId, null);
  }

  for (const [siteMutation, dispositionMutation] of [
    [{ siteId: 'OPSITE_SUBSTITUTED' }, { siteId: 'OPSITE_SUBSTITUTED' }],
    [{ path: 'server/src/services/other.ts' }, { path: 'server/src/services/other.ts' }],
    [{ line: disposition.line + 1 }, { line: disposition.line + 1 }],
    [{ column: disposition.column + 1 }, { column: disposition.column + 1 }],
    [{ kind: 'NETWORK_HTTP_REQUEST' }, { rawKind: 'NETWORK_HTTP_REQUEST' }],
    [{ symbol: 'fetch:GET' }, { rawSymbol: 'fetch:GET' }],
    [{ sourceSha256: 'e'.repeat(64) }, { sourceSha256: 'e'.repeat(64) }],
  ]) {
    assert.equal(mapOperationSite(
      { ...site, ...siteMutation },
      OPERATION_MAPPING_REGISTRY,
      [{ ...disposition, ...dispositionMutation }],
    ).operationId, null);
  }

  assert.equal(mapOperationSite(
    site,
    OPERATION_MAPPING_REGISTRY,
    [{ ...disposition, substitutedAuthority: true }],
  ).operationId, null);

  assert.equal(mapOperationSite(site, OPERATION_MAPPING_REGISTRY, [disposition, disposition]).operationId, null);
  assert.equal(mapOperationSite({
    ...site,
    siteId: 'OPSITE_FUTURE_STATIC_GET',
    kind: 'NETWORK_HTTP_REQUEST',
    symbol: 'fetch',
  }).operationId, null);
});
