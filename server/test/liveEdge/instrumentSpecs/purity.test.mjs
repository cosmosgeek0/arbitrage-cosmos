import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { syncBuiltinESMExports } from 'node:module';
import net from 'node:net';
import path from 'node:path';
import test from 'node:test';
import tls from 'node:tls';
import { pathToFileURL } from 'node:url';

import ts from 'typescript';

const SOURCE_ROOT = path.resolve('server/src/liveEdge/adapters/binanceInstrumentSpecs');
const DIST_ROOT = path.resolve('server/dist/liveEdge/adapters/binanceInstrumentSpecs');

const FORBIDDEN_NODE_ROOTS = new Set([
  'child_process', 'cluster', 'dgram', 'dns', 'fs', 'http', 'http2', 'https',
  'net', 'process', 'tls', 'timers', 'worker_threads',
]);
const FORBIDDEN_PACKAGES = new Set(['axios', 'got', 'node-fetch', 'undici', 'ws']);
const FORBIDDEN_AMBIENT_CALLS = new Set([
  'fetch', 'queueMicrotask', 'setImmediate', 'setInterval', 'setTimeout',
]);
const FORBIDDEN_NETWORK_CONSTRUCTORS = new Set([
  'EventSource', 'WebSocket', 'XMLHttpRequest',
]);
const FORBIDDEN_SIGNER_CALLS = new Set([
  'createHmac', 'createPrivateKey', 'createSecretKey', 'createSign', 'generateKey',
  'generateKeyPair', 'getRandomValues', 'hkdf', 'pbkdf2', 'randomBytes',
  'randomFill', 'randomFillSync', 'randomInt', 'randomUUID', 'scrypt', 'sign',
]);
const FORBIDDEN_ACTION_CALLS = new Set([
  'allocate', 'applyControl', 'borrow', 'cancelOrder', 'createOrder', 'execute',
  'mutateControl', 'placeOrder', 'reconcile', 'repay', 'reserve', 'send',
  'sendOrder', 'signRequest', 'submitOrder', 'testOrder', 'transfer', 'withdraw',
]);
const MODULE_CONTAINERS = new Set(['Map', 'Set', 'WeakMap', 'WeakSet']);
const CONTAINER_MUTATIONS = new Set(['add', 'clear', 'delete', 'set']);

const CAPITAL_DECIMAL_NAMES = new Set([
  'addExactDecimals', 'compareExactDecimals', 'divideExactDecimals',
  'minimumExactDecimal', 'multiplyExactDecimals',
  'normalizeNonNegativeExactDecimal', 'subtractExactDecimals', 'ExactDecimal',
]);
const INTELLIGENCE_FOUNDATION_NAMES = new Set([
  'canonicalJson', 'sortedUnique', 'stableId', 'validateTruthMetadata',
]);

function filesUnder(root, suffix) {
  const files = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...filesUnder(target, suffix));
    else if (entry.isFile() && entry.name.endsWith(suffix)) files.push(target);
  }
  return files.sort();
}

function parse(file) {
  const source = fs.readFileSync(file, 'utf8');
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);
  assert.deepEqual(
    tree.parseDiagnostics.map((diagnostic) => diagnostic.messageText),
    [],
    `${path.relative(process.cwd(), file)} must parse without recovery`,
  );
  return tree;
}

function walk(node, visit) {
  visit(node);
  ts.forEachChild(node, (child) => walk(child, visit));
}

function unwrap(node) {
  let current = node;
  while (current && (
    ts.isAsExpression(current)
    || ts.isParenthesizedExpression(current)
    || ts.isSatisfiesExpression(current)
    || ts.isTypeAssertionExpression(current)
  )) current = current.expression;
  return current;
}

function nodeName(node) {
  if (!node) return null;
  if (ts.isIdentifier(node) || ts.isPrivateIdentifier(node) || ts.isStringLiteralLike(node)) return node.text;
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  if (ts.isElementAccessExpression(node) && node.argumentExpression && ts.isStringLiteralLike(node.argumentExpression)) {
    return node.argumentExpression.text;
  }
  return null;
}

function expressionPath(node) {
  const current = unwrap(node);
  if (!current) return null;
  if (ts.isIdentifier(current)) return current.text;
  if (ts.isMetaProperty(current)) return current.getText();
  if (ts.isPropertyAccessExpression(current)) {
    const prefix = expressionPath(current.expression);
    return prefix === null ? null : `${prefix}.${current.name.text}`;
  }
  if (ts.isElementAccessExpression(current)
    && current.argumentExpression
    && ts.isStringLiteralLike(current.argumentExpression)) {
    const prefix = expressionPath(current.expression);
    return prefix === null ? null : `${prefix}.${current.argumentExpression.text}`;
  }
  return null;
}

function moduleName(node) {
  return node && ts.isStringLiteralLike(node) ? node.text : null;
}

function normalizedModuleRoot(specifier) {
  const bare = specifier.startsWith('node:') ? specifier.slice(5) : specifier;
  if (bare.startsWith('@')) return bare.split('/').slice(0, 2).join('/');
  return bare.split('/')[0];
}

function importedNames(node) {
  const names = [];
  const clause = node.importClause;
  if (!clause) return names;
  if (clause.name) names.push(clause.name.text);
  if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
    for (const element of clause.namedBindings.elements) {
      names.push(element.propertyName?.text ?? element.name.text);
    }
  }
  if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
    names.push('*');
  }
  return names;
}

function allowedImportReason(file, node, specifier) {
  const normalized = specifier.replaceAll('\\', '/');
  const base = path.basename(file);
  const names = new Set(importedNames(node));

  if (normalized === 'node:util' && names.size === 1 && names.has('types')) return null;
  if (normalized === 'node:crypto' && ['filterSchemas.ts', 'normalize.ts'].includes(base)
    && names.size === 1 && names.has('createHash')) return null;
  if (normalized === '../../../capitalFoundation/contracts/decimal.js'
    && base === 'exact.ts'
    && [...names].every((name) => CAPITAL_DECIMAL_NAMES.has(name))) return null;
  if (normalized === '../../../intelligenceFoundation/contracts/index.js'
    && ((base === 'normalize.ts'
      && names.size === INTELLIGENCE_FOUNDATION_NAMES.size
      && [...names].every((name) => INTELLIGENCE_FOUNDATION_NAMES.has(name)))
      || (base === 'filterSchemas.ts' && names.size === 1 && names.has('canonicalJson'))
      || (base === 'sizing.ts'
        && names.size === 1
        && names.has('stableId'))
      || (base === 'spotOrderTifCapability.ts'
        && names.size === 2
        && names.has('canonicalJson')
        && names.has('stableId'))
      || (base === 'snapshot.ts'
        && names.size === 2
        && names.has('canonicalJson')
        && names.has('stableId')))) return null;
  if (normalized === '../../../intelligenceRuntime/universe/index.js'
    && base === 'types.ts'
    && node.importClause?.isTypeOnly === true
    && names.size === 1
    && names.has('RuntimeListingMetadata')) return null;
  if (normalized.startsWith('./') || normalized.startsWith('../')) {
    if (normalized === '../binanceContracts/index.js'
      && ['contract.ts', 'spotOrderTifCapability.ts'].includes(base)) return null;
    if (normalized === './sizing.js' && base === 'waiting.ts') {
      return names.size === 2
        && names.has('requiredFilterReferenceEvidence')
        && names.has('validateFilterReferenceEvidence')
        ? null
        : 'waiting imports more than the narrow sizing reference-evidence contract';
    }
    const resolved = path.resolve(path.dirname(file), normalized.replace(/\.js$/, '.ts'));
    if (resolved.startsWith(`${SOURCE_ROOT}${path.sep}`)) return null;
    return `imports an owner outside the L04 adapter ${specifier}`;
  }

  const root = normalizedModuleRoot(normalized);
  if (FORBIDDEN_NODE_ROOTS.has(root)) return `imports ambient boundary ${specifier}`;
  if (FORBIDDEN_PACKAGES.has(root) || root.startsWith('@aws-sdk/')) {
    return `imports transport/cloud package ${specifier}`;
  }
  return `imports an unapproved external or owner module ${specifier}`;
}

function location(file, tree, node) {
  const point = tree.getLineAndCharacterOfPosition(node.getStart(tree));
  return `${path.relative(process.cwd(), file)}:${point.line + 1}:${point.character + 1}`;
}

function moduleContainers(tree, report) {
  const containers = new Set();
  for (const statement of tree.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    if ((statement.declarationList.flags & ts.NodeFlags.Const) === 0) {
      report(statement.declarationList, 'declares module-scope mutable let/var state');
    }
    for (const declaration of statement.declarationList.declarations) {
      const initializer = unwrap(declaration.initializer);
      const name = nodeName(declaration.name);
      if (!initializer || !name || !ts.isNewExpression(initializer)) continue;
      const constructorName = nodeName(initializer.expression);
      if (constructorName && MODULE_CONTAINERS.has(constructorName)) {
        containers.add(name);
        report(initializer, `creates module-scope mutable ${constructorName} registry`);
      }
    }
  }
  return containers;
}

function staticViolations(files) {
  const violations = [];
  for (const file of files) {
    const tree = parse(file);
    const report = (node, detail) => violations.push(`${location(file, tree, node)} ${detail}`);
    const containers = moduleContainers(tree, report);

    walk(tree, (node) => {
      if (ts.isImportDeclaration(node)) {
        const specifier = moduleName(node.moduleSpecifier);
        if (specifier !== null) {
          const reason = allowedImportReason(file, node, specifier);
          if (reason !== null) report(node.moduleSpecifier, reason);
        }
      }
      if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
        const specifier = moduleName(node.moduleSpecifier);
        if (specifier !== null) {
          const synthetic = { importClause: undefined };
          const reason = allowedImportReason(file, synthetic, specifier);
          if (reason !== null) report(node.moduleSpecifier, reason);
        }
      }
      if (ts.isImportEqualsDeclaration(node)) report(node, 'uses import-equals boundary');

      const accessPath = (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node))
        ? expressionPath(node)
        : null;
      if (accessPath && /^(?:globalThis\.)?(?:process|Bun|Deno)\.env(?:\.|$)/.test(accessPath)) {
        report(node, 'reads ambient environment state');
      }
      if (accessPath && /^(?:globalThis\.)?console(?:\.|$)/.test(accessPath)) {
        report(node, 'accesses console output');
      }

      if (ts.isCallExpression(node)) {
        if (node.expression.kind === ts.SyntaxKind.ImportKeyword) report(node, 'uses dynamic import');
        const name = nodeName(node.expression);
        if (name === 'require' || name === 'getBuiltinModule') report(node, `uses ${name}`);
        if (name && FORBIDDEN_AMBIENT_CALLS.has(name)) report(node, `calls ambient primitive ${name}`);
        if (name && FORBIDDEN_SIGNER_CALLS.has(name)) report(node, `calls signer/random primitive ${name}`);
        if (name && FORBIDDEN_ACTION_CALLS.has(name)) report(node, `calls action-authority command ${name}`);

        const target = expressionPath(node.expression);
        if (target === 'Date' || target === 'Date.now' || target === 'globalThis.Date.now') {
          report(node, 'reads ambient wall clock');
        }
        if (target === 'performance.now' || target === 'globalThis.performance.now'
          || target === 'process.hrtime' || target === 'process.uptime'
          || target === 'Temporal.Now' || target?.startsWith('Temporal.Now.')) {
          report(node, 'reads ambient monotonic/wall clock');
        }
        if (target === 'Math.random' || target === 'globalThis.Math.random') {
          report(node, 'uses ambient randomness');
        }

        if ((ts.isPropertyAccessExpression(node.expression) || ts.isElementAccessExpression(node.expression))
          && ts.isIdentifier(node.expression.expression)
          && containers.has(node.expression.expression.text)
          && name
          && CONTAINER_MUTATIONS.has(name)) {
          report(node, `mutates module-scope container ${node.expression.expression.text}`);
        }
      }

      if (ts.isNewExpression(node)) {
        const name = nodeName(node.expression);
        if (name && FORBIDDEN_NETWORK_CONSTRUCTORS.has(name)) report(node, `constructs network primitive ${name}`);
        if (name === 'Date' && (node.arguments?.length ?? 0) === 0) report(node, 'constructs Date from ambient wall clock');
      }

      if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
        report(node, 'declares a stateful class instead of a pure value adapter');
      }

      if (ts.isStringLiteralLike(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
        if (/^(?:https?|wss?):\/\//i.test(node.text)
          || /^\/(?:api|sapi|fapi|dapi|vapi)\/v\d+(?:\/|$)/i.test(node.text)) {
          report(node, 'embeds a network/exchange target');
        }
        if (/^X-MBX-APIKEY$/i.test(node.text)
          || /(?:^|[?&])signature=/i.test(node.text)) {
          report(node, 'embeds a credential/signature boundary');
        }
      }
    });
  }
  return violations;
}

function patchProperty(patches, target, key, value) {
  const descriptor = Object.getOwnPropertyDescriptor(target, key);
  patches.push({ target, key, descriptor });
  Object.defineProperty(target, key, {
    configurable: true,
    enumerable: descriptor?.enumerable ?? false,
    writable: true,
    value,
  });
}

async function withImportTripwires(run) {
  const attempts = [];
  const patches = [];
  const denied = (name) => function deniedImportBoundary() {
    attempts.push(name);
    throw new Error(`L04_INSTRUMENT_IMPORT_BOUNDARY_USED:${name}`);
  };

  patchProperty(patches, Date, 'now', denied('Date.now'));
  patchProperty(patches, Math, 'random', denied('Math.random'));
  patchProperty(patches, globalThis, 'fetch', denied('fetch'));
  for (const name of ['queueMicrotask', 'setImmediate', 'setInterval', 'setTimeout']) {
    patchProperty(patches, globalThis, name, denied(name));
  }
  for (const name of ['EventSource', 'WebSocket', 'XMLHttpRequest']) {
    patchProperty(patches, globalThis, name, class ForbiddenNetworkPrimitive {
      constructor() {
        attempts.push(name);
        throw new Error(`L04_INSTRUMENT_IMPORT_BOUNDARY_USED:${name}`);
      }
    });
  }

  const originalEnv = process.env;
  patchProperty(patches, process, 'env', new Proxy(originalEnv, {
    get(target, property, receiver) {
      if (typeof property === 'string') attempts.push(`process.env:${property}`);
      return Reflect.get(target, property, receiver);
    },
    has(target, property) {
      if (typeof property === 'string') attempts.push(`process.env.has:${property}`);
      return Reflect.has(target, property);
    },
    ownKeys(target) {
      attempts.push('process.env.enumerate');
      return Reflect.ownKeys(target);
    },
  }));

  const patchMethods = (target, prefix, names) => {
    for (const name of names) {
      const descriptor = Object.getOwnPropertyDescriptor(target, name);
      if (descriptor && typeof descriptor.value === 'function') {
        patchProperty(patches, target, name, denied(`${prefix}.${name}`));
      }
    }
  };
  const originalOpenSync = fs.openSync;
  patchProperty(patches, fs, 'openSync', function guardedOpenSync(...args) {
    if (new Error().stack?.includes('node:internal/modules/esm/load:')) {
      return originalOpenSync.apply(this, args);
    }
    attempts.push('fs.openSync');
    throw new Error('L04_INSTRUMENT_IMPORT_BOUNDARY_USED:fs.openSync');
  });
  patchMethods(fs, 'fs', [
    'access', 'accessSync', 'appendFile', 'appendFileSync', 'createReadStream', 'createWriteStream',
    'existsSync', 'lstat', 'lstatSync', 'mkdir', 'mkdirSync', 'open', 'read', 'readFile',
    'readFileSync', 'readdir', 'readdirSync', 'readlink', 'readlinkSync', 'realpath', 'realpathSync',
    'rename', 'renameSync', 'rm', 'rmSync', 'stat', 'statSync', 'unlink', 'unlinkSync', 'watch',
    'watchFile', 'write', 'writeFile', 'writeFileSync',
  ]);
  patchMethods(fs.promises, 'fs.promises', [
    'access', 'appendFile', 'lstat', 'mkdir', 'open', 'readFile', 'readdir', 'readlink', 'realpath',
    'rename', 'rm', 'stat', 'unlink', 'writeFile',
  ]);
  patchMethods(net, 'net', ['Socket', 'connect', 'createConnection', 'createServer']);
  patchMethods(http, 'http', ['Agent', 'ClientRequest', 'Server', 'createServer', 'get', 'request']);
  patchMethods(https, 'https', ['Agent', 'Server', 'createServer', 'get', 'request']);
  patchMethods(tls, 'tls', ['TLSSocket', 'connect', 'createSecureContext', 'createServer']);
  patchMethods(crypto, 'crypto', [
    'createHmac', 'createPrivateKey', 'createSecretKey', 'createSign', 'generateKey',
    'generateKeyPair', 'hkdf', 'pbkdf2', 'randomBytes', 'randomFill', 'randomFillSync',
    'randomInt', 'randomUUID', 'scrypt', 'sign',
  ]);
  syncBuiltinESMExports();

  try {
    await run(attempts);
  } finally {
    for (const { target, key, descriptor } of patches.reverse()) {
      if (descriptor === undefined) delete target[key];
      else Object.defineProperty(target, key, descriptor);
    }
    syncBuiltinESMExports();
  }
  return attempts;
}

test('instrument-spec source is pure and imports only narrow canonical contract leaves', () => {
  const files = filesUnder(SOURCE_ROOT, '.ts');
  assert.deepEqual(
    files.map((file) => path.basename(file)),
    [
      'capabilities.ts', 'contract.ts', 'exact.ts', 'filterSchemas.ts', 'index.ts',
      'normalize.ts', 'sizing.ts', 'snapshot.ts', 'spotOrderTifCapability.ts',
      'types.ts', 'waiting.ts',
    ],
  );
  assert.deepEqual(staticViolations(files), []);
});

test('every built instrument-spec module imports inertly under ambient and egress tripwires', async () => {
  const sourceFiles = filesUnder(SOURCE_ROOT, '.ts');
  const importErrors = [];
  let imported = 0;

  const attempts = await withImportTripwires(async () => {
    for (const [index, source] of sourceFiles.entries()) {
      const relative = path.relative(SOURCE_ROOT, source).replace(/\.ts$/, '.js');
      const target = path.join(DIST_ROOT, relative);
      try {
        await import(`${pathToFileURL(target).href}?l04-instrument-purity=${index}`);
        imported += 1;
      } catch (error) {
        importErrors.push(`${relative}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  });

  const applicationAttempts = attempts.filter((attempt) => attempt !== 'process.env:WATCH_REPORT_DEPENDENCIES');
  assert.deepEqual(importErrors, []);
  assert.equal(imported, sourceFiles.length);
  assert.deepEqual(applicationAttempts, []);
});
