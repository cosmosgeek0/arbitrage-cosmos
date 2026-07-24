import { lstatSync, realpathSync } from 'node:fs';
import {
  dirname, isAbsolute, relative, resolve, sep,
} from 'node:path';

import { fail } from '../lib.mjs';

function exactAbsolutePath(path, label) {
  if (typeof path !== 'string' || !isAbsolute(path) || resolve(path) !== path) {
    fail(`${label} is not one exact absolute path`);
  }
  return path;
}

function pathIsWithin(candidate, root) {
  return candidate === root || candidate.startsWith(`${root}${sep}`);
}

function pathsIntersect(left, right) {
  return pathIsWithin(left, right) || pathIsWithin(right, left);
}

export function projectPhysicalPath(path, label) {
  exactAbsolutePath(path, label);
  let cursor = path;
  for (;;) {
    let stat;
    try {
      stat = lstatSync(cursor, { throwIfNoEntry: false });
    } catch (error) {
      if (!['EACCES', 'EPERM'].includes(error?.code)) {
        fail(`${label} nearest existing ancestor cannot be inspected`);
      }
      stat = undefined;
    }
    if (stat !== undefined) {
      let physicalAncestor;
      try {
        physicalAncestor = realpathSync(cursor);
      } catch {
        fail(`${label} nearest existing ancestor cannot be canonicalized`);
      }
      const suffix = relative(cursor, path);
      return suffix.length === 0
        ? physicalAncestor
        : resolve(physicalAncestor, suffix);
    }
    const parent = dirname(cursor);
    if (parent === cursor) {
      fail(`${label} has no existing physical ancestor`);
    }
    cursor = parent;
  }
}

export function requireAssemblyOutputDisjoint(outputRoot, protectedRoots) {
  exactAbsolutePath(outputRoot, 'release assembly output root');
  if (!Array.isArray(protectedRoots) || protectedRoots.length === 0) {
    fail('release assembly protected root policy is unavailable');
  }
  for (const protectedRoot of protectedRoots) {
    exactAbsolutePath(protectedRoot, 'release assembly protected root');
    const projectedRoot = projectPhysicalPath(
      protectedRoot,
      'release assembly protected root',
    );
    if (pathsIntersect(outputRoot, protectedRoot)
        || pathsIntersect(outputRoot, projectedRoot)) {
      fail('release assembly output root intersects a protected production root');
    }
  }
}
