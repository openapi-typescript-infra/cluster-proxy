import React from 'react';
import { Box, Text } from 'ink';
import type { RegistryEntry, SeenHost } from '../types.ts';

interface Props {
  registry: RegistryEntry[];
  seenHosts: SeenHost[];
}

export function ServiceRegistry({ registry, seenHosts }: Props) {
  const unregisteredHosts = seenHosts.filter((h) => !h.isRegistered);

  return (
    <Box borderStyle="single" flexDirection="column" paddingX={1} overflow="hidden">
      <Text bold underline>
        Registered Services
      </Text>
      {registry.length === 0 && <Text dimColor>No services registered</Text>}
      {registry.map((entry) => (
        <Text key={entry.name}>
          <Text color="green">{entry.name}</Text>
          <Text dimColor> {'->'} </Text>
          <Text>{entry.target}</Text>
        </Text>
      ))}

      {unregisteredHosts.length > 0 && (
        <>
          <Text bold underline>
            {'\n'}Cluster Hosts
          </Text>
          <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
            {unregisteredHosts.map((h) => (
              <Text key={h.host}>
                <Text color="yellow">{h.host}</Text>
                <Text dimColor>
                  {' '}
                  ({h.requestCount} req{h.requestCount !== 1 ? 's' : ''})
                </Text>
              </Text>
            ))}
          </Box>
        </>
      )}
    </Box>
  );
}
