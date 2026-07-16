#!/usr/bin/env node
import { createServer } from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(process.argv[2]);
const configPath = resolve(root, 'config.json');
const addressPath = resolve(root, 'address.json');
const endpoint = '/api/system-integration/ops/readback';

const server = createServer((request, response) => {
  if (request.method !== 'GET' || request.url !== endpoint) {
    response.writeHead(404, { 'content-type': 'application/json' });
    response.end('{"error":"not found"}\n');
    return;
  }
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  if (config.hang === true) return;
  const send = () => {
    const body = typeof config.body === 'string' ? config.body : JSON.stringify(config.body);
    response.writeHead(config.status ?? 200, {
      'content-type': config.contentType ?? 'application/json; charset=utf-8',
      'content-length': Buffer.byteLength(body),
    });
    response.end(body);
  };
  if (Number.isSafeInteger(config.delayMs) && config.delayMs > 0) setTimeout(send, config.delayMs);
  else send();
});

server.listen(0, '127.0.0.1', () => {
  const address = server.address();
  writeFileSync(addressPath, `${JSON.stringify({ host: '127.0.0.1', port: address.port })}\n`, { flag: 'wx' });
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
