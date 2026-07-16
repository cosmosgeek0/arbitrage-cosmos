import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { dirname, extname, isAbsolute, relative, resolve } from 'node:path';
import test from 'node:test';
import ts from 'typescript';

const repoRoot = realpathSync(new URL('../../../', import.meta.url));
const sourceRoot = resolve(repoRoot, 'web/src/aiOps');
const fixtureRoot = resolve(repoRoot, 'fixtures/aiOps/a4');
const receiptRoot = resolve(repoRoot, 'docs/archive/aiOps/a4');
const testRoot = resolve(repoRoot, 'web/test/aiOps');
const sharedUiOwner = realpathSync(resolve(repoRoot, 'web/src/components/ui.tsx'));
const sharedStylesOwner = realpathSync(resolve(repoRoot, 'web/src/styles.css'));
const buildOnlyPreviewEntry = realpathSync(resolve(sourceRoot, 'preview/main.tsx'));
const ownerChatEntry = realpathSync(resolve(sourceRoot, 'views/OwnerChat.tsx'));
const totalNetworkPreload = realpathSync(resolve(testRoot, 'total-network-deny-preload.mjs'));
const networkAttemptsKey = Symbol.for('aiops.a4.total-network-attempts.v1');
const allowedRoots = [sourceRoot, fixtureRoot, receiptRoot, testRoot];
const allowedExternalDependencies = new Set(['lucide-react', 'react', 'react-dom/client']);
const allowedReceiptResearchHosts = new Set([
  'cheatsheetseries.owasp.org',
  'csrc.nist.gov',
  'docs.aws.amazon.com',
  'nodejs.org',
  'opentelemetry.io',
  'react.dev',
  'www.typescriptlang.org',
  'www.w3.org',
]);
const resolvableExtensions = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.css'];
const executableExtensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
const forbiddenBrowserCapabilityNames = new Set([
  'BroadcastChannel',
  'EventSource',
  'Function',
  'Image',
  'RTCPeerConnection',
  'ServiceWorker',
  'SharedWorker',
  'WebSocket',
  'WebSocketStream',
  'WebTransport',
  'Worker',
  'XMLHttpRequest',
  'crypto',
  'eval',
  'fetch',
  'globalThis',
  'history',
  'importScripts',
  'indexedDB',
  'localStorage',
  'location',
  'module',
  'navigation',
  'navigator',
  'open',
  'parent',
  'performance',
  'process',
  'require',
  'self',
  'sessionStorage',
  'setInterval',
  'setTimeout',
  'top',
  'window',
]);
const forbiddenIntrinsicResourceTags = new Set([
  'a',
  'audio',
  'base',
  'embed',
  'iframe',
  'img',
  'link',
  'object',
  'script',
  'source',
  'style',
  'track',
  'video',
]);
const forbiddenIntrinsicResourceAttributes = new Set([
  'action',
  'cite',
  'data',
  'formaction',
  'href',
  'manifest',
  'ping',
  'poster',
  'src',
  'srcset',
]);

function inside(path, root) {
  return path === root || path.startsWith(`${root}/`);
}

function walk(root) {
  const output = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = resolve(root, entry.name);
    const metadata = lstatSync(path);
    assert.equal(metadata.isSymbolicLink(), false, `symlink forbidden in A4 scope: ${path}`);
    if (entry.isDirectory()) output.push(...walk(path));
    else output.push(path);
  }
  return output.sort();
}

function sourceFiles() {
  return walk(sourceRoot).filter((path) => executableExtensions.has(extname(path)));
}

function syntaxTree(path) {
  const source = readFileSync(path, 'utf8');
  const extension = extname(path);
  const scriptKind = extension === '.tsx'
    ? ts.ScriptKind.TSX
    : extension === '.jsx'
      ? ts.ScriptKind.JSX
      : ['.js', '.mjs', '.cjs'].includes(extension)
        ? ts.ScriptKind.JS
        : ts.ScriptKind.TS;
  return ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, scriptKind);
}

function networkLedger() {
  const ledger = globalThis[networkAttemptsKey];
  assert.ok(Array.isArray(ledger), 'A4 total-network preload ledger missing in source-boundary process');
  assert.equal(ledger.preloadInstalled, true);
  assert.equal(ledger.version, 1);
  return ledger;
}

function jsxTagName(node) {
  return ts.isIdentifier(node) ? node.text : node.getText();
}

function jsxAttributes(node) {
  const attributes = new Map();
  for (const property of node.attributes.properties) {
    assert.ok(ts.isJsxAttribute(property), `JSX spread attribute forbidden in ${relative(repoRoot, node.getSourceFile().fileName)}`);
    attributes.set(property.name.text.toLowerCase(), property);
  }
  return attributes;
}

function assertLocalOwnerChatForm(path, node, attributes) {
  assert.equal(path, ownerChatEntry, `form outside the reviewed local owner composer: ${relative(repoRoot, path)}`);
  for (const name of ['action', 'method', 'target', 'enctype']) {
    assert.equal(attributes.has(name), false, `owner chat form must omit ${name}`);
  }

  const onSubmit = attributes.get('onsubmit');
  assert.ok(onSubmit?.initializer && ts.isJsxExpression(onSubmit.initializer), 'owner chat form needs an inline submit denial');
  const handler = onSubmit.initializer.expression;
  assert.ok(handler && ts.isArrowFunction(handler), 'owner chat submit denial must be an arrow function');
  assert.equal(handler.parameters.length, 1, 'owner chat submit denial arity');
  assert.ok(ts.isIdentifier(handler.parameters[0].name), 'owner chat submit event must be a named parameter');
  assert.ok(ts.isCallExpression(handler.body), 'owner chat submit denial must directly call preventDefault');
  assert.equal(handler.body.arguments.length, 0, 'preventDefault takes no arguments');
  assert.ok(ts.isPropertyAccessExpression(handler.body.expression), 'owner chat submit denial call shape');
  assert.equal(handler.body.expression.name.text, 'preventDefault');
  assert.ok(ts.isIdentifier(handler.body.expression.expression));
  assert.equal(handler.body.expression.expression.text, handler.parameters[0].name.text);
}

function isNonReferenceIdentifier(node) {
  const parent = node.parent;
  return ts.isPropertyAccessExpression(parent) && parent.name === node
    || ts.isPropertyAssignment(parent) && parent.name === node
    || ts.isPropertyDeclaration(parent) && parent.name === node
    || ts.isPropertySignature(parent) && parent.name === node
    || ts.isMethodDeclaration(parent) && parent.name === node
    || ts.isMethodSignature(parent) && parent.name === node
    || ts.isGetAccessorDeclaration(parent) && parent.name === node
    || ts.isSetAccessorDeclaration(parent) && parent.name === node
    || ts.isBindingElement(parent) && parent.propertyName === node
    || ts.isJsxAttribute(parent) && parent.name === node;
}

function assertReviewedDocumentMount(path, node) {
  assert.equal(path, buildOnlyPreviewEntry, `document reference outside build-only preview: ${relative(repoRoot, path)}`);
  const access = node.parent;
  assert.ok(ts.isPropertyAccessExpression(access) && access.expression === node, 'preview document reference must be direct');
  assert.equal(access.name.text, 'getElementById');
  const call = access.parent;
  assert.ok(ts.isCallExpression(call) && call.expression === access, 'preview document reference must only resolve the mount');
  assert.equal(call.arguments.length, 1);
  assert.ok(ts.isStringLiteral(call.arguments[0]));
  assert.equal(call.arguments[0].text, 'root');
}

function moduleSpecifierText(node, context) {
  assert.ok(ts.isStringLiteralLike(node), `${context} must use a string-literal module specifier`);
  return node.text;
}

function collectModuleReferences(path) {
  const source = readFileSync(path, 'utf8');
  const extension = extname(path);
  const scriptKind = extension === '.tsx'
    ? ts.ScriptKind.TSX
    : extension === '.jsx'
      ? ts.ScriptKind.JSX
      : ['.js', '.mjs', '.cjs'].includes(extension)
        ? ts.ScriptKind.JS
        : ts.ScriptKind.TS;
  const syntax = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, scriptKind);
  const references = [];
  const add = (node, kind) => references.push({
    kind,
    specifier: moduleSpecifierText(node, `${relative(repoRoot, path)} ${kind}`),
  });

  function visit(node) {
    if (ts.isImportDeclaration(node)) {
      add(node.moduleSpecifier, node.importClause ? 'static import' : 'side-effect import');
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
      add(node.moduleSpecifier, 're-export');
    } else if (
      ts.isImportEqualsDeclaration(node)
      && ts.isExternalModuleReference(node.moduleReference)
      && node.moduleReference.expression
    ) {
      add(node.moduleReference.expression, 'import-equals');
    } else if (ts.isImportTypeNode(node)) {
      assert.ok(ts.isLiteralTypeNode(node.argument), `${relative(repoRoot, path)} import type must be literal`);
      add(node.argument.literal, 'import type');
    } else if (ts.isCallExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        assert.equal(node.arguments.length, 1, `${relative(repoRoot, path)} dynamic import arity`);
        add(node.arguments[0], 'dynamic import');
      } else {
        const directRequire = ts.isIdentifier(node.expression) && node.expression.text === 'require';
        const propertyRequire = ts.isPropertyAccessExpression(node.expression)
          && (
            node.expression.name.text === 'require'
            || ts.isIdentifier(node.expression.expression)
              && node.expression.expression.text === 'require'
              && node.expression.name.text === 'resolve'
          );
        if (directRequire || propertyRequire) {
          assert.equal(node.arguments.length, 1, `${relative(repoRoot, path)} require arity`);
          add(node.arguments[0], propertyRequire ? 'property require' : 'require');
        }
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(syntax);
  return references;
}

function resolveLocalModule(importer, specifier) {
  assert.equal(isAbsolute(specifier), false, `${relative(repoRoot, importer)} uses absolute import ${specifier}`);
  assert.doesNotMatch(specifier, /[?#]/u, `${relative(repoRoot, importer)} import has query or fragment: ${specifier}`);
  assert.ok(specifier.startsWith('.'), `${relative(repoRoot, importer)} has non-relative local import ${specifier}`);

  const base = resolve(dirname(importer), specifier);
  const candidates = extname(base)
    ? [base]
    : [
        base,
        ...resolvableExtensions.map((extension) => `${base}${extension}`),
        ...resolvableExtensions.map((extension) => resolve(base, `index${extension}`)),
      ];
  const matches = [...new Set(candidates
    .filter((candidate) => existsSync(candidate) && statSync(candidate).isFile())
    .map((candidate) => realpathSync(candidate)))];

  assert.equal(matches.length, 1, `${relative(repoRoot, importer)} cannot resolve unambiguously: ${specifier}`);
  return matches[0];
}

test('all A4 artifact paths resolve inside the four ratified prefixes with no symlinks', () => {
  for (const root of allowedRoots) {
    assert.ok(inside(realpathSync(root), repoRoot));
    for (const path of walk(root)) {
      const resolved = realpathSync(path);
      assert.ok(allowedRoots.some((allowed) => inside(resolved, allowed)), relative(repoRoot, resolved));
    }
  }
});

test('the total-network preload is present and this test process has no denied attempt', () => {
  assert.deepEqual([...networkLedger()], []);
});

test('caught denials remain process-fatal and redact URL userinfo, path, and query details', () => {
  const probe = `
    const key = Symbol.for('aiops.a4.total-network-attempts.v1');
    try {
      await fetch('https://owner:credential@fixture-provider.invalid/private/case?token=secret');
    } catch (error) {
      if (error?.code !== 'ERR_AIOPS_A4_NETWORK_DENIED') throw error;
    }
    try {
      const net = await import('node:net');
      net.createConnection('/tmp/aiops-a4-unreviewed.sock');
    } catch (error) {
      if (error?.code !== 'ERR_AIOPS_A4_NETWORK_DENIED') throw error;
    }
    process.stdout.write(JSON.stringify(globalThis[key]));
  `;
  const result = spawnSync(process.execPath, [
    '--import', totalNetworkPreload,
    '--input-type=module',
    '--eval', probe,
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: { PATH: process.env.PATH },
  });

  assert.equal(result.signal, null);
  assert.equal(result.status, 1, `caught denial process must fail: ${result.stderr}`);
  assert.equal(result.stderr, '');
  assert.deepEqual(JSON.parse(result.stdout), [
    { kind: 'fetch', target: 'https://fixture-provider.invalid' },
    { kind: 'net.createConnection', target: 'local-path' },
  ]);
  assert.doesNotMatch(result.stdout, /owner|credential|private|case|token|secret|unreviewed\.sock/iu);
  assert.deepEqual([...networkLedger()], []);
});

test('browser source contains no network, timer, persistence, ambient entropy, environment, or live endpoint invocation', () => {
  const forbidden = [
    [/\bfetch\s*\(/u, 'fetch invocation'],
    [/\bnew\s+WebSocket\b|\bWebSocket\s*\(/u, 'WebSocket invocation'],
    [/\bnew\s+EventSource\b|\bEventSource\s*\(/u, 'EventSource invocation'],
    [/\bXMLHttpRequest\b/u, 'XMLHttpRequest'],
    [/\bnavigator\.sendBeacon\s*\(/u, 'sendBeacon invocation'],
    [/\baxios\b/u, 'axios'],
    [/\b(?:localStorage|sessionStorage|indexedDB)\b/u, 'browser persistence'],
    [/\b(?:setInterval|setTimeout)\s*\(/u, 'timer'],
    [/\bMath\.random\s*\(/u, 'ambient randomness'],
    [/\b(?:crypto\.)?(?:randomUUID|getRandomValues)\s*\(/u, 'ambient cryptographic randomness'],
    [/\bDate\.now\s*\(|\bnew\s+Date\s*\(/u, 'ambient clock'],
    [/\bprocess\.env\b|\bimport\.meta\.env\b/u, 'environment read'],
    [/\b(?:node:fs|node:http2?|node:https|node:net|node:tls|node:dns(?:\/promises)?|node:dgram|child_process)\b/u, 'Node I/O import'],
    [/\bnew\s+(?:Worker|SharedWorker|Image)\s*\(/u, 'DOM resource constructor'],
    [/\b(?:window\.)?open\s*\(|\b(?:window\.|document\.)?location(?:\.href)?\s*=|\blocation\.(?:assign|replace)\s*\(/u, 'navigation invocation'],
    [/\.(?:submit|requestSubmit)\s*\(/u, 'form submission invocation'],
  ];
  for (const path of sourceFiles()) {
    const source = readFileSync(path, 'utf8');
    for (const [pattern, label] of forbidden) {
      assert.doesNotMatch(source, pattern, `${label}: ${relative(repoRoot, path)}`);
    }
    if (source.includes('POST /api/refresh')) {
      assert.doesNotMatch(source, /fetch\s*\([^)]*api\/refresh|axios[^\n]*api\/refresh/u, `refresh call: ${relative(repoRoot, path)}`);
    }
  }
});

test('browser AST contains no aliased capability or JSX egress channel beyond the reviewed local form', () => {
  let reviewedFormCount = 0;
  let reviewedDocumentMountCount = 0;

  for (const path of sourceFiles()) {
    const syntax = syntaxTree(path);

    function visit(node) {
      if (ts.isIdentifier(node) && !isNonReferenceIdentifier(node)) {
        if (node.text === 'document') {
          assertReviewedDocumentMount(path, node);
          reviewedDocumentMountCount += 1;
        } else {
          assert.equal(
            forbiddenBrowserCapabilityNames.has(node.text),
            false,
            `browser capability reference ${node.text}: ${relative(repoRoot, path)}`,
          );
        }
      }

      if (
        ts.isElementAccessExpression(node)
        && node.argumentExpression
        && ts.isStringLiteralLike(node.argumentExpression)
      ) {
        assert.equal(
          forbiddenBrowserCapabilityNames.has(node.argumentExpression.text),
          false,
          `computed browser capability ${node.argumentExpression.text}: ${relative(repoRoot, path)}`,
        );
      }

      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        const tag = jsxTagName(node.tagName);
        if (tag === tag.toLowerCase()) {
          assert.equal(
            forbiddenIntrinsicResourceTags.has(tag),
            false,
            `resource-bearing JSX element <${tag}>: ${relative(repoRoot, path)}`,
          );
          const attributes = jsxAttributes(node);
          for (const attribute of forbiddenIntrinsicResourceAttributes) {
            assert.equal(
              attributes.has(attribute),
              false,
              `JSX ${attribute} channel on <${tag}>: ${relative(repoRoot, path)}`,
            );
          }
          if (tag === 'form') {
            assertLocalOwnerChatForm(path, node, attributes);
            reviewedFormCount += 1;
          }
        }
      }

      ts.forEachChild(node, visit);
    }

    visit(syntax);
  }

  assert.equal(reviewedFormCount, 1, 'exactly one reviewed local-only owner form is expected');
  assert.equal(reviewedDocumentMountCount, 1, 'exactly one reviewed preview document mount is expected');
  assert.deepEqual([...networkLedger()], []);
});

test('every static, side-effect, dynamic, re-export, and require reference resolves only to the exact A4 allowlist', () => {
  for (const path of sourceFiles()) {
    for (const { kind, specifier } of collectModuleReferences(path)) {
      if (!specifier.startsWith('.')) {
        assert.ok(
          allowedExternalDependencies.has(specifier),
          `${relative(repoRoot, path)} ${kind} uses external dependency ${specifier}`,
        );
        continue;
      }

      const resolvedImport = resolveLocalModule(path, specifier);
      assert.ok(
        inside(resolvedImport, sourceRoot)
          || resolvedImport === sharedUiOwner
          || resolvedImport === sharedStylesOwner,
        `${relative(repoRoot, path)} ${kind} resolves outside A4 owners: ${relative(repoRoot, resolvedImport)}`,
      );
    }
  }
});

test('lane source, fixture JSON, and all A4 receipts contain no secret, live host, provider SDK, signed call, or money-path invocation', () => {
  // Test files are intentionally excluded so the proof regex literals cannot match themselves.
  const artifacts = [
    ...walk(sourceRoot).filter((path) => ['.ts', '.tsx', '.css', '.html'].includes(extname(path))),
    ...walk(fixtureRoot).filter((path) => extname(path) === '.json'),
    ...walk(receiptRoot).filter((path) => extname(path) === '.md'),
  ];
  const forbidden = [
    [/\b(?:sk-[A-Za-z0-9_-]{12,}|AKIA[0-9A-Z]{16}|ASIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]{10,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk_live_[A-Za-z0-9]{12,})\b/u, 'secret-shaped token'],
    [/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u, 'private key'],
    [/\bBearer\s+[A-Za-z0-9._~+\/-]{16,}=*\b/iu, 'bearer credential'],
    [/\b(?:api[_-]?key|client[_-]?secret|password)\b\s*[:=]\s*['"`][^'"`\n]{8,}/iu, 'credential assignment'],
    [/\b(?:api\.openai\.com|api\.anthropic\.com|generativelanguage\.googleapis\.com|api\.(?:groq|xai|cohere)\.com|openrouter\.ai\/api|(?:api|stream|ws-api|fapi|dapi)\.binance\.(?:com|us))\b/iu, 'real provider or exchange host'],
    [/\bfrom\s+['"](?:openai|@anthropic-ai|@google\/generative-ai|@google\/genai|cohere-ai|groq-sdk|@xai-org\/xai-ts|binance)['"]/u, 'provider SDK import'],
    [/\b(?:signedRequest|privateRequest|authenticatedRequest)\s*\(/u, 'signed or private request call'],
    [/\b(?:withdraw|withdrawAll|transfer|borrow|repay|createOrder|submitOrder|placeOrder|cancelOrder|cancelAllOrders|setLeverage|changeInitialLeverage|setMarginType|changeMarginType)\s*\(/u, 'money-path call'],
    [/\b(?:POST|PUT|PATCH|DELETE)\s+\/[^\s'"`]*(?:order|withdraw|transfer|borrow|repay|leverage|margin)\b/iu, 'money-path endpoint'],
    [/\/(?:api|sapi|fapi|dapi)\/v\d+\/(?:order|openOrders|allOrders|capital\/withdraw|margin\/(?:loan|repay|transfer)|futures\/transfer)\b/iu, 'exchange money endpoint'],
  ];

  for (const path of artifacts) {
    const source = readFileSync(path, 'utf8');
    for (const [pattern, label] of forbidden) {
      assert.doesNotMatch(source, pattern, `${label}: ${relative(repoRoot, path)}`);
    }
    for (const match of source.matchAll(/\b(?:https?|wss?):\/\/[^\s'"`<>]+/giu)) {
      const url = new URL(match[0].replace(/[),.;]+$/u, ''));
      const allowedResearchCitation = extname(path) === '.md' && allowedReceiptResearchHosts.has(url.hostname);
      assert.ok(url.hostname.endsWith('.invalid') || allowedResearchCitation, `live URL: ${relative(repoRoot, path)} -> ${url.hostname}`);
    }
  }

  const source = artifacts.map((path) => readFileSync(path, 'utf8')).join('\n');
  assert.match(source, /fixture-provider\.invalid/u);
});

test('HTML and CSS expose no unreviewed resource, form, worker, or navigation channel', () => {
  const htmlFiles = walk(sourceRoot).filter((path) => extname(path) === '.html');
  const cssFiles = walk(sourceRoot).filter((path) => extname(path) === '.css');
  for (const path of htmlFiles) {
    const source = readFileSync(path, 'utf8');
    assert.doesNotMatch(source, /<\s*(?:a|audio|base|embed|form|iframe|img|link|object|source|style|track|video)\b/iu, `resource-bearing element: ${relative(repoRoot, path)}`);
    assert.doesNotMatch(source, /<meta\b[^>]*http-equiv\s*=\s*['"]?refresh/iu, `meta refresh: ${relative(repoRoot, path)}`);
    assert.doesNotMatch(source, /\son[a-z]+\s*=/iu, `inline HTML event channel: ${relative(repoRoot, path)}`);
    assert.doesNotMatch(source, /\b(?:src|href|action|formaction|data)\s*=\s*(?!['"])/iu, `unquoted HTML resource: ${relative(repoRoot, path)}`);
    for (const match of source.matchAll(/\b(?:src|href|action|formaction|data)\s*=\s*['"]([^'"]+)['"]/giu)) {
      assert.doesNotMatch(match[1], /^(?:[a-z]+:|\/\/|\/)/iu, `absolute HTML resource: ${relative(repoRoot, path)} -> ${match[1]}`);
      const resource = realpathSync(resolve(dirname(path), match[1]));
      assert.equal(resource, buildOnlyPreviewEntry, `unreviewed HTML resource: ${relative(repoRoot, path)} -> ${match[1]}`);
    }

    const scripts = [...source.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/giu)];
    assert.equal(scripts.length, 1, `preview HTML must contain one reviewed module script: ${relative(repoRoot, path)}`);
    assert.match(scripts[0][1], /\btype\s*=\s*['"]module['"]/iu);
    assert.match(scripts[0][1], /\bsrc\s*=\s*['"]\.\/main\.tsx['"]/iu);
    assert.equal(scripts[0][2].trim(), '', `inline script body forbidden: ${relative(repoRoot, path)}`);
  }

  for (const path of cssFiles) {
    const source = readFileSync(path, 'utf8');
    assert.doesNotMatch(source, /@font-face\b|@import\b|image-set\s*\(|src\s*\(|url\s*\(/iu, `CSS resource channel: ${relative(repoRoot, path)}`);
  }
});

test('the UI exposes no bulk-enable, diagnostic resume, or duplicate refresh control', () => {
  const source = sourceFiles().map((path) => readFileSync(path, 'utf8')).join('\n');
  const fixtureSource = readFileSync(resolve(sourceRoot, 'fixture.ts'), 'utf8');
  assert.doesNotMatch(source, /enable all/iu);
  assert.doesNotMatch(source, /resume diagnostic|release diagnostic|disable diagnostic kill/iu);
  assert.equal((fixtureSource.match(/endpoint:\s*'POST \/api\/refresh'/gu) ?? []).length, 1);
  assert.match(source, /Bulk Disable · NOT_WIRED/u);
});

test.after(() => {
  assert.deepEqual([...networkLedger()], [], 'source-boundary process accumulated a denied network attempt');
});
