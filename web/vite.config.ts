import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv, type UserConfig } from 'vite';

export const DEFAULT_VITE_PORT = 5173;
export const DEFAULT_API_PROXY_TARGET = 'http://127.0.0.1:8080';

type ViteEnvironment = Readonly<Record<string, string | undefined>>;

export function resolveVitePort(rawPort: string | undefined): number {
  if (rawPort === undefined) return DEFAULT_VITE_PORT;
  if (!/^[0-9]+$/u.test(rawPort)) {
    throw new Error('VITE_PORT must be an integer from 1 through 65535.');
  }

  const port = Number(rawPort);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error('VITE_PORT must be an integer from 1 through 65535.');
  }
  return port;
}

export function resolveApiProxyTarget(rawTarget: string | undefined): string {
  if (rawTarget === undefined) return DEFAULT_API_PROXY_TARGET;

  let target: URL;
  try {
    target = new URL(rawTarget);
  } catch {
    throw new Error('VITE_API_PROXY_TARGET must be an absolute HTTP(S) origin.');
  }

  const isHttp = target.protocol === 'http:' || target.protocol === 'https:';
  const isOriginOnly = target.pathname === '/' && target.search === '' && target.hash === '';
  if (!isHttp || !isOriginOnly || target.username !== '' || target.password !== '') {
    throw new Error('VITE_API_PROXY_TARGET must be a credential-free HTTP(S) origin.');
  }
  return target.origin;
}

export function buildViteConfig(environment: ViteEnvironment): UserConfig {
  const port = resolveVitePort(environment.VITE_PORT);
  const apiProxyTarget = resolveApiProxyTarget(environment.VITE_API_PROXY_TARGET);

  return {
    plugins: [react()],
    server: {
      port,
      strictPort: true,
      proxy: {
        '/api': { target: apiProxyTarget },
        '/ws': { target: apiProxyTarget, ws: true },
      },
    },
  };
}

export default defineConfig(({ mode }) => (
  buildViteConfig(loadEnv(mode, process.cwd(), 'VITE_'))
));
