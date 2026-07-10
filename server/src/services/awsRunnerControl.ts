import { createHash } from 'node:crypto';
import {
  DescribeInstanceInformationCommand,
  GetCommandInvocationCommand,
  SendCommandCommand,
  SSMClient,
  type GetCommandInvocationCommandOutput,
} from '@aws-sdk/client-ssm';
import { GetCallerIdentityCommand, STSClient } from '@aws-sdk/client-sts';
import type { Ledger } from '../ledger.js';

const CONFIG_KEY = 'aws-runner-control';
const MAX_RUNNER_BYTES = 16_000;
const TERMINAL = new Set(['Success', 'Cancelled', 'TimedOut', 'Failed', 'Cancelling']);

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

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function containsSecretMaterial(value: string): boolean {
  return /(?:AWS_SECRET_ACCESS_KEY|BINANCE_(?:API_)?SECRET|-----BEGIN [A-Z ]*PRIVATE KEY-----|apiSecret\s*[:=])/i.test(value);
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
  private gates: AwsRunnerGates;
  private ssm: SSMClient | null = null;
  private sts: STSClient | null = null;
  private probeCache: { ts: number; identityArn: string | null; accountId: string | null; instanceOnline: boolean | null } | null = null;
  private lastAction: AwsRunnerActionResult | null = null;

  constructor(ledger: Ledger) {
    this.ledger = ledger;
    this.gates = this.loadGates();
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
        updatedAt: typeof saved.updatedAt === 'number' ? saved.updatedAt : Date.now(),
        updatedBy: typeof saved.updatedBy === 'string' ? saved.updatedBy : null,
      };
    } catch {
      return { connectionEnabled: false, executionEnabled: false, updatedAt: Date.now(), updatedBy: null };
    }
  }

  private missingConfig(): string[] {
    const missing: string[] = [];
    if (!/^[a-z]{2}(?:-gov)?-[a-z]+-\d$/.test(this.region)) missing.push('AWS_CONTROL_REGION');
    if (!/^i-[a-f0-9]{8,17}$/i.test(this.instanceId)) missing.push('AWS_CONTROL_INSTANCE_ID');
    if (!validAbsolutePath(this.runnerPath)) missing.push('AWS_CONTROL_RUNNER_PATH');
    if (!validAbsolutePath(this.workdir)) missing.push('AWS_CONTROL_WORKDIR');
    if (!/^[A-Za-z0-9_.@-]{1,120}$/.test(this.serviceName)) missing.push('AWS_CONTROL_SERVICE');
    if (!/^[a-zA-Z0-9_\-.:/]{3,128}$/.test(this.documentName)) missing.push('AWS_CONTROL_DOCUMENT');
    return missing;
  }

  configured(): boolean {
    return this.missingConfig().length === 0;
  }

  private clients(): { ssm: SSMClient; sts: STSClient } {
    if (!this.configured()) throw new AwsRunnerControlError(409, 'AWS_NOT_CONFIGURED', `Missing secure runner configuration: ${this.missingConfig().join(', ')}`);
    this.ssm ??= new SSMClient({ region: this.region });
    this.sts ??= new STSClient({ region: this.region });
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
    let connectionEnabled = patch.connectionEnabled ?? this.gates.connectionEnabled;
    let executionEnabled = patch.executionEnabled ?? this.gates.executionEnabled;
    if (connectionEnabled && !this.configured()) {
      throw new AwsRunnerControlError(409, 'AWS_NOT_CONFIGURED', `Missing secure runner configuration: ${this.missingConfig().join(', ')}`);
    }
    if (!connectionEnabled) executionEnabled = false;
    if (executionEnabled && !connectionEnabled) {
      throw new AwsRunnerControlError(409, 'AWS_CHANNEL_REQUIRED', 'Enable AWS Channel before Runner Changes.');
    }
    this.gates = { connectionEnabled, executionEnabled, updatedAt: Date.now(), updatedBy: operator };
    this.ledger.setConfigValue(CONFIG_KEY, JSON.stringify(this.gates));
    this.ledger.logEvent('aws_control_gate', null, { connectionEnabled, executionEnabled, operator });
    return this.gates;
  }

  async status(operatorAuthorized: boolean, operator: string | null, probe = false): Promise<AwsRunnerStatus> {
    const missing = this.missingConfig();
    let identityArn: string | null = this.probeCache?.identityArn ?? null;
    let accountId: string | null = this.probeCache?.accountId ?? null;
    let instanceOnline: boolean | null = this.probeCache?.instanceOnline ?? null;
    let channel: AwsRunnerStatus['channel'] = missing.length ? 'not_configured' : this.gates.connectionEnabled ? 'ready' : 'blocked';
    if (probe && operatorAuthorized && !missing.length && this.gates.connectionEnabled) {
      try {
        const now = Date.now();
        if (!this.probeCache || now - this.probeCache.ts > 15_000) {
          const { ssm, sts } = this.clients();
          const [identity, instances] = await Promise.all([
            sts.send(new GetCallerIdentityCommand({})),
            ssm.send(new DescribeInstanceInformationCommand({ Filters: [{ Key: 'InstanceIds', Values: [this.instanceId] }] })),
          ]);
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
        this.lastAction = {
          commandId: null,
          action: 'probe',
          status: 'Failed',
          output: '',
          error: error instanceof Error ? error.message : String(error),
          startedAt: Date.now(),
          finishedAt: Date.now(),
        };
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
    const startedAt = Date.now();
    const { ssm } = this.clients();
    const sent = await ssm.send(new SendCommandCommand({
      DocumentName: this.documentName,
      InstanceIds: [this.instanceId],
      TimeoutSeconds: Math.max(30, Math.min(600, timeoutSeconds)),
      Comment: `Cosmos runner control: ${action}`.slice(0, 100),
      Parameters: { commands: [`set -euo pipefail\n${script}`] },
    }));
    const commandId = sent.Command?.CommandId;
    if (!commandId) throw new AwsRunnerControlError(502, 'AWS_COMMAND_ID_MISSING', 'AWS accepted no command identifier.');
    const deadline = Date.now() + (timeoutSeconds + 20) * 1000;
    let invocation: GetCommandInvocationCommandOutput | null = null;
    let output = '';
    let error = '';
    let status = 'Pending';
    while (Date.now() < deadline) {
      try {
        const result = await ssm.send(new GetCommandInvocationCommand({ CommandId: commandId, InstanceId: this.instanceId }));
        invocation = result;
        status = result.Status ?? 'Pending';
        output = result.StandardOutputContent ?? '';
        error = result.StandardErrorContent ?? '';
        if (TERMINAL.has(status)) break;
      } catch (pollError) {
        const name = pollError instanceof Error ? pollError.name : '';
        if (name !== 'InvocationDoesNotExist') throw pollError;
      }
      await sleep(650);
    }
    if (!invocation || !TERMINAL.has(status)) status = 'TimedOut';
    const result: AwsRunnerActionResult = { commandId, action, status, output, error, startedAt, finishedAt: Date.now() };
    this.lastAction = result;
    this.ledger.logEvent('aws_runner_action', null, {
      action,
      commandId,
      status,
      outputBytes: Buffer.byteLength(output),
      error: error.slice(0, 800),
    });
    return result;
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
    if (result.status !== 'Success') throw new AwsRunnerControlError(502, 'AWS_RUNNER_READ_FAILED', result.error || `Runner read finished with ${result.status}.`);
    let content = '';
    try {
      content = Buffer.from(result.output.trim(), 'base64').toString('utf8');
    } catch {
      throw new AwsRunnerControlError(502, 'AWS_RUNNER_DECODE_FAILED', 'AWS returned runner content that could not be decoded.');
    }
    return { path: this.runnerPath, content, sha256: sha256(content), bytes: Buffer.byteLength(content), fetchedAt: Date.now() };
  }

  async saveRunner(content: string, expectedSha256: string | null): Promise<AwsRunnerFile> {
    this.requireExecution();
    const bytes = Buffer.byteLength(content, 'utf8');
    if (bytes > MAX_RUNNER_BYTES) throw new AwsRunnerControlError(413, 'AWS_RUNNER_TOO_LARGE', `Runner file exceeds ${MAX_RUNNER_BYTES} bytes.`);
    if (containsSecretMaterial(content)) throw new AwsRunnerControlError(400, 'AWS_RUNNER_SECRET_REJECTED', 'Runner content appears to contain secret material. Keep secrets in AWS Secrets Manager or Parameter Store.');
    if (expectedSha256) {
      const current = await this.readRunner();
      if (current.sha256 !== expectedSha256) throw new AwsRunnerControlError(409, 'AWS_RUNNER_CONFLICT', 'Runner changed after it was loaded. Reload before saving.');
    }
    const encoded = Buffer.from(content, 'utf8').toString('base64');
    const target = shellQuote(this.runnerPath);
    const payload = shellQuote(encoded);
    const result = await this.runShell(
      'save_runner',
      `target=${target}\ntmp="${this.runnerPath}.cosmos-$$"\nprintf %s ${payload} | base64 --decode > "$tmp"\ntest "$(wc -c < "$tmp")" -le ${MAX_RUNNER_BYTES}\nif [ -e "$target" ]; then cp -p -- "$target" "$target.cosmos-backup"; chmod --reference="$target" "$tmp"; chown --reference="$target" "$tmp"; fi\nmv -f -- "$tmp" "$target"`,
      60,
    );
    if (result.status !== 'Success') throw new AwsRunnerControlError(502, 'AWS_RUNNER_SAVE_FAILED', result.error || `Runner save finished with ${result.status}.`);
    this.ledger.logEvent('aws_runner_save', null, { path: this.runnerPath, bytes, sha256: sha256(content) });
    return { path: this.runnerPath, content, sha256: sha256(content), bytes, fetchedAt: Date.now() };
  }
}
