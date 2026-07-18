import fs from 'node:fs';
import path from 'node:path';

type Environment = Readonly<Record<string, string | undefined>>;

export interface DataDirAuthority {
  readonly dataDir: string;
  readonly iconCache: string;
  readonly liquidationCache: string;
  readonly profileCache: string;
  readonly newsArchive: string;
}

interface DirectoryIdentity {
  readonly device: number;
  readonly inode: number;
}

const DATA_DIR_IDENTITIES = new WeakMap<DataDirAuthority, DirectoryIdentity>();
let PROCESS_DATA_DIR_AUTHORITY: DataDirAuthority | undefined;

function authorityError(code: string): Error & { readonly code: string } {
  return Object.assign(new Error(code), { code });
}

function resolvePhysicalDirectory(requestedPath: string): Readonly<{
  path: string;
  identity: DirectoryIdentity;
}> {
  fs.mkdirSync(requestedPath, { recursive: true });
  const physicalPath = fs.realpathSync.native(requestedPath);
  const physicalStats = fs.lstatSync(physicalPath);
  const requestedStats = fs.statSync(requestedPath);
  if (!physicalStats.isDirectory() || physicalStats.isSymbolicLink()
    || !requestedStats.isDirectory()
    || physicalStats.dev !== requestedStats.dev
    || physicalStats.ino !== requestedStats.ino) {
    throw authorityError('DATA_DIR_AUTHORITY_CHANGED');
  }
  return Object.freeze({
    path: physicalPath,
    identity: Object.freeze({
      device: physicalStats.dev,
      inode: physicalStats.ino,
    }),
  });
}

/** Load local process configuration before any path-owning module evaluates. */
export function loadDotEnv(
  cwd: string = process.cwd(),
  environment: NodeJS.ProcessEnv = process.env,
): void {
  if (environment.SKIP_DOTENV) return;
  try {
    const text = fs.readFileSync(path.resolve(cwd, '.env'), 'utf8');
    for (const line of text.split('\n')) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/u);
      if (match && environment[match[1]] === undefined) {
        environment[match[1]] = match[2].replace(/^["']|["']$/gu, '');
      }
    }
  } catch {
    // An absent local file is a valid keyless/default configuration.
  }
}

export function resolveDataDirAuthority(
  cwd: string = process.cwd(),
  environment: Environment = process.env,
): DataDirAuthority {
  const isProcessAuthority = cwd === process.cwd() && environment === process.env;
  if (isProcessAuthority && PROCESS_DATA_DIR_AUTHORITY !== undefined) {
    return PROCESS_DATA_DIR_AUTHORITY;
  }
  const requestedDataDir = environment.DATA_DIR
    ? path.resolve(cwd, environment.DATA_DIR)
    : path.resolve(cwd, 'data');
  const resolvedDataDir = resolvePhysicalDirectory(requestedDataDir);
  const resolvedDirectories = new Map<string, string>([
    [requestedDataDir, resolvedDataDir.path],
  ]);
  const resolveDirectory = (requestedPath: string): string => {
    const existing = resolvedDirectories.get(requestedPath);
    if (existing !== undefined) return existing;
    const resolved = resolvePhysicalDirectory(requestedPath).path;
    resolvedDirectories.set(requestedPath, resolved);
    return resolved;
  };
  const resolveCache = (configured: string | undefined, fallback: string): string => {
    const requestedPath = path.resolve(
      cwd,
      configured ?? path.join(requestedDataDir, fallback),
    );
    const relativeToDataDir = path.relative(requestedDataDir, requestedPath);
    if (relativeToDataDir === ''
      || (!relativeToDataDir.startsWith(`..${path.sep}`)
        && relativeToDataDir !== '..'
        && !path.isAbsolute(relativeToDataDir))) {
      return path.resolve(resolvedDataDir.path, relativeToDataDir);
    }
    const requestedParent = path.dirname(requestedPath);
    return path.join(resolveDirectory(requestedParent), path.basename(requestedPath));
  };
  const authority: DataDirAuthority = Object.freeze({
    dataDir: resolvedDataDir.path,
    iconCache: resolveCache(environment.ICON_CACHE, 'icon_cache.json'),
    liquidationCache: resolveCache(environment.LIQ_CACHE, 'liquidations.json'),
    profileCache: resolveCache(environment.PROFILE_CACHE, 'profile_cache.json'),
    newsArchive: path.join(resolvedDataDir.path, 'news-archive.json'),
  });
  DATA_DIR_IDENTITIES.set(authority, resolvedDataDir.identity);
  if (isProcessAuthority) PROCESS_DATA_DIR_AUTHORITY = authority;
  return authority;
}

/** Fail closed if the physical directory bound at process start was replaced. */
export function assertDataDirAuthorityHeld(authority: DataDirAuthority): void {
  const expected = DATA_DIR_IDENTITIES.get(authority);
  if (expected === undefined) throw authorityError('DATA_DIR_AUTHORITY_UNKNOWN');
  const current = fs.lstatSync(authority.dataDir);
  if (!current.isDirectory() || current.isSymbolicLink()
    || current.dev !== expected.device || current.ino !== expected.inode) {
    throw authorityError('DATA_DIR_AUTHORITY_CHANGED');
  }
}

loadDotEnv();

/** The process-start snapshot used by fresh-process assurance probes. */
export const DATA_DIR_AUTHORITY: DataDirAuthority = resolveDataDirAuthority();
