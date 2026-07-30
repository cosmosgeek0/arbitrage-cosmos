import assert from 'node:assert/strict';
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

const SOURCE_ROOT = path.resolve('server/src/liveEdge');
const DIST_ROOT = path.resolve('server/dist/liveEdge');
const SERVER_SOURCE_ROOT = path.resolve('server/src');
const BINANCE_SPOT_EXECUTION_SOURCE = path.resolve(
  'server/src/liveEdge/adapters/binanceSpotExecution/adapter.ts',
);
const BINANCE_SPOT_DISPATCH_SOURCE = path.resolve(
  'server/src/foundation/execution/m0SpotDispatch.ts',
);
const BINANCE_SPOT_PRODUCTION_TRANSPORT_SOURCE = path.resolve(
  'server/src/liveEdge/adapters/binanceSpotExecution/productionTransport.ts',
);
const BINANCE_SPOT_PRODUCTION_EXECUTOR_SOURCE = path.resolve(
  'server/src/systemIntegration/production/m0SpotExecutor.ts',
);
const BINANCE_SPOT_EXECUTION_TYPE_IMPORTS = new Map([
  ['../../../foundation/execution/m0SpotDispatch.js', new Set([
    'BinanceSpotCredentialProfile',
    'BinanceSpotDispatchAuthorityPort',
    'BinanceSpotDispatchClaimAction',
    'BinanceSpotDispatchIntent',
    'BinanceSpotDispatchPermit',
    'BinanceSpotExecutionContractId',
    'BinanceSpotExecutionOperation',
    'BinanceSpotSignedTransportOutcome',
    'BinanceSpotSignedTransportPort',
    'BinanceSpotSignedTransportRequest',
  ])],
  ['../../../foundation/execution/spotPort.js', new Set([
    'BinanceSpotExecutionPort',
    'SpotCancelIntent',
    'SpotFillObservation',
    'SpotFlattenIntent',
    'SpotLiveSubmitIntent',
    'SpotMutationOutcome',
    'SpotQueryByClientOrderIdIntent',
    'SpotQueryFillsIntent',
    'SpotQueryOutcome',
    'SpotSignedTestOrderIntent',
    'SpotVenueObservationStatus',
  ])],
  ['../../../foundation/execution/spotTicket.js', new Set([
    'SpotExecutionTicket',
  ])],
]);
const BINANCE_SPOT_EXECUTION_VALUE_IMPORTS = new Map([
  ['../../../foundation/execution/m0SpotDispatch.js', new Set([
    'BINANCE_SPOT_DISPATCH_PERMIT_SCHEMA',
    'BINANCE_SPOT_EXECUTION_ADAPTER_SCHEMA',
    'calculateBinanceSpotDispatchRequestDigest',
  ])],
  ['../../../foundation/execution/m0SpotLifecycleCard.js', new Set([
    'calculateM0SpotIntentDigest',
    'M0_SPOT_ACTION_CONSUMPTION_SCHEMA',
  ])],
]);
const BINANCE_SPOT_PRODUCTION_TRANSPORT_TYPE_IMPORTS = new Map([
  ['../../../foundation/execution/m0SpotDispatch.js', new Set([
    'BinanceSpotCredentialProfile',
    'BinanceSpotDispatchPermit',
    'BinanceSpotEgressSpendPort',
    'BinanceSpotEgressSpendReceipt',
    'BinanceSpotEgressSpendRequest',
    'BinanceSpotExecutionOperation',
    'BinanceSpotSignedTransportOutcome',
    'BinanceSpotSignedTransportPort',
    'BinanceSpotSignedTransportRequest',
  ])],
]);
const BINANCE_SPOT_PRODUCTION_TRANSPORT_VALUE_IMPORTS = new Map([
  ['../../../foundation/execution/m0SpotDispatch.js', new Set([
    'BINANCE_SPOT_DISPATCH_PERMIT_SCHEMA',
    'BINANCE_SPOT_EGRESS_SPEND_SCHEMA',
    'BINANCE_SPOT_EXECUTION_ADAPTER_SCHEMA',
    'calculateBinanceSpotDispatchPermitDigest',
    'calculateBinanceSpotDispatchRequestDigest',
  ])],
  ['../../../foundation/execution/m0SpotLifecycleCard.js', new Set([
    'M0_SPOT_ACTION_CONSUMPTION_SCHEMA',
  ])],
  ['../../../foundation/risk/spotRiskPolicy.js', new Set([
    'OWNER_SPOT_MAX_ORDER_NOTIONAL_QUOTE',
  ])],
]);
const BINANCE_SPOT_EXECUTION_ENDPOINTS = new Set([
  '/api/v3/myTrades',
  '/api/v3/order',
  '/api/v3/order/test',
]);
const BINANCE_SPOT_EXECUTION_PORT_METHODS = new Set([
  'cancel',
  'flatten',
  'queryByOriginalClientOrderId',
  'queryFills',
  'signedTestOrder',
  'submitLiveOrder',
]);
const BINANCE_SPOT_EXECUTION_CONTRACTS = new Set([
  'SPOT_MY_TRADES_QUERY',
  'SPOT_ORDER_CANCEL',
  'SPOT_ORDER_POST',
  'SPOT_ORDER_QUERY',
  'SPOT_TEST_ORDER_POST',
]);
const BINANCE_SPOT_PRODUCTION_TRANSPORT_LITERALS = new Set([
  'https://api.binance.com',
  'X-MBX-APIKEY',
]);
const CAPITAL_DECIMAL_LEAF_SUFFIX = '/capitalFoundation/contracts/decimal.js';
const CAPITAL_DECIMAL_CONSUMERS = new Map([
  [path.resolve('server/src/liveEdge/adapters/binanceInstrumentSpecs/exact.ts'), new Set([
    'ExactDecimal',
    'addExactDecimals',
    'compareExactDecimals',
    'divideExactDecimals',
    'minimumExactDecimal',
    'multiplyExactDecimals',
    'normalizeNonNegativeExactDecimal',
    'subtractExactDecimals',
  ])],
  [path.resolve('server/src/liveEdge/adapters/binancePrivateTruth/exact.ts'), new Set([
    'ExactDecimal',
    'NonNegativeDecimal',
    'normalizeExactDecimal',
    'normalizeNonNegativeExactDecimal',
  ])],
  [path.resolve('server/src/liveEdge/adapters/durableMutationJournal/exact.ts'), new Set([
    'NonNegativeDecimal',
    'addExactDecimals',
    'compareExactDecimals',
    'normalizeNonNegativeExactDecimal',
  ])],
  [path.resolve('server/src/liveEdge/adapters/exchangeTwin/exact.ts'), new Set([
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
  [path.resolve('server/src/liveEdge/adapters/executionPolicy/exact.ts'), new Set([
    'ExactDecimal',
    'NonNegativeDecimal',
    'addExactDecimals',
    'compareExactDecimals',
    'multiplyExactDecimals',
    'normalizeExactDecimal',
    'normalizeNonNegativeExactDecimal',
  ])],
]);
const CANONICAL_BARRIER_SOURCE = path.resolve('server/src/systemIntegration/contracts/constants.ts');
const BINANCE_DOCUMENTARY_DATA_SOURCE = path.resolve(
  'server/src/liveEdge/adapters/binanceContracts/manifest.ts',
);
const BINANCE_PRIVATE_TRUTH_EXTENSION_SOURCE = path.resolve(
  'server/src/liveEdge/adapters/binanceContracts/privateTruthExtension.ts',
);
const BINANCE_DOCUMENTARY_DATA_EXPORTS = new Set([
  'BINANCE_ADDITIONAL_CONTRACT_SEEDS',
  'BINANCE_APPROVED_PRODUCT_BASES',
  'BINANCE_DOCUMENTED_CONTRACTS',
  'BINANCE_OBSOLETE_ROUTE_FACTS',
  'BINANCE_OFFICIAL_SOURCES',
  'BINANCE_PROTECTED_LOCATORS',
  'BINANCE_RATE_HEADER_TEMPLATES',
]);
const BINANCE_DOCUMENTARY_LITERAL_OWNERS = new Map([
  [BINANCE_DOCUMENTARY_DATA_SOURCE, BINANCE_DOCUMENTARY_DATA_EXPORTS],
  [BINANCE_PRIVATE_TRUTH_EXTENSION_SOURCE, new Set([
    'USDM_ALGO_OPEN_ORDERS_SOURCE',
    'USDM_ALGO_OPEN_ORDERS_CONTRACT',
  ])],
]);

const FORBIDDEN_NODE_MODULES = new Set([
  'child_process',
  'cluster',
  'dgram',
  'dns',
  'fs',
  'http',
  'http2',
  'https',
  'net',
  'process',
  'sqlite',
  'tls',
  'timers',
  'worker_threads',
]);
const FORBIDDEN_TRANSPORT_PACKAGES = new Set(['axios', 'undici', 'ws']);
const FORBIDDEN_STORAGE_PACKAGES = new Set([
  'better-sqlite3',
  'level',
  'leveldown',
  'levelup',
  'sqlite3',
]);
const FORBIDDEN_MUTATION_NAMES = new Set([
  'allocate',
  'allocateCapital',
  'applyControl',
  'borrow',
  'borrowAsset',
  'cancelAllOrders',
  'cancelOrder',
  'commitReservation',
  'createOrder',
  'evaluateRisk',
  'execute',
  'executePlan',
  'loan',
  'mutateControl',
  'newOrder',
  'placeOrder',
  'reconcile',
  'releaseReservation',
  'repay',
  'repayLoan',
  'reserve',
  'reserveCapital',
  'sendOrder',
  'setSafeMode',
  'submitOrder',
  'submitPaper',
  'testOrder',
  'transfer',
  'universalTransfer',
  'withdraw',
  'withdrawal',
]);
const FORBIDDEN_AMBIENT_CALLS = new Set([
  'fetch',
  'queueMicrotask',
  'setImmediate',
  'setInterval',
  'setTimeout',
]);
const FORBIDDEN_NETWORK_CONSTRUCTORS = new Set(['EventSource', 'WebSocket']);
const LIVE_BARRIER = 'LIVE_EXECUTION_NOT_IMPLEMENTED';

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

function nodeName(node) {
  if (node === undefined) return null;
  if (ts.isIdentifier(node) || ts.isPrivateIdentifier(node) || ts.isStringLiteralLike(node)) return node.text;
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  if (ts.isElementAccessExpression(node) && node.argumentExpression && ts.isStringLiteralLike(node.argumentExpression)) {
    return node.argumentExpression.text;
  }
  return null;
}

function moduleName(node) {
  return node && ts.isStringLiteralLike(node) ? node.text : null;
}

function location(file, tree, node) {
  const point = tree.getLineAndCharacterOfPosition(node.getStart(tree));
  return `${path.relative(process.cwd(), file)}:${point.line + 1}:${point.character + 1}`;
}

function containingVariableName(node) {
  let current = node;
  while (current && !ts.isSourceFile(current)) {
    if (ts.isVariableDeclaration(current)) return nodeName(current.name);
    current = current.parent;
  }
  return null;
}

function isBinanceDocumentaryDataLiteral(file, node) {
  return BINANCE_DOCUMENTARY_LITERAL_OWNERS.get(file)
    ?.has(containingVariableName(node)) === true;
}

function normalizedModuleRoot(specifier) {
  const bare = specifier.startsWith('node:') ? specifier.slice(5) : specifier;
  if (bare.startsWith('@')) return bare.split('/').slice(0, 2).join('/');
  return bare.split('/')[0];
}

function forbiddenImportReason(specifier) {
  const moduleRoot = normalizedModuleRoot(specifier);
  if (FORBIDDEN_NODE_MODULES.has(moduleRoot) && (
    specifier.startsWith('node:')
    || specifier === moduleRoot
    || specifier.startsWith(`${moduleRoot}/`)
  )) return `imports ambient Node boundary ${specifier}`;
  if (FORBIDDEN_TRANSPORT_PACKAGES.has(moduleRoot)) return `imports network transport ${specifier}`;
  if (FORBIDDEN_STORAGE_PACKAGES.has(moduleRoot)) return `imports duplicate persistence ${specifier}`;
  if (moduleRoot.startsWith('@aws-sdk/')) return `imports cloud transport ${specifier}`;

  const normalized = specifier.replaceAll('\\', '/');
  if (/(?:^|\/)services\/(?:account|loans|orders|risk)(?:\/|\.|$)/i.test(normalized)) {
    return `imports private or money service ${specifier}`;
  }
  if (/(?:^|\/)(?:binance-client|binance\/(?:client|signed[^/]*))(?:\/|\.|$)/i.test(normalized)) {
    return `imports Binance private/mutation client ${specifier}`;
  }
  if (/(?:^|\/)foundation\/exchange\/binanceUsdM(?:\/|\.|$)/i.test(normalized)) {
    return `imports Binance mutation boundary ${specifier}`;
  }
  if (/(?:^|\/)capitalFoundation(?:\/|\.|$)/i.test(normalized)) {
    return `imports Capital authority ${specifier}`;
  }
  if (/(?:^|\/)foundation\/(?:control|execution|reconciliation|risk)(?:\/|\.|$)/i.test(normalized)) {
    return `imports Foundation control/risk/execution/reconciliation authority ${specifier}`;
  }
  if (/(?:^|\/)engine(?:\/|\.|$)/i.test(normalized)) return `imports strategy authority ${specifier}`;
  if (/(?:^|\/)ledger(?:\/|\.|$)/i.test(normalized)) return `imports durable-history authority ${specifier}`;
  return null;
}

function isCapitalDecimalLeaf(specifier) {
  return specifier.replaceAll('\\', '/').endsWith(CAPITAL_DECIMAL_LEAF_SUFFIX);
}

function isAllowedCapitalDecimalImport(file, node, specifier) {
  const allowedImports = CAPITAL_DECIMAL_CONSUMERS.get(file);
  if (allowedImports === undefined || !ts.isImportDeclaration(node)
    || !isCapitalDecimalLeaf(specifier) || !node.importClause
    || node.importClause.name || !node.importClause.namedBindings
  || !ts.isNamedImports(node.importClause.namedBindings)) return false;
  return node.importClause.namedBindings.elements.every((element) => (
    allowedImports.has(element.propertyName?.text ?? element.name.text)
  ));
}

function isAllowedBinanceSpotExecutionTypeImport(file, node, specifier) {
  const allowedImports = BINANCE_SPOT_EXECUTION_TYPE_IMPORTS.get(specifier);
  if (
    file !== BINANCE_SPOT_EXECUTION_SOURCE ||
    allowedImports === undefined ||
    !ts.isImportDeclaration(node) ||
    node.importClause?.isTypeOnly !== true ||
    node.importClause.name ||
    !node.importClause.namedBindings ||
    !ts.isNamedImports(node.importClause.namedBindings)
  ) {
    return false;
  }
  const elements = node.importClause.namedBindings.elements;
  return elements.length === allowedImports.size && elements.every((element) => (
    element.propertyName === undefined &&
    element.isTypeOnly === false &&
    allowedImports.has(element.name.text)
  ));
}

function isAllowedBinanceSpotExecutionValueImport(file, node, specifier) {
  const allowedImports = BINANCE_SPOT_EXECUTION_VALUE_IMPORTS.get(specifier);
  if (
    file !== BINANCE_SPOT_EXECUTION_SOURCE ||
    allowedImports === undefined ||
    !ts.isImportDeclaration(node) ||
    node.importClause?.isTypeOnly !== false ||
    node.importClause.name ||
    !node.importClause.namedBindings ||
    !ts.isNamedImports(node.importClause.namedBindings)
  ) {
    return false;
  }
  const elements = node.importClause.namedBindings.elements;
  return elements.length === allowedImports.size && elements.every((element) => (
    element.propertyName === undefined &&
    element.isTypeOnly === false &&
    allowedImports.has(element.name.text)
  ));
}

function isAllowedBinanceSpotProductionTransportTypeImport(
  file,
  node,
  specifier,
) {
  const allowedImports =
    BINANCE_SPOT_PRODUCTION_TRANSPORT_TYPE_IMPORTS.get(specifier);
  if (
    file !== BINANCE_SPOT_PRODUCTION_TRANSPORT_SOURCE ||
    allowedImports === undefined ||
    !ts.isImportDeclaration(node) ||
    node.importClause?.isTypeOnly !== true ||
    node.importClause.name ||
    !node.importClause.namedBindings ||
    !ts.isNamedImports(node.importClause.namedBindings)
  ) {
    return false;
  }
  const elements = node.importClause.namedBindings.elements;
  return elements.length === allowedImports.size && elements.every((element) => (
    element.propertyName === undefined &&
    element.isTypeOnly === false &&
    allowedImports.has(element.name.text)
  ));
}

function isAllowedBinanceSpotProductionTransportValueImport(
  file,
  node,
  specifier,
) {
  const allowedImports =
    BINANCE_SPOT_PRODUCTION_TRANSPORT_VALUE_IMPORTS.get(specifier);
  if (
    file !== BINANCE_SPOT_PRODUCTION_TRANSPORT_SOURCE ||
    allowedImports === undefined ||
    !ts.isImportDeclaration(node) ||
    node.importClause?.isTypeOnly !== false ||
    node.importClause.name ||
    !node.importClause.namedBindings ||
    !ts.isNamedImports(node.importClause.namedBindings)
  ) {
    return false;
  }
  const elements = node.importClause.namedBindings.elements;
  return elements.length === allowedImports.size && elements.every((element) => (
    element.propertyName === undefined &&
    element.isTypeOnly === false &&
    allowedImports.has(element.name.text)
  ));
}

function isAllowedBinanceSpotExecutionEndpoint(file, node) {
  return (
    file === BINANCE_SPOT_EXECUTION_SOURCE
      || file === BINANCE_SPOT_PRODUCTION_TRANSPORT_SOURCE
  )
    && (ts.isStringLiteralLike(node) || ts.isNoSubstitutionTemplateLiteral(node))
    && BINANCE_SPOT_EXECUTION_ENDPOINTS.has(node.text);
}

function isAllowedBinanceSpotProductionTransportLiteral(file, node) {
  return file === BINANCE_SPOT_PRODUCTION_TRANSPORT_SOURCE
    && (ts.isStringLiteralLike(node) || ts.isNoSubstitutionTemplateLiteral(node))
    && BINANCE_SPOT_PRODUCTION_TRANSPORT_LITERALS.has(node.text);
}

function isAllowedBinanceSpotExecutionMethod(file, node, name) {
  return file === BINANCE_SPOT_EXECUTION_SOURCE
    && ts.isMethodDeclaration(node)
    && ts.isObjectLiteralExpression(node.parent)
    && BINANCE_SPOT_EXECUTION_PORT_METHODS.has(name);
}

function isEnvironmentAccess(node) {
  if (!ts.isPropertyAccessExpression(node) && !ts.isElementAccessExpression(node)) return false;
  if (nodeName(node) !== 'env') return false;
  return ts.isIdentifier(node.expression) && ['Bun', 'Deno', 'process'].includes(node.expression.text);
}

function isNamedObjectCall(node, objectName, methodName) {
  return ts.isCallExpression(node)
    && (ts.isPropertyAccessExpression(node.expression) || ts.isElementAccessExpression(node.expression))
    && nodeName(node.expression) === methodName
    && ts.isIdentifier(node.expression.expression)
    && node.expression.expression.text === objectName;
}

function isExecutableDeclaration(node) {
  if (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) return node.name ?? null;
  if (ts.isVariableDeclaration(node)
    && node.initializer
    && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))) return node.name;
  if (ts.isPropertyDeclaration(node)
    && node.initializer
    && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))) return node.name;
  if (ts.isPropertyAssignment(node)
    && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))) return node.name;
  return null;
}

function staticViolations(files) {
  const violations = [];
  for (const file of files) {
    const tree = parse(file);
    const report = (node, detail) => violations.push(`${location(file, tree, node)} ${detail}`);

    walk(tree, (node) => {
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
        const specifier = moduleName(node.moduleSpecifier);
        if (specifier !== null) {
          const capitalLeaf = isCapitalDecimalLeaf(specifier);
          const allowedCapitalLeaf = isAllowedCapitalDecimalImport(file, node, specifier);
          const allowedSpotExecutionType = isAllowedBinanceSpotExecutionTypeImport(
            file,
            node,
            specifier,
          );
          const allowedSpotExecutionValue = isAllowedBinanceSpotExecutionValueImport(
            file,
            node,
            specifier,
          );
          const allowedSpotProductionTransportType =
            isAllowedBinanceSpotProductionTransportTypeImport(
              file,
              node,
              specifier,
            );
          const allowedSpotProductionTransportValue =
            isAllowedBinanceSpotProductionTransportValueImport(
              file,
              node,
              specifier,
            );
          const reason = allowedCapitalLeaf
            || allowedSpotExecutionType
            || allowedSpotExecutionValue
            || allowedSpotProductionTransportType
            || allowedSpotProductionTransportValue
            ? null
            : forbiddenImportReason(specifier);
          if (reason) report(node.moduleSpecifier, reason);
          if (capitalLeaf && !allowedCapitalLeaf && reason === null) {
            report(node.moduleSpecifier, 'imports Capital exact-decimal leaf outside the one approved consumer/import set');
          }
        }
        if (ts.isImportDeclaration(node) && node.importClause) {
          const names = [];
          if (node.importClause.name) names.push(node.importClause.name.text);
          const bindings = node.importClause.namedBindings;
          if (bindings && ts.isNamedImports(bindings)) {
            for (const element of bindings.elements) names.push(element.propertyName?.text ?? element.name.text);
          }
          for (const name of names) {
            if (FORBIDDEN_MUTATION_NAMES.has(name)) report(node, `imports mutation command ${name}`);
          }
        }
      }

      if (ts.isImportEqualsDeclaration(node)
        && ts.isExternalModuleReference(node.moduleReference)) {
        const specifier = moduleName(node.moduleReference.expression);
        if (specifier !== null) {
          const reason = forbiddenImportReason(specifier);
          if (reason) report(node, reason);
        }
      }

      if (isEnvironmentAccess(node)) report(node, 'reads ambient environment state');

      if (ts.isCallExpression(node)) {
        if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
          const specifier = moduleName(node.arguments[0]);
          if (specifier === null) report(node, 'uses non-literal dynamic import');
          else {
            const reason = forbiddenImportReason(specifier);
            if (reason) report(node, `dynamically ${reason}`);
          }
        }

        const name = nodeName(node.expression);
        if (name && FORBIDDEN_AMBIENT_CALLS.has(name)) report(node, `calls ambient primitive ${name}`);
        if (name && FORBIDDEN_MUTATION_NAMES.has(name)) report(node, `calls mutation command ${name}`);
        if (name === 'require') {
          const specifier = moduleName(node.arguments[0]);
          if (specifier === null) report(node, 'uses non-literal require');
          else {
            const reason = forbiddenImportReason(specifier);
            if (reason) report(node, `requires forbidden boundary: ${reason}`);
          }
        }
        if (isNamedObjectCall(node, 'Date', 'now')) report(node, 'reads wall clock through Date.now');
        if (isNamedObjectCall(node, 'Math', 'random')) report(node, 'uses ambient randomness');
        if (isNamedObjectCall(node, 'performance', 'now')) report(node, 'reads wall clock through performance.now');
        if (isNamedObjectCall(node, 'Object', 'defineProperty')
          && node.arguments.length >= 2
          && moduleName(node.arguments[1]) === LIVE_BARRIER) {
          report(node, `attempts to redefine ${LIVE_BARRIER}`);
        }
      }

      if (ts.isNewExpression(node)) {
        const name = nodeName(node.expression);
        if (name && FORBIDDEN_NETWORK_CONSTRUCTORS.has(name)) report(node, `constructs network primitive ${name}`);
        if (name === 'Date' && (node.arguments?.length ?? 0) === 0) report(node, 'constructs Date from ambient wall clock');
      }

      const declarationName = isExecutableDeclaration(node);
      if (declarationName) {
        const name = nodeName(declarationName);
        if (
          name &&
          FORBIDDEN_MUTATION_NAMES.has(name) &&
          !isAllowedBinanceSpotExecutionMethod(file, node, name)
        ) {
          report(node, `defines mutation command ${name}`);
        }
        if (name === LIVE_BARRIER) report(node, `shadows canonical ${LIVE_BARRIER}`);
      }

      if (ts.isVariableDeclaration(node) && nodeName(node.name) === LIVE_BARRIER) {
        report(node, `shadows canonical ${LIVE_BARRIER}`);
      }
      if (ts.isBinaryExpression(node)
        && node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment
        && node.operatorToken.kind <= ts.SyntaxKind.LastAssignment
        && nodeName(node.left) === LIVE_BARRIER) {
        report(node, `assigns canonical ${LIVE_BARRIER}`);
      }

      if (ts.isStringLiteralLike(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
        const documentaryData = isBinanceDocumentaryDataLiteral(file, node);
        const allowedSpotExecutionEndpoint = isAllowedBinanceSpotExecutionEndpoint(
          file,
          node,
        );
        const allowedSpotProductionTransportLiteral =
          isAllowedBinanceSpotProductionTransportLiteral(file, node);
        if (
          /^(?:https?|wss?):\/\//i.test(node.text)
          && !documentaryData
          && !allowedSpotProductionTransportLiteral
        ) report(node, 'embeds a network target');
        if (
          !documentaryData
          && !allowedSpotExecutionEndpoint
          && !allowedSpotProductionTransportLiteral
          && /X-MBX|(?:^|[?&])signature=|\/(?:api|sapi|fapi|dapi|vapi)\/v\d+\/[^\s]*(?:order|loan|borrow|repay|withdraw|transfer)|\/(?:order\/test|test\/order)(?:$|[?/#])/i.test(node.text)
        ) {
          report(node, 'embeds a signed/private/money endpoint');
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

function withImportTripwires(run) {
  const attempts = [];
  const patches = [];
  const denied = (name) => function deniedImportBoundary() {
    attempts.push(name);
    throw new Error(`IMPORT_PURITY_BOUNDARY_USED:${name}`);
  };

  patchProperty(patches, Date, 'now', denied('Date.now'));
  patchProperty(patches, Math, 'random', denied('Math.random'));
  patchProperty(patches, globalThis, 'fetch', denied('fetch'));
  patchProperty(patches, globalThis, 'WebSocket', class ForbiddenWebSocket {
    constructor() {
      attempts.push('WebSocket');
      throw new Error('IMPORT_PURITY_BOUNDARY_USED:WebSocket');
    }
  });
  patchProperty(patches, globalThis, 'EventSource', class ForbiddenEventSource {
    constructor() {
      attempts.push('EventSource');
      throw new Error('IMPORT_PURITY_BOUNDARY_USED:EventSource');
    }
  });
  for (const name of ['queueMicrotask', 'setImmediate', 'setInterval', 'setTimeout']) {
    patchProperty(patches, globalThis, name, denied(name));
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
    // Node's ESM loader necessarily opens the JavaScript being imported. Permit
    // only that internal loader path; application-visible fs.openSync remains a
    // hard tripwire, and all source fs imports are independently AST-blocked.
    if (new Error().stack?.includes('node:internal/modules/esm/load:')) {
      return originalOpenSync.apply(this, args);
    }
    attempts.push('fs.openSync');
    throw new Error('IMPORT_PURITY_BOUNDARY_USED:fs.openSync');
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
  syncBuiltinESMExports();

  return Promise.resolve()
    .then(() => run(attempts))
    .finally(() => {
      for (const { target, key, descriptor } of patches.reverse()) {
        if (descriptor === undefined) delete target[key];
        else Object.defineProperty(target, key, descriptor);
      }
      syncBuiltinESMExports();
    });
}

function unwrapExpression(node) {
  let current = node;
  while (current && (
    ts.isAsExpression(current)
    || ts.isParenthesizedExpression(current)
    || ts.isSatisfiesExpression(current)
    || ts.isTypeAssertionExpression(current)
  )) current = current.expression;
  return current;
}

function isClosedLiteralData(node) {
  const current = unwrapExpression(node);
  if (!current) return false;
  if (ts.isStringLiteralLike(current) || ts.isNumericLiteral(current)) return true;
  if ([ts.SyntaxKind.NullKeyword, ts.SyntaxKind.TrueKeyword, ts.SyntaxKind.FalseKeyword].includes(current.kind)) {
    return true;
  }
  if (ts.isPrefixUnaryExpression(current)
    && current.operator === ts.SyntaxKind.MinusToken
    && ts.isNumericLiteral(current.operand)) return true;
  if (ts.isArrayLiteralExpression(current)) {
    return current.elements.every((element) => !ts.isSpreadElement(element) && isClosedLiteralData(element));
  }
  if (ts.isObjectLiteralExpression(current)) {
    return current.properties.every((property) => (
      ts.isPropertyAssignment(property)
      && !ts.isComputedPropertyName(property.name)
      && isClosedLiteralData(property.initializer)
    ));
  }
  return false;
}

function exactStringLiteralMembers(typeNode, label) {
  const members = ts.isUnionTypeNode(typeNode) ? typeNode.types : [typeNode];
  return new Set(members.map((member) => {
    assert.ok(
      ts.isLiteralTypeNode(member) && ts.isStringLiteralLike(member.literal),
      `${label} must contain string literals only`,
    );
    return member.literal.text;
  }));
}

function typeAliasLiteralMembers(tree, name) {
  const declarations = tree.statements.filter((statement) => (
    ts.isTypeAliasDeclaration(statement) && statement.name.text === name
  ));
  assert.equal(declarations.length, 1, `${name} must have one declaration`);
  return exactStringLiteralMembers(declarations[0].type, name);
}

function interfacePropertyLiteralMembers(tree, interfaceName, propertyName) {
  const declarations = tree.statements.filter((statement) => (
    ts.isInterfaceDeclaration(statement) && statement.name.text === interfaceName
  ));
  assert.equal(declarations.length, 1, `${interfaceName} must have one declaration`);
  const properties = declarations[0].members.filter((member) => (
    ts.isPropertySignature(member) && nodeName(member.name) === propertyName
  ));
  assert.equal(properties.length, 1, `${interfaceName}.${propertyName} must have one declaration`);
  assert.ok(properties[0].type, `${interfaceName}.${propertyName} must declare a type`);
  return exactStringLiteralMembers(
    properties[0].type,
    `${interfaceName}.${propertyName}`,
  );
}

test('Binance endpoint and provenance literals are confined to inert closed documentary data', () => {
  const tree = parse(BINANCE_DOCUMENTARY_DATA_SOURCE);
  const exports = new Set();

  for (const statement of tree.statements) {
    if (ts.isImportDeclaration(statement)) {
      assert.equal(statement.importClause?.isTypeOnly, true, 'documentary data may use type-only imports');
      continue;
    }
    assert.equal(ts.isVariableStatement(statement), true, 'documentary data module may contain only type imports and const exports');
    assert.ok(statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword));
    assert.ok((statement.declarationList.flags & ts.NodeFlags.Const) !== 0, 'documentary data exports must be const');
    assert.equal(statement.declarationList.declarations.length, 1, 'one documentary export per declaration');
    const declaration = statement.declarationList.declarations[0];
    const name = nodeName(declaration.name);
    assert.ok(name && BINANCE_DOCUMENTARY_DATA_EXPORTS.has(name), `unexpected documentary data export ${name}`);
    assert.equal(isClosedLiteralData(declaration.initializer), true, `${name} must be a closed literal data tree`);
    exports.add(name);
  }

  assert.deepEqual(exports, BINANCE_DOCUMENTARY_DATA_EXPORTS);
});

test('the M0 Spot dispatch contract, adapter, and transport are exact-leaf and exact-executor-mounted', () => {
  const dispatchTree = parse(BINANCE_SPOT_DISPATCH_SOURCE);
  const tree = parse(BINANCE_SPOT_EXECUTION_SOURCE);
  const transportTree = parse(BINANCE_SPOT_PRODUCTION_TRANSPORT_SOURCE);
  const executionImports = tree.statements.filter((statement) => (
    ts.isImportDeclaration(statement)
    && moduleName(statement.moduleSpecifier)?.includes('/foundation/execution/')
  ));
  assert.equal(
    executionImports.length,
    BINANCE_SPOT_EXECUTION_TYPE_IMPORTS.size
      + BINANCE_SPOT_EXECUTION_VALUE_IMPORTS.size,
    'adapter Foundation execution imports must remain the exact approved declarations',
  );
  for (const statement of executionImports) {
    assert.equal(
      isAllowedBinanceSpotExecutionTypeImport(
        BINANCE_SPOT_EXECUTION_SOURCE,
        statement,
        moduleName(statement.moduleSpecifier),
      ) || isAllowedBinanceSpotExecutionValueImport(
        BINANCE_SPOT_EXECUTION_SOURCE,
        statement,
        moduleName(statement.moduleSpecifier),
      ),
      true,
      'Foundation execution imports must remain the exact approved named type and digest imports',
    );
  }
  const digestValueImports = executionImports.filter((statement) => (
    isAllowedBinanceSpotExecutionValueImport(
      BINANCE_SPOT_EXECUTION_SOURCE,
      statement,
      moduleName(statement.moduleSpecifier),
    )
  ));
  assert.equal(
    digestValueImports.length,
    BINANCE_SPOT_EXECUTION_VALUE_IMPORTS.size,
    'adapter may value-import only the exact dispatch and lifecycle digest declarations',
  );
  assert.equal(
    tree.statements.some((statement) => (
      (ts.isTypeAliasDeclaration(statement)
        && [
          'BinanceSpotExecutionContractId',
          'BinanceSpotExecutionOperation',
        ].includes(statement.name.text))
      || (ts.isInterfaceDeclaration(statement)
        && [
          'BinanceSpotDispatchAuthorityPort',
          'BinanceSpotDispatchPermit',
          'BinanceSpotSignedTransportPort',
          'BinanceSpotSignedTransportRequest',
        ].includes(statement.name.text))
    )),
    false,
    'adapter must consume Foundation dispatch contracts rather than redeclare them',
  );

  assert.deepEqual(
    typeAliasLiteralMembers(dispatchTree, 'BinanceSpotExecutionContractId'),
    BINANCE_SPOT_EXECUTION_CONTRACTS,
  );
  assert.deepEqual(
    typeAliasLiteralMembers(dispatchTree, 'BinanceSpotExecutionOperation'),
    new Set(['CANCEL', 'FLATTEN', 'QUERY_FILLS', 'QUERY_ORDER', 'SIGNED_TEST', 'SUBMIT']),
  );
  assert.deepEqual(
    interfacePropertyLiteralMembers(
      dispatchTree,
      'BinanceSpotSignedTransportRequest',
      'method',
    ),
    new Set(['DELETE', 'GET', 'POST']),
  );
  assert.deepEqual(
    interfacePropertyLiteralMembers(
      dispatchTree,
      'BinanceSpotSignedTransportRequest',
      'path',
    ),
    BINANCE_SPOT_EXECUTION_ENDPOINTS,
  );
  assert.deepEqual(
    typeAliasLiteralMembers(dispatchTree, 'BinanceSpotCredentialProfile'),
    new Set(['SPOT_TRADE_EXECUTION', 'USER_DATA_READ']),
  );

  const endpointLiterals = new Set();
  const requestCapabilities = [];
  const adapterMethods = new Set();
  walk(tree, (node) => {
    if (
      (ts.isStringLiteralLike(node) || ts.isNoSubstitutionTemplateLiteral(node))
      && /^\/(?:api|sapi|fapi|dapi|vapi)\//u.test(node.text)
    ) {
      endpointLiterals.add(node.text);
    }
    if (
      ts.isCallExpression(node)
      && ts.isIdentifier(node.expression)
      && node.expression.text === 'request'
    ) {
      assert.equal(node.arguments.length, 5, 'request capability arity must stay exact');
      const capability = node.arguments.slice(0, 4).map((argument) => {
        assert.ok(ts.isStringLiteralLike(argument), 'request capability fields must be literals');
        return argument.text;
      });
      requestCapabilities.push(capability.join('|'));
    }
    if (
      ts.isMethodDeclaration(node)
      && ts.isObjectLiteralExpression(node.parent)
      && BINANCE_SPOT_EXECUTION_PORT_METHODS.has(nodeName(node.name))
    ) {
      adapterMethods.add(nodeName(node.name));
    }
  });
  assert.deepEqual(endpointLiterals, BINANCE_SPOT_EXECUTION_ENDPOINTS);
  assert.deepEqual(adapterMethods, BINANCE_SPOT_EXECUTION_PORT_METHODS);
  assert.deepEqual(requestCapabilities.sort(), [
    'CANCEL|SPOT_ORDER_CANCEL|DELETE|/api/v3/order',
    'FLATTEN|SPOT_ORDER_POST|POST|/api/v3/order',
    'QUERY_FILLS|SPOT_MY_TRADES_QUERY|GET|/api/v3/myTrades',
    'QUERY_ORDER|SPOT_ORDER_QUERY|GET|/api/v3/order',
    'SIGNED_TEST|SPOT_TEST_ORDER_POST|POST|/api/v3/order/test',
    'SUBMIT|SPOT_ORDER_POST|POST|/api/v3/order',
  ]);

  const transportAuthorityImports = transportTree.statements.filter((statement) => (
    ts.isImportDeclaration(statement)
    && /\/foundation\/(?:execution|risk)\//u.test(
      moduleName(statement.moduleSpecifier) ?? '',
    )
  ));
  assert.equal(
    transportAuthorityImports.length,
    BINANCE_SPOT_PRODUCTION_TRANSPORT_TYPE_IMPORTS.size
      + BINANCE_SPOT_PRODUCTION_TRANSPORT_VALUE_IMPORTS.size,
    'production transport must use only exact Foundation dispatch and risk imports',
  );
  for (const statement of transportAuthorityImports) {
    assert.equal(
      isAllowedBinanceSpotProductionTransportTypeImport(
        BINANCE_SPOT_PRODUCTION_TRANSPORT_SOURCE,
        statement,
        moduleName(statement.moduleSpecifier),
      ) || isAllowedBinanceSpotProductionTransportValueImport(
        BINANCE_SPOT_PRODUCTION_TRANSPORT_SOURCE,
        statement,
        moduleName(statement.moduleSpecifier),
      ),
      true,
      'production transport Foundation authority imports must remain exact',
    );
  }
  const transportEndpointLiterals = new Set();
  const transportNetworkLiterals = new Set();
  walk(transportTree, (node) => {
    if (!ts.isStringLiteralLike(node) && !ts.isNoSubstitutionTemplateLiteral(node)) {
      return;
    }
    if (/^\/api\/v3\//u.test(node.text)) {
      transportEndpointLiterals.add(node.text);
    }
    if (/^https:\/\//u.test(node.text) || node.text === 'X-MBX-APIKEY') {
      transportNetworkLiterals.add(node.text);
    }
  });
  assert.deepEqual(
    transportEndpointLiterals,
    BINANCE_SPOT_EXECUTION_ENDPOINTS,
    'production transport may embed only the three exact Spot endpoints',
  );
  assert.deepEqual(
    transportNetworkLiterals,
    BINANCE_SPOT_PRODUCTION_TRANSPORT_LITERALS,
    'production transport may embed only the exact Binance origin and API-key header',
  );
  const transportOptions = transportTree.statements.filter((statement) => (
    ts.isInterfaceDeclaration(statement)
    && statement.name.text === 'M0SpotProductionTransportOptions'
  ));
  assert.equal(transportOptions.length, 1);
  const transportOptionNames = new Set(transportOptions[0].members.map(
    (member) => nodeName(member.name),
  ));
  assert.equal(transportOptionNames.has('signer'), false);
  assert.equal(transportOptionNames.has('readSigner'), true);
  assert.equal(transportOptionNames.has('executionSigner'), true);

  const runtimeSurfaceMentions = filesUnder(SERVER_SOURCE_ROOT, '.ts')
    .filter((file) => {
      const relative = path.relative(SERVER_SOURCE_ROOT, file);
      const segments = relative.split(path.sep);
      return path.basename(file) === 'index.ts'
        || segments.includes('bootstrap')
        || segments.includes('composition')
        || segments.includes('application')
        || segments.includes('production');
    })
    .filter((file) => fs.readFileSync(file, 'utf8').includes('binanceSpotExecution'))
    .map((file) => path.relative(process.cwd(), file));
  assert.deepEqual(
    runtimeSurfaceMentions,
    [path.relative(process.cwd(), BINANCE_SPOT_PRODUCTION_EXECUTOR_SOURCE)],
    'Spot execution adapter may be mounted only by the exact production executor, never by barrels, bootstrap, or general composition',
  );
  const productionExecutorTree = parse(BINANCE_SPOT_PRODUCTION_EXECUTOR_SOURCE);
  const productionAdapterImports = productionExecutorTree.statements.filter((statement) => (
    ts.isImportDeclaration(statement)
    && moduleName(statement.moduleSpecifier)
      === '../../liveEdge/adapters/binanceSpotExecution/adapter.js'
  ));
  assert.equal(productionAdapterImports.length, 1, 'production executor must import the adapter exactly once');
  const productionAdapterImport = productionAdapterImports[0];
  assert.equal(productionAdapterImport.importClause?.isTypeOnly, false);
  assert.equal(productionAdapterImport.importClause?.name, undefined);
  assert.ok(
    productionAdapterImport.importClause?.namedBindings
      && ts.isNamedImports(productionAdapterImport.importClause.namedBindings),
  );
  assert.deepEqual(
    new Set(productionAdapterImport.importClause.namedBindings.elements.map(
      (element) => element.name.text,
    )),
    new Set(['createBinanceSpotExecutionAdapter']),
    'production executor may import only the exact adapter factory value',
  );
  const productionTransportImports = productionExecutorTree.statements.filter(
    (statement) => (
      ts.isImportDeclaration(statement)
      && moduleName(statement.moduleSpecifier)
        === '../../liveEdge/adapters/binanceSpotExecution/productionTransport.js'
    ),
  );
  assert.equal(
    productionTransportImports.length,
    1,
    'production executor must import the concrete transport exactly once',
  );
  assert.equal(productionTransportImports[0].importClause?.name, undefined);
  assert.ok(
    productionTransportImports[0].importClause?.namedBindings
      && ts.isNamedImports(
        productionTransportImports[0].importClause.namedBindings,
      ),
  );
  assert.deepEqual(
    new Set(
      productionTransportImports[0].importClause.namedBindings.elements.map(
        (element) => element.name.text,
      ),
    ),
    new Set(['M0SpotProductionSigner', 'createM0SpotProductionTransport']),
    'production executor may import only the transport factory and signer type',
  );
  const productionTransportConsumers = filesUnder(SERVER_SOURCE_ROOT, '.ts')
    .filter((file) => file !== BINANCE_SPOT_PRODUCTION_TRANSPORT_SOURCE)
    .filter((file) => fs.readFileSync(file, 'utf8').includes(
      'binanceSpotExecution/productionTransport',
    ))
    .map((file) => path.relative(process.cwd(), file));
  assert.deepEqual(
    productionTransportConsumers,
    [path.relative(process.cwd(), BINANCE_SPOT_PRODUCTION_EXECUTOR_SOURCE)],
    'concrete transport must remain direct-import-only to the exact executor',
  );
  assert.equal(
    fs.existsSync(path.resolve(
      'server/src/binance/m0SpotProductionTransport.ts',
    )),
    false,
    'concrete transport must not remain in the legacy Binance source family',
  );
  assert.equal(
    fs.existsSync(path.join(path.dirname(BINANCE_SPOT_EXECUTION_SOURCE), 'index.ts')),
    false,
    'Spot execution adapter must not gain a local barrel',
  );
});

test('live-edge source has no ambient, money-moving, or canonical-authority seam', () => {
  const files = filesUnder(SOURCE_ROOT, '.ts');
  assert.ok(files.length >= 10, 'expected the complete L01 live-edge source tree');
  assert.deepEqual(staticViolations(files), []);
});

test('every built live-edge module imports inertly under clock, egress, filesystem, and environment tripwires', async () => {
  const sourceFiles = filesUnder(SOURCE_ROOT, '.ts');
  const importErrors = [];
  const modules = [];

  await withImportTripwires(async (attempts) => {
    for (const [index, source] of sourceFiles.entries()) {
      const relative = path.relative(SOURCE_ROOT, source).replace(/\.ts$/, '.js');
      const target = path.join(DIST_ROOT, relative);
      try {
        modules.push(await import(`${pathToFileURL(target).href}?l01-import-purity=${index}`));
      } catch (error) {
        importErrors.push(`${relative}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    const applicationAttempts = attempts.filter((attempt) => attempt !== 'process.env:WATCH_REPORT_DEPENDENCIES');
    assert.deepEqual(importErrors, [], `all ${sourceFiles.length} live-edge modules must import successfully`);
    assert.deepEqual(applicationAttempts, [], 'live-edge import must not touch an ambient boundary');
  });

  assert.equal(modules.length, sourceFiles.length);
  const rootIndex = sourceFiles.findIndex((file) => file === path.join(SOURCE_ROOT, 'index.ts'));
  assert.ok(rootIndex >= 0, 'live-edge root barrel must exist');
  assert.equal(typeof modules[rootIndex].EdgeProtocolV1Client, 'function');
  assert.equal(typeof modules[rootIndex].EdgeAssessmentBridge, 'function');
  assert.equal(typeof modules[rootIndex].matchDocumentedBinanceContract, 'function');
  assert.equal(modules[rootIndex].BINANCE_CONTRACT_MATRIX.documentaryAuthority, 'DOCUMENTARY_EVIDENCE_ONLY');
});

test('the canonical live-execution barrier is unchanged and still blocks LIVE mode', async () => {
  const tree = parse(CANONICAL_BARRIER_SOURCE);
  const declarations = [];
  walk(tree, (node) => {
    if (ts.isVariableDeclaration(node) && nodeName(node.name) === LIVE_BARRIER) declarations.push(node);
  });
  assert.equal(declarations.length, 1, 'canonical barrier must have exactly one declaration');
  const initializer = unwrapExpression(declarations[0].initializer);
  assert.ok(initializer && ts.isStringLiteral(initializer));
  assert.equal(initializer.text, LIVE_BARRIER);

  const contracts = await import('../../../dist/systemIntegration/contracts/index.js');
  assert.equal(contracts.LIVE_EXECUTION_NOT_IMPLEMENTED, LIVE_BARRIER);
  const resolved = contracts.resolveSystemSafeMode('LIVE', {
    nowMs: 1_750_000_000_000,
    correlationId: 'l01-import-purity-live-barrier',
    safeCurrentState: 'READ_ONLY',
  });
  assert.equal(resolved.ok, false);
  assert.equal(resolved.failure.code, LIVE_BARRIER);
});
