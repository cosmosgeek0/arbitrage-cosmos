import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync,
  constants,
  fchmodSync,
  fstatSync,
  fsyncSync,
  futimesSync,
  linkSync,
  lstatSync,
  openSync,
  readdirSync,
  readSync,
  type Stats,
  unlinkSync,
  writeSync,
} from 'node:fs';
import { arch, hostname, networkInterfaces, platform } from 'node:os';
import path from 'node:path';

const LEASE_ROOT = '.cosmos-data-dir.lease.v1';
const LEASE_WITNESS_PREFIX = '.cosmos-data-dir.lease.candidate-';
const HEARTBEAT_INTERVAL_MS = 2_000;
const MAX_UTC_MS = 4_102_444_800_000;
const MAX_RECORD_BYTES = 1_024;
const MAX_CHAIN_DEPTH = 64;
const MAX_WITNESSES = 256;
const LEASE_MODE = 0o600;
const RECORD_KEYS = Object.freeze([
  'acquiredAtMs',
  'hostname',
  'hostIdentity',
  'ownerToken',
  'pid',
  'predecessorToken',
  'schemaVersion',
].sort());

export type DataDirLeaseErrorCode =
  | 'DATA_DIR_LEASE_HELD'
  | 'DATA_DIR_LEASE_REMOTE_HOST'
  | 'DATA_DIR_LEASE_BUSY'
  | 'DATA_DIR_LEASE_CLOCK_INVALID'
  | 'DATA_DIR_LEASE_LOST'
  | 'DATA_DIR_LEASE_RELEASE_FAILED';

interface DataDirLeaseRecord {
  readonly schemaVersion: 1;
  readonly ownerToken: string;
  readonly predecessorToken: string | null;
  readonly pid: number;
  readonly hostname: string;
  readonly hostIdentity: string;
  readonly acquiredAtMs: number;
}

interface LeaseLink {
  readonly path: string;
  readonly record: DataDirLeaseRecord;
  readonly stat: Stats;
}

interface LeaseChain {
  readonly root: LeaseLink;
  readonly tail: LeaseLink;
}

export interface DataDirLeaseOptions {
  readonly onLost?: (code: Extract<DataDirLeaseErrorCode, 'DATA_DIR_LEASE_LOST'>) => void;
}

export class DataDirLeaseError extends Error {
  readonly code: DataDirLeaseErrorCode;

  constructor(code: DataDirLeaseErrorCode, message: string) {
    super(message);
    this.name = 'DataDirLeaseError';
    this.code = code;
  }
}

function validUtcMillis(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0 && value <= MAX_UTC_MS;
}

function processIsAlive(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid < 1) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

function leaseFailure(
  code: DataDirLeaseErrorCode,
  message: string,
): DataDirLeaseError {
  return new DataDirLeaseError(code, message);
}

function sameInode(left: Stats, right: Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function exactMembers(actual: readonly string[], expected: readonly string[]): boolean {
  return actual.length === expected.length
    && actual.every((value, index) => value === expected[index]);
}

function validOwnerToken(value: unknown): value is string {
  return typeof value === 'string'
    && value.length >= 36
    && value.length <= 128
    && /^[A-Za-z0-9:._-]+$/u.test(value);
}

function resolveHostIdentity(ownerHostname: string): string {
  let macs: string[];
  try {
    macs = [...new Set(Object.values(networkInterfaces())
      .flatMap((entries) => entries ?? [])
      .filter((entry) => !entry.internal)
      .map((entry) => entry.mac.toLowerCase())
      .filter((mac) => /^(?:[0-9a-f]{2}:){5}[0-9a-f]{2}$/u.test(mac))
      .filter((mac) => mac !== '00:00:00:00:00:00'))].sort();
  } catch {
    throw leaseFailure(
      'DATA_DIR_LEASE_BUSY',
      'canonical DATA_DIR stable host identity could not be read',
    );
  }
  const osPlatform = platform();
  const osArch = arch();
  if (ownerHostname.length < 1 || ownerHostname.length > 255
      || osPlatform.length < 1 || osPlatform.length > 32
      || osArch.length < 1 || osArch.length > 32
      || macs.length < 1 || macs.length > 64) {
    throw leaseFailure(
      'DATA_DIR_LEASE_BUSY',
      'canonical DATA_DIR stable host identity is unavailable',
    );
  }
  return createHash('sha256').update(JSON.stringify({
    hostname: ownerHostname,
    platform: osPlatform,
    arch: osArch,
    macs,
  }), 'utf8').digest('hex');
}

function parseRecord(bytes: Buffer): DataDirLeaseRecord {
  let candidate: unknown;
  try {
    candidate = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw leaseFailure('DATA_DIR_LEASE_BUSY', 'canonical DATA_DIR lease record is corrupt');
  }
  if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) {
    throw leaseFailure('DATA_DIR_LEASE_BUSY', 'canonical DATA_DIR lease record is not an object');
  }
  const record = candidate as Record<string, unknown>;
  if (!exactMembers(Object.keys(record).sort(), RECORD_KEYS)
      || record.schemaVersion !== 1
      || !validOwnerToken(record.ownerToken)
      || !(record.predecessorToken === null || validOwnerToken(record.predecessorToken))
      || !Number.isSafeInteger(record.pid)
      || (record.pid as number) < 1
      || typeof record.hostname !== 'string'
      || record.hostname.length < 1
      || record.hostname.length > 255
      || typeof record.hostIdentity !== 'string'
      || !/^[0-9a-f]{64}$/u.test(record.hostIdentity)
      || !validUtcMillis(record.acquiredAtMs as number)) {
    throw leaseFailure('DATA_DIR_LEASE_BUSY', 'canonical DATA_DIR lease record is invalid');
  }
  return Object.freeze({
    schemaVersion: 1,
    ownerToken: record.ownerToken,
    predecessorToken: record.predecessorToken,
    pid: record.pid,
    hostname: record.hostname,
    hostIdentity: record.hostIdentity,
    acquiredAtMs: record.acquiredAtMs,
  }) as DataDirLeaseRecord;
}

function readRecordFromFd(fd: number): { readonly record: DataDirLeaseRecord; readonly stat: Stats } {
  const stat = fstatSync(fd);
  if (!stat.isFile()
      || stat.size < 1
      || stat.size > MAX_RECORD_BYTES
      || (stat.mode & 0o777) !== LEASE_MODE) {
    throw leaseFailure('DATA_DIR_LEASE_BUSY', 'canonical DATA_DIR lease inode is invalid');
  }
  const bytes = Buffer.alloc(stat.size);
  let offset = 0;
  while (offset < bytes.length) {
    const count = readSync(fd, bytes, offset, bytes.length - offset, offset);
    if (count === 0) {
      throw leaseFailure('DATA_DIR_LEASE_BUSY', 'canonical DATA_DIR lease record is truncated');
    }
    offset += count;
  }
  return Object.freeze({ record: parseRecord(bytes), stat });
}

function readLink(linkPath: string): LeaseLink | null {
  let pathStat: Stats;
  try {
    pathStat = lstatSync(linkPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw leaseFailure('DATA_DIR_LEASE_BUSY', 'canonical DATA_DIR lease path is unreadable');
  }
  if (!pathStat.isFile() || pathStat.isSymbolicLink()) {
    throw leaseFailure('DATA_DIR_LEASE_BUSY', 'canonical DATA_DIR lease path is not a regular file');
  }
  let fd = -1;
  try {
    fd = openSync(linkPath, constants.O_RDONLY | constants.O_NOFOLLOW);
    const observed = readRecordFromFd(fd);
    if (!sameInode(pathStat, observed.stat)) {
      throw leaseFailure('DATA_DIR_LEASE_BUSY', 'canonical DATA_DIR lease path changed while read');
    }
    return Object.freeze({ path: linkPath, record: observed.record, stat: observed.stat });
  } catch (error) {
    if (error instanceof DataDirLeaseError) throw error;
    throw leaseFailure('DATA_DIR_LEASE_BUSY', 'canonical DATA_DIR lease path could not be opened safely');
  } finally {
    if (fd >= 0) closeSync(fd);
  }
}

function recordBytes(record: DataDirLeaseRecord): Buffer {
  const bytes = Buffer.from(`${JSON.stringify(record)}\n`, 'utf8');
  if (bytes.length > MAX_RECORD_BYTES) {
    throw leaseFailure('DATA_DIR_LEASE_BUSY', 'canonical DATA_DIR lease record exceeds its bound');
  }
  return bytes;
}

function recordEquals(left: DataDirLeaseRecord, right: DataDirLeaseRecord): boolean {
  return left.schemaVersion === right.schemaVersion
    && left.ownerToken === right.ownerToken
    && left.predecessorToken === right.predecessorToken
    && left.pid === right.pid
    && left.hostname === right.hostname
    && left.hostIdentity === right.hostIdentity
    && left.acquiredAtMs === right.acquiredAtMs;
}

/**
 * System Integration's fail-closed writer lease for the canonical DATA_DIR.
 * A mode-0600, fsynced immutable inode is admitted by an atomic hard link. A
 * dead owner's deterministic successor link is the compare-and-link recovery
 * slot, so concurrent contenders never need an unlink/create replacement gap.
 * The OS PID probe prevents a live same-host owner from being stolen; remote,
 * corrupt, future-dated, or unsupported filesystem state remains unavailable.
 */
export class DataDirLease {
  private readonly dataDir: string;
  private readonly rootPath: string;
  private readonly ownerToken: string;
  private readonly ownerPid = process.pid;
  private readonly ownerHostname = hostname();
  private readonly ownerHostIdentity: string;
  private readonly onLost: DataDirLeaseOptions['onLost'];
  private ownerRecord: DataDirLeaseRecord | null = null;
  private ownerFd = -1;
  private ownedEntryPath: string | null = null;
  private ownerWitnessPath: string | null = null;
  private rootStat: Stats | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private held = false;

  constructor(dataDir: string, options: Readonly<DataDirLeaseOptions> = {}) {
    const nowMs = Date.now();
    if (!validUtcMillis(nowMs)) {
      throw leaseFailure('DATA_DIR_LEASE_CLOCK_INVALID', 'DATA_DIR lease clock is invalid');
    }
    this.dataDir = path.resolve(dataDir);
    this.rootPath = path.join(this.dataDir, LEASE_ROOT);
    this.ownerToken = `${this.ownerPid}:${nowMs}:${randomUUID()}`;
    this.onLost = options.onLost;
    this.ownerHostIdentity = resolveHostIdentity(this.ownerHostname);

    let candidatePath: string | null = null;
    let linkedPath: string | null = null;
    try {
      this.rejectOrScavengeWitnesses(nowMs);
      const chain = this.readChain(nowMs);
      let predecessorToken: string | null = null;
      if (chain !== null) {
        const current = chain.tail.record;
        if (current.hostname !== this.ownerHostname
            || current.hostIdentity !== this.ownerHostIdentity) {
          throw leaseFailure(
            'DATA_DIR_LEASE_REMOTE_HOST',
            'canonical DATA_DIR is leased by an owner on another host',
          );
        }
        if (processIsAlive(current.pid)) {
          throw leaseFailure('DATA_DIR_LEASE_HELD', 'canonical DATA_DIR already has a live writer');
        }
        predecessorToken = current.ownerToken;
      }

      const ownerRecord: DataDirLeaseRecord = Object.freeze({
        schemaVersion: 1,
        ownerToken: this.ownerToken,
        predecessorToken,
        pid: this.ownerPid,
        hostname: this.ownerHostname,
        hostIdentity: this.ownerHostIdentity,
        acquiredAtMs: nowMs,
      });
      candidatePath = path.join(
        this.dataDir,
        `${LEASE_WITNESS_PREFIX}${this.digest(this.ownerToken)}`,
      );
      this.ownerFd = openSync(candidatePath, 'wx+', LEASE_MODE);
      fchmodSync(this.ownerFd, LEASE_MODE);
      const bytes = recordBytes(ownerRecord);
      let written = 0;
      while (written < bytes.length) {
        written += writeSync(this.ownerFd, bytes, written, bytes.length - written, written);
      }
      fsyncSync(this.ownerFd);

      linkedPath = predecessorToken === null
        ? this.rootPath
        : this.successorPath(predecessorToken);
      try {
        linkSync(candidatePath, linkedPath);
      } catch {
        throw leaseFailure('DATA_DIR_LEASE_BUSY', 'canonical DATA_DIR lease changed during acquisition');
      }
      this.ownerRecord = ownerRecord;
      this.ownedEntryPath = linkedPath;
      this.ownerWitnessPath = candidatePath;
      candidatePath = null;
      const acquiredChain = this.readChain(Date.now());
      if (acquiredChain === null) {
        throw leaseFailure('DATA_DIR_LEASE_BUSY', 'canonical DATA_DIR lease disappeared during acquisition');
      }
      this.rootStat = acquiredChain.root.stat;
      this.verifyOwnership(Date.now());
      this.held = true;
      this.startHeartbeat();
    } catch (error) {
      if (linkedPath !== null && this.ownerFd >= 0) this.unlinkOwnedPathIfExact(linkedPath);
      if (this.ownerWitnessPath !== null && this.ownerFd >= 0) {
        this.unlinkOwnedPathIfExact(this.ownerWitnessPath);
      }
      if (candidatePath !== null) {
        try { unlinkSync(candidatePath); } catch { /* Preserve the acquisition failure. */ }
      }
      if (this.ownerFd >= 0) {
        try { closeSync(this.ownerFd); } catch { /* Preserve the acquisition failure. */ }
        this.ownerFd = -1;
      }
      if (error instanceof DataDirLeaseError) throw error;
      throw leaseFailure('DATA_DIR_LEASE_BUSY', 'canonical DATA_DIR lease could not be acquired');
    }
  }

  private digest(value: string): string {
    return createHash('sha256').update(value, 'utf8').digest('hex');
  }

  private successorPath(ownerToken: string): string {
    return path.join(this.dataDir, `.cosmos-data-dir.lease.next-${this.digest(ownerToken)}`);
  }

  private witnessPath(ownerToken: string): string {
    return path.join(this.dataDir, `${LEASE_WITNESS_PREFIX}${this.digest(ownerToken)}`);
  }

  private rejectOrScavengeWitnesses(nowMs: number): void {
    let names: string[];
    try {
      names = readdirSync(this.dataDir)
        .filter((name) => name.startsWith(LEASE_WITNESS_PREFIX))
        .sort();
    } catch {
      throw leaseFailure('DATA_DIR_LEASE_BUSY', 'canonical DATA_DIR witnesses are unreadable');
    }
    if (names.length > MAX_WITNESSES) {
      throw leaseFailure('DATA_DIR_LEASE_BUSY', 'canonical DATA_DIR witness bound is exceeded');
    }
    const witnesses = names.map((name) => {
      if (!new RegExp(`^${LEASE_WITNESS_PREFIX}[0-9a-f]{64}$`, 'u').test(name)) {
        throw leaseFailure('DATA_DIR_LEASE_BUSY', 'canonical DATA_DIR witness name is invalid');
      }
      const witness = readLink(path.join(this.dataDir, name));
      if (witness === null || this.witnessPath(witness.record.ownerToken) !== witness.path) {
        throw leaseFailure('DATA_DIR_LEASE_BUSY', 'canonical DATA_DIR witness changed during scan');
      }
      this.validateTime(witness, nowMs);
      if (witness.record.hostname !== this.ownerHostname
          || witness.record.hostIdentity !== this.ownerHostIdentity) {
        throw leaseFailure(
          'DATA_DIR_LEASE_REMOTE_HOST',
          'canonical DATA_DIR has a witness from another host identity',
        );
      }
      if (processIsAlive(witness.record.pid)) {
        throw leaseFailure('DATA_DIR_LEASE_HELD', 'canonical DATA_DIR already has a live writer witness');
      }
      return witness;
    });
    for (const witness of witnesses) this.scavengeDeadWitness(witness);
  }

  private scavengeDeadWitness(witness: LeaseLink): void {
    const entryPath = witness.record.predecessorToken === null
      ? this.rootPath
      : this.successorPath(witness.record.predecessorToken);
    const entry = readLink(entryPath);
    if (entry !== null && sameInode(entry.stat, witness.stat)
        && recordEquals(entry.record, witness.record)) {
      unlinkSync(entryPath);
    }
    const readback = readLink(witness.path);
    if (readback === null
        || !sameInode(readback.stat, witness.stat)
        || !recordEquals(readback.record, witness.record)) {
      throw leaseFailure('DATA_DIR_LEASE_BUSY', 'dead DATA_DIR witness changed during scavenging');
    }
    try {
      unlinkSync(witness.path);
    } catch {
      throw leaseFailure('DATA_DIR_LEASE_BUSY', 'dead DATA_DIR witness could not be scavenged');
    }
  }

  private validateTime(link: LeaseLink, nowMs: number): void {
    if (!validUtcMillis(link.record.acquiredAtMs)
        || link.record.acquiredAtMs > nowMs
        || !Number.isFinite(link.stat.mtimeMs)
        || link.stat.mtimeMs < 0
        || link.stat.mtimeMs > MAX_UTC_MS
        || Math.floor(link.stat.mtimeMs) > nowMs) {
      throw leaseFailure(
        'DATA_DIR_LEASE_HELD',
        'canonical DATA_DIR lease time is invalid for safe recovery',
      );
    }
  }

  private readChain(nowMs: number): LeaseChain | null {
    const root = readLink(this.rootPath);
    if (root === null) return null;
    if (root.record.predecessorToken !== null) {
      throw leaseFailure('DATA_DIR_LEASE_BUSY', 'canonical DATA_DIR lease root has an invalid predecessor');
    }
    const tokens = new Set<string>();
    const inodes = new Set<string>();
    let tail = root;
    for (let depth = 0; depth < MAX_CHAIN_DEPTH; depth += 1) {
      this.validateTime(tail, nowMs);
      const inodeKey = `${tail.stat.dev}:${tail.stat.ino}`;
      if (tokens.has(tail.record.ownerToken) || inodes.has(inodeKey)) {
        throw leaseFailure('DATA_DIR_LEASE_BUSY', 'canonical DATA_DIR lease chain contains a cycle');
      }
      tokens.add(tail.record.ownerToken);
      inodes.add(inodeKey);
      const successor = readLink(this.successorPath(tail.record.ownerToken));
      if (successor === null) return Object.freeze({ root, tail });
      if (successor.record.predecessorToken !== tail.record.ownerToken) {
        throw leaseFailure('DATA_DIR_LEASE_BUSY', 'canonical DATA_DIR lease successor is invalid');
      }
      tail = successor;
    }
    throw leaseFailure('DATA_DIR_LEASE_BUSY', 'canonical DATA_DIR lease chain exceeds its bound');
  }

  private verifyOwnership(nowMs: number): void {
    if (this.ownerRecord === null
        || this.ownedEntryPath === null
        || this.ownerWitnessPath === null
        || this.rootStat === null
        || this.ownerFd < 0) {
      throw leaseFailure('DATA_DIR_LEASE_LOST', 'canonical DATA_DIR lease ownership is incomplete');
    }
    const chain = this.readChain(nowMs);
    const witness = readLink(this.ownerWitnessPath);
    const fdState = readRecordFromFd(this.ownerFd);
    if (chain === null
        || !sameInode(chain.root.stat, this.rootStat)
        || chain.tail.path !== this.ownedEntryPath
        || witness === null
        || !sameInode(witness.stat, fdState.stat)
        || !recordEquals(witness.record, this.ownerRecord)
        || !sameInode(chain.tail.stat, fdState.stat)
        || !recordEquals(chain.tail.record, this.ownerRecord)
        || !recordEquals(fdState.record, this.ownerRecord)) {
      throw leaseFailure('DATA_DIR_LEASE_LOST', 'canonical DATA_DIR lease ownership changed');
    }
  }

  private unlinkOwnedPathIfExact(linkPath: string): void {
    try {
      const link = readLink(linkPath);
      const fdState = this.ownerFd >= 0 ? readRecordFromFd(this.ownerFd) : null;
      if (link !== null
          && fdState !== null
          && sameInode(link.stat, fdState.stat)
          && link.record.ownerToken === this.ownerToken) {
        unlinkSync(linkPath);
      }
    } catch {
      // Cleanup is exact-owner only and never replaces the original failure.
    }
  }

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => this.heartbeat(), HEARTBEAT_INTERVAL_MS);
    this.heartbeatTimer.unref?.();
  }

  private heartbeat(): void {
    if (!this.held) return;
    const nowMs = Date.now();
    if (!validUtcMillis(nowMs)) {
      this.markLost();
      return;
    }
    try {
      this.verifyOwnership(nowMs);
      futimesSync(this.ownerFd, new Date(nowMs), new Date(nowMs));
      this.verifyOwnership(Date.now());
    } catch {
      this.markLost();
    }
  }

  private markLost(): void {
    const wasHeld = this.held;
    this.held = false;
    if (this.heartbeatTimer !== null) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
    if (this.ownerFd >= 0) {
      try { closeSync(this.ownerFd); } catch { /* Lease is already lost. */ }
      this.ownerFd = -1;
    }
    if (wasHeld) this.onLost?.('DATA_DIR_LEASE_LOST');
  }

  assertHeld(): void {
    if (!this.held) {
      throw leaseFailure('DATA_DIR_LEASE_LOST', 'canonical DATA_DIR writer lease was lost');
    }
    const nowMs = Date.now();
    try {
      if (!validUtcMillis(nowMs)) throw new Error('invalid clock');
      this.verifyOwnership(nowMs);
    } catch {
      this.markLost();
      throw leaseFailure('DATA_DIR_LEASE_LOST', 'canonical DATA_DIR writer lease was lost');
    }
  }

  release(): void {
    if (!this.held) {
      throw leaseFailure('DATA_DIR_LEASE_LOST', 'canonical DATA_DIR writer lease is not held');
    }
    if (this.heartbeatTimer !== null) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
    try {
      const nowMs = Date.now();
      if (!validUtcMillis(nowMs)) {
        throw leaseFailure('DATA_DIR_LEASE_CLOCK_INVALID', 'DATA_DIR lease clock is invalid');
      }
      this.verifyOwnership(nowMs);
      if (this.ownedEntryPath === null) {
        throw leaseFailure('DATA_DIR_LEASE_LOST', 'canonical DATA_DIR lease path is unavailable');
      }
      unlinkSync(this.ownedEntryPath);
      if (this.ownerWitnessPath === null) {
        throw leaseFailure('DATA_DIR_LEASE_LOST', 'canonical DATA_DIR witness path is unavailable');
      }
      const witness = readLink(this.ownerWitnessPath);
      const fdState = readRecordFromFd(this.ownerFd);
      if (witness === null
          || !sameInode(witness.stat, fdState.stat)
          || this.ownerRecord === null
          || !recordEquals(witness.record, this.ownerRecord)) {
        throw leaseFailure('DATA_DIR_LEASE_LOST', 'canonical DATA_DIR witness ownership changed');
      }
      unlinkSync(this.ownerWitnessPath);
      this.held = false;
      closeSync(this.ownerFd);
      this.ownerFd = -1;
    } catch (error) {
      const failure = error instanceof DataDirLeaseError
        ? error
        : leaseFailure('DATA_DIR_LEASE_RELEASE_FAILED', 'canonical DATA_DIR lease release failed');
      this.markLost();
      throw failure;
    }
  }
}
