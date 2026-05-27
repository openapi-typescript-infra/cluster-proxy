import type { IncomingMessage } from 'http';

import { fetch } from 'undici';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import type { ClusterProxyConfig } from './config.ts';
import { extAuth } from './ext-auth.ts';

vi.mock('undici', () => ({
  fetch: vi.fn(),
}));

const fetchMock = vi.mocked(fetch);

function request(headers: IncomingMessage['headers']) {
  return { headers };
}

function response(headers: Record<string, string>): Awaited<ReturnType<typeof fetch>> {
  return new Response(null, { headers });
}

describe('extAuth', () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  test('caches concurrent auth fetches for the same cookie input', async () => {
    const config: ClusterProxyConfig = {
      zones: ['local.dev'],
      auth: {
        cookieName: 'session',
        endpoint: 'http://auth.default/token-check',
        headerNames: ['x-auth-token'],
      },
    };
    let resolveFetch: (value: Awaited<ReturnType<typeof fetch>>) => void = () => {};
    const pendingFetch: ReturnType<typeof fetch> = new Promise((resolve) => {
      resolveFetch = resolve;
    });
    fetchMock.mockReturnValue(pendingFetch);

    const first = extAuth(request({ cookie: 'session=abc' }), config);
    const second = extAuth(request({ cookie: 'session=abc' }), config);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    resolveFetch(response({ 'x-auth-token': 'token-abc' }));

    await expect(Promise.all([first, second])).resolves.toEqual([
      { 'x-auth-token': 'token-abc' },
      { 'x-auth-token': 'token-abc' },
    ]);
  });

  test('resolves the configured endpoint before fetching auth headers', async () => {
    const config: ClusterProxyConfig = {
      zones: ['local.dev'],
      auth: {
        cookieName: 'session',
        endpoint: 'auth.default/token-check?source=proxy',
        headerNames: ['x-auth-token'],
      },
    };
    fetchMock.mockResolvedValue(response({ 'x-auth-token': 'resolved-token' }));

    const headers = await extAuth(request({ cookie: 'session=resolved' }), config, (endpoint) => {
      expect(endpoint.toString()).toBe('http://auth.default/token-check?source=proxy');
      return new URL('http://127.0.0.1:8080/token-check?source=proxy');
    });

    expect(headers).toEqual({ 'x-auth-token': 'resolved-token' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]?.toString()).toBe(
      'http://127.0.0.1:8080/token-check?source=proxy',
    );
  });
});
