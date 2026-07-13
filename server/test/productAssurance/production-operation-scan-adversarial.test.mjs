import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  OPERATION_KINDS,
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
