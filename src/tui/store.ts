import { EventEmitter } from 'events';

import type { CapturedRequest, SeenHost, LogEntry, RegistryEntry } from './types.ts';

const MAX_STORED_REQUESTS = 2000;
const MAX_LOG_ENTRIES = 500;
export const MAX_BODY_CAPTURE_BYTES = 256 * 1024;

export class ProxyStore extends EventEmitter {
  requests: CapturedRequest[] = [];
  seenHosts: Map<string, SeenHost> = new Map();
  registry: RegistryEntry[] = [];
  logs: LogEntry[] = [];
  activeFilter: string | null = null;

  private pendingEvents = new Set<string>();
  private flushScheduled = false;

  private scheduleEmit(event: string) {
    this.pendingEvents.add(event);
    if (!this.flushScheduled) {
      this.flushScheduled = true;
      setImmediate(() => {
        this.flushScheduled = false;
        for (const e of this.pendingEvents) {
          this.emit(e);
        }
        this.pendingEvents.clear();
      });
    }
  }

  addRequest(req: CapturedRequest): void {
    this.requests.push(req);
    if (this.requests.length > MAX_STORED_REQUESTS) {
      this.requests.splice(0, this.requests.length - MAX_STORED_REQUESTS);
    }
    this.scheduleEmit('requests');
  }

  updateRequest(id: string, update: Partial<CapturedRequest>): void {
    const req = this.requests.find((r) => r.id === id);
    if (req) {
      Object.assign(req, update);
      this.scheduleEmit('requests');
    }
  }

  updateRegistry(entries: RegistryEntry[]): void {
    this.registry = entries;
    // Update isRegistered flag on seen hosts
    const registeredNames = new Set(entries.map((e) => e.name));
    for (const host of this.seenHosts.values()) {
      host.isRegistered = registeredNames.has(host.host);
    }
    this.scheduleEmit('registry');
  }

  trackHost(host: string, fullHost: string, isRegistered: boolean): void {
    const existing = this.seenHosts.get(host);
    if (existing) {
      existing.lastSeen = Date.now();
      existing.requestCount++;
      existing.isRegistered = isRegistered;
    } else {
      this.seenHosts.set(host, {
        host,
        fullHost,
        firstSeen: Date.now(),
        lastSeen: Date.now(),
        requestCount: 1,
        isRegistered,
      });
    }
    this.scheduleEmit('hosts');
  }

  addLog(entry: LogEntry): void {
    this.logs.push(entry);
    if (this.logs.length > MAX_LOG_ENTRIES) {
      this.logs.splice(0, this.logs.length - MAX_LOG_ENTRIES);
    }
    this.scheduleEmit('logs');
  }

  clearRequests(): void {
    this.requests = [];
    this.scheduleEmit('requests');
  }

  setFilter(pattern: string | null): void {
    this.activeFilter = pattern;
    this.scheduleEmit('filter');
  }

  getFilteredRequests(): CapturedRequest[] {
    if (!this.activeFilter) {
      return this.requests;
    }
    const filter = this.activeFilter.toLowerCase();
    // Support simple glob with * wildcard
    if (filter.includes('*')) {
      const regex = new RegExp(
        '^' + filter.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$',
        'i',
      );
      return this.requests.filter(
        (r) => regex.test(r.host) || regex.test(r.fullHost) || regex.test(r.url),
      );
    }
    return this.requests.filter(
      (r) =>
        r.host.toLowerCase().includes(filter) ||
        r.fullHost.toLowerCase().includes(filter) ||
        r.url.toLowerCase().includes(filter),
    );
  }
}
