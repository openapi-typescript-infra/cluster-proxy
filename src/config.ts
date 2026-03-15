import fs from 'fs';
import os from 'os';
import path from 'path';

/**
 * Configuration for the cluster proxy.
 *
 * Can be provided via a JSON config file (--config path) or individual CLI args.
 * CLI args override config file values.
 */
export interface ClusterProxyConfig {
  /** Display name used in the TUI logo and error pages (default: "Cluster Proxy") */
  name?: string;

  /**
   * DNS zones the proxy handles. Requests to *.zone will be resolved by the
   * built-in DNS server and routed by the proxy.
   * Example: ["local.dev.mycompany.com", "mc"]
   */
  zones: string[];

  /**
   * The primary zone used for registry URLs and certificate defaults.
   * Defaults to zones[0].
   */
  primaryZone?: string;

  /**
   * Kubernetes cluster service suffix appended when routing single-word
   * hostnames to the cluster. Example: ".mc.svc.cluster.local"
   */
  clusterSuffix: string;

  /** TLS certificate configuration */
  certs?: {
    /** Path to the TLS key file */
    keyFile?: string;
    /** Path to the TLS cert file */
    certFile?: string;
    /**
     * Domains to pass to mkcert when auto-generating certificates.
     * Example: ["local.dev.mycompany.com", "*.local.dev.mycompany.com"]
     */
    mkcertDomains?: string[];
  };

  /**
   * Optional external auth configuration. When set, the proxy will check
   * for the specified cookie and call the auth endpoint to exchange it
   * for an auth header that gets forwarded upstream.
   */
  auth?: {
    /** Cookie name to look for (e.g. "s_jwt_dev") */
    cookieName: string;
    /** URL to call for token exchange */
    endpoint: string;
    /** Response headers to extract and forward (e.g. ["x-auth-token"]) */
    headerNames: string[];
  };

  /**
   * Fixed host aliases. Maps a full hostname to a target URL, bypassing
   * the normal routing logic (registry lookup, cluster suffix, etc.).
   * Example: { "foo.local.dev.mycompany.com": "https://local.dev.sesamecare.com:3000" }
   */
  aliases?: Record<string, string>;

  /**
   * Path-based host mappings, similar to Envoy route tables.
   * Maps a hostname to a set of path-prefix → service-name mappings.
   * The first URL path segment is matched against the mapping keys, and the
   * request is routed to the corresponding service (via registry or cluster suffix).
   * The original path is forwarded as-is (no rewriting).
   *
   * Example: { "api.mycompany.com": { "myservice": "myservice-api" } }
   * A request to api.mycompany.com/myservice/foo/bar routes to myservice-api with path /myservice/foo/bar.
   */
  mappedHosts?: Record<string, Record<string, string>>;

  /** Network binding configuration (overridable via CLI args) */
  host?: string;
  httpPort?: number;
  httpsPort?: number;
  dnsPort?: number;
  logLevel?: string;
}

export function loadConfig(configPath: string): ClusterProxyConfig {
  const raw = fs.readFileSync(configPath, 'utf-8');
  return JSON.parse(raw) as ClusterProxyConfig;
}

export function resolvedPrimaryZone(config: ClusterProxyConfig): string {
  return config.primaryZone || config.zones[0];
}

export function expandHomePath(filePath: string, homeDir = os.homedir()): string {
  if (filePath === '~') {
    return homeDir;
  }
  if (filePath.startsWith(`~${path.sep}`)) {
    return path.join(homeDir, filePath.slice(2));
  }
  return filePath;
}

/**
 * Default certificate paths derived from the primary zone.
 */
export function defaultCertPaths(homeDir: string, primaryZone: string) {
  return {
    keyFile: `${homeDir}/.certs/_wildcard.${primaryZone}.keyfile.pem`,
    certFile: `${homeDir}/.certs/_wildcard.${primaryZone}.certfile.pem`,
  };
}

/**
 * Default mkcert domains derived from the primary zone.
 */
export function defaultMkcertDomains(primaryZone: string) {
  return [primaryZone, `*.${primaryZone}`];
}
