import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_REPOSITORY_ROOT = resolve(SCRIPT_DIRECTORY, '../..');
export const SCHEMA_VERSION = 'production-operation-scan.v1';

export const OPERATION_KINDS = Object.freeze({
  NETWORK_HTTP_REQUEST: 'NETWORK_HTTP_REQUEST',
  STREAM_CONNECT: 'STREAM_CONNECT',
  STREAM_SERVER: 'STREAM_SERVER',
  STREAM_SEND: 'STREAM_SEND',
  QUEUE_CREATE: 'QUEUE_CREATE',
  QUEUE_PUBLISH: 'QUEUE_PUBLISH',
  QUEUE_CONSUME: 'QUEUE_CONSUME',
  DATABASE_OPEN: 'DATABASE_OPEN',
  DATABASE_QUERY: 'DATABASE_QUERY',
  DATABASE_MUTATION: 'DATABASE_MUTATION',
  DATABASE_TRANSACTION: 'DATABASE_TRANSACTION',
  MUTATION_CALL: 'MUTATION_CALL',
  DEPLOYMENT_CLIENT: 'DEPLOYMENT_CLIENT',
  DEPLOYMENT_COMMAND: 'DEPLOYMENT_COMMAND',
  COMMAND_DISPATCH: 'COMMAND_DISPATCH',
  HTTP_SERVER_CREATE: 'HTTP_SERVER_CREATE',
  HTTP_SERVER_LISTEN: 'HTTP_SERVER_LISTEN',
});

const HTTP_KINDS = Object.freeze([OPERATION_KINDS.NETWORK_HTTP_REQUEST]);
const STREAM_CLIENT_KINDS = Object.freeze([
  OPERATION_KINDS.STREAM_CONNECT,
  OPERATION_KINDS.STREAM_SEND,
]);
const QUEUE_KINDS = Object.freeze([
  OPERATION_KINDS.QUEUE_CREATE,
  OPERATION_KINDS.QUEUE_PUBLISH,
  OPERATION_KINDS.QUEUE_CONSUME,
]);
const DATABASE_KINDS = Object.freeze([
  OPERATION_KINDS.DATABASE_OPEN,
  OPERATION_KINDS.DATABASE_QUERY,
  OPERATION_KINDS.DATABASE_MUTATION,
  OPERATION_KINDS.DATABASE_TRANSACTION,
]);

/**
 * Explicit, ordered production-path registry. There is deliberately no
 * kind-only catch-all: a newly discovered operation in a new path remains
 * unregistered (`operationId: null`) until an owner adds a reviewed rule.
 */
export const OPERATION_MAPPING_REGISTRY = Object.freeze([
  Object.freeze({
    ruleId: 'legacy-signed-and-money-boundaries',
    operationId: 'OP_LEGACY_SIGNED_MONEY_PATH_DORMANT_BLOCKED',
    pathExact: Object.freeze([
      'server/src/binance/client.ts',
      'server/src/binance/userStream.ts',
      'server/src/services/orders.ts',
      'server/src/services/loans.ts',
      'server/src/foundation/exchange/binanceUsdM/client.ts',
    ]),
    pathPrefixes: Object.freeze([]),
    kinds: Object.freeze([
      OPERATION_KINDS.NETWORK_HTTP_REQUEST,
      OPERATION_KINDS.STREAM_CONNECT,
      OPERATION_KINDS.STREAM_SEND,
      OPERATION_KINDS.MUTATION_CALL,
    ]),
    symbolPattern: null,
  }),
  Object.freeze({
    ruleId: 'legacy-money-route-entrypoints',
    operationId: 'OP_LEGACY_SIGNED_MONEY_PATH_DORMANT_BLOCKED',
    pathExact: Object.freeze(['server/src/index.ts']),
    pathPrefixes: Object.freeze([]),
    kinds: Object.freeze([OPERATION_KINDS.MUTATION_CALL]),
    symbolPattern: '^(?:orders|loans)\\.(?:send|testOrder|borrow|repay|adjustLtv)$',
  }),
  Object.freeze({
    ruleId: 'aws-runner-control',
    operationId: 'OP_AWS_RUNNER_CONTROL',
    pathExact: Object.freeze(['server/src/services/awsRunnerControl.ts']),
    pathPrefixes: Object.freeze([]),
    kinds: Object.freeze([
      OPERATION_KINDS.DEPLOYMENT_CLIENT,
      OPERATION_KINDS.DEPLOYMENT_COMMAND,
    ]),
    symbolPattern: null,
  }),
  Object.freeze({
    ruleId: 'durable-ledger-sqlite',
    operationId: 'OP_LEDGER_SQLITE',
    pathExact: Object.freeze(['server/src/ledger.ts']),
    pathPrefixes: Object.freeze([]),
    kinds: DATABASE_KINDS,
    symbolPattern: null,
  }),
  Object.freeze({
    ruleId: 'intelligence-runtime-bounded-queues',
    operationId: 'OP_RUNTIME_IN_MEMORY_QUEUE',
    pathExact: Object.freeze([]),
    pathPrefixes: Object.freeze(['server/src/intelligenceRuntime/']),
    kinds: QUEUE_KINDS,
    symbolPattern: null,
  }),
  Object.freeze({
    ruleId: 'explicit-local-bounded-work-queues',
    operationId: 'OP_RUNTIME_IN_MEMORY_QUEUE',
    pathExact: Object.freeze([
      'server/src/binance/icons.ts',
      'server/src/foundation/replay/capture.ts',
    ]),
    pathPrefixes: Object.freeze([]),
    kinds: QUEUE_KINDS,
    symbolPattern: null,
  }),
  Object.freeze({
    ruleId: 'public-binance-websocket-streams',
    operationId: 'OP_PUBLIC_WEBSOCKET_STREAM',
    pathExact: Object.freeze([
      'server/src/binance/ws.ts',
      'server/src/binance/liquidations.ts',
    ]),
    pathPrefixes: Object.freeze([]),
    kinds: STREAM_CLIENT_KINDS,
    symbolPattern: null,
  }),
  Object.freeze({
    ruleId: 'public-intelligence-runtime-websocket-streams',
    operationId: 'OP_PUBLIC_WEBSOCKET_STREAM',
    pathExact: Object.freeze([]),
    pathPrefixes: Object.freeze(['server/src/intelligenceRuntime/']),
    kinds: STREAM_CLIENT_KINDS,
    symbolPattern: null,
  }),
  Object.freeze({
    ruleId: 'public-http-fixed-adapters',
    operationId: 'OP_PUBLIC_HTTP_READ',
    pathExact: Object.freeze([
      'server/src/binance/icons.ts',
      'server/src/binance/moneyflow.ts',
      'server/src/binance/profile.ts',
      'server/src/binance/rest.ts',
      'server/src/index.ts',
      'server/src/services/newsContext.ts',
    ]),
    pathPrefixes: Object.freeze([]),
    kinds: HTTP_KINDS,
    symbolPattern: null,
  }),
  Object.freeze({
    ruleId: 'public-http-intelligence-runtime-ports',
    operationId: 'OP_PUBLIC_HTTP_READ',
    pathExact: Object.freeze([]),
    pathPrefixes: Object.freeze(['server/src/intelligenceRuntime/']),
    kinds: HTTP_KINDS,
    symbolPattern: null,
  }),
  Object.freeze({
    ruleId: 'canonical-system-integration-commands',
    operationId: 'OP_SYSTEM_INTEGRATION_COMMAND',
    pathExact: Object.freeze([]),
    pathPrefixes: Object.freeze(['server/src/systemIntegration/']),
    kinds: Object.freeze([OPERATION_KINDS.COMMAND_DISPATCH]),
    symbolPattern: null,
  }),
  Object.freeze({
    ruleId: 'http-and-websocket-server-surface',
    operationId: 'OP_HTTP_SERVER_SURFACE',
    pathExact: Object.freeze(['server/src/index.ts']),
    pathPrefixes: Object.freeze([]),
    kinds: Object.freeze([
      OPERATION_KINDS.HTTP_SERVER_CREATE,
      OPERATION_KINDS.HTTP_SERVER_LISTEN,
      OPERATION_KINDS.STREAM_SERVER,
    ]),
    symbolPattern: null,
  }),
  Object.freeze({
    ruleId: 'operator-websocket-fanout',
    operationId: 'OP_OUTBOUND_WEBSOCKET_FANOUT',
    pathExact: Object.freeze([
      'server/src/index.ts',
      'server/src/services/bookStream.ts',
    ]),
    pathPrefixes: Object.freeze([]),
    kinds: Object.freeze([OPERATION_KINDS.STREAM_SEND]),
    symbolPattern: null,
  }),
]);

function portablePath(path) {
  return path.split(sep).join('/');
}

function listTypeScriptFiles(rootDirectory) {
  const output = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name, 'en'))) {
      const absolute = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'productAssurance') continue;
        visit(absolute);
      } else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
        output.push(absolute);
      }
    }
  };
  visit(rootDirectory);
  return output;
}

function importedBindings(sourceFile) {
  const bindings = new Map();
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const moduleName = statement.moduleSpecifier.text;
    const clause = statement.importClause;
    if (!clause || clause.isTypeOnly) continue;
    if (clause.name) bindings.set(clause.name.text, Object.freeze({ moduleName, importedName: 'default' }));
    const named = clause.namedBindings;
    if (named && ts.isNamespaceImport(named)) {
      bindings.set(named.name.text, Object.freeze({ moduleName, importedName: '*' }));
    } else if (named && ts.isNamedImports(named)) {
      for (const element of named.elements) {
        if (element.isTypeOnly) continue;
        bindings.set(element.name.text, Object.freeze({
          moduleName,
          importedName: element.propertyName?.text ?? element.name.text,
        }));
      }
    }
  }
  return bindings;
}

function expressionName(expression) {
  if (ts.isIdentifier(expression) || ts.isPrivateIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  if (ts.isElementAccessExpression(expression) && expression.argumentExpression && ts.isStringLiteralLike(expression.argumentExpression)) {
    return expression.argumentExpression.text;
  }
  return null;
}

function receiverText(expression, sourceFile) {
  if (ts.isPropertyAccessExpression(expression) || ts.isElementAccessExpression(expression)) {
    return expression.expression.getText(sourceFile).replace(/\s+/g, '');
  }
  return '';
}

function callText(expression, sourceFile) {
  return expression.getText(sourceFile).replace(/\s+/g, '');
}

function staticText(node) {
  if (!node) return null;
  const expression = unwrapExpression(node);
  if (ts.isStringLiteralLike(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) return expression.text;
  return null;
}

const CALL_ORIGINS = Object.freeze({
  FETCH: 'FETCH',
  NODE_HTTP: 'NODE_HTTP',
  NODE_HTTP_REQUEST: 'NODE_HTTP_REQUEST',
  NODE_HTTP_GET: 'NODE_HTTP_GET',
  AXIOS: 'AXIOS',
  AXIOS_CREATE: 'AXIOS_CREATE',
  AXIOS_REQUEST: 'AXIOS_REQUEST',
  AWS_CLIENT: 'AWS_CLIENT',
  AWS_SEND: 'AWS_SEND',
  UNRESOLVED_EXTERNAL: 'UNRESOLVED_EXTERNAL',
});

const NODE_HTTP_MODULES = Object.freeze(new Set(['http', 'https', 'node:http', 'node:https']));
const AXIOS_READ_METHODS = Object.freeze(new Set(['get', 'head', 'options']));
const AXIOS_MUTATION_METHODS = Object.freeze(new Set([
  'delete', 'patch', 'patchForm', 'post', 'postForm', 'put', 'putForm',
]));

function unwrapExpression(node) {
  let current = node;
  while (current && (
    ts.isParenthesizedExpression(current)
    || ts.isAsExpression(current)
    || ts.isTypeAssertionExpression(current)
    || ts.isNonNullExpression(current)
    || (typeof ts.isSatisfiesExpression === 'function' && ts.isSatisfiesExpression(current))
  )) current = current.expression;
  return current;
}

function expressionKey(node, sourceFile) {
  const expression = unwrapExpression(node);
  if (ts.isIdentifier(expression)
    || ts.isPrivateIdentifier(expression)
    || ts.isPropertyAccessExpression(expression)
    || ts.isElementAccessExpression(expression)) {
    return expression.getText(sourceFile).replace(/\s+/g, '');
  }
  return null;
}

function propertyNameText(name) {
  if (!name) return null;
  if (ts.isIdentifier(name) || ts.isPrivateIdentifier(name) || ts.isStringLiteralLike(name)) return name.text;
  if (ts.isComputedPropertyName(name)) return staticText(name.expression);
  return null;
}

function importedOrigin(binding) {
  if (!binding) return null;
  if (NODE_HTTP_MODULES.has(binding.moduleName)) {
    if (binding.importedName === 'default' || binding.importedName === '*') return CALL_ORIGINS.NODE_HTTP;
    if (binding.importedName === 'request') return CALL_ORIGINS.NODE_HTTP_REQUEST;
    if (binding.importedName === 'get') return CALL_ORIGINS.NODE_HTTP_GET;
    return null;
  }
  if (binding.moduleName === 'axios') {
    if (binding.importedName === 'default' || binding.importedName === '*') return CALL_ORIGINS.AXIOS;
    if (binding.importedName === 'request') return CALL_ORIGINS.AXIOS_REQUEST;
    if (binding.importedName === 'create') return CALL_ORIGINS.AXIOS_CREATE;
    if (AXIOS_READ_METHODS.has(binding.importedName) || AXIOS_MUTATION_METHODS.has(binding.importedName)) {
      return `AXIOS_METHOD:${binding.importedName}`;
    }
    return null;
  }
  if (binding.moduleName.startsWith('@aws-sdk/')) {
    if (/Client$/u.test(binding.importedName)) return `AWS_CLIENT_CONSTRUCTOR:${binding.importedName}`;
    if (/Command$/u.test(binding.importedName)) return `AWS_COMMAND_CONSTRUCTOR:${binding.importedName}`;
  }
  return null;
}

function memberOrigin(receiverOrigin, memberName) {
  if (receiverOrigin === CALL_ORIGINS.NODE_HTTP) {
    if (memberName === 'request') return CALL_ORIGINS.NODE_HTTP_REQUEST;
    if (memberName === 'get') return CALL_ORIGINS.NODE_HTTP_GET;
  }
  if (receiverOrigin === CALL_ORIGINS.AXIOS) {
    if (memberName === 'create') return CALL_ORIGINS.AXIOS_CREATE;
    if (memberName === 'request') return CALL_ORIGINS.AXIOS_REQUEST;
    if (AXIOS_READ_METHODS.has(memberName) || AXIOS_MUTATION_METHODS.has(memberName)) {
      return `AXIOS_METHOD:${memberName}`;
    }
  }
  if (receiverOrigin === CALL_ORIGINS.AWS_CLIENT && memberName === 'send') return CALL_ORIGINS.AWS_SEND;
  if (receiverOrigin === CALL_ORIGINS.UNRESOLVED_EXTERNAL) return CALL_ORIGINS.UNRESOLVED_EXTERNAL;
  return null;
}

function expressionOrigin(node, sourceFile, imports, aliases) {
  const expression = unwrapExpression(node);
  const key = expressionKey(expression, sourceFile);
  if (key !== null && aliases.has(key)) return aliases.get(key);

  if (ts.isIdentifier(expression)) {
    if (expression.text === 'fetch') return CALL_ORIGINS.FETCH;
    return importedOrigin(imports.get(expression.text) ?? null);
  }

  if (ts.isPropertyAccessExpression(expression) || ts.isElementAccessExpression(expression)) {
    const memberName = expressionName(expression);
    const receiver = unwrapExpression(expression.expression);
    const receiverKey = expressionKey(receiver, sourceFile);
    if (memberName === 'fetch' && receiverKey !== null && /^(?:globalThis|self|window)$/u.test(receiverKey)) {
      return CALL_ORIGINS.FETCH;
    }
    const receiverOrigin = expressionOrigin(receiver, sourceFile, imports, aliases);
    return memberName === null ? null : memberOrigin(receiverOrigin, memberName);
  }

  if (ts.isCallExpression(expression)) {
    const callee = unwrapExpression(expression.expression);
    if ((ts.isPropertyAccessExpression(callee) || ts.isElementAccessExpression(callee))
      && expressionName(callee) === 'bind') {
      return expressionOrigin(callee.expression, sourceFile, imports, aliases);
    }
    const calleeOrigin = expressionOrigin(callee, sourceFile, imports, aliases);
    if (calleeOrigin === CALL_ORIGINS.AXIOS_CREATE) return CALL_ORIGINS.AXIOS;
    return null;
  }

  if (ts.isNewExpression(expression)) {
    const constructorOrigin = expressionOrigin(expression.expression, sourceFile, imports, aliases);
    if (constructorOrigin?.startsWith('AWS_CLIENT_CONSTRUCTOR:')) return CALL_ORIGINS.AWS_CLIENT;
    if (constructorOrigin?.startsWith('AWS_COMMAND_CONSTRUCTOR:')) {
      return `AWS_COMMAND:${constructorOrigin.slice('AWS_COMMAND_CONSTRUCTOR:'.length)}`;
    }
  }
  return null;
}

function collectAliasOrigins(sourceFile, imports) {
  const entries = [];
  const collect = (node) => {
    if (ts.isVariableDeclaration(node) && node.initializer) {
      if (ts.isIdentifier(node.name)) {
        entries.push(Object.freeze({ key: node.name.text, initializer: node.initializer, memberName: null }));
      } else if (ts.isObjectBindingPattern(node.name)) {
        for (const element of node.name.elements) {
          if (!ts.isIdentifier(element.name) || element.dotDotDotToken) continue;
          const memberName = propertyNameText(element.propertyName ?? element.name);
          if (memberName !== null) {
            entries.push(Object.freeze({ key: element.name.text, initializer: node.initializer, memberName }));
          }
        }
      }
    } else if (ts.isBinaryExpression(node)
      && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
      && (ts.isIdentifier(node.left) || ts.isPropertyAccessExpression(node.left) || ts.isElementAccessExpression(node.left))) {
      const key = expressionKey(node.left, sourceFile);
      if (key !== null) entries.push(Object.freeze({ key, initializer: node.right, memberName: null }));
    }
    ts.forEachChild(node, collect);
  };
  collect(sourceFile);

  const aliases = new Map();
  for (let pass = 0; pass <= entries.length; pass += 1) {
    let changed = false;
    for (const entry of entries) {
      let origin = expressionOrigin(entry.initializer, sourceFile, imports, aliases);
      if (origin !== null && entry.memberName !== null) origin = memberOrigin(origin, entry.memberName);
      if (origin === null) continue;
      const existing = aliases.get(entry.key) ?? null;
      const next = existing === null || existing === origin ? origin : CALL_ORIGINS.UNRESOLVED_EXTERNAL;
      if (existing !== next) {
        aliases.set(entry.key, next);
        changed = true;
      }
    }
    if (!changed) break;
  }
  return aliases;
}

function methodDisposition(node, absentLabel = 'GET') {
  if (!node) return Object.freeze({ classification: 'READ', label: absentLabel });
  const expression = unwrapExpression(node);
  if (expression.kind === ts.SyntaxKind.UndefinedKeyword || expression.kind === ts.SyntaxKind.NullKeyword) {
    return Object.freeze({ classification: 'READ', label: absentLabel });
  }
  if (!ts.isObjectLiteralExpression(expression)) {
    return Object.freeze({ classification: 'UNKNOWN', label: 'DYNAMIC_INIT' });
  }

  let result = Object.freeze({ classification: 'READ', label: absentLabel });
  for (const property of expression.properties) {
    if (ts.isSpreadAssignment(property)) {
      result = Object.freeze({ classification: 'UNKNOWN', label: 'DYNAMIC_METHOD' });
      continue;
    }
    const propertyName = propertyNameText(property.name);
    if (propertyName === null) {
      result = Object.freeze({ classification: 'UNKNOWN', label: 'DYNAMIC_METHOD' });
      continue;
    }
    if (propertyName !== 'method') continue;
    if (!ts.isPropertyAssignment(property)) {
      result = Object.freeze({ classification: 'UNKNOWN', label: 'DYNAMIC_METHOD' });
      continue;
    }
    const initializer = unwrapExpression(property.initializer);
    if (initializer.kind === ts.SyntaxKind.UndefinedKeyword) {
      result = Object.freeze({ classification: 'READ', label: absentLabel });
      continue;
    }
    const method = staticText(initializer)?.toUpperCase() ?? null;
    if (method === null) result = Object.freeze({ classification: 'UNKNOWN', label: 'DYNAMIC_METHOD' });
    else if (method === 'GET' || method === 'HEAD') result = Object.freeze({ classification: 'READ', label: method });
    else result = Object.freeze({ classification: 'MUTATION', label: method });
  }
  return result;
}

function nodeRequestDisposition(args) {
  if (args.length === 0) return Object.freeze({ classification: 'READ', label: 'GET' });
  const first = unwrapExpression(args[0]);
  if (ts.isObjectLiteralExpression(first)) return methodDisposition(first);
  if (staticText(first) !== null || (ts.isNewExpression(first) && expressionName(first.expression) === 'URL')) {
    return methodDisposition(args[1]);
  }
  return Object.freeze({ classification: 'UNKNOWN', label: 'DYNAMIC_OPTIONS' });
}

function axiosDisposition(origin, args) {
  if (origin.startsWith('AXIOS_METHOD:')) {
    const method = origin.slice('AXIOS_METHOD:'.length);
    return Object.freeze({
      classification: AXIOS_READ_METHODS.has(method) ? 'READ' : 'MUTATION',
      label: method.toUpperCase(),
    });
  }
  if (origin === CALL_ORIGINS.AXIOS_REQUEST) return methodDisposition(args[0]);
  if (origin === CALL_ORIGINS.AXIOS) {
    if (args.length === 0) return Object.freeze({ classification: 'UNKNOWN', label: 'DYNAMIC_CONFIG' });
    const first = unwrapExpression(args[0]);
    if (ts.isObjectLiteralExpression(first)) return methodDisposition(first);
    if (staticText(first) !== null) return methodDisposition(args[1]);
    return Object.freeze({ classification: 'UNKNOWN', label: 'DYNAMIC_CONFIG' });
  }
  return null;
}

function sqlVerb(node) {
  const text = ts.isTemplateExpression(node) ? node.head.text : staticText(node);
  if (text === null) return 'DYNAMIC';
  const withoutComments = text.replace(/^\s*(?:--[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*/u, '').trim();
  return withoutComments.match(/^([A-Za-z]+)/u)?.[1]?.toUpperCase() ?? 'EMPTY';
}

function commandName(node) {
  if (!node || !ts.isNewExpression(node)) return null;
  return expressionName(node.expression);
}

function queueReceiver(receiver) {
  return /(?:queue|queues|buffer)/iu.test(receiver);
}

function streamReceiver(receiver) {
  return /(?:^|[.#])(ws|wss|socket|connection|transport)$/iu.test(receiver)
    || /(?:websocket|socket|connection)/iu.test(receiver)
    || receiver === 'c';
}

function requestReceiver(receiver, relativePath) {
  if (/(?:transport|client|http|rest)/iu.test(receiver)) return true;
  return receiver === 'this' && relativePath === 'server/src/binance/client.ts';
}

function mutatingRequestSymbol(name, args) {
  if (name !== 'request') return null;
  const method = staticText(args[0]);
  if (!method || !['POST', 'PUT', 'PATCH', 'DELETE'].includes(method.toUpperCase())) return null;
  return `request:${method.toUpperCase()}:${staticText(args[1]) ?? 'DYNAMIC_PATH'}`;
}

function databaseKind(method, firstArgument) {
  if (method === 'transaction') return OPERATION_KINDS.DATABASE_TRANSACTION;
  if (method === 'pragma') return OPERATION_KINDS.DATABASE_MUTATION;
  const verb = sqlVerb(firstArgument);
  if (['SELECT', 'WITH', 'EXPLAIN'].includes(verb)) return OPERATION_KINDS.DATABASE_QUERY;
  if (method === 'prepare' && verb === 'PRAGMA') return OPERATION_KINDS.DATABASE_QUERY;
  return OPERATION_KINDS.DATABASE_MUTATION;
}

function nodeLocation(sourceFile, node) {
  const location = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  return Object.freeze({ line: location.line + 1, column: location.character + 1 });
}

function collectFileCandidates(absolutePath, relativePath) {
  const text = readFileSync(absolutePath, 'utf8');
  const sourceFile = ts.createSourceFile(relativePath, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const imports = importedBindings(sourceFile);
  const aliases = collectAliasOrigins(sourceFile, imports);
  const candidates = [];
  const add = (node, kind, symbol) => {
    const location = nodeLocation(sourceFile, node);
    candidates.push({
      path: relativePath,
      line: location.line,
      column: location.column,
      kind,
      symbol,
      start: node.getStart(sourceFile),
    });
  };

  const visit = (node) => {
    if (ts.isNewExpression(node)) {
      const localName = expressionName(node.expression);
      const binding = localName === null ? null : imports.get(localName) ?? null;
      const constructorOrigin = expressionOrigin(node.expression, sourceFile, imports, aliases);
      if (binding?.moduleName === 'ws') {
        if (binding.importedName === 'WebSocketServer') add(node, OPERATION_KINDS.STREAM_SERVER, `new:${localName}`);
        else add(node, OPERATION_KINDS.STREAM_CONNECT, `new:${localName}`);
      } else if (binding?.moduleName === 'better-sqlite3') {
        add(node, OPERATION_KINDS.DATABASE_OPEN, `new:${localName}`);
      } else if (constructorOrigin?.startsWith('AWS_CLIENT_CONSTRUCTOR:')) {
        add(node, OPERATION_KINDS.DEPLOYMENT_CLIENT, `new:${constructorOrigin.slice('AWS_CLIENT_CONSTRUCTOR:'.length)}`);
      } else if (localName !== null && /(?:Queue|Buffer)$/u.test(localName)) {
        add(node, OPERATION_KINDS.QUEUE_CREATE, `new:${localName}`);
      }
    } else if (ts.isCallExpression(node)) {
      const name = expressionName(node.expression);
      const receiver = receiverText(node.expression, sourceFile);
      const callee = callText(node.expression, sourceFile);
      const args = [...node.arguments];
      const directBinding = ts.isIdentifier(node.expression) ? imports.get(node.expression.text) ?? null : null;
      const callOrigin = expressionOrigin(node.expression, sourceFile, imports, aliases);
      const commandOrigin = args[0] ? expressionOrigin(args[0], sourceFile, imports, aliases) : null;
      const aliasedAwsCommand = commandOrigin?.startsWith('AWS_COMMAND:')
        ? commandOrigin.slice('AWS_COMMAND:'.length)
        : null;
      const awsCommand = name === 'send' ? commandName(args[0]) : null;
      const mutationRequest = mutatingRequestSymbol(name, args);
      const fetchLike = callOrigin === CALL_ORIGINS.FETCH
        || (name !== null && /^(?:fetch|fetchFn|#fetch)$/iu.test(name));
      const fetchDisposition = fetchLike ? methodDisposition(args[1]) : null;
      const nodeHttpDisposition = callOrigin === CALL_ORIGINS.NODE_HTTP_REQUEST
        ? nodeRequestDisposition(args)
        : null;
      const resolvedAxiosDisposition = callOrigin !== null && (callOrigin === CALL_ORIGINS.AXIOS
        || callOrigin === CALL_ORIGINS.AXIOS_REQUEST
        || callOrigin.startsWith('AXIOS_METHOD:'))
        ? axiosDisposition(callOrigin, args)
        : null;

      if (directBinding?.moduleName === 'node:child_process'
        && ['exec', 'execFile', 'fork', 'spawn'].includes(directBinding.importedName)) {
        add(node, OPERATION_KINDS.DEPLOYMENT_COMMAND, `${directBinding.importedName}:child_process`);
      } else if (callOrigin === CALL_ORIGINS.AWS_SEND) {
        add(node, OPERATION_KINDS.DEPLOYMENT_COMMAND, `send:${aliasedAwsCommand ?? awsCommand ?? 'UNRESOLVED_AWS_COMMAND'}`);
      } else if (awsCommand !== null && /Command$/u.test(awsCommand)) {
        add(node, OPERATION_KINDS.DEPLOYMENT_COMMAND, `send:${awsCommand}`);
      } else if (fetchDisposition !== null && fetchDisposition.classification !== 'READ') {
        add(node, OPERATION_KINDS.MUTATION_CALL, `fetch:${fetchDisposition.label}`);
      } else if (fetchDisposition !== null) {
        add(node, OPERATION_KINDS.NETWORK_HTTP_REQUEST, callee);
      } else if (nodeHttpDisposition !== null && nodeHttpDisposition.classification !== 'READ') {
        add(node, OPERATION_KINDS.MUTATION_CALL, `node-http-request:${nodeHttpDisposition.label}`);
      } else if (nodeHttpDisposition !== null || callOrigin === CALL_ORIGINS.NODE_HTTP_GET) {
        add(node, OPERATION_KINDS.NETWORK_HTTP_REQUEST, `${callee}:${nodeHttpDisposition?.label ?? 'GET'}`);
      } else if (resolvedAxiosDisposition !== null && resolvedAxiosDisposition.classification !== 'READ') {
        add(node, OPERATION_KINDS.MUTATION_CALL, `axios:${resolvedAxiosDisposition.label}`);
      } else if (resolvedAxiosDisposition !== null) {
        add(node, OPERATION_KINDS.NETWORK_HTTP_REQUEST, `axios:${resolvedAxiosDisposition.label}`);
      } else if (callOrigin === CALL_ORIGINS.UNRESOLVED_EXTERNAL) {
        add(node, OPERATION_KINDS.MUTATION_CALL, 'unresolved-external:DYNAMIC');
      } else if (name !== null && ['prepare', 'exec', 'transaction', 'pragma'].includes(name) && /(?:^|[.#])db$/iu.test(receiver)) {
        add(node, databaseKind(name, args[0]), `${name}:${sqlVerb(args[0])}`);
      } else if (mutationRequest !== null && requestReceiver(receiver, relativePath)) {
        add(node, OPERATION_KINDS.MUTATION_CALL, mutationRequest);
      } else if (name === 'request' && requestReceiver(receiver, relativePath)) {
        add(node, OPERATION_KINDS.NETWORK_HTTP_REQUEST, `${callee}:${staticText(args[0]) ?? 'DYNAMIC_REQUEST'}`);
      } else if (name !== null && /socketFactory$/iu.test(name)) {
        add(node, OPERATION_KINDS.STREAM_CONNECT, callee);
      } else if (name === 'connect' && /(?:transport|socket|stream)/iu.test(receiver)) {
        add(node, OPERATION_KINDS.STREAM_CONNECT, callee);
      } else if (name === 'send' && streamReceiver(receiver)) {
        add(node, OPERATION_KINDS.STREAM_SEND, callee);
      } else if (name !== null && ['offer', 'enqueue', 'publish'].includes(name) && queueReceiver(receiver)) {
        add(node, OPERATION_KINDS.QUEUE_PUBLISH, callee);
      } else if (name !== null && ['clear', 'dequeue', 'shift', 'consume'].includes(name) && queueReceiver(receiver)) {
        add(node, OPERATION_KINDS.QUEUE_CONSUME, callee);
      } else if (name !== null && [
        'testOrder',
        'placeOrder',
        'cancelOrder',
        'cancelAllOrders',
        'createOrder',
        'submitOrder',
        'amendOrder',
        'replaceOrder',
        'borrow',
        'repay',
        'adjustLtv',
        'flexibleBorrow',
        'flexibleRepay',
        'flexibleAdjustLtv',
        'withdraw',
        'transfer',
        'setLeverage',
        'changeLeverage',
        'setMarginMode',
        'changeMarginMode',
        'setPositionMode',
      ].includes(name)) {
        add(node, OPERATION_KINDS.MUTATION_CALL, callee);
      } else if (name === 'send' && /(?:^|[.#])orders$/iu.test(receiver)) {
        add(node, OPERATION_KINDS.MUTATION_CALL, callee);
      } else if (name === 'createServer' && /(?:^|[.#])(?:http|https)$/iu.test(receiver)) {
        add(node, OPERATION_KINDS.HTTP_SERVER_CREATE, callee);
      } else if (name === 'listen' && /(?:server|listener)/iu.test(receiver)) {
        add(node, OPERATION_KINDS.HTTP_SERVER_LISTEN, callee);
      } else if (name !== null && ['execute', 'dispatch'].includes(name)
        && relativePath.startsWith('server/src/systemIntegration/')
        && /(?:command|control|orchestrat|validateOnly)/iu.test(receiver)) {
        add(node, OPERATION_KINDS.COMMAND_DISPATCH, callee);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return candidates;
}

function matchesRule(site, rule) {
  if (!rule.kinds.includes(site.kind)) return false;
  const pathMatched = rule.pathExact.includes(site.path)
    || rule.pathPrefixes.some((prefix) => site.path.startsWith(prefix));
  if (!pathMatched) return false;
  return rule.symbolPattern === null || new RegExp(rule.symbolPattern, 'u').test(site.symbol);
}

export function mapOperationSite(site, registry = OPERATION_MAPPING_REGISTRY) {
  const rule = registry.find((candidate) => matchesRule(site, candidate)) ?? null;
  return Object.freeze({
    operationId: rule?.operationId ?? null,
    mappingRuleId: rule?.ruleId ?? null,
  });
}

function stableSiteId(site, occurrence) {
  const material = `${SCHEMA_VERSION}\n${site.path}\n${site.kind}\n${site.symbol}\n${occurrence}`;
  return `OPSITE_${createHash('sha256').update(material).digest('hex').slice(0, 20).toUpperCase()}`;
}

function countByOperation(sites) {
  const counts = new Map();
  for (const site of sites) {
    const key = site.operationId ?? 'UNREGISTERED';
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Object.freeze(Object.fromEntries([...counts.entries()].sort(([left], [right]) => left.localeCompare(right, 'en'))));
}

export function scanProductionOperations(options = {}) {
  const repositoryRoot = resolve(options.repositoryRoot ?? DEFAULT_REPOSITORY_ROOT);
  const sourceRoot = resolve(repositoryRoot, 'server/src');
  if (!existsSync(sourceRoot)) throw new Error(`production source root does not exist: ${sourceRoot}`);
  const files = listTypeScriptFiles(sourceRoot);
  const candidates = files.flatMap((absolutePath) => collectFileCandidates(
    absolutePath,
    portablePath(relative(repositoryRoot, absolutePath)),
  ));
  candidates.sort((left, right) => left.path.localeCompare(right.path, 'en') || left.start - right.start || left.kind.localeCompare(right.kind, 'en'));

  const occurrences = new Map();
  const sites = candidates.map((candidate) => {
    const key = `${candidate.path}\0${candidate.kind}\0${candidate.symbol}`;
    const occurrence = (occurrences.get(key) ?? 0) + 1;
    occurrences.set(key, occurrence);
    const mapping = mapOperationSite(candidate, options.registry ?? OPERATION_MAPPING_REGISTRY);
    return Object.freeze({
      siteId: stableSiteId(candidate, occurrence),
      path: candidate.path,
      line: candidate.line,
      column: candidate.column,
      kind: candidate.kind,
      symbol: candidate.symbol,
      operationId: mapping.operationId,
      mappingRuleId: mapping.mappingRuleId,
    });
  });
  const uncoveredSites = Object.freeze(sites.filter((site) => site.operationId === null));
  return Object.freeze({
    schemaVersion: SCHEMA_VERSION,
    scannedRoot: 'server/src',
    excluded: Object.freeze(['server/src/productAssurance/**']),
    filesScanned: files.length,
    discovered: sites.length,
    covered: sites.length - uncoveredSites.length,
    uncovered: uncoveredSites.length,
    operationCounts: countByOperation(sites),
    sites: Object.freeze(sites),
    uncoveredSites,
  });
}

function printHumanReport(report) {
  process.stdout.write(`${report.schemaVersion}\n`);
  process.stdout.write(`files scanned: ${report.filesScanned}\n`);
  process.stdout.write(`operation sites: ${report.discovered}\n`);
  process.stdout.write(`registered: ${report.covered}\n`);
  process.stdout.write(`uncovered: ${report.uncovered}\n`);
  for (const [operationId, count] of Object.entries(report.operationCounts)) {
    process.stdout.write(`  ${operationId}: ${count}\n`);
  }
  if (report.uncoveredSites.length > 0) {
    process.stdout.write('exact uncovered sites:\n');
    for (const site of report.uncoveredSites) {
      process.stdout.write(`  ${site.path}:${site.line}:${site.column} ${site.kind} ${site.symbol} ${site.siteId}\n`);
    }
  }
}

function parseArguments(args) {
  let json = false;
  let failOnUncovered = false;
  let repositoryRoot = DEFAULT_REPOSITORY_ROOT;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--json') json = true;
    else if (argument === '--fail-on-uncovered') failOnUncovered = true;
    else if (argument === '--root') {
      const value = args[index + 1];
      if (!value) throw new Error('--root requires a repository path');
      repositoryRoot = resolve(value);
      index += 1;
    } else {
      throw new Error(`unknown argument: ${argument}`);
    }
  }
  return Object.freeze({ json, failOnUncovered, repositoryRoot });
}

const isMain = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    const options = parseArguments(process.argv.slice(2));
    const report = scanProductionOperations({ repositoryRoot: options.repositoryRoot });
    if (options.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    else printHumanReport(report);
    if (options.failOnUncovered && report.uncovered > 0) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`production operation scan failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
}
