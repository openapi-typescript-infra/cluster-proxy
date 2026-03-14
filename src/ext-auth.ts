import type { IncomingMessage } from 'http';

import type { ClusterProxyConfig } from './config.ts';

export async function extAuth(req: IncomingMessage, config: ClusterProxyConfig) {
  const headers: Record<string, string> = {};
  const auth = config.auth;
  if (!auth) {
    return headers;
  }
  if (req.headers.cookie && req.headers.cookie.includes(auth.cookieName)) {
    const response = await fetch(auth.endpoint, {
      method: 'GET',
      headers: {
        cookie: req.headers.cookie,
      },
      credentials: 'include',
    });
    for (const name of auth.headerNames) {
      const value = response.headers?.get(name);
      if (value) {
        headers[name] = value;
      }
    }
  }
  return headers;
}
