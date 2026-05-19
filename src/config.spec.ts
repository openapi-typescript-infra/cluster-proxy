import { describe, expect, test } from 'vitest';

import { defaultCertPaths, expandHomePath, resolvedClusterTarget } from './config.ts';

describe('expandHomePath', () => {
  test('expands a tilde-prefixed path', () => {
    expect(expandHomePath('~/.certs/example.pem', '/tmp/home')).toBe(
      '/tmp/home/.certs/example.pem',
    );
  });

  test('leaves non-home-relative paths unchanged', () => {
    expect(expandHomePath('/tmp/example.pem', '/tmp/home')).toBe('/tmp/example.pem');
  });
});

describe('defaultCertPaths', () => {
  test('uses wildcard filenames under the home cert directory', () => {
    expect(defaultCertPaths('/tmp/home', 'local.dev.mycompany.com')).toEqual({
      keyFile: '/tmp/home/.certs/_wildcard.local.dev.mycompany.com.keyfile.pem',
      certFile: '/tmp/home/.certs/_wildcard.local.dev.mycompany.com.certfile.pem',
    });
  });
});

describe('resolvedClusterTarget', () => {
  test('uses default namespace and cluster domain config', () => {
    expect(
      resolvedClusterTarget({
        zones: ['local.dev.mycompany.com'],
        defaultNamespace: 'mc',
        clusterDomain: 'svc.cluster.local',
      }),
    ).toEqual({
      defaultNamespace: 'mc',
      clusterDomain: 'svc.cluster.local',
    });
  });

  test('derives namespace and domain from clusterSuffix', () => {
    expect(
      resolvedClusterTarget({
        zones: ['local.dev.mycompany.com'],
        clusterSuffix: '.development.svc.cluster.local',
      }),
    ).toEqual({
      defaultNamespace: 'development',
      clusterDomain: 'svc.cluster.local',
    });
  });
});
