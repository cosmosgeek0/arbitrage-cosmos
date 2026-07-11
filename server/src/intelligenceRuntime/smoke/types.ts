import type { RuntimeIntelligenceSnapshot } from '../snapshot/index.js';
import type {
  ManualSmokeReporter,
  PublicRestTransport,
  PublicWebSocketTransport,
  RuntimeClock,
} from '../contracts/index.js';

export const PUBLIC_SMOKE_SOURCE_KEYS = Object.freeze([
  'SPOT_BROAD',
  'USD_M_BOOK',
  'USD_M_MARK_FUNDING',
  'SPOT_FOCUS',
] as const);

export type PublicSmokeSourceKey = (typeof PUBLIC_SMOKE_SOURCE_KEYS)[number];
export type PublicSmokeStepState = 'PASS' | 'FAIL' | 'BLOCKED' | 'UNAVAILABLE';
export type PublicSmokeOutcome = 'PASS' | 'PARTIAL' | 'BLOCKED' | 'UNAVAILABLE' | 'FAIL';
export type PublicSmokeSourceState =
  | 'PENDING'
  | 'CONNECTING'
  | 'OPEN'
  | 'LIVE'
  | 'BLOCKED'
  | 'UNAVAILABLE'
  | 'FAILED'
  | 'CLOSED';

export interface SmokeWaitPort {
  wait(delayMs: number): Promise<void>;
}

export interface PublicSmokeConfig {
  readonly configurationVersion: string;
  readonly defaultDurationMs: number;
  readonly maximumDurationMs: number;
  readonly shutdownGraceMs: number;
  readonly requestTimeoutMs: number;
  readonly maximumRestResponseBytes: number;
  readonly maximumWebSocketMessageBytes: number;
  readonly maximumMessagesPerSource: number;
  readonly maximumAcceptedMessageAgeMs: number;
  readonly maximumUniverseInstruments: number;
  readonly maximumNormalizedEvidenceIds: number;
  readonly maximumSteps: number;
  readonly maximumErrorLength: number;
}

export interface PublicSmokeRunInput {
  readonly durationMs?: number;
  readonly focusSymbol?: string;
}

export interface PublicSmokeStep {
  readonly step: string;
  readonly state: PublicSmokeStepState;
  readonly detail: string;
  readonly observedAtMs: number;
}

export interface PublicSmokeSourceSnapshot {
  readonly key: PublicSmokeSourceKey;
  readonly sourceId: string;
  readonly endpointClass: 'PUBLIC' | 'MARKET';
  readonly productFamily: 'SPOT' | 'USD_M_PERPETUAL';
  readonly url: string;
  readonly state: PublicSmokeSourceState;
  readonly required: boolean;
  readonly openedAtMs: number | null;
  readonly lastReceiveTimeMs: number | null;
  readonly messageAgeMs: number | null;
  readonly acceptedMessageCount: number;
  readonly ignoredMessageCount: number;
  readonly droppedMessageCount: number;
  readonly normalizedEvidenceCount: number;
  readonly closedAtMs: number | null;
  readonly closeObserved: boolean;
  readonly endedBeforeShutdown: boolean;
  readonly fresh: boolean;
  readonly receivedMessageCount: number;
  readonly lastErrorCode: string | null;
  readonly lastErrorMessage: string | null;
}

export interface PublicSmokeUniverseSummary {
  readonly state: 'COMPLETE' | 'PARTIAL' | 'UNAVAILABLE';
  readonly nodeCount: number;
  readonly spotState: 'COMPLETE' | 'PARTIAL' | 'UNAVAILABLE';
  readonly usdMState: 'COMPLETE' | 'PARTIAL' | 'UNAVAILABLE';
  readonly focusSymbolPresent: boolean;
  readonly blocked: boolean;
}

export interface PublicSmokeShutdownSummary {
  readonly requested: true;
  readonly createdConnections: number;
  readonly openedConnections: number;
  readonly closeRequests: number;
  readonly observedCloses: number;
  readonly allConnectionsClosed: boolean;
}

export interface PublicNoKeySmokeResult {
  readonly id: string;
  readonly schemaVersion: '1';
  readonly configurationVersion: string;
  readonly startedAtMs: number;
  readonly finishedAtMs: number;
  readonly requestedDurationMs: number;
  readonly outcome: PublicSmokeOutcome;
  readonly manualOnly: true;
  readonly credentialsUsed: false;
  readonly privateEndpointsUsed: false;
  readonly moneyActionAuthority: 'NONE';
  readonly focusSymbol: string;
  readonly universe: PublicSmokeUniverseSummary;
  readonly sources: readonly PublicSmokeSourceSnapshot[];
  readonly normalizedEvidenceCount: number;
  readonly normalizedEvidenceIds: readonly string[];
  readonly truncatedNormalizedEvidenceIds: number;
  readonly runtimeSnapshot: RuntimeIntelligenceSnapshot | null;
  readonly steps: readonly PublicSmokeStep[];
  readonly shutdown: PublicSmokeShutdownSummary;
}

export interface PublicNoKeySmokeOptions {
  readonly clock: RuntimeClock;
  readonly wait: SmokeWaitPort;
  readonly reporter: ManualSmokeReporter;
  readonly restTransport: PublicRestTransport;
  readonly webSocketTransport: PublicWebSocketTransport;
  readonly config?: Partial<Omit<PublicSmokeConfig, 'configurationVersion'>>;
}

export interface PublicSmokeWebSocketDescriptor {
  readonly key: PublicSmokeSourceKey;
  readonly sourceId: string;
  readonly endpointClass: 'PUBLIC' | 'MARKET';
  readonly productFamily: 'SPOT' | 'USD_M_PERPETUAL';
  readonly url: string;
  readonly required: boolean;
}

export const PUBLIC_SMOKE_MANUAL_COMMAND =
  'node server/dist/intelligenceRuntime/smoke/manual.js --duration-ms 15000 --symbol BTCUSDT';
