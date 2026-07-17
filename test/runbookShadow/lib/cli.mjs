import { PACKET_DISPOSITION, PACKET_ID } from './constants.mjs';
import { runAllDrills, runDrill } from './runner.mjs';

export async function runDrillCli(drillId) {
  const receipt = await runDrill(drillId);
  process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
  process.exitCode = receipt.exitCode;
  return receipt;
}

export async function runAllCli() {
  const receipts = await runAllDrills();
  const passed = receipts.filter((receipt) => receipt.result === 'PASS').length;
  const output = Object.freeze({
    schemaVersion: 1,
    packetId: PACKET_ID,
    packetDisposition: PACKET_DISPOSITION,
    result: passed === receipts.length ? 'PASS' : 'FAIL',
    passed,
    total: receipts.length,
    receipts,
  });
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  process.exitCode = output.result === 'PASS' ? 0 : 1;
  return output;
}
