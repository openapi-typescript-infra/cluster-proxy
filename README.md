# @openapi-typescript-infra/cluster-proxy

A configurable local development proxy that routes traffic to Kubernetes-style services. It combines an HTTP/HTTPS proxy, a DNS server, a service registry, and a terminal UI into a single tool so you can develop against multiple services locally without editing `/etc/hosts` or managing individual DNS entries.

## Features

- **DNS server** that resolves your configured zones to the proxy
- **Service registry** where local services announce themselves on startup
- **TLS termination** with automatic certificate generation via [mkcert](https://github.com/FiloSottile/mkcert)
- **Cluster fallback** — unregistered hostnames are forwarded to the real cluster
- **WebSocket support** with full upgrade handling
- **Auth token exchange** — optionally extracts auth cookies and forwards them as headers
- **Terminal UI** with live request log, service registry view, filtering, and request inspection
- **macOS resolver integration** — automatically creates `/etc/resolver/*` files when running with `sudo`

## Quick start

### With a config file

Create a `cluster-proxy.json`:

```json
{
  "zones": ["local.dev.mycompany.com", "mc"],
  "clusterSuffix": ".mc.svc.cluster.local"
}
```

```sh
npx @openapi-typescript-infra/cluster-proxy --config cluster-proxy.json
```

### With CLI args only

```sh
npx @openapi-typescript-infra/cluster-proxy \
  --zone local.dev.mycompany.com \
  --zone mc \
  --clusterSuffix .mc.svc.cluster.local
```

### On standard ports (requires sudo)

```sh
sudo npx @openapi-typescript-infra/cluster-proxy \
  --config cluster-proxy.json \
  --host 127.0.0.2 --httpPort 80 --httpsPort 443
```

## How it works

```
                        ┌──────────────┐
   Browser request      │  DNS Server  │  Resolves *.zone → proxy IP
   *.local.dev.myco.com │  (port 5533) │
          │              └──────────────┘
          ▼
   ┌──────────────────┐
   │   HTTP / HTTPS    │
   │   Proxy Server    │
   └────────┬─────────┘
            │
    ┌───────┴────────┐
    ▼                ▼
 Registered?     Not registered
    │                │
    ▼                ▼
 localhost:PORT   hostname.clusterSuffix
 (from registry) (e.g. api.mc.svc.cluster.local)
```

1. The DNS server resolves any hostname under your configured zones to the proxy's IP address.
2. When a request arrives, the proxy extracts the first subdomain (e.g. `api` from `api.local.dev.mycompany.com`).
3. If that name is in the local registry, the request routes to `localhost:<registered port>`.
4. Otherwise it forwards to the cluster at `<hostname>.<clusterSuffix>`.

## Configuration

### Config file

All options can be set in a JSON config file passed via `--config`:

```json
{
  "name": "My Proxy",
  "zones": ["local.dev.mycompany.com", "mc"],
  "clusterSuffix": ".mc.svc.cluster.local",
  "primaryZone": "local.dev.mycompany.com",
  "certs": {
    "keyFile": "~/.certs/my.keyfile.pem",
    "certFile": "~/.certs/my.certfile.pem",
    "mkcertDomains": ["local.dev.mycompany.com", "*.local.dev.mycompany.com"]
  },
  "auth": {
    "cookieName": "session_token",
    "endpoint": "http://auth.mc.svc.cluster.local/token-check",
    "headerNames": ["x-auth-token"]
  },
  "host": "127.0.0.1",
  "httpPort": 9080,
  "httpsPort": 9443,
  "dnsPort": 5533
}
```

| Field | Required | Default | Description |
|-------|----------|---------|-------------|
| `zones` | yes | — | DNS zones the proxy handles. Requests to `*.zone` are resolved and routed by the proxy. |
| `clusterSuffix` | yes | — | Suffix appended to single-word hostnames for cluster routing (e.g. `.mc.svc.cluster.local`). |
| `name` | no | `"Cluster Proxy"` | Display name for the TUI logo and error pages. |
| `primaryZone` | no | `zones[0]` | The zone used for registry URLs and default certificate paths. |
| `certs.keyFile` | no | `~/.certs/_wildcard.<primaryZone>.keyfile.pem` | Path to TLS key file. |
| `certs.certFile` | no | `~/.certs/_wildcard.<primaryZone>.certfile.pem` | Path to TLS cert file. |
| `certs.mkcertDomains` | no | `[primaryZone, "*.primaryZone"]` | Domains passed to `mkcert` when auto-generating certificates. |
| `auth.cookieName` | no | — | Cookie to look for on incoming requests. Auth is disabled if `auth` is not set. |
| `auth.endpoint` | no | — | URL to call for token exchange when the cookie is present. |
| `auth.headerNames` | no | — | Response headers to extract from the auth endpoint and forward upstream. |
| `host` | no | `127.0.0.1` | Bind address. |
| `httpPort` | no | `9080` | HTTP listen port. |
| `httpsPort` | no | `9443` | HTTPS listen port. |
| `dnsPort` | no | `5533` | DNS listen port. Set to `0` to disable DNS. |
| `logLevel` | no | `debug` | Pino log level. |

### CLI arguments

CLI arguments override config file values.

```
--config <path>       Path to JSON config file
--zone <domain>       DNS zone (repeatable, e.g. --zone foo.com --zone bar)
--clusterSuffix <s>   Cluster service suffix
--name <name>         Display name
--host <ip>           Bind address              (default: 127.0.0.1)
--httpPort <port>     HTTP listen port          (default: 9080)
--httpsPort <port>    HTTPS listen port         (default: 9443)
--dnsPort <port>      DNS listen port, 0=off    (default: 5533)
--key <path>          TLS key file path
--cert <path>         TLS cert file path
--logLevel <level>    Pino log level            (default: debug)
--no-pretty           Disable pretty-printed logs
--tui false           Disable the terminal UI
```

## Service registration

Services register themselves by sending a POST to the proxy's registry endpoint:

```sh
curl http://registry.local.dev.mycompany.com/register \
  -H "Content-Type: application/json" \
  -d '{"name": "my-api", "port": 8080, "protocol": "http"}'
```

After registration, `my-api.local.dev.mycompany.com` routes to `localhost:8080`.

- Services ending in `-web` automatically get a base name alias (e.g. registering `my-api-web` also creates a `my-api` route).
- If a new service registers on the same port as an existing one, the old registration is replaced.
- If the proxy gets `ECONNREFUSED` when forwarding to a registered service, it automatically unregisters and falls back to cluster routing.

## Auth token exchange

When `auth` is configured, the proxy checks each HTTPS request for the specified cookie. If found, it calls the auth endpoint with the cookie and extracts the configured header from the response, forwarding it upstream. This is useful for reproducing the behavior of an auth sidecar (like Envoy) in local development.

## Terminal UI

When running in an interactive terminal, the proxy displays a TUI with:

- ASCII art logo and connection info
- Live list of registered services and cluster hosts
- Merged activity timeline (logs + requests)
- Request inspector with full headers and body

**Keyboard shortcuts:**

| Key | Action |
|-----|--------|
| `f` | Open filter (by hostname or path, supports `*` wildcards) |
| `c` | Clear request history |
| `q` | Quit |
| `Enter` | Inspect selected request |
| `Esc` / `b` | Back to dashboard |
| `Up` / `Down` | Scroll / navigate |

## DNS and macOS resolver

When `dnsPort` is non-zero, the proxy starts a DNS server that resolves all configured zones to the bind address. On macOS with `sudo`, it automatically creates resolver files at `/etc/resolver/<zone>` so lookups work without any manual DNS configuration. These files are cleaned up on exit.

Without `sudo`, a warning is logged with the manual commands to run.

## Programmatic usage

The proxy can also be used as a library:

```ts
import { createMainProxy, type ClusterProxyConfig } from '@openapi-typescript-infra/cluster-proxy';

const config: ClusterProxyConfig = {
  zones: ['local.dev.mycompany.com'],
  clusterSuffix: '.mc.svc.cluster.local',
};

const { proxy, httpsServer, httpServer, dnsServer } = await createMainProxy({
  key: '...pem contents...',
  cert: '...pem contents...',
  httpPort: 9080,
  httpsPort: 9443,
  logger,
  config,
});
```

## License

MIT
