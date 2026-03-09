import { useState, useEffect, useCallback } from 'react';

import type { ProxyStore } from '../store.ts';
import type { CapturedRequest, SeenHost, LogEntry, RegistryEntry } from '../types.ts';

export interface StoreState {
  requests: CapturedRequest[];
  filteredRequests: CapturedRequest[];
  seenHosts: SeenHost[];
  registry: RegistryEntry[];
  logs: LogEntry[];
  activeFilter: string | null;
}

export function useStore(store: ProxyStore): StoreState {
  const getState = useCallback(
    (): StoreState => ({
      requests: store.requests,
      filteredRequests: store.getFilteredRequests(),
      seenHosts: Array.from(store.seenHosts.values()).sort(
        (a, b) => b.requestCount - a.requestCount,
      ),
      registry: store.registry,
      logs: store.logs,
      activeFilter: store.activeFilter,
    }),
    [store],
  );

  const [state, setState] = useState<StoreState>(getState);

  useEffect(() => {
    const update = () => setState(getState());
    const events = ['requests', 'registry', 'hosts', 'logs', 'filter'];
    for (const event of events) {
      store.on(event, update);
    }
    return () => {
      for (const event of events) {
        store.off(event, update);
      }
    };
  }, [store, getState]);

  return state;
}
