import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { createSerializedWatchlistMutationQueue } from '../../src/store.tsx';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function nextTurn() {
  return new Promise((resolve) => setImmediate(resolve));
}

test('rapid watchlist toggles serialize and derive from the preceding acknowledgement', async () => {
  const submissions = [];
  const acknowledgements = [];
  const queue = createSerializedWatchlistMutationQueue(['BTCUSDT'], async (watchlist) => {
    const acknowledgement = deferred();
    submissions.push([...watchlist]);
    acknowledgements.push(acknowledgement);
    return acknowledgement.promise;
  });

  const addEth = queue.enqueue('ETHUSDT');
  const addSol = queue.enqueue('SOLUSDT');
  await nextTurn();

  assert.deepEqual(submissions, [
    ['BTCUSDT', 'ETHUSDT'],
  ], 'the second mutation must not be sent while the first acknowledgement is pending');

  // A stale compatibility render during the pending batch must not replace the
  // queue's acknowledged base.
  queue.synchronize(['STALEUSDT']);
  acknowledgements[0].resolve({ watchlist: ['BTCUSDT', 'ETHUSDT'] });
  await nextTurn();

  assert.deepEqual(submissions, [
    ['BTCUSDT', 'ETHUSDT'],
    ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'],
  ]);

  acknowledgements[1].resolve({ watchlist: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'] });
  const [first, second] = await Promise.all([addEth, addSol]);
  assert.deepEqual(first.watchlist, ['BTCUSDT', 'ETHUSDT']);
  assert.deepEqual(second.watchlist, ['BTCUSDT', 'ETHUSDT', 'SOLUSDT']);
});

test('StoreProvider routes watchlist toggles through the serialized queue', async () => {
  const source = await readFile(new URL('../../src/store.tsx', import.meta.url), 'utf8');
  assert.match(source, /createSerializedWatchlistMutationQueue\(/);
  assert.match(source, /watchlistMutationQueue\.enqueue\(symbol\)/);
  assert.doesNotMatch(source, /const cur = state\?\.config\.watchlist/);
});
