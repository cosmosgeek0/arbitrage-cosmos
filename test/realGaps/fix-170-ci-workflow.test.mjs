import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const workflow = readFileSync(path.join(ROOT, '.github/workflows/ci.yml'), 'utf8');

function jobSource(jobId) {
  const marker = `  ${jobId}:\n`;
  const start = workflow.indexOf(marker);
  assert.notEqual(start, -1, `missing CI job ${jobId}`);
  const body = workflow.slice(start + marker.length);
  const nextJob = body.search(/^  [a-z][a-z0-9-]*:\n/mu);
  return nextJob === -1 ? body : body.slice(0, nextJob);
}

test('routine CI mounts bounded canonical full-matrix and local ops jobs', () => {
  assert.match(workflow, /^  pull_request:/mu);
  const canonical = jobSource('canonical-full');
  const ops = jobSource('ops-local');
  assert.match(canonical, /timeout-minutes:\s*(?:[1-5]?\d|60)\b/u);
  assert.match(ops, /timeout-minutes:\s*(?:[1-2]?\d|30)\b/u);
  assert.match(canonical, /uses:\s*actions\/setup-node@v6/u);
  assert.match(canonical, /node-version-file:\s*\.nvmrc/u);
  assert.match(canonical, /uses:\s*actions\/setup-python@v6/u);
  assert.match(canonical, /python-version-file:\s*quant\/\.python-version/u);
  assert.match(canonical, /uses:\s*astral-sh\/setup-uv@08807647e7069bb48b6ef5acd8ec9567f424441b/u);
  assert.match(canonical, /version:\s*0\.11\.28/u);
  assert.match(canonical, /run:\s*npm ci\s*$/mu);
  assert.match(canonical, /uv sync --project quant --locked --all-groups --all-extras/u);
  assert.match(canonical, /--python 3\.13\.14/u);
  assert.match(canonical, /run:\s*npm run test:all\s*$/mu);
  assert.match(ops, /run:\s*npm ci\s*$/mu);
  assert.match(ops, /run:\s*bash ops\/tests\/run-all\.sh\s*$/mu);
  assert.match(ops, /run:\s*bash ops\/tests\/i00\/run-all\.sh\s*$/mu);
});

test('CI child failures stay visible and staging-only actions stay out of PR jobs', () => {
  assert.doesNotMatch(workflow, /continue-on-error:\s*true|\|\|\s*true/u);
  assert.doesNotMatch(workflow, /uv sync[^\n]*(?:--check|--offline)/u);
  assert.doesNotMatch(
    workflow,
    /deploy:preflight|release:preflight|rollback:preflight|smoke:private-read|smoke:signed-test/u,
  );
});
