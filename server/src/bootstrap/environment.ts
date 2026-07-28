import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  DataDirLease,
  type DataDirLeaseOptions,
} from '../systemIntegration/persistence/dataDirLease.js';
import { installProductionLogging } from '../ops/productionLogging.js';

installProductionLogging({ environment: process.env.NODE_ENV });

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

interface DirectoryBinding {
  readonly path: string;
  readonly identity: DirectoryIdentity;
}

interface DataDirAuthorityMetadata {
  readonly dataDir: DirectoryBinding;
  readonly cacheParents: ReadonlyMap<string, DirectoryBinding>;
}

interface LogicalLeaseBinding {
  readonly root: string;
  readonly leaf: string;
  readonly lease: DataDirLease;
}

const LOGICAL_LEASE_ROOT_ENV = 'DATA_DIR_LOGICAL_LEASE_ROOT';
const LOGICAL_LEASE_NAMESPACE = '.cosmos-data-dir-logical-leases.v1';
const LOGICAL_LEASE_KEY_VERSION = 'cosmos-data-dir-logical-key.v1';
const MAX_LOGICAL_DATA_DIR_BYTES = 16 * 1024;
const MAX_REQUESTED_CACHE_PATH_BYTES = 16 * 1024;
const SECURE_DIRECTORY_MODE = 0o700;
const LEGACY_PHYSICAL_LEASE_ROOT = '.cosmos-data-dir.lease.v1';
const LEGACY_PHYSICAL_LEASE_WITNESS_PREFIX = '.cosmos-data-dir.lease.candidate-';
const LEGACY_PHYSICAL_LEASE_SUCCESSOR_PREFIX = '.cosmos-data-dir.lease.next-';
const PHYSICAL_LEASE_ROOT = '.cosmos-data-dir.lease.v2';
const PHYSICAL_LEASE_WITNESS_PREFIX = '.cosmos-data-dir.lease.v2.candidate-';
const PHYSICAL_LEASE_SUCCESSOR_PREFIX = '.cosmos-data-dir.lease.v2.next-';
const RESERVED_OWNER_FILENAMES = Object.freeze([
  'cosmos.db',
  'cosmos.db-wal',
  'cosmos.db-shm',
  'journal-compat.json',
  'news-archive.json',
]);

const DATA_DIR_METADATA = new WeakMap<DataDirAuthority, DataDirAuthorityMetadata>();
let PROCESS_DATA_DIR_AUTHORITY: DataDirAuthority | undefined;

function authorityError(code: string): Error & { readonly code: string } {
  return Object.assign(new Error(code), { code });
}

function identityOf(stats: fs.Stats): DirectoryIdentity {
  return Object.freeze({ device: stats.dev, inode: stats.ino });
}

function sameIdentity(stats: fs.Stats, expected: DirectoryIdentity): boolean {
  return stats.dev === expected.device && stats.ino === expected.inode;
}

function asciiLowercase(value: string): string {
  return value.replace(/[A-Z]/gu, (character) => character.toLowerCase());
}

function canonicalPathComparisonKey(absolutePath: string): string {
  return asciiLowercase(path.normalize(absolutePath));
}

function relativePathWithin(parent: string, candidate: string): string | undefined {
  const relative = path.relative(
    canonicalPathComparisonKey(parent),
    canonicalPathComparisonKey(candidate),
  );
  if (relative === '') return '';
  if (relative === '..'
    || relative.startsWith(`..${path.sep}`)
    || path.isAbsolute(relative)) return undefined;
  return relative;
}

function isAsciiOnly(value: string): boolean {
  return !/[^\x00-\x7F]/u.test(value);
}

function canonicalLogicalDataDirKey(requestedDataDir: string): string {
  const normalized = path.normalize(requestedDataDir);
  if (normalized.includes('\0')
    || Buffer.byteLength(normalized, 'utf8') > MAX_LOGICAL_DATA_DIR_BYTES) {
    throw authorityError('DATA_DIR_LOGICAL_PATH_INVALID');
  }
  const parsed = path.parse(normalized);
  const components = normalized.slice(parsed.root.length).split(path.sep).filter(Boolean);
  if (!path.isAbsolute(normalized) || components.some((component) => !isAsciiOnly(component))) {
    throw authorityError('DATA_DIR_LOGICAL_PATH_NON_ASCII');
  }
  return asciiLowercase(normalized);
}

function isReservedCacheComponent(component: string): boolean {
  const componentKey = asciiLowercase(component);
  return RESERVED_OWNER_FILENAMES.includes(componentKey)
    || componentKey === asciiLowercase(LEGACY_PHYSICAL_LEASE_ROOT)
    || componentKey.startsWith(asciiLowercase(LEGACY_PHYSICAL_LEASE_WITNESS_PREFIX))
    || componentKey.startsWith(asciiLowercase(LEGACY_PHYSICAL_LEASE_SUCCESSOR_PREFIX))
    || componentKey === asciiLowercase(PHYSICAL_LEASE_ROOT)
    || componentKey.startsWith(asciiLowercase(PHYSICAL_LEASE_WITNESS_PREFIX))
    || componentKey.startsWith(asciiLowercase(PHYSICAL_LEASE_SUCCESSOR_PREFIX));
}

function assertRelativeCachePathPolicy(cachePath: string, dataDir: string): boolean {
  const normalized = path.normalize(cachePath);
  if (!path.isAbsolute(normalized)
    || normalized.includes('\0')
    || Buffer.byteLength(normalized, 'utf8') > MAX_REQUESTED_CACHE_PATH_BYTES) {
    throw authorityError('DATA_DIR_CACHE_PATH_INVALID');
  }
  const relative = relativePathWithin(dataDir, cachePath);
  if (relative === undefined) return false;
  if (relative === '') throw authorityError('DATA_DIR_CACHE_PATH_RESERVED');
  const components = relative.split(path.sep).filter(Boolean);
  if (components.some((component) => !isAsciiOnly(component))) {
    throw authorityError('DATA_DIR_CACHE_PATH_NON_ASCII');
  }
  if (components.some(isReservedCacheComponent)) {
    throw authorityError('DATA_DIR_CACHE_PATH_RESERVED');
  }
  return true;
}

function assertDistinctCacheTargets(cachePaths: readonly string[]): void {
  for (let left = 0; left < cachePaths.length; left += 1) {
    for (let right = left + 1; right < cachePaths.length; right += 1) {
      if (isInsideOrEqual(cachePaths[left], cachePaths[right])
        || isInsideOrEqual(cachePaths[right], cachePaths[left])) {
        throw authorityError('DATA_DIR_CACHE_PATH_COLLISION');
      }
    }
  }
}

function assertCacheLeafValid(cachePath: string): void {
  try {
    const leaf = fs.lstatSync(cachePath);
    if (!leaf.isFile() || leaf.isSymbolicLink()) {
      throw authorityError('DATA_DIR_CACHE_PATH_INVALID');
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    if (error instanceof Error && 'code' in error
      && error.code === 'DATA_DIR_CACHE_PATH_INVALID') throw error;
    throw authorityError('DATA_DIR_CACHE_PATH_INVALID');
  }
}

function existingRegularFile(cachePath: string): fs.Stats | undefined {
  try {
    const leaf = fs.lstatSync(cachePath);
    if (!leaf.isFile() || leaf.isSymbolicLink()) {
      throw authorityError('DATA_DIR_CACHE_PATH_INVALID');
    }
    return leaf;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    if (error instanceof Error && 'code' in error
      && error.code === 'DATA_DIR_CACHE_PATH_INVALID') throw error;
    throw authorityError('DATA_DIR_CACHE_PATH_INVALID');
  }
}

function assertNoExistingCacheInodeAliases(
  cachePaths: readonly string[],
  physicalDataDir: string,
): void {
  const existingCaches = cachePaths.flatMap((cachePath) => {
    const stats = existingRegularFile(cachePath);
    return stats === undefined ? [] : [Object.freeze({ path: cachePath, stats })];
  });
  for (let left = 0; left < existingCaches.length; left += 1) {
    for (let right = left + 1; right < existingCaches.length; right += 1) {
      if (sameIdentity(existingCaches[left].stats, identityOf(existingCaches[right].stats))) {
        throw authorityError('DATA_DIR_CACHE_PATH_COLLISION');
      }
    }
  }

  let ownerNames: string[];
  try {
    ownerNames = fs.readdirSync(physicalDataDir)
      .filter(isReservedCacheComponent)
      .sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw authorityError('DATA_DIR_CACHE_PATH_INVALID');
  }
  const ownerFiles = ownerNames.flatMap((name) => {
    const ownerPath = path.join(physicalDataDir, name);
    let stats: fs.Stats;
    try {
      stats = fs.lstatSync(ownerPath);
    } catch {
      throw authorityError('DATA_DIR_CACHE_PATH_INVALID');
    }
    return stats.isFile() && !stats.isSymbolicLink()
      ? [Object.freeze({ path: ownerPath, stats })]
      : [];
  });
  for (const cache of existingCaches) {
    for (const owner of ownerFiles) {
      if (cache.path !== owner.path
        && sameIdentity(cache.stats, identityOf(owner.stats))) {
        throw authorityError('DATA_DIR_CACHE_PATH_COLLISION');
      }
    }
  }
}

function isInsideOrEqual(parent: string, candidate: string): boolean {
  return relativePathWithin(parent, candidate) !== undefined;
}

function isPhysicallyInsideOrEqual(parent: string, candidate: string): boolean {
  const relative = path.relative(path.normalize(parent), path.normalize(candidate));
  return relative === '' || (
    relative !== '..'
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative)
  );
}

function resolvePhysicalDirectory(requestedPath: string): DirectoryBinding {
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
    identity: identityOf(physicalStats),
  });
}

function prospectivePhysicalDirectory(requestedPath: string): string {
  const missing: string[] = [];
  let cursor = path.resolve(requestedPath);
  while (true) {
    try {
      const existing = fs.realpathSync.native(cursor);
      return path.join(existing, ...missing);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw authorityError('DATA_DIR_CACHE_PATH_INVALID');
      }
      const parent = path.dirname(cursor);
      if (parent === cursor) throw authorityError('DATA_DIR_CACHE_PATH_INVALID');
      missing.unshift(path.basename(cursor));
      cursor = parent;
    }
  }
}

function resolvePhysicalCacheDirectory(
  requestedPath: string,
  physicalDataDir: string,
): DirectoryBinding {
  const prospective = prospectivePhysicalDirectory(requestedPath);
  if (!isPhysicallyInsideOrEqual(physicalDataDir, prospective)) {
    throw authorityError('DATA_DIR_CACHE_PATH_OUTSIDE_DATA_DIR');
  }
  const binding = resolvePhysicalDirectory(requestedPath);
  if (!isPhysicallyInsideOrEqual(physicalDataDir, binding.path)) {
    throw authorityError('DATA_DIR_CACHE_PATH_OUTSIDE_DATA_DIR');
  }
  return binding;
}

function assertDirectoryBindingHeld(
  binding: DirectoryBinding,
  code: 'DATA_DIR_AUTHORITY_CHANGED' | 'DATA_DIR_CACHE_AUTHORITY_CHANGED',
): void {
  let current: fs.Stats;
  try {
    current = fs.lstatSync(binding.path);
  } catch {
    throw authorityError(code);
  }
  if (!current.isDirectory() || current.isSymbolicLink()
    || !sameIdentity(current, binding.identity)) {
    throw authorityError(code);
  }
}

function assertNoSymlinkComponents(absolutePath: string): void {
  const parsed = path.parse(absolutePath);
  const relative = absolutePath.slice(parsed.root.length);
  let current = parsed.root;
  for (const component of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, component);
    let stats: fs.Stats;
    try {
      stats = fs.lstatSync(current);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw authorityError('DATA_DIR_LOGICAL_LEASE_NAMESPACE_INVALID');
    }
    if (stats.isSymbolicLink()) {
      throw authorityError('DATA_DIR_LOGICAL_LEASE_NAMESPACE_INVALID');
    }
  }
}

function ensureSecureOwnedDirectory(directoryPath: string): string {
  const parentPath = path.dirname(directoryPath);
  assertNoSymlinkComponents(parentPath);
  let parentStats: fs.Stats;
  try {
    parentStats = fs.lstatSync(parentPath);
  } catch {
    throw authorityError('DATA_DIR_LOGICAL_LEASE_NAMESPACE_INVALID');
  }
  if (!parentStats.isDirectory() || parentStats.isSymbolicLink()) {
    throw authorityError('DATA_DIR_LOGICAL_LEASE_NAMESPACE_INVALID');
  }
  try {
    fs.mkdirSync(directoryPath, { mode: SECURE_DIRECTORY_MODE });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
      throw authorityError('DATA_DIR_LOGICAL_LEASE_NAMESPACE_INVALID');
    }
  }
  assertNoSymlinkComponents(directoryPath);
  let stats: fs.Stats;
  let physicalPath: string;
  try {
    stats = fs.lstatSync(directoryPath);
    physicalPath = fs.realpathSync.native(directoryPath);
  } catch {
    throw authorityError('DATA_DIR_LOGICAL_LEASE_NAMESPACE_INVALID');
  }
  const processUid = process.getuid?.();
  if (processUid === undefined
    || physicalPath !== directoryPath
    || !stats.isDirectory()
    || stats.isSymbolicLink()
    || stats.uid !== processUid
    || (stats.mode & 0o777) !== SECURE_DIRECTORY_MODE) {
    throw authorityError('DATA_DIR_LOGICAL_LEASE_NAMESPACE_INVALID');
  }
  return physicalPath;
}

function defaultLogicalLeaseRoot(): string {
  let physicalTemp: string;
  try {
    physicalTemp = fs.realpathSync.native(tmpdir());
  } catch {
    throw authorityError('DATA_DIR_LOGICAL_LEASE_NAMESPACE_INVALID');
  }
  const processUid = process.getuid?.();
  if (processUid === undefined) {
    throw authorityError('DATA_DIR_LOGICAL_LEASE_NAMESPACE_INVALID');
  }
  return path.join(physicalTemp, `${LOGICAL_LEASE_NAMESPACE}-${processUid}`);
}

function requestedLogicalLeaseRoot(
  requestedDataDir: string,
  environment: Environment,
): string {
  const configuredRoot = environment[LOGICAL_LEASE_ROOT_ENV];
  if (environment.NODE_ENV === 'production' && configuredRoot === undefined) {
    throw authorityError('DATA_DIR_LOGICAL_LEASE_ROOT_REQUIRED');
  }
  if (configuredRoot !== undefined && !path.isAbsolute(configuredRoot)) {
    throw authorityError('DATA_DIR_LOGICAL_LEASE_NAMESPACE_INVALID');
  }
  const requestedRoot = configuredRoot === undefined
    ? defaultLogicalLeaseRoot()
    : path.resolve(configuredRoot);
  if (!path.isAbsolute(requestedRoot)
    || requestedRoot.includes('\0')
    || Buffer.byteLength(requestedRoot, 'utf8') > MAX_LOGICAL_DATA_DIR_BYTES
    || isInsideOrEqual(requestedDataDir, requestedRoot)
    || isInsideOrEqual(requestedRoot, requestedDataDir)) {
    throw authorityError('DATA_DIR_LOGICAL_LEASE_NAMESPACE_INVALID');
  }
  return requestedRoot;
}

function acquireLogicalLease(
  requestedDataDir: string,
  environment: Environment,
  options: Readonly<DataDirLeaseOptions>,
): LogicalLeaseBinding {
  const logicalKeyPath = canonicalLogicalDataDirKey(requestedDataDir);
  const requestedRoot = requestedLogicalLeaseRoot(requestedDataDir, environment);
  const root = ensureSecureOwnedDirectory(requestedRoot);
  const key = createHash('sha256').update(JSON.stringify({
    version: LOGICAL_LEASE_KEY_VERSION,
    requestedDataDir: logicalKeyPath,
  }), 'utf8').digest('hex');
  const leaf = ensureSecureOwnedDirectory(path.join(root, key));
  return Object.freeze({ root, leaf, lease: new DataDirLease(leaf, options) });
}

function requestedDataDir(cwd: string, environment: Environment): string {
  if (environment.NODE_ENV === 'production' && !environment.DATA_DIR) {
    // The `<cwd>/data` convenience default is for local development only. In
    // production the working directory is the immutable release
    // (`/opt/cosmos/current`), which deploy freezing and ProtectSystem=strict
    // both make read-only — a default that writes into the release is never
    // right, so refuse loudly exactly as the lease root is refused (F-051).
    throw authorityError('DATA_DIR_REQUIRED');
  }
  return environment.DATA_DIR
    ? path.resolve(cwd, environment.DATA_DIR)
    : path.resolve(cwd, 'data');
}

function requestedCachePath(
  cwd: string,
  configured: string | undefined,
  fallbackDataDir: string,
  fallback: string,
): string {
  return configured === undefined
    ? path.join(fallbackDataDir, fallback)
    : path.resolve(cwd, configured);
}

function requestedMutableCachePaths(
  cwd: string,
  environment: Environment,
  fallbackDataDir: string,
): readonly string[] {
  return Object.freeze([
    requestedCachePath(cwd, environment.ICON_CACHE, fallbackDataDir, 'icon_cache.json'),
    requestedCachePath(cwd, environment.LIQ_CACHE, fallbackDataDir, 'liquidations.json'),
    requestedCachePath(cwd, environment.PROFILE_CACHE, fallbackDataDir, 'profile_cache.json'),
  ]);
}

function assertRequestedCacheNames(
  cachePaths: readonly string[],
  requestedDataDir: string,
  physicalDataDir: string,
  logicalReservation?: Readonly<{ root: string; leaf: string }>,
): void {
  for (const cachePath of cachePaths) {
    if (isReservedCacheComponent(path.basename(cachePath))) {
      throw authorityError('DATA_DIR_CACHE_PATH_RESERVED');
    }
    if (logicalReservation !== undefined
      && isInsideOrEqual(logicalReservation.root, cachePath)) {
      throw authorityError('DATA_DIR_CACHE_PATH_RESERVED');
    }
    const admittedRelativeToRequested = assertRelativeCachePathPolicy(cachePath, requestedDataDir);
    if (!admittedRelativeToRequested
      && !assertRelativeCachePathPolicy(cachePath, physicalDataDir)) {
      throw authorityError('DATA_DIR_CACHE_PATH_OUTSIDE_DATA_DIR');
    }
  }
  assertDistinctCacheTargets(cachePaths);
}

function assertCacheReservations(
  cachePaths: readonly string[],
  physicalDataDir: string,
  logicalReservation?: Readonly<{ root: string; leaf: string }>,
): void {
  if (cachePaths.some((cachePath) => !isPhysicallyInsideOrEqual(physicalDataDir, cachePath))) {
    throw authorityError('DATA_DIR_CACHE_PATH_OUTSIDE_DATA_DIR');
  }
  for (const cachePath of cachePaths) {
    assertRelativeCachePathPolicy(cachePath, physicalDataDir);
    if (logicalReservation !== undefined
      && isInsideOrEqual(logicalReservation.root, cachePath)) {
      throw authorityError('DATA_DIR_CACHE_PATH_RESERVED');
    }
  }
  assertDistinctCacheTargets(cachePaths);
}

interface ProspectiveCachePlan {
  readonly configuredPath: string;
  readonly requestedParent: string;
  readonly prospectivePath: string;
}

interface RequestedConfigurationPlan {
  readonly logicalDataDir: string;
  readonly logicalLeaseRoot: string;
  readonly prospectiveDataDir: string;
  readonly cachePlans: readonly ProspectiveCachePlan[];
}

function assertRequestedConfigurationNoMutation(
  cwd: string,
  environment: Environment,
  logicalReservation?: Readonly<{ root: string; leaf: string }>,
): RequestedConfigurationPlan {
  const logicalDataDir = requestedDataDir(cwd, environment);
  canonicalLogicalDataDirKey(logicalDataDir);
  const logicalLeaseRoot = requestedLogicalLeaseRoot(logicalDataDir, environment);
  const prospectiveDataDir = prospectivePhysicalDirectory(logicalDataDir);
  if (isInsideOrEqual(prospectiveDataDir, logicalLeaseRoot)
    || isInsideOrEqual(logicalLeaseRoot, prospectiveDataDir)) {
    throw authorityError('DATA_DIR_LOGICAL_LEASE_NAMESPACE_INVALID');
  }
  const configuredCaches = requestedMutableCachePaths(cwd, environment, logicalDataDir);
  const reservation = logicalReservation ?? Object.freeze({
    root: logicalLeaseRoot,
    leaf: logicalLeaseRoot,
  });
  assertRequestedCacheNames(
    configuredCaches,
    logicalDataDir,
    prospectiveDataDir,
    reservation,
  );
  const cachePlans = configuredCaches.map((configuredPath) => {
    const requestedParent = path.dirname(configuredPath);
    const prospectiveParent = prospectivePhysicalDirectory(requestedParent);
    const prospectivePath = path.join(prospectiveParent, path.basename(configuredPath));
    return Object.freeze({ configuredPath, requestedParent, prospectivePath });
  });
  const prospectiveCachePaths = cachePlans.map((plan) => plan.prospectivePath);
  assertCacheReservations(prospectiveCachePaths, prospectiveDataDir, reservation);
  for (const prospectivePath of prospectiveCachePaths) assertCacheLeafValid(prospectivePath);
  assertNoExistingCacheInodeAliases(prospectiveCachePaths, prospectiveDataDir);
  return Object.freeze({
    logicalDataDir,
    logicalLeaseRoot,
    prospectiveDataDir,
    cachePlans: Object.freeze(cachePlans),
  });
}

function resolveDataDirAuthorityInternal(
  cwd: string,
  environment: Environment,
  logicalReservation?: Readonly<{ root: string; leaf: string }>,
): DataDirAuthority {
  const processAuthority = cwd === process.cwd() && environment === process.env;
  if (processAuthority && PROCESS_DATA_DIR_AUTHORITY !== undefined) {
    return PROCESS_DATA_DIR_AUTHORITY;
  }
  const requestedPlan = assertRequestedConfigurationNoMutation(
    cwd,
    environment,
    logicalReservation,
  );
  const { logicalDataDir } = requestedPlan;
  const resolvedDataDir = resolvePhysicalDirectory(logicalDataDir);
  if (logicalReservation !== undefined
    && (isInsideOrEqual(logicalReservation.root, resolvedDataDir.path)
      || isInsideOrEqual(resolvedDataDir.path, logicalReservation.root))) {
    throw authorityError('DATA_DIR_LOGICAL_LEASE_NAMESPACE_INVALID');
  }

  const configuredCaches = requestedMutableCachePaths(cwd, environment, resolvedDataDir.path);
  assertRequestedCacheNames(
    configuredCaches,
    logicalDataDir,
    resolvedDataDir.path,
    logicalReservation,
  );
  const cachePlans = configuredCaches.map((configuredPath) => {
    const requestedParent = path.dirname(configuredPath);
    const prospectiveParent = prospectivePhysicalDirectory(requestedParent);
    const prospectivePath = path.join(prospectiveParent, path.basename(configuredPath));
    return Object.freeze({ configuredPath, requestedParent, prospectivePath });
  });
  const prospectiveCachePaths = cachePlans.map((plan) => plan.prospectivePath);
  assertCacheReservations(prospectiveCachePaths, resolvedDataDir.path, logicalReservation);
  for (const prospectivePath of prospectiveCachePaths) assertCacheLeafValid(prospectivePath);
  assertNoExistingCacheInodeAliases(prospectiveCachePaths, resolvedDataDir.path);

  let requestedDataDirStats: fs.Stats;
  try {
    requestedDataDirStats = fs.statSync(logicalDataDir);
  } catch {
    throw authorityError('DATA_DIR_AUTHORITY_CHANGED');
  }
  if (!requestedDataDirStats.isDirectory()
    || !sameIdentity(requestedDataDirStats, resolvedDataDir.identity)) {
    throw authorityError('DATA_DIR_AUTHORITY_CHANGED');
  }

  const cacheBindings = cachePlans.map(({ configuredPath, requestedParent }) => {
    const parent = resolvePhysicalCacheDirectory(requestedParent, resolvedDataDir.path);
    const physicalPath = path.join(parent.path, path.basename(configuredPath));
    return Object.freeze({ path: physicalPath, parent });
  });
  const newsArchive = path.join(resolvedDataDir.path, 'news-archive.json');
  const mutableCachePaths = cacheBindings.map((binding) => binding.path);
  assertCacheReservations(mutableCachePaths, resolvedDataDir.path, logicalReservation);
  for (const cachePath of mutableCachePaths) assertCacheLeafValid(cachePath);
  assertNoExistingCacheInodeAliases(mutableCachePaths, resolvedDataDir.path);

  const cacheParents = new Map<string, DirectoryBinding>();
  for (const binding of cacheBindings) cacheParents.set(binding.path, binding.parent);
  cacheParents.set(newsArchive, resolvedDataDir);
  const authority: DataDirAuthority = Object.freeze({
    dataDir: resolvedDataDir.path,
    iconCache: cacheBindings[0].path,
    liquidationCache: cacheBindings[1].path,
    profileCache: cacheBindings[2].path,
    newsArchive,
  });
  DATA_DIR_METADATA.set(authority, Object.freeze({
    dataDir: resolvedDataDir,
    cacheParents,
  }));
  if (processAuthority) PROCESS_DATA_DIR_AUTHORITY = authority;
  return authority;
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
  } catch (error) {
    // An absent local file is a valid keyless/default configuration, but an
    // unreadable one (EACCES, EISDIR, …) must not be silently identical to an
    // absent one — that hides a real misconfiguration (F-050).
    const code = (error as NodeJS.ErrnoException | null)?.code;
    if (code !== 'ENOENT') throw error;
  }
}

export function resolveDataDirAuthority(
  cwd: string = process.cwd(),
  environment: Environment = process.env,
): DataDirAuthority {
  return resolveDataDirAuthorityInternal(cwd, environment);
}

/** Fail closed if the physical directory bound at process start was replaced. */
export function assertDataDirAuthorityHeld(authority: DataDirAuthority): void {
  const metadata = DATA_DIR_METADATA.get(authority);
  if (metadata === undefined) throw authorityError('DATA_DIR_AUTHORITY_UNKNOWN');
  assertDirectoryBindingHeld(metadata.dataDir, 'DATA_DIR_AUTHORITY_CHANGED');
}

/** Revalidate the pinned physical parent immediately before a durable cache mutation. */
export function assertDataDirCachePathHeld(
  authority: DataDirAuthority,
  cachePath: string,
): void {
  const metadata = DATA_DIR_METADATA.get(authority);
  if (metadata === undefined) throw authorityError('DATA_DIR_AUTHORITY_UNKNOWN');
  const parent = metadata.cacheParents.get(cachePath);
  if (parent === undefined) throw authorityError('DATA_DIR_CACHE_AUTHORITY_UNKNOWN');
  assertDirectoryBindingHeld(metadata.dataDir, 'DATA_DIR_AUTHORITY_CHANGED');
  assertDirectoryBindingHeld(parent, 'DATA_DIR_CACHE_AUTHORITY_CHANGED');
}

class ProcessDataDirLease {
  private released = false;

  constructor(
    private readonly logical: DataDirLease,
    private readonly physical: DataDirLease,
    private readonly authority: DataDirAuthority,
  ) {}

  assertHeld(): void {
    if (this.released) throw authorityError('DATA_DIR_LEASE_LOST');
    this.logical.assertHeld();
    assertDataDirAuthorityHeld(this.authority);
    for (const cachePath of [
      this.authority.iconCache,
      this.authority.liquidationCache,
      this.authority.profileCache,
      this.authority.newsArchive,
    ]) assertDataDirCachePathHeld(this.authority, cachePath);
    this.physical.assertHeld();
    this.logical.assertHeld();
  }

  release(): void {
    if (this.released) throw authorityError('DATA_DIR_LEASE_LOST');
    // Retain the logical exclusion if physical cleanup fails: another process
    // must not enter the same configured path while writer state is uncertain.
    this.physical.release();
    this.logical.release();
    this.released = true;
  }

  releaseOnProcessExit(): void {
    if (this.released) return;
    try { this.release(); } catch { /* Process termination remains fail-closed. */ }
  }
}

loadDotEnv();

let leaseLossHandled = false;
const onLeaseLost: NonNullable<DataDirLeaseOptions['onLost']> = () => {
  if (leaseLossHandled) return;
  leaseLossHandled = true;
  console.error('canonical DATA_DIR authority lease lost; exiting fail-closed');
  process.exit(1);
};

const logicalDataDir = requestedDataDir(process.cwd(), process.env);
assertRequestedConfigurationNoMutation(process.cwd(), process.env);
const logicalBinding = acquireLogicalLease(
  logicalDataDir,
  process.env,
  Object.freeze({ onLost: onLeaseLost }),
);
let initializedAuthority: DataDirAuthority;
let initializedLease: ProcessDataDirLease;
try {
  initializedAuthority = resolveDataDirAuthorityInternal(
    process.cwd(),
    process.env,
    Object.freeze({ root: logicalBinding.root, leaf: logicalBinding.leaf }),
  );
  const physicalLease = new DataDirLease(initializedAuthority.dataDir, Object.freeze({
    onLost: onLeaseLost,
  }));
  initializedLease = new ProcessDataDirLease(
    logicalBinding.lease,
    physicalLease,
    initializedAuthority,
  );
} catch (error) {
  try { logicalBinding.lease.release(); } catch { /* Preserve startup failure. */ }
  throw error;
}

/** The process-start snapshot used by fresh-process assurance probes. */
export const DATA_DIR_AUTHORITY: DataDirAuthority = initializedAuthority;
export const DATA_DIR_LEASE = initializedLease;

process.once('exit', () => DATA_DIR_LEASE.releaseOnProcessExit());
