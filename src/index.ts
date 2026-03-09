export { createMainProxy } from './mainProxy.js';
export { createDns } from './dnsServer.js';
export { extAuth } from './ext-auth.js';
export { getServerType } from './detect.js';
export { getTerseLogger } from './terseLogger.js';
export { ProxyStore, MAX_BODY_CAPTURE_BYTES } from './tui/store.js';
export { createStoreDestination } from './tui/pinoDestination.js';
export { App } from './tui/App.js';

export type { ClusterProxyConfig } from './config.js';
export {
  loadConfig,
  resolvedPrimaryZone,
  defaultCertPaths,
  defaultMkcertDomains,
} from './config.js';
export type { CapturedRequest, SeenHost, LogEntry, RegistryEntry, ViewMode } from './tui/types.js';
