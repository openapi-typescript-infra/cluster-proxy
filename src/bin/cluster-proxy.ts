#!/usr/bin/env node
/* eslint-disable no-console */
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import { execSync } from 'child_process';

import React from 'react';
import { render } from 'ink';
import { pino } from 'pino';
import minimist from 'minimist';
import figlet from 'figlet';

import type { ClusterProxyConfig } from '../config.js';
import {
  loadConfig,
  resolvedPrimaryZone,
  defaultCertPaths,
  defaultMkcertDomains,
  expandHomePath,
} from '../config.js';
import { createMainProxy } from '../mainProxy.js';
import { getTerseLogger } from '../terseLogger.js';
import { ProxyStore } from '../tui/store.js';
import { createStoreDestination } from '../tui/pinoDestination.js';
import { App } from '../tui/App.js';

const argv = minimist(process.argv.slice(2), {
  boolean: ['pretty', 'tui'],
  string: [
    'config',
    'key',
    'cert',
    'host',
    'logLevel',
    'zone',
    'defaultNamespace',
    'clusterDomain',
    'name',
  ],
  default: {
    pretty: true,
    tui: true,
  },
}) as {
  config?: string;
  key?: string;
  cert?: string;
  host?: string;
  httpPort?: string;
  httpsPort?: string;
  dnsPort?: string;
  apiPort?: string;
  logLevel?: string;
  pretty?: boolean;
  tui?: boolean;
  zone?: string | string[];
  defaultNamespace?: string;
  clusterDomain?: string;
  name?: string;
};

// Load config file if specified, otherwise use CLI args to build config
let config: ClusterProxyConfig;
if (argv.config) {
  config = loadConfig(argv.config);
  // CLI args override config file values
  if (argv.host) {
    config.host = argv.host;
  }
  if (argv.httpPort) {
    config.httpPort = Number(argv.httpPort);
  }
  if (argv.httpsPort) {
    config.httpsPort = Number(argv.httpsPort);
  }
  if (argv.dnsPort !== undefined) {
    config.dnsPort = Number(argv.dnsPort);
  }
  if (argv.apiPort !== undefined) {
    config.apiPort = Number(argv.apiPort);
  }
  if (argv.logLevel) {
    config.logLevel = argv.logLevel;
  }
  if (argv.name) {
    config.name = argv.name;
  }
  if (argv.zone) {
    config.zones = Array.isArray(argv.zone) ? argv.zone : [argv.zone];
  }
  if (argv.defaultNamespace) {
    config.defaultNamespace = argv.defaultNamespace;
  }
  if (argv.clusterDomain) {
    config.clusterDomain = argv.clusterDomain;
  }
} else {
  // Build config entirely from CLI args
  const zones = argv.zone ? (Array.isArray(argv.zone) ? argv.zone : [argv.zone]) : undefined;
  if (!zones || zones.length === 0) {
    console.error(
      'Error: At least one zone is required.\n' +
        'Provide --config <path> or --zone <domain> [--zone <domain2>] --defaultNamespace <ns>\n\n' +
        'Example:\n' +
        '  cluster-proxy --zone local.dev.mycompany.com --zone mc --defaultNamespace mc\n\n' +
        'Or with a config file:\n' +
        '  cluster-proxy --config cluster-proxy.json',
    );
    process.exit(1);
  }
  if (!argv.defaultNamespace) {
    console.error(
      'Error: --defaultNamespace is required when not using a config file.\n' +
        'Example: --defaultNamespace mc',
    );
    process.exit(1);
  }
  config = {
    name: argv.name,
    zones,
    defaultNamespace: argv.defaultNamespace,
    clusterDomain: argv.clusterDomain,
    host: argv.host,
    httpPort: argv.httpPort ? Number(argv.httpPort) : undefined,
    httpsPort: argv.httpsPort ? Number(argv.httpsPort) : undefined,
    dnsPort: argv.dnsPort !== undefined ? Number(argv.dnsPort) : undefined,
    apiPort: argv.apiPort !== undefined ? Number(argv.apiPort) : undefined,
    logLevel: argv.logLevel,
  };
}

const useTui = argv.pretty !== false && argv.tui !== false && !!process.stdout.isTTY;
const store = new ProxyStore();

const logger = useTui
  ? pino({ level: config.logLevel || 'debug' }, createStoreDestination(store))
  : pino({
      ...(argv.pretty
        ? {
            transport: {
              target: 'pino-pretty',
            },
          }
        : {}),
      level: config.logLevel || 'debug',
    });

const homeDir = os.homedir();
const host = config.host || '127.0.0.1';
const httpPort = config.httpPort || 9080;
const httpsPort = config.httpsPort || 9443;
const dnsPort = config.dnsPort !== undefined ? config.dnsPort : 5533;
const primaryZone = resolvedPrimaryZone(config);
const proxyName = config.name || 'Cluster Proxy';

let addedLoopbackAlias = false;

function ensureLoopbackAlias(addr: string) {
  if (addr === '127.0.0.1' || !addr.startsWith('127.')) {
    return;
  }
  try {
    const lo0 = execSync('ifconfig lo0', { encoding: 'utf-8' });
    if (lo0.includes(addr)) {
      return;
    }
    execSync(`ifconfig lo0 alias ${addr}`);
    addedLoopbackAlias = true;
    logger.info({ addr }, 'Added loopback alias');
  } catch {
    logger.warn(`Could not add loopback alias. Run: sudo ifconfig lo0 alias ${addr}`);
  }
}

function ensureResolver(dnsHost: string, port: number) {
  const expected = `nameserver ${dnsHost}\nport ${port}\n`;
  let allUpToDate = true;
  try {
    execSync('mkdir -p /etc/resolver');
    for (const zone of config.zones) {
      const resolverPath = `/etc/resolver/${zone}`;
      const current = fs.existsSync(resolverPath) ? fs.readFileSync(resolverPath, 'utf-8') : null;
      if (current === expected) {
        continue;
      }
      allUpToDate = false;
      fs.writeFileSync(resolverPath, expected);
      logger.info({ zone }, current === null ? 'Created resolver file' : 'Updated resolver file');
    }
    if (allUpToDate) {
      logger.info('Resolver files already up to date');
    }
  } catch {
    const paths = config.zones.map((z) => `/etc/resolver/${z}`).join(' ');
    const zoneList = config.zones.map((z) => `*.${z}`).join(' and ');
    logger.warn(
      `Could not write resolver files. To resolve ${zoneList}, run:\n` +
        '  sudo mkdir -p /etc/resolver\n' +
        `  for f in ${paths}; do echo "nameserver ${dnsHost}\\nport ${port}" | sudo tee $f; done`,
    );
  }
}

function cleanup() {
  for (const zone of config.zones) {
    try {
      fs.unlinkSync(`/etc/resolver/${zone}`);
    } catch {
      // ignore
    }
  }
  if (addedLoopbackAlias) {
    try {
      execSync(`ifconfig lo0 -alias ${host}`);
    } catch {
      // ignore
    }
  }
}

if (!useTui && argv.pretty) {
  console.log(figlet.textSync(proxyName));
}

ensureLoopbackAlias(host);

if (dnsPort > 0) {
  ensureResolver(host, dnsPort);
}

process.on('exit', cleanup);

process.on('uncaughtException', (error) => {
  console.error('Uncaught error', error);
  return;
});

// Resolve certificate paths
const certDefaults = defaultCertPaths(homeDir, primaryZone);
const keyfile = expandHomePath(argv.key || config.certs?.keyFile || certDefaults.keyFile, homeDir);
const certfile = expandHomePath(
  argv.cert || config.certs?.certFile || certDefaults.certFile,
  homeDir,
);

if (!fs.existsSync(keyfile) || !fs.existsSync(certfile)) {
  console.error('Certificate files not found. Running mkcert...');
  const domains = config.certs?.mkcertDomains || defaultMkcertDomains(primaryZone);
  try {
    fs.mkdirSync(path.dirname(keyfile), { recursive: true });
    fs.mkdirSync(path.dirname(certfile), { recursive: true });
    execSync(
      `mkcert --cert-file ${JSON.stringify(certfile)} --key-file ${JSON.stringify(keyfile)} ${domains.map((d) => JSON.stringify(d)).join(' ')}`,
    );
  } catch (error) {
    console.error('Failed to generate certificates:', error);
    process.exit(1);
  }
}

createMainProxy({
  key: fs.readFileSync(keyfile, 'utf-8'),
  cert: fs.readFileSync(certfile, 'utf-8'),
  host,
  httpPort,
  httpsPort,
  dnsPort,
  logger: getTerseLogger(logger),
  store,
  config,
})
  .then(() => {
    // Start the HTTP API server for programmatic access to captured traffic
    const apiPort = config.apiPort ?? 9999;
    if (apiPort > 0) {
      const apiServer = http.createServer((req, res) => {
        res.setHeader('Content-Type', 'application/json');

        const url = new URL(req.url!, `http://${req.headers.host}`);
        const pathname = url.pathname;

        if (pathname === '/requests') {
          let requests = [...store.requests].reverse(); // newest first
          const hostFilter = url.searchParams.get('host');
          const statusFilter = url.searchParams.get('status');
          const methodFilter = url.searchParams.get('method');
          const pathFilter = url.searchParams.get('path');
          const limit = Math.max(1, parseInt(url.searchParams.get('limit') || '50', 10) || 50);

          if (hostFilter) requests = requests.filter((r) => r.host?.includes(hostFilter));
          if (statusFilter)
            requests = requests.filter((r) => r.statusCode === parseInt(statusFilter, 10));
          if (methodFilter)
            requests = requests.filter(
              (r) => r.method?.toUpperCase() === methodFilter.toUpperCase(),
            );
          if (pathFilter) requests = requests.filter((r) => r.url?.includes(pathFilter));

          // Summary view: omit headers and bodies
          const summary = requests.slice(0, limit).map((r) => ({
            id: r.id,
            timestamp: r.timestamp,
            method: r.method,
            url: r.url,
            host: r.host,
            fullHost: r.fullHost,
            protocol: r.protocol,
            statusCode: r.statusCode,
            duration: r.duration,
            target: r.target,
            isRegistered: r.isRegistered,
            error: r.error,
          }));
          res.end(JSON.stringify(summary));
        } else if (pathname.startsWith('/requests/')) {
          const id = pathname.slice('/requests/'.length);
          const request = store.requests.find((r) => r.id === id);
          if (!request) {
            res.statusCode = 404;
            res.end('{"error":"not found"}');
            return;
          }

          // Buffer bodies to UTF-8 strings, capped at 256KB.
          // Binary content (images, protobuf) will produce garbled output.
          const safeStringify = (buf: Buffer | null) => {
            if (!buf) return null;
            try {
              return buf.toString('utf-8').slice(0, 256 * 1024);
            } catch {
              return '[binary content]';
            }
          };

          res.end(
            JSON.stringify({
              ...request,
              requestBody: safeStringify(request.requestBody),
              responseBody: safeStringify(request.responseBody),
              requestBodyTruncated: (request.requestBody?.length ?? 0) > 256 * 1024,
              responseBodyTruncated: (request.responseBody?.length ?? 0) > 256 * 1024,
            }),
          );
        } else if (pathname === '/hosts') {
          // seenHosts is a Map<string, SeenHost> -- must convert for JSON
          res.end(JSON.stringify(Object.fromEntries(store.seenHosts)));
        } else if (pathname === '/registry') {
          res.end(JSON.stringify(store.registry ?? []));
        } else {
          res.statusCode = 404;
          res.end(
            '{"error":"not found","endpoints":["/requests","/requests/:id","/hosts","/registry"]}',
          );
        }
      });

      // Don't crash the proxy if API port is taken
      apiServer.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE') {
          logger.warn({ port: apiPort }, 'API server port in use, continuing without API');
        } else {
          logger.error({ err }, 'API server error');
        }
      });

      // unref() so the API server doesn't prevent clean exit
      apiServer.listen(apiPort, '127.0.0.1', () => {
        logger.info({ port: apiPort }, 'API server listening');
      });
      apiServer.unref();
    }

    if (useTui) {
      const { waitUntilExit } = render(
        React.createElement(App, { store, host, httpPort, httpsPort, name: proxyName }),
        {
          patchConsole: true,
        },
      );
      void waitUntilExit().then(() => {
        process.exit(0);
      });
    }
  })
  .catch((error) => {
    console.error('Proxy startup failed', error);
    process.exit(1);
  });
