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

const SOURCE_ROOT = path.resolve('server/src/liveEdge/adapters/binancePrivateTruth');
const DIST_ROOT = path.resolve('server/dist/liveEdge/adapters/binancePrivateTruth');

const EXACT_IMPORTS = new Map([
  ['node:crypto', new Set(['createHash'])],
  ['node:util', new Set(['types'])],
  ['../binanceContracts/index.js', new Set([
    'BINANCE_CONTRACT_MATRIX_CONTENT_SHA256',
    'BINANCE_PRIVATE_TRUTH_CONTRACT_EXTENSION_CONTENT_SHA256',
    'BinanceContractRecord',
    'USDM_ALGO_OPEN_ORDERS_CONTRACT_ID',
    'canonicalBinanceContractMatrix',
    'resolveBinancePrivateTruthContractExtension',
  ])],
  ['../binanceContracts/matrix.js', new Set([
    'BINANCE_CONTRACT_MATRIX_CONTENT_SHA256',
  ])],
  ['../binanceContracts/types.js', new Set([
    'BINANCE_CONTRACT_MATRIX_REVISION',
  ])],
  ['../../../capitalFoundation/contracts/decimal.js', new Set([
    'ExactDecimal',
    'NonNegativeDecimal',
    'normalizeExactDecimal',
    'normalizeNonNegativeExactDecimal',
  ])],
  ['../../../foundation/contracts/index.js', new Set([
    'Completeness',
    'DataAuthority',
    'FreshnessReport',
    'createSourcedTimestamp',
    'evaluateFreshness',
    'isCompleteness',
    'isDataAuthority',
    'isValidUtcMillis',
  ])],
  ['../../../intelligenceFoundation/contracts/index.js', new Set([
    'canonicalJson',
    'stableId',
  ])],
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
  'allocate', 'applyControl', 'borrow', 'cancelOrder', 'createOrder', 'execute',
  'mutateControl', 'placeOrder', 'reconcile', 'repay', 'reserve', 'sendOrder',
  'signRequest', 'submitOrder', 'testOrder', 'transfer', 'withdraw',
]);
const FORBIDDEN_AUTHORITY_IDENTIFIERS = new Set([
  'BinanceClient', 'CapitalAllocator', 'Ledger', 'OrderService',
  'ReconciliationEngine', 'WebSocketClient', 'evaluateMultiLegRisk',
]);
const CREDENTIAL_FIELD = /^(?!(?:externalActionAuthorization|signatureKeyType|signatureAuthorized|listenKeyNotFoundCount|listenKeyExpired|SIGNATURE_SUBSCRIPTION_ACCEPTED|SIGNATURE_SUBSCRIPTION_REJECTED)$)(?:(?:api[_-]?key|secret(?:[_-]?key)?|private[_-]?key|signature|listen[_-]?(?:key|token)|session[_-]?(?:key|token)|credentials?|authorization|x[_-]?mbx[_-]?api[_-]?key|access[_-]?token|refresh[_-]?token|bearer[_-]?token|password|passphrase|mnemonic|seed|(?:(?:aws|api)[_-]?client|client[_-]?access)[_-]?secret|secret[_-]?token[_-]?key|api[_-]?credentials?[_-]?key|aws[_-]?(?:signing[_-]?key|access[_-]?key[_-]?(?:id|identifier)))[A-Za-z0-9_-]*|[A-Za-z0-9_-]*(?:api[_-]?key|x[_-]?mbx[_-]?api[_-]?key|private[_-]?key|access[_-]?token|session[_-]?token)[A-Za-z0-9_-]*)$/i;
const RAW_CREDENTIAL_IDENTIFIER = /^(?:api[_-]?key|secret(?:[_-]?key)?|private[_-]?key|signature|listen[_-]?(?:key|token)|session[_-]?(?:key|token)|credentials?|authorization|x[_-]?mbx[_-]?api[_-]?key|access[_-]?token|refresh[_-]?token|bearer[_-]?token|password|passphrase|mnemonic|seed)$/i;
const CREDENTIAL_GUARD_IDENTIFIERS = new Set([
  'AWS_ACCESS_KEY_IDENTIFIER',
  'COMPOUND_SECRET_KEY_COMPACT',
  'PRIVATE_KEY_BLOCK',
  'SECRET_KEY',
  'SECRET_KEY_COMPACT',
  'SECRET_TEXT',
]);
const MODULE_CONTAINERS = new Set(['Map', 'Set', 'WeakMap', 'WeakSet']);

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

function isCredentialField(value) {
  return typeof value === 'string' && CREDENTIAL_FIELD.test(value);
}

function allowedImportReason(file, node, specifier) {
  const normalized = specifier.replaceAll('\\', '/');
  if (normalized.startsWith('./')) {
    const resolved = path.resolve(path.dirname(file), normalized.replace(/\.js$/, '.ts'));
    if (resolved.startsWith(`${SOURCE_ROOT}${path.sep}`) && fs.existsSync(resolved)) return null;
    return `imports a non-private-truth relative module ${specifier}`;
  }

  const exactNames = EXACT_IMPORTS.get(normalized);
  if (exactNames !== undefined) {
    const names = importedNames(node);
    return names.every((name) => exactNames.has(name))
      ? null
      : `imports names outside the closed L05 leaf from ${specifier}: ${names.join(',')}`;
  }

  const root = normalizedModuleRoot(normalized);
  if (FORBIDDEN_NODE_ROOTS.has(root)) return `imports ambient boundary ${specifier}`;
  if (FORBIDDEN_PACKAGES.has(root) || root.startsWith('@aws-sdk/')) {
    return `imports transport/cloud package ${specifier}`;
  }
  if (/ledger|systemIntegration|services|binance\/|foundation\/reconciliation|foundation\/risk|foundation\/execution|capitalFoundation/i.test(normalized)) {
    return `imports a canonical owner or legacy private client ${specifier}`;
  }
  return `imports an unapproved L05 module ${specifier}`;
}

function location(file, tree, node) {
  const point = tree.getLineAndCharacterOfPosition(node.getStart(tree));
  return `${path.relative(process.cwd(), file)}:${point.line + 1}:${point.character + 1}`;
}

function staticViolations(files) {
  const violations = [];
  for (const file of files) {
    const tree = parse(file);
    const report = (node, detail) => violations.push(`${location(file, tree, node)} ${detail}`);

    for (const statement of tree.statements) {
      if (!ts.isVariableStatement(statement)) continue;
      if ((statement.declarationList.flags & ts.NodeFlags.Const) === 0) {
        report(statement.declarationList, 'declares module-scope mutable let/var state');
      }
      for (const declaration of statement.declarationList.declarations) {
        const initializer = unwrap(declaration.initializer);
        if (!initializer || !ts.isNewExpression(initializer)) continue;
        const constructorName = nodeName(initializer.expression);
        if (constructorName && MODULE_CONTAINERS.has(constructorName)) {
          report(initializer, `creates module-scope mutable ${constructorName} state`);
        }
      }
    }

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
          const reason = allowedImportReason(file, { importClause: undefined }, specifier);
          if (reason !== null) report(node.moduleSpecifier, reason);
        }
      }
      if (ts.isImportEqualsDeclaration(node)) report(node, 'uses import-equals boundary');

      if (ts.isIdentifier(node) && FORBIDDEN_AUTHORITY_IDENTIFIERS.has(node.text)) {
        report(node, `references forbidden owner/client identifier ${node.text}`);
      }
      if (ts.isIdentifier(node)
        && RAW_CREDENTIAL_IDENTIFIER.test(node.text)
        && !CREDENTIAL_GUARD_IDENTIFIERS.has(node.text)) {
        report(node, `declares or references raw credential field ${node.text}`);
      }
      if ((ts.isPropertySignature(node) || ts.isPropertyDeclaration(node)
          || ts.isPropertyAssignment(node) || ts.isMethodSignature(node))
        && isCredentialField(nodeName(node.name))) {
        report(node.name, `declares raw credential field ${nodeName(node.name)}`);
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

      if (ts.isCallExpression(node)) {
        if (node.expression.kind === ts.SyntaxKind.ImportKeyword) report(node, 'uses dynamic import');
        const name = nodeName(node.expression);
        if (name === 'require' || name === 'getBuiltinModule') report(node, `uses ${name}`);
        if (name && FORBIDDEN_AMBIENT_CALLS.has(name)) report(node, `calls ambient primitive ${name}`);
        if (name && FORBIDDEN_SIGNER_RANDOM_CALLS.has(name)) report(node, `calls signer/random primitive ${name}`);
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
        if (target && /^(?:Bun|Deno|process)\./.test(target)) {
          report(node, `calls ambient runtime primitive ${target}`);
        }
      }

      if (ts.isNewExpression(node)) {
        const name = nodeName(node.expression);
        if (name && FORBIDDEN_NETWORK_CONSTRUCTORS.has(name)) report(node, `constructs network primitive ${name}`);
        if (name === 'Date' && (node.arguments?.length ?? 0) === 0) {
          report(node, 'constructs Date from ambient wall clock');
        }
      }
      if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
        report(node, 'declares a stateful class in the pure L05 adapter');
      }

      if (ts.isStringLiteralLike(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
        if (/^(?:https?|wss?):\/\//i.test(node.text)
          || /^\/(?:api|sapi|fapi|dapi|vapi)(?:\/|$)/i.test(node.text)
          || /^\/(?:ws|stream|public|market|private)(?:\/|$)/i.test(node.text)) {
          report(node, 'embeds an exchange/network endpoint');
        }
        if (RAW_CREDENTIAL_IDENTIFIER.test(node.text)
          && !file.endsWith(`${path.sep}bounds.ts`)) {
          report(node, 'embeds a raw credential field name');
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

async function withRuntimeTripwires(run) {
  const attempts = [];
  const patches = [];
  const denied = (name) => function deniedPrivateTruthBoundary() {
    attempts.push(name);
    throw new Error(`L05_PRIVATE_TRUTH_BOUNDARY_USED:${name}`);
  };

  patchProperty(patches, Date, 'now', denied('Date.now'));
  patchProperty(patches, Math, 'random', denied('Math.random'));
  patchProperty(patches, globalThis, 'fetch', denied('fetch'));
  for (const name of ['queueMicrotask', 'setImmediate', 'setInterval', 'setTimeout']) {
    patchProperty(patches, globalThis, name, denied(name));
  }
  for (const name of ['EventSource', 'WebSocket', 'XMLHttpRequest']) {
    patchProperty(patches, globalThis, name, class ForbiddenPrivateTruthNetworkPrimitive {
      constructor() {
        attempts.push(name);
        throw new Error(`L05_PRIVATE_TRUTH_BOUNDARY_USED:${name}`);
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
    throw new Error('L05_PRIVATE_TRUTH_BOUNDARY_USED:fs.openSync');
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

function exportedFunction(module, name, source) {
  assert.equal(typeof module[name], 'function', `${source} must export ${name}`);
  return module[name];
}

function assertNoActionAuthority(state) {
  assert.equal(state.sendEligible, false);
  assert.equal(state.externalActionAuthorization, 'NONE');
  assert.equal(state.actionAuthority, 'NONE_RECORD_ONLY');
  assert.ok([false, 'NONE'].includes(state.accountReadAuthorized ?? state.accountReadAuthority));
  assert.ok([false, 'NONE'].includes(state.mutationAuthorized ?? state.mutationAuthority));
  assert.equal(state.reconciliationAuthority, 'NONE');
  assert.equal(state.capitalAuthority, 'NONE');
  assert.equal(state.riskAuthority, 'NONE');
}

test('private-truth source uses only closed pure owner leaves and no ambient or action boundary', () => {
  const files = filesUnder(SOURCE_ROOT, '.ts');
  assert.ok(files.length >= 11, 'expected the complete L05 private-truth source family');
  assert.deepEqual(staticViolations(files), []);
});

test('every built private-truth module imports inertly and hostile public reducers remain ambient-free', async () => {
  const sourceFiles = filesUnder(SOURCE_ROOT, '.ts');
  const imported = new Map();
  const importErrors = [];

  const attempts = await withRuntimeTripwires(async () => {
    for (const [index, source] of sourceFiles.entries()) {
      const relative = path.relative(SOURCE_ROOT, source).replace(/\.ts$/, '.js');
      const target = path.join(DIST_ROOT, relative);
      try {
        imported.set(path.basename(source, '.ts'), await import(
          `${pathToFileURL(target).href}?l05-private-truth-purity=${index}`
        ));
      } catch (error) {
        importErrors.push(`${relative}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    assert.deepEqual(importErrors, []);
    assert.equal(imported.size, sourceFiles.length);

    const bounds = imported.get('bounds');
    const publicBarrel = imported.get('index');
    const freshness = imported.get('freshness');
    const permissions = imported.get('permissions');
    const projection = imported.get('projection');
    const handoff = imported.get('handoff');
    const waiting = imported.get('waiting');
    const spot = imported.get('spotLifecycle');
    const usdm = imported.get('usdmLifecycle');
    const margin = imported.get('marginLifecycle');
    for (const [name, module] of Object.entries({
      bounds, publicBarrel, freshness, permissions, projection, handoff, waiting, spot, usdm, margin,
    })) assert.ok(module, `missing required L05 built module ${name}`);

    assert.ok(publicBarrel.PRIVATE_DATA_BOUNDS);
    for (const unsafeBoundExport of [
      'deepFreezePrivate',
      'privateAccountFingerprintReference',
      'privateAccountRealmReference',
      'privateArray',
      'privateBoolean',
      'privateIdentifier',
      'privateInteger',
      'privateProfileReference',
      'privateRecord',
      'privateSortedUnique',
      'privateString',
      'privateToken',
      'snapshotPrivateData',
    ]) {
      assert.equal(
        Object.hasOwn(publicBarrel, unsafeBoundExport),
        false,
        `public barrel must not expose hostile-input helper ${unsafeBoundExport}`,
      );
    }

    const snapshotPrivateData = exportedFunction(bounds, 'snapshotPrivateData', 'bounds');
    for (const forbiddenField of [
      'credential', 'credentials', 'listenToken', 'listen_token', 'sessionToken',
      'session-token', 'password', 'passphrase', 'mnemonic', 'seed', 'bearerToken',
      'bearer_token', 'awsClientSecret', 'apiClientSecret', 'clientAccessSecretId',
      'secretTokenKey', 'apiCredentialKey', 'awsSigningKey',
    ]) {
      assert.throws(
        () => snapshotPrivateData({ outer: { [forbiddenField]: 'fixture-sensitive-value' } }),
        /secret-shaped field name/i,
      );
    }
    for (const forbiddenText of [
      'password=fixture-sensitive-value',
      'sessionToken: fixture-sensitive-value',
      `Bearer ${'A'.repeat(40)}`,
      'mnemonic: fixture sensitive phrase',
      'secretTokenKey=fixture-sensitive-value',
      'apiCredentialKey: fixture-sensitive-value',
      'awsSigningKey=fixture-sensitive-value',
      `jwt:eyJabcde.abcdefgh.ijklmnop`,
      `AKIA${'A1'.repeat(8)}`,
      '-----BEGIN OPENSSH PRIVATE KEY-----\nfixture',
      '-----BEGIN DSA PRIVATE KEY-----\nfixture',
      '-----BEGIN PGP PRIVATE KEY BLOCK-----\nfixture',
    ]) {
      assert.throws(
        () => snapshotPrivateData({ outer: { note: forbiddenText } }),
        /secret-shaped text/i,
      );
    }
    assert.throws(
      () => snapshotPrivateData({ outer: { opaqueId: 'A'.repeat(64) } }),
      /secret-shaped text/i,
    );
    assert.doesNotThrow(() => snapshotPrivateData({ matrixSha256: 'a'.repeat(64) }));

    const trapAttempts = [];
    const hostile = new Proxy(Object.create(null), {
      get() { trapAttempts.push('get'); throw new Error('HOSTILE_GET'); },
      getOwnPropertyDescriptor() { trapAttempts.push('getOwnPropertyDescriptor'); throw new Error('HOSTILE_DESCRIPTOR'); },
      getPrototypeOf() { trapAttempts.push('getPrototypeOf'); throw new Error('HOSTILE_PROTOTYPE'); },
      ownKeys() { trapAttempts.push('ownKeys'); throw new Error('HOSTILE_KEYS'); },
    });
    const { proxy: revoked, revoke } = Proxy.revocable(Object.create(null), {});
    revoke();

    for (const candidate of [hostile, revoked]) {
      assert.throws(() => snapshotPrivateData(candidate));
      assert.throws(() => exportedFunction(freshness, 'evaluatePrivateFactFreshness', 'freshness')(candidate, 0));
      assert.throws(() => exportedFunction(permissions, 'evaluatePrivatePermissions', 'permissions')(candidate));
      assert.throws(() => exportedFunction(projection, 'projectPrivateTruth', 'projection')(candidate));
      assert.throws(() => exportedFunction(handoff, 'createPrivateComparisonHandoff', 'handoff')(candidate));
      const waitingRejected = exportedFunction(waiting, 'decideWaitingPrivateTruth', 'waiting')(candidate);
      assert.equal(waitingRejected.state, 'BLOCKED');
      assertNoActionAuthority(waitingRejected);
    }

    const spotState = exportedFunction(spot, 'createSpotSignatureLifecycleState', 'spotLifecycle')();
    const spotRejected = exportedFunction(spot, 'reduceSpotSignatureLifecycle', 'spotLifecycle')(
      spotState,
      hostile,
    );
    assert.equal(spotRejected.accepted, false);
    assertNoActionAuthority(spotRejected.state);

    const usdmState = exportedFunction(usdm, 'createInitialUsdmPrivateLifecycleState', 'usdmLifecycle')(0);
    const usdmRejected = exportedFunction(usdm, 'reduceUsdmPrivateLifecycle', 'usdmLifecycle')(
      usdmState,
      hostile,
    );
    assert.equal(usdmRejected.applied, false);
    assertNoActionAuthority(usdmRejected.state);

    const marginState = exportedFunction(margin, 'createInitialMarginRiskLifecycleState', 'marginLifecycle')(0);
    const marginRejected = exportedFunction(margin, 'reduceMarginRiskLifecycle', 'marginLifecycle')(
      marginState,
      hostile,
    );
    assert.equal(marginRejected.applied, false);
    assertNoActionAuthority(marginRejected.state);

    assert.deepEqual(trapAttempts, [], 'hostile proxy traps must not execute');
  });

  const applicationAttempts = attempts.filter((attempt) => (
    attempt !== 'process.env:WATCH_REPORT_DEPENDENCIES'
  ));
  assert.deepEqual(applicationAttempts, []);
});
