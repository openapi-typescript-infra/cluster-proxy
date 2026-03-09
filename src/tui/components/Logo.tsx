import React from 'react';
import { Box, Text } from 'ink';
import figlet from 'figlet';

interface Props {
  host: string;
  httpPort: number;
  httpsPort: number;
  name?: string;
}

export function Logo({ host, httpPort, httpsPort, name = 'Cluster Proxy' }: Props) {
  const logoText = figlet.textSync(name, { font: 'Standard' });
  return (
    <Box borderStyle="single" paddingX={1} flexDirection="column">
      <Text color="cyan">{logoText}</Text>
      <Text dimColor>
        {host} http:{httpPort} https:{httpsPort}
      </Text>
    </Box>
  );
}
