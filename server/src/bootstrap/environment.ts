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
  const dataDir = environment.DATA_DIR
    ? path.resolve(cwd, environment.DATA_DIR)
    : path.resolve(cwd, 'data');
  const resolveCache = (configured: string | undefined, fallback: string): string => (
    path.resolve(cwd, configured ?? path.join(dataDir, fallback))
  );
  return Object.freeze({
    dataDir,
    iconCache: resolveCache(environment.ICON_CACHE, 'icon_cache.json'),
    liquidationCache: resolveCache(environment.LIQ_CACHE, 'liquidations.json'),
    profileCache: resolveCache(environment.PROFILE_CACHE, 'profile_cache.json'),
    newsArchive: path.join(dataDir, 'news-archive.json'),
  });
}

loadDotEnv();

/** The process-start snapshot used by fresh-process assurance probes. */
export const DATA_DIR_AUTHORITY: DataDirAuthority = resolveDataDirAuthority();
