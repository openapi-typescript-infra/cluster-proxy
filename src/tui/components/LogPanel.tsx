import React, { useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import type { CapturedRequest } from '../types.ts';

interface Props {
  requests: CapturedRequest[];
  filter: string | null;
  onSelectRequest: (id: string) => void;
  selectedIndex: number;
  onSelectedIndexChange: (index: number) => void;
  filterActive: boolean;
  maxHeight: number;
}

function statusColor(status: number | null): string {
  if (status === null) return 'gray';
  if (status < 300) return 'green';
  if (status < 400) return 'yellow';
  return 'red';
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString('en-US', { hour12: false });
}

export function LogPanel({
  requests,
  filter,
  onSelectRequest,
  selectedIndex,
  onSelectedIndexChange,
  filterActive,
  maxHeight,
}: Props) {
  // 2 lines reserved for border + header
  const visibleCount = Math.max(1, maxHeight - 2);

  // Auto-select last item when new requests arrive and nothing is selected
  useEffect(() => {
    if (requests.length > 0 && selectedIndex >= requests.length) {
      onSelectedIndexChange(requests.length - 1);
    }
  }, [requests.length, selectedIndex, onSelectedIndexChange]);

  useInput(
    (input, key) => {
      if (filterActive) return;

      if (key.upArrow) {
        onSelectedIndexChange(Math.max(0, selectedIndex - 1));
      } else if (key.downArrow) {
        onSelectedIndexChange(Math.min(requests.length - 1, selectedIndex + 1));
      } else if (key.return && requests.length > 0) {
        onSelectRequest(requests[selectedIndex]?.id || '');
      }
    },
    { isActive: !filterActive },
  );

  // Keep selected index visible
  const startIdx = Math.max(
    0,
    Math.min(selectedIndex - Math.floor(visibleCount / 2), requests.length - visibleCount),
  );
  const visible = requests.slice(startIdx, startIdx + visibleCount);

  return (
    <Box borderStyle="single" flexDirection="column" flexGrow={1} overflow="hidden">
      <Text bold>
        {filter ? (
          <>
            Requests matching: <Text color="cyan">{filter}</Text> ({requests.length} total)
          </>
        ) : (
          <>Requests ({requests.length} total)</>
        )}
      </Text>
      {visible.map((req) => {
        const isSelected = requests.indexOf(req) === selectedIndex;
        return (
          <Text key={req.id} inverse={isSelected}>
            <Text dimColor>{formatTime(req.timestamp)} </Text>
            <Text color={statusColor(req.statusCode)}>
              {String(req.statusCode ?? '...').padStart(3)}{' '}
            </Text>
            <Text bold>{req.method.padEnd(4)} </Text>
            <Text color={req.isRegistered ? 'green' : 'yellow'}>{req.host}</Text>
            <Text>{req.url} </Text>
            <Text dimColor>
              {req.duration !== null ? `${req.duration}ms` : ''}
              {req.error ? ` ERR: ${req.error}` : ''}
            </Text>
          </Text>
        );
      })}
      {requests.length === 0 && (
        <Text dimColor>{filter ? 'No matching requests' : 'No requests yet'}</Text>
      )}
    </Box>
  );
}
