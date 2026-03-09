import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { ProxyStore } from '../store.ts';
import type { SeenHost } from '../types.ts';

interface Props {
  store: ProxyStore;
  seenHosts: SeenHost[];
  onClose: () => void;
}

export function ServiceFilter({ store, seenHosts, onClose }: Props) {
  const [value, setValue] = useState(store.activeFilter || '');
  const [hostIndex, setHostIndex] = useState(-1);

  // Build a list of all known hosts for quick selection
  const hostNames = seenHosts.map((h) => h.host);

  useInput((input, key) => {
    if (key.escape) {
      onClose();
      return;
    }
    if (key.return) {
      store.setFilter(value || null);
      onClose();
      return;
    }
    if (key.backspace || key.delete) {
      setValue((v) => v.slice(0, -1));
      setHostIndex(-1);
      return;
    }
    if (key.tab) {
      // Cycle through known hosts
      const next = (hostIndex + 1) % (hostNames.length || 1);
      setHostIndex(next);
      if (hostNames[next]) {
        setValue(hostNames[next]);
      }
      return;
    }
    if (key.upArrow) {
      const next = hostIndex <= 0 ? hostNames.length - 1 : hostIndex - 1;
      setHostIndex(next);
      if (hostNames[next]) {
        setValue(hostNames[next]);
      }
      return;
    }
    if (key.downArrow) {
      const next = (hostIndex + 1) % (hostNames.length || 1);
      setHostIndex(next);
      if (hostNames[next]) {
        setValue(hostNames[next]);
      }
      return;
    }
    // Regular character input
    if (input && !key.ctrl && !key.meta) {
      setValue((v) => v + input);
      setHostIndex(-1);
    }
  });

  // Show matching hosts as suggestions
  const suggestions = value
    ? hostNames.filter((h) => h.toLowerCase().includes(value.toLowerCase())).slice(0, 5)
    : hostNames.slice(0, 8);

  return (
    <Box borderStyle="single" flexDirection="column" paddingX={1}>
      <Box>
        <Text bold>Filter: </Text>
        <Text color="cyan">{value}</Text>
        <Text color="gray">|</Text>
        <Text dimColor> (Enter=apply Esc=cancel Tab/Arrows=cycle hosts, empty=clear)</Text>
      </Box>
      {suggestions.length > 0 && (
        <Box flexDirection="row" gap={2}>
          <Text dimColor>Hosts: </Text>
          {suggestions.map((h) => (
            <Text
              key={h}
              color={hostNames.indexOf(h) === hostIndex ? 'cyan' : undefined}
              dimColor={hostNames.indexOf(h) !== hostIndex}>
              {h}
            </Text>
          ))}
        </Box>
      )}
    </Box>
  );
}
