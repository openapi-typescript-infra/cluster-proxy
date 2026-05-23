import { describe, expect, test } from 'vitest';

import { ProxyStore } from './store.ts';

describe('ProxyStore request retention', () => {
  test('retains only the configured number of requests', () => {
    const store = new ProxyStore({ maxStoredRequests: 2 });

    for (let i = 0; i < 3; i++) {
      store.addRequest({
        id: String(i),
        timestamp: i,
        method: 'GET',
        url: '/',
        host: 'example',
        fullHost: 'example.test',
        protocol: 'http',
        requestHeaders: {},
        proxyHeaders: null,
        requestBody: null,
        requestBodyTruncated: false,
        statusCode: null,
        responseHeaders: null,
        responseBody: null,
        responseBodyTruncated: false,
        duration: null,
        target: 'unknown',
        isRegistered: false,
        error: null,
      });
    }

    expect(store.requests.map((request) => request.id)).toEqual(['1', '2']);
  });

  test('can disable request retention', () => {
    const store = new ProxyStore({ maxStoredRequests: 0 });

    store.addRequest({
      id: '1',
      timestamp: 1,
      method: 'GET',
      url: '/',
      host: 'example',
      fullHost: 'example.test',
      protocol: 'http',
      requestHeaders: {},
      proxyHeaders: null,
      requestBody: null,
      requestBodyTruncated: false,
      statusCode: null,
      responseHeaders: null,
      responseBody: null,
      responseBodyTruncated: false,
      duration: null,
      target: 'unknown',
      isRegistered: false,
      error: null,
    });

    expect(store.requests).toEqual([]);
  });
});
