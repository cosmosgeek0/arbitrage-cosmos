import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { installEgressTripwire } from '../fixtures/egress-tripwire.mjs';

const SOURCE_ROOT = path.resolve('server/src/systemIntegration');
const DIST_ROOT = path.resolve('server/dist/systemIntegration');
const DATA_DIR_LEASE_SOURCE = path.resolve(
  'server/src/systemIntegration/persistence/dataDirLease.ts',
);
const DATA_DIR_LEASE_FS_CAPABILITIES = Object.freeze([
  'Stats',
  'closeSync',
  'constants',
  'fchmodSync',
  'fstatSync',
  'fsyncSync',
  'futimesSync',
  'linkSync',
  'lstatSync',
  'opendirSync',
  'openSync',
  'readSync',
  'unlinkSync',
  'writeSync',
].sort());
const CLIENT_CONVERGENCE_FILES = Object.freeze([
  path.resolve('web/src/lib/systemIntegration.ts'),
  path.resolve('web/src/components/SystemIntegrationSurface.tsx'),
]);

const FORBIDDEN_NODE_MODULES = new Set([
  'child_process',
  'fs',
  'http',
  'https',
  'net',
  'tls',
]);
const FORBIDDEN_PRIVATE_IMPORT_SYMBOLS = new Set([
  'AccountService',
  'LoanService',
  'OrderService',
  'UserStream',
  'UserStreamService',
]);
const FORBIDDEN_SECRET_FIELD_NAMES = new Set([
  'accessKey',
  'accessToken',
  'apiKey',
  'apiSecret',
  'authorization',
  'bearerToken',
  'credential',
  'credentials',
  'password',
  'privateKey',
  'secretKey',
  'signedRequest',
]);
const FORBIDDEN_MONEY_CALLS = new Set([
  'borrow',
  'borrowAsset',
  'cancelAllOrders',
  'cancelOrder',
  'createOrder',
  'loan',
  'newOrder',
  'placeOrder',
  'repay',
  'repayLoan',
  'sendOrder',
  'submitOrder',
  'testOrder',
  'transfer',
  'universalTransfer',
  'withdraw',
  'withdrawal',
]);
const NETWORK_CONSTRUCTORS = new Set(['EventSource', 'WebSocket']);
const NETWORK_CALLS = new Set(['fetch']);

function filesUnder(root, suffixes) {
  const files = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...filesUnder(target, suffixes));
    else if (entry.isFile() && suffixes.some((suffix) => entry.name.endsWith(suffix))) files.push(target);
  }
  return files.sort();
}

function scriptKind(file) {
  if (file.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (file.endsWith('.jsx')) return ts.ScriptKind.JSX;
  if (file.endsWith('.js') || file.endsWith('.mjs')) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

function parse(file) {
  const source = readFileSync(file, 'utf8');
  return {
    source,
    tree: ts.createSourceFile(file, source, ts.ScriptTarget.ESNext, true, scriptKind(file)),
  };
}

function nodeName(node) {
  if (node === undefined) return null;
  if (ts.isIdentifier(node) || ts.isPrivateIdentifier(node)) return node.text;
  if (ts.isStringLiteralLike(node) || ts.isNumericLiteral(node)) return node.text;
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  if (ts.isElementAccessExpression(node) && node.argumentExpression && ts.isStringLiteralLike(node.argumentExpression)) {
    return node.argumentExpression.text;
  }
  return null;
}

function calleeName(expression) {
  if (ts.isIdentifier(expression) || ts.isPropertyAccessExpression(expression) || ts.isElementAccessExpression(expression)) {
    return nodeName(expression);
  }
  return null;
}

function moduleName(node) {
  return ts.isStringLiteralLike(node) ? node.text : null;
}

function normalizedNodeModule(specifier) {
  const bare = specifier.startsWith('node:') ? specifier.slice(5) : specifier;
  return bare.split('/')[0];
}

function forbiddenImportReason(specifier) {
  const nodeModule = normalizedNodeModule(specifier);
  if (FORBIDDEN_NODE_MODULES.has(nodeModule) && (
    specifier.startsWith('node:')
    || specifier === nodeModule
    || specifier.startsWith(`${nodeModule}/`)
  )) {
    return `imports forbidden Node transport/filesystem module ${specifier}`;
  }
  if (/(?:^|\/)foundation\/exchange\/binanceUsdM(?:\/|\.|$)/i.test(specifier)) {
    return 'imports the signed Binance USD-M boundary';
  }
  if (/(?:^|\/)binance\/(?:client|signed[^/]*)(?:\/|\.|$)/i.test(specifier)) {
    return 'imports a Binance signed/private client';
  }
  if (/(?:^|\/)services\/(?:orders|loans|account|userStream)(?:\/|\.|$)/i.test(specifier)) {
    return 'imports an audited private account/order/loan/user-stream service';
  }
  if (specifier === 'process' || specifier === 'node:process') return 'imports ambient process state';
  return null;
}

function approvedDataDirLeaseFsImport(file, node, specifier) {
  if (path.resolve(file) !== DATA_DIR_LEASE_SOURCE
      || specifier !== 'node:fs'
      || !ts.isImportDeclaration(node)
      || node.importClause === undefined
      || node.importClause.name !== undefined
      || node.importClause.namedBindings === undefined
      || !ts.isNamedImports(node.importClause.namedBindings)) return false;
  const importedNames = [];
  for (const element of node.importClause.namedBindings.elements) {
    if (element.propertyName !== undefined
        || element.isTypeOnly !== (element.name.text === 'Stats')) return false;
    importedNames.push(element.name.text);
  }
  importedNames.sort();
  return importedNames.length === DATA_DIR_LEASE_FS_CAPABILITIES.length
    && importedNames.every((name, index) => name === DATA_DIR_LEASE_FS_CAPABILITIES[index]);
}

function isProcessEnv(node) {
  if (!ts.isPropertyAccessExpression(node) && !ts.isElementAccessExpression(node)) return false;
  const property = nodeName(node);
  if (property !== 'env') return false;
  const expression = node.expression;
  return ts.isIdentifier(expression) && ['process', 'Bun', 'Deno'].includes(expression.text);
}

function literalBoolean(node) {
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) return literalBoolean(node.expression);
  return null;
}

function literalString(node) {
  if (ts.isStringLiteralLike(node)) return node.text;
  if (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) return literalString(node.expression);
  return null;
}

function location(file, tree, node) {
  const point = tree.getLineAndCharacterOfPosition(node.getStart(tree));
  return `${path.relative(process.cwd(), file)}:${point.line + 1}:${point.character + 1}`;
}

function walk(node, visit) {
  visit(node);
  ts.forEachChild(node, (child) => walk(child, visit));
}

function productionViolations(files) {
  const violations = [];
  let submitPaperDefinitions = 0;
  let sealedPortDefinitions = 0;

  for (const file of files) {
    const { tree } = parse(file);
    const report = (node, message) => violations.push(`${location(file, tree, node)} ${message}`);

    walk(tree, (node) => {
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
        if (node.moduleSpecifier === undefined) return;
        const specifier = moduleName(node.moduleSpecifier);
        if (specifier === null) return;
        const reason = forbiddenImportReason(specifier);
        if (reason && !approvedDataDirLeaseFsImport(file, node, specifier)) {
          report(node.moduleSpecifier, reason);
        }
        if (ts.isImportDeclaration(node) && node.importClause) {
          const importedNames = [];
          if (node.importClause.name) importedNames.push(node.importClause.name.text);
          const bindings = node.importClause.namedBindings;
          if (bindings && ts.isNamedImports(bindings)) {
            for (const element of bindings.elements) importedNames.push(element.propertyName?.text ?? element.name.text);
          }
          for (const name of importedNames) {
            if (FORBIDDEN_PRIVATE_IMPORT_SYMBOLS.has(name)) report(node, `imports forbidden private authority ${name}`);
          }
        }
      }

      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        const specifier = node.arguments[0] && moduleName(node.arguments[0]);
        if (specifier !== null) {
          const reason = forbiddenImportReason(specifier);
          if (reason) report(node, `dynamically ${reason}`);
        }
      }

      if (isProcessEnv(node)) report(node, 'reads ambient environment state');

      if (ts.isCallExpression(node)) {
        const name = calleeName(node.expression);
        if (name && NETWORK_CALLS.has(name)) report(node, `calls network primitive ${name}`);
        if (name && FORBIDDEN_MONEY_CALLS.has(name)) report(node, `invokes money-action verb ${name}`);
        if (name === 'submitPaper') report(node, 'invokes submitPaper outside the sealed dry-run method definition');
        if (name === 'require' && node.arguments[0]) {
          const specifier = moduleName(node.arguments[0]);
          if (specifier !== null) {
            const reason = forbiddenImportReason(specifier);
            if (reason) report(node, `requires a forbidden boundary: ${reason}`);
          }
        }

        if (
          ts.isPropertyAccessExpression(node.expression)
          && ts.isIdentifier(node.expression.expression)
          && node.expression.expression.text === 'Object'
          && (node.expression.name.text === 'freeze' || node.expression.name.text === 'seal')
          && node.arguments.length === 1
          && ts.isIdentifier(node.arguments[0])
          && node.arguments[0].text === 'ports'
        ) sealedPortDefinitions += 1;
      }

      if (ts.isNewExpression(node)) {
        const name = calleeName(node.expression);
        if (name && NETWORK_CONSTRUCTORS.has(name)) report(node, `constructs network primitive ${name}`);
      }

      if (
        (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node))
        && nodeName(node) === 'submitPaper'
      ) report(node, 'obtains submitPaper outside the sealed dry-run method definition');

      if (
        (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node))
        && FORBIDDEN_SECRET_FIELD_NAMES.has(nodeName(node) ?? '')
      ) report(node, `accesses credential-like field ${nodeName(node)}`);

      if (ts.isStringLiteralLike(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
        const value = node.text;
        if (/^(?:https?|wss?):\/\//i.test(value)) report(node, 'embeds a network target');
        if (/X-MBX|(?:^|[?&])signature=|\/(?:api|sapi|fapi|dapi|vapi)\/v\d+\/[^\s]*(?:order|loan|borrow|repay|withdraw|transfer)|\/(?:order\/test|test\/order)(?:$|[?/#])/i.test(value)) {
          report(node, 'embeds a signed, private, test-order, or money endpoint');
        }
        if (FORBIDDEN_SECRET_FIELD_NAMES.has(value)) report(node, `contains credential-like field name ${value}`);
      }

      if (
        ts.isPropertySignature(node)
        || ts.isPropertyDeclaration(node)
        || ts.isPropertyAssignment(node)
        || ts.isShorthandPropertyAssignment(node)
        || ts.isBindingElement(node)
        || ts.isMethodSignature(node)
        || ts.isMethodDeclaration(node)
      ) {
        const name = nodeName(node.name);
        if (name && FORBIDDEN_SECRET_FIELD_NAMES.has(name)) report(node, `declares credential-like field ${name}`);
      }

      if (ts.isPropertyAssignment(node)) {
        const name = nodeName(node.name);
        if (name === 'liveExecutionPermitted' && literalBoolean(node.initializer) !== false) {
          report(node, 'does not pin liveExecutionPermitted to false');
        }
        if (['executionReady', 'executionPermitted', 'canExecute', 'liveAllowed'].includes(name ?? '')
          && literalBoolean(node.initializer) === true) {
          report(node, `grants executable authority through ${name}`);
        }
        if (name === 'executionAuthority') {
          const authority = literalString(node.initializer);
          if (authority !== null && authority !== 'NONE') report(node, `grants executionAuthority ${authority}`);
        }
      }

      if (ts.isShorthandPropertyAssignment(node)
        && ['liveExecutionPermitted', 'executionAuthority', 'executionReady', 'executionPermitted', 'canExecute', 'liveAllowed'].includes(node.name.text)) {
        report(node, `uses unprovable shorthand authority field ${node.name.text}`);
      }

      if (ts.isPropertySignature(node)) {
        const name = nodeName(node.name);
        if (name === 'liveExecutionPermitted' && node.type && ts.isLiteralTypeNode(node.type)
          && node.type.literal.kind !== ts.SyntaxKind.FalseKeyword) {
          report(node, 'types liveExecutionPermitted as an executable grant');
        }
        if (name === 'executionAuthority' && node.type && ts.isLiteralTypeNode(node.type)
          && ts.isStringLiteral(node.type.literal) && node.type.literal.text !== 'NONE') {
          report(node, `types executionAuthority as ${node.type.literal.text}`);
        }
      }

      if (ts.isMethodDeclaration(node) && nodeName(node.name) === 'submitPaper') {
        submitPaperDefinitions += 1;
        if (!file.endsWith(path.join('verticalSlice', 'dryRunVenue.ts'))) {
          report(node, 'defines submitPaper outside the sealed dry-run venue');
        }
      }
    });
  }

  if (submitPaperDefinitions !== 1) violations.push(`expected exactly one sealed submitPaper definition, found ${submitPaperDefinitions}`);
  if (sealedPortDefinitions < 1) violations.push('sealed dry-run ports are not frozen or sealed');
  return violations;
}

function withPatchedImportBoundaries(run) {
  const descriptors = new Map();
  const calls = [];
  const patch = (target, key, replacement) => {
    const descriptor = Object.getOwnPropertyDescriptor(target, key);
    descriptors.set(`${key}:${descriptors.size}`, { target, key, descriptor });
    Object.defineProperty(target, key, {
      configurable: true,
      enumerable: descriptor?.enumerable ?? false,
      writable: true,
      value: replacement,
    });
  };
  const denied = (name) => (..._args) => {
    calls.push(name);
    throw new Error(`IMPORT_BOUNDARY_USED:${name}`);
  };
  const OriginalWebSocket = globalThis.WebSocket;

  patch(Date, 'now', denied('Date.now'));
  patch(Math, 'random', denied('Math.random'));
  patch(globalThis, 'fetch', denied('fetch'));
  patch(globalThis, 'WebSocket', class ForbiddenWebSocket {
    constructor() {
      calls.push('WebSocket');
      throw new Error('IMPORT_BOUNDARY_USED:WebSocket');
    }
  });
  patch(globalThis, 'setTimeout', denied('setTimeout'));
  patch(globalThis, 'setInterval', denied('setInterval'));
  patch(globalThis, 'setImmediate', denied('setImmediate'));

  return Promise.resolve()
    .then(() => run(calls))
    .finally(() => {
      const values = [...descriptors.values()].reverse();
      for (const { target, key, descriptor } of values) {
        if (descriptor === undefined) delete target[key];
        else Object.defineProperty(target, key, descriptor);
      }
      if (OriginalWebSocket === undefined) delete globalThis.WebSocket;
    });
}

test('production convergence source has no private, signed, money-moving, ambient, or execution-grant seam', () => {
  const files = filesUnder(SOURCE_ROOT, ['.ts', '.tsx']);
  assert.ok(files.length >= 30, 'expected the complete system-integration production source tree');
  assert.deepEqual(productionViolations(files), []);
});

test('DATA_DIR lease filesystem capability is exact-path, exact-module, and exact-name only', () => {
  const actual = parse(DATA_DIR_LEASE_SOURCE).tree.statements.find((statement) => (
    ts.isImportDeclaration(statement)
    && moduleName(statement.moduleSpecifier) === 'node:fs'
  ));
  assert.ok(actual && ts.isImportDeclaration(actual));
  assert.equal(approvedDataDirLeaseFsImport(DATA_DIR_LEASE_SOURCE, actual, 'node:fs'), true);

  const approvedSource = readFileSync(DATA_DIR_LEASE_SOURCE, 'utf8');
  const importText = actual.getText(parse(DATA_DIR_LEASE_SOURCE).tree);
  const mutations = [
    { file: path.resolve('server/src/systemIntegration/persistence/other.ts'), text: importText },
    { file: DATA_DIR_LEASE_SOURCE, text: importText.replace("'node:fs'", "'node:fs/promises'") },
    { file: DATA_DIR_LEASE_SOURCE, text: importText.replace('  closeSync,\n', '') },
    { file: DATA_DIR_LEASE_SOURCE, text: importText.replace('  closeSync,', '  closeSync as closeLease,') },
    { file: DATA_DIR_LEASE_SOURCE, text: importText.replace('  type Stats,', '  Stats,') },
    { file: DATA_DIR_LEASE_SOURCE, text: `import fs from 'node:fs';` },
    { file: DATA_DIR_LEASE_SOURCE, text: importText.replace('  writeSync,', '  writeSync,\n  readFileSync,') },
  ];
  assert.ok(approvedSource.includes(importText));
  for (const mutation of mutations) {
    const tree = ts.createSourceFile(
      mutation.file,
      mutation.text,
      ts.ScriptTarget.ESNext,
      true,
      ts.ScriptKind.TS,
    );
    const declaration = tree.statements.find(ts.isImportDeclaration);
    assert.ok(declaration);
    assert.equal(
      approvedDataDirLeaseFsImport(
        mutation.file,
        declaration,
        moduleName(declaration.moduleSpecifier),
      ),
      false,
      mutation.text,
    );
  }
});

test('all production convergence barrels import inertly with egress, timers, clock, and random patched', async () => {
  const barrelSources = filesUnder(SOURCE_ROOT, ['index.ts']);
  assert.ok(barrelSources.length >= 8, 'expected integration barrels for every production lane');
  const token = `${process.pid}-${barrelSources.length}`;
  await withPatchedImportBoundaries(async (calls) => {
    for (const source of barrelSources) {
      const relative = path.relative(SOURCE_ROOT, source).replace(/\.ts$/, '.js');
      const target = path.join(DIST_ROOT, relative);
      await import(`${pathToFileURL(target).href}?security-import=${token}-${encodeURIComponent(relative)}`);
    }
    assert.deepEqual(calls, []);
  });
});

test('read ports are passive and expose no refresh, lifecycle, mutation, or transport method', () => {
  const files = filesUnder(SOURCE_ROOT, ['.ts', '.tsx']);
  const readInterfaces = [];
  const violations = [];
  const forbiddenReadMembers = /^(?:refresh|reload|start|stop|restart|connect|disconnect|execute|submit|mutate|write|send|borrow|repay|withdraw|transfer)/i;

  for (const file of files) {
    const { tree } = parse(file);
    walk(tree, (node) => {
      if (!ts.isInterfaceDeclaration(node) || !/(?:ReadPort|ReadPorts)$/.test(node.name.text)) return;
      readInterfaces.push(node.name.text);
      for (const member of node.members) {
        const name = nodeName(member.name);
        if (name && forbiddenReadMembers.test(name)) {
          violations.push(`${location(file, tree, member)} read interface exposes ${name}`);
        }
      }
    });
    walk(tree, (node) => {
      if (!ts.isPropertyAccessExpression(node) || node.name.text !== 'refresh') return;
      if (ts.isPropertyAccessExpression(node.expression)
        && ts.isPropertyAccessExpression(node.expression.expression)
        && node.expression.expression.name.text === 'read') {
        violations.push(`${location(file, tree, node)} invokes refresh through a read port`);
      }
    });
  }

  assert.ok(readInterfaces.includes('SystemIntegrationReadPort'));
  assert.ok(readInterfaces.includes('ApplicationComponentReadPort'));
  assert.deepEqual(violations, []);

  const { tree } = parse(path.join(SOURCE_ROOT, 'routes', 'types.ts'));
  const integrationRead = tree.statements.find((node) => (
    ts.isInterfaceDeclaration(node) && node.name.text === 'SystemIntegrationReadPort'
  ));
  assert.ok(integrationRead && ts.isInterfaceDeclaration(integrationRead));
  assert.deepEqual(
    integrationRead.members.map((member) => nodeName(member.name)).sort(),
    ['controls', 'events', 'graph', 'supervisor', 'trace'],
  );
});

test('blocked execution modes fail closed without reaching transport, venue submission, or domain owners', async () => {
  const tripwire = installEgressTripwire();
  try {
    const contracts = await import('../../../dist/systemIntegration/contracts/index.js');
    const controls = await import('../../../dist/systemIntegration/controls/index.js');
    const verticalSlice = await import('../../../dist/systemIntegration/verticalSlice/index.js');
    const persisted = [];
    const orchestrator = new verticalSlice.ValidateOnlyOrchestrator({
      persistValidateOnly: async (record) => {
        persisted.push(record);
        return { persistenceId: `security-rejection-${persisted.length}` };
      },
    });
    const canonicalBlockedModes = new Set(['LIVE', 'LIVE_MANUAL', 'MANUAL_ARMED', 'EXECUTION_LIVE', 'AUTONOMOUS']);
    const blockedModes = [...canonicalBlockedModes, 'live-auto'];
    for (const [index, requestedMode] of blockedModes.entries()) {
      const context = {
        nowMs: 1_750_000_000_000 + index,
        correlationId: `security-mode-${index}`,
        safeCurrentState: 'READ_ONLY',
      };
      const translated = contracts.resolveSystemSafeMode(requestedMode, context);
      assert.equal(translated.ok, false);
      assert.equal(
        translated.failure.code,
        canonicalBlockedModes.has(requestedMode) ? 'LIVE_EXECUTION_NOT_IMPLEMENTED' : 'INVALID_SAFE_MODE',
      );

      const mutation = controls.validateControlMutation({ command: 'SET_SAFE_MODE', safeMode: requestedMode });
      assert.equal(mutation.ok, false);
      assert.equal(mutation.code, 'LIVE_EXECUTION_NOT_IMPLEMENTED');

      const result = await orchestrator.execute({
        requestedMode,
        nowMs: context.nowMs,
        correlationId: context.correlationId,
      });
      assert.equal(result.ok, false);
      assert.equal(result.snapshot.disposition, 'MODE_BLOCKED');
      assert.equal(result.snapshot.failure?.code, 'LIVE_EXECUTION_NOT_IMPLEMENTED');
      assert.equal(result.snapshot.executionAuthority, 'NONE');
      assert.equal(result.snapshot.liveExecutionPermitted, false);
      assert.equal(result.snapshot.venueAudit.submissionCalls, 0);
      assert.deepEqual(result.snapshot.ownerInvocations, {
        approvalEvaluations: 0,
        approvalUseReductions: 0,
        riskEvaluations: 0,
        executionDefinitionsCreated: 0,
        coordinatorsCreated: 0,
        coordinatorPreflights: 0,
        reconciliationEvaluations: 0,
        recoveryEvaluations: 0,
        persistenceReads: 0,
        persistenceWrites: 1,
      });
    }
    assert.equal(persisted.length, blockedModes.length);
    assert.ok(persisted.every((record) => (
      record.executionAuthority === 'NONE'
      && record.liveExecutionPermitted === false
      && record.venueAudit.submissionCalls === 0
    )));
    tripwire.assertNoAttempts('blocked execution-mode regression');
  } finally {
    tripwire.restore();
  }
});

test('client convergence boundary contains no credential fields or legacy live-execution endpoint', () => {
  const violations = [];
  for (const file of CLIENT_CONVERGENCE_FILES) {
    const { tree } = parse(file);
    walk(tree, (node) => {
      if (ts.isStringLiteralLike(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
        if (/\/api\/live(?:$|[?/#])/i.test(node.text)) {
          violations.push(`${location(file, tree, node)} calls the legacy live-execution endpoint`);
        }
        if (FORBIDDEN_SECRET_FIELD_NAMES.has(node.text)) {
          violations.push(`${location(file, tree, node)} contains credential-like field ${node.text}`);
        }
      }
      if (
        ts.isPropertySignature(node)
        || ts.isPropertyDeclaration(node)
        || ts.isPropertyAssignment(node)
        || ts.isBindingElement(node)
        || ts.isParameter(node)
      ) {
        const name = nodeName(node.name);
        if (name && FORBIDDEN_SECRET_FIELD_NAMES.has(name)) {
          violations.push(`${location(file, tree, node)} declares credential-like field ${name}`);
        }
      }
    });
  }
  assert.deepEqual(violations, []);
});
