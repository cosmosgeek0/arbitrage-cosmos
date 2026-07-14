import { writeSync } from 'node:fs';
import os from 'node:os';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';

// This module is injected only into the built app process by the local-proxy
// harness. It has no product authority and writes bounded JSON Lines to an
// inherited private pipe rather than opening another socket or persistence path.
if (process.env.I00_PERF_PROBE === '1') {
  const descriptor = Number(process.env.I00_PERF_TELEMETRY_FD ?? '3');
  const requestedInterval = Number(process.env.I00_PERF_SAMPLE_INTERVAL_MS ?? '1000');
  const intervalMs = Number.isSafeInteger(requestedInterval) && requestedInterval >= 250 && requestedInterval <= 5_000
    ? requestedInterval
    : 1_000;
  const logicalCpuCount = Math.max(1, os.cpus().length);
  const histogram = monitorEventLoopDelay({ resolution: 20 });
  let previousCpu = process.cpuUsage();
  let previousAt = performance.now();
  let sequence = 0;
  let pipeAvailable = Number.isSafeInteger(descriptor) && descriptor >= 3;
  histogram.enable();

  const emit = () => {
    if (!pipeAvailable) return;
    const now = performance.now();
    const elapsedUs = Math.max(1, (now - previousAt) * 1_000);
    const cpu = process.cpuUsage(previousCpu);
    const oneCorePercent = ((cpu.user + cpu.system) / elapsedUs) * 100;
    const memory = process.memoryUsage();
    const resource = process.resourceUsage();
    const nanosecondsToMilliseconds = (value) => Number.isFinite(value) ? value / 1_000_000 : null;
    const sample = {
      schemaVersion: 'i00.app-process-probe.v1',
      sequence,
      monotonicMs: now,
      elapsedMs: now - previousAt,
      cpuOneCorePercent: oneCorePercent,
      cpuHostPercent: oneCorePercent / logicalCpuCount,
      cpuUserMicroseconds: cpu.user,
      cpuSystemMicroseconds: cpu.system,
      rssBytes: memory.rss,
      heapUsedBytes: memory.heapUsed,
      heapTotalBytes: memory.heapTotal,
      externalBytes: memory.external,
      maxRssBytes: resource.maxRSS * 1_024,
      voluntaryContextSwitches: resource.voluntaryContextSwitches,
      involuntaryContextSwitches: resource.involuntaryContextSwitches,
      eventLoopP50Ms: nanosecondsToMilliseconds(histogram.percentile(50)),
      eventLoopP95Ms: nanosecondsToMilliseconds(histogram.percentile(95)),
      eventLoopP99Ms: nanosecondsToMilliseconds(histogram.percentile(99)),
      eventLoopMaxMs: nanosecondsToMilliseconds(histogram.max),
    };
    try {
      writeSync(descriptor, `${JSON.stringify(sample)}\n`);
    } catch {
      pipeAvailable = false;
      histogram.disable();
    }
    sequence += 1;
    previousCpu = process.cpuUsage();
    previousAt = now;
    histogram.reset();
  };

  const timer = setInterval(emit, intervalMs);
  timer.unref();
  process.once('beforeExit', () => {
    clearInterval(timer);
    emit();
    histogram.disable();
  });
}
