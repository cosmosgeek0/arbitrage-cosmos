import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import dgram from 'node:dgram';
import dns from 'node:dns';
import fs from 'node:fs';
import http from 'node:http';
import http2 from 'node:http2';
import https from 'node:https';
import { syncBuiltinESMExports } from 'node:module';
import net from 'node:net';
import path from 'node:path';
import test from 'node:test';
import tls from 'node:tls';
import { pathToFileURL } from 'node:url';

import ts from 'typescript';

const SOURCE_ROOT = path.resolve('server/src/engine/basis');
const DIST_ROOT = path.resolve('server/dist/engine/basis');
const TARGETS = Object.freeze([
  'publicOpportunityObservation.ts',
  'publicOpportunityObservationStore.ts',
  'rolling24hEdgeStatistic.ts',
]);
const RUNTIME_TARGETS = Object.freeze(TARGETS.map((file) => file.replace(/\.ts$/, '.js')));

const ALLOWED_IMPORTS = Object.freeze({
  'publicOpportunityObservation.ts': Object.freeze({
    'node:buffer': Object.freeze(['Buffer']),
    'node:crypto': Object.freeze(['createHash']),
    'node:util': Object.freeze(['types']),
    '../../capitalFoundation/contracts/decimal.js': Object.freeze([
      'ExactDecimal',
      'addExactDecimals',
      'compareExactDecimals',
      'divideExactDecimals',
      'multiplyExactDecimals',
      'normalizeExactDecimal',
      'subtractExactDecimals',
      'sumExactDecimals',
    ]),
    '../../foundation/contracts/identity.js': Object.freeze(['canonicalJson']),
    './math.js': Object.freeze(['EXECUTABLE_BASIS_RETURN_CONTRACT']),
    './types.js': Object.freeze(['BasisDirection']),
  }),
  'publicOpportunityObservationStore.ts': Object.freeze({
    'node:buffer': Object.freeze(['Buffer']),
    './publicOpportunityObservation.js': Object.freeze([
      'MAX_PUBLIC_BASIS_OPPORTUNITY_OBSERVATION_PAYLOAD_BYTES',
      'PUBLIC_BASIS_OPPORTUNITY_OBSERVATION_SCHEMA',
      'PUBLIC_BASIS_OPPORTUNITY_OBSERVATION_VERSION',
      'PublicBasisOpportunityObservation',
      'decodePublicBasisOpportunityObservation',
    ]),
  }),
  'rolling24hEdgeStatistic.ts': Object.freeze({
    '../../capitalFoundation/contracts/decimal.js': Object.freeze([
      'ExactDecimal',
      'compareExactDecimals',
      'normalizeExactDecimal',
    ]),
    './publicOpportunityObservation.js': Object.freeze([
      'PublicBasisOpportunityObservation',
      'decodePublicBasisOpportunityObservation',
    ]),
    './publicOpportunityObservationStore.js': Object.freeze([
      'PUBLIC_BASIS_OPPORTUNITY_OBSERVATION_EVENT_KIND',
    ]),
  }),
});

const FORBIDDEN_AMBIENT_CALLS = new Set([
  'fetch',
  'queueMicrotask',
  'setImmediate',
  'setInterval',
  'setTimeout',
]);
const FORBIDDEN_NETWORK_CONSTRUCTORS = new Set([
  'Agent',
  'ClientRequest',
  'EventSource',
  'Server',
  'Socket',
  'TLSSocket',
  'WebSocket',
  'XMLHttpRequest',
]);
const FORBIDDEN_RANDOM_CALLS = new Set([
  'getRandomValues',
  'random',
  'randomBytes',
  'randomFill',
  'randomFillSync',
  'randomInt',
  'randomUUID',
  'uuid',
  'uuidv4',
  'v4',
]);
const FORBIDDEN_MONEY_ACTION_CALLS = new Set([
  'allocate',
  'applyControl',
  'borrow',
  'cancelOrder',
  'createOrder',
  'execute',
  'mutateControl',
  'placeOrder',
  'reconcile',
  'repay',
  'reserve',
  'sendOrder',
  'sign',
  'signRequest',
  'submitOrder',
  'testOrder',
  'transfer',
  'withdraw',
]);
const FORBIDDEN_CREDENTIAL_NAMES = new Set([
  'apiKey',
  'apiSecret',
  'authorization',
  'credential',
  'credentials',
  'privateKey',
  'secretKey',
  'signature',
]);
const FORBIDDEN_PERSISTENCE_CONSTRUCTORS =
  /^(?:Database|Ledger|Repository|Sqlite|SQLite|Store)(?:Client|Connection|Database|Repository|Store)?$/;

function targetPaths() {
  const files = TARGETS.map((name) => path.join(SOURCE_ROOT, name));
  assert.deepEqual(
    files.filter((file) => fs.existsSync(file)).map((file) => path.basename(file)),
    TARGETS,
    'the proof is intentionally bound to exactly the three source files',
  );
  return files;
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
  const current = unwrap(node);
  if (!current) return null;
  if (ts.isIdentifier(current)
      || ts.isPrivateIdentifier(current)
      || ts.isStringLiteralLike(current)) return current.text;
  if (ts.isPropertyAccessExpression(current)) return current.name.text;
  if (ts.isElementAccessExpression(current)
      && current.argumentExpression
      && ts.isStringLiteralLike(current.argumentExpression)) {
    return current.argumentExpression.text;
  }
  return null;
}

function expressionPath(node) {
  const current = unwrap(node);
  if (!current) return null;
  if (ts.isIdentifier(current)) return current.text;
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

function location(file, tree, node) {
  const point = tree.getLineAndCharacterOfPosition(node.getStart(tree));
  return `${path.relative(process.cwd(), file)}:${point.line + 1}:${point.character + 1}`;
}

function importedBindings(node) {
  const bindings = [];
  const clause = node.importClause;
  if (!clause) return bindings;
  if (clause.name) bindings.push({ imported: 'default', local: clause.name.text });
  if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
    bindings.push({ imported: '*', local: clause.namedBindings.name.text });
  }
  if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
    for (const element of clause.namedBindings.elements) {
      bindings.push({
        imported: element.propertyName?.text ?? element.name.text,
        local: element.name.text,
      });
    }
  }
  return bindings;
}

function staticViolations(files) {
  const violations = [];
  for (const file of files) {
    const name = path.basename(file);
    const tree = parse(file);
    const report = (node, detail) => violations.push(`${location(file, tree, node)} ${detail}`);

    for (const statement of tree.statements) {
      if (ts.isExpressionStatement(statement)
          || ts.isForStatement(statement)
          || ts.isForInStatement(statement)
          || ts.isForOfStatement(statement)
          || ts.isWhileStatement(statement)
          || ts.isDoStatement(statement)
          || ts.isIfStatement(statement)
          || ts.isTryStatement(statement)
          || ts.isThrowStatement(statement)) {
        report(statement, 'contains executable module-scope control flow');
      }
      if (!ts.isVariableStatement(statement)) continue;
      for (const declaration of statement.declarationList.declarations) {
        if (!declaration.initializer) continue;
        walk(declaration.initializer, (node) => {
          if (ts.isAwaitExpression(node)) report(node, 'uses top-level await');
          if (ts.isNewExpression(node)) report(node, 'constructs module-scope state');
          if (ts.isCallExpression(node)) {
            const target = expressionPath(node.expression);
            if (target !== 'Object.freeze' && target !== 'normalizeExactDecimal') {
              report(node, `calls ${target ?? 'a dynamic expression'} at module scope`);
            }
          }
        });
      }
    }

    walk(tree, (node) => {
      if (ts.isImportDeclaration(node)) {
        const specifier = ts.isStringLiteralLike(node.moduleSpecifier)
          ? node.moduleSpecifier.text
          : null;
        if (specifier === null) {
          report(node, 'uses a non-literal import');
        } else {
          const allowed = ALLOWED_IMPORTS[name]?.[specifier];
          if (!allowed) {
            report(node.moduleSpecifier, `imports unapproved network/private/persistence/UI owner ${specifier}`);
          } else {
            const bindings = importedBindings(node);
            const actual = bindings.map(({ imported }) => imported).sort();
            assert.deepEqual(
              actual,
              [...allowed].sort(),
              `${name} must retain its exact narrow import surface from ${specifier}`,
            );
            for (const binding of bindings) {
              if (binding.imported !== binding.local) {
                report(node, `aliases import ${binding.imported} as ${binding.local}`);
              }
            }
          }
        }
      }
      if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
        report(node, 're-exports another module');
      }
      if (ts.isImportEqualsDeclaration(node)) report(node, 'uses import-equals');

      const accessPath = (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node))
        ? expressionPath(node)
        : null;
      if (accessPath && /^(?:globalThis\.)?(?:process|Bun|Deno)\.env(?:\.|$)/.test(accessPath)) {
        report(node, 'reads ambient environment state');
      }
      if (accessPath && /^(?:globalThis\.)?console(?:\.|$)/.test(accessPath)) {
        report(node, 'writes ambient console state');
      }

      if (ts.isCallExpression(node)) {
        if (node.expression.kind === ts.SyntaxKind.ImportKeyword) report(node, 'uses dynamic import');
        const nameAtCall = nodeName(node.expression);
        if (nameAtCall === 'require' || nameAtCall === 'getBuiltinModule') {
          report(node, `uses ${nameAtCall}`);
        }
        if (nameAtCall && FORBIDDEN_AMBIENT_CALLS.has(nameAtCall)) {
          report(node, `calls ambient/timer primitive ${nameAtCall}`);
        }
        if (nameAtCall && FORBIDDEN_RANDOM_CALLS.has(nameAtCall)) {
          report(node, `calls random/UUID primitive ${nameAtCall}`);
        }
        if (nameAtCall && FORBIDDEN_MONEY_ACTION_CALLS.has(nameAtCall)) {
          report(node, `calls money/private action ${nameAtCall}`);
        }
        const target = expressionPath(node.expression);
        if (target === 'Date.now'
            || target === 'globalThis.Date.now'
            || target === 'performance.now'
            || target === 'globalThis.performance.now'
            || target === 'process.hrtime'
            || target === 'process.uptime'
            || target === 'Temporal.Now'
            || target?.startsWith('Temporal.Now.')) {
          report(node, 'reads an ambient clock');
        }
      }

      if (ts.isNewExpression(node)) {
        const constructorName = nodeName(node.expression);
        if (constructorName && FORBIDDEN_NETWORK_CONSTRUCTORS.has(constructorName)) {
          report(node, `constructs network/socket primitive ${constructorName}`);
        }
        if (constructorName && FORBIDDEN_PERSISTENCE_CONSTRUCTORS.test(constructorName)) {
          report(node, `constructs additional persistence/store owner ${constructorName}`);
        }
        if (constructorName === 'Date' && (node.arguments?.length ?? 0) === 0) {
          report(node, 'constructs Date from ambient time');
        }
      }

      if (ts.isIdentifier(node) && FORBIDDEN_CREDENTIAL_NAMES.has(node.text)) {
        report(node, `declares or accesses credential/private field ${node.text}`);
      }
      if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
        report(node, 'declares a stateful class');
      }
    });
  }
  return violations;
}

function findInterface(tree, name) {
  return tree.statements.find(
    (statement) => ts.isInterfaceDeclaration(statement) && statement.name.text === name,
  );
}

function findFunctions(tree, name) {
  return tree.statements.filter(
    (statement) => ts.isFunctionDeclaration(statement) && statement.name?.text === name,
  );
}

function initializerLiteral(tree, name) {
  for (const statement of tree.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.name.text === name) {
        const value = unwrap(declaration.initializer);
        return value && ts.isStringLiteralLike(value) ? value.text : null;
      }
    }
  }
  return null;
}

function assertInjectedLedgerPort() {
  const file = path.join(SOURCE_ROOT, 'publicOpportunityObservationStore.ts');
  const tree = parse(file);
  const portName = 'PublicBasisOpportunityObservationLedgerPort';
  const port = findInterface(tree, portName);
  assert.ok(port, 'the append adapter must expose a structural Ledger port');
  assert.deepEqual(
    port.members.map((member) => nodeName(member.name)),
    ['logEventsAtomically'],
    'the append adapter receives only the existing atomic Ledger append capability',
  );

  const declarations = findFunctions(tree, 'appendPublicOpportunityObservation');
  assert.equal(declarations.length, 3, 'two overloads and one implementation must share the injected port');
  for (const declaration of declarations) {
    assert.equal(declaration.parameters.length, 2);
    assert.equal(nodeName(declaration.parameters[0].name), 'ledger');
    assert.equal(declaration.parameters[0].type?.getText(tree), portName);
  }

  const implementation = declarations.find((declaration) => declaration.body);
  assert.ok(implementation, 'append implementation must exist');
  const persistenceCalls = [];
  walk(implementation.body, (node) => {
    if (!ts.isCallExpression(node)) return;
    const target = expressionPath(node.expression);
    if (target?.startsWith('ledger.')) persistenceCalls.push(target);
  });
  assert.deepEqual(
    persistenceCalls,
    ['ledger.logEventsAtomically'],
    'persistence is possible only through the injected existing-Ledger structural port',
  );
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
    throw new Error(`BASIS_TICKER_IMPORT_EFFECT:${name}`);
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
        throw new Error(`BASIS_TICKER_IMPORT_EFFECT:${name}`);
      }
    });
  }

  const originalEnv = process.env;
  const recordTargetEnvAccess = (attempt) => {
    const stack = new Error().stack ?? '';
    if ([...TARGETS, ...RUNTIME_TARGETS].some((name) => stack.includes(name))) {
      attempts.push(attempt);
    }
  };
  patchProperty(patches, process, 'env', new Proxy(originalEnv, {
    get(target, property, receiver) {
      if (typeof property === 'string') recordTargetEnvAccess(`process.env:${property}`);
      return Reflect.get(target, property, receiver);
    },
    has(target, property) {
      if (typeof property === 'string') recordTargetEnvAccess(`process.env.has:${property}`);
      return Reflect.has(target, property);
    },
    ownKeys(target) {
      recordTargetEnvAccess('process.env.enumerate');
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
  patchMethods(dgram, 'dgram', ['createSocket']);
  patchMethods(dns, 'dns', [
    'getDefaultResultOrder', 'getServers', 'lookup', 'lookupService', 'resolve',
    'resolve4', 'resolve6', 'resolveAny', 'resolveCaa', 'resolveCname', 'resolveMx',
    'resolveNaptr', 'resolveNs', 'resolvePtr', 'resolveSoa', 'resolveSrv', 'resolveTxt',
    'reverse', 'setDefaultResultOrder', 'setServers',
  ]);
  patchMethods(http, 'http', ['createServer', 'get', 'request']);
  patchMethods(http2, 'http2', ['connect', 'createSecureServer', 'createServer']);
  patchMethods(https, 'https', ['createServer', 'get', 'request']);
  patchMethods(net, 'net', ['connect', 'createConnection', 'createServer']);
  patchMethods(tls, 'tls', ['connect', 'createSecureContext', 'createServer']);
  patchMethods(crypto, 'crypto', [
    'createHmac', 'createPrivateKey', 'createSecretKey', 'createSign', 'generateKey',
    'generateKeyPair', 'getRandomValues', 'hkdf', 'pbkdf2', 'randomBytes',
    'randomFill', 'randomFillSync', 'randomInt', 'randomUUID', 'scrypt', 'sign',
  ]);
  syncBuiltinESMExports();

  try {
    return await run(attempts);
  } finally {
    for (const { target, key, descriptor } of patches.reverse()) {
      if (descriptor === undefined) delete target[key];
      else Object.defineProperty(target, key, descriptor);
    }
    syncBuiltinESMExports();
  }
}

test('the live-edge purity proof is pinned to exactly three parseable source files', () => {
  const files = targetPaths();
  assert.equal(files.length, 3);
  for (const file of files) parse(file);
});

test('source AST has only the narrow pure imports and no ambient, private, action, UI, or store construction', () => {
  assert.deepEqual(staticViolations(targetPaths()), []);
});

test('release labels remain canonically not configured and unmounted', () => {
  const observationTree = parse(path.join(SOURCE_ROOT, 'publicOpportunityObservation.ts'));
  const storeTree = parse(path.join(SOURCE_ROOT, 'publicOpportunityObservationStore.ts'));
  assert.equal(
    initializerLiteral(observationTree, 'PUBLIC_BASIS_OPPORTUNITY_OBSERVATION_RELEASE_STATE'),
    'NOT_CONFIGURED',
  );
  assert.equal(
    initializerLiteral(storeTree, 'PUBLIC_BASIS_OPPORTUNITY_OBSERVATION_STORE_RELEASE_STATE'),
    'NOT_CONFIGURED',
  );
});

test('store persistence is restricted to an injected existing-Ledger structural port', () => {
  assertInjectedLedgerPort();
});

test('all three source modules import inertly under ambient, network, signer, timer, and randomness tripwires', async () => {
  const imported = [];
  const errors = [];
  let attempts = [];
  await withImportTripwires(async (recordedAttempts) => {
    attempts = recordedAttempts;
    for (const [index, file] of RUNTIME_TARGETS
      .map((name) => path.join(DIST_ROOT, name))
      .entries()) {
      try {
        const module = await import(`${pathToFileURL(file).href}?basis-ticker-purity=${index}`);
        imported.push(module);
      } catch (error) {
        errors.push(`${path.basename(file)}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  });

  assert.deepEqual(errors, []);
  assert.equal(imported.length, 3);
  assert.equal(
    imported[0].PUBLIC_BASIS_OPPORTUNITY_OBSERVATION_RELEASE_STATE,
    'NOT_CONFIGURED',
  );
  assert.equal(
    imported[1].PUBLIC_BASIS_OPPORTUNITY_OBSERVATION_STORE_RELEASE_STATE,
    'NOT_CONFIGURED',
  );
  assert.deepEqual(attempts, []);
});
