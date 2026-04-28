import net from 'net';
import crypto from 'crypto';
import http from 'http';
import https from 'https';

import figlet from 'figlet';
import httpProxy from 'http-proxy';
import type { Logger } from 'pino';

import type { ClusterProxyConfig } from './config.js';
import { resolvedPrimaryZone } from './config.js';
import { createDns } from './dnsServer.js';
import { extAuth } from './ext-auth.js';
import type { ProxyStore } from './tui/store.js';
import { MAX_BODY_CAPTURE_BYTES } from './tui/store.js';

function errorOrSimpleDesc(error: Error, extra: Record<string, unknown> = {}) {
  const { code } = error as { code?: string };
  if (code === 'ECONNRESET') {
    return { ...extra, message: 'Connection reset' };
  }
  if (code === 'EPIPE') {
    return { ...extra, message: 'Connection closed' };
  }
  Object.assign(error, extra);
  return error;
}

function describeListenError(error: Error, protocol: 'http' | 'https', host: string, port: number) {
  const { code } = error as { code?: string };
  if (code === 'EACCES') {
    return `${protocol.toUpperCase()} bind failed on ${host}:${port}. Ports below 1024 usually require sudo.`;
  }
  if (code === 'EADDRINUSE') {
    return `${protocol.toUpperCase()} bind failed on ${host}:${port}. Address already in use.`;
  }
  return `${protocol.toUpperCase()} proxy server error`;
}

export async function createMainProxy({
  key,
  cert,
  host = '127.0.0.1',
  httpPort,
  httpsPort,
  dnsPort = 5533,
  logger,
  store,
  config,
}: {
  key: string;
  cert: string;
  host?: string;
  httpPort: number;
  httpsPort: number;
  dnsPort?: number;
  logger: Logger;
  store?: ProxyStore;
  config: ClusterProxyConfig;
}) {
  const proxyName = config.name || 'Cluster Proxy';
  const logoText = figlet.textSync(proxyName, { font: 'Standard' });
  const primaryZone = resolvedPrimaryZone(config);
  const defaultNamespace = config.defaultNamespace;
  const clusterDomain = config.clusterDomain || 'svc.cluster.local';
  const suppressLogPaths = config.suppressLogPaths ?? ['/_next'];

  const resolveAddress = host === '0.0.0.0' ? '127.0.0.1' : (host ?? '127.0.0.1');
  const dnsServer = await createDns({
    host: host ?? '127.0.0.1',
    dnsPort,
    resolveAddress,
    zones: config.zones,
    logger,
  });
  const registry = new Map<string, URL>();

  function syncRegistry() {
    if (!store) {
      return;
    }
    store.updateRegistry(
      Array.from(registry.entries()).map(([name, url]) => ({
        name,
        target: url.toString(),
      })),
    );
  }

  function captureRequest(
    req: http.IncomingMessage,
    protocol: 'http' | 'https',
    target: URL | undefined,
    isRegistered: boolean,
  ) {
    if (!store) {
      return;
    }
    const url = req.url || '/';
    if (suppressLogPaths.some((prefix) => url.startsWith(prefix))) {
      return;
    }
    const parsedHost = (req.headers.host || '').split('.')[0];
    const fullHost = req.headers.host || '';
    store.trackHost(parsedHost, fullHost, isRegistered);

    const id = crypto.randomUUID();
    const now = Date.now();
    (req as unknown as Record<string, unknown>).__captureId = id;
    (req as unknown as Record<string, unknown>).__captureStart = now;

    store.addRequest({
      id,
      timestamp: now,
      method: req.method || 'GET',
      url: req.url || '/',
      host: parsedHost,
      fullHost,
      protocol,
      requestHeaders: { ...req.headers },
      proxyHeaders: null,
      requestBody: null,
      requestBodyTruncated: false,
      statusCode: null,
      responseHeaders: null,
      responseBody: null,
      responseBodyTruncated: false,
      duration: null,
      target: target?.toString() || 'unknown',
      isRegistered,
      error: null,
    });
  }

  // Pre-parse aliases from config into a Map for fast lookup
  const aliases = new Map<string, URL>();
  if (config.aliases) {
    for (const [hostname, target] of Object.entries(config.aliases)) {
      aliases.set(hostname, new URL(target));
    }
  }

  // Pre-parse mapped hosts from config
  const mappedHosts = new Map<string, Map<string, string>>();
  if (config.mappedHosts) {
    for (const [hostname, mappings] of Object.entries(config.mappedHosts)) {
      mappedHosts.set(hostname, new Map(Object.entries(mappings)));
    }
  }

  /**
   * Look up a service name in the registry.
   * For dotted names like "myservice-api.payments", tries the full name first,
   * then falls back to the bare name ("myservice-api") since registrations are bare.
   */
  function registryLookup(serviceName: string): URL | undefined {
    if (registry.has(serviceName)) {
      return registry.get(serviceName);
    }
    if (serviceName.includes('.')) {
      const bareName = serviceName.split('.')[0];
      if (registry.has(bareName)) {
        return registry.get(bareName);
      }
    }
    return undefined;
  }

  /**
   * Build a cluster URL for a service name.
   * - Bare name ("myservice-api") → myservice-api.{defaultNamespace}.{clusterDomain}
   * - Dotted name ("myservice-api.payments") → myservice-api.payments.{clusterDomain}
   */
  function resolveClusterUrl(serviceName: string, protocol: string): URL {
    if (serviceName.includes('.')) {
      return new URL(`${protocol}//${serviceName}.${clusterDomain}`);
    }
    return new URL(`${protocol}//${serviceName}.${defaultNamespace}.${clusterDomain}`);
  }

  function getTarget(parsedUrl: URL) {
    // Check fixed aliases first
    if (aliases.has(parsedUrl.hostname)) {
      return aliases.get(parsedUrl.hostname);
    }

    // Check mapped hosts (path-prefix routing)
    const hostMappings = mappedHosts.get(parsedUrl.hostname);
    if (hostMappings) {
      const pathSegments = parsedUrl.pathname.split('/').filter(Boolean);
      const firstSegment = pathSegments[0];
      if (firstSegment && hostMappings.has(firstSegment)) {
        const serviceName = hostMappings.get(firstSegment) as string;
        return registryLookup(serviceName) || resolveClusterUrl(serviceName, parsedUrl.protocol);
      }
    }

    const host = parsedUrl.hostname.split('.')[0];
    if (registry.has(host)) {
      return registry.get(host);
    }

    // Strip zone suffix to get the service portion, then resolve via cluster
    const hostname = parsedUrl.hostname;
    const zone = config.zones.find((z) => hostname.endsWith(`.${z}`) || hostname === z);
    const servicePart = zone ? hostname.slice(0, -(zone.length + 1)) : hostname;
    if (!servicePart || servicePart === hostname) {
      // No zone match or bare zone hit — use hostname as bare service name
      return resolveClusterUrl(hostname, parsedUrl.protocol);
    }
    return resolveClusterUrl(servicePart, parsedUrl.protocol);
  }

  const proxy = httpProxy.createProxyServer({
    ssl: { key, cert },
    changeOrigin: true,
    secure: false,
    ws: true,
  });

  proxy.on('proxyReq', (_proxyReq, req) => {
    if (!store) {
      return;
    }
    const id = (req as unknown as Record<string, unknown>).__captureId as string | undefined;
    if (!id) {
      return;
    }

    const bodyChunks: Buffer[] = [];
    let totalSize = 0;
    let truncated = false;

    req.on('data', (chunk: Buffer) => {
      if (!truncated && totalSize + chunk.length <= MAX_BODY_CAPTURE_BYTES) {
        bodyChunks.push(chunk);
        totalSize += chunk.length;
      } else {
        truncated = true;
      }
    });

    req.on('end', () => {
      if (bodyChunks.length > 0) {
        store.updateRequest(id, {
          requestBody: Buffer.concat(bodyChunks),
          requestBodyTruncated: truncated,
        });
      }
    });
  });

  proxy.on('proxyRes', (proxyRes, req) => {
    if (!store) {
      return;
    }
    const id = (req as unknown as Record<string, unknown>).__captureId as string | undefined;
    const startTime = (req as unknown as Record<string, unknown>).__captureStart as
      | number
      | undefined;
    if (!id) {
      return;
    }

    const bodyChunks: Buffer[] = [];
    let totalSize = 0;
    let truncated = false;

    proxyRes.on('data', (chunk: Buffer) => {
      if (!truncated && totalSize + chunk.length <= MAX_BODY_CAPTURE_BYTES) {
        bodyChunks.push(chunk);
        totalSize += chunk.length;
      } else {
        truncated = true;
      }
    });

    proxyRes.on('end', () => {
      store.updateRequest(id, {
        statusCode: proxyRes.statusCode || 0,
        responseHeaders: { ...proxyRes.headers },
        responseBody: bodyChunks.length > 0 ? Buffer.concat(bodyChunks) : null,
        responseBodyTruncated: truncated,
        duration: startTime ? Date.now() - startTime : null,
      });
    });
  });

  proxy.on('error', (error, req, res) => {
    const { code } = error as { code?: string };
    // If connection refused, unregister the service so we fall back to the default upstream
    if (code === 'ECONNREFUSED' && req) {
      const host = req.headers.host?.split('.')[0];
      if (host && registry.has(host)) {
        logger.info({ host }, 'Connection refused, unregistering service');
        registry.delete(host);
        // Also clean up related -web entries since they point to the same service
        if (host.endsWith('-web')) {
          const baseName = host.replace(/-web$/, '');
          if (registry.has(baseName)) {
            registry.delete(baseName);
          }
        } else if (registry.has(`${host}-web`)) {
          registry.delete(`${host}-web`);
        }
        syncRegistry();
      }
    }
    if (store && req) {
      const id = (req as unknown as Record<string, unknown>).__captureId as string | undefined;
      const startTime = (req as unknown as Record<string, unknown>).__captureStart as
        | number
        | undefined;
      if (id) {
        store.updateRequest(id, {
          error: error.message,
          duration: startTime ? Date.now() - startTime : null,
        });
      }
    }
    logger.error(error, 'Proxy error');
    if (code === 'ECONNREFUSED' && req && res && 'writeHead' in res) {
      const host = req.headers.host || 'unknown';
      res.statusCode = 502;
      res.end(`${logoText}\n\nNo service registered on ${host}`);
    } else {
      res?.end();
    }
  });

  proxy.on('econnreset', (error) => {
    logger.error(error, 'ECONNRESET error');
    return false;
  });

  const httpsServer = https
    .createServer({ key, cert }, function (req, res) {
      req.socket.on('error', (error) => {
        logger.warn(error, 'https socket error');
      });
      try {
        logger.debug({ method: req.method, url: req.url }, 'https proxy request');
        const host = req.headers.host;
        const url = req.url;
        if (!host) {
          throw new Error('No host in request to ' + url);
        }
        const incomingUrl = new URL(req.url as string, 'https://' + host);
        const target = getTarget(incomingUrl);
        const targetUrl = target instanceof URL ? target : target ? new URL(target) : undefined;
        if (targetUrl && targetUrl.origin === incomingUrl.origin) {
          logger.warn(
            { target: targetUrl.toString(), host },
            'Blocked self-referencing proxy loop',
          );
          res.statusCode = 502;
          res.end(`${logoText}\n\nNo service registered on ${host}`);
          return;
        }
        captureRequest(req, 'https', targetUrl, registry.has(incomingUrl.hostname.split('.')[0]));
        extAuth(req, config)
          .then((headers) => {
            if (store && Object.keys(headers).length > 0) {
              const id = (req as unknown as Record<string, unknown>).__captureId as string;
              if (id) {
                store.updateRequest(id, { proxyHeaders: headers });
              }
            }
            logger.debug({ target, incomingUrl }, 'Proxying request');
            proxy.web(req, res, { target, headers });
          })
          .catch((e) => {
            logger.warn(e, 'Failed to authenticate request');
            res.end();
          });
      } catch (error) {
        logger.error(error, 'Failed to handle http request');
        res.end();
      }
    })
    .listen(httpsPort, host, () => {
      logger.info({ httpsPort, host }, 'https proxy listening');
    });

  const httpServer = http
    .createServer({}, function (req, res) {
      try {
        req.socket.on('error', (error) => {
          logger.warn(error, 'http socket error');
        });
        logger.debug({ method: req.method, url: req.url }, 'http proxy request');
        const host = req.headers.host;
        const url = req.url;

        if (host?.startsWith('registry')) {
          if (req.url === '/register' && req.method === 'POST') {
            let body = '';
            req.on('data', (chunk) => {
              body += chunk.toString();
            });
            req.on('end', () => {
              try {
                const data = JSON.parse(body);
                const { name, port, protocol } = data as {
                  name: string;
                  port: number;
                  protocol: 'http' | 'https';
                };
                // Remove any existing registrations using the same port
                const portStr = String(port);
                for (const [existingName, existingUrl] of registry.entries()) {
                  if (existingUrl.port === portStr && existingName !== name) {
                    logger.info(
                      { name: existingName, port },
                      'Removing previous registration on same port',
                    );
                    registry.delete(existingName);
                  }
                }
                registry.set(name, new URL(`${protocol}://${primaryZone}:${port}`));
                logger.info(
                  { from: name, to: registry.get(name)?.toString() },
                  'Registry updated',
                );
                if (name.endsWith('-web')) {
                  const baseName = name.replace(/-web$/, '');
                  registry.set(baseName, new URL(`${protocol}://${primaryZone}:${port}`));
                  logger.info(
                    { from: baseName, to: registry.get(name)?.toString() },
                    'Registry updated',
                  );
                }
                syncRegistry();
                res.statusCode = 200;
                res.end('OK');
              } catch (error) {
                logger.error(error, 'Failed to parse request body');
                res.statusCode = 400;
                res.end('Invalid JSON');
              }
            });
            return;
          }

          if (req.method === 'GET') {
            const reqUrl = new URL(req.url || '/', `http://${host}`);
            const pathname = reqUrl.pathname;

            if (pathname === '/requests') {
              res.setHeader('Content-Type', 'application/json');
              if (!store) {
                res.statusCode = 503;
                res.end('{"error":"store unavailable"}');
                return;
              }
              let requests = [...store.requests].reverse(); // newest first
              const hostFilter = reqUrl.searchParams.get('host');
              const statusFilter = reqUrl.searchParams.get('status');
              const methodFilter = reqUrl.searchParams.get('method');
              const pathFilter = reqUrl.searchParams.get('path');
              const limit = Math.max(
                1,
                parseInt(reqUrl.searchParams.get('limit') || '50', 10) || 50,
              );

              if (hostFilter) {requests = requests.filter((r) => r.host?.includes(hostFilter));}
              if (statusFilter)
                {requests = requests.filter((r) => r.statusCode === parseInt(statusFilter, 10));}
              if (methodFilter)
                {requests = requests.filter(
                  (r) => r.method?.toUpperCase() === methodFilter.toUpperCase(),
                );}
              if (pathFilter) {requests = requests.filter((r) => r.url?.includes(pathFilter));}

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
              return;
            }

            if (pathname.startsWith('/requests/')) {
              res.setHeader('Content-Type', 'application/json');
              if (!store) {
                res.statusCode = 503;
                res.end('{"error":"store unavailable"}');
                return;
              }
              const id = pathname.slice('/requests/'.length);
              const request = store.requests.find((r) => r.id === id);
              if (!request) {
                res.statusCode = 404;
                res.end('{"error":"not found"}');
                return;
              }

              // Buffer bodies to UTF-8 strings, capped at MAX_BODY_CAPTURE_BYTES.
              // Binary content (images, protobuf) will produce garbled output.
              const safeStringify = (buf: Buffer | null) => {
                if (!buf) {return null;}
                try {
                  return buf.toString('utf-8').slice(0, MAX_BODY_CAPTURE_BYTES);
                } catch {
                  return '[binary content]';
                }
              };

              res.end(
                JSON.stringify({
                  ...request,
                  requestBody: safeStringify(request.requestBody),
                  responseBody: safeStringify(request.responseBody),
                  requestBodyTruncated:
                    (request.requestBody?.length ?? 0) > MAX_BODY_CAPTURE_BYTES,
                  responseBodyTruncated:
                    (request.responseBody?.length ?? 0) > MAX_BODY_CAPTURE_BYTES,
                }),
              );
              return;
            }

            if (pathname === '/hosts') {
              res.setHeader('Content-Type', 'application/json');
              if (!store) {
                res.statusCode = 503;
                res.end('{"error":"store unavailable"}');
                return;
              }
              res.end(JSON.stringify(Object.fromEntries(store.seenHosts)));
              return;
            }

            if (pathname === '/registry') {
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify(store?.registry ?? []));
              return;
            }
          }

          // Unknown control-plane path
          res.setHeader('Content-Type', 'application/json');
          res.statusCode = 404;
          res.end(
            '{"error":"not found","endpoints":["/register","/requests","/requests/:id","/hosts","/registry"]}',
          );
          return;
        }

        if (!host) {
          throw new Error('No host in request to ' + url);
        }
        const incomingUrl = new URL(req.url as string, 'http://' + host);
        const target = getTarget(incomingUrl);
        const targetUrl = target instanceof URL ? target : target ? new URL(target) : undefined;
        if (targetUrl && targetUrl.origin === incomingUrl.origin) {
          logger.warn(
            { target: targetUrl.toString(), host },
            'Blocked self-referencing proxy loop',
          );
          res.statusCode = 502;
          res.end(`${logoText}\n\nNo service registered on ${host}`);
          return;
        }
        captureRequest(req, 'http', targetUrl, registry.has(incomingUrl.hostname.split('.')[0]));
        logger.debug({ target, incomingUrl }, 'Proxying request');
        proxy.web(req, res, { target });
      } catch (error) {
        logger.error(error, 'Failed to handle http request');
        res.end();
      }
    })
    .listen(httpPort, host, () => {
      logger.info({ httpPort, host }, 'http proxy listening');
    });

  const getHostAndPort = (url: URL) => {
    return { host: url.hostname, port: Number(url.port || 443) };
  };

  httpsServer.on('connect', function (req, socket) {
    const originalUrl = new URL(`https://${req.url}`);
    const { host, port } = getHostAndPort(originalUrl);

    if (store) {
      store.trackHost(host, originalUrl.hostname, registry.has(host));
    }

    if (originalUrl.hostname !== host) {
      logger.info(
        {
          original: req.url,
          target: `${host}:${port}`,
        },
        'TLS connect',
      );
    } else {
      logger.debug({ target: req.url }, 'TLS connect');
    }
    socket.on('error', (error) => {
      logger.warn(errorOrSimpleDesc(error, { url: req.url }), 'socket error');
    });
    const srvSocket = net.connect(port, host, () => {
      try {
        socket.write(
          'HTTP/1.1 200 Connection Established\r\n' + 'Proxy-agent: Node-Proxy\r\n' + '\r\n',
        );
        srvSocket.pipe(socket);
        socket.pipe(srvSocket);
      } catch (error) {
        logger.warn(errorOrSimpleDesc(error as Error, { url: req.url }), 'Failed to connect');
        try {
          socket.end();
        } catch (error) {
          logger.warn(
            errorOrSimpleDesc(error as Error, { url: req.url }),
            'Failed to close socket',
          );
        }
      }
    });
    srvSocket.on('error', (error) => {
      logger.warn(errorOrSimpleDesc(error, { url: req.url }), 'Remote socket failure');
    });
  });

  httpsServer.on('error', (err) => {
    logger.error(err, describeListenError(err, 'https', host, httpsPort));
  });
  httpServer.on('error', (err) => {
    logger.error(err, describeListenError(err, 'http', host, httpPort));
  });

  function handleWebsocketUpgrade(
    req: http.IncomingMessage,
    socket: net.Socket,
    head: Buffer,
    protocol: 'http' | 'https',
  ) {
    socket.on('error', (error) => {
      logger.warn(errorOrSimpleDesc(error, { url: req.url }), `${protocol} websocket socket error`);
    });

    try {
      const host = req.headers.host;
      if (!host) {
        throw new Error('Missing host header for websocket upgrade');
      }

      const incomingUrl = new URL(req.url ?? '', `${protocol}://${host}`);
      const target = getTarget(incomingUrl);
      const targetUrl = target instanceof URL ? target : target ? new URL(target) : undefined;

      if (targetUrl && targetUrl.origin === incomingUrl.origin) {
        logger.warn(
          { target: targetUrl.toString(), host },
          'Blocked self-referencing websocket loop',
        );
        socket.destroy();
        return;
      }

      const wsId = crypto.randomUUID();
      if (store) {
        const wsHost = incomingUrl.hostname.split('.')[0];
        store.trackHost(wsHost, incomingUrl.hostname, registry.has(wsHost));
        store.addRequest({
          id: wsId,
          timestamp: Date.now(),
          method: 'WS',
          url: req.url || '/',
          host: wsHost,
          fullHost: incomingUrl.hostname,
          protocol,
          requestHeaders: { ...req.headers },
          proxyHeaders: null,
          requestBody: null,
          requestBodyTruncated: false,
          statusCode: 101,
          responseHeaders: null,
          responseBody: null,
          responseBodyTruncated: false,
          duration: null,
          target: target?.toString() || 'unknown',
          isRegistered: registry.has(wsHost),
          error: null,
        });
      }

      logger.debug({ url: req.url, target }, 'Upgrading to websocket');

      extAuth(req, config)
        .then((headers) => {
          if (store && Object.keys(headers).length > 0) {
            store.updateRequest(wsId, { proxyHeaders: headers });
          }
          proxy.ws(req, socket, head, { target, headers });
        })
        .catch((error) => {
          logger.warn(error, 'Failed to authenticate websocket request');
          socket.destroy();
        });
    } catch (error) {
      logger.error(error, 'Failed to handle websocket upgrade');
      socket.destroy();
    }
  }

  httpsServer.on('upgrade', (req, socket, head) => {
    handleWebsocketUpgrade(req, socket as unknown as net.Socket, head, 'https');
  });

  httpServer.on('upgrade', (req, socket, head) => {
    handleWebsocketUpgrade(req, socket as unknown as net.Socket, head, 'http');
  });

  return { proxy, httpsServer, httpServer, dnsServer };
}
