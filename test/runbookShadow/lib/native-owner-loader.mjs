import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { ROOT } from './constants.mjs';

const OWNER_ROOT = path.join(ROOT, 'server/src');
const OWNER_ROOT_URL = pathToFileURL(`${OWNER_ROOT}${path.sep}`).href;

function mapBuiltSpecifierToSource(specifier, context, nextResolve) {
  try {
    return nextResolve(specifier, context);
  } catch (error) {
    if (!specifier.startsWith('.') || !specifier.endsWith('.js') || !context.parentURL?.startsWith(OWNER_ROOT_URL)) {
      throw error;
    }
    const sourceUrl = new URL(specifier.replace(/\.js$/, '.ts'), context.parentURL);
    const sourcePath = fileURLToPath(sourceUrl);
    if (!sourcePath.startsWith(`${OWNER_ROOT}${path.sep}`) || !existsSync(sourcePath)) throw error;
    return { url: sourceUrl.href, shortCircuit: true };
  }
}

/**
 * Loads an existing pure TypeScript owner with Node 22's native type stripping.
 * The temporary hook only maps that owner's emitted `.js` specifiers back to
 * present `.ts` source files; it neither transforms owner logic nor reads npm.
 */
export async function importNativeOwner(relativePath) {
  if (!/^server\/src\/[A-Za-z0-9_./-]+\.ts$/.test(relativePath) || relativePath.includes('..')) {
    throw new TypeError('RUNBOOK_PORT_OWNER_PATH_INVALID');
  }
  const ownerPath = path.join(ROOT, relativePath);
  if (!ownerPath.startsWith(`${OWNER_ROOT}${path.sep}`) || !existsSync(ownerPath)) {
    throw new TypeError('RUNBOOK_PORT_OWNER_SOURCE_MISSING');
  }
  const hooks = registerHooks({ resolve: mapBuiltSpecifierToSource });
  try {
    return await import(pathToFileURL(ownerPath).href);
  } finally {
    hooks.deregister();
  }
}
