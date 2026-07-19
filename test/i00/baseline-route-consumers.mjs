import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';

const EXACT_CONSUMER_SCAN = Object.freeze({
  mode: 'CONSERVATIVE_STATIC_ROUTE_LITERAL_REFERENCES',
  roots: Object.freeze(['server/src', 'web/src']),
  extensions: Object.freeze(['.cjs', '.js', '.mjs', '.ts', '.tsx']),
  registrationExclusion: 'EXPRESS_DECLARATION_LINE_ONLY',
});

const EXPRESS_DECLARATION = /\b(?:app|router)\.(?:all|delete|get|patch|post|put|use)\s*\(/;

function exactArray(actual, expected) {
  return Array.isArray(actual)
    && actual.length === expected.length
    && actual.every((value, index) => value === expected[index]);
}

export function assertExactConsumerScan(scan) {
  if (scan === null || typeof scan !== 'object' || Array.isArray(scan)
      || Object.keys(scan).sort().join(',') !== 'extensions,mode,registrationExclusion,roots'
      || scan.mode !== EXACT_CONSUMER_SCAN.mode
      || scan.registrationExclusion !== EXACT_CONSUMER_SCAN.registrationExclusion
      || !exactArray(scan.roots, EXACT_CONSUMER_SCAN.roots)
      || !exactArray(scan.extensions, EXACT_CONSUMER_SCAN.extensions)) {
    throw new Error('BASELINE_ROUTE_CONSUMER_SCAN_INVALID');
  }
}

function walk(rootPath, extensions) {
  if (!existsSync(rootPath)) return [];
  const rows = [];
  for (const name of readdirSync(rootPath).sort()) {
    const path = join(rootPath, name);
    const stat = statSync(path);
    if (stat.isDirectory()) rows.push(...walk(path, extensions));
    else if (extensions.has(extname(name))) rows.push(path);
  }
  return rows;
}

export function routeOccurrences(line, route) {
  const family = route.endsWith('/*');
  const literal = family ? route.slice(0, -2) : route;
  let count = 0;
  let cursor = 0;
  while (cursor < line.length) {
    const index = line.indexOf(literal, cursor);
    if (index === -1) break;
    const next = line[index + literal.length] ?? '';
    const boundary = family
      ? next === '' || next === '/' || next === '?' || /[\s'"`)}\],;]/.test(next)
      : next === '' || next === '?' || /[\s'"`)}\],;]/.test(next);
    if (boundary) count += 1;
    cursor = index + literal.length;
  }
  return count;
}

export function scanProductionConsumers(root, consumerScan, route) {
  assertExactConsumerScan(consumerScan);
  if (typeof root !== 'string' || root.length === 0
      || typeof route !== 'string' || !route.startsWith('/api/')) {
    throw new Error('BASELINE_ROUTE_CONSUMER_SCAN_INPUT_INVALID');
  }
  const extensions = new Set(consumerScan.extensions);
  const counts = new Map();
  for (const scanRoot of consumerScan.roots) {
    for (const path of walk(resolve(root, scanRoot), extensions)) {
      const source = readFileSync(path, 'utf8');
      let count = 0;
      for (const line of source.split(/\r?\n/)) {
        if (EXPRESS_DECLARATION.test(line)) continue;
        count += routeOccurrences(line, route);
      }
      if (count > 0) counts.set(relative(root, path), count);
    }
  }
  return [...counts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([path, occurrences]) => ({ path, occurrences }));
}
