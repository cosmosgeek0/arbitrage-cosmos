import { parentPort, workerData } from 'node:worker_threads';

import { writeImmutableJson } from './contract.mjs';

if (parentPort === null) throw new Error('IMMUTABLE_EVIDENCE_WORKER_PARENT_PORT_MISSING');

parentPort.postMessage({ type: 'READY' });
parentPort.once('message', () => {
  try {
    writeImmutableJson(workerData.directory, 'race.json', { writerId: workerData.writerId });
    parentPort.postMessage({ type: 'RESULT', ok: true, writerId: workerData.writerId });
  } catch (error) {
    parentPort.postMessage({
      type: 'RESULT',
      ok: false,
      writerId: workerData.writerId,
      message: error instanceof Error ? error.message : String(error),
    });
  }
});
