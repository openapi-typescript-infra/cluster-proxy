import type { IncomingMessage } from 'http';

import { fetch } from 'undici';

import type { ClusterProxyConfig } from './config.ts';

const EXT_AUTH_CACHE_SIZE = 20;

const extAuthCache = new Map<string, Promise<Record<string, string>>>();

export type ExtAuthEndpointResolver = (endpoint: URL) => URL | Promise<URL>;
type ExtAuthRequest = Pick<IncomingMessage, 'headers'>;

function cacheKey(endpoint: string, cookie: string, authorization?: string | string[]) {
  const authHeader = Array.isArray(authorization)
    ? authorization.join('\0')
    : (authorization ?? '');
  return JSON.stringify([endpoint, cookie, authHeader]);
}

function parseAuthEndpoint(endpoint: string) {
  try {
    return new URL(endpoint);
  } catch {
    return new URL(`http://${endpoint}`);
  }
}

function getCachedAuthHeaders(
  key: string,
  fetchHeaders: () => Promise<Record<string, string>>,
): Promise<Record<string, string>> {
  const cached = extAuthCache.get(key);
  if (cached) {
    extAuthCache.delete(key);
    extAuthCache.set(key, cached);
    return cached;
  }

  const pending = fetchHeaders().catch((error: unknown) => {
    if (extAuthCache.get(key) === pending) {
      extAuthCache.delete(key);
    }
    throw error;
  });
  extAuthCache.set(key, pending);

  if (extAuthCache.size > EXT_AUTH_CACHE_SIZE) {
    const oldestKey = extAuthCache.keys().next().value;
    if (oldestKey) {
      extAuthCache.delete(oldestKey);
    }
  }

  return pending;
}

export async function extAuth(
  req: ExtAuthRequest,
  config: ClusterProxyConfig,
  resolveEndpoint?: ExtAuthEndpointResolver,
) {
  const auth = config.auth;
  if (!auth) {
    return {};
  }
  const outgoing: Record<string, string> = { ...(auth.headers || {}) };
  if (req.headers.cookie && req.headers.cookie.includes(auth.cookieName)) {
    outgoing.cookie = req.headers.cookie;
  }
  if (req.headers.authorization) {
    outgoing.authorization = req.headers.authorization;
  }

  if (Object.keys(outgoing).length > 0) {
    const configuredEndpoint = parseAuthEndpoint(auth.endpoint);
    const endpoint = resolveEndpoint
      ? await resolveEndpoint(configuredEndpoint)
      : configuredEndpoint;

    const fetchHeaders = async () => {
      const headers: Record<string, string> = {};
      const response = await fetch(endpoint, {
        method: 'GET',
        headers: outgoing,
      });
      for (const name of auth.headerNames) {
        const value = response.headers?.get(name);
        if (value) {
          headers[name] = value;
        }
      }
      return headers;
    };

    if (outgoing.cookie) {
      const headers = await getCachedAuthHeaders(
        cacheKey(auth.endpoint, outgoing.cookie, outgoing.authorization),
        fetchHeaders,
      );
      return { ...headers };
    }

    return fetchHeaders();
  }
  return {};
}
