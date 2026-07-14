import {
  closeSync,
  constants,
  fstatSync,
  openSync,
  readFileSync,
} from 'node:fs';
import type {
  DeploymentFreezeFileRead,
  DeploymentFreezeFileSystem,
} from '../systemIntegration/ops/types.js';

class NodeDeploymentFreezeFileSystem implements DeploymentFreezeFileSystem {
  inspectParentDirectory(parentPath: string): 'TRUSTED_DIRECTORY' | 'UNAVAILABLE' {
    let descriptor: number | null = null;
    try {
      descriptor = openSync(parentPath, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
      return fstatSync(descriptor).isDirectory() ? 'TRUSTED_DIRECTORY' : 'UNAVAILABLE';
    } catch {
      return 'UNAVAILABLE';
    } finally {
      if (descriptor !== null) {
        try { closeSync(descriptor); } catch { /* caller remains fail closed */ }
      }
    }
  }

  readRegularFileNoFollow(markerPath: string, maximumBytes: number): DeploymentFreezeFileRead {
    let descriptor: number | null = null;
    try {
      descriptor = openSync(markerPath, constants.O_RDONLY | constants.O_NOFOLLOW);
      const before = fstatSync(descriptor);
      if (!before.isFile() || before.size < 2 || before.size > maximumBytes) {
        return Object.freeze({ state: 'UNAVAILABLE' });
      }
      const raw = readFileSync(descriptor, 'utf8');
      const after = fstatSync(descriptor);
      if (
        before.dev !== after.dev
        || before.ino !== after.ino
        || before.size !== after.size
        || before.mtimeMs !== after.mtimeMs
        || Buffer.byteLength(raw, 'utf8') !== after.size
      ) return Object.freeze({ state: 'UNAVAILABLE' });
      return Object.freeze({ state: 'AVAILABLE', raw });
    } catch (error) {
      if (
        error !== null
        && typeof error === 'object'
        && 'code' in error
        && error.code === 'ENOENT'
      ) return Object.freeze({ state: 'ABSENT' });
      return Object.freeze({ state: 'UNAVAILABLE' });
    } finally {
      if (descriptor !== null) {
        try { closeSync(descriptor); } catch { /* no mutation or retry */ }
      }
    }
  }
}

export function createNodeDeploymentFreezeFileSystem(): DeploymentFreezeFileSystem {
  return Object.freeze(new NodeDeploymentFreezeFileSystem());
}
