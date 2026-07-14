import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

import ts from 'typescript';

const SOURCE_ROOT = path.resolve('server/src/liveEdge/adapters/binanceSignedKernel');
const DIST_ROOT = path.resolve('server/dist/liveEdge/adapters/binanceSignedKernel');

const FORBIDDEN_MODULE_ROOTS = new Set([
  'child_process',
  'cluster',
  'crypto',
  'dgram',
  'dns',
  'fs',
  'http',
  'http2',
  'https',
  'net',
  'process',
  'tls',
  'timers',
  'worker_threads',
]);
const FORBIDDEN_PACKAGES = new Set(['axios', 'undici', 'ws']);
const FORBIDDEN_AMBIENT_CALLS = new Set([
  'fetch',
  'queueMicrotask',
  'setImmediate',
  'setInterval',
  'setTimeout',
]);
const FORBIDDEN_NETWORK_CONSTRUCTORS = new Set([
  'EventSource',
  'WebSocket',
  'XMLHttpRequest',
]);
const DIRECT_KEY_API_CALLS = new Set([
  'createHmac',
  'createPrivateKey',
  'createSecretKey',
  'createSign',
  'generateKey',
  'generateKeyPair',
  'getRandomValues',
  'hkdf',
  'pbkdf2',
  'randomBytes',
  'randomUUID',
  'scrypt',
]);
const MODULE_CONTAINER_TYPES = new Set(['Map', 'Set', 'WeakMap', 'WeakSet']);
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

function forbiddenImportReason(specifier) {
  const root = normalizedModuleRoot(specifier);
  if (FORBIDDEN_MODULE_ROOTS.has(root)) return `imports forbidden ambient/key boundary ${specifier}`;
  if (FORBIDDEN_PACKAGES.has(root)) return `imports transport package ${specifier}`;
  if (root.startsWith('@aws-sdk/')) return `imports cloud boundary ${specifier}`;

  const normalized = specifier.replaceAll('\\', '/');
  if (/(?:^|\/)binance\/client(?:\.[cm]?[jt]s)?$/i.test(normalized)
    || /(?:^|\/)binance-client(?:\/|\.|$)/i.test(normalized)) {
    return `imports legacy Binance client ${specifier}`;
  }
  if (/(?:^|\/)services\/(?:account|loans|orders|risk)(?:\/|\.|$)/i.test(normalized)) {
    return `imports legacy private or money service ${specifier}`;
  }
  if (/(?:^|\/)foundation\/exchange\/binanceUsdM(?:\/|\.|$)/i.test(normalized)) {
    return `imports dormant Foundation Binance client ${specifier}`;
  }
  if (/(?:^|\/)foundation\/(?:execution|reconciliation)(?:\/|\.|$)/i.test(normalized)) {
    return `imports canonical Foundation execution/reconciliation authority ${specifier}`;
  }
  if (/(?:^|\/)(?:capitalFoundation|ledger|systemIntegration)(?:\/|\.|$)/i.test(normalized)) {
    return `imports canonical runtime/persistence authority ${specifier}`;
  }
  return null;
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
      if (!constructorName || !MODULE_CONTAINER_TYPES.has(constructorName)) continue;
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

function staticViolations(files) {
  const violations = [];
  for (const file of files) {
    const tree = parse(file);
    const report = (node, detail) => violations.push(`${location(file, tree, node)} ${detail}`);
    const containers = moduleContainers(tree, report);

    walk(tree, (node) => {
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
        const specifier = moduleName(node.moduleSpecifier);
        if (specifier !== null) {
          const reason = forbiddenImportReason(specifier);
          if (reason !== null) report(node.moduleSpecifier, reason);
        }
      }
      if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
        const specifier = moduleName(node.moduleReference.expression);
        if (specifier !== null) {
          const reason = forbiddenImportReason(specifier);
          if (reason !== null) report(node, reason);
        }
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
        if (name === 'require') report(node, 'uses CommonJS require');
        if (name === 'getBuiltinModule') report(node, 'uses process.getBuiltinModule');
        if (name && FORBIDDEN_AMBIENT_CALLS.has(name)) report(node, `calls ambient primitive ${name}`);
        if (name && DIRECT_KEY_API_CALLS.has(name)) report(node, `calls direct cryptographic/key API ${name}`);

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
        if (/^X-MBX-APIKEY$/i.test(node.text)) report(node, 'embeds a credential header literal');
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
    throw new Error(`SIGNED_KERNEL_IMPORT_BOUNDARY_USED:${name}`);
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
        throw new Error(`SIGNED_KERNEL_IMPORT_BOUNDARY_USED:${name}`);
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

  try {
    await run(attempts);
  } finally {
    for (const { target, key, descriptor } of patches.reverse()) {
      if (descriptor === undefined) delete target[key];
      else Object.defineProperty(target, key, descriptor);
    }
  }
  return attempts;
}

test('signed-kernel source has no ambient, key-owning, endpoint, duplicate-authority, or global-registry seam', () => {
  const files = filesUnder(SOURCE_ROOT, '.ts');
  assert.ok(files.length >= 7, 'expected the complete L03 signed-kernel source tree');
  assert.deepEqual(staticViolations(files), []);
});

test('every built signed-kernel module imports without ambient effects', async () => {
  const sourceFiles = filesUnder(SOURCE_ROOT, '.ts');
  const importErrors = [];
  let imported = 0;

  const attempts = await withImportTripwires(async () => {
    for (const [index, source] of sourceFiles.entries()) {
      const relative = path.relative(SOURCE_ROOT, source).replace(/\.ts$/, '.js');
      const target = path.join(DIST_ROOT, relative);
      try {
        await import(`${pathToFileURL(target).href}?l03-signed-kernel-purity=${index}`);
        imported += 1;
      } catch (error) {
        importErrors.push(`${relative}: ${error instanceof Error ? error.message : 'NON_ERROR_IMPORT_FAILURE'}`);
      }
    }
  });

  const applicationAttempts = attempts.filter((attempt) => attempt !== 'process.env:WATCH_REPORT_DEPENDENCIES');
  assert.deepEqual(importErrors, []);
  assert.equal(imported, sourceFiles.length);
  assert.deepEqual(applicationAttempts, []);
});
