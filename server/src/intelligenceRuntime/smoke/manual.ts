import {
  ConsoleSmokeReporter,
  NodePublicRestTransport,
  NodePublicWebSocketTransport,
  NodeSmokeWait,
  PublicNoKeySmokeHarness,
  SystemSmokeClock,
} from './index.js';
import { pathToFileURL } from 'node:url';

function positiveInteger(value: string, name: string, maximum: number): number {
  if (!/^\d+$/.test(value)) throw new TypeError(`${name} must be a positive integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 100 || parsed > maximum) {
    throw new RangeError(`${name} must be in [100, ${maximum}]`);
  }
  return parsed;
}

function argumentsFor(argv: readonly string[]): { durationMs: number; focusSymbol: string } {
  let durationMs = 15_000;
  let focusSymbol = 'BTCUSDT';
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if ((flag !== '--duration-ms' && flag !== '--symbol') || value === undefined) {
      throw new TypeError('usage: --duration-ms <100..60000> --symbol <BINANCE_SYMBOL>');
    }
    if (flag === '--duration-ms') durationMs = positiveInteger(value, 'duration-ms', 60_000);
    else focusSymbol = value;
    index += 1;
  }
  return { durationMs, focusSymbol };
}

export async function runManualPublicSmoke(argv: readonly string[]): Promise<number> {
  const input = argumentsFor(argv);
  const clock = new SystemSmokeClock();
  const harness = new PublicNoKeySmokeHarness({
    clock,
    wait: new NodeSmokeWait(),
    reporter: new ConsoleSmokeReporter(),
    restTransport: new NodePublicRestTransport({ clock }),
    webSocketTransport: new NodePublicWebSocketTransport({ clock }),
  });
  const result = await harness.run(input);
  console.log(JSON.stringify({ type: 'public-no-key-smoke-result', result }, null, 2));
  return result.outcome === 'FAIL' ? 1 : 0;
}

const directEntry = process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url;
if (directEntry) {
  runManualPublicSmoke(process.argv.slice(2)).then((exitCode) => {
    process.exitCode = exitCode;
  }).catch((error) => {
    console.error(JSON.stringify({
      type: 'public-no-key-smoke-fatal',
      message: error instanceof Error ? error.message : String(error),
    }));
    process.exitCode = 1;
  });
}
