export interface ConnectorState {
  readonly available: boolean;
  readonly state?: 'WIRED_LOCAL' | 'NOT_CONFIGURED' | 'UNAVAILABLE';
  readonly label: string;
  readonly detail: string;
  readonly endpoint?: string;
}

export interface RoutingSnapshot {
  readonly sources: Readonly<Record<'bot' | 'execution' | 'aws', Readonly<ConnectorState>>>;
  readonly destinations: Readonly<Record<
    'inApp' | 'email' | 'telegram' | 'whatsapp' | 'awsSns',
    Readonly<ConnectorState>
  >>;
  readonly policy: Readonly<{
    transitionsOnly: boolean;
    repeatWindowMinutes: number;
    rawLogsExcluded: boolean;
  }>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const canonical = [...expected].sort();
  return actual.length === canonical.length
    && actual.every((key, index) => key === canonical[index]);
}

function validConnector(
  value: unknown,
  expectedKeys: readonly string[],
): value is ConnectorState {
  if (!isRecord(value) || !exactKeys(value, expectedKeys)
    || typeof value.available !== 'boolean'
    || typeof value.label !== 'string' || value.label.length < 1 || value.label.length > 160
    || typeof value.detail !== 'string' || value.detail.length < 1 || value.detail.length > 500
    || (Object.hasOwn(value, 'state')
      && !['WIRED_LOCAL', 'NOT_CONFIGURED', 'UNAVAILABLE'].includes(String(value.state)))
    || (Object.hasOwn(value, 'endpoint')
      && (typeof value.endpoint !== 'string' || !value.endpoint.startsWith('/api/')))) return false;
  return true;
}

/** Exact, fail-closed decoder for the non-authoritative routing capability readback. */
export function decodeNotificationRoutingSnapshot(value: unknown): RoutingSnapshot | null {
  if (!isRecord(value) || !exactKeys(value, ['sources', 'destinations', 'policy'])
    || !isRecord(value.sources) || !exactKeys(value.sources, ['bot', 'execution', 'aws'])
    || !isRecord(value.destinations)
    || !exactKeys(value.destinations, ['inApp', 'email', 'telegram', 'whatsapp', 'awsSns'])
    || !isRecord(value.policy) || !exactKeys(value.policy, [
      'transitionsOnly', 'repeatWindowMinutes', 'rawLogsExcluded',
    ])) return null;
  const sources = value.sources;
  const destinations = value.destinations;
  if (!validConnector(sources.bot, ['available', 'label', 'detail'])
    || !validConnector(sources.execution, ['available', 'label', 'detail'])
    || !validConnector(sources.aws, ['available', 'label', 'detail', 'endpoint'])
    || !validConnector(destinations.inApp, ['available', 'state', 'label', 'detail'])
    || !validConnector(destinations.email, ['available', 'state', 'label', 'detail'])
    || !validConnector(destinations.telegram, ['available', 'state', 'label', 'detail'])
    || !validConnector(destinations.whatsapp, ['available', 'state', 'label', 'detail'])
    || !validConnector(destinations.awsSns, ['available', 'state', 'label', 'detail'])
    || sources.bot.available !== true
    || sources.execution.available !== false
    || sources.aws.available !== false
    || sources.aws.endpoint !== '/api/notifications/ingest/aws'
    || destinations.inApp.available !== (destinations.inApp.state === 'WIRED_LOCAL')
    || [destinations.email, destinations.telegram, destinations.whatsapp, destinations.awsSns]
      .some((connector) => connector.available || connector.state !== 'NOT_CONFIGURED')
    || value.policy.transitionsOnly !== true
    || value.policy.repeatWindowMinutes !== 15
    || value.policy.rawLogsExcluded !== true) return null;
  return Object.freeze({
    sources: Object.freeze({
      bot: Object.freeze({ ...sources.bot }),
      execution: Object.freeze({ ...sources.execution }),
      aws: Object.freeze({ ...sources.aws }),
    }),
    destinations: Object.freeze({
      inApp: Object.freeze({ ...destinations.inApp }),
      email: Object.freeze({ ...destinations.email }),
      telegram: Object.freeze({ ...destinations.telegram }),
      whatsapp: Object.freeze({ ...destinations.whatsapp }),
      awsSns: Object.freeze({ ...destinations.awsSns }),
    }),
    policy: Object.freeze({
      transitionsOnly: true,
      repeatWindowMinutes: 15,
      rawLogsExcluded: true,
    }),
  });
}
