import assert from 'node:assert/strict';
import test from 'node:test';

import { createReplayHarness } from '../../../dist/engine/basis/index.js';
import { SystemControlService } from '../../../dist/systemIntegration/controls/index.js';
import { parseControlBody } from '../../../dist/systemIntegration/routes/index.js';

const T0 = 1_800_000_000_000;

function marketStep(atMs) {
  const symbol = 'TESTUSDT';
  const spotBid = 100;
  const spotAsk = 100.02;
  const perpBid = 100.82;
  const perpAsk = 100.84;
  return {
    atMs,
    events: [
      { type: 'spotBook', tick: { symbol, bid: spotBid, ask: spotAsk, bidQty: 500, askQty: 500, ts: atMs } },
      { type: 'perpBook', tick: { symbol, bid: perpBid, ask: perpAsk, bidQty: 500, askQty: 500, ts: atMs } },
      { type: 'markFunding', tick: { symbol, markPrice: 100.83, fundingRate: 0.0001, nextFundingTs: atMs + 14_400_000, ts: atMs } },
      { type: 'spotDepth', ladder: { symbol, bids: [[spotBid, 500]], asks: [[spotAsk, 500]], ts: atMs } },
      { type: 'perpDepth', ladder: { symbol, bids: [[perpBid, 500]], asks: [[perpAsk, 500]], ts: atMs } },
    ],
  };
}

function initialize(atMs) {
  return {
    atMs,
    tick: false,
    events: [{
      type: 'universe',
      symbols: [{
        symbol: 'TESTUSDT', base: 'TEST', quote: 'USDT', hasSpot: true, hasPerp: true,
        marginBorrowable: null, minNotionalUsd: 5, tickSize: 0.01, stepSize: 0.001,
        quoteVolume24hUsd: 50_000_000, eligible: true, ineligibleReason: null,
      }],
    }],
  };
}

class Persistence {
  constructor(state) {
    this.state = state;
    this.rows = new Map();
    this.nextLedgerEventId = 1;
  }
  async findControlMutation(key) { return this.rows.get(key) ?? null; }
  async recordControlRejection() { return { kind: 'RECORDED', ledgerEventId: this.nextLedgerEventId++ }; }
  async commitControlMutation(commit) {
    const receipt = Object.freeze({
      applied: commit.applied,
      code: commit.code,
      before: commit.before,
      after: commit.after,
      ledgerEventId: this.nextLedgerEventId++,
    });
    const row = {
      requestDigest: commit.requestDigest,
      receipt,
      runtimePublication: commit.applied ? 'PENDING' : 'NOT_REQUIRED',
      mutation: commit.request.mutation,
    };
    this.state = receipt.after;
    this.rows.set(commit.request.idempotencyKey, row);
    return { kind: 'COMMITTED', ...row };
  }
  async markControlRuntimePublished(commit) {
    const row = this.rows.get(commit.idempotencyKey);
    assert.ok(row);
    row.runtimePublication = 'PUBLISHED';
    return { kind: 'PUBLISHED' };
  }
}

test('I00-039 Basis intake command is owner-applied, durable, idempotent, and observation-preserving', async () => {
  const parsed = parseControlBody({
    command: 'SET_BASIS_INTAKE', expectedRevision: 0,
    reason: 'Pause only canonical Basis proposal intake', paused: true,
  });
  assert.equal(parsed.ok, true);

  const replay = createReplayHarness({ persistTicks: 3 }, T0);
  replay.run([initialize(T0), marketStep(T0 + 2_000), marketStep(T0 + 4_000)]);
  assert.equal(replay.engine.proposals.open().length, 0);

  const initial = Object.freeze({
    revision: 0, generation: 1, safeMode: 'READ_ONLY', killSwitchEngaged: false,
    intakePaused: false, updatedAtMs: T0, correlationId: 'basis-intake-initial',
  });
  const persistence = new Persistence(initial);
  let publicationCount = 0;
  const composition = {
    inspectMutation(mutation) {
      return {
        ok: mutation.command === 'SET_BASIS_INTAKE',
        applied: replay.engine.intakePaused() !== mutation.paused,
        riskIncreasing: mutation.paused === false,
        code: 'BASIS_INTAKE_ACCEPTED',
        message: '',
      };
    },
    publishCommitted(request) {
      publicationCount += 1;
      replay.engine.setIntakePaused(request.mutation.paused);
    },
    inspectCommittedPublication(request) {
      return replay.engine.intakePaused() === request.mutation.paused ? 'APPLIED' : 'NOT_APPLIED';
    },
  };
  const controls = new SystemControlService({ initialState: initial, persistence, composition });
  const actor = Object.freeze({ id: 'operator.basis', email: null, source: 'loopback' });
  const request = Object.freeze({
    idempotencyKey: 'basis.intake.pause.0001', expectedRevision: 0,
    reason: 'Pause only canonical Basis proposal intake', requestedAtMs: T0 + 5_000,
    correlationId: 'basis-intake-command-0001', mutation: parsed.mutation,
  });
  const committed = await controls.mutate(request, actor);
  assert.equal(committed.ok, true);
  assert.equal(committed.value.ledgerEventId, 1);
  assert.equal(replay.engine.intakePaused(), true);
  assert.equal((await controls.readResult(request.idempotencyKey)).runtimePublication, 'PUBLISHED');

  replay.run([marketStep(T0 + 6_000)]);
  assert.equal(replay.engine.lastTick(), T0 + 6_000, 'market observation must continue while intake is paused');
  assert.equal(replay.engine.proposals.open().length, 0, 'paused intake cannot create a proposal');
  assert.equal(replay.engine.decisions(1)[0]?.rejectCode, 'intake_paused');

  const replayed = await controls.mutate(request, actor);
  assert.equal(replayed.ok, true);
  assert.equal(replayed.value.ledgerEventId, committed.value.ledgerEventId);
  assert.equal(publicationCount, 1, 'durable replay cannot apply the owner effect twice');
});
