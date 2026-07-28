#!/usr/bin/env node
/** N-11 static containment and import-purity proof for the public groundwork seam. */
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { installFoundationFetchDenial } from '../../import-purity-network-denial.mjs';

const PUBLIC_SEAM = 'createBinanceUsdMPublicGroundworkSeam';
const here = dirname(fileURLToPath(import.meta.url));
const serverRoot = resolve(here, '../../../..');
const repositoryRoot = resolve(serverRoot, '..');
const sourceRoot = join(serverRoot, 'src');
const validationSourcePath = join(
  sourceRoot,
  'foundation/exchange/binanceUsdM/validation.ts',
);
const compiledValidationPath = join(
  serverRoot,
  'dist/foundation/exchange/binanceUsdM/validation.js',
);
const sharedBarrelPath = join(
  sourceRoot,
  'foundation/exchange/binanceUsdM/index.ts',
);
const packagePaths = [
  join(repositoryRoot, 'package.json'),
  join(serverRoot, 'package.json'),
];
const expectedSharedBarrel = `/**
 * Dormant USD-M Futures read/test-order boundary.
 *
 * Future wiring seam: construct BinanceUsdMClient with an injected clock,
 * signer, and transport adapter. This barrel deliberately exports no concrete
 * network transport and no live order, cancel, leverage, margin, borrow,
 * transfer, or withdrawal capability.
 */
export * from './types.js';
export * from './decimal.js';
export * from './signing.js';
export * from './validation.js';
export * from './redaction.js';
export { BinanceUsdMClient } from './client.js';
`;

const results = [];
function check(name, pass, detail = '') {
  results.push({ name, pass });
  console.log(`  ${pass ? '✓' : '✗ FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}
function section(title) {
  console.log(`\n${title}`);
}

async function sourceFilesBelow(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFilesBelow(path);
    return entry.isFile() && entry.name.endsWith('.ts') ? [path] : [];
  }));
  return nested.flat().sort();
}

function moduleSpecifiers(source) {
  const specifiers = [];
  for (const match of source.matchAll(
    /\b(?:import|export)\s+(?:type\s+)?(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/gu,
  )) {
    specifiers.push(match[1]);
  }
  for (const match of source.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]/gu)) {
    specifiers.push(match[1]);
  }
  return [...new Set(specifiers)].sort();
}

const validationSource = await readFile(validationSourcePath, 'utf8');

section('1. validation module is the only public-groundwork source seam');
check(
  'exact N-11 seam is exported by validation.ts',
  new RegExp(`\\bexport\\s+function\\s+${PUBLIC_SEAM}\\b`, 'u').test(validationSource),
);
const sharedBarrel = await readFile(sharedBarrelPath, 'utf8');
check(
  'shared USD-M barrel text is unchanged',
  sharedBarrel === expectedSharedBarrel,
);
check(
  'shared barrel has no explicit N-11 wiring',
  !sharedBarrel.includes(PUBLIC_SEAM),
);
for (const packagePath of packagePaths) {
  const packageSource = await readFile(packagePath, 'utf8');
  check(
    `${relative(repositoryRoot, packagePath)} has no N-11 script or entry wiring`,
    !packageSource.includes(PUBLIC_SEAM)
      && !packageSource.includes('public-groundwork-containment'),
  );
}

const productionConsumers = [];
for (const path of await sourceFilesBelow(sourceRoot)) {
  if (path === validationSourcePath) continue;
  const source = await readFile(path, 'utf8');
  if (new RegExp(`\\b${PUBLIC_SEAM}\\b`, 'u').test(source)) {
    productionConsumers.push(relative(repositoryRoot, path));
  }
}
check(
  'production has zero consumers outside the owning Foundation module',
  productionConsumers.length === 0,
  productionConsumers.join(','),
);

section('2. validation source has no effectful or private dependency');
const specifiers = moduleSpecifiers(validationSource);
check('validation source has a non-empty explicit dependency set', specifiers.length > 0);
const forbiddenSpecifier = /(?:^|[/@._-])(?:client|signing|private|secrets?|credentials?|env(?:ironment)?|network|timers?|fs|https?|http2|net|tls|dns|dgram|undici|ws|websocket|child_process)(?:$|[/@._-])/iu;
const forbiddenImports = specifiers.filter((specifier) => forbiddenSpecifier.test(specifier));
check(
  'no client, signing, private, env, network, timer, or filesystem import',
  forbiddenImports.length === 0,
  forbiddenImports.join(','),
);
for (const [name, pattern] of [
  ['environment read', /\b(?:process|Deno)\s*\.\s*env\b|\bimport\.meta\.env\b/u],
  ['global fetch', /\bfetch\s*\(/u],
  ['websocket', /\b(?:WebSocket|EventSource|XMLHttpRequest)\b/u],
  ['timer', /\b(?:setTimeout|setInterval|setImmediate|queueMicrotask)\s*\(/u],
  ['filesystem access', /\b(?:readFile|writeFile|readdir|mkdir|openSync|createReadStream|createWriteStream)\s*\(/u],
]) {
  check(`no ${name} in validation source`, !pattern.test(validationSource));
}

section('3. compiled validation import performs no global I/O');
const compiledSource = await readFile(compiledValidationPath, 'utf8');
const compiledForbiddenImports = moduleSpecifiers(compiledSource)
  .filter((specifier) => forbiddenSpecifier.test(specifier));
check(
  'compiled validation has no effectful or private import',
  compiledForbiddenImports.length === 0,
  compiledForbiddenImports.join(','),
);
for (const [name, pattern] of [
  ['environment read', /\b(?:process|Deno)\s*\.\s*env\b|\bimport\.meta\.env\b/u],
  ['global fetch', /\bfetch\s*\(/u],
  ['websocket', /\b(?:WebSocket|EventSource|XMLHttpRequest)\b/u],
  ['timer', /\b(?:setTimeout|setInterval|setImmediate|queueMicrotask)\s*\(/u],
  ['filesystem access', /\b(?:readFile|writeFile|readdir|mkdir|openSync|createReadStream|createWriteStream)\s*\(/u],
]) {
  check(`compiled validation contains no ${name}`, !pattern.test(compiledSource));
}

const original = {
  dateNow: Date.now,
  random: Math.random,
  setTimeout: globalThis.setTimeout,
  setInterval: globalThis.setInterval,
  setImmediate: globalThis.setImmediate,
  queueMicrotask: globalThis.queueMicrotask,
  env: process.env,
};
const trappedCalls = [];
const loaderEnvironmentKeys = new Set(['WATCH_REPORT_DEPENDENCIES']);
const environmentReads = [];
const globalsBefore = new Set(Object.getOwnPropertyNames(globalThis));
const fetchDenial = installFoundationFetchDenial();
let imported;
let importError = null;

Date.now = () => {
  trappedCalls.push('Date.now');
  throw new Error('wall clock forbidden during import');
};
Math.random = () => {
  trappedCalls.push('Math.random');
  throw new Error('randomness forbidden during import');
};
globalThis.setTimeout = () => {
  trappedCalls.push('setTimeout');
  throw new Error('timeout forbidden during import');
};
globalThis.setInterval = () => {
  trappedCalls.push('setInterval');
  throw new Error('interval forbidden during import');
};
globalThis.setImmediate = () => {
  trappedCalls.push('setImmediate');
  throw new Error('immediate scheduling forbidden during import');
};
globalThis.queueMicrotask = () => {
  trappedCalls.push('queueMicrotask');
  throw new Error('microtask scheduling forbidden during import');
};
process.env = new Proxy(original.env, {
  get(target, property, receiver) {
    if (typeof property === 'string') environmentReads.push(property);
    return Reflect.get(target, property, receiver);
  },
});

try {
  imported = await import(
    `${pathToFileURL(compiledValidationPath).href}?n11-public-groundwork-containment`
  );
} catch (error) {
  importError = error;
} finally {
  Date.now = original.dateNow;
  Math.random = original.random;
  globalThis.setTimeout = original.setTimeout;
  globalThis.setInterval = original.setInterval;
  globalThis.setImmediate = original.setImmediate;
  globalThis.queueMicrotask = original.queueMicrotask;
  process.env = original.env;
  fetchDenial.restore();
}

check('fetch denial negative control is active', fetchDenial.negativeControlProven);
check(
  'fresh compiled validation import succeeds under traps',
  importError === null,
  importError?.message ?? '',
);
check(
  'compiled import triggers no clock, random, timer, or scheduling global',
  trappedCalls.length === 0,
  trappedCalls.join(','),
);
check(
  'compiled import triggers no global network call',
  fetchDenial.attempts() === 0,
  `${fetchDenial.attempts()}`,
);
const unexpectedEnvironmentReads = environmentReads
  .filter((key) => !loaderEnvironmentKeys.has(key));
check(
  'compiled import reads no process environment',
  unexpectedEnvironmentReads.length === 0,
  unexpectedEnvironmentReads.join(','),
);
const newGlobals = Object.getOwnPropertyNames(globalThis)
  .filter((key) => !globalsBefore.has(key));
check('compiled import creates no globals', newGlobals.length === 0, newGlobals.join(','));
check(
  'compiled module exposes the exact N-11 seam',
  typeof imported?.[PUBLIC_SEAM] === 'function',
  imported ? Object.keys(imported).sort().join(',') : '',
);

const failed = results.filter((result) => !result.pass);
console.log(
  `\n${failed.length === 0 ? 'PASS' : 'FAIL'} public-groundwork-containment: `
    + `${results.length - failed.length}/${results.length}`,
);
if (failed.length > 0) process.exit(1);
