import {
  RESEARCH_LAB_ARTIFACTS,
  RESEARCH_LAB_ARTIFACT_PROVENANCE,
  researchLabArtifactUrl,
  type ResearchLabArtifact,
} from '../../data/researchLabArtifacts';
import { isResearchLabRecord } from '../../data/researchLabEvidence';

export const RESEARCH_LAB_ARTIFACT_MAX_BYTES = 300_000;

export type ArtifactRequest = Readonly<{
  family: string;
  path: string;
  nonce: number;
}>;

export type LoadedResearchArtifact = Readonly<{
  artifact: ResearchLabArtifact;
  raw: string;
  payload: unknown;
  verifiedBytes: number;
  verifiedSha256: string;
  requestPath: string;
}>;

export type ResearchArtifactLoadState =
  | Readonly<{ status: 'IDLE'; loaded: null; error: null }>
  | Readonly<{ status: 'LOADING'; loaded: null; error: null }>
  | Readonly<{ status: 'READY'; loaded: LoadedResearchArtifact; error: null }>
  | Readonly<{ status: 'INVALID'; loaded: null; error: string }>;

export type ResearchArtifactFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export type ResearchArtifactLoaderOptions = Readonly<{
  fetcher?: ResearchArtifactFetch;
  baseUrl?: string | URL;
}>;

export type ResearchArtifactLoader = (
  artifact: ResearchLabArtifact,
  signal: AbortSignal,
  options?: ResearchArtifactLoaderOptions,
) => Promise<LoadedResearchArtifact>;

export type LoadedArtifact = LoadedResearchArtifact;
export type ArtifactLoadState = ResearchArtifactLoadState;
export type ArtifactLoaderOptions = ResearchArtifactLoaderOptions;
export type ArtifactLoader = ResearchArtifactLoader;

const EMPTY_ARTIFACTS = Object.freeze([]) as readonly ResearchLabArtifact[];
const HEX_SHA256 = /^[0-9a-f]{64}$/u;
const PUBLIC_ROOT = `${RESEARCH_LAB_ARTIFACT_PROVENANCE.publicRoot}/`;
const canonicalArtifactsByPath = new Map(
  RESEARCH_LAB_ARTIFACTS.map((artifact) => [artifact.path, artifact]),
);

function artifactMatchesManifest(
  candidate: ResearchLabArtifact,
  canonical: ResearchLabArtifact,
): boolean {
  return candidate.family === canonical.family
    && candidate.name === canonical.name
    && candidate.path === canonical.path
    && candidate.bytes === canonical.bytes
    && candidate.sha256 === canonical.sha256
    && candidate.format === canonical.format
    && candidate.role === canonical.role;
}

export function canonicalResearchArtifact(
  artifact: ResearchLabArtifact,
): ResearchLabArtifact {
  const canonical = canonicalArtifactsByPath.get(artifact.path);
  if (!canonical || !artifactMatchesManifest(artifact, canonical)) {
    throw new TypeError('RESEARCH_LAB_ARTIFACT_NOT_ALLOWLISTED');
  }
  if (
    canonical.bytes < 0
    || canonical.bytes > RESEARCH_LAB_ARTIFACT_MAX_BYTES
    || !Number.isSafeInteger(canonical.bytes)
  ) {
    throw new TypeError('RESEARCH_LAB_ARTIFACT_SIZE_OUT_OF_BOUNDS');
  }
  if (!HEX_SHA256.test(canonical.sha256)) {
    throw new TypeError('RESEARCH_LAB_ARTIFACT_SHA256_INVALID');
  }
  return canonical;
}

export function artifactsForRequestFamily(
  family: string,
  artifacts: readonly ResearchLabArtifact[],
): readonly ResearchLabArtifact[] {
  const admitted = artifacts.map(canonicalResearchArtifact);
  if (admitted.some((artifact) => artifact.family !== family)) {
    throw new TypeError('RESEARCH_LAB_ARTIFACT_FAMILY_MISMATCH');
  }
  return admitted.length === 0 ? EMPTY_ARTIFACTS : Object.freeze(admitted);
}

export function createArtifactRequest(
  family: string,
  path: string,
  nonce: number,
): ArtifactRequest {
  if (!Number.isSafeInteger(nonce) || nonce < 0) {
    throw new TypeError('RESEARCH_LAB_ARTIFACT_REQUEST_NONCE_INVALID');
  }
  const artifact = canonicalArtifactsByPath.get(path);
  if (!artifact || artifact.family !== family) {
    throw new TypeError('RESEARCH_LAB_ARTIFACT_REQUEST_NOT_ALLOWLISTED');
  }
  return Object.freeze({ family, path, nonce });
}

export function resolveArtifactRequest(
  request: ArtifactRequest | null | undefined,
  family: string,
  artifacts: readonly ResearchLabArtifact[],
): ResearchLabArtifact | null {
  if (!request || request.family !== family) return null;
  const requested = artifacts.find((artifact) => artifact.path === request.path);
  if (!requested) return null;
  return canonicalResearchArtifact(requested);
}

export function artifactRoleLabel(artifact: ResearchLabArtifact): string {
  if (artifact.role === 'README') return 'Overview';
  if (artifact.role === 'SOURCE_RESEARCH') return 'Source Research';
  if (artifact.role === 'PROTOCOL') return 'Protocol';
  if (artifact.role === 'RESULT') return 'Result';
  if (artifact.role === 'FREEZE') return 'Freeze Record';
  if (artifact.role === 'DEVELOPMENT') return 'Development Record';
  return artifact.format === 'JSON' ? 'JSON Record' : 'Text Record';
}

export function preferredResearchArtifact(
  artifacts: readonly ResearchLabArtifact[],
): ResearchLabArtifact | null {
  return artifacts.find((artifact) => artifact.role === 'README')
    ?? artifacts.find((artifact) => artifact.name === 'result.v1.json')
    ?? artifacts.find((artifact) => artifact.role === 'RESULT')
    ?? artifacts.find((artifact) => artifact.role === 'PROTOCOL')
    ?? artifacts[0]
    ?? null;
}

export const preferredArtifact = preferredResearchArtifact;

function runtimeBaseUrl(explicitBase: string | URL | undefined): URL {
  const fallback = typeof globalThis.location === 'object' && globalThis.location
    ? globalThis.location.href
    : 'http://localhost/';
  const base = new URL(explicitBase ?? fallback);
  if (
    (base.protocol !== 'http:' && base.protocol !== 'https:')
    || base.username !== ''
    || base.password !== ''
  ) {
    throw new TypeError('RESEARCH_LAB_ARTIFACT_BASE_URL_INVALID');
  }
  return base;
}

export function researchArtifactRequestUrl(
  artifact: ResearchLabArtifact,
  explicitBase?: string | URL,
): URL {
  const canonical = canonicalResearchArtifact(artifact);
  const base = runtimeBaseUrl(explicitBase);
  const requestUrl = new URL(researchLabArtifactUrl(canonical), base);
  if (
    requestUrl.origin !== base.origin
    || requestUrl.protocol !== base.protocol
    || requestUrl.username !== ''
    || requestUrl.password !== ''
    || requestUrl.search !== ''
    || requestUrl.hash !== ''
    || !requestUrl.pathname.startsWith(PUBLIC_ROOT)
  ) {
    throw new TypeError('RESEARCH_LAB_ARTIFACT_URL_NOT_ALLOWLISTED');
  }
  return requestUrl;
}

async function readBoundedResponseBytes(
  response: Response,
  signal: AbortSignal,
): Promise<Uint8Array> {
  const contentLength = response.headers.get('content-length');
  if (contentLength !== null) {
    if (!/^[0-9]+$/u.test(contentLength)) {
      throw new TypeError('RESEARCH_LAB_ARTIFACT_CONTENT_LENGTH_INVALID');
    }
    const declared = Number(contentLength);
    if (!Number.isSafeInteger(declared) || declared > RESEARCH_LAB_ARTIFACT_MAX_BYTES) {
      throw new TypeError('RESEARCH_LAB_ARTIFACT_SIZE_OUT_OF_BOUNDS');
    }
  }

  if (!response.body) {
    const fallback = new Uint8Array(await response.arrayBuffer());
    if (fallback.byteLength > RESEARCH_LAB_ARTIFACT_MAX_BYTES) {
      throw new TypeError('RESEARCH_LAB_ARTIFACT_SIZE_OUT_OF_BOUNDS');
    }
    return fallback;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      if (signal.aborted) throw new DOMException('Artifact request aborted.', 'AbortError');
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > RESEARCH_LAB_ARTIFACT_MAX_BYTES) {
        await reader.cancel('RESEARCH_LAB_ARTIFACT_SIZE_OUT_OF_BOUNDS');
        throw new TypeError('RESEARCH_LAB_ARTIFACT_SIZE_OUT_OF_BOUNDS');
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }

  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return joined;
}

export async function artifactSha256(bytes: Uint8Array | ArrayBuffer): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new TypeError('RESEARCH_LAB_ARTIFACT_CRYPTO_UNAVAILABLE');
  }
  const source = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const stableBuffer = new ArrayBuffer(source.byteLength);
  new Uint8Array(stableBuffer).set(source);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', stableBuffer);
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
}

export const loadResearchArtifact: ResearchArtifactLoader = async (
  artifact,
  signal,
  options = {},
) => {
  const canonical = canonicalResearchArtifact(artifact);
  const requestUrl = researchArtifactRequestUrl(canonical, options.baseUrl);
  const fetcher = options.fetcher ?? globalThis.fetch?.bind(globalThis);
  if (!fetcher) throw new TypeError('RESEARCH_LAB_ARTIFACT_FETCH_UNAVAILABLE');

  const response = await fetcher(requestUrl, {
    cache: 'no-store',
    credentials: 'same-origin',
    mode: 'same-origin',
    redirect: 'error',
    referrerPolicy: 'same-origin',
    signal,
  });
  if (!response.ok) {
    throw new TypeError(`RESEARCH_LAB_ARTIFACT_HTTP_${response.status}`);
  }
  if (response.url) {
    const responseUrl = new URL(response.url, requestUrl);
    if (responseUrl.origin !== requestUrl.origin || responseUrl.pathname !== requestUrl.pathname) {
      throw new TypeError('RESEARCH_LAB_ARTIFACT_RESPONSE_URL_MISMATCH');
    }
  }

  const bytes = await readBoundedResponseBytes(response, signal);
  if (bytes.byteLength !== canonical.bytes) {
    throw new TypeError('RESEARCH_LAB_ARTIFACT_BYTE_MISMATCH');
  }
  const verifiedSha256 = await artifactSha256(bytes);
  if (verifiedSha256 !== canonical.sha256) {
    throw new TypeError('RESEARCH_LAB_ARTIFACT_SHA256_MISMATCH');
  }

  const raw = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const payload = canonical.format === 'JSON' ? JSON.parse(raw) as unknown : null;
  if (canonical.format === 'JSON' && !isResearchLabRecord(payload)) {
    throw new TypeError('RESEARCH_LAB_ARTIFACT_JSON_ROOT_INVALID');
  }

  return Object.freeze({
    artifact: canonical,
    raw,
    payload,
    verifiedBytes: bytes.byteLength,
    verifiedSha256,
    requestPath: requestUrl.pathname,
  });
};

export async function loadResearchArtifacts(
  artifacts: readonly ResearchLabArtifact[],
  signal: AbortSignal,
  options: ResearchArtifactLoaderOptions = {},
): Promise<readonly LoadedResearchArtifact[]> {
  const canonical = artifacts.map(canonicalResearchArtifact);
  return Object.freeze(await Promise.all(
    canonical.map((artifact) => loadResearchArtifact(artifact, signal, options)),
  ));
}
