#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';

const root = resolve(process.cwd(), 'verification/product-truth-20260716');
const manifest = resolve(root, 'MANIFEST.sha256');

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = resolve(directory, entry.name);
    if (entry.isDirectory()) return walk(absolute);
    if (!entry.isFile() || absolute === manifest) return [];
    return [absolute];
  });
}

const rows = walk(root)
  .sort((left, right) => relative(root, left).localeCompare(relative(root, right)))
  .map((absolute) => {
    const path = relative(root, absolute);
    const bytes = readFileSync(absolute);
    const digest = createHash('sha256').update(bytes).digest('hex');
    if (statSync(absolute).size !== bytes.length) throw new Error(`size drift: ${path}`);
    return `${digest}  ${path}`;
  });

writeFileSync(manifest, `${rows.join('\n')}\n`);
console.log(JSON.stringify({ manifest, entry_count: rows.length, self_excluded: true }));
