import assert from 'node:assert/strict';
import net from 'node:net';
import test from 'node:test';

test('focused suite executes inside total host network denial', async () => {
  assert.equal(process.env.PORT_OBS_TOTAL_NETWORK_DENY, 'darwin-sandbox-deny-network');

  const outcome = await new Promise((resolve) => {
    let socket;
    try {
      socket = net.createConnection({ host: '127.0.0.1', port: 9 });
    } catch (error) {
      resolve(error);
      return;
    }
    socket.once('connect', () => {
      socket.destroy();
      resolve(new Error('NETWORK_UNEXPECTEDLY_ALLOWED'));
    });
    socket.once('error', resolve);
  });

  assert.notEqual(outcome.message, 'NETWORK_UNEXPECTEDLY_ALLOWED');
  assert.ok(['EACCES', 'EPERM'].includes(outcome.code), `${outcome.code}: ${outcome.message}`);
});
