import { useCallback, useEffect, useMemo, useState } from 'react';
import { IconClose, IconExternal, IconReceipt, IconRefresh, IconShield, IconTerminal } from './Icons';

export const AWS_RUNNER_MARK = '/aws-runner-cloud.png';
export const AWS_CONSOLE_URL = 'https://console.aws.amazon.com/systems-manager/session-manager/sessions';
export const AWS_CONTROL_HEADERS = { 'Content-Type': 'application/json', 'X-Cosmos-Control': 'aws-runner' } as const;

export interface AwsRunnerActionResult {
  commandId: string | null;
  action: string;
  status: string;
  output: string;
  error: string;
  startedAt: number;
  finishedAt: number;
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
  authorizationReason?: string | null;
  channel: 'blocked' | 'not_configured' | 'ready' | 'online' | 'offline';
  identityArn: string | null;
  accountId: string | null;
  instanceOnline: boolean | null;
  lastProbeAt: number | null;
  lastAction: AwsRunnerActionResult | null;
  maxRunnerBytes: number;
}

interface AwsRunnerFile {
  path: string;
  content: string;
  sha256: string;
  bytes: number;
  fetchedAt: number;
}

interface ConsoleEntry {
  id: number;
  command: string;
  result: AwsRunnerActionResult;
}

async function awsRequest<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { ...AWS_CONTROL_HEADERS, ...(init.headers ?? {}) },
  });
  const payload = await response.json().catch(() => null) as (T & { error?: string }) | null;
  if (!response.ok || !payload) throw new Error(payload?.error || `AWS control request failed (${response.status}).`);
  return payload;
}

export async function fetchAwsRunnerStatus(probe = false): Promise<AwsRunnerStatus> {
  const payload = await awsRequest<{ status: AwsRunnerStatus; authorizationReason?: string | null }>(`/api/aws-control/status${probe ? '?probe=1' : ''}`);
  return { ...payload.status, authorizationReason: payload.authorizationReason ?? null };
}

export async function updateAwsRunnerGates(patch: Partial<Pick<AwsRunnerStatus, 'connectionEnabled' | 'executionEnabled'>>): Promise<void> {
  await awsRequest('/api/aws-control/gates', { method: 'POST', body: JSON.stringify(patch) });
}

function channelLabel(status: AwsRunnerStatus | null): string {
  if (!status) return 'Checking';
  if (!status.configured) return 'Not configured';
  if (!status.connectionEnabled) return 'Blocked';
  if (status.channel === 'online') return 'Online';
  if (status.channel === 'offline') return 'Offline';
  return 'Ready';
}

function actionOutput(result: AwsRunnerActionResult): string {
  const body = [result.output.trim(), result.error.trim()].filter(Boolean).join('\n');
  return body || `${result.action} finished with ${result.status}.`;
}

export function AwsRunnerModal({ onClose }: { onClose: () => void }) {
  const [status, setStatus] = useState<AwsRunnerStatus | null>(null);
  const [tab, setTab] = useState<'console' | 'runner'>('console');
  const [command, setCommand] = useState('status');
  const [consoleEntries, setConsoleEntries] = useState<ConsoleEntry[]>([]);
  const [runner, setRunner] = useState<AwsRunnerFile | null>(null);
  const [runnerDraft, setRunnerDraft] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refreshStatus = useCallback(async (probe = false) => {
    try {
      const next = await fetchAwsRunnerStatus(probe);
      setStatus(next);
      setError(null);
      return next;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return null;
    }
  }, []);

  useEffect(() => { void refreshStatus(true); }, [refreshStatus]);

  const toggleGate = async (key: 'connectionEnabled' | 'executionEnabled') => {
    if (!status || busy) return;
    setBusy(key);
    setError(null);
    try {
      await updateAwsRunnerGates({ [key]: !status[key] });
      await refreshStatus(key === 'connectionEnabled' && !status.connectionEnabled);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const runCommand = async (nextCommand = command) => {
    const clean = nextCommand.trim();
    if (!clean || busy) return;
    setBusy('command');
    setError(null);
    try {
      const payload = await awsRequest<{ result: AwsRunnerActionResult }>('/api/aws-control/command', {
        method: 'POST',
        body: JSON.stringify({ command: clean }),
      });
      setConsoleEntries((rows) => [...rows, { id: Date.now(), command: clean, result: payload.result }].slice(-12));
      setCommand('');
      await refreshStatus(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const loadRunner = async () => {
    if (busy) return;
    setBusy('load');
    setError(null);
    try {
      const payload = await awsRequest<{ file: AwsRunnerFile }>('/api/aws-control/runner');
      setRunner(payload.file);
      setRunnerDraft(payload.file.content);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const saveRunner = async () => {
    if (!runner || busy) return;
    setBusy('save');
    setError(null);
    try {
      await awsRequest('/api/aws-control/runner', {
        method: 'PUT',
        body: JSON.stringify({ content: runnerDraft, expectedSha256: runner.sha256 }),
      });
      setBusy(null);
      await loadRunner();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(null);
    }
  };

  const commandMap = useMemo(() => ['status', 'logs', 'validate', 'restart', 'help'], []);
  const configured = status?.configured === true;
  const authorized = status?.operatorAuthorized === true;
  const channelOn = status?.connectionEnabled === true;
  const changesOn = status?.executionEnabled === true;
  const dirty = !!runner && runnerDraft !== runner.content;

  return (
    <div className="ov-backdrop" onMouseDown={onClose}>
      <div className="ov-modal aws-runner-modal" onMouseDown={(event) => event.stopPropagation()}>
        <header className="aws-runner-head">
          <img src={AWS_RUNNER_MARK} alt="" />
          <span className="aws-runner-head-copy">
            <b>AWS Runner Control</b>
            <em>Restricted Systems Manager channel</em>
          </span>
          <span className={`aws-runner-channel ${status?.channel ?? 'blocked'}`}><i />{channelLabel(status)}</span>
          <a href={AWS_CONSOLE_URL} target="_blank" rel="noreferrer noopener"><IconExternal size={14} />AWS Console</a>
          <button type="button" className="close" onClick={onClose} aria-label="Close AWS Runner Control"><IconClose size={17} /></button>
        </header>

        <div className="aws-runner-body">
          <main className="aws-runner-workspace">
            <div className="aws-runner-tabs" role="tablist" aria-label="AWS Runner workspace">
              <button type="button" role="tab" aria-selected={tab === 'console'} className={tab === 'console' ? 'on' : ''} onClick={() => setTab('console')}><IconTerminal size={15} />Console</button>
              <button type="button" role="tab" aria-selected={tab === 'runner'} className={tab === 'runner' ? 'on' : ''} onClick={() => setTab('runner')}><IconReceipt size={15} />Runner File</button>
              <span>{status?.serviceName ?? 'Service not configured'}</span>
            </div>

            {tab === 'console' ? (
              <section className="aws-console-panel" role="tabpanel" aria-label="Restricted AWS runner console">
                <div className="aws-console-output" aria-live="polite">
                  {consoleEntries.length === 0 ? (
                    <div className="aws-console-empty"><IconShield size={20} /><b>No command has run.</b><em>Use help to inspect the restricted command map. Arbitrary shell commands are rejected.</em></div>
                  ) : consoleEntries.map((entry) => (
                    <article key={entry.id} className={`aws-console-entry ${entry.result.status.toLowerCase()}`}>
                      <header><span>$ {entry.command}</span><em>{entry.result.status}</em></header>
                      <pre>{actionOutput(entry.result)}</pre>
                    </article>
                  ))}
                </div>
                <div className="aws-command-map" aria-label="Allowed runner commands">
                  {commandMap.map((item) => <button type="button" key={item} onClick={() => setCommand(item)}>{item}</button>)}
                </div>
                <form className="aws-command-line" onSubmit={(event) => { event.preventDefault(); void runCommand(); }}>
                  <span>runner$</span>
                  <input value={command} onChange={(event) => setCommand(event.target.value)} placeholder="status | logs | validate | restart | help" spellCheck={false} aria-label="Restricted runner command" />
                  <button type="submit" disabled={!!busy || (!channelOn && command.trim().toLowerCase() !== 'help')}>{busy === 'command' ? 'Running…' : 'Run'}</button>
                </form>
              </section>
            ) : (
              <section className="aws-runner-editor" role="tabpanel" aria-label="AWS runner file editor">
                <div className="aws-editor-toolbar">
                  <span><b>{runner?.path ?? status?.runnerPath ?? 'Runner path not configured'}</b><em>{runner ? `${runner.bytes} bytes · ${runner.sha256.slice(0, 10)}` : `Maximum ${status?.maxRunnerBytes ?? 16_000} bytes`}</em></span>
                  <button type="button" onClick={() => { void loadRunner(); }} disabled={!channelOn || !!busy}><IconRefresh size={14} />{busy === 'load' ? 'Loading…' : 'Load'}</button>
                  <button type="button" className="primary" onClick={() => { void saveRunner(); }} disabled={!changesOn || !dirty || !!busy}>{busy === 'save' ? 'Saving…' : 'Save Runner'}</button>
                </div>
                <textarea value={runnerDraft} onChange={(event) => setRunnerDraft(event.target.value)} disabled={!runner} spellCheck={false} aria-label="Runner file content" placeholder={channelOn ? 'Load the configured runner file to edit it.' : 'Enable AWS Channel before loading the runner.'} />
                <footer><IconShield size={14} /><span>Atomic save with conflict detection and backup. Secret-looking material is rejected; keep credentials in Secrets Manager or Parameter Store.</span></footer>
              </section>
            )}
          </main>

          <aside className="aws-runner-side" aria-label="AWS secure channel controls">
            <section className="aws-security-card">
              <header><span><IconShield size={17} />Security Gates</span><em>{authorized ? 'Operator verified' : 'Operator blocked'}</em></header>
              <button type="button" role="switch" aria-checked={channelOn} className={channelOn ? 'on' : ''} onClick={() => { void toggleGate('connectionEnabled'); }} disabled={!configured || !authorized || !!busy}>
                <span><b>AWS Channel</b><em>Block or allow every website-to-AWS control request.</em></span><i><span /></i>
              </button>
              <button type="button" role="switch" aria-checked={changesOn} className={changesOn ? 'on' : ''} onClick={() => { void toggleGate('executionEnabled'); }} disabled={!channelOn || !authorized || !!busy}>
                <span><b>Runner Changes</b><em>Write, validate, and restart the configured runner.</em></span><i><span /></i>
              </button>
            </section>

            <section className="aws-target-card">
              <header><span>Secure Target</span><button type="button" onClick={() => { void refreshStatus(true); }} disabled={!!busy}><IconRefresh size={13} />Probe</button></header>
              <dl>
                <div><dt>Region</dt><dd>{status?.region ?? 'Not configured'}</dd></div>
                <div><dt>Instance</dt><dd>{status?.instanceId ?? 'Not configured'}</dd></div>
                <div><dt>Service</dt><dd>{status?.serviceName ?? 'Not configured'}</dd></div>
                <div><dt>Identity</dt><dd>{status?.identityArn ? status.identityArn.split('/').pop() : 'Not verified'}</dd></div>
                <div><dt>Transport</dt><dd>SSM Run Command</dd></div>
                <div><dt>Document</dt><dd>{status?.documentName ?? 'AWS-RunShellScript'}</dd></div>
              </dl>
              {!configured && <div className="aws-config-missing"><b>Configuration required</b><span>{status?.missing.join(' · ') || 'Loading target requirements…'}</span></div>}
              {configured && !authorized && <div className="aws-config-missing"><b>Operator blocked</b><span>{status?.authorizationReason ?? 'Verified operator access is required.'}</span></div>}
            </section>

            {error && <div className="aws-runner-error" role="alert">{error}</div>}
          </aside>
        </div>
      </div>
    </div>
  );
}
