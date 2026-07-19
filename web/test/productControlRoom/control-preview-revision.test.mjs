import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  controlPreviewMatchesCurrentRevision,
  isCurrentControlPreviewRequest,
} from '../../src/features/productControlRoom/components/ControlRegistryPanel.tsx';

const preview = Object.freeze({
  previewId: 'preview-1',
  controlId: 'control.alpha',
  expectedRevision: 'revision-1',
  digest: 'digest-1',
  consequence: 'Test only.',
  expiresAtMs: 1_900_000_000_000,
  synthetic: false,
});

const control = (revision) => Object.freeze({
  controlId: 'control.alpha',
  currentStateRevision: revision,
});

test('a pending confirmation is valid only while its exact control revision remains current', () => {
  assert.equal(controlPreviewMatchesCurrentRevision(preview, [control('revision-1')]), true);
  assert.equal(controlPreviewMatchesCurrentRevision(preview, [control('revision-2')]), false);
  assert.equal(controlPreviewMatchesCurrentRevision(preview, []), false);
});

test('preview completion is rejected after supersession or abort', () => {
  const active = Object.freeze({
    requestId: 4,
    controlId: 'control.alpha',
    controlRevision: 'revision-1',
  });
  const controller = new AbortController();

  assert.equal(isCurrentControlPreviewRequest(active, active, 4, controller.signal), true);
  assert.equal(isCurrentControlPreviewRequest(active, active, 5, controller.signal), false);
  assert.equal(isCurrentControlPreviewRequest(active, { ...active, requestId: 5 }, 4, controller.signal), false);
  controller.abort();
  assert.equal(isCurrentControlPreviewRequest(active, active, 4, controller.signal), false);
});

test('production preview wiring carries AbortSignal and invalidates revision-bound work', async () => {
  const [panel, route] = await Promise.all([
    readFile(new URL('../../src/features/productControlRoom/components/ControlRegistryPanel.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../../src/features/productControlRoom/ProductControlRoomRoute.tsx', import.meta.url), 'utf8'),
  ]);

  assert.match(panel, /onPreview\(control, controller\.signal\)/);
  assert.match(panel, /previewAbortRef\.current\?\.abort\(\)/);
  assert.match(panel, /controlPreviewMatchesCurrentRevision\(pending, controls\)/);
  assert.match(panel, /isCurrentControlPreviewRequest\(/);
  assert.match(route, /client\.previewCommand\(control\.controlId, control\.currentStateRevision, undefined, signal\)/);
});
