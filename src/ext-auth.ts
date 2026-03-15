import type { IncomingMessage } from 'http';

import type { ClusterProxyConfig } from './config.ts';

export async function extAuth(req: IncomingMessage, config: ClusterProxyConfig) {
  const headers: Record<string, string> = {};
  const auth = config.auth;
  if (!auth) {
    return headers;
  }
  const outgoing: Record<string, string> = {};
  if (req.headers.cookie && req.headers.cookie.includes(auth.cookieName)) {
    outgoing.cookie = req.headers.cookie;
  }
  if (req.headers.authorization) {
    outgoing.authorization = req.headers.authorization;
  }

  if (Object.keys(outgoing).length > 0) {
    const response = await fetch(auth.endpoint, {
      method: 'GET',
      headers: outgoing,
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
