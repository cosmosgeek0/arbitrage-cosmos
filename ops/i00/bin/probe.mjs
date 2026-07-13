#!/usr/bin/env node
import { fail, isUtc, parseArgs, readJson, requireKeys } from '../lib.mjs';

const args = parseArgs(process.argv.slice(2), new Set(['simulation-clock']));
if (!args.input || !args.kind || !args['max-age-sec']) fail('--input, --kind, and --max-age-sec are required');
if (args['simulation-clock'] !== true && args.now) fail('--now is accepted only with --simulation-clock');
if (args['simulation-clock'] === true && !isUtc(args.now)) fail('simulation clock requires exact --now UTC seconds');
const allowed = new Set(['dependency', 'readiness', 'trade-readiness', 'recovery-readiness']);
if (!allowed.has(args.kind)) fail(`unsupported probe kind ${args.kind}`);
const snapshot = readJson(args.input, 'canonical supervisor snapshot');
requireKeys(snapshot, ['source', 'observedAtUtc', 'dependencies', 'readiness', 'tradeReadiness', 'recoveryReadiness'], 'canonical supervisor snapshot');
if (snapshot.source !== 'CANONICAL_SUPERVISOR_READBACK') fail('snapshot source is not canonical supervisor readback');
const effectiveNow = args['simulation-clock'] === true ? args.now : new Date().toISOString();
const nowMs = Date.parse(effectiveNow);
const observedMs = Date.parse(snapshot.observedAtUtc);
const maxAgeMs = Number(args['max-age-sec']) * 1000;
if (!isUtc(effectiveNow) || !isUtc(snapshot.observedAtUtc) || ![nowMs, observedMs, maxAgeMs].every(Number.isFinite)
    || maxAgeMs <= 0 || observedMs > nowMs || nowMs - observedMs > maxAgeMs) fail('snapshot is stale or future-dated');

let passed = false;
let blockers = [];
if (args.kind === 'dependency') {
  if (!Array.isArray(snapshot.dependencies)) fail('dependencies must be an array');
  if (snapshot.dependencies.length === 0) fail('dependencies must be non-empty');
  for (const entry of snapshot.dependencies) {
    requireKeys(entry, ['id', 'required', 'state'], 'dependency');
    if (typeof entry.required !== 'boolean' || typeof entry.id !== 'string' || typeof entry.state !== 'string') fail('dependency fields are malformed');
  }
  blockers = snapshot.dependencies
    .filter((entry) => entry.required === true && entry.state !== 'READY')
    .map((entry) => `${entry.id}:${entry.state}`);
  passed = blockers.length === 0;
} else {
  const field = args.kind === 'readiness'
    ? 'readiness'
    : args.kind === 'trade-readiness' ? 'tradeReadiness' : 'recoveryReadiness';
  const value = snapshot[field];
  requireKeys(value, ['state', 'blockers', 'observedAtUtc'], field);
  if (!Array.isArray(value.blockers)) fail(`${field}.blockers must be an array`);
  blockers = value.blockers;
  const valueObservedMs = Date.parse(value.observedAtUtc);
  if (!isUtc(value.observedAtUtc) || !Number.isFinite(valueObservedMs) || valueObservedMs > nowMs || nowMs - valueObservedMs > maxAgeMs) fail(`${field} readback is stale or future-dated`);
  passed = value.state === 'READY' && blockers.length === 0;
}

const result = { kind: args.kind, status: passed ? 'PASS' : 'BLOCKED', blockers };
process.stdout.write(`${JSON.stringify(result)}\n`);
process.exit(passed ? 0 : 2);
