import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export const ALLOWED_ROOT_FILES = new Set([
  'IP_PROOF_STATE.md',
  'IP_PROOF_RECEIPT.md',
  'MISSION_COVERAGE_MATRIX.md',
  'AUTONOMY_CLOSURE_REPORT.md',
  'NO_TERMINAL_DEPENDENCY_REPORT.md',
  'RESOURCE_AND_BACKPRESSURE_REPORT.md',
  'OFFICIAL_INTERFACE_MATRIX.md',
  'IP_PROOF_SHARED_INSERTION_REQUEST.md',
  'I00_PRODUCT_BUILD_STATE.md',
  'I00_VERIFY_RECEIPT.md',
  'I00_CLOSURE_PRESTAGE_RECEIPT.md',
]);

export const ALLOWED_PREFIXES = Object.freeze([
  'server/test/i00Acceptance/',
  'test/i00/',
  'fixtures/i00/',
  'integration/reports/',
]);

export function isAllowedChangePath(value) {
  const normalized = value.replaceAll('\\', '/').replace(/^\.\//, '');
  if (normalized.startsWith('../') || normalized.includes('/../') || path.isAbsolute(normalized)) return false;
  return ALLOWED_ROOT_FILES.has(normalized) || ALLOWED_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

const EXECUTABLE_RULES = Object.freeze([
  ['PRIVATE_OWNER_IMPORT', /(?:from\s*|require\s*\(|import\s*\()[^\n]*(?:binance\/(?:client|userStream)|services\/(?:orders|loans|account|userStream)|foundation\/exchange\/binanceUsdM)/],
  ['NODE_NETWORK_IMPORT', /(?:from\s*|require\s*\()[^\n]*(?:(?:node:)?(?:http|http2|https|net|tls|dgram)|undici|ws)(?:['\")/]|$)/],
  ['CHILD_PROCESS', /(?:node:)?child_process|\b(?:spawn|exec|fork)Sync?\s*\(/],
  ['EGRESS_PRIMITIVE', /\bfetch\s*\(|globalThis\s*\[\s*['"]fetch['"]\s*\]|\bnew\s+(?:globalThis\.)?\w*Socket\s*\(|\bEventSource\s*\(/],
  ['DYNAMIC_CODE', /\beval\s*\(|\bnew\s+Function\s*\(|\bFunction\s*\(/],
  ['NONLITERAL_DYNAMIC_IMPORT', /\bimport\s*\(\s*[^'"\s]/],
  ['ENVIRONMENT_READ', /\bprocess\.env\b/],
  ['TIMER_OR_RANDOM', /\b(?:setTimeout|setInterval|Math\.random)\s*\(/],
  ['DUPLICATE_AUTHORITY_DECLARATION', /\b(?:class|function)\s+(?:NewRiskGate|SecondLedger|MarketScanner|DuplicateControlPlane|ShadowProposalStore)\b/],
  ['LIVE_FIXTURE_GRANT', /(?:truthLabel|capability|executionAuthority)\s*:\s*['"](?:LIVE|LIVE_PRIVATE|LIVE_SIGNED|EXECUTION_LIVE)['"]/],
  ['PRIVATE_ENDPOINT_LITERAL', /['"](?:https:\/\/api\.binance\.com)?\/(?:api\/v3\/order|fapi\/v1\/order|sapi\/v1\/margin\/borrow-repay)['"]/],
]);

export function scanExecutableSnippet(source) {
  const findings = [];
  for (const [code, pattern] of EXECUTABLE_RULES) if (pattern.test(source)) findings.push(code);
  return findings.sort();
}

const SECRET_PATTERNS = Object.freeze([
  ['PRIVATE_KEY_MATERIAL', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ['AWS_ACCESS_KEY', /\bAKIA[0-9A-Z]{16}\b/],
  ['AWS_SESSION_KEY', /\bASIA[0-9A-Z]{16}\b/],
  ['GITHUB_TOKEN', /\bgh[pousr]_[A-Za-z0-9]{30,}\b/],
  ['JWT_VALUE', /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/],
  ['BEARER_TOKEN', /\bBearer\s+[A-Za-z0-9._~+\/-]{20,}\b/],
  ['SECRET_ASSIGNMENT', /\b(?:api[_-]?secret|password|private[_-]?key)\s*[:=]\s*['"](?!synthetic-forbidden-sentinel|PENDING_|NOT_)[^'"]{8,}['"]/i],
]);

export function scanSecretText(source) {
  const findings = [];
  const lines = source.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    for (const [code, pattern] of SECRET_PATTERNS) {
      pattern.lastIndex = 0;
      if (pattern.test(lines[index])) findings.push({ code, line: index + 1 });
    }
  }
  return findings;
}

function filesUnder(relativePath) {
  const absolute = path.join(ROOT, relativePath);
  const info = statSync(absolute, { throwIfNoEntry: false });
  if (!info) return [];
  if (info.isFile()) return [relativePath];
  const files = [];
  for (const entry of readdirSync(absolute, { withFileTypes: true })) {
    const child = path.posix.join(relativePath, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`SYMLINK_FORBIDDEN:${child}`);
    if (entry.isDirectory()) files.push(...filesUnder(child));
    else if (entry.isFile()) files.push(child);
  }
  return files.sort();
}

export function scanOwnedFiles() {
  const executableFindings = [];
  const secretFindings = [];
  const roots = [
    'server/test/i00Acceptance', 'test/i00', 'fixtures/i00', 'integration/reports',
    ...[...ALLOWED_ROOT_FILES].filter((file) => statSync(path.join(ROOT, file), { throwIfNoEntry: false })),
  ];
  const mutationFixtures = new Set([
    'server/test/i00Acceptance/security-boundary.test.mjs',
    'test/i00/scope-security.mjs',
  ]);
  for (const file of roots.flatMap(filesUnder)) {
    const content = readFileSync(path.join(ROOT, file), 'utf8');
    if (/\.(?:js|mjs|cjs|ts|tsx)$/.test(file) && !mutationFixtures.has(file)) {
      for (const code of scanExecutableSnippet(content)) {
        if (file === 'test/i00/render-reports.mjs' && code === 'ENVIRONMENT_READ') continue;
        if ((file === 'test/i00/git-provenance.mjs' || file === 'test/i00/verify-scope.mjs') && code === 'CHILD_PROCESS') continue;
        executableFindings.push({ code, file });
      }
    }
    if (!mutationFixtures.has(file)) {
      for (const finding of scanSecretText(content)) secretFindings.push({ ...finding, file });
    }
  }
  return { executableFindings, secretFindings };
}
