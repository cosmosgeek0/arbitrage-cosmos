import { createHash } from 'node:crypto';
import {
  DescribeInstanceInformationCommand,
  GetCommandInvocationCommand,
  SendCommandCommand,
  SSMClient,
  type DescribeInstanceInformationCommandOutput,
  type GetCommandInvocationCommandOutput,
  type SendCommandCommandOutput,
} from '@aws-sdk/client-ssm';
import {
  GetCallerIdentityCommand,
  STSClient,
  type GetCallerIdentityCommandOutput,
} from '@aws-sdk/client-sts';
import type { Ledger } from '../ledger.js';

const CONFIG_KEY = 'aws-runner-control';
const MAX_RUNNER_BYTES = 16_000;
const MAX_COMMAND_OUTPUT_BYTES = 64_000;
const MAX_STATUS_OUTPUT_BYTES = 4_000;
const AWS_CONNECTION_TIMEOUT_MS = 5_000;
const AWS_REQUEST_TIMEOUT_MS = 15_000;
const AWS_PROBE_DEADLINE_MS = 15_000;
const AWS_ACTION_GRACE_MS = 20_000;
const TERMINAL = new Set(['Success', 'Cancelled', 'TimedOut', 'Failed', 'Cancelling']);
const BASE64_RE = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

export interface AwsRunnerGates {
  connectionEnabled: boolean;
  executionEnabled: boolean;
  updatedAt: number;
  updatedBy: string | null;
}

export interface AwsRunnerStatus {
  configured: boolean;
  missing: string[];
  connectionEnabled: boolean;
  executionEnabled: boolean;
  region: string | null;
  instanceId: string | null;
  runnerPath: string | null;
  workdir: string | null;
  serviceName: string | null;
  documentName: string;
  operatorAuthorized: boolean;
  operator: string | null;
  channel: 'blocked' | 'not_configured' | 'ready' | 'online' | 'offline';
  identityArn: string | null;
  accountId: string | null;
  instanceOnline: boolean | null;
  lastProbeAt: number | null;
  lastAction: AwsRunnerActionResult | null;
  maxRunnerBytes: number;
}

export interface AwsRunnerActionResult {
  commandId: string | null;
  action: string;
  status: string;
  output: string;
  error: string;
  startedAt: number;
  finishedAt: number;
}

export interface AwsRunnerFile {
  path: string;
  content: string;
  sha256: string;
  bytes: number;
  fetchedAt: number;
}

export interface AwsRunnerRuntime {
  nowMs(): number;
  schedule(delayMs: number, task: () => void): { cancel(): void };
}

export interface AwsRunnerControlOptions {
  readonly runtime?: AwsRunnerRuntime;
  readonly requestTimeoutMs?: number;
}

interface AwsActionScope {
  readonly signal: AbortSignal;
  readonly deadlineAtMs: number;
  readonly expired: Promise<void>;
  expire(): void;
  close(): void;
  isExpired(): boolean;
}

export class AwsRunnerControlError extends Error {
  constructor(public readonly statusCode: number, public readonly code: string, message: string) {
    super(message);
  }
}

function envText(name: string): string {
  return String(process.env[name] ?? '').trim();
}

function validAbsolutePath(value: string): boolean {
  return value.startsWith('/') && value.length <= 240 && !/[\r\n\0]/.test(value);
}

function validRunnerPath(value: string): boolean {
  return validAbsolutePath(value) && /\.(?:ts|js|mjs|cjs|json|sh|bash|py)$/.test(value);
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

const SYSTEM_AWS_RUNNER_RUNTIME: AwsRunnerRuntime = Object.freeze({
  nowMs: () => Date.now(),
  schedule(delayMs: number, task: () => void) {
    const handle = setTimeout(task, delayMs);
    return Object.freeze({ cancel: () => clearTimeout(handle) });
  },
});

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function containsSecretMaterial(value: string): boolean {
  return /(?:AWS_(?:SECRET_ACCESS_KEY|SESSION_TOKEN)|BINANCE_(?:API_)?SECRET|-----BEGIN [A-Z ]*PRIVATE KEY-----|apiSecret\s*[:=]|(?:secret|token|password)\s*[:=]\s*['"][^'"\s]{8,})/i.test(value);
}

function strictBase64(value: string): Buffer | null {
  if (value.length % 4 !== 0 || !BASE64_RE.test(value)) return null;
  const decoded = Buffer.from(value, 'base64');
  if (decoded.toString('base64') !== value) return null;
  return decoded;
}

function redactText(value: string, maximumBytes = MAX_COMMAND_OUTPUT_BYTES): string {
  const withoutControls = value.replace(/[\0\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
  const redacted = withoutControls
    .replace(/(AWS_(?:ACCESS_KEY_ID|SECRET_ACCESS_KEY|SESSION_TOKEN)\s*[=:]\s*)\S+/gi, '$1[REDACTED]')
    .replace(/((?:secret|token|password|authorization|api[_-]?key)\s*[=:]\s*)\S+/gi, '$1[REDACTED]')
    .replace(/AKIA[0-9A-Z]{16}/g, '[REDACTED_AWS_KEY]')
    .replace(/(?:Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]');
  const bytes = Buffer.from(redacted, 'utf8');
  if (bytes.length <= maximumBytes) return redacted;
  return `${bytes.subarray(0, maximumBytes).toString('utf8')}\n[output truncated]`;
}

function safeFailureDetail(error: unknown): string {
  if (!error || typeof error !== 'object') return 'unknown error';
  const candidate = error as { name?: unknown; $metadata?: { httpStatusCode?: unknown } };
  const name = typeof candidate.name === 'string' && /^[A-Za-z0-9_.-]{1,80}$/.test(candidate.name)
    ? candidate.name
    : 'AWS service error';
  const status = typeof candidate.$metadata?.httpStatusCode === 'number'
    ? `, HTTP ${candidate.$metadata.httpStatusCode}`
    : '';
  return `${name}${status}`;
}

function publicActionResult(result: AwsRunnerActionResult): AwsRunnerActionResult {
  const sensitiveOutput = result.action === 'read_runner' || result.action === 'save_runner';
  return {
    ...result,
    output: sensitiveOutput ? '' : redactText(result.output, MAX_STATUS_OUTPUT_BYTES),
    error: redactText(result.error, MAX_STATUS_OUTPUT_BYTES),
  };
}

export class AwsRunnerControl {
  private readonly region = envText('AWS_CONTROL_REGION') || envText('AWS_REGION');
  private readonly instanceId = envText('AWS_CONTROL_INSTANCE_ID');
  private readonly runnerPath = envText('AWS_CONTROL_RUNNER_PATH');
  private readonly workdir = envText('AWS_CONTROL_WORKDIR');
  private readonly serviceName = envText('AWS_CONTROL_SERVICE');
  private readonly documentName = envText('AWS_CONTROL_DOCUMENT') || 'AWS-RunShellScript';
  private readonly validateCommand = envText('AWS_CONTROL_VALIDATE_COMMAND') || 'npm run build';
  private readonly ledger: Ledger;
  private readonly runtime: AwsRunnerRuntime;
  private readonly requestTimeoutMs: number;
  private gates: AwsRunnerGates;
  private ssm: SSMClient | null = null;
  private sts: STSClient | null = null;
  private probeCache: { ts: number; identityArn: string | null; accountId: string | null; instanceOnline: boolean | null } | null = null;
  private lastAction: AwsRunnerActionResult | null = null;

  constructor(ledger: Ledger, options: AwsRunnerControlOptions = {}) {
    this.ledger = ledger;
    this.runtime = options.runtime ?? SYSTEM_AWS_RUNNER_RUNTIME;
    this.requestTimeoutMs = options.requestTimeoutMs ?? AWS_REQUEST_TIMEOUT_MS;
    if (typeof this.runtime.nowMs !== 'function' || typeof this.runtime.schedule !== 'function') {
      throw new TypeError('AWS runner runtime must provide nowMs and schedule');
    }
    if (!Number.isSafeInteger(this.requestTimeoutMs)
      || this.requestTimeoutMs < 1
      || this.requestTimeoutMs > AWS_REQUEST_TIMEOUT_MS) {
      throw new RangeError(`AWS request timeout must be a safe integer in [1, ${AWS_REQUEST_TIMEOUT_MS}]`);
    }
    this.gates = this.loadGates();
  }

  private now(): number {
    const value = this.runtime.nowMs();
    if (!Number.isSafeInteger(value) || value <= 0) throw new TypeError('AWS runner clock must return positive UTC milliseconds');
    return value;
  }

  private timeoutError(): AwsRunnerControlError {
    return new AwsRunnerControlError(
      504,
      'AWS_ACTION_TIMEOUT',
      'AWS action deadline expired; remote completion state is unknown.',
    );
  }

  private actionScope(timeoutMs: number): AwsActionScope {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) throw new RangeError('AWS action timeout must be positive');
    const startedAtMs = this.now();
    const deadlineAtMs = startedAtMs + timeoutMs;
    if (!Number.isSafeInteger(deadlineAtMs)) throw new RangeError('AWS action deadline overflow');
    const controller = new AbortController();
    let expired = false;
    let closed = false;
    let resolveExpired!: () => void;
    const expiredPromise = new Promise<void>((resolve) => { resolveExpired = resolve; });
    let handle: { cancel(): void };
    const expire = (): void => {
      if (expired || closed) return;
      expired = true;
      controller.abort('AWS_ACTION_TIMEOUT');
      resolveExpired();
    };
    try {
      handle = this.runtime.schedule(timeoutMs, expire);
    } catch {
      expire();
      handle = { cancel() {} };
    }
    return Object.freeze({
      signal: controller.signal,
      deadlineAtMs,
      expired: expiredPromise,
      expire,
      close: () => {
        if (closed) return;
        closed = true;
        try { handle.cancel(); } catch { /* closed action remains closed */ }
      },
      isExpired: () => expired,
    });
  }

  private async sendAws<T>(
    scope: AwsActionScope,
    invoke: (options: { abortSignal: AbortSignal; requestTimeout: number }) => Promise<T>,
  ): Promise<T> {
    const remainingMs = scope.deadlineAtMs - this.now();
    if (remainingMs <= 0 || scope.isExpired()) {
      scope.expire();
      throw this.timeoutError();
    }
    const requestTimeout = Math.min(this.requestTimeoutMs, remainingMs);
    let requestDeadline: { cancel(): void };
    try {
      requestDeadline = this.runtime.schedule(requestTimeout, () => scope.expire());
    } catch {
      scope.expire();
      throw this.timeoutError();
    }
    const work = Promise.resolve().then(() => invoke({
      abortSignal: scope.signal,
      requestTimeout,
    }));
    const outcome = await Promise.race([
      work.then(
        (value) => ({ kind: 'VALUE' as const, value }),
        (error: unknown) => ({ kind: 'ERROR' as const, error }),
      ),
      scope.expired.then(() => ({ kind: 'TIMEOUT' as const })),
    ]);
    try { requestDeadline.cancel(); } catch { /* outcome remains authoritative */ }
    if (outcome.kind === 'TIMEOUT') throw this.timeoutError();
    if (outcome.kind === 'ERROR') {
      const name = outcome.error instanceof Error ? outcome.error.name : '';
      if (scope.isExpired() || name === 'AbortError' || name === 'TimeoutError') {
        scope.expire();
        throw this.timeoutError();
      }
      throw outcome.error;
    }
    return outcome.value;
  }

  private async waitForPoll(delayMs: number, scope: AwsActionScope): Promise<void> {
    const remainingMs = scope.deadlineAtMs - this.now();
    if (remainingMs <= 0 || scope.isExpired()) {
      scope.expire();
      throw this.timeoutError();
    }
    let resolveWait!: () => void;
    const wait = new Promise<void>((resolve) => { resolveWait = resolve; });
    let handle: { cancel(): void };
    try {
      handle = this.runtime.schedule(Math.min(delayMs, remainingMs), resolveWait);
    } catch {
      scope.expire();
      throw this.timeoutError();
    }
    const outcome = await Promise.race([
      wait.then(() => 'WAITED' as const),
      scope.expired.then(() => 'TIMEOUT' as const),
    ]);
    try { handle.cancel(); } catch { /* wait outcome remains authoritative */ }
    if (outcome === 'TIMEOUT') throw this.timeoutError();
  }

  private loadGates(): AwsRunnerGates {
    const raw = this.ledger.getConfigValue(CONFIG_KEY);
    if (!raw) return { connectionEnabled: false, executionEnabled: false, updatedAt: Date.now(), updatedBy: null };
    try {
      const saved = JSON.parse(raw) as Partial<AwsRunnerGates>;
      const connectionEnabled = saved.connectionEnabled === true;
      return {
        connectionEnabled,
        executionEnabled: connectionEnabled && saved.executionEnabled === true,
        updatedAt: typeof saved.updatedAt === 'number' && Number.isSafeInteger(saved.updatedAt) && saved.updatedAt > 0
          ? saved.updatedAt
          : Date.now(),
        updatedBy: typeof saved.updatedBy === 'string'
          ? saved.updatedBy.replace(/[\r\n\0]/g, ' ').trim().slice(0, 160) || null
          : null,
      };
    } catch {
      return { connectionEnabled: false, executionEnabled: false, updatedAt: Date.now(), updatedBy: null };
    }
  }

  private missingConfig(): string[] {
    const missing: string[] = [];
    if (!/^[a-z]{2}(?:-gov)?-[a-z]+-\d$/.test(this.region)) missing.push('AWS_CONTROL_REGION');
    if (!/^i-[a-f0-9]{8,17}$/i.test(this.instanceId)) missing.push('AWS_CONTROL_INSTANCE_ID');
    if (!validRunnerPath(this.runnerPath)) missing.push('AWS_CONTROL_RUNNER_PATH');
    if (!validAbsolutePath(this.workdir)) missing.push('AWS_CONTROL_WORKDIR');
    if (!/^[A-Za-z0-9_.@-]{1,120}$/.test(this.serviceName)) missing.push('AWS_CONTROL_SERVICE');
    if (!/^[a-zA-Z0-9_\-.:/]{3,128}$/.test(this.documentName)) missing.push('AWS_CONTROL_DOCUMENT');
    if (!this.validateCommand || this.validateCommand.length > 500 || /[\r\n\0]/.test(this.validateCommand)) {
      missing.push('AWS_CONTROL_VALIDATE_COMMAND');
    }
    return missing;
  }

  configured(): boolean {
    return this.missingConfig().length === 0;
  }

  private clients(): { ssm: SSMClient; sts: STSClient } {
    if (!this.configured()) throw new AwsRunnerControlError(409, 'AWS_NOT_CONFIGURED', `Missing secure runner configuration: ${this.missingConfig().join(', ')}`);
    const requestHandler = {
      connectionTimeout: Math.min(AWS_CONNECTION_TIMEOUT_MS, this.requestTimeoutMs),
      requestTimeout: this.requestTimeoutMs,
      socketTimeout: this.requestTimeoutMs,
      throwOnRequestTimeout: true,
    };
    this.ssm ??= new SSMClient({ region: this.region, requestHandler });
    this.sts ??= new STSClient({ region: this.region, requestHandler });
    return { ssm: this.ssm, sts: this.sts };
  }

  private requireConnection(): void {
    if (!this.gates.connectionEnabled) throw new AwsRunnerControlError(423, 'AWS_CHANNEL_BLOCKED', 'AWS Channel is blocked. Enable it before contacting AWS.');
    this.clients();
  }

  private requireExecution(): void {
    this.requireConnection();
    if (!this.gates.executionEnabled) throw new AwsRunnerControlError(423, 'AWS_EXECUTION_BLOCKED', 'Runner Changes are blocked. Enable them before writing, validating, or restarting.');
  }

  setGates(patch: { connectionEnabled?: boolean; executionEnabled?: boolean }, operator: string | null): AwsRunnerGates {
    if (
      (patch.connectionEnabled !== undefined && typeof patch.connectionEnabled !== 'boolean')
      || (patch.executionEnabled !== undefined && typeof patch.executionEnabled !== 'boolean')
    ) {
      throw new AwsRunnerControlError(400, 'AWS_GATE_INPUT_INVALID', 'AWS gate values must be booleans.');
    }
    let connectionEnabled = patch.connectionEnabled ?? this.gates.connectionEnabled;
    let executionEnabled = patch.executionEnabled ?? this.gates.executionEnabled;
    if (connectionEnabled && !this.configured()) {
      throw new AwsRunnerControlError(409, 'AWS_NOT_CONFIGURED', `Missing secure runner configuration: ${this.missingConfig().join(', ')}`);
    }
    if (!connectionEnabled) executionEnabled = false;
    if (executionEnabled && !connectionEnabled) {
      throw new AwsRunnerControlError(409, 'AWS_CHANNEL_REQUIRED', 'Enable AWS Channel before Runner Changes.');
    }
    const updatedBy = typeof operator === 'string'
      ? operator.replace(/[\r\n\0]/g, ' ').trim().slice(0, 160) || null
      : null;
    const nextGates = { connectionEnabled, executionEnabled, updatedAt: Date.now(), updatedBy };
    // Persistence and audit commit together before the live gates move. If the
    // disk write fails, the running process remains in its previous state.
    this.ledger.setConfigValueAndLogEvent(
      CONFIG_KEY,
      JSON.stringify(nextGates),
      'aws_control_gate',
      null,
      { connectionEnabled, executionEnabled, operator: updatedBy },
    );
    this.gates = nextGates;
    return { ...this.gates };
  }

  async status(operatorAuthorized: boolean, operator: string | null, probe = false): Promise<AwsRunnerStatus> {
    const missing = this.missingConfig();
    let identityArn: string | null = this.probeCache?.identityArn ?? null;
    let accountId: string | null = this.probeCache?.accountId ?? null;
    let instanceOnline: boolean | null = this.probeCache?.instanceOnline ?? null;
    let channel: AwsRunnerStatus['channel'] = missing.length ? 'not_configured' : this.gates.connectionEnabled ? 'ready' : 'blocked';
    if (probe && operatorAuthorized && !missing.length && this.gates.connectionEnabled) {
      const scope = this.actionScope(AWS_PROBE_DEADLINE_MS);
      try {
        const now = this.now();
        if (!this.probeCache || now - this.probeCache.ts > 15_000) {
          const { ssm, sts } = this.clients();
          const [identityResult, instancesResult] = await Promise.allSettled([
            this.sendAws<GetCallerIdentityCommandOutput>(
              scope,
              (options) => sts.send(new GetCallerIdentityCommand({}), options),
            ),
            this.sendAws<DescribeInstanceInformationCommandOutput>(
              scope,
              (options) => ssm.send(new DescribeInstanceInformationCommand({
                Filters: [{ Key: 'InstanceIds', Values: [this.instanceId] }],
              }), options),
            ),
          ]);
          const timeoutFailure = [identityResult, instancesResult].find((result) => (
            result.status === 'rejected'
              && result.reason instanceof AwsRunnerControlError
              && result.reason.code === 'AWS_ACTION_TIMEOUT'
          ));
          if (timeoutFailure?.status === 'rejected') throw timeoutFailure.reason;
          if (identityResult.status === 'rejected') throw identityResult.reason;
          if (instancesResult.status === 'rejected') throw instancesResult.reason;
          const identity = identityResult.value;
          const instances = instancesResult.value;
          const matched = instances.InstanceInformationList?.find((item) => item.InstanceId === this.instanceId);
          this.probeCache = {
            ts: now,
            identityArn: identity.Arn ?? null,
            accountId: identity.Account ?? null,
            instanceOnline: matched ? matched.PingStatus === 'Online' : false,
          };
        }
        identityArn = this.probeCache.identityArn;
        accountId = this.probeCache.accountId;
        instanceOnline = this.probeCache.instanceOnline;
        channel = instanceOnline ? 'online' : 'offline';
      } catch (error) {
        channel = 'offline';
        instanceOnline = false;
        const detail = error instanceof AwsRunnerControlError && error.code === 'AWS_ACTION_TIMEOUT'
          ? error.code
          : safeFailureDetail(error);
        this.lastAction = {
          commandId: null,
          action: 'probe',
          status: 'Failed',
          output: '',
          error: `AWS probe failed (${detail}).`,
          startedAt: this.now(),
          finishedAt: this.now(),
        };
      } finally {
        scope.close();
      }
    }
    return {
      configured: missing.length === 0,
      missing,
      connectionEnabled: this.gates.connectionEnabled,
      executionEnabled: this.gates.executionEnabled,
      region: this.region || null,
      instanceId: this.instanceId || null,
      runnerPath: this.runnerPath || null,
      workdir: this.workdir || null,
      serviceName: this.serviceName || null,
      documentName: this.documentName,
      operatorAuthorized,
      operator,
      channel,
      identityArn,
      accountId,
      instanceOnline,
      lastProbeAt: this.probeCache?.ts ?? null,
      lastAction: this.lastAction,
      maxRunnerBytes: MAX_RUNNER_BYTES,
    };
  }

  private async runShell(action: string, script: string, timeoutSeconds = 30): Promise<AwsRunnerActionResult> {
    this.requireConnection();
    const startedAt = this.now();
    const { ssm } = this.clients();
    const remoteTimeoutSeconds = Math.max(30, Math.min(600, timeoutSeconds));
    const scope = this.actionScope(remoteTimeoutSeconds * 1_000 + AWS_ACTION_GRACE_MS);
    try {
      let sent: SendCommandCommandOutput;
      try {
        sent = await this.sendAws<SendCommandCommandOutput>(
          scope,
          (options) => ssm.send(new SendCommandCommand({
            DocumentName: this.documentName,
            InstanceIds: [this.instanceId],
            TimeoutSeconds: remoteTimeoutSeconds,
            Comment: `Cosmos runner control: ${action}`.slice(0, 100),
            // AWS-RunShellScript starts commands with /bin/sh. Pipefail is a Bash
            // feature, so invoke Bash explicitly and quote the whole script as one
            // argument instead of relying on the instance's /bin/sh implementation.
            Parameters: { commands: [`/usr/bin/env bash -lc ${shellQuote(`set -euo pipefail\n${script}`)}`] },
          }), options),
        );
      } catch (error) {
        if (error instanceof AwsRunnerControlError && error.code === 'AWS_ACTION_TIMEOUT') throw error;
        throw new AwsRunnerControlError(502, 'AWS_COMMAND_DISPATCH_FAILED', `AWS command dispatch failed (${safeFailureDetail(error)}).`);
      }
      const commandId = sent.Command?.CommandId;
      if (!commandId) throw new AwsRunnerControlError(502, 'AWS_COMMAND_ID_MISSING', 'AWS accepted no command identifier.');
      let invocation: GetCommandInvocationCommandOutput | null = null;
      let output = '';
      let error = '';
      let status = 'Pending';
      while (this.now() < scope.deadlineAtMs) {
        try {
          const result = await this.sendAws<GetCommandInvocationCommandOutput>(
            scope,
            (options) => ssm.send(new GetCommandInvocationCommand({
              CommandId: commandId,
              InstanceId: this.instanceId,
            }), options),
          );
          invocation = result;
          status = result.Status ?? 'Pending';
          output = result.StandardOutputContent ?? '';
          error = result.StandardErrorContent ?? '';
          if (TERMINAL.has(status)) break;
        } catch (pollError) {
          if (pollError instanceof AwsRunnerControlError && pollError.code === 'AWS_ACTION_TIMEOUT') throw pollError;
          const name = pollError instanceof Error ? pollError.name : '';
          if (name !== 'InvocationDoesNotExist') {
            throw new AwsRunnerControlError(502, 'AWS_COMMAND_POLL_FAILED', `AWS command status failed (${safeFailureDetail(pollError)}).`);
          }
        }
        await this.waitForPoll(650, scope);
      }
      if (scope.isExpired()) throw this.timeoutError();
      if (!invocation || !TERMINAL.has(status)) status = 'TimedOut';
      const rawOutputBytes = Buffer.byteLength(output, 'utf8');
      const result: AwsRunnerActionResult = {
        commandId,
        action,
        status,
        output: action === 'read_runner'
          ? rawOutputBytes <= MAX_COMMAND_OUTPUT_BYTES ? output : ''
          : redactText(output),
        error: redactText(error),
        startedAt,
        finishedAt: this.now(),
      };
      this.lastAction = publicActionResult(result);
      this.ledger.logEvent('aws_runner_action', null, {
        action,
        commandId,
        status,
        outputBytes: Buffer.byteLength(output),
        error: redactText(error, 800),
      });
      return result;
    } finally {
      scope.close();
    }
  }

  async runCommand(input: string): Promise<AwsRunnerActionResult> {
    const command = input.trim().toLowerCase().replace(/\s+/g, ' ');
    if (!command || command === 'help') {
      const now = Date.now();
      return {
        commandId: null,
        action: 'help',
        status: 'Success',
        output: 'Allowed commands:\nstatus   service state\nlogs     last 160 service lines\nread     load configured runner file\nvalidate build configured worktree\nrestart  restart configured service',
        error: '',
        startedAt: now,
        finishedAt: now,
      };
    }
    if (command === 'status') {
      return this.runShell('status', `systemctl is-active -- ${shellQuote(this.serviceName)} || true`);
    }
    if (command === 'logs') {
      return this.runShell('logs', `journalctl -u ${shellQuote(this.serviceName)} -n 160 --no-pager --output=short-iso`, 45);
    }
    if (command === 'read') {
      const file = await this.readRunner();
      const now = Date.now();
      return { commandId: null, action: 'read', status: 'Success', output: `${file.path}\n${file.bytes} bytes\nsha256 ${file.sha256}`, error: '', startedAt: now, finishedAt: now };
    }
    if (command === 'validate' || command === 'build') {
      this.requireExecution();
      return this.runShell('validate', `cd -- ${shellQuote(this.workdir)}\n${this.validateCommand}`, 300);
    }
    if (command === 'restart') {
      this.requireExecution();
      return this.runShell('restart', `systemctl restart -- ${shellQuote(this.serviceName)}\nsystemctl is-active -- ${shellQuote(this.serviceName)}`, 90);
    }
    throw new AwsRunnerControlError(400, 'AWS_COMMAND_NOT_ALLOWED', 'Command is not in the restricted runner command map. Use help.');
  }

  async readRunner(): Promise<AwsRunnerFile> {
    this.requireConnection();
    const path = shellQuote(this.runnerPath);
    const result = await this.runShell(
      'read_runner',
      `test -f ${path}\nbytes=$(wc -c < ${path})\nif [ "$bytes" -gt ${MAX_RUNNER_BYTES} ]; then echo "Runner file exceeds ${MAX_RUNNER_BYTES} bytes" >&2; exit 65; fi\nbase64 < ${path} | tr -d '\\n'`,
      45,
    );
    if (result.status !== 'Success') {
      throw new AwsRunnerControlError(502, 'AWS_RUNNER_READ_FAILED', `Runner read command failed (${result.status}).`);
    }
    const encoded = result.output.trim();
    if (encoded.length > Math.ceil(MAX_RUNNER_BYTES / 3) * 4 + 4) {
      throw new AwsRunnerControlError(502, 'AWS_RUNNER_DECODE_FAILED', 'AWS returned an invalid runner payload.');
    }
    const decoded = strictBase64(encoded);
    if (!decoded || decoded.length > MAX_RUNNER_BYTES) {
      throw new AwsRunnerControlError(502, 'AWS_RUNNER_DECODE_FAILED', 'AWS returned an invalid runner payload.');
    }
    let content: string;
    try {
      content = new TextDecoder('utf-8', { fatal: true }).decode(decoded);
    } catch {
      throw new AwsRunnerControlError(502, 'AWS_RUNNER_DECODE_FAILED', 'AWS returned an invalid UTF-8 runner payload.');
    }
    return { path: this.runnerPath, content, sha256: sha256(content), bytes: Buffer.byteLength(content), fetchedAt: Date.now() };
  }

  async saveRunner(content: string, expectedSha256: string | null): Promise<AwsRunnerFile> {
    this.requireExecution();
    const bytes = Buffer.byteLength(content, 'utf8');
    if (bytes === 0) throw new AwsRunnerControlError(400, 'AWS_RUNNER_EMPTY', 'Runner content must not be empty.');
    if (bytes > MAX_RUNNER_BYTES) throw new AwsRunnerControlError(413, 'AWS_RUNNER_TOO_LARGE', `Runner file exceeds ${MAX_RUNNER_BYTES} bytes.`);
    if (content.includes('\0')) throw new AwsRunnerControlError(400, 'AWS_RUNNER_BINARY_REJECTED', 'Runner content must be UTF-8 source text.');
    if (containsSecretMaterial(content)) throw new AwsRunnerControlError(400, 'AWS_RUNNER_SECRET_REJECTED', 'Runner content appears to contain secret material. Keep secrets in AWS Secrets Manager or Parameter Store.');
    if (expectedSha256 !== null && !/^[a-f0-9]{64}$/.test(expectedSha256)) {
      throw new AwsRunnerControlError(400, 'AWS_RUNNER_HASH_INVALID', 'Expected runner SHA-256 must be 64 lowercase hexadecimal characters.');
    }
    const encoded = Buffer.from(content, 'utf8').toString('base64');
    const target = shellQuote(this.runnerPath);
    const workdir = shellQuote(this.workdir);
    const payload = shellQuote(encoded);
    const nextSha256 = sha256(content);
    const expected = shellQuote(expectedSha256 ?? '');
    const result = await this.runShell(
      'save_runner',
      `target=${target}
workdir=${workdir}
expected=${expected}
payload=${payload}
next_sha=${shellQuote(nextSha256)}
had_target=0
promoted=0
rollback="${this.runnerPath}.cosmos-rollback-$$"
durable_backup="${this.runnerPath}.cosmos-backup"
backup_stage="${this.runnerPath}.cosmos-backup-stage-$$"
case "$target" in
  *.ts) stage="${this.runnerPath}.cosmos-stage-$$.ts" ;;
  *.mjs) stage="${this.runnerPath}.cosmos-stage-$$.mjs" ;;
  *.cjs) stage="${this.runnerPath}.cosmos-stage-$$.cjs" ;;
  *.js) stage="${this.runnerPath}.cosmos-stage-$$.js" ;;
  *.json) stage="${this.runnerPath}.cosmos-stage-$$.json" ;;
  *.bash) stage="${this.runnerPath}.cosmos-stage-$$.bash" ;;
  *.sh) stage="${this.runnerPath}.cosmos-stage-$$.sh" ;;
  *.py) stage="${this.runnerPath}.cosmos-stage-$$.py" ;;
  *) echo 'Unsupported runner source type' >&2; exit 64 ;;
esac
cleanup() {
  code=$?
  trap - EXIT HUP INT TERM
  rm -f -- "$stage"
  if [ "$promoted" -eq 1 ]; then
    if [ "$had_target" -eq 1 ] && [ -f "$rollback" ]; then
      mv -f -- "$rollback" "$target"
    else
      rm -f -- "$target"
    fi
  fi
  rm -f -- "$rollback"
  rm -f -- "$backup_stage"
  exit "$code"
}
trap cleanup EXIT HUP INT TERM
printf %s "$payload" | base64 --decode > "$stage"
test "$(wc -c < "$stage")" -eq ${bytes}
test "$(sha256sum "$stage" | awk '{print $1}')" = "$next_sha"
case "$stage" in
  *.ts)
    test -x "$workdir/node_modules/.bin/tsc"
    "$workdir/node_modules/.bin/tsc" --pretty false --noEmit --skipLibCheck --target ES2022 --module NodeNext --moduleResolution NodeNext "$stage"
    ;;
  *.js|*.mjs|*.cjs) node --check "$stage" ;;
  *.json) node -e 'JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"))' "$stage" ;;
  *.sh|*.bash) bash -n "$stage" ;;
  *.py) python3 -c 'import pathlib,sys; compile(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"), sys.argv[1], "exec")' "$stage" ;;
esac
if [ -e "$target" ]; then
  test -f "$target"
  had_target=1
  cp -p -- "$target" "$rollback"
  chmod --reference="$target" "$stage"
  chown --reference="$target" "$stage"
elif [ -n "$expected" ]; then
  echo 'Runner changed after it was loaded' >&2
  exit 73
fi
if [ -n "$expected" ]; then
  test "$(sha256sum "$target" | awk '{print $1}')" = "$expected" || { echo 'Runner changed after it was loaded' >&2; exit 73; }
fi
mv -f -- "$stage" "$target"
promoted=1
if ! (cd -- "$workdir" && ${this.validateCommand}); then
  echo 'Configured validation failed; original runner restored' >&2
  exit 65
fi
test "$(sha256sum "$target" | awk '{print $1}')" = "$next_sha"
if [ "$had_target" -eq 1 ]; then
  cp -p -- "$rollback" "$backup_stage"
  mv -f -- "$backup_stage" "$durable_backup"
fi
promoted=0
rm -f -- "$rollback"
trap - EXIT HUP INT TERM
rm -f -- "$stage"`,
      360,
    );
    if (result.status !== 'Success') {
      const conflict = /Runner changed after it was loaded/.test(result.error);
      throw new AwsRunnerControlError(
        conflict ? 409 : 502,
        conflict ? 'AWS_RUNNER_CONFLICT' : 'AWS_RUNNER_SAVE_FAILED',
        conflict ? 'Runner changed after it was loaded. Reload before saving.' : `Runner save and validation failed (${result.status}); the previous source was restored.`,
      );
    }
    this.ledger.logEvent('aws_runner_save', null, { path: this.runnerPath, bytes, sha256: nextSha256 });
    return { path: this.runnerPath, content, sha256: nextSha256, bytes, fetchedAt: Date.now() };
  }
}
