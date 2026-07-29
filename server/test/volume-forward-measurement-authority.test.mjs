#!/usr/bin/env node

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  readFileSync,
  readdirSync,
} from 'node:fs';
import test from 'node:test';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ACCEPTED_VOLUME_SOURCE = '6c8184331d85d098d2919e37d217f220f4c3214c';
const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = resolve(TEST_DIR, '../..');
const SERVER_SOURCE_DIR = join(REPOSITORY_ROOT, 'server/src');
const SOURCE_DIR = join(REPOSITORY_ROOT, 'server/src/engine/volume');
const DIST_DIR = join(REPOSITORY_ROOT, 'server/dist/engine/volume');
const VE2_DIR = join(REPOSITORY_ROOT, 'quant/research/ve2');

function listFiles(directory, predicate = () => true) {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const absolute = join(directory, entry.name);
      if (entry.isDirectory()) return listFiles(absolute, predicate);
      return predicate(absolute) ? [absolute] : [];
    })
    .sort();
}

function readJoined(files) {
  return files.map((file) => readFileSync(file, 'utf8')).join('\n');
}

function relativePath(file) {
  return relative(REPOSITORY_ROOT, file).replaceAll('\\', '/');
}

function normalizeStaticStringConcatenation(source) {
  let normalized = source;
  let previous;
  do {
    previous = normalized;
    normalized = normalized.replace(
      /(["'])([^"'\\\r\n]*)\1\s*\+\s*(["'])([^"'\\\r\n]*)\3/g,
      (_match, quote, left, _rightQuote, right) => `${quote}${left}${right}${quote}`,
    );
  } while (normalized !== previous);
  return normalized;
}

const FORBIDDEN_CORE_MODULE = /^(?:node:)?(?:fs(?:\/promises)?|http|https|http2|net|tls|dgram|dns(?:\/promises)?|timers(?:\/promises)?|child_process|cluster|worker_threads|process|os|ws|undici)$/;
const FORBIDDEN_CORE_IMPORT_PATH = /(?:^|\/)(?:strategy(?:EconomicExit)?Ledger|volumeRuntime|binance(?:Client)?|provider|privateRead)(?:\.js|\.ts)?$/i;

function importedSpecifiers(source) {
  const normalized = normalizeStaticStringConcatenation(source);
  const specifiers = new Set();
  const patterns = [
    /\b(?:from|import)\s*(["'])([^"'\r\n]+)\1/g,
    /\b(?:import|require)\s*\(\s*(["'])([^"'\r\n]+)\1/g,
  ];
  for (const pattern of patterns) {
    for (const match of normalized.matchAll(pattern)) {
      specifiers.add(match[2]);
    }
  }
  return [...specifiers];
}

function analyzeForbiddenImports(source) {
  const violations = [];

  for (const specifier of importedSpecifiers(source)) {
    if (FORBIDDEN_CORE_MODULE.test(specifier)) {
      violations.push(`forbidden ambient or I/O module: ${specifier}`);
    }
    if (FORBIDDEN_CORE_IMPORT_PATH.test(specifier)) {
      violations.push(`forbidden authority-bearing import: ${specifier}`);
    }
  }

  return violations;
}

function analyzePureCore(source) {
  const normalized = normalizeStaticStringConcatenation(source);
  const violations = analyzeForbiddenImports(normalized);

  const ambientPatterns = [
    [/\b(?:globalThis\s*(?:\.|\[\s*["']))?fetch(?:["']\s*\])?\s*\(/, 'network fetch'],
    [/\bnew\s+(?:globalThis\s*(?:\.|\[\s*["']))?WebSocket(?:["']\s*\])?\s*\(/, 'websocket'],
    [/\bglobalThis\s*(?:\.|\[\s*["'])fetch\b/, 'fetch alias'],
    [/\bglobalThis\s*(?:\.|\[\s*["'])WebSocket\b/, 'websocket alias'],
    [/\bprocess\s*(?:\.|\[)/, 'process or environment'],
    [/\bDate\s*(?:\.|\[\s*["'])now(?:["']\s*\])?\s*\(/, 'wall clock'],
    [/\bnew\s+Date\s*\(/, 'wall clock construction'],
    [/\bperformance\s*(?:\.|\[\s*["'])now(?:["']\s*\])?\s*\(/, 'ambient monotonic clock'],
    [/\bMath\s*(?:\.|\[\s*["'])random(?:["']\s*\])?\s*\(/, 'randomness'],
    [/\bcrypto\s*(?:\.|\[\s*["'])(?:randomUUID|getRandomValues|randomBytes)(?:["']\s*\])?\s*\(/, 'randomness'],
    [/\b(?:setTimeout|setInterval|setImmediate|queueMicrotask)\s*\(/, 'timer'],
    [/\bglobalThis\s*\[\s*["'](?:setTimeout|setInterval|setImmediate|queueMicrotask)["']\s*\]/, 'computed timer'],
  ];
  for (const [pattern, label] of ambientPatterns) {
    if (pattern.test(normalized)) violations.push(label);
  }

  const authorityPatterns = [
    [/(?:^|[.\s])(?:submit|submitOrder|sendOrder|placeOrder|createOrder|cancelOrder|amendOrder|executeOrder)\s*\(/im, 'order or submit call'],
    [/(?:^|[.\s])(?:compareAndSet|cas|casWrite|appendLedger|commitLedger)\s*\(/im, 'CAS or ledger call'],
    [/(?:^|[.\s])(?:privateRead|signedRequest|readApiKey|readSecret|providerCall|hostCommand)\s*\(/im, 'private, key, provider, or host call'],
    [/\[\s*["'](?:submit|submitOrder|sendOrder|placeOrder|createOrder|cancelOrder|amendOrder|executeOrder|compareAndSet|cas|casWrite|appendLedger|commitLedger|privateRead|signedRequest|readApiKey|readSecret|providerCall|hostCommand)["']\s*\]\s*\(/i, 'computed authority call'],
  ];
  for (const [pattern, label] of authorityPatterns) {
    if (pattern.test(normalized)) violations.push(label);
  }

  return [...new Set(violations)].sort();
}

function isInsideDirectory(file, directory) {
  const path = relative(directory, file);
  return path === '' || (!path.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) && path !== '..');
}

function createLocalSourceResolver(sourceFiles) {
  const available = new Set(sourceFiles.map((file) => resolve(file)));
  return (importer, specifier) => {
    if (!specifier.startsWith('.')) return {};

    const requested = resolve(dirname(importer), specifier);
    if (!isInsideDirectory(requested, SERVER_SOURCE_DIR)) {
      return { violation: `relative import leaves server/src: ${specifier}` };
    }

    const extension = extname(requested);
    const candidates = [];
    if (['.js', '.mjs', '.cjs'].includes(extension)) {
      const sourceExtension = { '.js': '.ts', '.mjs': '.mts', '.cjs': '.cts' }[extension];
      candidates.push(requested.slice(0, -extension.length) + sourceExtension);
    } else if (['.ts', '.mts', '.cts'].includes(extension)) {
      candidates.push(requested);
    } else if (extension === '') {
      candidates.push(
        `${requested}.ts`,
        `${requested}.mts`,
        `${requested}.cts`,
        join(requested, 'index.ts'),
        join(requested, 'index.mts'),
        join(requested, 'index.cts'),
      );
    }

    const target = candidates.find((candidate) => available.has(candidate));
    return target
      ? { target }
      : { violation: `unresolved local source import: ${specifier}` };
  };
}

function analyzeTransitivePureCore(rootFiles, readSource, resolveImport) {
  const pending = [...rootFiles];
  const roots = new Set(rootFiles);
  const visited = new Set();
  const violations = [];

  while (pending.length > 0) {
    const file = pending.shift();
    if (visited.has(file)) continue;
    visited.add(file);

    const source = readSource(file);
    const sourceViolations = roots.has(file)
      ? analyzePureCore(source)
      : analyzeForbiddenImports(source);
    for (const violation of sourceViolations) {
      violations.push(`${file}: ${violation}`);
    }
    for (const specifier of importedSpecifiers(source)) {
      const resolution = resolveImport(file, specifier);
      if (resolution.violation) {
        violations.push(`${file}: ${resolution.violation}`);
      }
      if (resolution.target && !visited.has(resolution.target)) {
        pending.push(resolution.target);
      }
    }
  }

  return [...new Set(violations)].sort();
}

function analyzePublicCapture(
  source,
  allowedStreams = new Set(['depth@100ms', 'aggTrade', 'trade', 'bookTicker']),
) {
  const normalized = normalizeStaticStringConcatenation(source);
  const violations = [];

  for (const match of normalized.matchAll(/\b(?:https?|wss?):\/\/[^\s"'`)]+/g)) {
    let url;
    try {
      url = new URL(match[0]);
    } catch {
      violations.push(`unparseable endpoint: ${match[0]}`);
      continue;
    }
    const restAllowed = url.protocol === 'https:'
      && url.hostname === 'data-api.binance.vision'
      && (
        url.pathname === '/'
        || url.pathname === '/api/v3/exchangeInfo'
        || url.pathname === '/api/v3/depth'
      );
    const streamAllowed = url.protocol === 'wss:'
      && url.hostname === 'data-stream.binance.vision'
      && (
        url.pathname === '/'
        || url.pathname.startsWith('/ws/')
        || url.pathname === '/stream'
      );
    if (!restAllowed && !streamAllowed) {
      violations.push(`endpoint outside public allowlist: ${url.protocol}//${url.host}${url.pathname}`);
    }
    for (const key of url.searchParams.keys()) {
      if (!['symbol', 'symbols', 'limit', 'streams', 'timeUnit'].includes(key)) {
        violations.push(`query parameter outside public allowlist: ${key}`);
      }
    }
  }

  for (const match of normalized.matchAll(/@([A-Za-z]+(?:@\d+ms)?)/g)) {
    if (!allowedStreams.has(match[1])) {
      violations.push(`stream outside public allowlist: @${match[1]}`);
    }
  }

  const prohibitedPatterns = [
    [/\bmethod\s*:\s*["'](?:POST|PUT|PATCH|DELETE|CONNECT|TRACE)["']/i, 'non-GET HTTP method'],
    [/\b(?:Authorization|Proxy-Authorization|Cookie|Set-Cookie|X-MBX-APIKEY)\b/i, 'authentication header'],
    [/\b(?:apiKey|secretKey|listenKey|signature|recvWindow)\b/i, 'credential or signed request field'],
    [/\b(?:createHmac|createSign|sign|signedRequest|privateRead)\s*\(/i, 'signature or private call'],
    [/\bprocess\s*(?:\.env|\[\s*["']env["']\s*\])/i, 'environment-derived endpoint or credential'],
    [/["']--(?:origin|base-url|endpoint|url|header|cookie|api-key|secret|signature)["']/i, 'caller-derived endpoint or credential'],
    [/\/api\/v3\/(?:account|order|openOrders|allOrders|myTrades|myPreventedMatches|myAllocations|userDataStream)\b/i, 'private or order endpoint'],
    [/@(?:userData|account|orders?)\b/i, 'private or order stream'],
  ];
  for (const [pattern, label] of prohibitedPatterns) {
    if (pattern.test(normalized)) violations.push(label);
  }

  return [...new Set(violations)].sort();
}

function assertDeepFrozen(value, seen = new Set()) {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return;
  if (seen.has(value)) return;
  seen.add(value);
  assert.equal(Object.isFrozen(value), true);
  for (const child of Object.values(value)) assertDeepFrozen(child, seen);
}

function changedPaths() {
  const committed = execFileSync(
    'git',
    ['diff', '--name-only', `${ACCEPTED_VOLUME_SOURCE}...HEAD`],
    { cwd: REPOSITORY_ROOT, encoding: 'utf8' },
  ).trim().split('\n').filter(Boolean);
  const porcelain = execFileSync(
    'git',
    ['status', '--porcelain=v1', '--untracked-files=all'],
    { cwd: REPOSITORY_ROOT, encoding: 'utf8' },
  );
  const working = porcelain
    .split('\n')
    .filter(Boolean)
    .map((line) => line.slice(3))
    .map((path) => path.includes(' -> ') ? path.split(' -> ').at(-1) : path);
  return [...new Set([...committed, ...working])].sort();
}

test('V-I2 changes remain inside the exclusive forward-measurement source and test scope', () => {
  const allowed = [
    /^server\/src\/engine\/volume\/forwardMeasurement[^/]*\.ts$/,
    /^server\/test\/volume-forward-measurement[^/]*\.mjs$/,
    /^quant\/research\/ve2\/.+$/,
  ];
  const changed = changedPaths();
  assert.ok(changed.length > 0);
  assert.deepEqual(
    changed.filter((path) => !allowed.some((pattern) => pattern.test(path))),
    [],
  );
  assert.equal(changed.some((path) => /(?:^|\/)(?:package(?:-lock)?\.json|volumeRuntime\.ts|index\.ts|bootstrap[^/]*)$/i.test(path)), false);
});

test('forward-measurement local import graph is deterministic, network-free, and authority-free', () => {
  const rootFiles = listFiles(
    SOURCE_DIR,
    (file) => /^forwardMeasurement.*\.ts$/.test(file.slice(SOURCE_DIR.length + 1)),
  );
  assert.ok(rootFiles.length > 0);
  const localSourceFiles = listFiles(
    SERVER_SOURCE_DIR,
    (file) => ['.ts', '.mts', '.cts'].includes(extname(file)),
  );
  const violations = analyzeTransitivePureCore(
    rootFiles,
    (file) => readFileSync(file, 'utf8'),
    createLocalSourceResolver(localSourceFiles),
  ).map((violation) => violation.replaceAll(REPOSITORY_ROOT, '.'));
  assert.deepEqual(violations, [], violations.join('\n'));
});

test('negative controls catch static, aliased, computed, and dynamically assembled core authority', () => {
  const fixtures = [
    `import 'node:fs';`,
    `import '../../services/provider.js';`,
    `import fileSystem = require('node:fs'); fileSystem.readFileSync('evidence');`,
    `import { readFileSync as read } from 'node:' + 'fs'; read('evidence');`,
    `const request = globalThis['fet' + 'ch']; request(endpoint);`,
    `new globalThis['Web' + 'Socket'](endpoint);`,
    `process['e' + 'nv'].VOLUME_ENDPOINT`,
    `Date['n' + 'ow'](); Math['ran' + 'dom']();`,
    `ports['sub' + 'mit'](plan);`,
    `store['compare' + 'AndSet'](expected, next);`,
  ];
  for (const fixture of fixtures) {
    assert.notDeepEqual(analyzePureCore(fixture), [], fixture);
  }
});

test('negative control catches forbidden authority in a transitive local helper', () => {
  const sources = new Map([
    ['/virtual/forwardMeasurement.ts', `import './helper.js';`],
    ['/virtual/helper.ts', `import 'node:fs';`],
  ]);
  const violations = analyzeTransitivePureCore(
    ['/virtual/forwardMeasurement.ts'],
    (file) => sources.get(file),
    (_importer, specifier) => specifier === './helper.js'
      ? { target: '/virtual/helper.ts' }
      : {},
  );
  assert.deepEqual(
    violations,
    ['/virtual/helper.ts: forbidden ambient or I/O module: node:fs'],
  );
});

test('VE2 capture scripts are pinned to Binance public market-data GET and WSS surfaces', () => {
  const scriptFiles = listFiles(
    VE2_DIR,
    (file) => ['.js', '.mjs', '.cjs', '.ts', '.mts', '.cts'].includes(extname(file)),
  );
  assert.ok(scriptFiles.length > 0);
  const captureFiles = scriptFiles.filter((file) => /capture/i.test(relativePath(file)));
  assert.ok(captureFiles.length > 0);
  const source = readJoined(captureFiles);
  assert.match(source, /\bdata-api\.binance\.vision\b/);
  assert.match(source, /\bdata-stream\.binance\.vision\b/);
  assert.match(source, /\/api\/v3\/exchangeInfo\b/);
  assert.match(source, /\/api\/v3\/depth\b/);
  assert.match(source, /@depth(?:@100ms)?\b/);
  assert.match(source, /@trade\b/);
  assert.match(source, /@bookTicker\b/);
  assert.match(source, /\bmethod\s*:\s*["']GET["']/);
  const officialSources = JSON.parse(
    readFileSync(join(VE2_DIR, 'official-sources.v1.json'), 'utf8'),
  );
  const allowedStreams = new Set(
    officialSources.captureAllowlist.webSocket.streams.map(
      (stream) => stream.replace(/^<symbol>@/, ''),
    ),
  );
  assert.deepEqual(
    [...allowedStreams].sort(),
    ['aggTrade', 'bookTicker', 'depth@100ms', 'trade'],
  );
  const policy = JSON.parse(
    readFileSync(join(VE2_DIR, 'measurement-policy.v1.json'), 'utf8'),
  );
  if (policy.publicCapture.timestampUnit === 'MICROSECOND') {
    assert.match(
      source,
      /(?:timeUnit=MICROSECOND|searchParams\.set\(\s*["']timeUnit["']\s*,\s*["']MICROSECOND["'])/,
    );
  } else {
    assert.equal(policy.publicCapture.timestampUnit, 'MILLISECOND');
    assert.doesNotMatch(
      source,
      /(?:timeUnit=MICROSECOND|searchParams\.set\(\s*["']timeUnit["']\s*,\s*["']MICROSECOND["'])/,
    );
  }
  for (const file of captureFiles) {
    const violations = analyzePublicCapture(readFileSync(file, 'utf8'), allowedStreams);
    assert.deepEqual(violations, [], `${relativePath(file)}: ${violations.join(', ')}`);
  }
});

test('negative controls reject disguised capture credentials, mutations, and non-public endpoints', () => {
  const fixtures = [
    `fetch(url, { method: 'PO' + 'ST' });`,
    `headers['Author' + 'ization'] = token;`,
    `headers['X-MBX-' + 'APIKEY'] = token;`,
    `new URL('/api/v3/' + 'order', 'https://data-api.binance.vision');`,
    `const endpoint = process['e' + 'nv'].BINANCE_BASE_URL;`,
    `const endpoint = 'https://' + 'api.binance.com/api/v3/depth';`,
  ];
  for (const fixture of fixtures) {
    assert.notDeepEqual(analyzePublicCapture(fixture), [], fixture);
  }
});

test('built engine exports one immutable default-off, kill-on, no-authority tuple', async () => {
  const moduleFiles = listFiles(
    DIST_DIR,
    (file) => /^forwardMeasurement.*\.js$/.test(file.slice(DIST_DIR.length + 1)),
  );
  assert.ok(moduleFiles.length > 0);
  const modules = await Promise.all(moduleFiles.map((file) => import(pathToFileURL(file).href)));
  const authority = modules
    .map((module) => module.VOLUME_FORWARD_MEASUREMENT_AUTHORITY)
    .filter((value) => value !== undefined);
  assert.equal(authority.length, 1);
  assert.deepEqual(authority[0], {
    enabled: false,
    killSwitchEngaged: true,
    mode: 'SHADOW_ONLY',
    recordOnly: true,
    productionAdmissible: false,
    publicOnly: true,
    authentication: 'NONE',
    executionAuthority: 'NONE',
    submitAuthority: 'NONE',
    casAuthority: 'NONE',
    externalAuthority: 'NONE',
    privateDataAuthority: 'NONE',
    keyAuthority: 'NONE',
    providerAuthority: 'NONE',
    hostAuthority: 'NONE',
    submitPortPresent: false,
    queryPortPresent: false,
    sends: 0,
    sideEffects: 0,
    orders: 0,
    casWrites: 0,
    privateCalls: 0,
    signedCalls: 0,
    keyReads: 0,
    providerCalls: 0,
    hostCalls: 0,
    networkCallsDuringReplay: 0,
    fsWrites: 0,
  });
  assertDeepFrozen(authority[0]);
});
