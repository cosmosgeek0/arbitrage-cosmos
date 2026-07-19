#!/usr/bin/env node
/** Static + import-time proof that the borrow lane is pure and read-only. */
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { installFoundationFetchDenial } from '../import-purity-network-denial.mjs';

const results = [];
function check(name, pass, detail = '') {
  results.push({ name, pass });
  console.log(`  ${pass ? '✓' : '✗ FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}
function section(title) { console.log(`\n${title}`); }

const here = dirname(fileURLToPath(import.meta.url));
const serverRoot = resolve(here, '../../..');
const sourceDir = join(serverRoot, 'src/foundation/borrow');
const distIndex = join(serverRoot, 'dist/foundation/borrow/index.js');
const sourceFiles = (await readdir(sourceDir)).filter((name) => name.endsWith('.ts')).sort();
const sources = await Promise.all(sourceFiles.map(async (name) => [name, await readFile(join(sourceDir, name), 'utf8')]));

section('1. static source boundary');
check('expected pure source set exists', sourceFiles.join('|') === 'decimal.ts|derive.ts|index.ts|types.ts|validate.ts', sourceFiles.join('|'));
const forbidden = [
  ['environment reads', /process\s*\.\s*env/],
  ['wall clock', /Date\s*\.\s*now\s*\(/],
  ['date construction', /new\s+Date\s*\(/],
  ['timeout scheduling', /setTimeout\s*\(/],
  ['interval scheduling', /setInterval\s*\(/],
  ['fetch transport', /\bfetch\s*\(/],
  ['websocket transport', /\bWebSocket\b/],
  ['node http import', /(?:node:)?https?(?:['"]|\/)/],
  ['node net import', /node:(?:net|tls)/],
  ['filesystem import', /node:fs/],
  ['child process import', /node:child_process/],
  ['capital-action function', /\bfunction\s+(?:borrow|repay|transfer)\s*\(/],
  ['capital-action method', /\b(?:borrow|repay|transfer)\s*\([^)]*\)\s*\{/],
  ['capital-action endpoint', /\/sapi\/v1\/margin\/(?:borrow-repay|transfer)/],
  ['synthetic collateral source wiring', /fixture\.margin/],
  ['flexible-loan source or endpoint', /binance\.loan|\/sapi\/v2\/loan/],
  ['collateral margin-level relabelling', /collateralMarginLevel/],
];
for (const [name, pattern] of forbidden) {
  const hits = sources.filter(([, source]) => pattern.test(source)).map(([file]) => file);
  check(`no ${name}`, hits.length === 0, hits.join(','));
}
for (const [file, source] of sources) {
  const imports = [...source.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((match) => match[1]);
  check(
    `${file} imports only local/frozen foundation contracts or trap-free Proxy detection`,
    imports.every(
      (specifier) => specifier.startsWith('./')
        || specifier === '../contracts/index.js'
        || specifier === 'node:util/types',
    ),
    imports.join(','),
  );
}

section('2. import performs no I/O, clock, environment or scheduling work');
const originals = {
  dateNow: Date.now,
  setTimeout: globalThis.setTimeout,
  setInterval: globalThis.setInterval,
};
let calls = [];
const fetchDenial = installFoundationFetchDenial();
Date.now = () => { calls.push('Date.now'); throw new Error('clock forbidden'); };
globalThis.setTimeout = () => { calls.push('setTimeout'); throw new Error('timer forbidden'); };
globalThis.setInterval = () => { calls.push('setInterval'); throw new Error('timer forbidden'); };
let module;
let importError = null;
try {
  module = await import(`${pathToFileURL(distIndex).href}?purity-proof=borrow`);
} catch (error) {
  importError = error;
} finally {
  fetchDenial.restore();
  Date.now = originals.dateNow;
  globalThis.setTimeout = originals.setTimeout;
  globalThis.setInterval = originals.setInterval;
}
check('fetch denial negative control is active', fetchDenial.negativeControlProven);
check('fresh dynamic import succeeds under traps', importError === null, importError?.message ?? '');
check(
  'fresh dynamic import triggers no trapped side effects',
  calls.length === 0 && fetchDenial.attempts() === 0,
  [...calls, ...(fetchDenial.attempts() ? [`fetch:${fetchDenial.attempts()}`] : [])].join(','),
);

section('3. export surface contains derivation only, never capital actions');
const keys = module ? Object.keys(module).sort() : [];
check('single derivation export present', keys.includes('deriveBorrowTruth'));
check('bounded batch derivation export present', keys.includes('deriveBorrowTruthBatch'));
check('exact consumer validation export present', keys.includes('validateBorrowTruthForConsumption'));
check('no public digest or truth-minting helper exists', !keys.some((key) => /(?:digest|mint)/i.test(key)), keys.join(','));
for (const forbiddenName of ['borrow', 'repay', 'transfer', 'createOrder', 'placeOrder', 'cancelOrder', 'execute']) {
  check(`no ${forbiddenName} export`, !keys.includes(forbiddenName));
}
check(
  'no export is a lower/camel-case mutation command',
  !keys.some((key) => /^(?:borrow|repay|transfer|place|cancel|execute|submit|send|post)(?:$|[A-Z])/.test(key)),
  keys.join(','),
);

const failed = results.filter((result) => !result.pass);
console.log(`\nBorrow import purity: ${results.length - failed.length}/${results.length} checks passed`);
if (failed.length > 0) process.exit(1);
