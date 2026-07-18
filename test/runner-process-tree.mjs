import { spawn, spawnSync } from 'node:child_process';

const FORCE_KILL_GRACE_MS = 5_000;
const activeChildren = new Set();
let forwardedSignal = null;
let forwardedExitTimer = null;

function signalExitCode(signal) {
  return signal === 'SIGINT' ? 130 : 143;
}

function signalChildTree(child, signal) {
  if (!Number.isSafeInteger(child.pid) || child.pid <= 0) return;
  if (process.platform === 'win32') {
    if (signal === 'SIGKILL') {
      spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      });
    } else {
      try {
        child.kill('SIGTERM');
      } catch {
        // The direct child may already have exited; the forced tree kill remains armed.
      }
    }
    return;
  }
  try {
    process.kill(-child.pid, signal);
  } catch (error) {
    if (error?.code !== 'ESRCH') throw error;
  }
}

function finishForwardedSignalIfIdle() {
  if (forwardedSignal === null || activeChildren.size > 0) return;
  if (forwardedExitTimer !== null) clearTimeout(forwardedExitTimer);
  process.exit(signalExitCode(forwardedSignal));
}

function forwardSignal(signal) {
  if (forwardedSignal !== null) return;
  forwardedSignal = signal;
  for (const child of activeChildren) signalChildTree(child, 'SIGTERM');
  if (activeChildren.size === 0) {
    finishForwardedSignalIfIdle();
    return;
  }
  forwardedExitTimer = setTimeout(() => {
    for (const child of activeChildren) signalChildTree(child, 'SIGKILL');
    process.exit(signalExitCode(signal));
  }, FORCE_KILL_GRACE_MS);
}

process.once('SIGINT', () => forwardSignal('SIGINT'));
process.once('SIGTERM', () => forwardSignal('SIGTERM'));

export function spawnRunnerChild(command, args, options) {
  const child = spawn(command, args, {
    ...options,
    detached: process.platform !== 'win32',
  });
  activeChildren.add(child);
  child.once('close', () => {
    activeChildren.delete(child);
    finishForwardedSignalIfIdle();
  });
  return child;
}

export function superviseRunnerChild(child, timeoutMs) {
  let timedOut = false;
  let forceKillTimer = null;
  const timeoutTimer = setTimeout(() => {
    timedOut = true;
    signalChildTree(child, 'SIGTERM');
    forceKillTimer = setTimeout(() => signalChildTree(child, 'SIGKILL'), FORCE_KILL_GRACE_MS);
  }, timeoutMs);

  return {
    get timedOut() {
      return timedOut;
    },
    finish() {
      clearTimeout(timeoutTimer);
      if (forceKillTimer !== null) clearTimeout(forceKillTimer);
      if (timedOut) signalChildTree(child, 'SIGKILL');
    },
  };
}

export function runnerChildFailed({ code, signal, timedOut }) {
  return timedOut === true || code !== 0 || signal !== null;
}

export function terminateRunnerChild(child) {
  signalChildTree(child, 'SIGTERM');
  setTimeout(() => signalChildTree(child, 'SIGKILL'), FORCE_KILL_GRACE_MS);
}
