import React from 'react';
import { Box, Text } from 'ink';

interface Props {
  mode: 'dashboard' | 'inspector';
  filter?: string | null;
  requestCount?: number;
}

export function StatusBar({ mode, filter, requestCount }: Props) {
  return (
    <Box>
      <Text dimColor>
        {mode === 'dashboard'
          ? `[f]ilter  [c]lear  [q]uit  [Up/Down] scroll  [Enter] inspect${filter ? `  Filter: ${filter}` : ''}  ${requestCount ?? 0} requests stored`
          : '[Esc/b] back  [Up/Down] scroll'}
      </Text>
    </Box>
  );
}
