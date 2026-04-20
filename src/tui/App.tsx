import React, { useState, useEffect } from 'react';
import { Box, useInput, useApp, useStdout } from 'ink';
import type { ProxyStore } from './store.js';
import { Logo } from './components/Logo.js';
import { ServiceRegistry } from './components/ServiceRegistry.js';
import { LogPanel } from './components/LogPanel.js';
import { RequestInspector } from './components/RequestInspector.js';
import { ServiceFilter } from './components/ServiceFilter.js';
import { StatusBar } from './components/StatusBar.js';
import { useStore } from './hooks/useStore.js';

interface AppProps {
  store: ProxyStore;
  host: string;
  httpPort: number;
  httpsPort: number;
  name?: string;
  apiPort?: number;
}

export function App({ store, host, httpPort, httpsPort, name, apiPort }: AppProps) {
  const [viewMode, setViewMode] = useState<'dashboard' | 'inspector'>('dashboard');
  const [selectedRequestId, setSelectedRequestId] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [filterActive, setFilterActive] = useState(false);
  const state = useStore(store);
  const { exit } = useApp();
  const { stdout } = useStdout();

  const [termSize, setTermSize] = useState({
    cols: stdout?.columns || 80,
    rows: stdout?.rows || 24,
  });

  useEffect(() => {
    const onResize = () => {
      setTermSize({
        cols: stdout?.columns || 80,
        rows: stdout?.rows || 24,
      });
    };
    stdout?.on('resize', onResize);
    return () => {
      stdout?.off('resize', onResize);
    };
  }, [stdout]);

  const { cols, rows } = termSize;
  const compact = cols < 100 || rows < 30;

  useInput(
    (input, key) => {
      if (filterActive) return;

      if (input === 'q' && viewMode === 'dashboard') {
        exit();
        return;
      }
      if (input === 'f' && viewMode === 'dashboard') {
        setFilterActive(true);
        return;
      }
      if (input === 'c' && viewMode === 'dashboard') {
        store.clearRequests();
        return;
      }
      if (key.escape) {
        if (viewMode === 'inspector') {
          setViewMode('dashboard');
        }
      }
    },
    { isActive: !filterActive },
  );

  if (viewMode === 'inspector' && selectedRequestId) {
    return (
      <Box flexDirection="column" width={cols} height={rows}>
        <Box flexGrow={1}>
          <RequestInspector
            request={state.requests.find((r) => r.id === selectedRequestId)}
            onBack={() => setViewMode('dashboard')}
            maxLines={rows - 2}
          />
        </Box>
        <StatusBar mode="inspector" />
      </Box>
    );
  }

  return (
    <Box flexDirection="column" width={cols} height={rows}>
      {/* Top row: logo + registry */}
      <Box flexDirection={compact ? 'column' : 'row'} flexShrink={0}>
        {!compact && (
          <Box width="40%">
            <Logo host={host} httpPort={httpPort} httpsPort={httpsPort} name={name} />
          </Box>
        )}
        <Box width={compact ? '100%' : '60%'} flexDirection="column">
          <ServiceRegistry registry={state.registry} seenHosts={state.seenHosts} />
        </Box>
      </Box>

      {/* Filter bar */}
      {filterActive && (
        <Box flexShrink={0}>
          <ServiceFilter
            store={store}
            seenHosts={state.seenHosts}
            onClose={() => setFilterActive(false)}
          />
        </Box>
      )}

      {/* Middle: scrolling logs / request list - takes all remaining space */}
      <Box flexGrow={1} flexShrink={1} overflow="hidden">
        <LogPanel
          requests={state.filteredRequests}
          filter={state.activeFilter}
          onSelectRequest={(id) => {
            setSelectedRequestId(id);
            setViewMode('inspector');
          }}
          selectedIndex={selectedIndex}
          onSelectedIndexChange={setSelectedIndex}
          filterActive={filterActive}
          maxHeight={rows - (compact ? 8 : 12) - 1}
        />
      </Box>

      <Box flexShrink={0}>
        <StatusBar
          mode="dashboard"
          filter={state.activeFilter}
          requestCount={state.requests.length}
          apiPort={apiPort}
        />
      </Box>
    </Box>
  );
}
