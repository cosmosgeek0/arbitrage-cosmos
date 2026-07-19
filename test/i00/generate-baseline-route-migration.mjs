#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  assertExactConsumerScan,
  scanProductionConsumers,
} from './baseline-route-consumers.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const ARTIFACT_PATH = resolve(ROOT, 'fixtures/i00/baseline-route-migration.json');
const SCHEMA_VERSION = 'i00.baseline-route-migration.v1';

function assertGeneratorInput(artifact) {
  if (artifact === null || typeof artifact !== 'object' || Array.isArray(artifact)
      || artifact.schemaVersion !== SCHEMA_VERSION || !Array.isArray(artifact.routes)
      || artifact.routes.length === 0) {
    throw new Error('BASELINE_ROUTE_MIGRATION_GENERATOR_INPUT_INVALID');
  }
  assertExactConsumerScan(artifact.consumerScan);
  const routes = new Set();
  for (const row of artifact.routes) {
    if (row === null || typeof row !== 'object' || Array.isArray(row)
        || typeof row.route !== 'string' || !row.route.startsWith('/api/')
        || !Array.isArray(row.productionConsumers) || routes.has(row.route)) {
      throw new Error('BASELINE_ROUTE_MIGRATION_GENERATOR_ROUTE_INVALID');
    }
    routes.add(row.route);
  }
}

export function generateBaselineRouteMigration(artifact, root = ROOT) {
  assertGeneratorInput(artifact);
  return {
    ...artifact,
    routes: artifact.routes.map((row) => ({
      ...row,
      productionConsumers: scanProductionConsumers(root, artifact.consumerScan, row.route),
    })),
  };
}

export function renderBaselineRouteMigration(artifact) {
  return `${JSON.stringify(artifact, null, 2)}\n`;
}

function readArtifact() {
  return JSON.parse(readFileSync(ARTIFACT_PATH, 'utf8'));
}

function summary(artifact) {
  return Object.freeze({
    schemaVersion: artifact.schemaVersion,
    routes: artifact.routes.length,
    consumerRows: artifact.routes.reduce((total, row) => total + row.productionConsumers.length, 0),
  });
}

function main() {
  const args = process.argv.slice(2);
  if (args.length !== 1 || !['--check', '--write'].includes(args[0])) {
    throw new Error('BASELINE_ROUTE_MIGRATION_GENERATOR_ARGUMENT_INVALID');
  }
  const generated = generateBaselineRouteMigration(readArtifact());
  const rendered = renderBaselineRouteMigration(generated);
  if (args[0] === '--write') {
    writeFileSync(ARTIFACT_PATH, rendered, 'utf8');
    process.stdout.write(`BASELINE_ROUTE_MIGRATION_WRITTEN ${JSON.stringify(summary(generated))}\n`);
    return;
  }
  if (readFileSync(ARTIFACT_PATH, 'utf8') !== rendered) {
    throw new Error('BASELINE_ROUTE_MIGRATION_GENERATED_ARTIFACT_STALE');
  }
  process.stdout.write(`BASELINE_ROUTE_MIGRATION_VERIFIED ${JSON.stringify(summary(generated))}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
