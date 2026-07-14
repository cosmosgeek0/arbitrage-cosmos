import { createReadStream, writeSync } from 'node:fs';
import os from 'node:os';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';

function nanosecondsToMilliseconds(value) {
  return Number.isFinite(value) ? value / 1_000_000 : null;
}

export function createPhaseEventLoopController(histogram) {
  let armed = false;
  return Object.freeze({
    reset() {
      if (armed) return Object.freeze({ status: 'ERROR', eventLoopDelay: null, reason: 'PHASE_EVENT_LOOP_ALREADY_ARMED' });
      histogram.disable();
      histogram.reset();
      histogram.enable();
      armed = true;
      return Object.freeze({ status: 'OK', eventLoopDelay: null, reason: null });
    },
    snapshot() {
      if (!armed) return Object.freeze({ status: 'ERROR', eventLoopDelay: null, reason: 'PHASE_EVENT_LOOP_NOT_ARMED' });
      histogram.disable();
      armed = false;
      return Object.freeze({
        status: 'OK',
        eventLoopDelay: Object.freeze({
          count: Number(histogram.count),
          min: nanosecondsToMilliseconds(histogram.min),
          p50: nanosecondsToMilliseconds(histogram.percentile(50)),
          p95: nanosecondsToMilliseconds(histogram.percentile(95)),
          p99: nanosecondsToMilliseconds(histogram.percentile(99)),
          max: nanosecondsToMilliseconds(histogram.max),
          mean: nanosecondsToMilliseconds(histogram.mean),
        }),
        reason: null,
      });
    },
  });
}

// This module is injected only into the built app process by the local-proxy
// harness. It has no product authority and writes bounded JSON Lines to an
// inherited private pipe rather than opening another socket or persistence path.
if (process.env.I00_PERF_PROBE === '1') {
  const descriptor = Number(process.env.I00_PERF_TELEMETRY_FD ?? '3');
  const controlDescriptor = Number(process.env.I00_PERF_CONTROL_FD ?? '4');
  const requestedInterval = Number(process.env.I00_PERF_SAMPLE_INTERVAL_MS ?? '1000');
  const intervalMs = Number.isSafeInteger(requestedInterval) && requestedInterval >= 250 && requestedInterval <= 5_000
    ? requestedInterval
    : 1_000;
  const logicalCpuCount = Math.max(1, os.cpus().length);
  const intervalHistogram = monitorEventLoopDelay({ resolution: 20 });
  const phaseHistogram = monitorEventLoopDelay({ resolution: 20 });
  let previousCpu = process.cpuUsage();
  let previousAt = performance.now();
  let sequence = 0;
  let pipeAvailable = Number.isSafeInteger(descriptor) && descriptor >= 3;
  let controlBuffer = '';
  intervalHistogram.enable();
  const phaseEventLoopController = createPhaseEventLoopController(phaseHistogram);

  const writeTelemetry = (value) => {
    if (!pipeAvailable) return false;
    try {
      writeSync(descriptor, `${JSON.stringify(value)}\n`);
      return true;
    } catch {
      pipeAvailable = false;
      intervalHistogram.disable();
      phaseHistogram.disable();
      return false;
    }
  };

  const controlResult = (requestId, command, status, eventLoopDelay = null, reason = null) => {
    writeTelemetry({
      schemaVersion: 'i00.app-process-probe.control-result.v1',
      requestId,
      command,
      status,
      monotonicMs: performance.now(),
      eventLoopDelay,
      reason,
    });
  };

  const handleControlLine = (line) => {
    let request;
    try {
      request = JSON.parse(line);
    } catch {
      controlResult(null, null, 'ERROR', null, 'CONTROL_JSON_INVALID');
      return;
    }
    const requestId = typeof request?.requestId === 'string' && request.requestId.length >= 1 && request.requestId.length <= 160
      ? request.requestId
      : null;
    const command = typeof request?.command === 'string' ? request.command : null;
    if (request?.schemaVersion !== 'i00.app-process-probe.control.v1' || requestId === null) {
      controlResult(requestId, command, 'ERROR', null, 'CONTROL_ENVELOPE_INVALID');
      return;
    }
    if (command === 'RESET_PHASE_EVENT_LOOP') {
      const result = phaseEventLoopController.reset();
      controlResult(requestId, command, result.status, result.eventLoopDelay, result.reason);
      return;
    }
    if (command === 'SNAPSHOT_PHASE_EVENT_LOOP') {
      const result = phaseEventLoopController.snapshot();
      controlResult(requestId, command, result.status, result.eventLoopDelay, result.reason);
      return;
    }
    controlResult(requestId, command, 'ERROR', null, 'CONTROL_COMMAND_UNKNOWN');
  };

  const emit = () => {
    if (!pipeAvailable) return;
    const now = performance.now();
    const elapsedUs = Math.max(1, (now - previousAt) * 1_000);
    const cpu = process.cpuUsage(previousCpu);
    const oneCorePercent = ((cpu.user + cpu.system) / elapsedUs) * 100;
    const memory = process.memoryUsage();
    const resource = process.resourceUsage();
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
      eventLoopP50Ms: nanosecondsToMilliseconds(intervalHistogram.percentile(50)),
      eventLoopP95Ms: nanosecondsToMilliseconds(intervalHistogram.percentile(95)),
      eventLoopP99Ms: nanosecondsToMilliseconds(intervalHistogram.percentile(99)),
      eventLoopMaxMs: nanosecondsToMilliseconds(intervalHistogram.max),
    };
    writeTelemetry(sample);
    sequence += 1;
    previousCpu = process.cpuUsage();
    previousAt = now;
    intervalHistogram.reset();
  };

  const timer = setInterval(emit, intervalMs);
  timer.unref();
  const controlAvailable = Number.isSafeInteger(controlDescriptor) && controlDescriptor >= 3 && controlDescriptor !== descriptor;
  const control = controlAvailable
    ? createReadStream('', { fd: controlDescriptor, autoClose: false, encoding: 'utf8' })
    : null;
  control?.on('data', (chunk) => {
    controlBuffer += chunk;
    if (controlBuffer.length > 16_384) {
      controlBuffer = '';
      controlResult(null, null, 'ERROR', null, 'CONTROL_BUFFER_LIMIT_EXCEEDED');
      return;
    }
    for (let newline = controlBuffer.indexOf('\n'); newline >= 0; newline = controlBuffer.indexOf('\n')) {
      const line = controlBuffer.slice(0, newline);
      controlBuffer = controlBuffer.slice(newline + 1);
      if (line.length > 0) handleControlLine(line);
    }
  });
  control?.on('error', () => {
    controlResult(null, null, 'ERROR', null, 'CONTROL_PIPE_FAILED');
  });
  const closeControl = () => {
    try { control?.destroy(); } catch { /* Best-effort private-pipe cleanup. */ }
  };
  process.once('beforeExit', () => {
    clearInterval(timer);
    emit();
    intervalHistogram.disable();
    phaseHistogram.disable();
    closeControl();
  });
}
