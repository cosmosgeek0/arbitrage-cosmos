#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

import ts from 'typescript';

const PURE_SOURCE_RELATIVES = Object.freeze([
  'server/src/engine/volume/strategyEconomics.ts',
  'server/src/engine/volume/strategyObservation.ts',
  'server/src/engine/volume/strategySlice.ts',
  'server/src/engine/volume/strategyLedger.ts',
]);
const RUNTIME_SOURCE_RELATIVE = 'server/src/services/volumeRuntime.ts';
const TARGET_SOURCE_RELATIVES = Object.freeze([
  ...PURE_SOURCE_RELATIVES,
  RUNTIME_SOURCE_RELATIVE,
]);
const PURE_DIST_RELATIVES = Object.freeze(
  PURE_SOURCE_RELATIVES.map((relative) => (
    relative
      .replace(/^server\/src\//, 'server/dist/')
      .replace(/\.ts$/, '.js')
  )),
);

const FORBIDDEN_DIRECT_MODULE_ROOTS = new Set([
  'axios',
  'dgram',
  'dns',
  'http',
  'http2',
  'https',
  'net',
  'process',
  'tls',
  'undici',
  'ws',
]);
const FORBIDDEN_PATH_SEGMENTS = new Set([
  'client',
  'credential',
  'credentials',
  'loan',
  'loans',
  'order',
  'orders',
  'provider',
  'providers',
  'signed',
  'signer',
  'signing',
]);
const FORBIDDEN_CALL_NAMES = new Set([
  'borrow',
  'cancel',
  'cancelAll',
  'cancelOpenOrders',
  'cancelOrder',
  'createHmac',
  'createOrder',
  'createPrivateKey',
  'createSecretKey',
  'createSign',
  'credsFromEnv',
  'fetch',
  'generateKey',
  'generateKeyPair',
  'intentFor',
  'loadCredential',
  'placeOrder',
  'repay',
  'send',
  'sendOrder',
  'sendSignedRequest',
  'sign',
  'signRequest',
  'submit',
  'submitOrder',
  'submitTestOrder',
  'testOrder',
  'transfer',
  'withdraw',
]);
const FORBIDDEN_CONSTRUCTORS = new Set([
  'BinanceClient',
  'CredentialProvider',
  'ExecutionCoordinator',
  'LoanService',
  'OrderService',
  'PrivateReadClient',
  'WebSocket',
]);
const FORBIDDEN_IMPORTED_IDENTIFIER =
  /(?:BinanceClient|Credential|ExecutionCoordinator|Loan(?:Client|Service|Port)|Order(?:Client|Service|Port)|PrivateRead|Provider|SignedKernel|Signer|SubmitPort)/;
const FORBIDDEN_PRIVATE_ENDPOINT =
  /\/(?:api\/v3\/order(?:\/test)?|sapi\/v1\/(?:asset\/transfer|capital\/withdraw|margin\/(?:borrow-repay|loan|repay)))(?:[/?]|$)/i;
const PURE_AMBIENT_CALLS = new Set([
  'queueMicrotask',
  'setImmediate',
  'setInterval',
  'setTimeout',
]);

function parseText(file, source) {
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);
  assert.deepEqual(
    tree.parseDiagnostics.map((diagnostic) => diagnostic.messageText),
    [],
    `${file} must parse without recovery`,
  );
  return tree;
}

function parseFile(relative) {
  const absolute = path.resolve(relative);
  assert.equal(fs.existsSync(absolute), true, `${relative} must exist`);
  return {
    absolute,
    tree: parseText(absolute, fs.readFileSync(absolute, 'utf8')),
  };
}

function walk(node, visit) {
  visit(node);
  ts.forEachChild(node, (child) => walk(child, visit));
}

function unwrap(node) {
  let current = node;
  while (current && (
    ts.isAsExpression(current)
    || ts.isNonNullExpression(current)
    || ts.isParenthesizedExpression(current)
    || ts.isSatisfiesExpression(current)
    || ts.isTypeAssertionExpression(current)
  )) current = current.expression;
  return current;
}

function expressionPath(node) {
  const current = unwrap(node);
  if (!current) return null;
  if (ts.isIdentifier(current)) return current.text;
  if (ts.isPropertyAccessExpression(current)) {
    const prefix = expressionPath(current.expression);
    return prefix === null ? null : `${prefix}.${current.name.text}`;
  }
  if (
    ts.isElementAccessExpression(current)
    && current.argumentExpression
    && ts.isStringLiteralLike(current.argumentExpression)
  ) {
    const prefix = expressionPath(current.expression);
    return prefix === null ? null : `${prefix}.${current.argumentExpression.text}`;
  }
  return null;
}

function terminalName(node) {
  const current = unwrap(node);
  if (!current) return null;
  if (ts.isIdentifier(current) || ts.isPrivateIdentifier(current)) return current.text;
  if (ts.isPropertyAccessExpression(current)) return current.name.text;
  if (
    ts.isElementAccessExpression(current)
    && current.argumentExpression
    && ts.isStringLiteralLike(current.argumentExpression)
  ) return current.argumentExpression.text;
  return null;
}

function moduleSpecifierText(node) {
  return node && ts.isStringLiteralLike(node) ? node.text : null;
}

function moduleRoot(specifier) {
  const bare = specifier.startsWith('node:') ? specifier.slice(5) : specifier;
  if (bare.startsWith('@')) return bare.split('/').slice(0, 2).join('/');
  return bare.split('/')[0];
}

function runtimeImportLocals(node) {
  if (!ts.isImportDeclaration(node) || !node.importClause || node.importClause.isTypeOnly) return [];
  const locals = [];
  if (node.importClause.name) locals.push(node.importClause.name.text);
  const bindings = node.importClause.namedBindings;
  if (bindings && ts.isNamespaceImport(bindings)) locals.push(bindings.name.text);
  if (bindings && ts.isNamedImports(bindings)) {
    for (const element of bindings.elements) {
      if (!element.isTypeOnly) locals.push(element.name.text);
    }
  }
  return locals;
}

function isRuntimeModuleEdge(node) {
  if (ts.isImportDeclaration(node)) {
    if (!node.importClause) return true;
    if (node.importClause.isTypeOnly) return false;
    if (node.importClause.name) return true;
    if (node.importClause.namedBindings && ts.isNamespaceImport(node.importClause.namedBindings)) return true;
    return Boolean(
      node.importClause.namedBindings
      && ts.isNamedImports(node.importClause.namedBindings)
      && node.importClause.namedBindings.elements.some((element) => !element.isTypeOnly),
    );
  }
  if (ts.isExportDeclaration(node)) return node.isTypeOnly !== true;
  return ts.isImportEqualsDeclaration(node);
}

function forbiddenImportReason(specifier) {
  const root = moduleRoot(specifier);
  if (FORBIDDEN_DIRECT_MODULE_ROOTS.has(root)) {
    return `imports direct transport or process boundary ${specifier}`;
  }
  if (root.startsWith('@aws-sdk/')) return `imports provider SDK ${specifier}`;

  const normalized = specifier.replaceAll('\\', '/').replace(/\.[cm]?[jt]sx?$/i, '');
  const lower = normalized.toLowerCase();
  const segments = lower.split('/').filter(Boolean);
  if (segments.some((segment) => FORBIDDEN_PATH_SEGMENTS.has(segment))) {
    return `imports private, signed, order, loan, provider, credential, or client boundary ${specifier}`;
  }
  if (lower.includes('privateread') || lower.includes('binancesignedkernel')) {
    return `imports private or signed Binance boundary ${specifier}`;
  }
  if (/(?:^|\/)binance\/client(?:\/|$)/.test(lower)) {
    return `imports Binance client boundary ${specifier}`;
  }
  if (/(?:^|\/)foundation\/execution(?:\/|$)/.test(lower)) {
    return `imports Foundation execution runtime ${specifier}`;
  }
  return null;
}

function location(file, tree, node) {
  const point = tree.getLineAndCharacterOfPosition(node.getStart(tree));
  return `${path.relative(process.cwd(), file)}:${point.line + 1}:${point.character + 1}`;
}

function staticViolations(file, tree, pure) {
  const violations = [];
  const aliases = new Set(FORBIDDEN_CALL_NAMES);
  const report = (node, detail) => violations.push(`${location(file, tree, node)} ${detail}`);

  walk(tree, (node) => {
    if (ts.isImportDeclaration(node)) {
      if (isRuntimeModuleEdge(node)) {
        const specifier = moduleSpecifierText(node.moduleSpecifier);
        if (specifier !== null) {
          const reason = forbiddenImportReason(specifier);
          if (reason !== null) report(node.moduleSpecifier, reason);
        }
        for (const local of runtimeImportLocals(node)) {
          if (FORBIDDEN_IMPORTED_IDENTIFIER.test(local)) {
            aliases.add(local);
            report(node, `runtime-imports authority-capable identifier ${local}`);
          }
        }
      }
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && isRuntimeModuleEdge(node)) {
      const specifier = moduleSpecifierText(node.moduleSpecifier);
      if (specifier !== null) {
        const reason = forbiddenImportReason(specifier);
        if (reason !== null) report(node.moduleSpecifier, reason);
      }
    } else if (
      ts.isImportEqualsDeclaration(node)
      && ts.isExternalModuleReference(node.moduleReference)
    ) {
      const specifier = moduleSpecifierText(node.moduleReference.expression);
      if (specifier !== null) {
        const reason = forbiddenImportReason(specifier);
        if (reason !== null) report(node, reason);
      }
    }
  });

  let changed = true;
  while (changed) {
    changed = false;
    walk(tree, (node) => {
      if (
        !ts.isVariableDeclaration(node)
        || !ts.isIdentifier(node.name)
        || node.initializer === undefined
        || aliases.has(node.name.text)
      ) return;
      const initializerPath = expressionPath(node.initializer);
      const initializerName = terminalName(node.initializer);
      const directFetchAlias = initializerPath === 'globalThis.fetch'
        || initializerPath === 'fetch';
      if (directFetchAlias || (initializerName !== null && aliases.has(initializerName))) {
        aliases.add(node.name.text);
        changed = true;
      }
    });
  }

  walk(tree, (node) => {
    const accessPath = (
      ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)
    ) ? expressionPath(node) : null;
    if (accessPath && /^(?:globalThis\.)?process\.env(?:\.|$)/.test(accessPath)) {
      report(node, 'reads process.env');
    }

    if (ts.isCallExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) report(node, 'uses dynamic import');
      const target = expressionPath(node.expression);
      const name = terminalName(node.expression);
      const fetchInvocation = target === 'fetch'
        || target === 'globalThis.fetch'
        || target === 'fetch.call'
        || target === 'fetch.apply'
        || target === 'fetch.bind'
        || target === 'globalThis.fetch.call'
        || target === 'globalThis.fetch.apply'
        || target === 'globalThis.fetch.bind';
      if (fetchInvocation || (name !== null && aliases.has(name))) {
        report(node, `calls forbidden authority or egress primitive ${name ?? target ?? 'UNKNOWN'}`);
      }
      if (pure && name !== null && PURE_AMBIENT_CALLS.has(name)) {
        report(node, `calls ambient timer primitive ${name}`);
      }
      if (
        pure
        && (
          target === 'Date.now'
          || target === 'globalThis.Date.now'
          || target === 'Math.random'
          || target === 'globalThis.Math.random'
        )
      ) report(node, `reads ambient clock or randomness ${target}`);
    }

    if (ts.isNewExpression(node)) {
      const name = terminalName(node.expression);
      if (name !== null && FORBIDDEN_CONSTRUCTORS.has(name)) {
        report(node, `constructs forbidden authority or transport ${name}`);
      }
      if (pure && name === 'Date' && (node.arguments?.length ?? 0) === 0) {
        report(node, 'constructs Date from ambient wall clock');
      }
    }

    if (
      (ts.isStringLiteralLike(node) || ts.isNoSubstitutionTemplateLiteral(node))
      && FORBIDDEN_PRIVATE_ENDPOINT.test(node.text)
    ) report(node, 'embeds private, signed, or order endpoint');
  });

  return violations;
}

function runtimeImportSpecifiers(tree) {
  const specifiers = [];
  walk(tree, (node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
      && node.moduleSpecifier
      && isRuntimeModuleEdge(node)
    ) {
      const specifier = moduleSpecifierText(node.moduleSpecifier);
      if (specifier !== null) specifiers.push(specifier.replaceAll('\\', '/'));
    }
  });
  return specifiers;
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
    throw new Error(`VOLUME_STRATEGY_IMPORT_BOUNDARY_USED:${name}`);
  };

  patchProperty(patches, Date, 'now', denied('Date.now'));
  patchProperty(patches, Math, 'random', denied('Math.random'));
  patchProperty(patches, globalThis, 'fetch', denied('fetch'));
  for (const name of ['queueMicrotask', 'setImmediate', 'setInterval', 'setTimeout']) {
    patchProperty(patches, globalThis, name, denied(name));
  }
  patchProperty(patches, globalThis, 'WebSocket', class ForbiddenWebSocket {
    constructor() {
      attempts.push('WebSocket');
      throw new Error('VOLUME_STRATEGY_IMPORT_BOUNDARY_USED:WebSocket');
    }
  });

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
    await run();
  } finally {
    for (const { target, key, descriptor } of patches.reverse()) {
      if (descriptor === undefined) delete target[key];
      else Object.defineProperty(target, key, descriptor);
    }
  }
  return attempts;
}

function collectDataEntries(value, currentPath = 'plan', entries = [], seen = new Set()) {
  if (value === null || typeof value !== 'object' || seen.has(value)) return entries;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    assert.equal(typeof key, 'string', `${currentPath} must not contain symbol fields`);
    const nextPath = `${currentPath}.${key}`;
    const child = value[key];
    entries.push({ key, path: nextPath, value: child });
    collectDataEntries(child, nextPath, entries, seen);
  }
  return entries;
}

function assertDeepFrozen(value, currentPath = 'plan', seen = new Set()) {
  if (value === null || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  assert.equal(Object.isFrozen(value), true, `${currentPath} must be frozen`);
  for (const key of Reflect.ownKeys(value)) {
    assertDeepFrozen(value[key], `${currentPath}.${String(key)}`, seen);
  }
}

function assertNoAuthorityFields(plan) {
  const entries = collectDataEntries(plan);
  const authorityEntries = entries.filter(({ key }) => /authority$/i.test(key));
  assert.ok(authorityEntries.length >= 4, 'plan must expose its explicit authority denials');
  assert.deepEqual(
    authorityEntries.map(({ value }) => value),
    authorityEntries.map(() => 'NONE'),
    'every plan authority field must be NONE',
  );

  const forbiddenFieldNames = new Set([
    'apikey',
    'apisecret',
    'client',
    'clientfactory',
    'clientorderid',
    'credential',
    'credentials',
    'headers',
    'keymaterial',
    'listenkey',
    'order',
    'orderid',
    'orders',
    'ordertype',
    'privatekey',
    'requestsigner',
    'secretkey',
    'signature',
    'signer',
    'signedrequest',
    'transport',
    'transportport',
  ]);
  const forbiddenEntries = entries.filter(({ key }) => (
    forbiddenFieldNames.has(key.replace(/[-_]/g, '').toLowerCase())
  ));
  assert.deepEqual(
    forbiddenEntries.map(({ path }) => path),
    [],
    'plan must carry no transport, client, order, credential, signer, or key fields',
  );
}

function assertValidateOnlyNoEffectPlan(plan) {
  assert.equal(plan.mode, 'VALIDATE_ONLY');
  assert.equal(plan.killSwitchEngaged, true);
  assert.equal(plan.sendEligible, false);
  assert.equal(plan.sends, 0);
  assert.equal(plan.sideEffects, 0);
  assert.equal(plan.submitPortPresent, false);
  assert.equal(plan.publicOnly, true);
  assert.equal(plan.privateCalls, false);
  assert.equal(plan.signedCalls, false);
  assert.equal(plan.providerCalls, false);
  assertNoAuthorityFields(plan);
  assertDeepFrozen(plan);
}

test('authority scanner is AST-aware and rejects runtime capability without filename or prose false positives', () => {
  const harmlessFile = path.resolve('tmp/privateRead-binance-client-order-credential.ts');
  const harmlessTree = parseText(harmlessFile, `
    import type { PrivateReadClient } from '../binance/client.js';
    const documentaryLabels = Object.freeze({
      filename: 'signed-order-provider.ts',
      note: 'submit cancel withdraw transfer borrow repay',
    });
    export function describe() { return documentaryLabels.note; }
  `);
  assert.deepEqual(staticViolations(harmlessFile, harmlessTree, true), []);

  const violatingFile = path.resolve('tmp/neutral.ts');
  const violatingTree = parseText(violatingFile, `
    import { BinanceClient } from '../binance/client.js';
    const ambientKey = process.env.BINANCE_API_KEY;
    const egress = globalThis.fetch;
    egress('https://example.invalid');
    new WebSocket('wss://example.invalid');
    coordinator.intentFor();
    port.submitOrder();
  `);
  const violations = staticViolations(violatingFile, violatingTree, true).join('\n');
  assert.match(violations, /imports .*client boundary/);
  assert.match(violations, /runtime-imports authority-capable identifier BinanceClient/);
  assert.match(violations, /reads process\.env/);
  assert.match(violations, /calls forbidden authority or egress primitive egress/);
  assert.match(violations, /constructs forbidden authority or transport WebSocket/);
  assert.match(violations, /primitive intentFor/);
  assert.match(violations, /primitive submitOrder/);
});

test('strategy source and VolumeRuntime integration expose no private, signed, order, provider, or submit seam', () => {
  const allViolations = [];
  let runtimeTree = null;
  for (const relative of TARGET_SOURCE_RELATIVES) {
    const parsed = parseFile(relative);
    allViolations.push(...staticViolations(
      parsed.absolute,
      parsed.tree,
      PURE_SOURCE_RELATIVES.includes(relative),
    ));
    if (relative === RUNTIME_SOURCE_RELATIVE) runtimeTree = parsed.tree;
  }
  assert.deepEqual(allViolations, []);
  assert.notEqual(runtimeTree, null);

  const integrationImports = runtimeImportSpecifiers(runtimeTree);
  for (const required of [
    '../engine/volume/strategyEconomics.js',
    '../engine/volume/strategyObservation.js',
    '../engine/volume/strategySlice.js',
    '../engine/volume/strategyLedger.js',
  ]) {
    assert.ok(
      integrationImports.includes(required),
      `VolumeRuntime must runtime-integrate ${required}`,
    );
  }
});

test('every built pure strategy module imports without ambient network, timer, clock, randomness, or environment activity', async () => {
  const importErrors = [];
  let imported = 0;
  const attempts = await withImportTripwires(async () => {
    for (const [index, relative] of PURE_DIST_RELATIVES.entries()) {
      const absolute = path.resolve(relative);
      assert.equal(fs.existsSync(absolute), true, `${relative} must be built`);
      try {
        await import(`${pathToFileURL(absolute).href}?volume-strategy-authority=${index}`);
        imported += 1;
      } catch (error) {
        importErrors.push(
          `${relative}: ${error instanceof Error ? error.message : 'NON_ERROR_IMPORT_FAILURE'}`,
        );
      }
    }
  });

  const applicationAttempts = attempts.filter(
    (attempt) => attempt !== 'process.env:WATCH_REPORT_DEPENDENCIES',
  );
  assert.deepEqual(importErrors, []);
  assert.equal(imported, PURE_DIST_RELATIVES.length);
  assert.deepEqual(applicationAttempts, []);
});

test('default-off and synthetic-positive plans remain deeply immutable validate-only no-effect records', async () => {
  const observationModule = await import(
    `${pathToFileURL(path.resolve(PURE_DIST_RELATIVES[1])).href}?volume-strategy-plan=observation`,
  );
  const economicsModule = await import(
    `${pathToFileURL(path.resolve(PURE_DIST_RELATIVES[0])).href}?volume-strategy-plan=economics`,
  );
  const sliceModule = await import(
    `${pathToFileURL(path.resolve(PURE_DIST_RELATIVES[2])).href}?volume-strategy-plan=slice`,
  );

  const nowMs = 1_785_206_040_302;
  const proposal = Object.freeze({
    proposalId: 'volume-proposal-authority-1',
    proposalRevision: 7,
    proposalDigest: `vprop_${'a'.repeat(64)}`,
    configurationRevision: `vcfg_${'b'.repeat(64)}`,
    correlationId: 'volume-authority-correlation-1',
    symbol: 'BTCUSDT',
    direction: 'long',
    featureObservedAtMs: nowMs - 6,
    updatedTs: nowMs - 1,
    expiresAtMs: nowMs + 60_000,
  });
  const observation = observationModule.buildVolumeStrategyObservation({
    proposal: {
      proposalId: proposal.proposalId,
      proposalRevision: proposal.proposalRevision,
      proposalDigest: proposal.proposalDigest,
      configurationRevision: proposal.configurationRevision,
      correlationId: proposal.correlationId,
      symbol: proposal.symbol,
      direction: proposal.direction,
      expiresAtMs: proposal.expiresAtMs,
    },
    source: {
      sourceId: observationModule.VOLUME_PUBLIC_SOURCE_ID,
      restBaseUrl: observationModule.VOLUME_PUBLIC_REST_BASE_URL,
      websocketBaseUrl: observationModule.VOLUME_PUBLIC_WEBSOCKET_BASE_URL,
      authentication: 'NONE',
      timeUnit: 'MILLISECOND',
      generation: 3,
      revision: 11,
      continuity: 'CONTIGUOUS',
    },
    aggregateTrade: {
      symbol: proposal.symbol,
      aggregateTradeId: 100,
      firstTradeId: 200,
      lastTradeId: 202,
      eventTimeMs: nowMs - 4,
      tradeTimeMs: nowMs - 5,
      receivedAtMs: nowMs - 3,
    },
    book: {
      symbol: proposal.symbol,
      bidPrice: '99990',
      askPrice: '100000',
      bidQuantity: '0.02',
      askQuantity: '0.015',
      sourceTimeMs: null,
      receivedAtMs: nowMs - 2,
      freshnessBasis: 'RECEIVE_TIME',
      numericFidelity: 'SOURCE_TEXT_EXACT',
      scope: 'SYNCHRONIZED_DEPTH',
      depth: {
        synchronization: {
          sourceGeneration: 3,
          sourceRevision: 11,
          snapshotLastUpdateId: 500,
          updateRanges: [{
            firstUpdateId: 501,
            finalUpdateId: 501,
            eventTimeMs: nowMs - 2,
          }],
        },
        bids: [
          { price: '99990', quantity: '0.02' },
          { price: '99980', quantity: '0.03' },
        ],
        asks: [
          { price: '100000', quantity: '0.015' },
          { price: '100010', quantity: '0.025' },
        ],
      },
    },
    evaluatedAtMs: nowMs,
  });
  const economics = economicsModule.createSyntheticVolumeEconomics({
    fixtureId: 'focused-positive-v1',
    valuationAsset: 'USDT',
    grossEdgePer1000ValuationNotional: '5',
    accountFeeBpsPerSide: '10',
    slippageBpsPerSide: '5',
    liquidityCapacity: '5000',
    evaluatedAtMs: nowMs,
    expiresAtMs: nowMs + 60_000,
  });
  const input = Object.freeze({ proposal, observation, economics });

  const defaultSlice = sliceModule.createVolumeStrategySlice();
  assert.deepEqual(defaultSlice.controls, {
    enabled: false,
    killSwitchEngaged: true,
  });
  assertDeepFrozen(defaultSlice.controls, 'defaultSlice.controls');
  const defaultEvaluation = defaultSlice.evaluate(input);
  assert.equal(defaultEvaluation.disposition, 'REJECTED');
  assert.ok(defaultEvaluation.rejectionCodes.includes('STRATEGY_DISABLED'));
  assertValidateOnlyNoEffectPlan(defaultEvaluation.plan);

  const recordOnlySlice = sliceModule.createVolumeStrategySlice({ enabled: true });
  assert.deepEqual(recordOnlySlice.controls, {
    enabled: true,
    killSwitchEngaged: true,
  });
  const first = recordOnlySlice.evaluate(input);
  const second = recordOnlySlice.evaluate(input);
  assert.deepEqual(second, first, 'identical public evidence must produce an identical immutable record');
  assert.equal(
    first.disposition,
    'VALIDATED_RECORD_ONLY',
    `synthetic positive fixture rejected: ${JSON.stringify(first.rejectionCodes)}`,
  );
  assert.deepEqual(first.rejectionCodes, []);
  assert.notEqual(first.plan.executionTerms, null);
  assert.equal(sliceModule.validateVolumeValidateOnlyPlan(first.plan), true);
  assert.equal(sliceModule.validateVolumeValidateOnlyPlan(structuredClone(first.plan)), true);
  assertValidateOnlyNoEffectPlan(first.plan);
});
