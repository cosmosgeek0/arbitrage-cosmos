#!/usr/bin/env node
import { readFileSync } from 'node:fs';

const [configPath, command, unit, noPager, all, ...propertyArguments] = process.argv.slice(2);
if (command !== 'show' || noPager !== '--no-pager' || all !== '--all'
    || !propertyArguments.every((argument) => argument.startsWith('--property='))) {
  process.exit(91);
}
const config = JSON.parse(readFileSync(configPath, 'utf8'));
const properties = propertyArguments.map((argument) => argument.slice('--property='.length));
const values = Object.fromEntries(properties.map((property) => [property, '']));
const execRecord = (path, argv, extended = false) => [
  `{ path=${path} ; argv[]=${argv.join(' ')} ; `,
  extended ? 'flags=' : 'ignore_errors=no',
  ' ; start_time=[n/a] ; stop_time=[n/a] ; pid=0 ; code=(null) ; status=0/0 }',
].join('');

if (unit === 'cosmos-app.service') {
  Object.assign(values, {
    Id: unit,
    Names: unit,
    Following: '',
    LoadState: 'loaded',
    FragmentPath: config.appFragment,
    DropInPaths: `${config.runtimeDropIn} ${config.providerDropIn} ${config.loggingDropIn}`,
    NeedDaemonReload: 'no',
    Requires: 'cosmos-secrets-provider.service',
    Wants: 'network-online.target',
    After: 'network-online.target cosmos-secrets-provider.service',
    DefaultDependencies: 'yes',
    SuccessAction: 'none',
    FailureAction: 'none',
    JobTimeoutAction: 'none',
    StartLimitAction: 'none',
    User: 'cosmos',
    Group: 'cosmos',
    WorkingDirectory: '/opt/cosmos/current',
    UnsetEnvironment: config.unsetEnvironment,
    LoadCredential: 'app-secrets:/run/cosmos-secret-source/app-secrets.json',
    DynamicUser: 'no',
    NoNewPrivileges: 'yes',
    RootDirectoryStartOnly: 'no',
    Type: 'simple',
    StandardInput: 'null',
    StandardOutput: 'journal',
    StandardError: 'journal',
    NotifyAccess: 'none',
    FileDescriptorStoreMax: '0',
    FileDescriptorStorePreserve: 'no',
    RuntimeDirectory: 'cosmos-app',
    RuntimeDirectoryMode: '700',
    RuntimeDirectoryPreserve: 'restart',
    ReadWritePaths: '/var/lib/cosmos /run/cosmos-app',
    ExecStart: execRecord(config.env, [
      config.env,
      'DATA_DIR_LOGICAL_LEASE_ROOT=/run/cosmos-app/data-dir-leases',
      config.node,
      config.opsHelperAppEntrypoint,
    ]),
    ExecStartEx: execRecord(config.env, [
      config.env,
      'DATA_DIR_LOGICAL_LEASE_ROOT=/run/cosmos-app/data-dir-leases',
      config.node,
      config.opsHelperAppEntrypoint,
    ], true),
  });
  if (config.mode === 'app-missing-requires') values.Requires = '';
  if (config.mode === 'app-missing-after') values.After = 'network-online.target';
  if (config.mode === 'app-wrong-credential') {
    values.LoadCredential = 'app-secrets:/run/cosmos-secret-source/other.json';
  }
  if (config.mode === 'app-stale') values.NeedDaemonReload = 'yes';
  if (config.mode === 'app-extra-provider-edge') values.PartOf = 'cosmos-secrets-provider.service';
  if (config.mode === 'app-extra-drop-in') {
    values.DropInPaths = `${values.DropInPaths} ${config.extraDropIn}`;
  }
} else if (unit === 'cosmos-secrets-provider.service') {
  const providerArgv = [
    '/usr/bin/node',
    config.opsHelperSecretMaterialization,
    '--authorization',
    '/etc/cosmos/external-authorization.json',
    '--deployment-risk',
    config.deploymentRisk,
    '--action-preview',
    config.actionPreview,
    '--authorization-consumption-root',
    '/var/lib/cosmos-authorization-consumption',
  ];
  Object.assign(values, {
    Id: unit,
    Names: unit,
    Following: '',
    LoadState: 'loaded',
    FragmentPath: config.providerFragment,
    DropInPaths: '',
    NeedDaemonReload: 'no',
    Wants: 'network-online.target',
    After: 'network-online.target',
    Before: 'cosmos-app.service',
    DefaultDependencies: 'yes',
    SuccessAction: 'none',
    FailureAction: 'none',
    JobTimeoutAction: 'none',
    StartLimitAction: 'none',
    User: 'root',
    Group: 'root',
    WorkingDirectory: '',
    UnsetEnvironment: config.unsetEnvironment,
    DynamicUser: 'no',
    NoNewPrivileges: 'yes',
    RootDirectoryStartOnly: 'no',
    Type: 'oneshot',
    StandardInput: 'null',
    StandardOutput: 'journal',
    StandardError: 'journal',
    NotifyAccess: 'none',
    FileDescriptorStoreMax: '0',
    FileDescriptorStorePreserve: 'no',
    RuntimeDirectory: 'cosmos-secret-source',
    RuntimeDirectoryMode: '700',
    RuntimeDirectoryPreserve: 'restart',
    ReadWritePaths: readFileSync(config.providerFragment, 'utf8')
      .split('\n')
      .filter((line) => line.startsWith('ReadWritePaths='))
      .map((line) => line.slice('ReadWritePaths='.length))
      .join(' '),
    ReadOnlyPaths: [
      '/var/lib/cosmos-deployment-authorization',
      '/etc/cosmos',
      '/usr/local/lib/cosmos-ops',
    ].join(' '),
    ExecStart: execRecord('/usr/bin/node', providerArgv),
    ExecStartEx: execRecord('/usr/bin/node', providerArgv, true),
    RemainAfterExit: 'yes',
    Restart: 'no',
    SyslogIdentifier: 'cosmos-secrets-provider',
    ProtectSystem: 'strict',
    ProtectHome: 'yes',
    PrivateTmp: 'yes',
    PrivateDevices: 'yes',
    ProtectKernelTunables: 'yes',
    ProtectKernelModules: 'yes',
    ProtectControlGroups: 'yes',
    RestrictSUIDSGID: 'yes',
    RestrictAddressFamilies: 'AF_UNIX AF_INET AF_INET6',
    UMask: '0077',
    ActiveState: 'active',
    SubState: 'exited',
    Result: 'success',
    ExecMainCode: '1',
    ExecMainStatus: '0',
  });
  if (config.mode === 'provider-stale') values.NeedDaemonReload = 'yes';
  if (config.mode === 'provider-drop-in') {
    values.DropInPaths = `${config.providerFragment}.d/unexpected.conf`;
  }
  if (config.mode === 'provider-manager-exec-drift') {
    const drifted = [...providerArgv];
    drifted[1] = `${config.opsHelperRoot}/bin/secrets-provider.mjs`;
    values.ExecStart = execRecord('/usr/bin/node', drifted);
    values.ExecStartEx = execRecord('/usr/bin/node', drifted, true);
  }
  if (config.mode === 'provider-manager-write-root-drift') {
    values.ReadWritePaths = `${values.ReadWritePaths} /var/lib/cosmos-action-receipts/extra`;
  }
  if (config.mode === 'provider-restart') values.Restart = 'on-failure';
  if (config.mode === 'provider-inactive') {
    values.ActiveState = 'inactive';
    values.SubState = 'dead';
  }
  if (config.mode === 'provider-failed') {
    values.Result = 'exit-code';
    values.ExecMainStatus = '1';
  }
  if (config.mode === 'provider-app-part-of') values.PartOf = 'cosmos-app.service';
} else {
  process.exit(92);
}

for (const property of properties) {
  if (property === 'EnvironmentFiles') {
    if (unit === 'cosmos-app.service') {
      process.stdout.write(`EnvironmentFiles=${config.runtimeEnv} (ignore_errors=no)\n`);
      process.stdout.write(`EnvironmentFiles=${config.i00Env} (ignore_errors=no)\n`);
    } else if (config.mode === 'provider-empty-environment-file-row') {
      process.stdout.write('EnvironmentFiles=\n');
    }
  } else {
    process.stdout.write(`${property}=${values[property] ?? ''}\n`);
  }
}
