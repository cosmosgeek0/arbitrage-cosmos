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

const SOURCE_ROOT = path.resolve('server/src/liveEdge/adapters/exchangeTwin');
const DIST_ROOT = path.resolve('server/dist/liveEdge/adapters/exchangeTwin');

const EXACT_IMPORTS = new Map([
  ['node:crypto', new Set(['createHash'])],
  ['node:util', new Set(['types'])],
  ['../../../capitalFoundation/contracts/decimal.js', new Set([
    'ExactDecimal',
    'NonNegativeDecimal',
    'addExactDecimals',
    'compareExactDecimals',
    'divideExactDecimals',
    'minimumExactDecimal',
    'multiplyExactDecimals',
    'normalizeExactDecimal',
    'normalizeNonNegativeExactDecimal',
    'subtractExactDecimals',
  ])],
  ['../../../foundation/contracts/index.js', new Set(['canonicalJson'])],
  ['../binanceInstrumentSpecs/sizing.js', new Set([
    'bindSpotOrderTifCapability',
    'preflightInstrumentSizing',
  ])],
  ['../binanceInstrumentSpecs/spotOrderTifCapability.js', new Set([
    'validateSpotOrderTifCapability',
  ])],
  ['../binanceSignedKernel/rateBudget.js', new Set([
    'BinanceRateBudgetState',
    'BinanceRateReservationDecision',
    'reserveRateBudget',
  ])],
  ['../binanceSignedKernel/request.js', new Set(['constructUnsignedRequest'])],
  ['../durableMutationJournal/journal.js', new Set(['validateMutationJournalSnapshot'])],
]);
const TYPE_ONLY_IMPORTS = new Map([
  ['../binanceInstrumentSpecs/types.js', new Set([
    'BinanceInstrumentRegistrySnapshot',
    'BindBinanceSpotOrderTifCapabilityResult',
    'InstrumentSizingRequest',
    'InstrumentSizingResult',
  ])],
  ['../durableMutationJournal/types.js', new Set([
    'MutationJournalSnapshot',
    'SyntheticSubmissionBoundaryDecision',
  ])],
]);
const EXACT_TYPE_BINDINGS = new Map([
  ['../binanceSignedKernel/rateBudget.js', new Set([
    'BinanceRateBudgetState',
    'BinanceRateReservationDecision',
  ])],
]);
const EXACT_RUNTIME_BINDINGS = new Map([
  ['../binanceInstrumentSpecs/sizing.js', new Set([
    'bindSpotOrderTifCapability',
    'preflightInstrumentSizing',
  ])],
  ['../binanceInstrumentSpecs/spotOrderTifCapability.js', new Set([
    'validateSpotOrderTifCapability',
  ])],
  ['../binanceSignedKernel/rateBudget.js', new Set(['reserveRateBudget'])],
  ['../binanceSignedKernel/request.js', new Set(['constructUnsignedRequest'])],
  ['../durableMutationJournal/journal.js', new Set(['validateMutationJournalSnapshot'])],
]);
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
const FORBIDDEN_SIGNER_RANDOM_CALLS = new Set([
  'createHmac', 'createPrivateKey', 'createSecretKey', 'createSign', 'generateKey',
  'generateKeyPair', 'getRandomValues', 'hkdf', 'pbkdf2', 'randomBytes',
  'randomFill', 'randomFillSync', 'randomInt', 'randomUUID', 'scrypt', 'sign',
]);
const FORBIDDEN_ACTION_CALLS = new Set([
  'allocate', 'applyControl', 'authorize', 'borrow', 'cancelOrder', 'createOrder',
  'execute', 'mutateControl', 'placeOrder', 'reconcile', 'repay', 'reserve',
  'send', 'sendOrder', 'signRequest', 'submitOrder', 'testOrder', 'transfer',
  'withdraw',
]);
const FORBIDDEN_AUTHORITY_IDENTIFIERS = new Set([
  'BinanceClient', 'CapitalAllocator', 'ExecutionEngine', 'Ledger', 'OrderService',
  'ReconciliationEngine', 'Signer', 'SystemIntegration', 'WebSocketClient',
]);
const AUTHORITY_EXPORT = /(?:client|connector|orderService|ledger|outbox|repository|signer|authoriz|sendOrder|submitOrder|placeOrder|createOrder|cancelOrder|testOrder|executeOrder|reconcileOrder|persistOrder|writeOrder)/i;
const MODULE_CONTAINERS = new Set(['Map', 'Set', 'WeakMap', 'WeakSet']);
const CONTAINER_MUTATIONS = new Set(['add', 'clear', 'delete', 'set']);

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
  if (ts.isIdentifier(node) || ts.isPrivateIdentifier(node) || ts.isStringLiteralLike(node)) {
    return node.text;
  }
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  if (ts.isElementAccessExpression(node)
    && node.argumentExpression
    && ts.isStringLiteralLike(node.argumentExpression)) {
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
  if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) names.push('*');
  return names;
}

function typeOnlyImportedNames(node) {
  const names = new Set();
  const clause = node.importClause;
  if (!clause) return names;
  if (clause.isTypeOnly) return new Set(importedNames(node));
  if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
    for (const element of clause.namedBindings.elements) {
      if (element.isTypeOnly) names.add(element.propertyName?.text ?? element.name.text);
    }
  }
  return names;
}

function isTypeOnlyImport(node) {
  const clause = node.importClause;
  if (!clause) return false;
  if (clause.isTypeOnly) return true;
  return clause.namedBindings !== undefined
    && ts.isNamedImports(clause.namedBindings)
    && clause.namedBindings.elements.length > 0
    && clause.namedBindings.elements.every((element) => element.isTypeOnly);
}

function allowedImportReason(file, node, specifier) {
  const normalized = specifier.replaceAll('\\', '/');
  if (normalized.startsWith('./')) {
    const resolved = path.resolve(path.dirname(file), normalized.replace(/\.js$/, '.ts'));
    if (resolved.startsWith(`${SOURCE_ROOT}${path.sep}`) && fs.existsSync(resolved)) return null;
    return `imports a relative module outside the L07 exchange twin ${specifier}`;
  }

  const exactNames = EXACT_IMPORTS.get(normalized);
  if (exactNames !== undefined) {
    const names = importedNames(node);
    if (names.length === 0 || !names.every((name) => exactNames.has(name))) {
      return `imports names outside the narrow pure leaf ${specifier}: ${names.join(',')}`;
    }
    const typeOnlyNames = typeOnlyImportedNames(node);
    const requiredTypes = EXACT_TYPE_BINDINGS.get(normalized) ?? new Set();
    const requiredRuntime = EXACT_RUNTIME_BINDINGS.get(normalized) ?? new Set();
    if ([...requiredTypes].some((name) => names.includes(name) && !typeOnlyNames.has(name))) {
      return `imports an owner type as runtime from ${specifier}`;
    }
    if ([...requiredRuntime].some((name) => names.includes(name) && typeOnlyNames.has(name))) {
      return `imports an owner function as type-only from ${specifier}`;
    }
    return null;
  }

  const typeNames = TYPE_ONLY_IMPORTS.get(normalized);
  if (typeNames !== undefined) {
    const names = importedNames(node);
    if (!isTypeOnlyImport(node)) return `imports the L04 owner at runtime ${specifier}`;
    return names.length > 0 && names.every((name) => typeNames.has(name))
      ? null
      : `imports types outside the closed L04 evidence seam ${specifier}: ${names.join(',')}`;
  }

  const root = normalizedModuleRoot(normalized);
  if (FORBIDDEN_NODE_ROOTS.has(root)) return `imports ambient boundary ${specifier}`;
  if (FORBIDDEN_PACKAGES.has(root) || root.startsWith('@aws-sdk/')) {
    return `imports transport/cloud package ${specifier}`;
  }
  if (/(?:^|\/)(?:ledger|systemIntegration|services)(?:\/|\.|$)/i.test(normalized)) {
    return `imports persistence/runtime authority ${specifier}`;
  }
  if (/(?:^|\/)foundation\/(?:execution|reconciliation)(?:\/|\.|$)/i.test(normalized)) {
    return `imports canonical Foundation execution/reconciliation authority ${specifier}`;
  }
  if (/(?:^|\/)foundation\/exchange(?:\/|\.|$)/i.test(normalized)) {
    return `imports an exchange client owner ${specifier}`;
  }
  return `imports an unapproved external or owner module ${specifier}`;
}

function location(file, tree, node) {
  const point = tree.getLineAndCharacterOfPosition(node.getStart(tree));
  return `${path.relative(process.cwd(), file)}:${point.line + 1}:${point.character + 1}`;
}

function isClosedSetSeed(node) {
  const current = unwrap(node);
  if (current && ts.isIdentifier(current)) return /^[A-Z][A-Z0-9_]*$/.test(current.text);
  if (!current || !ts.isArrayLiteralExpression(current)) return false;
  return current.elements.every((element) => {
    const value = unwrap(element);
    return value !== undefined
      && !ts.isSpreadElement(value)
      && (ts.isStringLiteralLike(value)
        || ts.isNumericLiteral(value)
        || value.kind === ts.SyntaxKind.TrueKeyword
        || value.kind === ts.SyntaxKind.FalseKeyword);
  });
}

function moduleContainers(tree, report) {
  const containers = new Set();
  for (const statement of tree.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    const isConst = (statement.declarationList.flags & ts.NodeFlags.Const) !== 0;
    if (!isConst) report(statement.declarationList, 'declares module-scope let/var state');
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name)) continue;
      const initializer = unwrap(declaration.initializer);
      if (!initializer || !ts.isNewExpression(initializer)) continue;
      const constructorName = nodeName(initializer.expression);
      if (!constructorName || !MODULE_CONTAINERS.has(constructorName)) continue;
      containers.add(declaration.name.text);
      if (constructorName !== 'Set'
        || !/^[A-Z][A-Z0-9_]*$/.test(declaration.name.text)
        || initializer.arguments?.length !== 1
        || !isClosedSetSeed(initializer.arguments[0])) {
        report(initializer, `creates module-scope mutable ${constructorName} registry`);
      }
    }
  }
  return containers;
}

function exportedRuntimeName(node) {
  const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
  if (!modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) return null;
  if (ts.isFunctionDeclaration(node)
    || ts.isClassDeclaration(node)
    || ts.isVariableStatement(node)) {
    if (ts.isVariableStatement(node)) {
      return node.declarationList.declarations
        .map((declaration) => nodeName(declaration.name))
        .filter((name) => name !== null);
    }
    return node.name ? [node.name.text] : [];
  }
  return null;
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
        const normalized = specifier?.replaceAll('\\', '/');
        const resolved = normalized?.startsWith('./')
          ? path.resolve(path.dirname(file), normalized.replace(/\.js$/, '.ts'))
          : null;
        if (resolved === null
          || !resolved.startsWith(`${SOURCE_ROOT}${path.sep}`)
          || !fs.existsSync(resolved)) {
          report(node.moduleSpecifier, 're-exports a module outside the L07 exchange twin');
        }
      }
      if (ts.isImportEqualsDeclaration(node)) report(node, 'uses import-equals boundary');

      const runtimeNames = exportedRuntimeName(node);
      for (const name of runtimeNames ?? []) {
        if (AUTHORITY_EXPORT.test(name)) report(node, `exports authority-bearing runtime name ${name}`);
      }

      if (ts.isIdentifier(node) && FORBIDDEN_AUTHORITY_IDENTIFIERS.has(node.text)) {
        report(node, `references forbidden owner/client identifier ${node.text}`);
      }

      const accessPath = (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node))
        ? expressionPath(node)
        : null;
      if (accessPath && /^(?:globalThis\.)?(?:process|Bun|Deno)\.env(?:\.|$)/.test(accessPath)) {
        report(node, 'reads ambient environment state');
      }
      if (accessPath && /^(?:globalThis\.)?console(?:\.|$)/.test(accessPath)) {
        report(node, 'accesses console output');
      }
      if (accessPath && /^(?:globalThis\.)?crypto(?:\.|$)/.test(accessPath)) {
        report(node, 'accesses a direct cryptographic/key API');
      }

      if (ts.isCallExpression(node)) {
        if (node.expression.kind === ts.SyntaxKind.ImportKeyword) report(node, 'uses dynamic import');
        const name = nodeName(node.expression);
        if (name === 'require' || name === 'getBuiltinModule') report(node, `uses ${name}`);
        if (name && FORBIDDEN_AMBIENT_CALLS.has(name)) report(node, `calls ambient primitive ${name}`);
        if (name && FORBIDDEN_SIGNER_RANDOM_CALLS.has(name)) {
          report(node, `calls signer/random primitive ${name}`);
        }
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
        if (name === 'CryptoKey' || name === 'SubtleCrypto') report(node, `constructs direct key API ${name}`);
      }

      if (ts.isStringLiteralLike(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
        if (/^(?:https?|wss?):\/\//i.test(node.text)
          || /^\/(?:api|sapi|fapi|dapi|vapi)\/v\d+(?:\/|$)/i.test(node.text)) {
          report(node, 'embeds an exchange/network endpoint literal');
        }
        if (/^X-MBX-APIKEY$/i.test(node.text) || /(?:^|[?&])signature=/i.test(node.text)) {
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
    throw new Error(`L07_TWIN_IMPORT_BOUNDARY_USED:${name}`);
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
        throw new Error(`L07_TWIN_IMPORT_BOUNDARY_USED:${name}`);
      }
    });
  }
  for (const name of ['debug', 'error', 'info', 'log', 'trace', 'warn']) {
    patchProperty(patches, console, name, denied(`console.${name}`));
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
    throw new Error('L07_TWIN_IMPORT_BOUNDARY_USED:fs.openSync');
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

test('exchange-twin source is pure, synthetic-only and imports only narrow owner leaves', () => {
  const files = filesUnder(SOURCE_ROOT, '.ts');
  assert.ok(files.length >= 3, 'expected the L07 exchange-twin source tree');
  assert.deepEqual(staticViolations(files), []);
});

test('every built exchange-twin module imports inertly and exports no action authority', async () => {
  const sourceFiles = filesUnder(SOURCE_ROOT, '.ts');
  const importErrors = [];
  const authorityExports = [];
  let imported = 0;

  const attempts = await withImportTripwires(async () => {
    for (const [index, source] of sourceFiles.entries()) {
      const relative = path.relative(SOURCE_ROOT, source).replace(/\.ts$/, '.js');
      const target = path.join(DIST_ROOT, relative);
      try {
        const namespace = await import(`${pathToFileURL(target).href}?l07-exchange-twin-purity=${index}`);
        imported += 1;
        for (const name of Object.keys(namespace)) {
          if (AUTHORITY_EXPORT.test(name)) authorityExports.push(`${relative}:${name}`);
        }
      } catch (error) {
        importErrors.push(`${relative}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  });

  const applicationAttempts = attempts.filter((attempt) => attempt !== 'process.env:WATCH_REPORT_DEPENDENCIES');
  assert.deepEqual(importErrors, []);
  assert.equal(imported, sourceFiles.length);
  assert.deepEqual(authorityExports, []);
  assert.deepEqual(applicationAttempts, []);
});
