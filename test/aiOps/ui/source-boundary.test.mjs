import assert from 'node:assert/strict';
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { dirname, extname, isAbsolute, relative, resolve } from 'node:path';
import test from 'node:test';
import ts from 'typescript';

const repoRoot = realpathSync(new URL('../../../', import.meta.url));
const sourceRoot = resolve(repoRoot, 'web/src/aiOps');
const fixtureRoot = resolve(repoRoot, 'fixtures/aiOps/ui');
const testRoot = resolve(repoRoot, 'test/aiOps/ui');
const sharedUiOwner = realpathSync(resolve(repoRoot, 'web/src/components/ui.tsx'));
const sharedStylesOwner = realpathSync(resolve(repoRoot, 'web/src/styles.css'));
const buildOnlyPreviewEntry = realpathSync(resolve(sourceRoot, 'preview/main.tsx'));
const allowedRoots = [sourceRoot, fixtureRoot, testRoot];
const allowedExternalDependencies = new Set(['lucide-react', 'react', 'react-dom/client']);
const resolvableExtensions = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.css'];
const executableExtensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);

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

test('all A4 artifact paths resolve inside the three exclusive prefixes with no symlinks', () => {
  for (const root of allowedRoots) {
    assert.ok(inside(realpathSync(root), repoRoot));
    for (const path of walk(root)) {
      const resolved = realpathSync(path);
      assert.ok(allowedRoots.some((allowed) => inside(resolved, allowed)), relative(repoRoot, resolved));
    }
  }
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

test('lane source and JSON fixtures contain no secret, live host, provider SDK, signed call, or money-path invocation', () => {
  // Test files are intentionally excluded so the proof regex literals cannot match themselves.
  const artifacts = [
    ...walk(sourceRoot).filter((path) => ['.ts', '.tsx', '.css', '.html'].includes(extname(path))),
    ...walk(fixtureRoot).filter((path) => extname(path) === '.json'),
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
      assert.ok(url.hostname.endsWith('.invalid'), `live URL: ${relative(repoRoot, path)} -> ${url.hostname}`);
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
    assert.doesNotMatch(source, /<\s*(?:form|iframe|img|object|embed|video|audio|source)\b/iu, `resource-bearing element: ${relative(repoRoot, path)}`);
    assert.doesNotMatch(source, /<meta\b[^>]*http-equiv\s*=\s*['"]?refresh/iu, `meta refresh: ${relative(repoRoot, path)}`);
    for (const match of source.matchAll(/\b(?:src|href|action|formaction|data)\s*=\s*['"]([^'"]+)['"]/giu)) {
      assert.doesNotMatch(match[1], /^(?:[a-z]+:|\/\/|\/)/iu, `absolute HTML resource: ${relative(repoRoot, path)} -> ${match[1]}`);
      const resource = realpathSync(resolve(dirname(path), match[1]));
      assert.equal(resource, buildOnlyPreviewEntry, `unreviewed HTML resource: ${relative(repoRoot, path)} -> ${match[1]}`);
    }
  }

  for (const path of cssFiles) {
    const source = readFileSync(path, 'utf8');
    assert.doesNotMatch(source, /@import\b|url\s*\(/iu, `CSS resource channel: ${relative(repoRoot, path)}`);
  }
});

test('the UI exposes no bulk-enable, diagnostic resume, or duplicate refresh control', () => {
  const source = sourceFiles().map((path) => readFileSync(path, 'utf8')).join('\n');
  const fixtureSource = readFileSync(resolve(sourceRoot, 'fixture.ts'), 'utf8');
  assert.doesNotMatch(source, /enable all/iu);
  assert.doesNotMatch(source, /resume diagnostic|release diagnostic|disable diagnostic kill/iu);
  assert.equal((fixtureSource.match(/endpoint:\s*'POST \/api\/refresh'/gu) ?? []).length, 1);
  assert.match(source, /Bulk disable · NOT_WIRED/u);
});
