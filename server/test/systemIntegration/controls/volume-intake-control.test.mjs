import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ManualClock,
  SyntheticReplayRunner,
  VolumeEngine,
  burstTape,
  quietTape,
  seededRng,
  steadyBooks,
} from '../../../dist/engine/volume/index.js';
import { SystemControlService } from '../../../dist/systemIntegration/controls/index.js';
import { parseControlBody } from '../../../dist/systemIntegration/routes/index.js';

const T0 = 1_800_000_000_000;
const SYMBOL = 'WAKEUSDT';

class Persistence {
  constructor(state) { this.state = state; this.rows = new Map(); this.nextId = 1; }
  async findControlMutation(key) { return this.rows.get(key) ?? null; }
  async recordControlRejection() { return { kind: 'RECORDED', ledgerEventId: this.nextId++ }; }
  async commitControlMutation(commit) {
    const receipt = Object.freeze({ applied: commit.applied, code: commit.code, before: commit.before, after: commit.after, ledgerEventId: this.nextId++ });
    const row = { requestDigest: commit.requestDigest, receipt, runtimePublication: commit.applied ? 'PENDING' : 'NOT_REQUIRED', mutation: commit.request.mutation };
    this.state = receipt.after;
    this.rows.set(commit.request.idempotencyKey, row);
    return { kind: 'COMMITTED', ...row };
  }
  async markControlRuntimePublished(commit) {
    this.rows.get(commit.idempotencyKey).runtimePublication = 'PUBLISHED';
    return { kind: 'PUBLISHED' };
  }
}

function ownerWorld() {
  const clock = new ManualClock(0);
  const engine = new VolumeEngine(clock, {
    baselineMinSamples: 30,
    baselineWindowMinutes: 60,
    tickMs: 1_000,
    minFocusDwellMs: 4_000,
    verificationGraceMs: 3_000,
  });
  const runner = new SyntheticReplayRunner(engine, clock);
  engine.start();
  engine.setUniverse([{
    symbol: SYMBOL, base: 'WAKE', quote: 'USDT', hasSpot: true, hasPerp: false,
    marginBorrowable: null, minNotionalUsd: 5, tickSize: 0.00001, stepSize: 0.1,
    quoteVolume24hUsd: 5_000_000, eligible: true, ineligibleReason: null,
  }]);
  const random = seededRng(37);
  runner.play([{
    symbol: SYMBOL,
    trades: quietTape({ startMs: 0, minutes: 35, quotePerMin: 300, tradesPerMin: 4, price: 0.05, rand: random }),
    books: steadyBooks({ startMs: 0, durationMs: 35 * 60_000, everyMs: 5_000, mid: 0.05, spreadBps: 4, qty: 1_000_000 }),
  }], 35 * 60_000, { tickMs: 30_000, tickOnEvent: false });
  return { engine, runner, random };
}

test('I00-040 Volume intake command is owner-applied, durable, idempotent, and observation-preserving', async () => {
  const parsed = parseControlBody({
    command: 'SET_VOLUME_INTAKE', expectedRevision: 0,
    reason: 'Pause only canonical Volume proposal intake', paused: true,
  });
  assert.equal(parsed.ok, true);

  const { engine, runner, random } = ownerWorld();
  const initial = Object.freeze({
    revision: 0, generation: 1, safeMode: 'READ_ONLY', killSwitchEngaged: false,
    intakePaused: false, updatedAtMs: T0, correlationId: 'volume-intake-initial',
  });
  const persistence = new Persistence(initial);
  let publicationCount = 0;
  const composition = {
    inspectMutation(mutation) {
      return { ok: mutation.command === 'SET_VOLUME_INTAKE', applied: engine.intakePaused() !== mutation.paused, riskIncreasing: mutation.paused === false, code: 'VOLUME_INTAKE_ACCEPTED', message: '' };
    },
    publishCommitted(request) { publicationCount += 1; engine.setIntakePaused(request.mutation.paused); },
    inspectCommittedPublication(request) { return engine.intakePaused() === request.mutation.paused ? 'APPLIED' : 'NOT_APPLIED'; },
  };
  const controls = new SystemControlService({ initialState: initial, persistence, composition });
  const request = Object.freeze({
    idempotencyKey: 'volume.intake.pause.0001', expectedRevision: 0,
    reason: 'Pause only canonical Volume proposal intake', requestedAtMs: T0 + 1,
    correlationId: 'volume-intake-command-0001', mutation: parsed.mutation,
  });
  const actor = Object.freeze({ id: 'operator.volume', email: null, source: 'loopback' });
  const committed = await controls.mutate(request, actor);
  assert.equal(committed.ok, true);
  assert.equal(committed.value.ledgerEventId, 1);
  assert.equal(engine.intakePaused(), true);
  assert.equal((await controls.readResult(request.idempotencyKey)).runtimePublication, 'PUBLISHED');

  runner.play([{
    symbol: SYMBOL,
    trades: burstTape({ startMs: 0, durationMs: 15_000, quotePerSec: 2_000, tradesPerSec: 20, startPrice: 0.05, totalMovePct: 1.2, takerBuyRatio: 0.85, rand: random }),
    books: steadyBooks({ startMs: 0, durationMs: 20_000, everyMs: 500, mid: 0.05, spreadBps: 4, qty: 1_000_000 }),
  }], 16_000);
  assert.ok(engine.lastTick() > 35 * 60_000, 'market observation must continue while intake is paused');
  assert.equal(engine.proposalStore.all().length, 0, 'paused intake cannot create a proposal');
  assert.ok(engine.decisions(2_000).some((decision) => decision.rejectCode === 'intake_paused'));

  const replayed = await controls.mutate(request, actor);
  assert.equal(replayed.ok, true);
  assert.equal(replayed.value.ledgerEventId, committed.value.ledgerEventId);
  assert.equal(publicationCount, 1);
});
