import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import path from 'node:path';

const LEASE_DATABASE = 'cosmos.lease.db';
const HEARTBEAT_INTERVAL_MS = 2_000;
const MAX_UTC_MS = 4_102_444_800_000;

export type DataDirLeaseErrorCode =
  | 'DATA_DIR_LEASE_HELD'
  | 'DATA_DIR_LEASE_REMOTE_HOST'
  | 'DATA_DIR_LEASE_BUSY'
  | 'DATA_DIR_LEASE_CLOCK_INVALID'
  | 'DATA_DIR_LEASE_LOST'
  | 'DATA_DIR_LEASE_RELEASE_FAILED';

interface DataDirLeaseRow {
  readonly owner_token: string;
  readonly pid: number;
  readonly hostname: string;
  readonly acquired_at_ms: number;
  readonly heartbeat_at_ms: number;
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

/**
 * System Integration's fail-closed writer lease for the canonical DATA_DIR. SQLite supplies
 * the atomic cross-process compare-and-set; the OS PID probe prevents a live
 * same-host owner from being stolen even if its event loop stops heartbeating.
 * Remote-host leases are never stolen because their process liveness cannot be
 * proven locally.
 */
export class DataDirLease {
  private readonly database: Database.Database;
  private readonly ownerToken: string;
  private readonly ownerPid = process.pid;
  private readonly ownerHostname = hostname();
  private readonly onLost: DataDirLeaseOptions['onLost'];
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private held = false;

  constructor(dataDir: string, options: Readonly<DataDirLeaseOptions> = {}) {
    const nowMs = Date.now();
    if (!validUtcMillis(nowMs)) {
      throw leaseFailure('DATA_DIR_LEASE_CLOCK_INVALID', 'DATA_DIR lease clock is invalid');
    }
    this.ownerToken = `${this.ownerPid}:${nowMs}:${randomUUID()}`;
    this.onLost = options.onLost;
    this.database = new Database(path.join(path.resolve(dataDir), LEASE_DATABASE));
    try {
      this.database.pragma('busy_timeout = 0');
      this.database.pragma('journal_mode = WAL');
      this.database.exec(`
        CREATE TABLE IF NOT EXISTS data_dir_lease (
          singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
          owner_token TEXT NOT NULL,
          pid INTEGER NOT NULL,
          hostname TEXT NOT NULL,
          acquired_at_ms INTEGER NOT NULL,
          heartbeat_at_ms INTEGER NOT NULL
        )
      `);
      const acquire = this.database.transaction(() => this.acquire(nowMs));
      acquire.immediate();
      this.held = true;
      this.heartbeatTimer = setInterval(() => this.heartbeat(), HEARTBEAT_INTERVAL_MS);
      this.heartbeatTimer.unref?.();
    } catch (error) {
      try {
        this.database.close();
      } catch {
        // Preserve the exact acquisition failure.
      }
      if (error instanceof DataDirLeaseError) throw error;
      throw leaseFailure('DATA_DIR_LEASE_BUSY', 'canonical DATA_DIR lease could not be acquired');
    }
  }

  private acquire(nowMs: number): void {
    const current = this.database.prepare(`
      SELECT owner_token, pid, hostname, acquired_at_ms, heartbeat_at_ms
      FROM data_dir_lease WHERE singleton = 1
    `).get() as DataDirLeaseRow | undefined;
    if (current !== undefined) {
      if (current.hostname !== this.ownerHostname) {
        throw leaseFailure(
          'DATA_DIR_LEASE_REMOTE_HOST',
          'canonical DATA_DIR is leased by an owner on another host',
        );
      }
      if (processIsAlive(current.pid)) {
        throw leaseFailure('DATA_DIR_LEASE_HELD', 'canonical DATA_DIR already has a live writer');
      }
      const heartbeatAgeMs = nowMs - current.heartbeat_at_ms;
      if (!validUtcMillis(current.heartbeat_at_ms)
          || !Number.isSafeInteger(heartbeatAgeMs)
          || heartbeatAgeMs < 0) {
        throw leaseFailure(
          'DATA_DIR_LEASE_HELD',
          'canonical DATA_DIR lease heartbeat is invalid for safe stale recovery',
        );
      }
      const replaced = this.database.prepare(`
        UPDATE data_dir_lease
        SET owner_token = ?, pid = ?, hostname = ?, acquired_at_ms = ?, heartbeat_at_ms = ?
        WHERE singleton = 1 AND owner_token = ? AND heartbeat_at_ms = ?
      `).run(
        this.ownerToken,
        this.ownerPid,
        this.ownerHostname,
        nowMs,
        nowMs,
        current.owner_token,
        current.heartbeat_at_ms,
      );
      if (replaced.changes !== 1) {
        throw leaseFailure('DATA_DIR_LEASE_BUSY', 'stale DATA_DIR lease changed during recovery');
      }
      return;
    }
    this.database.prepare(`
      INSERT INTO data_dir_lease
        (singleton, owner_token, pid, hostname, acquired_at_ms, heartbeat_at_ms)
      VALUES (1, ?, ?, ?, ?, ?)
    `).run(this.ownerToken, this.ownerPid, this.ownerHostname, nowMs, nowMs);
  }

  private heartbeat(): void {
    if (!this.held) return;
    const nowMs = Date.now();
    if (!validUtcMillis(nowMs)) {
      this.markLost();
      return;
    }
    try {
      const result = this.database.prepare(`
        UPDATE data_dir_lease SET heartbeat_at_ms = ?
        WHERE singleton = 1 AND owner_token = ? AND pid = ? AND hostname = ?
      `).run(nowMs, this.ownerToken, this.ownerPid, this.ownerHostname);
      if (result.changes !== 1) this.markLost();
    } catch {
      this.markLost();
    }
  }

  private markLost(): void {
    const wasHeld = this.held;
    this.held = false;
    if (this.heartbeatTimer !== null) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
    if (wasHeld) this.onLost?.('DATA_DIR_LEASE_LOST');
  }

  assertHeld(): void {
    if (!this.held) {
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
      const release = this.database.transaction(() => this.database.prepare(`
        DELETE FROM data_dir_lease
        WHERE singleton = 1 AND owner_token = ? AND pid = ? AND hostname = ?
      `).run(this.ownerToken, this.ownerPid, this.ownerHostname));
      const result = release.immediate();
      if (result.changes !== 1) {
        throw leaseFailure('DATA_DIR_LEASE_LOST', 'canonical DATA_DIR lease ownership changed');
      }
      this.held = false;
      this.database.close();
    } catch (error) {
      if (error instanceof DataDirLeaseError) throw error;
      throw leaseFailure('DATA_DIR_LEASE_RELEASE_FAILED', 'canonical DATA_DIR lease release failed');
    }
  }
}
