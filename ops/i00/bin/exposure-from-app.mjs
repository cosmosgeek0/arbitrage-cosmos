#!/usr/bin/env node
import { request } from 'node:http';

const DEFAULT_URL = 'http://127.0.0.1:8080/api/system-integration/ops/readback';
const READBACK_PATH = '/api/system-integration/ops/readback';
const MAX_BODY_BYTES = 8 * 1_024;
const MAX_OBSERVATION_AGE_MS = 30_000;
const MIN_LEASE_MS = 5 * 60_000;
const MAX_LEASE_MS = 60 * 60_000;
const EXPOSURE_STATES = new Set(['NONE', 'ACTIVE', 'AMBIGUOUS', 'RECOVERY_REQUIRED', 'UNKNOWN']);
const AMBIGUITY_STATES = new Set(['NONE', 'AMBIGUOUS', 'UNKNOWN']);
const RECOVERY_STATES = new Set(['NONE', 'RECOVERY_REQUIRED', 'UNKNOWN']);
const READBACK_KEYS = [
  'source', 'observedAtUtc', 'validUntilUtc', 'deploymentFrozen', 'exposureState',
  'ambiguityState', 'recoveryState', 'currentSchemaVersion', 'rollbackFloor',
].sort();

function unknown() {
  process.stdout.write('UNKNOWN\n');
}

function exactEndpoint(raw) {
  const parsed = new URL(raw);
  if (parsed.protocol !== 'http:'
      || !['127.0.0.1', '[::1]'].includes(parsed.hostname)
      || !parsed.port
      || parsed.username || parsed.password
      || parsed.pathname !== READBACK_PATH || parsed.search || parsed.hash
      || parsed.href !== raw) {
    throw new Error('readback URL is not the exact numeric-loopback endpoint');
  }
  return parsed;
}

function timeoutMs() {
  const raw = process.env.I00_OPS_READBACK_TIMEOUT_MS ?? '750';
  if (!/^[1-9][0-9]{1,3}$/.test(raw)) throw new Error('timeout is invalid');
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 25 || value > 2_000) throw new Error('timeout is out of bounds');
  return value;
}

function canonicalUtc(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value)) return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== `${value.slice(0, -1)}.000Z`) return null;
  return parsed;
}

function readBody(endpoint, timeout) {
  return new Promise((resolveBody, rejectBody) => {
    const req = request(endpoint, {
      method: 'GET',
      headers: {
        accept: 'application/json',
        'user-agent': 'cosmos-i00-exposure-readback/1',
      },
    }, (res) => {
      if (res.statusCode !== 200
          || !/^application\/json(?:;\s*charset=utf-8)?$/i.test(String(res.headers['content-type'] ?? ''))) {
        res.resume();
        rejectBody(new Error('readback response status or type is invalid'));
        return;
      }
      const contentLength = Number(res.headers['content-length']);
      if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
        res.resume();
        rejectBody(new Error('readback response exceeds its byte bound'));
        return;
      }
      const chunks = [];
      let bytes = 0;
      res.on('data', (chunk) => {
        bytes += chunk.byteLength;
        if (bytes > MAX_BODY_BYTES) {
          req.destroy(new Error('readback response exceeds its byte bound'));
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', () => resolveBody(Buffer.concat(chunks).toString('utf8')));
      res.on('aborted', () => rejectBody(new Error('readback response aborted')));
      res.on('error', rejectBody);
    });
    req.setTimeout(timeout, () => req.destroy(new Error('readback response timed out')));
    req.on('error', rejectBody);
    req.end();
  });
}

function exactReadback(body, nowMs) {
  const value = JSON.parse(body);
  if (value === null || typeof value !== 'object' || Array.isArray(value)
      || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new Error('readback body must be one plain object');
  }
  const actualKeys = Object.keys(value).sort();
  if (actualKeys.length !== READBACK_KEYS.length
      || actualKeys.some((key, index) => key !== READBACK_KEYS[index])) {
    throw new Error('readback body has an unexpected field set');
  }
  const observedAtMs = canonicalUtc(value.observedAtUtc);
  const validUntilMs = canonicalUtc(value.validUntilUtc);
  if (value.source !== 'CANONICAL_SUPERVISOR_READBACK'
      || observedAtMs === null || validUntilMs === null
      || observedAtMs > nowMs || nowMs - observedAtMs > MAX_OBSERVATION_AGE_MS
      || validUntilMs <= nowMs || validUntilMs <= observedAtMs
      || validUntilMs - observedAtMs < MIN_LEASE_MS
      || validUntilMs - observedAtMs > MAX_LEASE_MS
      || typeof value.deploymentFrozen !== 'boolean'
      || !EXPOSURE_STATES.has(value.exposureState)
      || !AMBIGUITY_STATES.has(value.ambiguityState)
      || !RECOVERY_STATES.has(value.recoveryState)
      || !Number.isSafeInteger(value.currentSchemaVersion) || value.currentSchemaVersion < 0
      || !Number.isSafeInteger(value.rollbackFloor) || value.rollbackFloor < 0
      || value.rollbackFloor > value.currentSchemaVersion) {
    throw new Error('readback body is stale, malformed, or outside the canonical contract');
  }
  return value.exposureState;
}

try {
  if (process.argv.length !== 2) throw new Error('caller arguments are forbidden');
  const endpoint = exactEndpoint(process.env.I00_OPS_READBACK_URL ?? DEFAULT_URL);
  const body = await readBody(endpoint, timeoutMs());
  process.stdout.write(`${exactReadback(body, Date.now())}\n`);
} catch (error) {
  // F-028: UNKNOWN silently disables auto-rollback, so the reason must be
  // visible. stdout stays contract-exact; the reason goes to stderr.
  process.stderr.write(`exposure probe failed: ${error instanceof Error ? error.message : String(error)}\n`);
  unknown();
}
