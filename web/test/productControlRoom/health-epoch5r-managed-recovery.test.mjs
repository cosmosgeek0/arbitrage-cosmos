import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const source = await readFile(
  new URL('../../src/pages/SystemHealth.tsx', import.meta.url),
  'utf8',
);
const styles = await readFile(
  new URL('../../src/pages/Health.css', import.meta.url),
  'utf8',
);

function loadExactHealthSelector() {
  const start = source.indexOf('export function selectHealthManagedRestartControl');
  const endMarker = '\n}\n\nexport function SystemHealth';
  const end = source.indexOf(endMarker, start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const typescript = source.slice(start, end + 2).replace('export function', 'function');
  const javascript = ts.transpileModule(typescript, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const context = {
    HEALTH_MANAGED_RESTART_CONTROL_ID: 'component.engine-supervisor.restart',
  };
  runInNewContext(`${javascript}\nglobalThis.selector = selectHealthManagedRestartControl;`, context);
  return context.selector;
}

test('Epoch 5R Health exposes only the exact live managed-root restart contract', () => {
  const selectControl = loadExactHealthSelector();
  const control = Object.freeze({
    controlId: 'component.engine-supervisor.restart',
    wiringState: 'WIRED_LIVE',
    backendCommandId: 'RESTART_COMPONENT',
    targetType: 'COMPONENT',
    targetId: 'engine-supervisor',
    effect: 'RESTART',
    payload: Object.freeze({ componentId: 'engine-supervisor' }),
  });
  assert.equal(selectControl([control], 'PROVEN'), control);

  const rejected = [
    { ...control, wiringState: 'WIRED_FIXTURE' },
    { ...control, backendCommandId: 'SPAWN_PROCESS' },
    { ...control, targetType: 'SYSTEM' },
    { ...control, targetId: 'basis-engine' },
    { ...control, effect: 'DEPLOYMENT' },
    { ...control, payload: Object.freeze({ componentId: 'basis-engine' }) },
    { ...control, payload: Object.freeze({ componentId: 'engine-supervisor', command: 'restart' }) },
  ];
  for (const candidate of rejected) assert.equal(selectControl([candidate], 'PROVEN'), null);
  assert.equal(selectControl([control], 'BLOCKED'), null);
});

test('Epoch 5R Health delegates preview, submit, and durable readback without a direct restart route', () => {
  assert.match(source, /ControlRegistryPanel/);
  assert.match(source, /client\.previewCommand\(control\.controlId, control\.currentStateRevision/);
  assert.match(source, /client\.submitCommand\(request\)/);
  assert.match(source, /client\.readCommandResult\(identity, signal\)/);
  assert.match(source, /controls=\{recoveryControls\}/);
  assert.match(source, /selectHealthManagedRestartControl\(\[control\], binding\.continuity\)/);
  assert.doesNotMatch(source, /selectHealthManagedRestartControl\(\[control\], 'PROVEN'\)/);
  assert.doesNotMatch(source, /fetch\(/);
  assert.doesNotMatch(source, /\/commands\/preview|\/commands['"`]/);
});

test('Epoch 5R Health removes manual rereads and retains the real Audit Ledger navigation', () => {
  assert.doesNotMatch(source, /Try Again|RefreshCw/);
  assert.doesNotMatch(source, /onClick=\{\(\) => void binding\.refresh\(\)\}/);
  assert.match(source, /onClick=\{\(\) => setPage\('ledger'\)\}/);
  assert.match(styles, /\.healthx-recovery-control \.pcr-control-filters \{ display: none; \}/);
  assert.match(styles, /content: 'Preview ';/);
});
