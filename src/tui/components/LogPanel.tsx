import React, { useState, useEffect, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import type { CapturedRequest, LogEntry } from '../types.ts';

interface Props {
  logs: LogEntry[];
  requests: CapturedRequest[];
  filter: string | null;
  onSelectRequest: (id: string) => void;
  selectedIndex: number;
  onSelectedIndexChange: (index: number) => void;
  filterActive: boolean;
  maxHeight: number;
}

type TimelineEntry =
  | { kind: 'log'; log: LogEntry; timestamp: number }
  | { kind: 'request'; request: CapturedRequest; timestamp: number };

function levelColor(level: string): string {
  switch (level) {
    case 'error':
    case 'fatal':
      return 'red';
    case 'warn':
      return 'yellow';
    case 'info':
      return 'green';
    case 'debug':
      return 'gray';
    default:
      return 'white';
  }
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
  logs,
  requests,
  filter,
  onSelectRequest,
  selectedIndex,
  onSelectedIndexChange,
  filterActive,
  maxHeight,
}: Props) {
  const [logScroll, setLogScroll] = useState(0);

  // 2 lines reserved for border + header
  const visibleCount = Math.max(1, maxHeight - 2);

  // Merged timeline for unfiltered view
  const timeline = useMemo<TimelineEntry[]>(() => {
    if (filter) return [];
    const entries: TimelineEntry[] = [
      ...logs.map((log): TimelineEntry => ({ kind: 'log', log, timestamp: log.timestamp })),
      ...requests.map(
        (req): TimelineEntry => ({ kind: 'request', request: req, timestamp: req.timestamp }),
      ),
    ];
    entries.sort((a, b) => a.timestamp - b.timestamp);
    return entries;
  }, [filter, logs, requests]);

  // Auto-scroll to bottom when new entries arrive (unfiltered mode)
  useEffect(() => {
    if (!filter) {
      setLogScroll(Math.max(0, timeline.length - visibleCount));
    }
  }, [filter, timeline.length, visibleCount]);

  useInput(
    (input, key) => {
      if (filterActive) return;

      if (filter) {
        // In filtered request list mode
        if (key.upArrow) {
          onSelectedIndexChange(Math.max(0, selectedIndex - 1));
        } else if (key.downArrow) {
          onSelectedIndexChange(Math.min(requests.length - 1, selectedIndex + 1));
        } else if (key.return && requests.length > 0) {
          onSelectRequest(requests[selectedIndex]?.id || '');
        }
      } else {
        // In timeline scroll mode
        if (key.upArrow) {
          setLogScroll((s) => Math.max(0, s - 1));
        } else if (key.downArrow) {
          setLogScroll((s) => Math.min(Math.max(0, timeline.length - visibleCount), s + 1));
        }
      }
    },
    { isActive: !filterActive },
  );

  if (filter) {
    // Keep selected index visible
    const startIdx = Math.max(
      0,
      Math.min(selectedIndex - Math.floor(visibleCount / 2), requests.length - visibleCount),
    );
    const visible = requests.slice(startIdx, startIdx + visibleCount);

    return (
      <Box borderStyle="single" flexDirection="column" flexGrow={1} overflow="hidden">
        <Text bold>
          Requests matching: <Text color="cyan">{filter}</Text> ({requests.length} total)
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
        {requests.length === 0 && <Text dimColor>No matching requests</Text>}
      </Box>
    );
  }

  // Merged timeline mode
  const visibleEntries = timeline.slice(logScroll, logScroll + visibleCount);

  return (
    <Box borderStyle="single" flexDirection="column" flexGrow={1} overflow="hidden">
      <Text bold>Activity</Text>
      {visibleEntries.map((entry, i) => {
        if (entry.kind === 'log') {
          const log = entry.log;
          return (
            <Text key={`log-${logScroll + i}`} wrap="truncate">
              <Text dimColor>{formatTime(log.timestamp)} </Text>
              <Text color={levelColor(log.level)}>{log.level.padEnd(5)} </Text>
              <Text>{log.message}</Text>
            </Text>
          );
        }
        const req = entry.request;
        return (
          <Text key={`req-${req.id}`} wrap="truncate">
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
      {timeline.length === 0 && <Text dimColor>No activity yet</Text>}
    </Box>
  );
}
